"""The real-time collector.

Polls whichever wait-time sources are reachable and appends every reading to
SQLite. Two reasons to run it long before the trip:

* the forecaster's priors get much better with real history for the actual
  park, weekday and season than with the generic class curves it starts on;
* the backtester can then score strategies against days that really happened
  rather than simulated ones.

Run it as a daemon from now until the trip::

    python3 -m dlp.cli collect --loop

It is safe to stop and restart: rows are de-duplicated on
(date, minute, attraction, source).
"""

from __future__ import annotations

import signal
import time
from dataclasses import dataclass
from datetime import datetime

from .config import TripConfig
from .model import Catalog
from .sources.base import SourceError
from .sources.queue_times import QueueTimesSource
from .sources.themeparks_wiki import ThemeParksWikiSource
from .store import Store


@dataclass
class CollectResult:
    polled_utc: str
    inserted: int
    observed: int
    sources_ok: list[str]
    sources_failed: list[str]

    def line(self) -> str:
        ok = ",".join(self.sources_ok) or "none"
        bad = f" failed={','.join(self.sources_failed)}" if self.sources_failed else ""
        return (f"{self.polled_utc}  +{self.inserted:4d} new / {self.observed:4d} read"
                f"  sources={ok}{bad}")


class Collector:
    def __init__(self, cfg: TripConfig, catalog: Catalog, store: Store):
        self.cfg = cfg
        self.cat = catalog
        self.store = store
        self.sources = [
            ThemeParksWikiSource(catalog, cfg.themeparks_park_ids),
            QueueTimesSource(catalog, cfg.queue_times_park_ids),
        ]
        self._stop = False

    def stop(self, *_) -> None:
        self._stop = True

    def poll_once(self, now: datetime | None = None) -> CollectResult:
        now = now or datetime.now()
        obs_date = now.date().isoformat()
        obs_minute = now.hour * 60 + now.minute

        inserted = observed = 0
        ok: list[str] = []
        failed: list[str] = []
        for src in self.sources:
            try:
                rows = src.fetch(obs_date, obs_minute)
            except SourceError as e:
                failed.append(f"{src.name}({e})")
                continue
            except Exception as e:                      # noqa: BLE001 - keep polling
                failed.append(f"{src.name}({type(e).__name__})")
                continue
            if not rows:
                failed.append(f"{src.name}(no rows)")
                continue
            observed += len(rows)
            inserted += self.store.add_observations(rows)
            ok.append(src.name)

        return CollectResult(
            polled_utc=now.isoformat(timespec="seconds"),
            inserted=inserted, observed=observed,
            sources_ok=ok, sources_failed=failed,
        )

    def run_forever(self, on_result=print) -> None:
        """Poll until interrupted. Sleeps between polls; never busy-waits."""
        signal.signal(signal.SIGINT, self.stop)
        signal.signal(signal.SIGTERM, self.stop)
        self.store.log_run("collect", f"interval={self.cfg.poll_interval_sec}s")

        consecutive_failures = 0
        while not self._stop:
            result = self.poll_once()
            on_result(result.line())

            if result.inserted == 0 and result.sources_failed:
                consecutive_failures += 1
            else:
                consecutive_failures = 0

            # Back off when everything is failing, so a park that is closed or
            # an API that is down does not get hammered.
            delay = self.cfg.poll_interval_sec
            if consecutive_failures > 3:
                delay = min(1800, delay * 2 ** min(5, consecutive_failures - 3))
                on_result(f"  backing off to {delay}s after "
                          f"{consecutive_failures} failed polls")

            for _ in range(delay):
                if self._stop:
                    break
                time.sleep(1)

    def resolve_ids(self, on_result=print) -> dict:
        """Ask each provider for its real park ids, so a provider renumbering
        its parks does not silently produce an empty database."""
        found = {}
        for src in self.sources:
            try:
                found[src.name] = src.resolve_park_ids()
                on_result(f"{src.name}: {found[src.name]}")
            except Exception as e:                      # noqa: BLE001
                on_result(f"{src.name}: could not resolve ids ({e})")
        return found
