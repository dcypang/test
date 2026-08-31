"""queue-times.com adapter.

Free, no API key, updated roughly every five minutes. Park ids are resolved
by name from /parks.json rather than hard-coded, because provider ids change.
"""

from __future__ import annotations

from ..model import Catalog
from ..store import Observation
from .base import Source, SourceError, get_json, match_attraction

BASE = "https://queue-times.com"

#: Substrings used to find the two Disneyland Paris parks in /parks.json.
PARK_NAME_HINTS = {
    "DLP": ("disneyland park", "paris"),
    "DAW": ("walt disney studios", "adventure world"),
}


class QueueTimesSource:
    name = "queue_times"

    def __init__(self, catalog: Catalog, park_ids: dict[str, int]):
        self.catalog = catalog
        self.park_ids = dict(park_ids)
        self._name_cache: dict[str, str | None] = {}

    # ---- id discovery -------------------------------------------------------

    def resolve_park_ids(self) -> dict[str, int]:
        """Look up the real park ids by name. Call this once and cache them."""
        data = get_json(f"{BASE}/parks.json")
        flat = []
        for company in data:
            for park in company.get("parks", []):
                flat.append((park["name"], park["id"], company.get("name", "")))
        resolved: dict[str, int] = {}
        for key, hints in PARK_NAME_HINTS.items():
            for pname, pid, company in flat:
                low = pname.lower()
                if any(h in low for h in hints) and "disney" in company.lower():
                    resolved[key] = pid
                    break
        if not resolved:
            raise SourceError("could not find Disneyland Paris parks in queue-times /parks.json")
        self.park_ids.update(resolved)
        return resolved

    # ---- fetching -----------------------------------------------------------

    def fetch(self, obs_date: str, obs_minute: int) -> list[Observation]:
        out: list[Observation] = []
        errors: list[str] = []
        for park_key, park_id in self.park_ids.items():
            try:
                data = get_json(f"{BASE}/parks/{park_id}/queue_times.json")
            except SourceError as e:
                errors.append(f"{park_key}: {e}")
                continue
            out.extend(self._parse(data, park_key, obs_date, obs_minute))
        if not out and errors:
            # Report why, rather than letting the caller assume the parks are
            # simply shut. This runs unattended for months; a silent failure
            # is a database with nothing in it come November.
            raise SourceError("; ".join(errors))
        return out

    def _parse(self, data: dict, park_key: str, obs_date: str,
               obs_minute: int) -> list[Observation]:
        rides = list(data.get("rides", []))
        for land in data.get("lands", []):
            rides.extend(land.get("rides", []))

        out = []
        for r in rides:
            rid = self._match(r.get("name", ""))
            if rid is None:
                continue
            is_open = bool(r.get("is_open"))
            wait = r.get("wait_time")
            out.append(Observation(
                obs_date=obs_date,
                obs_minute=obs_minute,
                attraction_id=rid,
                park=park_key,
                wait_min=int(wait) if is_open and wait is not None else None,
                is_open=is_open,
                source=self.name,
            ))
        return out

    def _match(self, api_name: str) -> str | None:
        if api_name not in self._name_cache:
            self._name_cache[api_name] = match_attraction(api_name, self.catalog)
        return self._name_cache[api_name]
