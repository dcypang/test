"""Generate a schematic but geographically faithful map of both parks.

Disneyland Park is a hub-and-spoke design: a circular berm with Main Street
running north from the entrance to a Central Plaza, the castle on the plaza's
north side, and the themed lands fanning out as sectors around it. That
topology is public knowledge and is what makes the park legible on a map, so
the geometry here is *generated* from it rather than typed in by hand: lands
are annular sectors at their real compass bearings, and every attraction is
placed by (bearing, radius) inside its own land.

The result is a schematic in the way a park guide map is a schematic. It is
NOT survey data, and it is labelled as such everywhere it surfaces. Run
`python3 -m dlp.cli import-map` to replace all of it with real OpenStreetMap
geometry.

    python3 tools/make_schematic_map.py        # rewrites data files in place
"""

from __future__ import annotations

import json
import math
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "dlp" / "data"

# ---------------------------------------------------------------------------
# Frames of reference
# ---------------------------------------------------------------------------
# Disneyland Park: circular, hub-and-spoke, entrance to the south.
DLP_HUB = (48.87185, 2.77570)     # Central Plaza
DLP_RADIUS_M = 430                 # berm / railroad loop

# Walt Disney Studios: rectangular, entrance on its western side, south-east
# of Disneyland Park across the Esplanade. Placed so the two park outlines
# clear each other -- in the real resort they are separated by the Esplanade,
# and overlapping boundaries would be nonsense.
DAW_CENTRE = (48.86470, 2.78250)

M_PER_DEG_LAT = 111_320.0


def _m_per_deg_lon(lat: float) -> float:
    return M_PER_DEG_LAT * math.cos(math.radians(lat))


def offset(origin, east_m, north_m):
    """Move a lat/lon by a metre offset."""
    lat, lon = origin
    return (round(lat + north_m / M_PER_DEG_LAT, 6),
            round(lon + east_m / _m_per_deg_lon(lat), 6))


def polar(origin, bearing_deg, radius_m):
    """Place a point at a compass bearing (0=N, 90=E) and distance."""
    a = math.radians(bearing_deg)
    return offset(origin, radius_m * math.sin(a), radius_m * math.cos(a))


def sector(origin, b0, b1, r_in, r_out, step=4):
    """An annular sector polygon — one themed land."""
    if b1 <= b0:
        b1 += 360
    outer = [polar(origin, b, r_out) for b in _arc(b0, b1, step)]
    inner = [polar(origin, b, r_in) for b in reversed(list(_arc(b0, b1, step)))]
    return outer + inner


def _arc(b0, b1, step):
    n = max(2, int((b1 - b0) / step) + 1)
    return [b0 + (b1 - b0) * i / (n - 1) for i in range(n)]


def circle(origin, r_m, step=10):
    return [polar(origin, b, r_m) for b in range(0, 360, step)]


def rect(centre, x0, x1, y0, y1):
    """Axis-aligned rectangle in metres east/north of a centre point."""
    return [offset(centre, x0, y0), offset(centre, x1, y0),
            offset(centre, x1, y1), offset(centre, x0, y1)]


# ---------------------------------------------------------------------------
# Disneyland Park — lands as sectors at their real bearings
# ---------------------------------------------------------------------------
# Main Street runs due south from the hub; Adventureland sits south-west,
# Frontierland west and north-west, Fantasyland behind the castle to the
# north, Discoveryland to the east.
DLP_LANDS = [
    ("Main Street U.S.A.", 164, 196, 70, 400),
    ("Adventureland",      196, 256, 80, 405),
    ("Frontierland",       256, 331, 80, 425),
    ("Fantasyland",        331,  46, 90, 400),
    ("Discoveryland",       46, 164, 80, 400),
]

# (bearing, radius) of each attraction inside its land.
DLP_PLACES = {
    # Fantasyland — behind the castle
    "dragon_lair":        (0, 92),
    "carrousel":          (2, 150),
    "snow_white":         (342, 178),
    "pinocchio":          (358, 176),
    "peter_pan":          (350, 200),
    "dumbo":              (16, 190),
    "princess_pavilion":  (8, 222),
    "teacups":            (30, 232),
    "alice_labyrinth":    (6, 252),
    "meet_mickey":        (26, 268),
    "small_world":        (20, 305),
    "casey_jr":           (345, 300),
    "storybook":          (337, 322),
    # Discoveryland — east
    "orbitron":           (95, 152),
    "nautilus":           (88, 188),
    "buzz_lightyear":     (106, 216),
    "hyperspace_mountain":(74, 252),
    "star_tours":         (122, 250),
    "autopia":            (60, 302),
    # Main Street — the entrance corridor
    "railroad_main":      (180, 335),
    # Adventureland — south-west
    "aladdin":            (204, 172),
    "pirates":            (218, 232),
    "robinson":           (240, 266),
    "adventure_isle":     (232, 288),
    "indiana_jones":      (248, 352),
    # Frontierland — west, around the Rivers of the Far West
    "phantom_manor":      (262, 262),
    "shootin_gallery":    (268, 202),
    "riverboat":          (281, 292),
    "pocahontas":         (311, 252),
    "big_thunder":        (296, 362),
}

# ---------------------------------------------------------------------------
# Walt Disney Studios — rectangular lots, entrance on the west
# ---------------------------------------------------------------------------
# A clean partition — overlapping lots read as one muddy blob.
DAW_LANDS = [
    ("Front Lot",            -200, -120, -180, 180),
    ("Toon Studio",          -120,  -10,   20, 180),
    ("Worlds of Pixar",       -10,  200,   20, 180),
    ("Production Courtyard", -120,   30, -180,  20),
    ("Avengers Campus",        30,  200, -180,  20),
]

