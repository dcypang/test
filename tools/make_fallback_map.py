#!/usr/bin/env python3
"""Generate an APPROXIMATE Saratoga map when OpenStreetMap can't be downloaded.

Real arterial roads, landmarks and the hills-to-valley density pattern are laid
out by hand from public knowledge of the town; local streets and houses are
generated procedurally. Use tools/fetch_osm.py for the real building-by-building map.
"""
import json, math, os, random, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "saratoga.js")
S, W, N, E = 37.2150, -122.0950, 37.3050, -121.9700
LAT0, LON0 = (S + N) / 2, (W + E) / 2
KX = 111320.0 * math.cos(math.radians(LAT0)); KY = 110540.0
rnd = random.Random(95070)


def P(lat, lon):  # metres, y down
    return ((lon - LON0) * KX, (LAT0 - lat) * KY)


def dm(pts):
    return [int(round(v * 10)) for p in pts for v in p]


BOUNDARY_LL = [
    (37.2968, -122.0705), (37.2955, -122.0450), (37.2938, -122.0300), (37.2930, -122.0100), (37.2925, -121.9935),
    (37.2860, -121.9895), (37.2760, -121.9868), (37.2650, -121.9862), (37.2545, -121.9905), (37.2470, -121.9935),
    (37.2405, -121.9985), (37.2350, -122.0110), (37.2320, -122.0240), (37.2335, -122.0400), (37.2370, -122.0560),
    (37.2420, -122.0690), (37.2500, -122.0800), (37.2620, -122.0855), (37.2760, -122.0850), (37.2880, -122.0800),
]
BOUNDARY = [P(*p) for p in BOUNDARY_LL]

ARTERIALS = [  # (name, class, [(lat, lon)...])
    ("Saratoga-Sunnyvale Road", 1, [(37.2575, -122.0322), (37.2640, -122.0318), (37.2720, -122.0322), (37.2800, -122.0325), (37.2880, -122.0322), (37.2990, -122.0322)]),
    ("Big Basin Way", 1, [(37.2575, -122.0322), (37.2565, -122.0345), (37.2555, -122.0378), (37.2540, -122.0410), (37.2522, -122.0450), (37.2500, -122.0500), (37.2470, -122.0560), (37.2430, -122.0640), (37.2400, -122.0720)]),
    ("Saratoga-Los Gatos Road", 1, [(37.2575, -122.0322), (37.2560, -122.0290), (37.2530, -122.0230), (37.2500, -122.0160), (37.2470, -122.0090), (37.2440, -122.0020), (37.2400, -121.9940), (37.2360, -121.9850)]),
    ("Saratoga Avenue", 1, [(37.2585, -122.0300), (37.2610, -122.0250), (37.2640, -122.0190), (37.2670, -122.0120), (37.2700, -122.0050), (37.2740, -121.9990), (37.2790, -121.9920), (37.2850, -121.9840)]),
    ("State Route 85", 0, [(37.3010, -122.0450), (37.2950, -122.0360), (37.2890, -122.0260), (37.2830, -122.0170), (37.2770, -122.0080), (37.2720, -122.0010), (37.2670, -121.9920), (37.2610, -121.9800), (37.2570, -121.9700)]),
    ("Prospect Road", 1, [(37.2935, -122.0720), (37.2937, -122.0550), (37.2935, -122.0400), (37.2932, -122.0322), (37.2930, -122.0150), (37.2928, -121.9930), (37.2926, -121.9800)]),
    ("Cox Avenue", 2, [(37.2795, -122.0322), (37.2795, -122.0200), (37.2793, -122.0080), (37.2790, -121.9960), (37.2788, -121.9880)]),
    ("Quito Road", 2, [(37.2390, -121.9930), (37.2480, -121.9918), (37.2560, -121.9910), (37.2650, -121.9905), (37.2740, -121.9905), (37.2840, -121.9905), (37.2930, -121.9905)]),
    ("Fruitvale Avenue", 2, [(37.2600, -122.0230), (37.2640, -122.0195), (37.2700, -122.0185), (37.2760, -122.0182), (37.2795, -122.0180)]),
    ("Allendale Avenue", 2, [(37.2630, -122.0170), (37.2630, -122.0080), (37.2630, -121.9990), (37.2630, -121.9905)]),
    ("Herriman Avenue", 3, [(37.2700, -122.0300), (37.2700, -122.0185)]),
    ("Pierce Road", 2, [(37.2565, -122.0345), (37.2600, -122.0400), (37.2640, -122.0450), (37.2680, -122.0500), (37.2700, -122.0560), (37.2740, -122.0610), (37.2800, -122.0650), (37.2860, -122.0640), (37.2935, -122.0640)]),
    ("Mount Eden Road", 3, [(37.2740, -122.0610), (37.2760, -122.0700), (37.2770, -122.0800)]),
    ("Montalvo Road", 3, [(37.2540, -122.0260), (37.2500, -122.0270), (37.2460, -122.0285), (37.2432, -122.0290)]),
    ("Sixth Street", 3, [(37.2560, -122.0355), (37.2540, -122.0350)]),
    ("Fourth Street", 3, [(37.2567, -122.0335), (37.2552, -122.0328)]),
    ("Pollard Road", 2, [(37.2560, -121.9910), (37.2560, -121.9800)]),
    ("Glen Brae Drive", 3, [(37.2700, -122.0300), (37.2740, -122.0260), (37.2760, -122.0220)]),
    ("Chester Avenue", 3, [(37.2560, -122.0070), (37.2560, -122.0005)]),
    ("Bucknall Road", 3, [(37.2730, -121.9905), (37.2730, -121.9990)]),
    ("Arroyo de Arguello", 3, [(37.2900, -122.0322), (37.2900, -122.0220)]),
    ("Blauer Drive", 3, [(37.2860, -122.0322), (37.2860, -122.0250)]),
    ("Sobey Road", 3, [(37.2500, -122.0160), (37.2440, -122.0120)]),
    ("Wardell Road", 3, [(37.2690, -122.0050), (37.2600, -122.0050)]),
    ("Kirkbrook Drive", 3, [(37.2800, -122.0450), (37.2860, -122.0450)]),
    ("Comer Drive", 3, [(37.2600, -122.0400), (37.2560, -122.0450)]),
]

