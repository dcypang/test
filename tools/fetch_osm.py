#!/usr/bin/env python3
"""Download Saratoga, CA from OpenStreetMap (Overpass API) and compile it into
data/saratoga.js, the map file the game loads.

Usage:  python3 tools/fetch_osm.py            # download + compile
        python3 tools/fetch_osm.py --cached   # recompile from data/raw_osm.json

Only the Python standard library is needed. Coordinates are projected to local
metres (equirectangular around the city centre), rounded to 0.1 m and stored as
integers in decimetres to keep the file small.
"""
import json, math, os, sys, time, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw_osm.json")
OUT = os.path.join(ROOT, "data", "saratoga.js")
ENDPOINT = "https://overpass-api.de/api/interpreter"

# Saratoga city limits sit inside this box; the boundary relation is used to clip.
S, W, N, E = 37.2150, -122.0950, 37.3050, -121.9700

QUERY = f"""
[out:json][timeout:180];
(
  relation["boundary"="administrative"]["admin_level"="8"]["name"="Saratoga"]({S},{W},{N},{E});
)->.city;
.city out geom;
(
  way["building"]({S},{W},{N},{E});
  way["highway"]({S},{W},{N},{E});
  way["waterway"]({S},{W},{N},{E});
  way["landuse"]({S},{W},{N},{E});
  way["leisure"]({S},{W},{N},{E});
  way["natural"~"wood|water|scrub|grassland"]({S},{W},{N},{E});
  way["amenity"]({S},{W},{N},{E});
  way["railway"]({S},{W},{N},{E});
  relation["landuse"]({S},{W},{N},{E});
  relation["leisure"]({S},{W},{N},{E});
  relation["building"]({S},{W},{N},{E});
);
out geom tags;
(
  node["amenity"]({S},{W},{N},{E});
  node["shop"]({S},{W},{N},{E});
  node["tourism"]({S},{W},{N},{E});
  node["historic"]({S},{W},{N},{E});
  node["place"]({S},{W},{N},{E});
);
out tags;
"""

LAT0, LON0 = (S + N) / 2, (W + E) / 2
KX = 111320.0 * math.cos(math.radians(LAT0))
KY = 110540.0


def proj(lat, lon):
    # x east, y south (screen orientation), decimetres
    return int(round((lon - LON0) * KX * 10)), int(round((LAT0 - lat) * KY * 10))


def download():
    body = urllib.parse.urlencode({"data": QUERY}).encode()
    last = None
    for attempt in range(5):
        try:
            req = urllib.request.Request(ENDPOINT, data=body,
                                         headers={"User-Agent": "saratoga-sim-map-builder/1.0"})
            with urllib.request.urlopen(req, timeout=240) as r:
                data = r.read()
            json.loads(data)
            with open(RAW, "wb") as f:
                f.write(data)
            return
        except Exception as e:  # network hiccup or rate limit
            last = e
            wait = 2 ** (attempt + 1)
            print(f"download failed ({e}); retry in {wait}s", file=sys.stderr)
            time.sleep(wait)
    raise SystemExit(f"could not download OSM data: {last}")


def ring(geom):
    return [c for p in geom for c in proj(p["lat"], p["lon"])]


def point_in_poly(x, y, poly):
    inside = False
    n = len(poly) // 2
    j = n - 1
    for i in range(n):
        xi, yi, xj, yj = poly[2*i], poly[2*i+1], poly[2*j], poly[2*j+1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi + 1e-9) + xi:
            inside = not inside
        j = i
    return inside


def centroid(flat):
    n = len(flat) // 2
    return sum(flat[0::2]) / n, sum(flat[1::2]) / n


def area(flat):
    n = len(flat) // 2
    a = 0
    for i in range(n):
        j = (i + 1) % n
        a += flat[2*i] * flat[2*j+1] - flat[2*j] * flat[2*i+1]
    return abs(a) / 2 / 100.0  # dm^2 -> m^2


