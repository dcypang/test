"""Domain objects: the attraction catalog, plan items, and a finished plan."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Iterable, Iterator

from .config import CHILD, DATA_DIR, PARENT_A, PARENT_B, TripConfig, fmt_minute

#: How a party got onto a ride. This is the mechanism that makes two
#: simultaneous queues possible, so it is tracked on every plan item.
QUEUE_MODES = ("standby", "premier", "single_rider", "rider_switch", "hold")


@dataclass(frozen=True)
class Attraction:
    id: str
    name: str
    park: str
    land: str
    lat: float
    lon: float
    duration_min: int
    type: str
    min_height_cm: int | None
    appeal: float
    premier_access: bool
    single_rider: bool
    typical_peak_wait: int
    capacity_class: str

    def admits(self, height_cm: int) -> bool:
        return self.min_height_cm is None or height_cm >= self.min_height_cm

    @property
    def is_experience(self) -> bool:
        """Shows and playgrounds are absorbing but do not behave like queues."""
        return self.type in {"show", "playground", "walkthrough"}


class Catalog:
    """The attraction list, filtered to what this particular party can use."""

    def __init__(self, attractions: Iterable[Attraction], meta: dict | None = None):
        self._by_id = {a.id: a for a in attractions}
        self.meta = meta or {}

    @classmethod
    def load(cls, path=None) -> "Catalog":
        path = Path(path) if path else DATA_DIR / "attractions.json"
        raw = json.loads(path.read_text())
        rides = [Attraction(**{k: v for k, v in a.items()}) for a in raw["attractions"]]
        return cls(rides, raw.get("_meta", {}))

    def __iter__(self) -> Iterator[Attraction]:
        return iter(self._by_id.values())

    def __len__(self) -> int:
        return len(self._by_id)

    def __contains__(self, rid: str) -> bool:
        return rid in self._by_id

    def __getitem__(self, rid: str) -> Attraction:
        return self._by_id[rid]

    def get(self, rid: str) -> Attraction | None:
        return self._by_id.get(rid)

    def ids(self) -> list[str]:
        return list(self._by_id)

    def in_park(self, park: str) -> list[Attraction]:
        return [a for a in self if a.park == park]

    def for_trip(self, cfg: TripConfig) -> "Catalog":
        """Drop skipped attractions and anything nobody in the party can ride."""
        keep = []
        for a in self:
            if a.id in cfg.skip:
                continue
            # An attraction is useful if the child can ride it, or if it is a
            # thrill ride a parent can ride alone while the others are busy.
            if a.admits(cfg.party.child_height_cm) or a.min_height_cm is not None:
                keep.append(a)
        return Catalog(keep, self.meta)


@dataclass(frozen=True)
class PlanItem:
    """One scheduled activity on one of the two parallel tracks."""

    kind: str                 # "ride" | "walk" | "break" | "meal" | "book_pa" | "idle"
    ride_id: str | None
    name: str
    park: str
    land: str
    group: int                # bitmask of party members involved
    start: int                # minutes since midnight: leaves for the attraction
    board: int                # minutes since midnight: gets on
    end: int                  # minutes since midnight: finished
    mode: str                 # one of QUEUE_MODES, or "" for non-ride items
    predicted_wait: int = 0
    actual_wait: int | None = None
    track: int = 0            # 0 = family track, 1 = free-parent track
    value: float = 0.0
    walk_min: int = 0         # of start..board, how much was spent walking
    walk_m: int = 0           # ground actually covered getting here
    #: For a "book_pa" item, the start of the return window that was secured.
    return_minute: int | None = None

    @property
    def wait_min(self) -> int:
        return max(0, self.board - self.start - self.walk_min)

    @property
    def duration(self) -> int:
        return self.end - self.start

    def members(self) -> list[str]:
        out = []
        if self.group & PARENT_A:
            out.append("Parent A")
        if self.group & PARENT_B:
            out.append("Parent B")
        if self.group & CHILD:
            out.append("Child")
        return out

    def to_dict(self) -> dict:
        return {
            "kind": self.kind,
            "ride_id": self.ride_id,
            "name": self.name,
            "park": self.park,
            "land": self.land,
            "group": self.group,
            "members": self.members(),
            "start": self.start,
            "board": self.board,
            "end": self.end,
            "start_hhmm": fmt_minute(self.start),
            "board_hhmm": fmt_minute(self.board),
            "end_hhmm": fmt_minute(self.end),
            "mode": self.mode,
            "predicted_wait": self.predicted_wait,
            "actual_wait": self.actual_wait,
            "wait_min": self.wait_min,
            "walk_min": self.walk_min,
            "walk_m": self.walk_m,
            "track": self.track,
            "value": round(self.value, 3),
        }


@dataclass
class Plan:
    """A full day: two parallel tracks of activity plus scoring summary."""

    items: list[PlanItem] = field(default_factory=list)
    value: float = 0.0
    notes: list[str] = field(default_factory=list)

    def rides(self, track: int | None = None) -> list[PlanItem]:
        return [
            i for i in self.items
            if i.kind == "ride" and (track is None or i.track == track)
        ]

    def child_rides(self) -> list[PlanItem]:
        return [i for i in self.rides() if i.group & CHILD]

    def distinct_child_rides(self) -> set[str]:
        return {i.ride_id for i in self.child_rides() if i.ride_id}

    def total_wait(self) -> int:
        """Wall-clock queueing on the family track. The free parent's queueing
        happens in parallel, so counting it would double-count the day."""
        return sum(i.wait_min for i in self.rides(track=0))

    def total_parallel_wait(self) -> int:
        return sum(i.wait_min for i in self.rides())

    def parallel_minutes(self) -> int:
        """Minutes spent queueing for two *different* attractions at once.

        This is the payoff from being able to hold two places in line, so the
        free parent standing in the same queue as the family does not count --
        that is one queue with three people in it, not two queues.
        """
        t0 = [(i.start + i.walk_min, i.board, i.ride_id) for i in self.rides(track=0)]
        t1 = [(i.start + i.walk_min, i.board, i.ride_id) for i in self.rides(track=1)]
        total = 0
        for a0, b0, r0 in t0:
            for a1, b1, r1 in t1:
                if r0 == r1:
                    continue
                total += max(0, min(b0, b1) - max(a0, a1))
        return total

    def summary(self, cfg: TripConfig) -> dict:
        child = self.child_rides()
        must = set(cfg.must_do)
        done = self.distinct_child_rides()
        return {
            "value": round(self.value, 2),
            "family_track_rides": len(self.rides(track=0)),
            "free_parent_rides": len(self.rides(track=1)),
            "child_rides": len(child),
            "distinct_child_rides": len(done),
            "must_do_hit": sorted(must & done),
            "must_do_missed": sorted(must - done),
            "family_queue_min": self.total_wait(),
            "parallel_queue_min": self.total_parallel_wait(),
            "overlapped_queue_min": self.parallel_minutes(),
            "walk_min": sum(i.walk_min for i in self.items),
            "walk_km": round(sum(i.walk_m for i in self.items) / 1000.0, 1),
            "child_walk_km": round(
                sum(i.walk_m for i in self.rides(track=0)) / 1000.0, 1),
            "premier_access_used": sum(1 for i in self.items if i.kind == "book_pa"),
            "premier_access_redeemed": sum(1 for i in self.rides() if i.mode == "premier"),
            "single_rider_used": sum(1 for i in self.rides() if i.mode == "single_rider"),
            "first_item": fmt_minute(self.items[0].start) if self.items else None,
            "last_item": fmt_minute(max(i.end for i in self.items)) if self.items else None,
        }

    def to_dict(self, cfg: TripConfig) -> dict:
        return {
            "summary": self.summary(cfg),
            "items": [i.to_dict() for i in sorted(self.items, key=lambda i: (i.start, i.track))],
            "notes": self.notes,
        }


@lru_cache(maxsize=1)
def default_catalog() -> Catalog:
    return Catalog.load()
