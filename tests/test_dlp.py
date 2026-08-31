"""Tests for the planner.

Run with: python3 -m unittest discover -s tests -v
"""

from __future__ import annotations

import sys
import unittest
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dlp.backtest import Executor, PerfectOracle, run_backtest
from dlp.config import CHILD, Party, Strategy, TripConfig, _hhmm
from dlp.forecast import Forecaster
from dlp.model import Catalog
from dlp.optimizer import REPEAT_COOLDOWN_MIN, Optimizer
from dlp.sources.base import match_attraction, normalise
from dlp.sources.simulator import SimulatedSource, observations_from_trace, simulate_day
from dlp.store import Store
from dlp.walk import WalkMatrix


def build(cfg: TripConfig | None = None, crowd: float = 6.0, seed: int = 5):
    cfg = cfg or TripConfig()
    catalog = Catalog.load().for_trip(cfg)
    traces = simulate_day(catalog, cfg.trip_date, crowd_index=crowd,
                          open_min=cfg.open_minute("DLP"),
                          close_min=cfg.close_minute("DLP"), seed=seed)
    src = SimulatedSource(catalog, traces)
    return cfg, catalog, src


def plan_from(cfg, catalog, src, at: int | None = None):
    at = at if at is not None else cfg.day_start()
    fc = Forecaster.from_catalog(catalog, cfg)
    fc.observe({r: (at, src.wait_at(r, at)) for r in catalog.ids()})
    walk = WalkMatrix(catalog, cfg.party.walk_speed_family_mps,
                      cfg.party.walk_speed_adult_mps)
    opt = Optimizer(catalog, cfg, fc, walk)
    opt.resume_from(t0=at, t1=at, loc0=WalkMatrix.ENTRANCE, loc1=WalkMatrix.ENTRANCE,
                    child_done=frozenset(), adult_done=frozenset())
    return opt.solve()


class TestCatalog(unittest.TestCase):
    def test_loads_and_has_both_parks(self):
        cat = Catalog.load()
        self.assertGreater(len(cat), 30)
        self.assertTrue(cat.in_park("DLP"))
        self.assertTrue(cat.in_park("DAW"))

    def test_height_gate(self):
        cat = Catalog.load()
        indy = cat["indiana_jones"]
        self.assertFalse(indy.admits(120))
        self.assertTrue(indy.admits(145))
        self.assertTrue(cat["pirates"].admits(90))   # no minimum

    def test_short_child_loses_thrill_rides(self):
        cfg = TripConfig(party=Party(child_height_cm=95))
        cat = Catalog.load().for_trip(cfg)
        plan = plan_from(*build(cfg)[0:1] + (cat,), build(cfg)[2])
        for item in plan.rides(track=0):
            if item.mode == "rider_switch":
                continue
            a = cat[item.ride_id]
            if item.group & CHILD:
                self.assertTrue(a.admits(95),
                                f"{a.name} needs {a.min_height_cm}cm but child is 95cm")


class TestWalk(unittest.TestCase):
    def setUp(self):
        self.cat = Catalog.load()
        self.w = WalkMatrix(self.cat, 0.85, 1.3)

    def test_symmetric_and_zero_diagonal(self):
        self.assertEqual(self.w.minutes("pirates", "pirates"), 0.0)
        self.assertAlmostEqual(self.w.minutes("pirates", "big_thunder"),
                               self.w.minutes("big_thunder", "pirates"), places=6)

    def test_park_hop_costs_more_than_crossing_a_land(self):
        same_park = self.w.minutes("pirates", "hyperspace_mountain")
        hop = self.w.minutes("pirates", "tower_of_terror")
        self.assertGreater(hop, same_park)

    def test_adults_walk_faster_than_families(self):
        self.assertLess(self.w.minutes("pirates", "small_world", with_child=False),
                        self.w.minutes("pirates", "small_world", with_child=True))