# Neighbourhoods: polygon (lat,lon), lot size m², street spacing m, grid angle deg
HOODS = [
    ("Quito / Cox", [(37.2925, -122.0250), (37.2925, -121.9935), (37.2860, -121.9895), (37.2760, -121.9868), (37.2700, -121.9866), (37.2700, -122.0060), (37.2790, -122.0250)], 950, 95, 0),
    ("Golden Triangle", [(37.2700, -122.0060), (37.2700, -121.9866), (37.2560, -121.9890), (37.2560, -122.0100), (37.2620, -122.0110)], 1050, 105, 8),
    ("Brookview", [(37.2925, -122.0320), (37.2925, -122.0250), (37.2790, -122.0250), (37.2790, -122.0320)], 1000, 100, 0),
    ("Northwest Saratoga", [(37.2930, -122.0560), (37.2930, -122.0330), (37.2800, -122.0330), (37.2760, -122.0450), (37.2800, -122.0560)], 1500, 120, 5),
    ("Saratoga Woods", [(37.2790, -122.0320), (37.2790, -122.0190), (37.2680, -122.0190), (37.2680, -122.0320)], 1300, 115, 0),
    ("Central Saratoga", [(37.2680, -122.0320), (37.2680, -122.0190), (37.2610, -122.0220), (37.2585, -122.0300)], 1800, 125, 15),
    ("Fruitvale / Allendale", [(37.2700, -122.0185), (37.2700, -122.0060), (37.2620, -122.0110), (37.2610, -122.0185)], 1700, 130, 10),
    ("Montalvo foothills", [(37.2560, -122.0280), (37.2500, -122.0140), (37.2440, -122.0020), (37.2360, -122.0110), (37.2330, -122.0240), (37.2400, -122.0300)], 3800, 170, 25),
    ("Mt Eden / Pierce", [(37.2900, -122.0700), (37.2900, -122.0560), (37.2760, -122.0460), (37.2650, -122.0430), (37.2600, -122.0500), (37.2700, -122.0700)], 5500, 210, -20),
    ("Sobey / Chester", [(37.2560, -122.0100), (37.2560, -121.9905), (37.2470, -121.9935), (37.2420, -122.0020), (37.2490, -122.0130)], 2300, 140, 30),
    ("Hillside west", [(37.2600, -122.0500), (37.2540, -122.0420), (37.2440, -122.0560), (37.2420, -122.0690), (37.2500, -122.0800), (37.2620, -122.0850), (37.2700, -122.0700)], 9000, 260, -35),
]

