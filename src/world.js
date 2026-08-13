// ---------------------------------------------------------------------------
// world.js - terrain, the road network, surface queries and road geometry.
//
// Both the circuit and the drive home are described as a set of Paths: a
// centre spline plus a width and a surface. Everything else - what the car is
// standing on, where the AI should aim, where the barriers go - is derived
// from that.
// ---------------------------------------------------------------------------

const VERGE_WIDTH = 9.0;      // metres of blend from road edge to open terrain
const QUERY_MARGIN = 18.0;

// --- terrain ----------------------------------------------------------------

function makeTerrain(seed) {
  const rng = makeRng(seed);
  const perm = new Uint8Array(512);
  const base = new Uint8Array(256);
  for (let i = 0; i < 256; i++) base[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = base[i]; base[i] = base[j]; base[j] = t;
  }
  for (let i = 0; i < 512; i++) perm[i] = base[i & 255];

  const grad = (h, x, z) => {
    const a = (h & 7) * (Math.PI / 4);
    return Math.cos(a) * x + Math.sin(a) * z;
  };
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

  function noise(x, z) {
    const xi = Math.floor(x) & 255, zi = Math.floor(z) & 255;
    const xf = x - Math.floor(x), zf = z - Math.floor(z);
    const u = fade(xf), v = fade(zf);
    const aa = perm[perm[xi] + zi], ab = perm[perm[xi] + zi + 1];
    const ba = perm[perm[xi + 1] + zi], bb = perm[perm[xi + 1] + zi + 1];
    const x1 = lerp(grad(aa, xf, zf), grad(ba, xf - 1, zf), u);
    const x2 = lerp(grad(ab, xf, zf - 1), grad(bb, xf - 1, zf - 1), u);
    return lerp(x1, x2, v);
  }

  return function height(x, z) {
    let h = 0;
    h += noise(x / 340, z / 340) * 7.5;
    h += noise(x / 145, z / 145) * 2.6;
    h += noise(x / 58, z / 58) * 0.85;
    h += noise(x / 21, z / 21) * 0.22;
    return h;
  };
}

// --- paths ------------------------------------------------------------------

class Path {
  constructor(control, options = {}) {
    this.closed = !!options.closed;
    this.halfWidth = options.halfWidth !== undefined ? options.halfWidth : 5.0;
    this.surface = options.surface || SURFACES.asphalt;
    this.kerbs = !!options.kerbs;
    this.kerbWidth = options.kerbWidth || 1.1;
    this.type = options.type || 'road';         // 'track' | 'road' | 'street' | 'drive'
    this.speedLimit = options.speedLimit || 0;  // km/h, 0 = unlimited
    this.lanes = options.lanes || 2;
    this.markings = options.markings !== undefined ? options.markings : true;
    this.name = options.name || '';
    this.banking = options.banking || 0;
    this.spline = buildSpline(control, this.closed, options.spacing || 5.0);
    this.length = this.spline.length;
  }

  point(i) { return this.spline.points[((i % this.spline.count) + this.spline.count) % this.spline.count]; }
  normal(i) { return this.spline.normals[((i % this.spline.count) + this.spline.count) % this.spline.count]; }
  tangent(i) { return this.spline.tangents[((i % this.spline.count) + this.spline.count) % this.spline.count]; }

  // Position at a lateral offset from the centreline.
  offsetPoint(i, lateral, out = [0, 0, 0]) {
    const p = this.point(i), n = this.normal(i);
    out[0] = p[0] + n[0] * lateral;
    out[1] = p[1];
    out[2] = p[2] + n[2] * lateral;
    return out;
  }
}

// --- world ------------------------------------------------------------------

