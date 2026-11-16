#!/usr/bin/env python3
"""Build map-data.js for Bay Gridlock from public-domain sources.

Inputs (download into one directory, pass it as argv[1]):
  rna.shp/.dbf/.shx  Natural Earth "ne_10m_roads_north_america" (public domain)
                     https://github.com/nvkelso/natural-earth-vector/tree/master/10m_cultural
  cacounties.geojson California county outlines (shoreline-clipped)
                     https://github.com/codeforgermany/click_that_hood  public/data/california-counties.geojson

Output: argv[2] (map-data.js) -- `window.BAY_MAP = {...}`.
Needs: pip install pyshp
"""
import json, math, sys, collections
import shapefile

SRC, OUT = sys.argv[1], sys.argv[2]
DEBUG = len(sys.argv) > 3 and sys.argv[3]

# ---- projection: equirectangular, km, y down --------------------------------
LON0, LAT0 = -122.72, 38.36           # top-left of the playable area
KX = 111.32 * math.cos(math.radians(37.65)); KY = 110.57
def proj(lon, lat): return ((lon - LON0) * KX, (LAT0 - lat) * KY)
GW, GH = proj(-121.58, 36.94)          # playable box is (0,0)-(GW,GH)
RB = (-150.0, -80.0, GW + 260.0, GH + 70.0)   # render box for land

def dist(a, b): return math.hypot(a[0] - b[0], a[1] - b[1])
def plen(p): return sum(dist(p[i], p[i + 1]) for i in range(len(p) - 1))

# ---- 1. load + clip roads ---------------------------------------------------
KEEP_OTHER = {'35', '84', '92', '238', '185', '61', '260', '77'}
def want(r):
    t = r['type']
    if t in ('Freeway', 'Tollway', 'Primary', 'Secondary'): return True
    return t == 'Other Paved' and r['number'] in KEEP_OTHER

def clip_line(pts):
    """Clip polyline to the playable box. Returns [(pts, startCut, endCut)]."""
    def inside(p): return -1e-9 <= p[0] <= GW + 1e-9 and -1e-9 <= p[1] <= GH + 1e-9
    def cross(a, b):  # a inside, b outside -> boundary point
        t = 1.0
        dx, dy = b[0] - a[0], b[1] - a[1]
        if dx > 0: t = min(t, (GW - a[0]) / dx)
        if dx < 0: t = min(t, (0 - a[0]) / dx)
        if dy > 0: t = min(t, (GH - a[1]) / dy)
        if dy < 0: t = min(t, (0 - a[1]) / dy)
        return (a[0] + dx * t, a[1] + dy * t)
    out, cur, startcut = [], [], False
    for i, p in enumerate(pts):
        if inside(p):
            if not cur and i > 0 and not inside(pts[i - 1]):
                cur = [cross(p, pts[i - 1])]; startcut = True
            cur.append(p)
        else:
            if cur:
                cur.append(cross(cur[-1], p)); out.append((cur, startcut, True))
                cur, startcut = [], False
    if cur: out.append((cur, startcut, False))
    return [o for o in out if len(o[0]) >= 2]

sf = shapefile.Reader(SRC + '/rna')
bbox_ll = (-122.9, 36.8, -121.4, 38.5)
lines = []          # dict(pts, ref, cls)
gate_pts = []       # boundary points
for sr in sf.iterShapeRecords():
    b = sr.shape.bbox
    if b[2] < bbox_ll[0] or b[0] > bbox_ll[2] or b[3] < bbox_ll[1] or b[1] > bbox_ll[3]: continue
    r = sr.record.as_dict()
    if not want(r): continue
    pts = sr.shape.points; parts = list(sr.shape.parts) + [len(pts)]
    for j in range(len(parts) - 1):
        raw = [proj(p[0], p[1]) for p in pts[parts[j]:parts[j + 1]]]
        for seg, sc, ec in clip_line(raw):
            cls = {'Freeway': 'fwy', 'Tollway': 'br', 'Primary': 'pri'}.get(r['type'], 'sec')
            lines.append(dict(pts=[tuple(p) for p in seg], ref=r['number'] or '', cls=cls,
                              pre=r['prefix'] or ('US' if r['class'] == 'Federal' else '')))
            if sc: gate_pts.append(seg[0])
            if ec: gate_pts.append(seg[-1])
