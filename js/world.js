// World model: turns the OpenStreetMap extract into buildings, roads and a zoning grid.
'use strict';

SG.CELL = 20; // metres per zoning cell

SG.World = class World {
  constructor(map) {
    this.map = map;
    const d = 0.1; // decimetres -> metres
    const toM = arr => { const a = new Float32Array(arr.length); for (let i = 0; i < arr.length; i++) a[i] = arr[i] * d; return a; };
    const [x0, y0, x1, y1] = map.bounds.map(v => v * d);
    this.x0 = x0; this.y0 = y0; this.x1 = x1; this.y1 = y1;
    this.W = Math.ceil((x1 - x0) / SG.CELL);
    this.H = Math.ceil((y1 - y0) / SG.CELL);
    this.boundary = map.boundary.map(toM);

    this.buildings = [];
    for (const b of map.buildings) this.addBuildingRaw({
      kind: b.k, pts: toM(b.p), inCity: !!b.in, levels: b.l || 0,
      name: b.n || '', hn: b.h || '', street: b.s || '', amenity: b.a || '', original: true,
    });
    this.roads = [];
    for (const r of map.roads) this.addRoadRaw({ cls: r.c, pts: toM(r.p), name: r.n || '', original: true });
    this.areas = map.areas.map((a, i) => ({ id: i, kind: a.k, pts: toM(a.p), name: a.n || '' }));
    this.water = map.water.map(w => ({ pts: toM(w.p), name: w.n || '' }));
    this.pois = map.pois.map(([name, kind, x, y]) => ({ name, kind, x: x * d, y: y * d }));
    this.playerParks = [];

    this.buildIndexes();
    this.rasterize();
    this.inferZoning();
    for (const b of this.buildings) this.initBuilding(b);
    this.computeClaims();
  }

  // ---------- geometry helpers ----------
  static polyArea(p) {
    let a = 0; const n = p.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) a += p[2 * j] * p[2 * i + 1] - p[2 * i] * p[2 * j + 1];
    return Math.abs(a / 2);
  }
  static centroid(p) {
    let x = 0, y = 0; const n = p.length / 2;
    for (let i = 0; i < n; i++) { x += p[2 * i]; y += p[2 * i + 1]; }
    return [x / n, y / n];
  }
  static bbox(p) {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (let i = 0; i < p.length; i += 2) {
      if (p[i] < a) a = p[i]; if (p[i] > c) c = p[i];
      if (p[i + 1] < b) b = p[i + 1]; if (p[i + 1] > d) d = p[i + 1];
    }
    return [a, b, c, d];
  }
  static pointInPoly(x, y, p) {
    let inside = false; const n = p.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = p[2 * i], yi = p[2 * i + 1], xj = p[2 * j], yj = p[2 * j + 1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  static segDist2(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const qx = ax + t * dx - px, qy = ay + t * dy - py;
    return qx * qx + qy * qy;
  }
  inCityPoint(x, y) { return this.boundary.some(r => World.pointInPoly(x, y, r)); }
  cellOf(x, y) {
    const cx = Math.floor((x - this.x0) / SG.CELL), cy = Math.floor((y - this.y0) / SG.CELL);
    if (cx < 0 || cy < 0 || cx >= this.W || cy >= this.H) return -1;
    return cy * this.W + cx;
  }
  cellCenter(i) { return [this.x0 + (i % this.W + 0.5) * SG.CELL, this.y0 + (Math.floor(i / this.W) + 0.5) * SG.CELL]; }

  // ---------- entities ----------
  addBuildingRaw(b) {
    b.id = this.buildings.length;
    b.area = World.polyArea(b.pts);
    [b.cx, b.cy] = World.centroid(b.pts);
    b.bb = World.bbox(b.pts);
    b.removed = false;
    this.buildings.push(b);
    return b;
  }
  addRoadRaw(r) {
    r.id = this.roads.length;
    r.bb = World.bbox(r.pts);
    let len = 0;
    for (let i = 2; i < r.pts.length; i += 2) len += Math.hypot(r.pts[i] - r.pts[i - 2], r.pts[i + 1] - r.pts[i - 1]);
    r.len = len;
    r.removed = false;
    this.roads.push(r);
    return r;
  }

  // Bucket index (100 m buckets) for picking and culling.
  bucketKeys(bb, size, fn) {
    const a = Math.floor(bb[0] / size), b = Math.floor(bb[1] / size), c = Math.floor(bb[2] / size), d = Math.floor(bb[3] / size);
    for (let y = b; y <= d; y++) for (let x = a; x <= c; x++) fn(x + ',' + y);
  }
  indexBuilding(b) { this.bucketKeys(b.bb, 100, k => { let l = this.bIdx.get(k); if (!l) this.bIdx.set(k, l = []); l.push(b.id); }); }
  indexRoad(r) { this.bucketKeys(r.bb, 100, k => { let l = this.rIdx.get(k); if (!l) this.rIdx.set(k, l = []); l.push(r.id); }); }
  buildIndexes() {
    this.bIdx = new Map(); this.rIdx = new Map();
    for (const b of this.buildings) this.indexBuilding(b);
    for (const r of this.roads) this.indexRoad(r);
  }
  query(idx, list, bb) {
    const out = new Set();
    this.bucketKeys(bb, 100, k => { const l = idx.get(k); if (l) for (const id of l) if (!list[id].removed) out.add(id); });
    return [...out].map(id => list[id]);
  }
  buildingsIn(bb) { return this.query(this.bIdx, this.buildings, bb); }
  roadsIn(bb) { return this.query(this.rIdx, this.roads, bb); }

  buildingAt(x, y) {
    let best = null;
    for (const b of this.buildingsIn([x, y, x, y]))
      if (World.pointInPoly(x, y, b.pts) && (!best || b.area < best.area)) best = b;
    return best;
  }
  nearestRoad(x, y, maxD = 60, drivableOnly = true) {
    let best = null, bd = maxD * maxD, seg = 0;
    for (const r of this.roadsIn([x - maxD, y - maxD, x + maxD, y + maxD])) {
      if (drivableOnly && r.cls > 4) continue;
      const p = r.pts;
      for (let i = 2; i < p.length; i += 2) {
        const d2 = World.segDist2(x, y, p[i - 2], p[i - 1], p[i], p[i + 1]);
        if (d2 < bd) { bd = d2; best = r; seg = i; }
      }
    }
    if (!best) return null;
    const p = best.pts;
    return { road: best, dist: Math.sqrt(bd), angle: Math.atan2(p[seg + 1] - p[seg - 1], p[seg] - p[seg - 2]) };
  }
  areaAt(x, y) {
    let best = null;
    for (const a of this.areas) {
      if (a.removed) continue;
      if (!a.bb) a.bb = World.bbox(a.pts);
      if (x < a.bb[0] || x > a.bb[2] || y < a.bb[1] || y > a.bb[3]) continue;
      if (World.pointInPoly(x, y, a.pts) && (!best || World.polyArea(a.pts) < World.polyArea(best.pts))) best = a;
    }
    return best;
  }

  // ---------- rasters ----------
  fillPoly(p, fn) {
    // scanline fill of cell centres inside polygon p
    const [, minY, , maxY] = World.bbox(p);
    const n = p.length / 2;
    const r0 = Math.max(0, Math.floor((minY - this.y0) / SG.CELL)), r1 = Math.min(this.H - 1, Math.floor((maxY - this.y0) / SG.CELL));
    const xs = [];
    for (let r = r0; r <= r1; r++) {
      const y = this.y0 + (r + 0.5) * SG.CELL;
      xs.length = 0;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const yi = p[2 * i + 1], yj = p[2 * j + 1];
        if ((yi > y) !== (yj > y)) xs.push(p[2 * i] + (y - yi) * (p[2 * j] - p[2 * i]) / (yj - yi));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.ceil((xs[k] - this.x0) / SG.CELL - 0.5));
        const c1 = Math.min(this.W - 1, Math.floor((xs[k + 1] - this.x0) / SG.CELL - 0.5));
        for (let c = c0; c <= c1; c++) fn(r * this.W + c);
      }
    }
  }
  traceLine(p, fn) {
    for (let i = 2; i < p.length; i += 2) {
      const ax = p[i - 2], ay = p[i - 1], bx = p[i], by = p[i + 1];
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (SG.CELL * 0.5)));
      for (let s = 0; s <= steps; s++) {
        const c = this.cellOf(ax + (bx - ax) * s / steps, ay + (by - ay) * s / steps);
        if (c >= 0) fn(c);
      }
    }
  }
  rasterize() {
    const N = this.W * this.H;
    this.inCity = new Uint8Array(N);
    for (const r of this.boundary) this.fillPoly(r, i => { this.inCity[i] = 1; });
    this.cityCells = 0;
    for (let i = 0; i < N; i++) this.cityCells += this.inCity[i];

    // area kinds: 1 park/grass/golf/water/forest (open), 2 campus/civic/cemetery, 3 commercial landuse, 4 water
    this.areaK = new Uint8Array(N);
    const code = { park: 1, golf: 1, forest: 1, grass: 1, sports: 1, orchard: 1, campus: 2, civic: 2, cemetery: 2, commercial: 3, water: 4 };
    for (const a of this.areas) { const k = code[a.kind]; if (k) this.fillPoly(a.pts, i => { this.areaK[i] = k; }); }
    this.computeRoadDist();

    // village mask: within ~160 m of Big Basin Way
    this.village = new Uint8Array(N);
    const seeds = [];
    for (const r of this.roads) if (/big basin/i.test(r.name)) this.traceLine(r.pts, c => seeds.push(c));
    this.dilate(seeds, 8, this.village);
  }
  dilate(seeds, radius, out) {
    const dist = new Int16Array(this.W * this.H).fill(-1);
    let q = seeds.slice(); for (const s of q) dist[s] = 0;
    for (let d = 0; d < radius && q.length; d++) {
      const nq = [];
      for (const c of q) {
        out[c] = 1;
        const x = c % this.W, y = (c / this.W) | 0;
        if (x > 0 && dist[c - 1] < 0) { dist[c - 1] = d + 1; nq.push(c - 1); }
        if (x < this.W - 1 && dist[c + 1] < 0) { dist[c + 1] = d + 1; nq.push(c + 1); }
        if (y > 0 && dist[c - this.W] < 0) { dist[c - this.W] = d + 1; nq.push(c - this.W); }
        if (y < this.H - 1 && dist[c + this.W] < 0) { dist[c + this.W] = d + 1; nq.push(c + this.W); }
      }
      q = nq;
    }
    for (const c of q) out[c] = 1;
  }
  computeRoadDist() {
    const N = this.W * this.H;
    const dist = this.roadDist = new Uint8Array(N).fill(255);
    let q = [];
    for (const r of this.roads) if (!r.removed && r.cls <= 4)
      this.traceLine(r.pts, c => { if (dist[c]) { dist[c] = 0; q.push(c); } });
    for (let d = 1; d < 60 && q.length; d++) {
      const nq = [];
      for (const c of q) {
        const x = c % this.W;
        const nb = [x > 0 ? c - 1 : -1, x < this.W - 1 ? c + 1 : -1, c - this.W, c + this.W];
        for (const n of nb) if (n >= 0 && n < N && dist[n] === 255) { dist[n] = d; nq.push(n); }
      }
      q = nq;
    }
  }

  // Infer a zoning map from what is actually built: lot sizes from house density,
  // commercial strips, schools, parks and empty hillsides.
  inferZoning() {
    const W = this.W, H = this.H, N = W * H;
    const mk = () => new Float32Array(N);
    const house = mk(), com = mk(), apt = mk(), civ = mk(), any = mk();
    for (const b of this.buildings) {
      const c = this.cellOf(b.cx, b.cy); if (c < 0) continue;
      any[c]++;
      if (b.kind === 'house' && b.area >= 45) house[c]++;
      else if (b.kind === 'apartments') apt[c] += 1;
      else if (b.kind === 'commercial') com[c] += 1;
      else if (b.kind === 'school' || b.kind === 'civic') civ[c] += 1;
    }
    const sat = r => { // summed-area table, (W+1)x(H+1)
      const s = new Float64Array((W + 1) * (H + 1));
      for (let y = 0; y < H; y++) { let row = 0; for (let x = 0; x < W; x++) { row += r[y * W + x]; s[(y + 1) * (W + 1) + x + 1] = s[y * (W + 1) + x + 1] + row; } }
      return (cx, cy, rad) => {
        const a = Math.max(0, cx - rad), b = Math.max(0, cy - rad), c = Math.min(W, cx + rad + 1), d = Math.min(H, cy + rad + 1);
        return s[d * (W + 1) + c] - s[b * (W + 1) + c] - s[d * (W + 1) + a] + s[b * (W + 1) + a];
      };
    };
    const sH = sat(house), sC = sat(com), sA = sat(apt), sV = sat(civ), sAny = sat(any);
    const Z = SG.Z;
    const zone = new Uint8Array(N);
    const R = 6, win = (2 * R + 1) ** 2 * SG.CELL * SG.CELL;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!this.inCity[i]) continue;
      const ak = this.areaK[i];
      const nearHouses = sH(x, y, 2);
      let z;
      if ((ak === 1 || ak === 4) && nearHouses === 0) z = Z.OS;
      else if (ak === 2 || sV(x, y, 1) > 0) z = Z.PF;
      else if (ak === 3 || sC(x, y, 1) > 0) z = this.village[i] ? Z.C_H : Z.C_N;
      else if (sA(x, y, 1) > 0) z = Z.R_M;
      else {
        const n = sH(x, y, R);
        if (n >= 1) {
          const lot = win * 0.8 / n;
          z = lot < 1150 ? Z.R_1_10_000 : lot < 1700 ? Z.R_1_12_500 : lot < 3000 ? Z.R_1_20_000 : lot < 6500 ? Z.R_1_40_000 : Z.HR;
        } else z = sAny(x, y, 15) > 0 ? Z.HR : Z.OS;
      }
      zone[i] = z;
    }
    // one majority-filter pass to clean speckle
    const out = zone.slice();
    const cnt = new Uint8Array(SG.ZONES.length);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x; if (!zone[i]) continue;
      cnt.fill(0);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) cnt[zone[i + dy * W + dx]]++;
      let best = zone[i], bc = cnt[best];
      for (let k = 1; k < cnt.length; k++) if (cnt[k] > bc + 1) { best = k; bc = cnt[k]; }
      out[i] = best;
    }
    this.zone = out;
  }
  zoneAt(x, y) { const c = this.cellOf(x, y); return c < 0 ? 0 : this.zone[c]; }

  initBuilding(b) {
    const k = b.kind;
    const fp = b.area;
    if (!b.levels) b.levels = k === 'apartments' ? 2 : k === 'house' ? (fp > 260 ? 2 : 1) : k === 'mixeduse' ? 3 : 1;
    if (k === 'house' && fp < 45) b.kind = 'accessory';
    const floor = fp * b.levels;
    if (b.units == null) {
      if (b.kind === 'house' || b.kind === 'adu') b.units = 1;
      else if (b.kind === 'duplex') b.units = 2;
      else if (b.kind === 'apartments' || b.kind === 'townhomes') b.units = Math.max(2, Math.round(floor / 95));
      else if (b.kind === 'mixeduse') b.units = Math.max(4, Math.round(floor * 0.75 / 85));
      else b.units = 0;
    }
    if (b.jobs == null) {
      b.jobs = b.kind === 'commercial' ? Math.round(floor * SG.ECON.jobsPerCommercialM2)
        : b.kind === 'mixeduse' ? Math.round(floor * 0.25 * SG.ECON.jobsPerCommercialM2)
        : b.kind === 'school' ? Math.round(floor / 60)
        : (b.kind === 'civic' || b.kind === 'utility') ? Math.round(floor / 90) : (b.jobs || 0);
    }
    if (b.value == null) {
      const zf = [1, 1.35, 1.25, 1.1, 1.0, 0.95, 0.9, 0.95, 1, 1.1, 1, 1][this.zoneAt(b.cx, b.cy)] || 1;
      if (b.units) b.value = Math.round((b.kind === 'house' ? 420000 + floor * 2300 : b.units * 520000) * zf);
      else if (b.jobs) b.value = Math.round(floor * 4200);
      else b.value = Math.round(floor * 800);
    }
    if (!b.inCity) { b.units = b.units; } // neighbours: counted for display only
  }

  // Each home "owns" a lot around it so growth knows where land is vacant.
  computeClaims() {
    this.claim = new Int32Array(this.W * this.H).fill(-1);
    for (const b of this.buildings) if (!b.removed) this.claimFor(b);
    for (const p of this.playerParks) this.fillPoly(p.pts, i => { this.claim[i] = -2; });
  }
  claimFor(b) {
    const z = SG.ZONES[this.zoneAt(b.cx, b.cy)] || SG.ZONES[5];
    let lot;
    if (b.kind === 'accessory' || b.kind === 'adu') return;
    if (b.kind === 'house' || b.kind === 'duplex') lot = Math.min(z.minLot || 1000, 8000);
    else lot = b.area / Math.max(0.2, z.coverage || 0.5);
    const r = Math.sqrt(lot / Math.PI);
    const c0 = Math.floor((b.cx - r - this.x0) / SG.CELL), c1 = Math.floor((b.cx + r - this.x0) / SG.CELL);
    const r0 = Math.floor((b.cy - r - this.y0) / SG.CELL), r1 = Math.floor((b.cy + r - this.y0) / SG.CELL);
    for (let y = Math.max(0, r0); y <= Math.min(this.H - 1, r1); y++)
      for (let x = Math.max(0, c0); x <= Math.min(this.W - 1, c1); x++) {
        const [px, py] = this.cellCenter(y * this.W + x);
        if (Math.hypot(px - b.cx, py - b.cy) <= r) this.claim[y * this.W + x] = b.id;
      }
    this.fillPoly(b.pts, i => { this.claim[i] = b.id; });
  }

  // Rectangle footprint centred at (x,y), rotated by angle.
  static rect(x, y, w, d, angle) {
    const c = Math.cos(angle), s = Math.sin(angle), hw = w / 2, hd = d / 2;
    const pts = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
    const out = new Float32Array(8);
    pts.forEach(([u, v], i) => { out[2 * i] = x + u * c - v * s; out[2 * i + 1] = y + u * s + v * c; });
    return out;
  }
  // Buildings that go away when `b` is redeveloped: it plus sheds and garages on its lot.
  lotGroup(b) {
    const out = new Set([b.id]);
    for (const o of this.buildingsIn([b.cx - 40, b.cy - 40, b.cx + 40, b.cy + 40])) {
      if (o.kind !== 'accessory' && o.kind !== 'adu') continue;
      const c = this.cellOf(o.cx, o.cy);
      if (c >= 0 && this.claim[c] === b.id) out.add(o.id);
      else if (Math.hypot(o.cx - b.cx, o.cy - b.cy) < 25) out.add(o.id);
    }
    return out;
  }
  footprintClear(pts, ignore = null) {
    const bb = World.bbox(pts);
    if (typeof ignore === 'number') ignore = new Set([ignore]);
    for (const b of this.buildingsIn([bb[0] - 2, bb[1] - 2, bb[2] + 2, bb[3] + 2])) {
      if (ignore && ignore.has(b.id)) continue;
      if (World.polysOverlap(pts, b.pts)) return false;
    }
    for (const r of this.roadsIn(bb)) {
      if (r.cls > 4) continue;
      const p = r.pts;
      for (let i = 0; i < p.length; i += 2) if (World.pointInPoly(p[i], p[i + 1], pts)) return false;
      for (let i = 2; i < p.length; i += 2)
        for (let k = 0; k < 4; k++) {
          const mx = (pts[2 * k] + pts[(2 * k + 2) % 8]) / 2, my = (pts[2 * k + 1] + pts[(2 * k + 3) % 8]) / 2;
          if (World.segDist2(mx, my, p[i - 2], p[i - 1], p[i], p[i + 1]) < 16) return false;
        }
    }
    const [cx, cy] = World.centroid(pts);
    const c = this.cellOf(cx, cy);
    if (c < 0 || this.areaK[c] === 4) return false;
    return true;
  }
  static polysOverlap(a, b) {
    for (let i = 0; i < a.length; i += 2) if (World.pointInPoly(a[i], a[i + 1], b)) return true;
    for (let i = 0; i < b.length; i += 2) if (World.pointInPoly(b[i], b[i + 1], a)) return true;
    const [ax, ay] = World.centroid(a);
    return World.pointInPoly(ax, ay, b);
  }

  // Place a new building, oriented to the nearest street. Returns building or null.
  placeBuilding(x, y, spec, extra = {}) {
    const nr = this.nearestRoad(x, y, 120);
    const ang = nr ? nr.angle : 0;
    const pts = World.rect(x, y, spec.w, spec.d, ang);
    const b = this.addBuildingRaw(Object.assign({
      kind: spec.kind, pts, inCity: true, levels: spec.levels || 1, name: extra.name || '',
      hn: extra.hn || '', street: extra.street || (nr ? nr.road.name : ''), units: spec.units || 0, jobs: spec.jobs,
      built: extra.built, player: true,
    }, extra));
    this.initBuilding(b);
    this.indexBuilding(b);
    this.claimFor(b);
    return b;
  }
  removeBuilding(b) {
    b.removed = true;
    for (let i = 0; i < this.claim.length; i++) if (this.claim[i] === b.id) this.claim[i] = -1;
  }
  addRoad(pts, cls = 3, name = '') {
    const r = this.addRoadRaw({ cls, pts: new Float32Array(pts), name, player: true });
    this.indexRoad(r);
    this.computeRoadDist();
    return r;
  }
  removeRoad(r) { r.removed = true; this.computeRoadDist(); }
  addPark(x, y, w, d) {
    const nr = this.nearestRoad(x, y, 150);
    const pts = World.rect(x, y, w, d, nr ? nr.angle : 0);
    const a = { id: this.areas.length, kind: 'park', pts, name: 'New park', player: true };
    this.areas.push(a); this.playerParks.push(a);
    this.fillPoly(pts, i => { this.areaK[i] = 1; this.claim[i] = -2; });
    return a;
  }

  // ---------- metrics ----------
  addressOf(b) {
    if (b.hn && b.street) return b.hn + ' ' + b.street;
    if (b.street) return b.street;
    const nr = this.nearestRoad(b.cx, b.cy, 120, false);
    return nr && nr.road.name ? 'near ' + nr.road.name : '';
  }
  roadKm() {
    let m = 0;
    for (const r of this.roads) if (!r.removed && r.cls <= 3) {
      const [cx, cy] = World.centroid(r.pts);
      if (this.inCityPoint(cx, cy)) m += r.len;
    }
    return m / 1000;
  }
};
