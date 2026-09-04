"""themeparks.wiki v1 adapter.

Richer than queue-times: it carries attraction coordinates, park opening
hours, and single-rider / Premier Access queue times as separate figures.
The optimiser uses those extra queues directly, so this is the preferred
source when it is reachable.
"""

from __future__ import annotations

from ..model import Catalog
from ..store import Observation
from .base import SourceError, get_json, match_attraction

BASE = "https://api.themeparks.wiki/v1"
#: Disneyland Paris destination slug used to discover park entity ids.
DESTINATION_HINT = "disneyland paris"
PARK_NAME_HINTS = {
    "DLP": ("disneyland park",),
    "DAW": ("walt disney studios", "adventure world"),
}


class ThemeParksWikiSource:
    name = "themeparks_wiki"

    def __init__(self, catalog: Catalog, park_ids: dict[str, str]):
        self.catalog = catalog
        self.park_ids = dict(park_ids)
        self._name_cache: dict[str, str | None] = {}
        #: Populated by fetch(): {attraction_id: {"single_rider": n, "premier": n}}
        self.alt_queues: dict[str, dict[str, int]] = {}

    # ---- id discovery -------------------------------------------------------

    def resolve_park_ids(self) -> dict[str, str]:
        data = get_json(f"{BASE}/destinations")
        dest = None
        for d in data.get("destinations", []):
            if DESTINATION_HINT in d.get("name", "").lower():
                dest = d
                break
        if dest is None:
            raise SourceError("Disneyland Paris not found in themeparks.wiki destinations")
        resolved: dict[str, str] = {}
        for key, hints in PARK_NAME_HINTS.items():
            for park in dest.get("parks", []):
                if any(h in park.get("name", "").lower() for h in hints):
                    resolved[key] = park["id"]
                    break
        self.park_ids.update(resolved)
        return resolved

    def park_hours(self, park_key: str, day: str) -> tuple[int, int] | None:
        """(open, close) as minutes since midnight for ``day`` (YYYY-MM-DD)."""
        pid = self.park_ids.get(park_key)
        if not pid:
            return None
        data = get_json(f"{BASE}/entity/{pid}/schedule")
        for entry in data.get("schedule", []):
            if entry.get("date") == day and entry.get("type") == "OPERATING":
                return _clock(entry.get("openingTime")), _clock(entry.get("closingTime"))
        return None

    def attraction_locations(self) -> dict[str, tuple[float, float]]:
        """Real lat/lon per matched attraction, for refreshing the map seed."""
        out: dict[str, tuple[float, float]] = {}
        for pid in self.park_ids.values():
            data = get_json(f"{BASE}/entity/{pid}/children")
            for child in data.get("children", []):
                if child.get("entityType") != "ATTRACTION":
                    continue
                loc = child.get("location") or {}
                lat, lon = loc.get("latitude"), loc.get("longitude")
                if lat is None or lon is None:
                    continue
                rid = self._match(child.get("name", ""))
                if rid:
                    out[rid] = (float(lat), float(lon))
        return out

    # ---- fetching -----------------------------------------------------------

    def fetch(self, obs_date: str, obs_minute: int) -> list[Observation]:
        out: list[Observation] = []
        errors: list[str] = []
        self.alt_queues = {}
        for park_key, pid in self.park_ids.items():
            try:
                data = get_json(f"{BASE}/entity/{pid}/live")
            except SourceError as e:
                errors.append(f"{park_key}: {e}")
                continue
            out.extend(self._parse(data, park_key, obs_date, obs_minute))
        if not out and errors:
            # Say why. A silent failure here means an empty database in
            # November, by which point it is too late to notice.
            raise SourceError("; ".join(errors))
        return out

    def _parse(self, data: dict, park_key: str, obs_date: str,
               obs_minute: int) -> list[Observation]:
        out = []
        for item in data.get("liveData", []):
            if item.get("entityType") != "ATTRACTION":
                continue
            rid = self._match(item.get("name", ""))
            if rid is None:
                continue
            status = (item.get("status") or "").upper()
            is_open = status == "OPERATING"
            queue = item.get("queue") or {}
            standby = (queue.get("STANDBY") or {}).get("waitTime")

            alts: dict[str, int] = {}
            sr = (queue.get("SINGLE_RIDER") or {}).get("waitTime")
            if sr is not None:
                alts["single_rider"] = int(sr)
            pa = queue.get("PAID_RETURN_TIME") or queue.get("RETURN_TIME") or {}
            pa_start = pa.get("returnStart")
            if pa_start:
                alts["premier_return"] = _clock(pa_start)
            if alts:
                self.alt_queues[rid] = alts

            out.append(Observation(
                obs_date=obs_date,
                obs_minute=obs_minute,
                attraction_id=rid,
                park=park_key,
                wait_min=int(standby) if is_open and standby is not None else None,
                is_open=is_open,
                source=self.name,
            ))
        return out

    def _match(self, api_name: str) -> str | None:
        if api_name not in self._name_cache:
            self._name_cache[api_name] = match_attraction(api_name, self.catalog)
        return self._name_cache[api_name]


def _clock(iso: str | None) -> int:
    """Minutes since local midnight from an ISO-8601 timestamp with offset."""
    if not iso:
        return 0
    time_part = iso.split("T", 1)[-1]
    hh, mm = time_part[:2], time_part[3:5]
    try:
        return int(hh) * 60 + int(mm)
    except ValueError:
        return 0
