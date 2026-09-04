"""A calibrated synthetic park day.

The live APIs only ever hand out *right now*, so until the collector has
banked enough real history there is nothing to backtest against. This module
generates full days of wait-time traces whose shape matches how theme park
queues actually behave:

* a rope-drop window where the headliners are briefly walk-on,
* a steep morning build to a midday plateau,
* an afternoon parade dip on the rides away from the parade route,
* a last-hour surge on the headliners followed by a collapse at close,
* autocorrelated noise, so consecutive readings drift rather than jump,
* random breakdowns, and the wait spike that follows a reopening.

Days generated here are labelled ``source='simulated'`` in the database so
they can never be mistaken for observed data.
"""

from __future__ import annotations

import math
import random
from datetime import date

from ..model import Attraction, Catalog
from ..store import Observation

STEP_MIN = 5

#: Rides fall into behavioural classes that share a demand curve shape.
def ride_class(a: Attraction) -> str:
    if a.type in {"show", "playground", "walkthrough"}:
        return "flat_low"
    if a.appeal >= 9 and a.capacity_class in {"low", "medium"}:
        return "headliner_starved"   # demand hugely exceeds capacity all day
    if a.appeal >= 8:
        return "headliner"
    if a.appeal >= 6:
        return "family"
    return "minor"


#: Fraction of the day's peak wait, sampled at the given fraction of park day.
#: Keys are (elapsed / total_day) breakpoints; values multiply the peak.
SHAPES: dict[str, list[tuple[float, float]]] = {
    "headliner_starved": [
        (0.00, 0.10), (0.04, 0.45), (0.10, 0.80), (0.20, 0.95),
        (0.35, 1.00), (0.55, 0.98), (0.70, 0.92), (0.85, 0.85),
        (0.95, 0.60), (1.00, 0.20),
    ],
    "headliner": [
        (0.00, 0.08), (0.05, 0.35), (0.12, 0.65), (0.25, 0.90),
        (0.40, 1.00), (0.60, 0.93), (0.72, 0.80), (0.86, 0.88),
        (0.95, 0.55), (1.00, 0.15),
    ],
    "family": [
        (0.00, 0.10), (0.08, 0.30), (0.20, 0.62), (0.35, 0.88),
        (0.50, 1.00), (0.65, 0.92), (0.78, 0.72), (0.90, 0.50),
        (1.00, 0.15),
    ],
    "minor": [
        (0.00, 0.15), (0.15, 0.45), (0.35, 0.80), (0.55, 1.00),
        (0.75, 0.75), (0.90, 0.45), (1.00, 0.15),
    ],
    "flat_low": [
        (0.00, 0.30), (0.20, 0.70), (0.50, 1.00), (0.80, 0.75), (1.00, 0.35),
    ],
}

#: Rides on or beside the parade route stay busy during the parade; the rest
#: empty out as guests go to watch.
PARADE_ROUTE_LANDS = {"Main Street U.S.A.", "Frontierland"}
PARADE_START_FRACTION = 0.62
PARADE_LENGTH_MIN = 45


def _interp(shape: list[tuple[float, float]], x: float) -> float:
    if x <= shape[0][0]:
        return shape[0][1]
    if x >= shape[-1][0]:
        return shape[-1][1]
    for (x0, y0), (x1, y1) in zip(shape, shape[1:]):
        if x0 <= x <= x1:
            if x1 == x0:
                return y1
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return shape[-1][1]


def crowd_multiplier(crowd_index: float) -> float:
    """Map a 1-10 crowd index onto a multiplier around the typical peak.

    Index 5 is an average day and reproduces the catalog's typical peak wait.
    A 1 is a dead January Tuesday; a 10 is the week between Christmas and New
    Year. Late November sits around 5-7 once the Christmas season opens.
    """
    return 0.35 + 0.13 * float(crowd_index)