PARKS = [
    ("Hakone Gardens", "park", [(37.2540, -122.0450), (37.2540, -122.0420), (37.2518, -122.0415), (37.2515, -122.0448)]),
    ("Villa Montalvo", "park", [(37.2455, -122.0310), (37.2450, -122.0260), (37.2400, -122.0250), (37.2385, -122.0320), (37.2420, -122.0340)]),
    ("Wildwood Park", "park", [(37.2562, -122.0340), (37.2560, -122.0322), (37.2548, -122.0322), (37.2550, -122.0342)]),
    ("Congress Springs Park", "park", [(37.2800, -122.0390), (37.2800, -122.0365), (37.2784, -122.0365), (37.2784, -122.0390)]),
    ("El Quito Park", "park", [(37.2715, -121.9945), (37.2715, -121.9925), (37.2700, -121.9925), (37.2700, -121.9945)]),
    ("Kevin Moran Park", "park", [(37.2690, -122.0270), (37.2690, -122.0245), (37.2675, -122.0245), (37.2675, -122.0270)]),
    ("Saratoga Country Club", "golf", [(37.2930, -122.0640), (37.2930, -122.0560), (37.2880, -122.0560), (37.2870, -122.0620)]),
    ("Mountain Winery", "orchard", [(37.2690, -122.0600), (37.2690, -122.0550), (37.2650, -122.0545), (37.2645, -122.0595)]),
    ("Sanborn foothills", "forest", [(37.2470, -122.0560), (37.2400, -122.0720), (37.2420, -122.0800), (37.2500, -122.0800), (37.2560, -122.0700)]),
    ("Garrod Farms", "orchard", [(37.2780, -122.0700), (37.2780, -122.0640), (37.2740, -122.0640), (37.2740, -122.0700)]),
]
CAMPUS = [
    ("West Valley College", [(37.2665, -122.0140), (37.2665, -122.0060), (37.2605, -122.0060), (37.2605, -122.0140)]),
    ("Saratoga High School", [(37.2715, -122.0185), (37.2715, -122.0150), (37.2690, -122.0150), (37.2690, -122.0185)]),
    ("Prospect High School", [(37.2925, -121.9990), (37.2925, -121.9950), (37.2900, -121.9950), (37.2900, -121.9990)]),
    ("Redwood Middle School", [(37.2610, -122.0250), (37.2610, -122.0225), (37.2595, -122.0225), (37.2595, -122.0250)]),
    ("Saratoga City Hall", [(37.2638, -122.0190), (37.2638, -122.0175), (37.2626, -122.0175), (37.2626, -122.0190)]),
]
COMMERCIAL = [
    ("Saratoga Village", [(37.2580, -122.0322), (37.2572, -122.0318), (37.2548, -122.0380), (37.2556, -122.0385)]),
    ("Argonaut Shopping Center", [(37.2875, -122.0335), (37.2875, -122.0312), (37.2850, -122.0312), (37.2850, -122.0335)]),
    ("Prospect Center", [(37.2925, -122.0330), (37.2925, -122.0300), (37.2910, -122.0300), (37.2910, -122.0330)]),
    ("Quito Village", [(37.2575, -121.9925), (37.2575, -121.9905), (37.2555, -121.9905), (37.2555, -121.9925)]),
    ("Gateway", [(37.2700, -122.0060), (37.2705, -122.0030), (37.2690, -122.0025), (37.2685, -122.0055)]),
]
CREEKS = [
    ("Saratoga Creek", [(37.2380, -122.0740), (37.2450, -122.0600), (37.2520, -122.0470), (37.2555, -122.0350), (37.2600, -122.0300), (37.2680, -122.0260), (37.2760, -122.0240), (37.2850, -122.0200), (37.2950, -122.0150)]),
    ("Calabazas Creek", [(37.2760, -122.0800), (37.2800, -122.0650), (37.2850, -122.0520), (37.2900, -122.0420), (37.2990, -122.0380)]),
    ("Wildcat Creek", [(37.2500, -122.0250), (37.2560, -122.0300)]),
]
POIS = [
    ("Saratoga", "place", 37.2638, -122.0230), ("Saratoga Village", "neighbourhood", 37.2563, -122.0350),
    ("Hakone Gardens", "attraction", 37.2529, -122.0434), ("Montalvo Arts Center", "museum", 37.2432, -122.0290),
    ("Mountain Winery", "attraction", 37.2663, -122.0574), ("West Valley College", "college", 37.2636, -122.0100),
    ("Saratoga High School", "school", 37.2703, -122.0168), ("Saratoga Library", "library", 37.2617, -122.0175),
    ("Saratoga City Hall", "townhall", 37.2632, -122.0182), ("Quito", "neighbourhood", 37.2800, -121.9960),
    ("Golden Triangle", "neighbourhood", 37.2640, -121.9990), ("Congress Springs", "neighbourhood", 37.2830, -122.0420),
    ("Mount Eden", "neighbourhood", 37.2800, -122.0700), ("Saratoga Historical Museum", "museum", 37.2567, -122.0332),
    ("Blaney Plaza", "attraction", 37.2575, -122.0325), ("Saratoga Fire Station", "fire_station", 37.2560, -122.0360),
]


