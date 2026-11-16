#!/usr/bin/env python3
"""Download Saratoga, CA from OpenStreetMap (Overpass API) and compile it into
data/saratoga.js, the map file the game loads.

Usage:  python3 tools/fetch_osm.py            # download (Overpass API) + compile
        python3 tools/fetch_osm.py --api      # download through the main OSM API in tiles + compile
        python3 tools/fetch_osm.py --cached   # recompile from data/raw_osm.json

Only the Python standard library is needed. Coordinates are projected to local
metres (equirectangular around the city centre), rounded to 0.1 m and stored as
integers in decimetres to keep the file small.
"""
import json, math, os, sys, time, urllib.error, urllib.parse, urllib.request

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


API = "https://api.openstreetmap.org/api/0.6"
UA = {"User-Agent": "simsaratoga-map-builder/1.0 (one-time extract for a city planning game)"}
TILES = os.path.join(ROOT, "data", "osm_tiles")


def api_get(url, retries=4):
    last = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=180) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            if e.code in (400, 509):  # too many nodes in the box / bandwidth limit
                return e.code, e.read()
            if e.code in (502, 503, 504) and attempt >= 1:  # server too slow for this box: let the caller split it
                return e.code, b""

            last = e
        except Exception as e:
            last = e
        time.sleep(2 ** (attempt + 1))
    raise SystemExit(f"OSM API request failed: {url}: {last}")


def download_api():
    """Download through the main OSM API in tiles (it caps each request at 50,000 nodes),
    then convert to the same element format the Overpass download produces."""
    import xml.etree.ElementTree as ET
    os.makedirs(TILES, exist_ok=True)
    nodes, ways, rels = {}, {}, {}

    def parse(data):
        root = ET.fromstring(data)
        for el in root:
            tags = {t.get("k"): t.get("v") for t in el.findall("tag")}
            if el.tag == "node":
                nodes[int(el.get("id"))] = (float(el.get("lat")), float(el.get("lon")), tags)
            elif el.tag == "way":
                ways[int(el.get("id"))] = ([int(n.get("ref")) for n in el.findall("nd")], tags)
            elif el.tag == "relation":
                rels[int(el.get("id"))] = ([(m.get("type"), int(m.get("ref")), m.get("role")) for m in el.findall("member")], tags)

    def tile(s, w, n, e, depth=0):
        name = os.path.join(TILES, f"{s:.4f}_{w:.4f}_{n:.4f}_{e:.4f}.osm")
        if os.path.exists(name):
            with open(name, "rb") as f:
                parse(f.read())
            return
        status, data = api_get(f"{API}/map?bbox={w},{s},{e},{n}")
        if status == 200:
            with open(name, "wb") as f:
                f.write(data)
            parse(data)
            print(f"  tile {s:.4f},{w:.4f}: {len(data) // 1024} KB", file=sys.stderr)
            time.sleep(1)
            return
        if status in (502, 503, 504) and depth >= 2:  # small box, busy server: wait and try again
            for wait in (15, 30, 60, 90):
                time.sleep(wait)
                status, data = api_get(f"{API}/map?bbox={w},{s},{e},{n}")
                if status == 200:
                    with open(name, "wb") as f:
                        f.write(data)
                    parse(data)
                    print(f"  tile {s:.4f},{w:.4f}: {len(data) // 1024} KB (after retry)", file=sys.stderr)
                    return
            raise SystemExit(f"OSM API kept timing out for tile {s},{w},{n},{e}")
        if depth > 5:
            raise SystemExit(f"tile still too large at depth {depth}: {data[:200]!r}")
        ms, mw = (s + n) / 2, (w + e) / 2  # too many nodes: split in four
        for a in ((s, w, ms, mw), (s, mw, ms, e), (ms, w, n, mw), (ms, mw, n, e)):
            tile(*a, depth + 1)

    step = 0.03
    lat = S
    while lat < N - 1e-9:
        lon = W
        while lon < E - 1e-9:
            tile(round(lat, 4), round(lon, 4), round(min(N, lat + step), 4), round(min(E, lon + step), 4))
            lon += step
        lat += step

    # the city boundary relation, complete (its members reach outside the box)
    city = [rid for rid, (m, t) in rels.items() if t.get("boundary") == "administrative"
            and t.get("admin_level") == "8" and t.get("name") == "Saratoga"]
    if not city:
        raise SystemExit("Saratoga boundary relation not found in the tiles")
    status, data = api_get(f"{API}/relation/{city[0]}/full")
    if status != 200:
        raise SystemExit(f"could not fetch boundary relation {city[0]}")
    parse(data)

    def geom(ids):
        return [{"lat": nodes[i][0], "lon": nodes[i][1]} for i in ids if i in nodes]

    els = []
    for nid, (lat, lon, tags) in nodes.items():
        if tags:
            els.append({"type": "node", "id": nid, "lat": lat, "lon": lon, "tags": tags})
    for wid, (ids, tags) in ways.items():
        if tags:
            g = geom(ids)
            if len(g) >= 2:
                els.append({"type": "way", "id": wid, "tags": tags, "geometry": g})
    for rid, (members, tags) in rels.items():
        if not (tags.get("boundary") == "administrative" or "landuse" in tags or "leisure" in tags or "building" in tags):
            continue
        mem = []
        for typ, ref, role in members:
            if typ == "way" and ref in ways:
                g = geom(ways[ref][0])
                if g:
                    mem.append({"type": "way", "ref": ref, "role": role or "outer", "geometry": g})
        if mem:
            els.append({"type": "relation", "id": rid, "tags": tags, "members": mem})
    with open(RAW, "w") as f:
        json.dump({"elements": els}, f)
    print(f"API download: {len(nodes)} nodes, {len(ways)} ways, {len(rels)} relations", file=sys.stderr)


if __name__ == "__main__":
    if "--api" in sys.argv:
        download_api()
    elif "--cached" not in sys.argv:
        download()
    compile_map()