def join_outer(members):
    """Stitch outer member ways of a multipolygon into closed rings."""
    segs = [m["geometry"] for m in members if m.get("role") in ("outer", "") and m.get("geometry")]
    rings = []
    segs = [list(s) for s in segs]
    while segs:
        cur = segs.pop(0)
        changed = True
        while changed and (cur[0]["lat"], cur[0]["lon"]) != (cur[-1]["lat"], cur[-1]["lon"]):
            changed = False
            for i, s in enumerate(segs):
                a, b = (cur[-1]["lat"], cur[-1]["lon"]), (s[0]["lat"], s[0]["lon"])
                if a == b:
                    cur += s[1:]; segs.pop(i); changed = True; break
                if a == (s[-1]["lat"], s[-1]["lon"]):
                    cur += s[::-1][1:]; segs.pop(i); changed = True; break
        rings.append(cur)
    return rings


ROAD_CLASS = {
    "motorway": 0, "motorway_link": 0, "trunk": 0, "trunk_link": 0,
    "primary": 1, "primary_link": 1, "secondary": 1, "secondary_link": 1,
    "tertiary": 2, "tertiary_link": 2, "unclassified": 3, "residential": 3,
    "living_street": 3, "service": 4, "track": 5, "path": 6, "footway": 6,
    "cycleway": 6, "bridleway": 6, "steps": 6, "pedestrian": 6,
}


def building_kind(t):
    b = t.get("building", "yes")
    am, shop = t.get("amenity", ""), t.get("shop", "")
    if b in ("house", "detached", "residential", "semidetached_house", "bungalow", "villa", "farm"):
        return "house"
    if b in ("apartments", "terrace", "dormitory"):
        return "apartments"
    if b in ("garage", "garages", "shed", "carport", "barn", "greenhouse", "hut", "roof", "stable"):
        return "accessory"
    if b in ("commercial", "retail", "office", "hotel", "supermarket", "kiosk") or shop:
        return "commercial"
    if b in ("school", "university", "college", "kindergarten") or am in ("school", "college", "university", "kindergarten"):
        return "school"
    if b in ("church", "chapel", "temple", "mosque", "synagogue", "religious") or am == "place_of_worship":
        return "civic"
    if b in ("civic", "public", "government", "fire_station", "hospital", "library") or am in ("fire_station", "library", "townhall", "police", "community_centre"):
        return "civic"
    if b in ("industrial", "warehouse", "service"):
        return "utility"
    return "house" if b == "yes" else "other"


AREA_KIND = [
    (lambda t: t.get("leisure") in ("park", "garden", "nature_reserve", "playground", "dog_park"), "park"),
    (lambda t: t.get("leisure") in ("golf_course",), "golf"),
    (lambda t: t.get("leisure") in ("pitch", "track", "sports_centre", "stadium", "recreation_ground"), "sports"),
    (lambda t: t.get("leisure") == "swimming_pool", "pool"),
    (lambda t: t.get("natural") == "water" or t.get("landuse") == "reservoir", "water"),
    (lambda t: t.get("natural") in ("wood", "scrub") or t.get("landuse") in ("forest",), "forest"),
    (lambda t: t.get("natural") == "grassland" or t.get("landuse") in ("grass", "meadow", "recreation_ground", "village_green"), "grass"),
    (lambda t: t.get("landuse") in ("orchard", "vineyard", "farmland", "farmyard", "allotments"), "orchard"),
    (lambda t: t.get("landuse") in ("commercial", "retail"), "commercial"),
    (lambda t: t.get("landuse") == "residential", "residential"),
    (lambda t: t.get("landuse") in ("cemetery",) or t.get("amenity") == "grave_yard", "cemetery"),
    (lambda t: t.get("amenity") in ("school", "college", "university", "kindergarten"), "campus"),
    (lambda t: t.get("amenity") == "parking", "parking"),
    (lambda t: t.get("landuse") in ("religious",) or t.get("amenity") == "place_of_worship", "civic"),
    (lambda t: t.get("landuse") in ("industrial", "construction", "railway"), "utility"),
]


