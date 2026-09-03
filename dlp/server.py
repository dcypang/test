"""Local web server: the map, the timeline and a re-plan button.

Deliberately built on ``http.server`` from the standard library so the whole
project installs with nothing. It is a single-user planning tool for a day
out, not a public service -- it binds to localhost by default.
"""

from __future__ import annotations

import json
import mimetypes
import threading
from datetime import date, datetime
from functools import partial
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from .config import TripConfig, _hhmm, fmt_minute
from .forecast import Forecaster
from .model import Catalog
from .optimizer import Optimizer
from .osm import load_geometry
from .sources.base import SourceError
from .sources.queue_times import QueueTimesSource
from .sources.simulator import SimulatedSource, simulate_day
from .sources.themeparks_wiki import ThemeParksWikiSource
from .store import Store
from .walk import WalkMatrix

WEB_DIR = Path(__file__).parent.parent / "web"


class PlannerService:
    """Holds the catalog and store, and answers /api/plan."""

    def __init__(self, cfg: TripConfig, store: Store | None = None):
        self.cfg = cfg
        self.catalog = Catalog.load().for_trip(cfg)
        self.store = store
        self.walk = WalkMatrix(self.catalog, cfg.party.walk_speed_family_mps,
                               cfg.party.walk_speed_adult_mps)
        self.geometry = load_geometry() or {}
        self._lock = threading.Lock()
        self._sim_cache: dict = {}

    # ---- wait data ----------------------------------------------------------

    def _live_snapshot(self, minute: int) -> tuple[dict, str, str | None]:
        """Try the real sources, then the database, then give up.

        Returns (snapshot, description of where it came from, warning).
        """
        today = date.today().isoformat()

        for src in (ThemeParksWikiSource(self.catalog, self.cfg.themeparks_park_ids),
                    QueueTimesSource(self.catalog, self.cfg.queue_times_park_ids)):
            try:
                rows = src.fetch(today, minute)
            except (SourceError, OSError):
                continue
            if rows:
                snap = {r.attraction_id: (r.obs_minute, r.wait_min) for r in rows}
                if self.store is not None:
                    self.store.add_observations(rows)
                return snap, src.name, None

        if self.store is not None:
            snap = self.store.latest_snapshot(today)
            if snap:
                return snap, "database (last collected)", (
                    "Live APIs are unreachable, so this plan is built on the most "
                    "recent readings the collector banked.")

        return {}, "priors only", (
            "No live wait times and nothing collected yet. This plan comes purely "
            "from the seasonal priors, so treat the queue estimates as rough.")

    def _sim_snapshot(self, minute: int) -> tuple[dict, str, str | None]:
        key = self.cfg.trip_date.isoformat()
        src = self._sim_cache.get(key)
        if src is None:
            traces = simulate_day(
                self.catalog, self.cfg.trip_date, crowd_index=6.0,
                open_min=self.cfg.open_minute("DLP"),
                close_min=self.cfg.close_minute("DLP"), seed=20261127)
            src = SimulatedSource(self.catalog, traces)
            self._sim_cache[key] = src
        snap = {rid: (minute, src.wait_at(rid, minute)) for rid in self.catalog.ids()}
        return snap, "simulated day", (
            "Simulated wait times — useful for seeing how the plan behaves, but "
            "not real data.")

    # ---- planning -----------------------------------------------------------

    def plan(self, now_minute: int, source: str = "live") -> dict:
        with self._lock:
            if source == "sim":
                snap, src_name, warning = self._sim_snapshot(now_minute)
            else:
                snap, src_name, warning = self._live_snapshot(now_minute)

            forecaster = Forecaster.from_catalog(self.catalog, self.cfg, self.store)
            forecaster.observe(snap)

            opt = Optimizer(self.catalog, self.cfg, forecaster, self.walk)
            start = max(now_minute, self.cfg.day_start())
            opt.resume_from(t0=start, t1=start,
                            loc0=WalkMatrix.ENTRANCE, loc1=WalkMatrix.ENTRANCE,
                            child_done=frozenset(), adult_done=frozenset(),
                            lunch_done=start > _hhmm(self.cfg.lunch_window[1]))
            plan = opt.solve()

        waits = {rid: (w if w is not None else None) for rid, (_, w) in snap.items()}
        party = (f"{self.cfg.party.adults} adults + {self.cfg.party.children} child "
                 f"({self.cfg.party.child_height_cm}cm)")
        return {
            "attractions": [
                {"id": a.id, "name": a.name, "park": a.park, "land": a.land,
                 "lat": a.lat, "lon": a.lon, "min_height_cm": a.min_height_cm,
                 "appeal": a.appeal}
                for a in self.catalog
            ],
            "waits": waits,
            "geometry": self.geometry,
            "plan": plan.to_dict(self.cfg),
            "meta": {
                "trip_date": self.cfg.trip_date.isoformat(),
                "party": party,
                "source": src_name,
                "snapshot_at": fmt_minute(now_minute),
                "day_start": self.cfg.day_start(),
                "day_end": self.cfg.day_end(),
                "warning": warning,
                "map_source": (self.geometry.get("_meta", {}) or {}).get("source", "none"),
                "replan_note": (
                    f"Re-plan every {self.cfg.strategy.replan_interval_min} minutes "
                    f"during the day: queues move, and the plan is only as good as "
                    f"its most recent reading."),
            },
        }


class Handler(BaseHTTPRequestHandler):
    server_version = "dlp-planner/1.0"

    def __init__(self, *args, service: PlannerService, **kw):
        self.service = service
        super().__init__(*args, **kw)

    def log_message(self, fmt, *args):        # quieter than the default
        if "/api/" in (self.path or ""):
            super().log_message(fmt, *args)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/plan":
            return self._api_plan(parse_qs(parsed.query))
        if parsed.path == "/api/health":
            return self._json({"ok": True})
        return self._static(parsed.path)

    # ---- endpoints ----------------------------------------------------------

    def _api_plan(self, q: dict) -> None:
        now = (q.get("now") or [""])[0]
        source = (q.get("source") or ["live"])[0]
        try:
            minute = _hhmm(now) if now else (datetime.now().hour * 60 + datetime.now().minute)
        except ValueError:
            return self._text(400, f"bad 'now' parameter: {now!r}")
        try:
            payload = self.service.plan(minute, source)
        except Exception as e:                          # noqa: BLE001
            return self._text(500, f"{type(e).__name__}: {e}")
        self._json(payload)

    def _static(self, path: str) -> None:
        rel = "index.html" if path in ("/", "") else path.lstrip("/")
        target = (WEB_DIR / rel).resolve()
        if not str(target).startswith(str(WEB_DIR.resolve())) or not target.is_file():
            return self._text(404, "not found")
        ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if target.suffix in (".js", ".mjs"):
            ctype = "text/javascript"
        body = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", f"{ctype}; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    # ---- helpers ------------------------------------------------------------

    def _json(self, obj) -> None:
        body = json.dumps(obj).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _text(self, code: int, msg: str) -> None:
        body = msg.encode()
        self.send_response(code)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def serve(cfg: TripConfig, store: Store | None, host: str = "127.0.0.1",
          port: int = 8000) -> None:
    service = PlannerService(cfg, store)
    handler = partial(Handler, service=service)
    httpd = ThreadingHTTPServer((host, port), handler)
    print(f"Planner running at http://{host}:{port}  (Ctrl-C to stop)")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
    finally:
        httpd.server_close()
