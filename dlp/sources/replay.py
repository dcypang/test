"""Replay a stored day out of the database.

This is what makes the backtest honest: the planner is handed a source that
refuses to reveal anything after the current simulated clock, while the
evaluator reads the same day's full trace to score what actually happened.
"""

from __future__ import annotations

from ..model import Catalog
from ..store import Observation, Store


class ReplaySource:
    name = "replay"

    def __init__(self, store: Store, catalog: Catalog, day: str):
        self.catalog = catalog
        self.day = day
        self.traces = store.day_trace(day)
        self._sorted = {rid: sorted(s) for rid, s in self.traces.items()}

    @property
    def ride_ids(self) -> list[str]:
        return list(self._sorted)

    def wait_at(self, rid: str, minute: int) -> int | None:
        """Most recent posted wait at or before ``minute``; None if closed."""
        series = self._sorted.get(rid)
        if not series:
            return None
        lo, hi = 0, len(series) - 1
        if series[0][0] > minute:
            return None
        while lo < hi:
            mid = (lo + hi + 1) // 2
            if series[mid][0] <= minute:
                lo = mid
            else:
                hi = mid - 1
        return series[lo][1]

    def fetch(self, obs_date: str, obs_minute: int) -> list[Observation]:
        out = []
        for rid in self._sorted:
            a = self.catalog.get(rid)
            if a is None:
                continue
            w = self.wait_at(rid, obs_minute)
            out.append(Observation(
                obs_date=obs_date, obs_minute=obs_minute, attraction_id=rid,
                park=a.park, wait_min=w, is_open=w is not None, source=self.name,
            ))
        return out

    def bounds(self) -> tuple[int, int]:
        mins = [s[0][0] for s in self._sorted.values() if s]
        maxs = [s[-1][0] for s in self._sorted.values() if s]
        return (min(mins) if mins else 0, max(maxs) if maxs else 0)