class TestSimulator(unittest.TestCase):
    def test_deterministic_for_a_seed(self):
        cat = Catalog.load()
        a = simulate_day(cat, date(2026, 11, 27), 6.0, 570, 1320, seed=1)
        b = simulate_day(cat, date(2026, 11, 27), 6.0, 570, 1320, seed=1)
        self.assertEqual(a, b)

    def test_busier_days_have_longer_queues(self):
        cat = Catalog.load()
        quiet = simulate_day(cat, date(2026, 11, 27), 2.0, 570, 1320, seed=3,
                             breakdowns=False)
        busy = simulate_day(cat, date(2026, 11, 27), 9.0, 570, 1320, seed=3,
                            breakdowns=False)
        qs = [w for s in quiet.values() for _, w in s if w is not None]
        bs = [w for s in busy.values() for _, w in s if w is not None]
        self.assertLess(sum(qs) / len(qs), sum(bs) / len(bs))

    def test_rope_drop_is_quieter_than_midday(self):
        cat = Catalog.load()
        tr = simulate_day(cat, date(2026, 11, 27), 6.0, 570, 1320, seed=11,
                          breakdowns=False)
        series = dict(tr["big_thunder"])
        self.assertLess(series[575], series[780],
                        "the first minutes of the day should beat lunchtime")


class TestForecaster(unittest.TestCase):
    def test_crowd_anchor_tracks_a_busy_day(self):
        cfg, cat, quiet = build(crowd=2.5, seed=8)
        _, _, busy = build(crowd=9.0, seed=8)
        at = 12 * 60
        fq = Forecaster.from_catalog(cat, cfg)
        fq.observe({r: (at, quiet.wait_at(r, at)) for r in cat.ids()})
        fb = Forecaster.from_catalog(cat, cfg)
        fb.observe({r: (at, busy.wait_at(r, at)) for r in cat.ids()})
        self.assertLess(fq.crowd_anchor, fb.crowd_anchor)

    def test_prediction_reverts_toward_the_prior(self):
        """A ride running way over its prior right now should be predicted
        closer to normal several hours out than it is right now."""
        cfg, cat, src = build()
        fc = Forecaster.from_catalog(cat, cfg)
        at = 11 * 60
        snap = {r: (at, src.wait_at(r, at)) for r in cat.ids()}
        snap["peter_pan"] = (at, 200)          # absurd spike
        fc.observe(snap)
        near = fc.predict("peter_pan", at + 10)
        far = fc.predict("peter_pan", at + 240)
        self.assertGreater(near, far)

    def test_closed_ride_is_penalised_but_not_excluded(self):
        cfg, cat, src = build()
        fc = Forecaster.from_catalog(cat, cfg)
        at = 11 * 60
        snap = {r: (at, src.wait_at(r, at)) for r in cat.ids()}
        snap["big_thunder"] = (at, None)
        fc.observe(snap)
        self.assertLess(fc.availability("big_thunder", at + 5), 0.5)
        self.assertGreater(fc.availability("big_thunder", at + 120), 0.9)
        self.assertLess(fc.expected_queue_min("big_thunder", at + 240), 200)


