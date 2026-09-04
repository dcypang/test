"""Import real park geometry from OpenStreetMap.

The map shipped with this project is a schematic: lands sit at their true
compass bearings around the Central Plaza, which makes the map legible, but
the outlines are generated shapes rather than surveyed ones. OpenStreetMap has
excellent coverage of both Disneyland Paris parks — park boundaries, the lakes,
the path network and the attractions themselves — so this module pulls that in
and replaces the schematic wholesale.

    python3 -m dlp.cli import-map --dry-run    # see what Overpass returns
    python3 -m dlp.cli import-map              # write it into dlp/data/

Overpass is rate limited and occasionally busy. The importer tries the mirrors
in turn, validates what comes back before touching anything on disk, and
refuses to overwrite good data with a thin response.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any, Iterable

from .model import Catalog
from .sources.base import USER_AGENT, SourceError, match_attraction

DATA_DIR = Path(__file__).parent / "data"

#: Bounding box around the whole resort: south, west, north, east.
RESORT_BBOX = (48.8600, 2.7620, 48.8790, 2.7920)

MIRRORS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.osm.ch/api/interpreter",
)

#: Tags identifying each park, matched loosely against the name.
PARK_HINTS = {
    "DLP": ("disneyland park", "parc disneyland"),
    "DAW": ("walt disney studios", "adventure world"),
}

#: An import that finds less than this much is treated as a failure rather
#: than written over working data.
MIN_LANDS = 4
MIN_ATTRACTIONS = 12


def build_query(bbox: tuple[float, float, float, float] = RESORT_BBOX) -> str:
    b = ",".join(str(x) for x in bbox)
    return f"""
[out:json][timeout:180];
(
  way["tourism"="theme_park"]({b});
  relation["tourism"="theme_park"]({b});
  way["natural"="water"]({b});
  relation["natural"="water"]({b});
  way["leisure"="park"]["name"]({b});
  way["highway"~"^(footway|pedestrian|path)$"]({b});
  node["attraction"]({b});
  way["attraction"]({b});
  node["tourism"="attraction"]["name"]({b});
  way["tourism"="attraction"]["name"]({b});
);
out geom tags;
""".strip()


def fetch(query: str, timeout: int = 200, mirrors: Iterable[str] = MIRRORS) -> dict:
    """POST the query to each mirror in turn, returning the first success."""
    body = urllib.parse.urlencode({"data": query}).encode()
    errors = []
    for url in mirrors:
        req = urllib.request.Request(
            url, data=body,
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            errors.append(f"{url} -> HTTP {e.code}")
        except urllib.error.URLError as e:
            errors.append(f"{url} -> {e.reason}")
        except json.JSONDecodeError as e:
            errors.append(f"{url} -> malformed JSON: {e}")
    raise SourceError("every Overpass mirror failed: " + "; ".join(errors))


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------

@dataclass
class ImportResult:
    geometry: dict = field(default_factory=dict)
    positions: dict[str, tuple[float, float]] = field(default_factory=dict)
    unmatched: list[str] = field(default_factory=list)
    counts: dict[str, int] = field(default_factory=dict)

    def ok(self) -> bool:
        return (self.counts.get("lands", 0) >= MIN_LANDS
                and len(self.positions) >= MIN_ATTRACTIONS)

    def describe(self) -> str:
        c = self.counts
        lines = [
            f"  park outlines   {c.get('parks', 0)}",
            f"  themed lands    {c.get('lands', 0)}",
            f"  water bodies    {c.get('water', 0)}",
            f"  paths           {c.get('paths', 0)}",
            f"  attractions     {len(self.positions)} matched to the catalog",
        ]
        if self.unmatched:
            shown = ", ".join(self.unmatched[:6])
            more = f" (+{len(self.unmatched) - 6} more)" if len(self.unmatched) > 6 else ""
            lines.append(f"  unmatched OSM   {shown}{more}")
        return "\n".join(lines)


def _geom(el: dict) -> list[list[float]]:
    return [[round(p["lat"], 6), round(p["lon"], 6)] for p in el.get("geometry", [])]


def _centroid(el: dict) -> tuple[float, float] | None:
    if el.get("type") == "node" and "lat" in el:
        return round(el["lat"], 6), round(el["lon"], 6)
    pts = el.get("geometry") or []
    if not pts:
        return None
    return (round(sum(p["lat"] for p in pts) / len(pts), 6),
            round(sum(p["lon"] for p in pts) / len(pts), 6))


def _which_park(name: str, parks: dict[str, list[list[float]]]) -> str | None:
    """Assign a feature to a park by which outline centroid it sits nearest."""
    low = name.lower()
    for key, hints in PARK_HINTS.items():
        if any(h in low for h in hints):
            return key
    return None


def _nearest_park(point: tuple[float, float], centres: dict[str, tuple[float, float]]) -> str | None:
    if not centres:
        return None
    return min(centres, key=lambda k: (centres[k][0] - point[0]) ** 2
                                      + (centres[k][1] - point[1]) ** 2)


def parse(raw: dict, catalog: Catalog) -> ImportResult:
    """Turn an Overpass response into this project's geometry format."""
    elements = raw.get("elements", [])
    res = ImportResult()

    parks: dict[str, dict] = {}
    centres: dict[str, tuple[float, float]] = {}
    lands: list[dict] = []
    water: list[dict] = []
    paths: list[dict] = []
    candidates: list[tuple[str, tuple[float, float]]] = []

    # Pass 1: parks, so everything else can be assigned to one.
    for el in elements:
        tags = el.get("tags") or {}
        name = tags.get("name", "")
        if tags.get("tourism") == "theme_park" and name:
            key = _which_park(name, {})
            poly = _geom(el)
            if key and poly and key not in parks:
                parks[key] = {"name": name, "outline": poly}
                c = _centroid(el)
                if c:
                    centres[key] = c
                    parks[key]["hub"] = list(c)

    # Pass 2: everything else.
    for el in elements:
        tags = el.get("tags") or {}
        name = tags.get("name", "")
        c = _centroid(el)
        park = _nearest_park(c, centres) if c else None

        if tags.get("natural") == "water":
            poly = _geom(el)
            if len(poly) >= 4:
                water.append({"name": name or "Water", "park": park, "polygon": poly})
            continue

        if tags.get("highway") in {"footway", "pedestrian", "path"}:
            line = _geom(el)
            if len(line) >= 2:
                paths.append({"name": name, "park": park, "line": line})
            continue

        if tags.get("leisure") == "park" and name:
            poly = _geom(el)
            if len(poly) >= 4:
                lands.append({"name": name, "park": park, "polygon": poly})
            continue

        # Anything left with a name is a candidate attraction.
        if name and c and (tags.get("attraction") or tags.get("tourism") == "attraction"):
            candidates.append((name, c))

    # Match candidate attractions to the catalog by name.
    for name, point in candidates:
        rid = match_attraction(name, catalog)
        if rid and rid not in res.positions:
            res.positions[rid] = point
        elif not rid:
            res.unmatched.append(name)

    # Themed lands are often tagged as attractions rather than leisure=park;
    # promote any named area matching a land we know about.
    known_lands = {a.land for a in catalog}
    for el in elements:
        tags = el.get("tags") or {}
        name = tags.get("name", "")
        if not name or name not in known_lands:
            continue
        poly = _geom(el)
        if len(poly) < 4:
            continue
        if any(l["name"] == name for l in lands):
            continue
        c = _centroid(el)
        lands.append({"name": name, "park": _nearest_park(c, centres) if c else None,
                      "polygon": poly})

    res.geometry = {
        "_meta": {
            "source": "openstreetmap",
            "imported": date.today().isoformat(),
            "licence": "© OpenStreetMap contributors, ODbL",
            "note": "Surveyed geometry from OpenStreetMap via the Overpass API.",
        },
        "parks": parks,
        "lands": lands,
        "water": water,
        "paths": paths[:400],          # the full path network is enormous
        "landmarks": [],
    }
    res.counts = {"parks": len(parks), "lands": len(lands),
                  "water": len(water), "paths": len(paths)}
    return res