def pip(x, y, poly):
    inside = False; j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]; xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi: inside = not inside
        j = i
    return inside


def seg_d(px, py, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]; l2 = dx * dx + dy * dy
    t = max(0, min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l2)) if l2 else 0
    return math.hypot(a[0] + t * dx - px, a[1] + t * dy - py)


def main():
    roads, buildings, areas, water, pois = [], [], [], [], []
    art = [(n, c, [P(*p) for p in pts]) for n, c, pts in ARTERIALS]
    for n, c, pts in art: roads.append({"c": c, "n": n, "p": dm(pts)})
    blockers = []  # polygons where no houses go
    for n, k, poly in PARKS:
        pp = [P(*p) for p in poly]; areas.append({"k": k, "n": n, "p": dm(pp)}); blockers.append(pp)
    for n, poly in CAMPUS:
        pp = [P(*p) for p in poly]; areas.append({"k": "campus", "n": n, "p": dm(pp)}); blockers.append(pp)
        # a few school buildings
        cx = sum(p[0] for p in pp) / 4; cy = sum(p[1] for p in pp) / 4
        kind = "civic" if "Hall" in n else "school"
        for i in range(4 if kind == "school" else 2):
            bx, by = cx + rnd.uniform(-60, 60), cy + rnd.uniform(-40, 40)
            w, d = rnd.uniform(25, 55), rnd.uniform(15, 30)
            buildings.append({"k": kind, "p": dm([(bx - w/2, by - d/2), (bx + w/2, by - d/2), (bx + w/2, by + d/2), (bx - w/2, by + d/2)]), "in": 1,
                              **({"n": n} if i == 0 else {})})
    def near_major_ll(x, y, d):
        return any(seg_d(x, y, pts[i - 1], pts[i]) < d for _, c, pts in art for i in range(1, len(pts)))

    for n, poly in COMMERCIAL:
        pp = [P(*p) for p in poly]; areas.append({"k": "commercial", "n": n, "p": dm(pp)}); blockers.append(pp)
        xs = [p[0] for p in pp]; ys = [p[1] for p in pp]
        x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
        y = y0 + 10
        while y < y1 - 10:
            x = x0 + 10
            while x < x1 - 10:
                w, d = rnd.uniform(14, 30), rnd.uniform(14, 24)
                if pip(x + w/2, y + d/2, pp) and not near_major_ll(x + w/2, y + d/2, 16 + max(w, d) / 2):
                    buildings.append({"k": "commercial", "p": dm([(x, y), (x + w, y), (x + w, y + d), (x, y + d)]), "in": 1, "l": 1 if rnd.random() < .7 else 2})
                x += w + rnd.uniform(3, 8)
            y += 30
    for n, pts in CREEKS: water.append({"n": n, "p": dm([P(*p) for p in pts])})
    for n, k, la, lo in POIS:
        x, y = P(la, lo); pois.append([n, k, int(x * 10), int(y * 10)])

    def near_major(x, y, d):
        for _, c, pts in art:
            for i in range(1, len(pts)):
                if seg_d(x, y, pts[i - 1], pts[i]) < d: return True
        return False

    def blocked(x, y):
        return any(pip(x, y, b) for b in blockers)

    street_no = [1]
    names = ["Oak", "Vista", "Ridge", "Canyon", "Manor", "Glen", "Arbor", "Orchard", "Creek", "Monte", "Sierra", "Bonnie", "Alcalde",
             "Paseo", "Via", "Crestbrook", "Kittridge", "Ten Acres", "Elva", "Carniel", "Lomita", "Wildcat", "Aspesi", "Brookglen",
             "Hammons", "Douglass", "Mellon", "Scotland", "Seagull", "Thelma", "Wilson", "Wright", "Titus", "Woodbrae"]
    sfx = ["Avenue", "Court", "Drive", "Lane", "Way", "Road", "Place", "Circle"]

    for hood, poly_ll, lot, spacing, ang in HOODS:
        poly = [P(*p) for p in poly_ll]
        xs = [p[0] for p in poly]; ys = [p[1] for p in poly]
        cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
        a = math.radians(ang); ca, sa = math.cos(a), math.sin(a)
        R = max(max(xs) - min(xs), max(ys) - min(ys))
        hills = lot >= 3500
        frontage = max(18, math.sqrt(lot) * 0.85)
        setback = min(45, math.sqrt(lot) * 0.35 + 6)
        rows = int(R / spacing) + 2
        for k in range(-rows, rows + 1):
            # streets parallel to the local u axis, at v = k*spacing
            v = k * spacing
            pts = []
            u = -R
            wob = rnd.uniform(0, 6.28)
            while u <= R:
                vv = v + (math.sin(u / 90 + wob) * spacing * 0.22 if hills else 0)
                x = cx + u * ca - vv * sa; y = cy + u * sa + vv * ca
                inside = pip(x, y, poly) and pip(x, y, BOUNDARY) and not blocked(x, y)
                if inside: pts.append((x, y))
                elif len(pts) > 1:
                    yield_street(pts, roads, buildings, names, sfx, street_no, frontage, setback, lot, hills, near_major, blocked); pts = []
                else: pts = []
                u += 12
            if len(pts) > 1:
                yield_street(pts, roads, buildings, names, sfx, street_no, frontage, setback, lot, hills, near_major, blocked)
        if not hills:  # cross streets every ~3 blocks
            for k in range(-rows, rows + 1, 3):
                u0 = k * spacing * 2.2 + rnd.uniform(-20, 20)
                pts = []
                for step in range(-int(R / 12), int(R / 12)):
                    v = step * 12
                    x = cx + u0 * ca - v * sa; y = cy + u0 * sa + v * ca
                    if pip(x, y, poly) and pip(x, y, BOUNDARY) and not blocked(x, y): pts.append((x, y))
                    elif len(pts) > 1:
                        roads.append({"c": 3, "n": rnd.choice(names) + " " + rnd.choice(sfx), "p": dm(simplify(pts))}); pts = []
                    else: pts = []
                if len(pts) > 1: roads.append({"c": 3, "n": rnd.choice(names) + " " + rnd.choice(sfx), "p": dm(simplify(pts))})

    # mark which buildings are in city
    for b in buildings:
        p = b["p"]; x = sum(p[0::2]) / len(p[0::2]) / 10; y = sum(p[1::2]) / len(p[1::2]) / 10
        b["in"] = 1 if pip(x, y, BOUNDARY) else 0
    bx = [p[0] for p in BOUNDARY]; by = [p[1] for p in BOUNDARY]
    pad = 300
    out = {
        "source": "Approximate stand-in map generated by tools/make_fallback_map.py (not real parcels)",
        "synthetic": True,
        "generated": time.strftime("%Y-%m-%d"), "origin": [LAT0, LON0], "unit": "dm",
        "bounds": [int((min(bx) - pad) * 10), int((min(by) - pad) * 10), int((max(bx) + pad) * 10), int((max(by) + pad) * 10)],
        "boundary": [dm(BOUNDARY)], "buildings": buildings, "roads": roads, "areas": areas, "water": water, "pois": pois,
    }
    with open(OUT, "w") as f:
        f.write("// APPROXIMATE stand-in map. Run tools/fetch_osm.py for real OpenStreetMap data.\nwindow.SARATOGA_MAP = ")
        json.dump(out, f, separators=(",", ":")); f.write(";\n")
    print(f"wrote {OUT}: {len(buildings)} buildings, {len(roads)} roads")