class World {
  constructor(options = {}) {
    this.paths = [];
    this.cellSize = 24;
    this.grid = new Map();
    this.terrainHeightRaw = makeTerrain(options.seed || 1234);
    this.terrainScale = options.terrainScale !== undefined ? options.terrainScale : 1.0;
    this.props = [];            // static scenery, merged into batched meshes
    this.trafficLights = [];
    this.decorMeshes = [];
    this.bounds = { minX: -900, maxX: 900, minZ: -900, maxZ: 900 };
    this.skid = null;
    // Things you cannot drive through: tree trunks, poles, gate piers, walls.
    // Stored as upright circles, which is a fair fit for everything here and
    // cheap enough to test thousands of them every frame.
    this.solids = [];
    this.solidGrid = new Map();
    this.solidCell = 16;
    // Building outlines, for the collider audit. Not used at runtime.
    this.footprints = [];
  }

  // `hard` is how much of the impact the car keeps: a lamp post stops you, a
  // hedge mostly just slows you down.
  addSolid(x, z, r, hard = 1) { this.solids.push({ x, z, r, hard }); }

  // Each solid goes in the cells its own circle overlaps, and no more. The
  // query then widens by however far it needs to reach. Padding the index
  // instead - which is what this used to do - silently caps every query at the
  // padding distance, however large a radius it asks for, and a swept
  // collision test that cannot see more than three metres ahead is a swept
  // collision test that does not work.
  indexSolids() {
    this.solidGrid.clear();
    const cs = this.solidCell;
    for (let i = 0; i < this.solids.length; i++) {
      const s = this.solids[i];
      const x0 = Math.floor((s.x - s.r) / cs), x1 = Math.floor((s.x + s.r) / cs);
      const z0 = Math.floor((s.z - s.r) / cs), z1 = Math.floor((s.z + s.r) / cs);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cz = z0; cz <= z1; cz++) {
          const k = this.key(cx, cz);
          let list = this.solidGrid.get(k);
          if (!list) { list = []; this.solidGrid.set(k, list); }
          list.push(i);
        }
      }
    }
    this._solidStamp = new Int32Array(this.solids.length);
    this._solidQuery = 0;
  }

  // Every solid whose circle could touch a disc of `radius` at (x, z). A solid
  // spanning several cells appears in each of them, so results are stamped to
  // keep them unique.
  querySolids(x, z, radius, out) {
    out.length = 0;
    const cs = this.solidCell;
    const x0 = Math.floor((x - radius) / cs), x1 = Math.floor((x + radius) / cs);
    const z0 = Math.floor((z - radius) / cs), z1 = Math.floor((z + radius) / cs);
    const stamp = this._solidStamp;
    const tag = ++this._solidQuery;
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const list = this.solidGrid.get(this.key(cx, cz));
        if (!list) continue;
        for (const i of list) {
          if (stamp[i] === tag) continue;
          stamp[i] = tag;
          const s = this.solids[i];
          const dx = x - s.x, dz = z - s.z;
          const reach = s.r + radius;
          if (dx * dx + dz * dz < reach * reach) out.push(s);
        }
      }
    }
    return out;
  }

  terrain(x, z) { return this.terrainHeightRaw(x, z) * this.terrainScale; }

  addPath(path) { this.paths.push(path); return path; }

  key(cx, cz) { return cx * 100003 + cz; }

  // Flatten the terrain under every road, then index the samples spatially.
  index() {
    this.grid.clear();
    const cs = this.cellSize;
    for (let pi = 0; pi < this.paths.length; pi++) {
      const path = this.paths[pi];
      const reach = path.halfWidth + QUERY_MARGIN;
      const cells = Math.ceil(reach / cs);
      for (let i = 0; i < path.spline.count; i++) {
        const p = path.spline.points[i];
        const cx = Math.floor(p[0] / cs), cz = Math.floor(p[2] / cs);
        for (let dx = -cells; dx <= cells; dx++) {
          for (let dz = -cells; dz <= cells; dz++) {
            const k = this.key(cx + dx, cz + dz);
            let list = this.grid.get(k);
            if (!list) { list = []; this.grid.set(k, list); }
            list.push(pi, i);
          }
        }
      }
    }
  }

  // Nearest point on any road. Returns null when far from every road.
  query(x, z) {
    const cs = this.cellSize;
    const list = this.grid.get(this.key(Math.floor(x / cs), Math.floor(z / cs)));
    if (!list) return null;
    let best = null, bestD2 = Infinity;
    for (let n = 0; n < list.length; n += 2) {
      const pi = list[n], i = list[n + 1];
      const p = this.paths[pi].spline.points[i];
      const dx = x - p[0], dz = z - p[2];
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) { bestD2 = d2; best = [pi, i]; }
    }
    if (!best) return null;

    // Refine against the two segments adjacent to the nearest sample.
    const path = this.paths[best[0]];
    const sp = path.spline;
    const count = sp.count;
    let bestT = 0, bestIdx = best[1], bestDist2 = Infinity, bestPoint = null;
    for (let d = -1; d <= 0; d++) {
      const i0 = ((best[1] + d) % count + count) % count;
      const i1 = (i0 + 1) % count;
      if (!path.closed && (best[1] + d < 0 || i0 + 1 >= count)) continue;
      const a = sp.points[i0], b = sp.points[i1];
      const abx = b[0] - a[0], abz = b[2] - a[2];
      const len2 = abx * abx + abz * abz;
      let t = len2 > 1e-9 ? ((x - a[0]) * abx + (z - a[2]) * abz) / len2 : 0;
      t = clamp(t, 0, 1);
      const px = a[0] + abx * t, pz = a[2] + abz * t;
      const dd = (x - px) * (x - px) + (z - pz) * (z - pz);
      if (dd < bestDist2) {
        bestDist2 = dd;
        bestIdx = i0;
        bestT = t;
        bestPoint = [px, lerp(a[1], b[1], t), pz];
      }
    }
    if (!bestPoint) return null;

    const i0 = bestIdx, i1 = (bestIdx + 1) % count;
    const n0 = sp.normals[i0], n1 = sp.normals[i1];
    const nx = lerp(n0[0], n1[0], bestT), nz = lerp(n0[2], n1[2], bestT);
    const nl = Math.hypot(nx, nz) || 1;
    const lateral = ((x - bestPoint[0]) * nx + (z - bestPoint[2]) * nz) / nl;
    const along = sp.cumulative[i0] + bestT * (sp.cumulative[i1] - sp.cumulative[i0] || 0);

    return {
      pathIndex: best[0],
      path,
      index: i0,
      t: bestT,
      lateral,
      height: bestPoint[1],
      point: bestPoint,
      along,
      distance: Math.sqrt(bestDist2),
    };
  }

  // Ground height including the blend from road level out to open terrain.
  groundHeight(x, z) {
    const hit = this.query(x, z);
    const terrain = this.terrain(x, z);
    if (!hit) return terrain;
    const edge = hit.path.halfWidth + (hit.path.kerbs ? hit.path.kerbWidth : 0.4);
    const lat = Math.abs(hit.lateral);
    if (lat <= edge) return hit.height;
    const t = smoothstep(edge, edge + VERGE_WIDTH, lat);
    return lerp(hit.height, terrain, t);
  }

  // What the tyres are standing on.
  sampleSurface(x, z) {
    const hit = this.query(x, z);
    if (!hit) {
      return { height: this.terrain(x, z), surface: SURFACES.grass, onRoad: false, hit: null };
    }
    const lat = Math.abs(hit.lateral);
    const path = hit.path;
    if (lat <= path.halfWidth) {
      return { height: hit.height, surface: path.surface, onRoad: true, hit };
    }
    if (path.kerbs && lat <= path.halfWidth + path.kerbWidth) {
      // Kerbs are raised a little and rattle the car.
      const rise = 0.055 * smoothstep(path.halfWidth, path.halfWidth + 0.35, lat);
      return { height: hit.height + rise, surface: SURFACES.kerb, onRoad: true, hit };
    }
    const edge = path.halfWidth + (path.kerbs ? path.kerbWidth : 0.4);
    const t = smoothstep(edge, edge + VERGE_WIDTH, lat);
    const height = lerp(hit.height, this.terrain(x, z), t);
    let surface = SURFACES.grass;
    if (path.type === 'track') surface = lat < edge + 5 ? SURFACES.gravel : SURFACES.grass;
    else if (lat < edge + 1.6) surface = SURFACES.dirt;
    return { height, surface, onRoad: false, hit };
  }

  // Drop every road spline onto the terrain, then smooth it so the surface
  // rolls rather than following every bump.
  conformPathsToTerrain(smoothing = 6) {
    for (const path of this.paths) {
      const pts = path.spline.points;
      const raw = pts.map((p) => this.terrain(p[0], p[2]));
      const n = raw.length;
      let cur = raw.slice();
      for (let pass = 0; pass < smoothing; pass++) {
        const next = cur.slice();
        for (let i = 0; i < n; i++) {
          const a = cur[(i - 1 + n) % n], b = cur[i], c = cur[(i + 1) % n];
          if (!path.closed && (i === 0 || i === n - 1)) { next[i] = b; continue; }
          next[i] = a * 0.27 + b * 0.46 + c * 0.27;
        }
        cur = next;
      }
      for (let i = 0; i < n; i++) pts[i][1] = cur[i];
    }
  }

  // Nearest road distance, used to carve the terrain mesh around roads.
  nearRoad(x, z, radius) {
    const hit = this.query(x, z);
    if (!hit) return false;
    return Math.abs(hit.lateral) < hit.path.halfWidth + radius;
  }
}