print('lines', len(lines), 'gates', len(gate_pts))

# ---- 2. node the linework ---------------------------------------------------
def key(p): return (round(p[0] * 200), round(p[1] * 200))   # 5 m

def nearest_on(pl, p):
    best = (1e9, None, None)
    for i in range(len(pl) - 1):
        a, b = pl[i], pl[i + 1]
        dx, dy = b[0] - a[0], b[1] - a[1]; L2 = dx * dx + dy * dy
        t = 0 if L2 == 0 else max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2))
        q = (a[0] + dx * t, a[1] + dy * t); d = dist(p, q)
        if d < best[0]: best = (d, i, q)
    return best

# T-snap: endpoints close to another line get welded onto it
SNAP = 0.25
for li, L in enumerate(lines):
    for end in (0, -1):
        E = L['pts'][end]
        if any(dist(E, g) < 1e-6 for g in gate_pts): continue
        best = (SNAP, None, None, None)
        for mj, M in enumerate(lines):
            if mj == li: continue
            d, i, q = nearest_on(M['pts'], E)
            if d < best[0]: best = (d, mj, i, q)
        if best[1] is not None:
            M = lines[best[1]]; q = best[3]; i = best[2]
            # reuse an existing vertex if it is right there
            for v in (M['pts'][i], M['pts'][i + 1]):
                if dist(v, q) < 0.08: q = v; break
            else:
                M['pts'].insert(i + 1, q)
            L['pts'][end] = q

# crossings
def seg_x(a, b, c, d):
    r = (b[0] - a[0], b[1] - a[1]); s = (d[0] - c[0], d[1] - c[1])
    den = r[0] * s[1] - r[1] * s[0]
    if abs(den) < 1e-12: return None
    t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den
    u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den
    if -1e-9 <= t <= 1 + 1e-9 and -1e-9 <= u <= 1 + 1e-9:
        return (a[0] + r[0] * t, a[1] + r[1] * t)
    return None