def compile_map():
    with open(RAW) as f:
        raw = json.load(f)
    els = raw["elements"]

    boundary = []
    for el in els:
        if el["type"] == "relation" and el.get("tags", {}).get("boundary") == "administrative" \
                and el["tags"].get("name") == "Saratoga":
            boundary = [ring(r) for r in join_outer(el["members"])]
            boundary = [r for r in boundary if len(r) > 6]
            boundary.sort(key=len, reverse=True)
            break
    if not boundary:
        raise SystemExit("Saratoga boundary not found in download")
    bx = [v for r in boundary for v in r[0::2]]
    by = [v for r in boundary for v in r[1::2]]
    minx, maxx, miny, maxy = min(bx), max(bx), min(by), max(by)
    pad = 3000  # 300 m of surrounding context

    def inside_city(x, y):
        return any(point_in_poly(x, y, r) for r in boundary)

    def in_view(flat):
        cx, cy = centroid(flat)
        return minx - pad <= cx <= maxx + pad and miny - pad <= cy <= maxy + pad

    buildings, roads, areas, water, pois = [], [], [], [], []
    seen_poi = set()
    for el in els:
        t = el.get("tags", {})
        if el["type"] == "node":
            name = t.get("name")
            if not name or name in seen_poi:
                continue
            x, y = proj(el["lat"], el["lon"])
            if not (minx - pad <= x <= maxx + pad and miny - pad <= y <= maxy + pad):
                continue
            seen_poi.add(name)
            kind = t.get("amenity") or t.get("shop") or t.get("tourism") or t.get("historic") or t.get("place")
            pois.append([name, kind, x, y])
            continue
        if el["type"] == "relation":
            if t.get("boundary"):
                continue
            rings = [ring(r) for r in join_outer(el.get("members", []))]
        else:
            if "geometry" not in el:
                continue
            rings = [ring(el["geometry"])]
        for flat in rings:
            if len(flat) < 4 or not in_view(flat):
                continue
            if "building" in t:
                if len(flat) < 6:
                    continue
                cx, cy = centroid(flat)
                lv = t.get("building:levels", "")
                try:
                    levels = max(1, min(6, int(float(lv))))
                except ValueError:
                    levels = 0
                b = {"k": building_kind(t), "p": flat[:-2] if flat[:2] == flat[-2:] else flat,
                     "in": 1 if inside_city(cx, cy) else 0}
                if levels:
                    b["l"] = levels
                for key, short in (("name", "n"), ("addr:housenumber", "h"), ("addr:street", "s")):
                    if key in t:
                        b[short] = t[key]
                if t.get("amenity"):
                    b["a"] = t["amenity"]
                buildings.append(b)
            elif "highway" in t:
                cls = ROAD_CLASS.get(t["highway"])
                if cls is None:
                    continue
                r = {"c": cls, "p": flat}
                if t.get("name"):
                    r["n"] = t["name"]
                roads.append(r)
            elif "waterway" in t:
                if t["waterway"] in ("river", "stream", "canal", "ditch", "drain"):
                    w = {"p": flat}
                    if t.get("name"):
                        w["n"] = t["name"]
                    water.append(w)
            elif "railway" in t:
                continue
            else:
                for test, kind in AREA_KIND:
                    if test(t):
                        if len(flat) < 6:
                            break
                        a = {"k": kind, "p": flat[:-2] if flat[:2] == flat[-2:] else flat}
                        if t.get("name"):
                            a["n"] = t["name"]
                        areas.append(a)
                        break

    # bigger areas first so small ones draw on top
    areas.sort(key=lambda a: -area(a["p"]))
    out = {
        "source": "OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright)",
        "generated": time.strftime("%Y-%m-%d"),
        "origin": [LAT0, LON0],
        "unit": "dm",
        "bounds": [minx - pad, miny - pad, maxx + pad, maxy + pad],
        "boundary": boundary,
        "buildings": buildings, "roads": roads, "areas": areas, "water": water, "pois": pois,
    }
    with open(OUT, "w") as f:
        f.write("// Generated by tools/fetch_osm.py. Map data (c) OpenStreetMap contributors, ODbL.\n")
        f.write("window.SARATOGA_MAP = ")
        json.dump(out, f, separators=(",", ":"))
        f.write(";\n")
    inside = sum(b["in"] for b in buildings)
    print(f"wrote {OUT}: {len(buildings)} buildings ({inside} inside city limits), "
          f"{len(roads)} road segments, {len(areas)} areas, {len(water)} waterways, {len(pois)} places")


if __name__ == "__main__":
    if "--cached" not in sys.argv:
        download()
    compile_map()
