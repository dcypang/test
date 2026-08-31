"""Command line entry point.

    python3 -m dlp.cli plan                 build today's plan and print it
    python3 -m dlp.cli serve                map + timeline in the browser
    python3 -m dlp.cli collect --loop       start banking real wait times
    python3 -m dlp.cli backtest             validate the strategy
    python3 -m dlp.cli sync-catalog         refresh coordinates/hours from the API
    python3 -m dlp.cli status               what is in the database
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date, datetime
from pathlib import Path

from .backtest import (DEFAULT_STRATEGIES, OptimizerStrategy, OracleStrategy,
                       run_backtest)
from .collector import Collector
from .config import TripConfig, _hhmm, fmt_minute
from .forecast import Forecaster
from .model import Catalog
from .optimizer import Optimizer
from .sources.base import SourceError
from .sources.queue_times import QueueTimesSource
from .sources.simulator import (SimulatedSource, observations_from_trace,
                                simulate_day)
from .sources.themeparks_wiki import ThemeParksWikiSource
from .store import Store
from .walk import WalkMatrix


def _load(args) -> tuple[TripConfig, Catalog, Store]:
    cfg = TripConfig.load(args.config)
    if getattr(args, "date", None):
        cfg = cfg.with_overrides(trip_date=date.fromisoformat(args.date))
    catalog = Catalog.load().for_trip(cfg)
    store = Store(getattr(args, "db", None) or cfg.db_path)
    return cfg, catalog, store


# ---------------------------------------------------------------------------
# commands
# ---------------------------------------------------------------------------

def cmd_plan(args) -> int:
    cfg, catalog, store = _load(args)
    now = _hhmm(args.now) if args.now else max(
        cfg.day_start(), datetime.now().hour * 60 + datetime.now().minute)

    if args.simulate:
        traces = simulate_day(catalog, cfg.trip_date, crowd_index=args.crowd,
                              open_min=cfg.open_minute("DLP"),
                              close_min=cfg.close_minute("DLP"), seed=args.seed)
        src = SimulatedSource(catalog, traces)
        snap = {r: (now, src.wait_at(r, now)) for r in catalog.ids()}
        origin = f"simulated day (crowd index {args.crowd})"
    else:
        snap, origin = _live_or_stored(cfg, catalog, store)

    forecaster = Forecaster.from_catalog(catalog, cfg, store)
    forecaster.observe(snap)
    walk = WalkMatrix(catalog, cfg.party.walk_speed_family_mps,
                      cfg.party.walk_speed_adult_mps)
    opt = Optimizer(catalog, cfg, forecaster, walk)
    opt.resume_from(t0=now, t1=now, loc0=WalkMatrix.ENTRANCE, loc1=WalkMatrix.ENTRANCE,
                    child_done=frozenset(), adult_done=frozenset(),
                    lunch_done=now > _hhmm(cfg.lunch_window[1]))
    plan = opt.solve()

    if args.json:
        print(json.dumps(plan.to_dict(cfg), indent=2))
        return 0

    print(f"Disneyland Paris — {cfg.trip_date}  "
          f"({cfg.party.adults} adults + {cfg.party.children} child, "
          f"{cfg.party.child_height_cm}cm)")
    print(f"wait data: {origin}   planning from {fmt_minute(now)}")
    print(f"crowd anchor: {forecaster.crowd_anchor:.2f}x typical\n")
    _print_plan(plan, cfg)
    return 0


def _print_plan(plan, cfg) -> None:
    header = f"{'time':>13}  {'trk':3} {'who':10} {'queue':>6}  attraction"
    print(header)
    print("-" * (len(header) + 18))
    for i in sorted(plan.items, key=lambda i: (i.start, i.track)):
        who = "+".join(m.replace("Parent ", "P") for m in i.members())
        span = f"{fmt_minute(i.start)}-{fmt_minute(i.end)}"
        q = f"{i.wait_min}m" if i.kind == "ride" else ""
        mode = f" [{i.mode}]" if i.mode and i.mode != "standby" else ""
        track = "A" if i.track == 0 else "B"
        print(f"{span:>13}  {track:3} {who:10} {q:>6}  {i.name}{mode}")

    s = plan.summary(cfg)
    print()
    print(f"child rides {s['distinct_child_rides']} distinct "
          f"({s['child_rides']} total) · must-do {len(s['must_do_hit'])}/"
          f"{len(s['must_do_hit']) + len(s['must_do_missed'])}")
    print(f"family time in line {s['family_queue_min']}min · "
          f"{s['overlapped_queue_min']}min of it queueing two things at once")
    print(f"child on foot {s['walk_min']}min / {s['child_walk_km']}km "
          f"(stamina budget {cfg.party.child_stamina_min}min) · "
          f"whole party {s['walk_km']}km")
    print(f"Premier Access bought {s['premier_access_used']} · "
          f"single rider used {s['single_rider_used']}")
    if s["must_do_missed"]:
        print(f"NOT FITTING: {', '.join(s['must_do_missed'])}")


def _live_or_stored(cfg, catalog, store) -> tuple[dict, str]:
    today = date.today().isoformat()
    minute = datetime.now().hour * 60 + datetime.now().minute
    for src in (ThemeParksWikiSource(catalog, cfg.themeparks_park_ids),
                QueueTimesSource(catalog, cfg.queue_times_park_ids)):
        try:
            rows = src.fetch(today, minute)
        except (SourceError, OSError) as e:
            print(f"  {src.name} unavailable: {e}", file=sys.stderr)
            continue
        if rows:
            store.add_observations(rows)
            return {r.attraction_id: (r.obs_minute, r.wait_min) for r in rows}, src.name
    snap = store.latest_snapshot(today)
    if snap:
        return snap, "database (last collected readings)"
    print("  no live data and nothing collected — planning from priors only",
          file=sys.stderr)
    return {}, "seasonal priors only"


def cmd_collect(args) -> int:
    cfg, catalog, store = _load(args)
    collector = Collector(cfg, catalog, store)
    if args.resolve_ids:
        collector.resolve_ids()
        return 0
    if args.loop:
        print(f"collecting every {cfg.poll_interval_sec}s into {store.path}")
        collector.run_forever()
        return 0
    print(collector.poll_once().line())
    return 0


def cmd_backtest(args) -> int:
    cfg, catalog, store = _load(args)
    strategies = list(DEFAULT_STRATEGIES)
    if args.only:
        wanted = set(args.only.split(","))
        strategies = [s for s in strategies if s.name in wanted]
        if OracleStrategy.name not in wanted:
            strategies.append(OracleStrategy())   # needed for the % of oracle column

    report = run_backtest(catalog, cfg, days=args.days, store=store,
                          use_stored=args.use_stored, strategies=strategies,
                          seed=args.seed)

    source = "collected days" if args.use_stored else "simulated days"
    print(f"Backtest over {len(report.days)} {source}: {report.days[0]} .. {report.days[-1]}")
    print("Every strategy is replanned on data available at the time, then executed")
    print("against what the queues actually did. %oracle compares to a planner given")
    print("the whole day's true waits up front — the ceiling, not a real strategy.\n")
    print(report.render())

    if args.json:
        Path(args.json).write_text(json.dumps({
            "days": report.days,
            "crowd": report.crowd,
            "aggregate": report.aggregate(),
            "rows": [r.as_row() for r in report.rows],
        }, indent=2))
        print(f"\nwrote {args.json}")

    agg = {r["strategy"]: r for r in report.aggregate()}
    ours = agg.get(OptimizerStrategy.name)
    if ours and ours["pct_of_oracle"] is not None:
        print(f"\nOptimiser reaches {ours['pct_of_oracle']}% of the perfect-foresight "
              f"ceiling on average, {ours['worst_day_pct']}% on its worst day.")
        best_baseline = max(
            (r for n, r in agg.items()
             if n not in (OptimizerStrategy.name, OracleStrategy.name)),
            key=lambda r: r["pct_of_oracle"] or 0, default=None)
        if best_baseline:
            lift = ours["mean_value"] / max(1e-6, best_baseline["mean_value"])
            print(f"That is {lift:.2f}x the best baseline "
                  f"({best_baseline['strategy']}).")
    return 0


def cmd_seed(args) -> int:
    """Fill the database with simulated days so backtests have something to
    chew on before the collector has banked real history."""
    cfg, catalog, store = _load(args)
    from datetime import timedelta
    import random
    rng = random.Random(args.seed)
    total = 0
    for k in range(args.days):
        d = (cfg.trip_date - timedelta(days=7 * (k + 1))).isoformat()
        crowd = rng.choice([4.0, 5.0, 5.5, 6.0, 6.5, 7.0, 8.0])
        traces = simulate_day(catalog, d, crowd_index=crowd,
                              open_min=cfg.open_minute("DLP"),
                              close_min=cfg.close_minute("DLP"), seed=args.seed + k)
        rows = observations_from_trace(traces, catalog, d)
        n = store.add_observations(rows)
        store.set_day_meta(d, cfg.open_minute("DLP"), cfg.close_minute("DLP"),
                           crowd_index=crowd, source="simulated",
                           note="synthetic day — not observed data")
        total += n
        print(f"  {d}  crowd {crowd}  +{n} rows")
    print(f"seeded {total} simulated observations into {store.path}")
    print("These are clearly marked source='simulated'; they are for exercising the")
    print("pipeline, not for drawing conclusions about the real park.")
    return 0


def cmd_sync_catalog(args) -> int:
    cfg, catalog, store = _load(args)
    path = Path(__file__).parent / "data" / "attractions.json"
    raw = json.loads(path.read_text())

    src = ThemeParksWikiSource(catalog, cfg.themeparks_park_ids)
    try:
        ids = src.resolve_park_ids()
        print(f"resolved park ids: {ids}")
        locs = src.attraction_locations()
    except (SourceError, OSError) as e:
        print(f"could not reach themeparks.wiki: {e}", file=sys.stderr)
        return 1

    updated = 0
    for entry in raw["attractions"]:
        loc = locs.get(entry["id"])
        if loc and (abs(entry["lat"] - loc[0]) > 1e-6 or abs(entry["lon"] - loc[1]) > 1e-6):
            entry["lat"], entry["lon"] = round(loc[0], 6), round(loc[1], 6)
            updated += 1
    raw["_meta"]["coord_source"] = f"themeparks.wiki, synced {date.today().isoformat()}"

    for key in ("DLP", "DAW"):
        hours = src.park_hours(key, cfg.trip_date.isoformat())
        if hours:
            print(f"  {key} on {cfg.trip_date}: "
                  f"{fmt_minute(hours[0])}-{fmt_minute(hours[1])}")

    path.write_text(json.dumps(raw, indent=2) + "\n")
    print(f"updated {updated} attraction coordinates in {path}")
    print("Park hours above are NOT written automatically — set them in your config.")
    return 0


def cmd_status(args) -> int:
    cfg, catalog, store = _load(args)
    rows = store.coverage()
    print(f"database: {store.path}")
    print(f"catalog:  {len(catalog)} attractions usable by this party "
          f"(child {cfg.party.child_height_cm}cm)")
    if not rows:
        print("\nNo observations yet. Start banking data with:")
        print("    python3 -m dlp.cli collect --loop")
        print("or seed simulated days with:")
        print("    python3 -m dlp.cli seed --days 8")
        return 0
    print(f"\n{'date':12} {'rows':>7} {'rides':>6} {'window':>13}  sources")
    for r in rows:
        window = f"{fmt_minute(r['first_min'])}-{fmt_minute(r['last_min'])}"
        print(f"{r['obs_date']:12} {r['n']:>7} {r['rides']:>6} {window:>13}  {r['sources']}")
    real = [r for r in rows if "simulated" not in (r["sources"] or "")]
    print(f"\n{len(rows)} days stored, {len(real)} from real observations.")
    if len(real) < 10:
        print("The forecaster falls back to generic curves until roughly ten real")
        print("days of the same weekday and month are banked. Keep the collector running.")
    return 0


def cmd_serve(args) -> int:
    cfg, catalog, store = _load(args)
    from .server import serve
    serve(cfg, store, host=args.host, port=args.port)
    return 0


# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="dlp", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--config", help="JSON file overriding the trip defaults")
    p.add_argument("--db", help="SQLite path (default: waits.sqlite3)")
    p.add_argument("--date", help="trip date, YYYY-MM-DD")
    sub = p.add_subparsers(dest="cmd", required=True)

    sp = sub.add_parser("plan", help="build a plan and print it")
    sp.add_argument("--now", help="plan from this local time, HH:MM")
    sp.add_argument("--simulate", action="store_true",
                    help="use a simulated day instead of live data")
    sp.add_argument("--crowd", type=float, default=6.0, help="crowd index 1-10 when simulating")
    sp.add_argument("--seed", type=int, default=20261127)
    sp.add_argument("--json", action="store_true")
    sp.set_defaults(func=cmd_plan)

    sc = sub.add_parser("collect", help="poll live wait times into the database")
    sc.add_argument("--loop", action="store_true", help="keep polling")
    sc.add_argument("--resolve-ids", action="store_true",
                    help="look up provider park ids and exit")
    sc.set_defaults(func=cmd_collect)

    sb = sub.add_parser("backtest", help="score strategies against whole days")
    sb.add_argument("--days", type=int, default=8)
    sb.add_argument("--use-stored", action="store_true",
                    help="backtest on collected days instead of simulated ones")
    sb.add_argument("--only", help="comma-separated strategy names")
    sb.add_argument("--seed", type=int, default=1234)
    sb.add_argument("--json", help="also write the full report here")
    sb.set_defaults(func=cmd_backtest)

    ss = sub.add_parser("seed", help="fill the database with simulated days")
    ss.add_argument("--days", type=int, default=8)
    ss.add_argument("--seed", type=int, default=4242)
    ss.set_defaults(func=cmd_seed)

    sy = sub.add_parser("sync-catalog", help="refresh coordinates and hours from the API")
    sy.set_defaults(func=cmd_sync_catalog)

    st = sub.add_parser("status", help="what data has been collected")
    st.set_defaults(func=cmd_status)

    sv = sub.add_parser("serve", help="run the web UI")
    sv.add_argument("--host", default="127.0.0.1")
    sv.add_argument("--port", type=int, default=8000)
    sv.set_defaults(func=cmd_serve)

    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