# ---------------------------------------------------------------------------
# Writing
# ---------------------------------------------------------------------------

def apply(result: ImportResult, *, geometry_path: Path | None = None,
          attractions_path: Path | None = None) -> dict:
    """Write imported geometry and attraction positions to disk."""
    if not result.ok():
        raise SourceError(
            f"import looks too thin to trust — {result.counts.get('lands', 0)} lands "
            f"and {len(result.positions)} matched attractions. Refusing to overwrite "
            f"the existing map. Re-run with --dry-run to inspect.")

    geometry_path = geometry_path or DATA_DIR / "park_geometry.json"
    attractions_path = attractions_path or DATA_DIR / "attractions.json"

    geometry_path.write_text(json.dumps(result.geometry, indent=1) + "\n")

    raw = json.loads(attractions_path.read_text())
    moved = 0
    for a in raw["attractions"]:
        pos = result.positions.get(a["id"])
        if pos and (a["lat"], a["lon"]) != pos:
            a["lat"], a["lon"] = pos
            moved += 1
    raw["_meta"]["coord_source"] = f"openstreetmap, imported {date.today().isoformat()}"
    raw["_meta"]["note"] = (
        "Attraction coordinates are from OpenStreetMap (© OpenStreetMap "
        "contributors, ODbL). Height limits are still approximations — verify "
        "them in the official Disneyland Paris app before the trip."
    )
    attractions_path.write_text(json.dumps(raw, indent=2) + "\n")
    return {"moved": moved, "not_found": [a["id"] for a in raw["attractions"]
                                          if a["id"] not in result.positions]}


def load_geometry(path: Path | None = None) -> dict | None:
    path = path or DATA_DIR / "park_geometry.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError:
        return None
