"""Trip configuration for the Disneyland Paris ride-order optimiser.

Everything a family needs to change lives in this file (or in a JSON file
passed with --config). The defaults describe the trip this project was built
for: two parents and one child at Disneyland Paris on 27 November 2026.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field, replace
from datetime import date
from pathlib import Path
from typing import Any

DATA_DIR = Path(__file__).parent / "data"

# Party member bit positions. The optimiser passes groups around as small
# integer bitmasks so that state hashing stays cheap inside the beam search.
PARENT_A = 1
PARENT_B = 2
CHILD = 4
FAMILY = PARENT_A | CHILD          # the adult who is chaperoning the child
EVERYONE = PARENT_A | PARENT_B | CHILD


@dataclass(frozen=True)
class Party:
    """Who is in the group and what the child is physically able to ride."""

    adults: int = 2
    children: int = 1
    #: Child height in centimetres. CHECK THIS BEFORE THE TRIP -- it decides
    #: which attractions the optimiser is allowed to put the child on, and at
    #: 110cm the party is only 3cm clear of Crush's Coaster and 8cm clear of
    #: the 102cm rides. Measure in the shoes he will actually wear.
    child_height_cm: int = 110
    #: Rough stamina budget. Once the child has spent this many minutes on
    #: foot, every further walking minute is charged at
    #: ``Strategy.tired_child_penalty_per_min``, so late in the day the
    #: planner stops sending them across the park for a marginal ride.
    child_stamina_min: int = 180
    #: Walking speed in metres per second for a group that includes the child.
    walk_speed_family_mps: float = 0.85
    #: Walking speed for a lone adult moving with purpose.
    walk_speed_adult_mps: float = 1.30


@dataclass(frozen=True)
class Strategy:
    """Knobs that decide what the optimiser is allowed to do.

    ``parallel_queues`` is the headline feature: the family can occupy two
    queues at the same time because the second parent is free to queue
    separately. Which mechanisms count as a legitimate second queue is up to
    you -- turn off anything your party would not actually do.
    """

    #: How many attractions the party can be queueing for simultaneously.
    parallel_queues: int = 2
    #: Free parent physically holds a standby place and the rest of the family
    #: joins them near the front. Disneyland Paris does not officially permit
    #: this; leave it on only if your party intends to do it.
    allow_standby_hold: bool = False
    #: Free parent rides alone via the Single Rider queue while the family
    #: rides something else. Always legitimate.
    allow_single_rider: bool = True
    #: Rider Switch / baby swap on height-restricted attractions: one parent
    #: waits with the child, then swaps without re-queueing. Officially
    #: supported at Disneyland Paris.
    allow_rider_switch: bool = True
    #: Premier Access purchases the party is willing to make across the day.
    #: A Premier Access booking is a genuine second queue: you hold a return
    #: window while standing in a standby line for something else.
    premier_access_budget: int = 4
    #: Minutes of standby wait a Premier Access purchase must save before the
    #: optimiser considers it worth the money.
    premier_access_min_saving: int = 25
    #: Minutes between the party's re-plans during the day.
    replan_interval_min: int = 20
    #: Beam width for the planner. Higher is slower and slightly better.
    beam_width: int = 260
    #: Beam width for mid-day replans. Deliberately smaller: a replan runs
    #: dozens of times a day and only the next move has to be right.
    replan_beam_width: int = 70
    #: Value multiplier for a ride the child experiences vs. an adult-only ride.
    child_value_weight: float = 2.0
    adult_solo_value_weight: float = 0.35
    #: Each repeat of the same attraction is worth this fraction of the last.
    repeat_decay: float = 0.35
    #: Penalty per minute spent walking, in units of ride value.
    #:
    #: Deliberately small, and worth understanding before you raise it.
    #: Walking is already paid for twice over: travel time is consumed by the
    #: schedule (you cannot be in two places at once), and the planner ranks
    #: candidates by value per minute *including* the walk, so it already
    #: prefers the nearer ride. Measured over several simulated days, moving
    #: this knob from 0 to 0.05 changes the distance walked by under 100
    #: metres out of ~5km -- the route is already about as tight as the
    #: geography allows. What it really trades is ride count against time on
    #: foot: at 0 the child gets ~21.7 rides and walks ~306 minutes, at 0.012
    #: it is ~20.3 rides and ~269 minutes. Raise it if you would rather have a
    #: calmer day than one more attraction.
    walk_penalty_per_min: float = 0.004
    #: Extra penalty per walking minute once the child is past their stamina
    #: budget, so late in the day a marginal ride across the park stops being
    #: worth it. A tiebreaker rather than a dominant term -- it only visibly
    #: bites when the stamina budget is set low.
    tired_child_penalty_per_min: float = 0.09
    #: Penalty per minute spent queueing.
    queue_penalty_per_min: float = 0.004


@dataclass(frozen=True)
class TripConfig:
    trip_date: date = date(2026, 11, 27)
    party: Party = field(default_factory=Party)
    strategy: Strategy = field(default_factory=Strategy)

    #: Park operating hours, local time, as (open, close) "HH:MM" strings.
    #: Seeded with a typical late-November Disneyland Paris schedule. Refresh
    #: with `python3 -m dlp.cli sync-hours` before the trip.
    hours: dict[str, tuple[str, str]] = field(
        default_factory=lambda: {"DLP": ("09:30", "22:00"), "DAW": ("09:30", "20:00")}
    )
    #: Extra Magic Time for on-site hotel guests, if the party has it.
    extra_magic_time: bool = False
    extra_magic_open: str = "08:30"
    #: Which park the party enters first. "DLP", "DAW", or "auto" to let the
    #: optimiser choose.
    start_park: str = "auto"
    #: Attractions the party will not leave without. These get a large value
    #: bonus, so the planner treats missing one as a failure.
    must_do: tuple[str, ...] = ("ratatouille", "big_thunder", "peter_pan", "pirates", "meet_mickey")
    #: Attractions to exclude entirely (closed, or nobody wants them).
    skip: tuple[str, ...] = ()
    #: Per-attraction appeal overrides, 0-10. Anything absent uses the catalog.
    appeal_overrides: dict[str, float] = field(default_factory=dict)
    #: Sit-down meal: (earliest "HH:MM", latest "HH:MM", minutes). The planner
    #: must fit one lunch inside the window.
    lunch_window: tuple[str, str, int] = ("11:45", "14:30", 50)
    #: An afternoon rest, or None. Very valuable with a young child.
    afternoon_break_min: int = 0

    # ---- Data source wiring -------------------------------------------------
    #: queue-times.com park ids. Resolved by name on `sync-catalog`; these are
    #: only a starting guess.
    queue_times_park_ids: dict[str, int] = field(
        default_factory=lambda: {"DLP": 4, "DAW": 28}
    )
    #: themeparks.wiki v1 park entity ids. Also resolved by name on sync.
    themeparks_park_ids: dict[str, str] = field(
        default_factory=lambda: {
            "DLP": "dae968d5-630d-4719-8b06-3d107e944401",
            "DAW": "ca888437-ebb4-4d50-aed2-d227f7096968",
        }
    )
    poll_interval_sec: int = 300
    db_path: str = "waits.sqlite3"

    # ---- Helpers ------------------------------------------------------------

    def open_minute(self, park: str) -> int:
        """Park opening as minutes since midnight, honouring Extra Magic Time."""
        if self.extra_magic_time:
            return _hhmm(self.extra_magic_open)
        return _hhmm(self.hours[park][0])

    def close_minute(self, park: str) -> int:
        return _hhmm(self.hours[park][1])

    def day_start(self) -> int:
        return min(self.open_minute(p) for p in self.hours)

    def day_end(self) -> int:
        return max(self.close_minute(p) for p in self.hours)

    def with_overrides(self, **kw: Any) -> "TripConfig":
        return replace(self, **kw)

    @classmethod
    def load(cls, path: str | Path | None) -> "TripConfig":
        """Load a config, overlaying a JSON file on top of the defaults."""
        cfg = cls()
        if path is None:
            return cfg
        raw = json.loads(Path(path).read_text())
        if "trip_date" in raw:
            raw["trip_date"] = date.fromisoformat(raw.pop("trip_date"))
        if "party" in raw:
            cfg = replace(cfg, party=Party(**raw.pop("party")))
        if "strategy" in raw:
            cfg = replace(cfg, strategy=Strategy(**raw.pop("strategy")))
        for key in ("must_do", "skip"):
            if key in raw:
                raw[key] = tuple(raw[key])
        if "hours" in raw:
            raw["hours"] = {k: tuple(v) for k, v in raw["hours"].items()}
        if "lunch_window" in raw:
            raw["lunch_window"] = tuple(raw["lunch_window"])
        return replace(cfg, **raw)


def _hhmm(s: str) -> int:
    h, m = s.split(":")
    return int(h) * 60 + int(m)


def fmt_minute(m: int) -> str:
    """Render minutes-since-midnight as HH:MM, wrapping past midnight."""
    m = int(round(m)) % (24 * 60)
    return f"{m // 60:02d}:{m % 60:02d}"