def simulate_day(
    catalog: Catalog,
    day: date | str,
    crowd_index: float = 6.0,
    open_min: int = 570,
    close_min: int = 1320,
    seed: int | None = None,
    breakdowns: bool = True,
) -> dict[str, list[tuple[int, int | None]]]:
    """Generate {attraction_id: [(minute, wait_or_None), ...]} for one day."""
    day_str = day.isoformat() if isinstance(day, date) else day
    rng = random.Random(seed if seed is not None else hash((day_str, crowd_index)) & 0xFFFFFFFF)
    total = max(1, close_min - open_min)
    crowd = crowd_multiplier(crowd_index)
    parade_start = open_min + int(total * PARADE_START_FRACTION)

    traces: dict[str, list[tuple[int, int | None]]] = {}
    for a in catalog:
        cls = ride_class(a)
        shape = SHAPES[cls]
        # Each ride gets its own popularity wobble for the day, so the same
        # crowd level does not move every queue in lockstep.
        ride_factor = rng.gauss(1.0, 0.12)
        peak = max(5.0, a.typical_peak_wait * crowd * ride_factor)

        # Breakdown schedule: low-capacity thrill rides break more often.
        downs: list[tuple[int, int]] = []
        if breakdowns:
            rate = {"low": 0.55, "medium": 0.3, "high": 0.12}[a.capacity_class]
            if a.type in {"coaster", "drop", "simulator"}:
                rate *= 1.5
            if rng.random() < rate:
                start = rng.randrange(open_min + 30, close_min - 30, STEP_MIN)
                dur = int(min(150, max(15, rng.lognormvariate(math.log(30), 0.6))))
                downs.append((start, start + dur))

        series: list[tuple[int, int | None]] = []
        noise = 0.0
        reopened_at: int | None = None
        for t in range(open_min, close_min + 1, STEP_MIN):
            down = any(s <= t < e for s, e in downs)
            if down:
                series.append((t, None))
                reopened_at = next((e for s, e in downs if s <= t < e), None)
                continue

            frac = (t - open_min) / total
            level = _interp(shape, frac) * peak

            # Guests scatter to the parade; queues away from it fall off.
            if parade_start <= t < parade_start + PARADE_LENGTH_MIN:
                level *= 0.72 if a.land in PARADE_ROUTE_LANDS else 0.88

            # A ride that just came back online absorbs the backed-up demand.
            if reopened_at is not None and 0 <= t - reopened_at < 45:
                level *= 1.0 + 0.45 * (1 - (t - reopened_at) / 45)

            # AR(1) noise: today's deviation remembers the last reading.
            noise = 0.72 * noise + rng.gauss(0.0, 0.13)
            wait = level * (1.0 + noise)

            # Parks post waits in 5-minute increments and never below 5.
            wait = max(0.0, wait)
            posted = int(round(wait / 5.0) * 5) if wait >= 5 else (5 if wait > 1 else 0)
            series.append((t, posted))

        traces[a.id] = series
    return traces


def observations_from_trace(
    traces: dict[str, list[tuple[int, int | None]]],
    catalog: Catalog,
    day: str,
    source: str = "simulated",
) -> list[Observation]:
    out = []
    for rid, series in traces.items():
        a = catalog.get(rid)
        if a is None:
            continue
        for minute, wait in series:
            out.append(Observation(
                obs_date=day, obs_minute=minute, attraction_id=rid, park=a.park,
                wait_min=wait, is_open=wait is not None, source=source,
            ))
    return out


class SimulatedSource:
    """Serves a pre-generated day one snapshot at a time.

    Useful for exercising the live planner end-to-end without a network, and
    for the backtester's "what the party could see at time t" view.
    """

    name = "simulated"

    def __init__(self, catalog: Catalog, traces: dict[str, list[tuple[int, int | None]]]):
        self.catalog = catalog
        self.traces = traces
        self._index = {
            rid: {m: w for m, w in series} for rid, series in traces.items()
        }

    def wait_at(self, rid: str, minute: int) -> int | None:
        """Latest posted wait at or before ``minute``. None means closed."""
        series = self.traces.get(rid)
        if not series:
            return None
        best: int | None = None
        found = False
        for m, w in series:
            if m > minute:
                break
            best, found = w, True
        return best if found else None

    def fetch(self, obs_date: str, obs_minute: int) -> list[Observation]:
        out = []
        for rid in self.traces:
            a = self.catalog.get(rid)
            if a is None:
                continue
            w = self.wait_at(rid, obs_minute)
            out.append(Observation(
                obs_date=obs_date, obs_minute=obs_minute, attraction_id=rid,
                park=a.park, wait_min=w, is_open=w is not None, source=self.name,
            ))
        return out