// --- terrain mesh -----------------------------------------------------------

const GRASS_A = [0.176, 0.255, 0.106];
const GRASS_B = [0.235, 0.322, 0.129];
const DRY_GRASS = [0.345, 0.353, 0.180];

function buildTerrainMesh(world, opts = {}) {
  const {
    minX = -800, maxX = 800, minZ = -800, maxZ = 800,
    cell = 12, skipRadius = VERGE_WIDTH + 3,
  } = opts;
  const mb = new MeshBuilder();
  mb.mat(GRASS_A, 0.92, 0.0, 0.0, FLAG_DEFAULT);

  const cols = Math.ceil((maxX - minX) / cell);
  const rows = Math.ceil((maxZ - minZ) / cell);
  const rng = makeRng(99);

  // Pre-sample the height grid once; neighbours share vertices implicitly by
  // being evaluated at the same coordinates.
  const h = new Float32Array((cols + 1) * (rows + 1));
  const near = new Uint8Array((cols + 1) * (rows + 1));
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      const x = minX + i * cell, z = minZ + j * cell;
      h[j * (cols + 1) + i] = world.terrain(x, z);
      near[j * (cols + 1) + i] = world.nearRoad(x, z, skipRadius) ? 1 : 0;
    }
  }

  const colorAt = (x, z, y) => {
    const n = (Math.sin(x * 0.037) + Math.cos(z * 0.041) + Math.sin((x + z) * 0.013)) / 3;
    const dry = clamp(0.5 + n * 0.9, 0, 1);
    const c = v3.lerp([0, 0, 0], GRASS_A, GRASS_B, dry);
    return v3.lerp(c, DRY_GRASS, clamp((y + 2) * 0.05, 0, 0.35) * dry);
  };

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const i0 = j * (cols + 1) + i;
      const i1 = i0 + 1;
      const i2 = (j + 1) * (cols + 1) + i + 1;
      const i3 = (j + 1) * (cols + 1) + i;
      if (near[i0] && near[i1] && near[i2] && near[i3]) continue;   // road ribbons cover it

      const x0 = minX + i * cell, z0 = minZ + j * cell;
      const x1 = x0 + cell, z1 = z0 + cell;
      const p0 = [x0, h[i0], z0];
      const p1 = [x1, h[i1], z0];
      const p2 = [x1, h[i2], z1];
      const p3 = [x0, h[i3], z1];
      mb.mat(colorAt((x0 + x1) / 2, (z0 + z1) / 2, (h[i0] + h[i2]) / 2), 0.94, 0, 0, FLAG_DEFAULT);
      // Split along the shorter diagonal so slopes look natural.
      const n0 = v3.norm([0, 0, 0], v3.cross([0, 0, 0], v3.sub([0, 0, 0], p1, p0), v3.sub([0, 0, 0], p3, p0)));
      const a = mb.vertex(p0, n0), b = mb.vertex(p1, n0), c = mb.vertex(p2, n0), d = mb.vertex(p3, n0);
      mb.quadIdx(a, b, c, d);
      if (rng() < 0.0) { /* reserved for scatter hooks */ }
    }
  }
  return mb;
}