def simplify(pts):
    if len(pts) <= 2: return pts
    out = [pts[0]]
    for i in range(1, len(pts) - 1):
        a, b, c = out[-1], pts[i], pts[i + 1]
        cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
        if abs(cross) > 30: out.append(b)
    out.append(pts[-1]); return out


def yield_street(pts, roads, buildings, names, sfx, street_no, frontage, setback, lot, hills, near_major, blocked):
    length = sum(math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) for i in range(1, len(pts)))
    if length < 50: return
    name = names[street_no[0] % len(names)] + " " + sfx[(street_no[0] * 7) % len(sfx)]
    street_no[0] += 1
    roads.append({"c": 3, "n": name, "p": dm(simplify(pts))})
    # houses along both sides
    dist_acc, next_at = 0.0, rnd.uniform(0, frontage)
    hn = 12000 + rnd.randrange(0, 8000, 10)
    for i in range(1, len(pts)):
        (x0, y0), (x1, y1) = pts[i - 1], pts[i]
        L = math.hypot(x1 - x0, y1 - y0)
        if L == 0: continue
        ux, uy = (x1 - x0) / L, (y1 - y0) / L
        while dist_acc + L >= next_at:
            t = next_at - dist_acc
            px, py = x0 + ux * t, y0 + uy * t
            for side in (1, -1):
                if rnd.random() < (0.25 if hills else 0.06): continue  # vacant lot
                sb = setback * rnd.uniform(0.8, 1.3)
                hx, hy = px - uy * sb * side, py + ux * sb * side
                if near_major(hx, hy, 14) or blocked(hx, hy): continue
                area = min(650, max(140, lot * rnd.uniform(0.12, 0.2)))
                w = math.sqrt(area * rnd.uniform(1.1, 1.6)); d = area / w
                c, s = ux, uy
                corners = [(-w/2, -d/2), (w/2, -d/2), (w/2, d/2), (-w/2, d/2)]
                poly = [(hx + a * c - b * s, hy + a * s + b * c) for a, b in corners]
                hn += 10
                bld = {"k": "house", "p": dm(poly), "in": 1, "h": str(hn + (0 if side > 0 else 5)), "s": name}
                if area > 300: bld["l"] = 2
                buildings.append(bld)
                if rnd.random() < 0.35:  # detached garage / pool house
                    gx, gy = hx - uy * (d / 2 + 6) * side + ux * w * 0.4, hy + ux * (d / 2 + 6) * side + uy * w * 0.4
                    gw, gd = 7, 6
                    gp = [(gx + a * c - b * s, gy + a * s + b * c) for a, b in [(-gw/2, -gd/2), (gw/2, -gd/2), (gw/2, gd/2), (-gw/2, gd/2)]]
                    buildings.append({"k": "accessory", "p": dm(gp), "in": 1})
            next_at += frontage * rnd.uniform(0.9, 1.15)
        dist_acc += L


if __name__ == "__main__":
    main()