CELL = 2.0
grid = collections.defaultdict(list)
for li, L in enumerate(lines):
    for i in range(len(L['pts']) - 1):
        a, b = L['pts'][i], L['pts'][i + 1]
        for gx in range(int(min(a[0], b[0]) // CELL), int(max(a[0], b[0]) // CELL) + 1):
            for gy in range(int(min(a[1], b[1]) // CELL), int(max(a[1], b[1]) // CELL) + 1):
                grid[(gx, gy)].append((li, i))
inserts = collections.defaultdict(list)   # (li, i) -> [pt]
seen = set()
for cell in grid.values():
    for x in range(len(cell)):
        for y in range(x + 1, len(cell)):
            (l1, i1), (l2, i2) = cell[x], cell[y]
            if l1 == l2: continue
            k = (l1, i1, l2, i2)
            if k in seen: continue
            seen.add(k)
            p = seg_x(lines[l1]['pts'][i1], lines[l1]['pts'][i1 + 1], lines[l2]['pts'][i2], lines[l2]['pts'][i2 + 1])
            if p: inserts[(l1, i1)].append(p); inserts[(l2, i2)].append(p)
junction = set()
for L in lines:
    junction.add(key(L['pts'][0])); junction.add(key(L['pts'][-1]))
for li, L in enumerate(lines):
    new = []
    for i in range(len(L['pts']) - 1):
        a = L['pts'][i]; new.append(a)
        ins = sorted(inserts.get((li, i), []), key=lambda p: dist(a, p))
        for p in ins:
            junction.add(key(p))
            if dist(p, new[-1]) > 1e-6: new.append(p)
    new.append(L['pts'][-1]); L['pts'] = new

pieces = []
for L in lines:
    cur = [L['pts'][0]]
    for p in L['pts'][1:]:
        if key(p) == key(cur[-1]): continue
        cur.append(p)
        if key(p) in junction:
            pieces.append(dict(pts=cur, ref=L['ref'], cls=L['cls'], pre=L['pre'])); cur = [p]
    if len(cur) > 1: pieces.append(dict(pts=cur, ref=L['ref'], cls=L['cls'], pre=L['pre']))
print('pieces', len(pieces))

# ---- 3. graph cleanup -------------------------------------------------------
RANK = {'br': 4, 'fwy': 3, 'pri': 2, 'sec': 1}
class G:
    def __init__(self):
        self.pos = {}; self.edges = {}; self.adj = collections.defaultdict(set); self.eid = 0
        self.fixed = set()
    def node(self, p):
        k = key(p)
        if k not in self.pos: self.pos[k] = p
        return k
    def add(self, a, b, pts, ref, cls, pre):
        if a == b: return
        e = self.eid; self.eid += 1
        self.edges[e] = dict(a=a, b=b, pts=pts, ref=ref, cls=cls, pre=pre)
        self.adj[a].add(e); self.adj[b].add(e); return e
    def rm(self, e):
        E = self.edges.pop(e); self.adj[E['a']].discard(e); self.adj[E['b']].discard(e)
        return E
    def deg(self, n): return len(self.adj[n])

g = G()
for P in pieces:
    a, b = g.node(P['pts'][0]), g.node(P['pts'][-1])
    g.add(a, b, P['pts'], P['ref'], P['cls'], P['pre'])
for p in gate_pts: g.fixed.add(key(p))

def merge_nodes(keep, drop):
    """Move every edge end from `drop` onto `keep`."""
    for e in list(g.adj[drop]):
        E = g.edges[e]
        if E['a'] == drop: E['a'] = keep; E['pts'][0] = g.pos[keep]
        if E['b'] == drop: E['b'] = keep; E['pts'][-1] = g.pos[keep]
        g.adj[drop].discard(e)
        if E['a'] == E['b']: g.rm(e)
        else: g.adj[keep].add(e)
    del g.pos[drop]; g.adj.pop(drop, None)

def contract_short(th):
    changed = True
    while changed:
        changed = False
        for e, E in sorted(g.edges.items(), key=lambda kv: plen(kv[1]['pts'])):
            if plen(E['pts']) < th:
                a, b = E['a'], E['b']
                if a in g.fixed and b in g.fixed: continue
                keep, drop = (a, b) if (a in g.fixed or g.deg(a) >= g.deg(b)) else (b, a)
                if drop in g.fixed: keep, drop = drop, keep
                g.rm(e); merge_nodes(keep, drop); changed = True; break

def dedupe_parallel():
    byp = collections.defaultdict(list)
    for e, E in g.edges.items(): byp[frozenset((E['a'], E['b']))].append(e)
    for es in byp.values():
        if len(es) < 2: continue
        es.sort(key=lambda e: (-RANK[g.edges[e]['cls']], plen(g.edges[e]['pts'])))
        keep = [es[0]]
        for e in es[1:]:
            # distinct route only if it strays > 0.6 km from every kept one
            far = all(max(nearest_on(g.edges[k]['pts'], p)[0] for p in g.edges[e]['pts']) > 0.6 for k in keep)
            if far: keep.append(e)
            else: g.rm(e)

def join_deg2():
    changed = True
    while changed:
        changed = False
        for n in list(g.pos):
            if n in g.fixed or g.deg(n) != 2: continue
            e1, e2 = list(g.adj[n])
            A, B = g.edges[e1], g.edges[e2]
            if (A['ref'], A['cls']) != (B['ref'], B['cls']):
                # absorb a short differently-tagged piece into its neighbour
                if min(plen(A['pts']), plen(B['pts'])) > 1.2: continue
            pa = A['pts'] if A['b'] == n else A['pts'][::-1]
            pb = B['pts'] if B['a'] == n else B['pts'][::-1]
            a0 = A['a'] if A['b'] == n else A['b']; b1 = B['b'] if B['a'] == n else B['a']
            if a0 == b1: continue
            big = A if plen(A['pts']) >= plen(B['pts']) else B
            ref, cls, pre = big['ref'], big['cls'], big['pre']
            g.rm(e1); g.rm(e2); del g.pos[n]; g.adj.pop(n, None)
            g.add(a0, b1, pa + pb[1:], ref, cls, pre); changed = True

def prune_stubs(keepers):
    changed = True
    while changed:
        changed = False
        for n in list(g.pos):
            if g.deg(n) == 0: del g.pos[n]; g.adj.pop(n, None); continue
            if g.deg(n) == 1 and n not in g.fixed and n not in keepers:
                g.rm(next(iter(g.adj[n]))); changed = True

def keep_main_component():
    seen = set(); best = set()
    for s in g.pos:
        if s in seen: continue
        comp = {s}; st = [s]
        while st:
            n = st.pop()
            for e in g.adj[n]:
                E = g.edges[e]; m = E['b'] if E['a'] == n else E['a']
                if m not in comp: comp.add(m); st.append(m)
        seen |= comp
        if len(comp) > len(best): best = comp
    for e in [e for e, E in g.edges.items() if E['a'] not in best]: g.rm(e)
    for n in [n for n in g.pos if n not in best]: del g.pos[n]; g.adj.pop(n, None)

contract_short(0.45); dedupe_parallel(); join_deg2(); contract_short(0.45); dedupe_parallel()
keep_main_component()
print('after cleanup: nodes', len(g.pos), 'edges', len(g.edges))

# ---- 4. zones (cities) ------------------------------------------------------
# name, lat, lon, residents (thousands), jobs (thousands)
CITIES = [
 ('San Francisco', 37.782, -122.404, 420, 640), ('Sunset', 37.742, -122.476, 210, 60),
 ('Daly City', 37.688, -122.468, 150, 40), ('South SF', 37.653, -122.408, 110, 95),
 ('SFO', 37.612, -122.398, 95, 85), ('Pacifica', 37.60, -122.495, 38, 6),
 ('San Mateo', 37.553, -122.300, 160, 105), ('Half Moon Bay', 37.467, -122.433, 25, 7),
 ('Redwood City', 37.488, -122.220, 150, 110), ('Palo Alto', 37.447, -122.150, 125, 170),
 ('Mountain View', 37.405, -122.078, 95, 120), ('Sunnyvale', 37.385, -122.020, 155, 125),
 ('Cupertino', 37.320, -122.045, 100, 75), ('Santa Clara', 37.368, -121.965, 130, 150),
 ('San Jose', 37.335, -121.893, 430, 290), ('North San Jose', 37.398, -121.925, 120, 170),
 ('South San Jose', 37.255, -121.845, 330, 70), ('Los Gatos', 37.240, -121.960, 110, 50),
 ('Milpitas', 37.428, -121.905, 95, 60), ('Morgan Hill', 37.130, -121.650, 70, 20),
 ('Santa Cruz', 36.985, -122.020, 130, 55), ('Scotts Valley', 37.050, -122.012, 25, 8),
 ('Fremont', 37.535, -121.975, 235, 125), ('Union City', 37.590, -122.040, 125, 45),
 ('Hayward', 37.655, -122.090, 180, 80), ('San Leandro', 37.715, -122.160, 120, 55),
 ('Castro Valley', 37.693, -122.075, 66, 12),
 ('Oakland', 37.805, -122.272, 300, 240), ('Alameda', 37.770, -122.262, 78, 28),
 ('Berkeley', 37.868, -122.298, 160, 125), ('Richmond', 37.930, -122.325, 170, 50),
 ('Hercules', 38.010, -122.268, 60, 10), ('Orinda', 37.880, -122.185, 60, 12),
 ('Walnut Creek', 37.898, -122.068, 115, 80), ('Concord', 37.975, -122.040, 170, 65),
 ('Martinez', 38.010, -122.125, 55, 28), ('Pittsburg', 38.015, -121.890, 105, 22),
 ('Antioch', 38.000, -121.800, 150, 25), ('San Ramon', 37.775, -121.975, 130, 60),
 ('Dublin', 37.702, -121.925, 155, 100), ('Livermore', 37.700, -121.770, 90, 55),
 ('Vallejo', 38.105, -122.240, 125, 35), ('Benicia', 38.060, -122.155, 28, 14),
 ('Fairfield', 38.245, -122.050, 150, 50), ('Napa', 38.300, -122.295, 80, 38),
 ('American Canyon', 38.170, -122.255, 22, 6), ('Sonoma', 38.290, -122.460, 30, 10),
 ('Petaluma', 38.240, -122.635, 62, 30), ('Novato', 38.100, -122.565, 55, 24),
 ('San Rafael', 37.972, -122.520, 95, 55), ('Mill Valley', 37.895, -122.520, 45, 16),
 ('Sausalito', 37.858, -122.490, 12, 6),
]
# gateways: where roads leave the map. (side, ref) -> name, residents, jobs
GATES = {
 ('N', '101'): ('Santa Rosa', 150, 55), ('E', '80'): ('Sacramento', 170, 45), ('N', '80'): ('Sacramento', 170, 45),
 ('E', '101'): ('Gilroy', 90, 22), ('W', '116'): ('Sebastopol', 30, 8),
 ('E', '580'): ('Tracy', 190, 20), ('S', '101'): ('Gilroy', 90, 22),
 ('S', '1'): ('Watsonville', 55, 14), ('E', '4'): ('Stockton', 75, 10),
 ('E', '12'): ('Rio Vista', 20, 4), ('N', '29'): ('Calistoga', 25, 12),
 ('N', '12'): ('Kenwood', 25, 8), ('N', '121'): ('Lake Berryessa', 6, 1),
 ('N', '116'): ('Sebastopol', 30, 8), ('W', '1'): ('Point Reyes', 6, 2),
 ('N', '1'): ('Point Reyes', 6, 2), ('E', '160'): ('Isleton', 8, 2),
 ('E', '84'): ('Tracy', 20, 3), ('N', '505'): ('Winters', 20, 4),
 ('S', '152'): ('Hollister', 30, 6), ('S', '129'): ('Aromas', 10, 2),
 ('E', '152'): ('Los Banos', 25, 4), ('S', '25'): ('Hollister', 30, 6),
 ('N', '128'): ('Winters', 10, 2), ('N', '113'): ('Davis', 30, 15),
}

def split_edge_at(e, i, q):
    E = g.rm(e)
    n = g.node(q)
    pa = E['pts'][:i + 1] + [g.pos[n]]; pb = [g.pos[n]] + E['pts'][i + 1:]
    g.add(E['a'], n, pa, E['ref'], E['cls'], E['pre']); g.add(n, E['b'], pb, E['ref'], E['cls'], E['pre'])
    return n

zones = []; used = set()
def node_rank(n): return max(RANK[g.edges[e]['cls']] for e in g.adj[n])
for name, lat, lon, pop, jobs in CITIES:
    c = proj(lon, lat)
    # score = distance, discounted for bigger roads so towns hang off their freeway
    best = (1e9, None)
    for n, p in g.pos.items():
        if n in used or n in g.fixed: continue
        sc = dist(c, p) - 0.7 * node_rank(n)
        if sc < best[0]: best = (sc, ('n', n))
    for e, E in g.edges.items():
        d, i, q = nearest_on(E['pts'], c)
        sc = d - 0.7 * RANK[E['cls']] + 0.6
        if sc < best[0] and min(dist(q, g.pos[E['a']]), dist(q, g.pos[E['b']])) > 1.0:
            best = (sc, ('e', e, i, q))
    b = best[1]
    n = b[1] if b[0] == 'n' else split_edge_at(b[1], b[2], b[3])
    if dist(g.pos[n], c) > 4: print('  far zone', name, round(dist(g.pos[n], c), 1))
    used.add(n); zones.append(dict(name=name, node=n, pop=pop, jobs=jobs, gw=0, at=c))

keepers = {z['node'] for z in zones}
prune_stubs(keepers)
join_deg2_keep = keepers
# gateways
for n in list(g.fixed):
    if n not in g.pos: continue
    p = g.pos[n]
    side = 'W' if p[0] < 0.01 else 'E' if p[0] > GW - 0.01 else 'N' if p[1] < 0.01 else 'S'
    E = g.edges[next(iter(g.adj[n]))]
    info = GATES.get((side, E['ref']))
    if not info:
        info = ('CA-%s %s' % (E['ref'], side) if E['ref'] else 'Back road ' + side, 10 if E['cls'] != 'sec' else 5, 2)
        print('  unnamed gate', side, E['ref'], E['cls'], [round(v, 1) for v in p])
    zones.append(dict(name=info[0], node=n, pop=info[1], jobs=info[2], gw=1, at=p))

# join remaining degree-2 chains except at zones, then split long edges
g.fixed |= keepers
join_deg2()
MAXLEN = 7.5
for e in list(g.edges):
    E = g.edges[e]; L = plen(E['pts'])
    if L <= MAXLEN: continue
    k = math.ceil(L / 6.0); step = L / k
    E = g.rm(e); pts = E['pts']; cur = [pts[0]]; acc = 0; start = E['a']; made = 0
    for i in range(1, len(pts)):
        a, b = cur[-1], pts[i]; d = dist(a, b)
        while made < k - 1 and acc + d >= step * (made + 1) - 1e-9 and d > 0:
            t = (step * (made + 1) - acc) / d
            q = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
            n = g.node(q); cur.append(g.pos[n])
            g.add(start, n, cur, E['ref'], E['cls'], E['pre']); start = n; cur = [g.pos[n]]; made += 1
            acc = step * made; a = cur[-1]; d = dist(a, b)
        acc += d; cur.append(b)
    g.add(start, E['b'], cur, E['ref'], E['cls'], E['pre'])
print('final: nodes', len(g.pos), 'edges', len(g.edges), 'zones', len(zones))

# ---- 5. attributes ----------------------------------------------------------
FWY_LANES = {'101': 4, '280': 4, '880': 4, '80': 4, '580': 4, '680': 3, '24': 3, '92': 3, '84': 2,
             '237': 3, '85': 3, '87': 2, '17': 2, '4': 3, '242': 3, '780': 2, '980': 3, '380': 3,
             '238': 3, '13': 2, '37': 2, '12': 2, '29': 2, '1': 2, '205': 3, '505': 2}
BR_LANES = {'80': 4, '101': 3, '580': 2, '680': 3, '92': 3, '84': 2, '160': 1}
def lanes(E):
    if E['cls'] == 'fwy': return FWY_LANES.get(E['ref'], 2)
    if E['cls'] == 'br': return BR_LANES.get(E['ref'], 2)
    if E['cls'] == 'pri': return 3 if E['ref'] in ('1', '101') else 2
    return 1
BRIDGES = [  # (ref, lat, lon, name) matched to 'br' edges by midpoint
 ('80', 37.80, -122.36, 'Bay Bridge'), ('80', 38.06, -122.225, 'Carquinez Bridge'),
 ('101', 37.82, -122.478, 'Golden Gate Bridge'), ('580', 37.935, -122.44, 'Richmond-San Rafael Bridge'),
 ('680', 38.04, -122.12, 'Benicia Bridge'), ('92', 37.59, -122.20, 'San Mateo Bridge'),
 ('84', 37.505, -122.115, 'Dumbarton Bridge'), ('160', 38.02, -121.75, 'Antioch Bridge'),
]

# ---- 6. simplify + write ----------------------------------------------------
def dp(pts, tol):
    if len(pts) < 3: return pts
    a, b = pts[0], pts[-1]; dx, dy = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dy) or 1e-12
    md, mi = 0, 0
    for i in range(1, len(pts) - 1):
        d = abs((pts[i][0] - a[0]) * dy - (pts[i][1] - a[1]) * dx) / L
        if d > md: md, mi = d, i
    if md <= tol: return [a, b]
    return dp(pts[:mi + 1], tol)[:-1] + dp(pts[mi:], tol)

def flat(pts): return [round(v, 2) for p in pts for v in p]

nid = {n: i for i, n in enumerate(sorted(g.pos, key=lambda n: (g.pos[n][1], g.pos[n][0])))}
nodes = [None] * len(nid)
for n, i in nid.items(): nodes[i] = [round(g.pos[n][0], 2), round(g.pos[n][1], 2)]
edges = []
for e, E in sorted(g.edges.items()):
    pts = dp(E['pts'], 0.05)
    d = dict(a=nid[E['a']], b=nid[E['b']], r=E['ref'], h=E['pre'], c=E['cls'], l=lanes(E), p=flat(pts))
    if E['cls'] == 'br':
        mid = pts[len(pts) // 2]
        cand = sorted((dist(mid, proj(lon, lat)), nm) for ref, lat, lon, nm in BRIDGES if ref == E['ref'])
        if cand and cand[0][0] < 12: d['n'] = cand[0][1]
    edges.append(d)
zout = [dict(n=z['name'], i=nid[z['node']], p=z['pop'], j=z['jobs'], g=z['gw']) for z in zones]

# land
def clip_poly(ring, box):
    x0, y0, x1, y1 = box
    def clip(pts, inside, inter):
        out = []
        for i in range(len(pts)):
            a, b = pts[i - 1], pts[i]
            ia, ib = inside(a), inside(b)
            if ia and ib: out.append(b)
            elif ia and not ib: out.append(inter(a, b))
            elif not ia and ib: out.append(inter(a, b)); out.append(b)
        return out
    def ix(x): return lambda a, b: (x, a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]))
    def iy(y): return lambda a, b: (a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]), y)
    for inside, inter in ((lambda p: p[0] >= x0, ix(x0)), (lambda p: p[0] <= x1, ix(x1)),
                          (lambda p: p[1] >= y0, iy(y0)), (lambda p: p[1] <= y1, iy(y1))):
        ring = clip(ring, inside, inter)
        if not ring: return []
    return ring
land = []
cc = json.load(open(SRC + '/cacounties.geojson'))
for f in cc['features']:
    gm = f['geometry']; polys = [gm['coordinates']] if gm['type'] == 'Polygon' else gm['coordinates']
    for poly in polys:
        ring = clip_poly([proj(p[0], p[1]) for p in poly[0]], RB)   # outer ring only
        if len(ring) >= 3: land.append(flat(ring))
print('land polys', len(land), 'pts', sum(len(l) for l in land) // 2)

data = dict(w=round(GW, 2), h=round(GH, 2), nodes=nodes, edges=edges, zones=zout, land=land,
            src='Roads: Natural Earth (public domain). Shoreline: US Census county outlines.')
js = 'window.BAY_MAP=' + json.dumps(data, separators=(',', ':')) + ';\n'
open(OUT, 'w').write(js)
print('wrote', OUT, len(js) // 1024, 'KB', 'road pts', sum(len(e['p']) for e in edges) // 2)
if DEBUG: json.dump(data, open(DEBUG, 'w'))