class TestOptimizer(unittest.TestCase):
    def setUp(self):
        self.cfg, self.cat, self.src = build()
        self.plan = plan_from(self.cfg, self.cat, self.src)

    def test_produces_a_full_day(self):
        self.assertGreater(len(self.plan.rides()), 10)
        self.assertGreater(self.plan.summary(self.cfg)["distinct_child_rides"], 10)

    def test_nothing_runs_past_park_close(self):
        for i in self.plan.items:
            if i.ride_id:
                close = self.cfg.close_minute(self.cat[i.ride_id].park)
                self.assertLessEqual(i.end, close, f"{i.name} ends after close")

    def test_no_track_overlaps_itself(self):
        for track in (0, 1):
            items = sorted((i for i in self.plan.items if i.track == track),
                           key=lambda i: i.start)
            for a, b in zip(items, items[1:]):
                self.assertLessEqual(a.end, b.start,
                                     f"{a.name} overlaps {b.name} on track {track}")

    def test_uses_the_second_queue(self):
        """The whole point: some of the day must have both tracks in a line."""
        self.assertGreater(self.plan.parallel_minutes(), 30)

    def test_lunch_lands_inside_its_window(self):
        meals = [i for i in self.plan.items if i.kind == "meal"]
        self.assertEqual(len(meals), 1, "exactly one lunch")
        lo, hi = _hhmm(self.cfg.lunch_window[0]), _hhmm(self.cfg.lunch_window[1])
        self.assertGreaterEqual(meals[0].start, lo)
        self.assertLessEqual(meals[0].end, hi + 1)

    def test_must_do_list_is_prioritised(self):
        done = self.plan.distinct_child_rides()
        missed = set(self.cfg.must_do) - done
        self.assertEqual(missed, set(), f"missed must-do rides: {missed}")

    def test_repeat_cooldown_respected(self):
        seen: dict[str, int] = {}
        for i in sorted(self.plan.rides(track=0), key=lambda i: i.start):
            prev = seen.get(i.ride_id)
            if prev is not None:
                self.assertGreaterEqual(i.start - prev, REPEAT_COOLDOWN_MIN - 1,
                                        f"{i.name} repeated too soon")
            seen[i.ride_id] = i.end

    def test_premier_access_budget_is_respected(self):
        booked = [i for i in self.plan.items if i.kind == "book_pa"]
        self.assertLessEqual(len(booked), self.cfg.strategy.premier_access_budget)

    def test_free_parent_does_not_solo_kiddie_rides(self):
        """Splitting up has to buy something. A parent queueing alone for a
        toddler ride is the planner wasting its second track."""
        opt = Optimizer(self.cat, self.cfg, Forecaster.from_catalog(self.cat, self.cfg))
        for i in self.plan.rides(track=1):
            if i.wait_min <= 15:
                continue    # shadowing the family, or a walk-on, is fine
            self.assertTrue(opt._solo_worthwhile(self.cat[i.ride_id]),
                            f"parent queued {i.wait_min}m alone for {i.name}")

    def test_resume_starts_where_told(self):
        plan = plan_from(self.cfg, self.cat, self.src, at=15 * 60)
        self.assertTrue(plan.items)
        self.assertGreaterEqual(min(i.start for i in plan.items), 15 * 60)

    def test_second_queue_earns_its_keep(self):
        """A party restricted to one queue at a time should do measurably
        worse. If it does not, the second track is decoration."""
        solo_cfg = self.cfg.with_overrides(
            strategy=Strategy(parallel_queues=1, allow_single_rider=False,
                              premier_access_budget=0, allow_rider_switch=False))
        solo = plan_from(solo_cfg, self.cat, self.src)
        one = solo.summary(solo_cfg)
        two = self.plan.summary(self.cfg)

        # Moving as one unit means never queueing for two things at once.
        self.assertEqual(one["overlapped_queue_min"], 0)
        self.assertGreater(two["overlapped_queue_min"], 30)
        # And it should buy the child a better day, not just a busier parent.
        self.assertGreater(two["distinct_child_rides"], one["distinct_child_rides"])


