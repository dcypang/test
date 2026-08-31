"""Walking times between attractions.

Straight-line distance underestimates park walking badly: paths curve around
lakes, buildings and queues. We apply a detour factor, a per-land-change
penalty for the crowd friction at land boundaries, and a much larger penalty
for hopping between the two parks (esplanade walk plus a bag check).
"""

from __future__ import annotations

import math

from .model import Catalog

#: Real walking paths are longer than the crow flies. 1.35 is a good fit for
#: theme parks, where the hub-and-spoke layout forces you through choke points.
DETOUR_FACTOR = 1.35
#: Minutes added when a route crosses from one themed land into another.
LAND_CHANGE_PENALTY = 1.5
#: Minutes to cross between Disneyland Park and the Studios, including the
#: walk down Main Street, the esplanade, and security.
PARK_HOP_PENALTY = 14.0
#: Everyone starts at the main entrance turnstiles.
ENTRANCE_LAT, ENTRANCE_LON = 48.86930, 2.77650


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6_371_000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


class WalkMatrix:
    """Pairwise walking times in minutes, for a family pace and an adult pace."""

    ENTRANCE = "__entrance__"

    def __init__(self, catalog: Catalog, family_mps: float, adult_mps: float):
        self.catalog = catalog
        self.family_mps = family_mps
        self.adult_mps = adult_mps
        self._points: dict[str, tuple[float, float, str, str]] = {
            a.id: (a.lat, a.lon, a.park, a.land) for a in catalog
        }
        self._points[self.ENTRANCE] = (ENTRANCE_LAT, ENTRANCE_LON, "DLP", "Main Street U.S.A.")
        self._cache: dict[tuple[str, str, bool], float] = {}

    def _leg(self, a: str, b: str) -> tuple[float, float]:
        """Return (metres, fixed_penalty_minutes) for the leg a -> b."""
        lat1, lon1, park1, land1 = self._points[a]
        lat2, lon2, park2, land2 = self._points[b]
        metres = haversine_m(lat1, lon1, lat2, lon2) * DETOUR_FACTOR
        penalty = 0.0
        if park1 != park2:
            penalty += PARK_HOP_PENALTY
        elif land1 != land2:
            penalty += LAND_CHANGE_PENALTY
        return metres, penalty

    def minutes(self, a: str, b: str, with_child: bool = True) -> float:
        if a == b:
            return 0.0
        key = (a, b, with_child)
        hit = self._cache.get(key)
        if hit is not None:
            return hit
        metres, penalty = self._leg(a, b)
        speed = self.family_mps if with_child else self.adult_mps
        val = metres / speed / 60.0 + penalty
        self._cache[key] = val
        return val

    def int_minutes(self, a: str, b: str, with_child: bool = True) -> int:
        return int(math.ceil(self.minutes(a, b, with_child)))

    def nearest(self, origin: str, candidates: list[str], with_child: bool = True) -> list[str]:
        return sorted(candidates, key=lambda c: self.minutes(origin, c, with_child))
