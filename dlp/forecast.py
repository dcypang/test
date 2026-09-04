"""Predicting what a queue will look like when you get there.

Planning against the wait posted *right now* is the classic mistake: by the
time you have walked across the park and stood in line, that number is
forty minutes old. The optimiser needs wait(ride, t) for t up to an hour
ahead, so this module builds one.

The model has three parts.

1. **A shape prior.** Every ride has a characteristic curve across the
   operating day. It comes from banked history when the collector has enough
   of it, and falls back to the class-based curves in ``sources.simulator``.

2. **A day-level crowd anchor.** Comparing every live reading against its
   prior gives one robust multiplier for how busy today is. A single ride's
   reading is noisy; forty rides together are not.

3. **A per-ride correction that decays.** A ride running unusually long
   right now (a breakdown recovery, a bus of school kids) stays unusual for
   a while, then reverts to the day-level anchor. The correction decays with
   a half-life so short horizons trust the live number and long horizons
   trust the curve.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from .config import TripConfig
from .model import Attraction, Catalog
from .sources.simulator import SHAPES, _interp, ride_class
from .store import Store

#: Half-life, in minutes, of a ride's live deviation from its prior.
DEVIATION_HALF_LIFE = 55.0
#: Posted waits at Disney parks are padded. Actual time in line is typically
#: this fraction of the posted figure.
POSTED_BIAS = 0.90
#: A ride that is down has this chance per 10 minutes of coming back.
REOPEN_RATE_PER_10MIN = 0.28
#: Minimum wait the model will ever predict for an operating attraction.
MIN_WAIT = 5


@dataclass
class RidePrior:
    """The expected shape of one ride's queue across the operating day."""

    ride_id: str
    peak_wait: float
    shape: list[tuple[float, float]]
    from_history: bool = False

    def level(self, minute: int, open_min: int, close_min: int) -> float:
        total = max(1, close_min - open_min)
        frac = (minute - open_min) / total
        return max(1.0, _interp(self.shape, min(1.0, max(0.0, frac))) * self.peak_wait)