# (east, north) metres from the Studios centre.
DAW_PLACES = {
    "flying_carpets":  (-58, 108),
    "animagique":      (-82, 132),
    "crush_coaster":   (8, 98),
    "toy_soldiers":    (48, 156),
    "slinky_dog":      (76, 140),
    "rc_racer":        (104, 128),
    "cars_rallye":     (34, 58),
    "cars_road_trip":  (96, 44),
    "ratatouille":     (4, 44),
    "tower_of_terror": (-32, -96),
    "stitch_live":     (-70, -52),
    "flight_force":    (122, -28),
    "spiderman_web":   (96, -78),
}


def build_geometry() -> dict:
    plaza = {"name": "Central Plaza", "park": "DLP",
             "polygon": circle(DLP_HUB, 72, step=12)}
    dlp_lands = [
        {"name": name, "park": "DLP",
         "polygon": sector(DLP_HUB, b0, b1, r0, r1)}
        for name, b0, b1, r0, r1 in DLP_LANDS
    ]
    daw_lands = [
        {"name": name, "park": "DAW", "polygon": rect(DAW_CENTRE, x0, x1, y0, y1)}
        for name, x0, x1, y0, y1 in DAW_LANDS
    ]

    dlp_lands.insert(0, plaza)

    return {
        "_meta": {
            "source": "schematic",
            "generated_by": "tools/make_schematic_map.py",
            "note": (
                "Geographically faithful in topology — lands sit at their real "
                "compass bearings around the Central Plaza, and the Studios lots "
                "in their real arrangement — but this is a SCHEMATIC, not survey "
                "data. Distances and outlines are approximate. Replace it with "
                "real geometry using `python3 -m dlp.cli import-map`."
            ),
        },
        "parks": {
            "DLP": {"name": "Disneyland Park",
                    "outline": circle(DLP_HUB, DLP_RADIUS_M),
                    "hub": list(DLP_HUB)},
            "DAW": {"name": "Walt Disney Studios",
                    "outline": rect(DAW_CENTRE, -205, 205, -195, 195),
                    "hub": list(DAW_CENTRE)},
        },
        "lands": dlp_lands + daw_lands,
        "water": [
            # Rivers of the Far West wrap Big Thunder's island.
            {"name": "Rivers of the Far West", "park": "DLP",
             "polygon": sector(DLP_HUB, 272, 332, 285, 398)},
        ],
        "landmarks": [
            {"name": "Sleeping Beauty Castle", "park": "DLP", "kind": "castle",
             "at": list(polar(DLP_HUB, 0, 92))},
            {"name": "Central Plaza", "park": "DLP", "kind": "plaza",
             "at": list(DLP_HUB)},
            {"name": "Park entrance", "park": "DLP", "kind": "entrance",
             "at": list(polar(DLP_HUB, 180, 415))},
            {"name": "Studios entrance", "park": "DAW", "kind": "entrance",
             "at": list(offset(DAW_CENTRE, -195, 0))},
        ],
        "paths": [
            {"name": "Main Street U.S.A.", "park": "DLP",
             "line": [polar(DLP_HUB, 180, 400), polar(DLP_HUB, 180, 70)]},
            {"name": "Central Plaza ring", "park": "DLP",
             "line": circle(DLP_HUB, 70) + [polar(DLP_HUB, 0, 70)]},
            {"name": "Esplanade", "park": "BOTH",
             "line": [polar(DLP_HUB, 180, 415), offset(DAW_CENTRE, -195, 0)]},
        ],
    }


def reposition_attractions(geometry: dict) -> tuple[dict, int]:
    path = DATA / "attractions.json"
    raw = json.loads(path.read_text())
    moved = 0
    for a in raw["attractions"]:
        if a["id"] in DLP_PLACES:
            b, r = DLP_PLACES[a["id"]]
            lat, lon = polar(DLP_HUB, b, r)
        elif a["id"] in DAW_PLACES:
            x, y = DAW_PLACES[a["id"]]
            lat, lon = offset(DAW_CENTRE, x, y)
        else:
            print(f"  ! no position for {a['id']} — left where it was")
            continue
        if (a["lat"], a["lon"]) != (lat, lon):
            a["lat"], a["lon"] = lat, lon
            moved += 1
    raw["_meta"]["coord_source"] = "schematic (tools/make_schematic_map.py)"
    raw["_meta"]["note"] = (
        "Attraction positions are placed by compass bearing and distance from "
        "the Central Plaza so they sit correctly relative to one another and "
        "inside their own land. They are a SCHEMATIC, not survey data. Run "
        "`python3 -m dlp.cli import-map` to replace them, the land outlines "
        "and the water with real OpenStreetMap geometry, and verify height "
        "limits in the official Disneyland Paris app before the trip."
    )
    path.write_text(json.dumps(raw, indent=2) + "\n")
    return raw, moved


def main() -> None:
    geom = build_geometry()
    (DATA / "park_geometry.json").write_text(json.dumps(geom, indent=1) + "\n")
    raw, moved = reposition_attractions(geom)
    print(f"wrote park_geometry.json: {len(geom['lands'])} lands, "
          f"{len(geom['water'])} water, {len(geom['landmarks'])} landmarks")
    print(f"repositioned {moved}/{len(raw['attractions'])} attractions")


if __name__ == "__main__":
    main()