// --- road meshes ------------------------------------------------------------

const ASPHALT_DARK = [0.085, 0.086, 0.092];
const ASPHALT_LIGHT = [0.125, 0.126, 0.132];
const KERB_RED = [0.62, 0.10, 0.09];
const KERB_WHITE = [0.80, 0.80, 0.78];
const LINE_WHITE = [0.86, 0.86, 0.82];
const LINE_YELLOW = [0.80, 0.68, 0.12];

// Emit the tarmac, verges, kerbs and lane markings for one path.
function buildPathMesh(world, path, mb, options = {}) {
  const sp = path.spline;
  const count = sp.count;
  const closed = path.closed;
  const last = closed ? count : count - 1;
  const lift = 0.02;

  const heightOffset = (i) => 0;

  // Tarmac.
  mb.mat(ASPHALT_DARK, 0.72, 0.0, 0.0, FLAG_ROAD);
  mb.ribbon(sp, () => -path.halfWidth, () => path.halfWidth, () => lift, { closed });

  // Slightly lighter worn strip where the cars actually run.
  if (path.type === 'track') {
    mb.mat(ASPHALT_LIGHT, 0.66, 0.0, 0.0, FLAG_ROAD);
    mb.ribbon(sp, () => -path.halfWidth * 0.55, () => path.halfWidth * 0.55, () => lift + 0.004, { closed });
  }

  // Verge: blends the tarmac edge down onto the terrain.
  const vergeColor = path.type === 'track' ? [0.30, 0.29, 0.24] : [0.26, 0.28, 0.16];
  for (const side of [-1, 1]) {
    const inner = path.halfWidth + (path.kerbs ? path.kerbWidth : 0.35);
    const rows = [];
    const steps = 4;
    for (let k = 0; k <= last; k++) {
      const i = k % count;
      const p = sp.points[i], n = sp.normals[i];
      const row = [];
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const lat = inner + t * VERGE_WIDTH;
        const x = p[0] + n[0] * lat * side;
        const z = p[2] + n[2] * lat * side;
        const y = lerp(p[1], world.terrain(x, z), smoothstep(0, 1, t));
        row.push([x, y, z]);
      }
      rows.push(row);
    }
    mb.mat(vergeColor, 0.93, 0.0, 0.0, FLAG_DEFAULT);
    for (let r = 0; r < rows.length - 1; r++) {
      for (let s = 0; s < steps; s++) {
        const a = rows[r][s], b = rows[r + 1][s], c = rows[r + 1][s + 1], d = rows[r][s + 1];
        mb.quad(a, b, c, d);
      }
    }
  }

  // Kerbs: alternating red and white blocks, only through corners.
  if (path.kerbs) {
    for (const side of [-1, 1]) {
      let run = 0;
      for (let k = 0; k < last; k++) {
        const i = k % count;
        const curv = splineCurvature(sp, i);
        // Kerb on the inside of the corner, plus exit kerbs on the outside.
        const inside = (side < 0 && curv > 0) || (side > 0 && curv < 0);
        const strength = Math.abs(curv) * 380;
        if (strength < 0.55) { run = 0; continue; }
        if (!inside && strength < 1.4) { run = 0; continue; }
        run++;
        const blockIndex = Math.floor(k / 2);
        mb.mat(blockIndex % 2 === 0 ? KERB_RED : KERB_WHITE, 0.62, 0.0, 0.0, FLAG_DEFAULT);
        const i1 = (i + 1) % count;
        const p0 = sp.points[i], p1 = sp.points[i1];
        const n0 = sp.normals[i], n1 = sp.normals[i1];
        const in0 = path.halfWidth, out0 = path.halfWidth + path.kerbWidth;
        const a = [p0[0] + n0[0] * in0 * side, p0[1] + lift + 0.006, p0[2] + n0[2] * in0 * side];
        const b = [p1[0] + n1[0] * in0 * side, p1[1] + lift + 0.006, p1[2] + n1[2] * in0 * side];
        const c = [p1[0] + n1[0] * out0 * side, p1[1] + lift + 0.055, p1[2] + n1[2] * out0 * side];
        const d = [p0[0] + n0[0] * out0 * side, p0[1] + lift + 0.055, p0[2] + n0[2] * out0 * side];
        if (side < 0) mb.quad(a, b, c, d); else mb.quad(a, d, c, b);
        // Outer face so the kerb has thickness from the side.
        const e = [d[0], d[1] - 0.10, d[2]];
        const f = [c[0], c[1] - 0.10, c[2]];
        mb.mat([0.30, 0.30, 0.30], 0.8, 0, 0, FLAG_DEFAULT);
        if (side < 0) mb.quad(d, c, f, e); else mb.quad(e, f, c, d);
      }
    }
  }

  // Markings.
  if (path.markings) {
    if (path.type === 'track') {
      // Solid white edge lines.
      for (const side of [-1, 1]) {
        mb.mat(LINE_WHITE, 0.55, 0.0, 0.0, FLAG_DEFAULT);
        const inner = (path.halfWidth - 0.28) * side;
        const outer = (path.halfWidth - 0.10) * side;
        mb.ribbon(sp, () => Math.min(inner, outer), () => Math.max(inner, outer), () => lift + 0.008, { closed });
      }
    } else {
      // Centre line: dashed, or solid double through bends.
      mb.mat(LINE_WHITE, 0.55, 0.0, 0.0, FLAG_DEFAULT);
      for (let k = 0; k < last; k += 6) {
        const i = k % count;
        const i1 = (i + 3) % count;
        if (!closed && i + 3 >= count) break;
        const p0 = sp.points[i], p1 = sp.points[i1];
        const n0 = sp.normals[i], n1 = sp.normals[i1];
        const w = 0.09;
        const a = [p0[0] - n0[0] * w, p0[1] + lift + 0.008, p0[2] - n0[2] * w];
        const b = [p1[0] - n1[0] * w, p1[1] + lift + 0.008, p1[2] - n1[2] * w];
        const c = [p1[0] + n1[0] * w, p1[1] + lift + 0.008, p1[2] + n1[2] * w];
        const d = [p0[0] + n0[0] * w, p0[1] + lift + 0.008, p0[2] + n0[2] * w];
        mb.quad(a, b, c, d);
      }
      // Edge lines.
      for (const side of [-1, 1]) {
        const inner = (path.halfWidth - 0.30) * side;
        const outer = (path.halfWidth - 0.15) * side;
        mb.ribbon(sp, () => Math.min(inner, outer), () => Math.max(inner, outer), () => lift + 0.008, { closed });
      }
    }
  }
}