@dataclass
class Forecaster:
    """Turns a live snapshot into wait predictions at arbitrary future times."""

    catalog: Catalog
    cfg: TripConfig
    priors: dict[str, RidePrior] = field(default_factory=dict)
    #: {ride_id: (minute_observed, posted_wait_or_None)}
    snapshot: dict[str, tuple[int, int | None]] = field(default_factory=dict)
    crowd_anchor: float = 1.0
    _deviation: dict[str, float] = field(default_factory=dict, repr=False)
    #: Predictions are asked for the same (ride, roughly-this-minute) pair
    #: thousands of times per search, so they are memoised at 5-minute
    #: granularity and dropped whenever new readings arrive.
    _cache: dict = field(default_factory=dict, repr=False)

    # ---- construction -------------------------------------------------------

    @classmethod
    def from_catalog(cls, catalog: Catalog, cfg: TripConfig,
                     store: Store | None = None) -> "Forecaster":
        priors = {}
        for a in catalog:
            priors[a.id] = _prior_for(a, cfg, store)
        return cls(catalog=catalog, cfg=cfg, priors=priors)

    # ---- live data ----------------------------------------------------------

    def observe(self, snapshot: dict[str, tuple[int, int | None]]) -> None:
        """Feed in the newest readings and re-fit the crowd anchor.

        ``snapshot`` maps ride id to (minute the reading was taken, posted
        wait) with ``None`` for a ride that is down.
        """
        self.snapshot = dict(snapshot)
        self._cache.clear()
        ratios: list[float] = []
        self._deviation = {}
        for rid, (minute, wait) in snapshot.items():
            prior = self.priors.get(rid)
            if prior is None or wait is None or wait <= 0:
                continue
            a = self.catalog.get(rid)
            if a is None:
                continue
            expected = prior.level(minute, self.cfg.open_minute(a.park),
                                   self.cfg.close_minute(a.park))
            if expected <= 0:
                continue
            ratio = wait / expected
            # Clamp before averaging so one broken ride cannot drag the day.
            ratios.append(max(0.25, min(4.0, ratio)))
            self._deviation[rid] = ratio

        if ratios:
            # Geometric mean: multiplicative errors, so average in log space.
            self.crowd_anchor = math.exp(sum(math.log(r) for r in ratios) / len(ratios))
        else:
            self.crowd_anchor = 1.0

    # ---- prediction ---------------------------------------------------------

    def predict(self, ride_id: str, at_minute: int) -> float:
        """Predicted *posted* wait for ``ride_id`` at ``at_minute``."""
        prior = self.priors.get(ride_id)
        a = self.catalog.get(ride_id)
        if prior is None or a is None:
            return 30.0

        base = prior.level(at_minute, self.cfg.open_minute(a.park),
                           self.cfg.close_minute(a.park))

        obs = self.snapshot.get(ride_id)
        if obs is None:
            return max(MIN_WAIT, base * self.crowd_anchor)

        obs_minute, obs_wait = obs
        horizon = max(0, at_minute - obs_minute)
        # Weight on the ride's own deviation, decaying toward the day anchor.
        w = 0.5 ** (horizon / DEVIATION_HALF_LIFE)
        dev = self._deviation.get(ride_id, self.crowd_anchor)
        if obs_wait is None:
            # Ride is down. Its own reading tells us nothing about the level,
            # so fall back to the day anchor once it is expected back.
            dev = self.crowd_anchor
            w = 0.0
        multiplier = math.exp(w * math.log(max(0.1, dev))
                              + (1 - w) * math.log(max(0.1, self.crowd_anchor)))
        return max(MIN_WAIT, base * multiplier)

    def actual_wait_min(self, posted: float) -> float:
        """Convert a posted figure into expected minutes actually standing."""
        return posted * POSTED_BIAS

    def availability(self, ride_id: str, at_minute: int) -> float:
        """Probability the ride is operating at ``at_minute`` (0..1)."""
        obs = self.snapshot.get(ride_id)
        if obs is None:
            return 0.97
        obs_minute, obs_wait = obs
        if obs_wait is not None:
            return 0.97
        # Currently down: the chance it is back rises with the gap.
        gap = max(0, at_minute - obs_minute)
        return 1.0 - (1.0 - REOPEN_RATE_PER_10MIN) ** (gap / 10.0)

    def expected_queue_min(self, ride_id: str, arrive_minute: int) -> float:
        """Minutes of queueing to expect for arriving at ``arrive_minute``.

        Blends the posted-wait bias with the chance the ride is down, which
        the optimiser treats as a large effective penalty rather than a hard
        exclusion so it will still route past a ride that may recover.
        """
        key = (ride_id, int(arrive_minute) // 5)
        hit = self._cache.get(key)
        if hit is not None:
            return hit
        posted = self.predict(ride_id, arrive_minute)
        avail = self.availability(ride_id, arrive_minute)
        wait = self.actual_wait_min(posted)
        if avail < 0.96:
            # Expected extra standing around, waiting for it to reopen.
            wait += (1 - avail) * 45.0
        self._cache[key] = wait
        return wait

    def single_rider_wait(self, ride_id: str, at_minute: int) -> float | None:
        """Estimated single-rider queue, or None if the ride has no such line.

        Single rider typically runs at 25-40% of standby, but it stops being
        much of a shortcut once standby itself is short.
        """
        a = self.catalog.get(ride_id)
        if a is None or not a.single_rider:
            return None
        standby = self.predict(ride_id, at_minute)
        return max(MIN_WAIT, min(standby, standby * 0.33 + 5))

    def premier_return(self, ride_id: str, book_minute: int) -> tuple[int, float] | None:
        """(earliest return minute, wait once you return) for Premier Access.

        Return windows drift later through the day as inventory sells; this
        approximates that with a lead time proportional to current demand.
        """
        a = self.catalog.get(ride_id)
        if a is None or not a.premier_access:
            return None
        standby = self.predict(ride_id, book_minute)
        lead = int(min(180, 20 + 0.55 * standby))
        return book_minute + lead, min(20.0, 5 + 0.12 * standby)


def _prior_for(a: Attraction, cfg: TripConfig, store: Store | None) -> RidePrior:
    """Build a ride's prior from banked history, falling back to its class."""
    shape = SHAPES[ride_class(a)]
    peak = float(a.typical_peak_wait)

    if store is not None:
        profile = store.history_profile(a.id, weekday=cfg.trip_date.weekday(),
                                        month=cfg.trip_date.month)
        # Require enough buckets to cover a plausible operating day before
        # trusting history over the class curve.
        if len(profile) >= 24:
            open_min = cfg.open_minute(a.park)
            close_min = cfg.close_minute(a.park)
            total = max(1, close_min - open_min)
            observed_peak = max(v for _, v in profile)
            if observed_peak > 0:
                pts = sorted(
                    ((minute - open_min) / total, value / observed_peak)
                    for minute, value in profile
                )
                pts = [(max(0.0, min(1.0, x)), y) for x, y in pts]
                return RidePrior(a.id, observed_peak, pts, from_history=True)

    return RidePrior(a.id, peak, shape, from_history=False)