class TestStore(unittest.TestCase):
    def setUp(self):
        self.store = Store(":memory:")
        self.cat = Catalog.load()

    def test_roundtrip_and_dedup(self):
        traces = simulate_day(self.cat, "2026-11-20", 6.0, 570, 1320, seed=2)
        rows = observations_from_trace(traces, self.cat, "2026-11-20")
        first = self.store.add_observations(rows)
        again = self.store.add_observations(rows)
        self.assertGreater(first, 0)
        self.assertEqual(again, 0, "re-inserting the same poll must be a no-op")
        self.assertEqual(self.store.days(), ["2026-11-20"])

    def test_replay_never_reveals_the_future(self):
        from dlp.sources.replay import ReplaySource
        traces = simulate_day(self.cat, "2026-11-20", 6.0, 570, 1320, seed=2)
        self.store.add_observations(
            observations_from_trace(traces, self.cat, "2026-11-20"))
        rp = ReplaySource(self.store, self.cat, "2026-11-20")
        self.assertIsNone(rp.wait_at("pirates", 400))     # before the park opened
        self.assertIsNotNone(rp.wait_at("pirates", 700))


class TestNameMatching(unittest.TestCase):
    def test_normalise_strips_accents_and_filler(self):
        self.assertEqual(normalise("Le Passage Enchanté d'Aladdin"),
                         normalise("Passage Enchante Aladdin"))

    def test_matches_real_provider_spellings(self):
        cat = Catalog.load()
        cases = {
            "Big Thunder Mountain": "big_thunder",
            "Pirates of the Caribbean": "pirates",
            "Phantom Manor": "phantom_manor",
            "Crush's Coaster": "crush_coaster",
            "it's a small world": "small_world",
            "Star Wars Hyperspace Mountain": "hyperspace_mountain",
        }
        for api_name, expected in cases.items():
            self.assertEqual(match_attraction(api_name, cat), expected, api_name)

    def test_unknown_name_matches_nothing(self):
        cat = Catalog.load()
        self.assertIsNone(match_attraction("Nonexistent Roller Thing 9000", cat))


class TestBacktest(unittest.TestCase):
    def test_executor_slips_the_schedule_when_queues_are_worse(self):
        cfg, cat, src = build()
        plan = plan_from(cfg, cat, src)
        walk = WalkMatrix(cat, cfg.party.walk_speed_family_mps,
                          cfg.party.walk_speed_adult_mps)

        class Worse:
            def wait_at(self, rid, minute):
                w = src.wait_at(rid, minute)
                return None if w is None else w + 10

        executed, _, _ = Executor(cat, cfg, Worse(), walk).run(plan)
        planned_rides = len(plan.rides())
        self.assertLessEqual(len(executed.rides()), planned_rides,
                             "a worse day cannot fit more rides than planned")

    def test_oracle_beats_the_online_planner(self):
        cfg = TripConfig()
        cat = Catalog.load().for_trip(cfg)
        report = run_backtest(cat, cfg, days=2, seed=77)
        agg = {r["strategy"]: r for r in report.aggregate()}
        self.assertEqual(agg["oracle_upper_bound"]["pct_of_oracle"], 100.0)
        online = agg["optimizer_online"]["pct_of_oracle"]
        self.assertLessEqual(online, 100.5, "nothing may beat perfect foresight")
        self.assertGreater(online, 60.0, "online planner should be within reach")

    def test_optimizer_beats_the_naive_baselines(self):
        cfg = TripConfig()
        cat = Catalog.load().for_trip(cfg)
        report = run_backtest(cat, cfg, days=2, seed=77)
        agg = {r["strategy"]: r for r in report.aggregate()}
        self.assertGreater(agg["optimizer_online"]["mean_value"],
                           agg["greedy_shortest_wait"]["mean_value"])
        self.assertGreater(agg["optimizer_online"]["mean_value"],
                           agg["fixed_popularity_route"]["mean_value"])

    def test_perfect_oracle_reports_closures(self):
        cfg, cat, src = build()
        oracle = PerfectOracle(src, cat)
        # Find a moment a ride is down in this seeded day, if any.
        for rid, series in src.traces.items():
            for minute, w in series:
                if w is None:
                    self.assertEqual(oracle.availability(rid, minute), 0.0)
                    self.assertGreater(oracle.expected_queue_min(rid, minute), 100)
                    return


if __name__ == "__main__":
    unittest.main(verbosity=2)