// --- racing line ------------------------------------------------------------

// Racing line by minimum-curvature relaxation inside the track corridor.
//
// Repeatedly pull every point toward the midpoint of its neighbours - which is
// the local move that reduces curvature the most - then push it back inside the
// usable width. Out-in-out through corners falls out of that on its own, and
// crucially the result is a line the car can actually follow: an offset-by-
// curvature heuristic saturates at the track edge on every bend and produces a
// zigzag that no amount of grip will track.
function computeRacingLine(path, maxOffset) {
  const sp = path.spline;
  const n = sp.count;
  const limit = maxOffset !== undefined ? maxOffset : path.halfWidth - 2.2;
  const offsets = new Float32Array(n);

  const idx = (i) => ((i % n) + n) % n;
  const pointAt = (i, out) => {
    const j = idx(i);
    const p = sp.points[j], nr = sp.normals[j];
    out[0] = p[0] + nr[0] * offsets[j];
    out[1] = p[1];
    out[2] = p[2] + nr[2] * offsets[j];
    return out;
  };

  const prev = [0, 0, 0], next = [0, 0, 0];
  const alpha = 0.42;
  for (let pass = 0; pass < 600; pass++) {
    let maxMove = 0;
    for (let i = 0; i < n; i++) {
      if (!path.closed && (i === 0 || i === n - 1)) continue;
      pointAt(i - 1, prev);
      pointAt(i + 1, next);
      const p = sp.points[i], nr = sp.normals[i];
      // Where the smoothing target sits, measured along this station's normal.
      const midX = (prev[0] + next[0]) * 0.5;
      const midZ = (prev[2] + next[2]) * 0.5;
      const desired = (midX - p[0]) * nr[0] + (midZ - p[2]) * nr[2];
      const updated = clamp(offsets[i] + (desired - offsets[i]) * alpha, -limit, limit);
      maxMove = Math.max(maxMove, Math.abs(updated - offsets[i]));
      offsets[i] = updated;
    }
    if (maxMove < 0.0015) break;
  }

  const pts = [];
  for (let i = 0; i < n; i++) {
    const p = sp.points[i], nr = sp.normals[i];
    pts.push([p[0] + nr[0] * offsets[i], p[1], p[2] + nr[2] * offsets[i]]);
  }
  const line = finishSpline(pts, path.closed);

  // Target speed from the local radius. Downforce raises the limit with speed,
  // so solve  m v^2 / R = mu (m g + q ClA v^2)  for v rather than assuming a
  // fixed lateral g. `mu` is deliberately below the tyre's peak so the AI
  // leaves itself something in hand.
  const speeds = new Float32Array(n);
  const mass = CAR_SPEC.mass;
  // Well under the tyre's 1.62 peak: lateral load transfer unloads the inside
  // wheels and the loaded outside tyre loses grip to load sensitivity, so the
  // whole car never reaches the single-tyre figure. Aiming at the theoretical
  // peak is exactly how an AI ends up understeering into the scenery.
  const mu = 1.12;
  const aeroK = 0.5 * AIR_DENSITY * 2.55;
  for (let i = 0; i < n; i++) {
    // Use the worst curvature in a short window so a single smooth sample
    // cannot hide the apex.
    let curv = 0;
    for (let k = -2; k <= 2; k++) {
      curv = Math.max(curv, Math.abs(splineCurvature(line, (i + k + n) % n)));
    }
    curv += 1e-5;
    const radius = 1 / curv;
    const denom = mass / radius - mu * aeroK;
    speeds[i] = denom <= 0 ? 82 : Math.min(Math.sqrt(mu * mass * GRAVITY / denom), 82);
  }
  // Brake back from every corner so the AI slows in time.
  for (let pass = 0; pass < 400; pass++) {
    let changed = false;
    for (let i = n - 1; i >= 0; i--) {
      const next = speeds[(i + 1) % n];
      const ds = v3.dist(line.points[i], line.points[(i + 1) % n]);
      const maxHere = Math.sqrt(next * next + 2 * 10.5 * ds);
      if (speeds[i] > maxHere) { speeds[i] = maxHere; changed = true; }
    }
    if (!changed) break;
  }
  line.speeds = speeds;
  line.offsets = offsets;
  return line;
}
