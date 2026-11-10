'use strict';
// ---------------------------------------------------------------------------
// Map: terrain generation (mirror-symmetric), gold fields, A* pathfinding
// ---------------------------------------------------------------------------
const MAP_N = 64;
const T_GRASS = 0, T_SAND = 1, T_DIRT = 2, T_WATER = 3, T_FOREST = 4, T_ROCK = 5;
const GOLD_MAX = 600;

function makeNoise(rng, size) {
  const g = new Float32Array(size * size);
  for (let i = 0; i < g.length; i++) g[i] = rng();
  const at = (x, y) => g[((y % size + size) % size) * size + ((x % size + size) % size)];
  return (x, y) => {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    let fx = x - x0, fy = y - y0;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    return lerp(lerp(at(x0, y0), at(x0 + 1, y0), fx), lerp(at(x0, y0 + 1), at(x0 + 1, y0 + 1), fx), fy);
  };
}

class GameMap {
  constructor(n, seed) {
    this.n = n;
    const s = n * n;
    this.terrain = new Uint8Array(s);
    this.variant = new Uint8Array(s);
    this.solid = new Uint8Array(s);
    this.occ = new Int32Array(s);
    this.gold = new Float32Array(s);
    this.goldKind = new Uint8Array(s);
    this.trees = [];
    this.lodes = [];
    this.bases = [{ x: 11, y: 52 }, { x: 52, y: 11 }];
    // A* scratch space
    this._g = new Float32Array(s);
    this._from = new Int32Array(s);
    this._stamp = new Uint32Array(s);
    this._closed = new Uint32Array(s);
    this._gen = 0;
    this._hi = new Int32Array(s * 4);
    this._hf = new Float32Array(s * 4);
    this._regrowT = 0;
    let tries = 0;
    do { this.generate(seed + tries * 7919); tries++; } while (!this.connected() && tries < 25);
    this.seed = seed + (tries - 1) * 7919;
  }

  idx(x, y) { return y * this.n + x; }
  inb(x, y) { return x >= 0 && y >= 0 && x < this.n && y < this.n; }
  solidAt(x, y) {
    const tx = Math.floor(x), ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= this.n || ty >= this.n) return true;
    return this.solid[ty * this.n + tx] !== 0;
  }

  generate(seed) {
    const n = this.n, rng = mulberry32(seed);
    this.terrain.fill(T_GRASS); this.gold.fill(0); this.goldKind.fill(0);
    this.solid.fill(0); this.occ.fill(0);
    this.trees = []; this.lodes = [];
    const nA = makeNoise(rng, 32), nB = makeNoise(rng, 32), nC = makeNoise(rng, 32), nD = makeNoise(rng, 32);
    const A = this.bases[0];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const e = nA(x / 9, y / 9) * 0.65 + nB(x / 4, y / 4) * 0.35;
      const f = nC(x / 7, y / 7) * 0.6 + nD(x / 3, y / 3) * 0.4;
      const dB = Math.hypot(x - A.x, y - A.y);
      const edge = Math.min(x, y, n - 1 - x, n - 1 - y);
      let t = T_GRASS;
      if (e > 0.69 && dB > 14) t = T_WATER;
      else if ((f > 0.62 || edge < 1) && dB > 10) t = T_FOREST;
      else if (nB(x / 5 + 7.3, y / 5 + 3.1) > 0.7) t = T_DIRT;
      this.terrain[i] = t;
      // low nibble: random detail; high bits: smooth shade band so terrain reads as patches, not a checkerboard
      this.variant[i] = ((rng() * 16) | 0) | (Math.min(3, Math.floor((nD(x / 6 + 11.7, y / 6 + 4.2) * 0.7 + nA(x / 2.5, y / 2.5) * 0.3) * 4.6)) << 4);
    }
    // gold fields (placed on the whole grid, then mirrored from the canonical half)
    const fields = [
      [18.5, 46.5, 3.1, 1], [8.5, 40.5, 2.8, 1], [25.5, 57.5, 2.7, 1],
      [27.5, 38.5, 2.3, 2], [13.5, 13.5, 3.3, 1], [49.5, 49.5, 3.3, 1], [31.5, 31.5, 2.6, 2],
    ];
    const lodes = [];
    for (const [fx, fy, r, kind] of fields) {
      for (let y = Math.floor(fy - r - 2); y <= fy + r + 2; y++) for (let x = Math.floor(fx - r - 2); x <= fx + r + 2; x++) {
        if (!this.inb(x, y) || x < 1 || y < 1 || x > n - 2 || y > n - 2) continue;
        const i = y * n + x, d = Math.hypot(x + 0.5 - fx, y + 0.5 - fy);
        if (d < r + 1.6) this.terrain[i] = d < r + 0.6 ? T_DIRT : (this.terrain[i] === T_WATER || this.terrain[i] === T_FOREST ? T_GRASS : this.terrain[i]);
        if (d < r * (0.72 + 0.4 * rng())) {
          this.gold[i] = Math.round((260 + rng() * 300) * (1 - 0.35 * d / r));
          this.goldKind[i] = kind;
        }
      }
      lodes.push([Math.floor(fx), Math.floor(fy), kind]);
    }
    // clear the starting area
    for (let y = A.y - 9; y <= A.y + 9; y++) for (let x = A.x - 9; x <= A.x + 9; x++) {
      if (!this.inb(x, y)) continue;
      const d = Math.hypot(x - A.x, y - A.y), i = y * n + x;
      if (d < 8.5 && x > 0 && y > 0 && x < n - 1 && y < n - 1) {
        this.terrain[i] = d < 3.5 ? T_DIRT : (this.terrain[i] === T_DIRT ? T_DIRT : T_GRASS);
        if (d < 5) { this.gold[i] = 0; this.goldKind[i] = 0; }
      }
    }
    for (const [lx, ly] of lodes) { const i = ly * n + lx; this.terrain[i] = T_ROCK; this.gold[i] = 0; this.goldKind[i] = 0; }
    // mirror canonical half (y > x, plus half of the diagonal) by 180 degrees
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      if (!(y > x || (y === x && x < n / 2))) continue;
      const i = y * n + x, j = (n - 1 - y) * n + (n - 1 - x);
      this.terrain[j] = this.terrain[i]; this.gold[j] = this.gold[i]; this.goldKind[j] = this.goldKind[i];
    }
    // beaches
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = y * n + x;
      if (this.terrain[i] !== T_GRASS && this.terrain[i] !== T_DIRT) continue;
      let w = false;
      for (let dy = -1; dy <= 1 && !w; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (this.inb(x + dx, y + dy) && this.terrain[(y + dy) * n + x + dx] === T_WATER) { w = true; break; }
      }
      if (w && this.gold[i] <= 0) this.terrain[i] = T_SAND;
    }
    // derive solids, trees, lodes
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = y * n + x, t = this.terrain[i];
      if (t === T_WATER || t === T_FOREST || t === T_ROCK) { this.solid[i] = 1; this.gold[i] = 0; this.goldKind[i] = 0; }
      if (t === T_FOREST) {
        const v = this.variant[i];
        const h = (x * 73856093 ^ y * 19349663) >>> 0;
        this.trees.push({ x: x + 0.3 + (h % 16) / 40, y: y + 0.3 + ((h >> 4) % 16) / 40, v: (h >> 8) % 3, s: 0.85 + ((h >> 10) % 7) / 20 });
      } else if (t === T_ROCK) {
        let kind = 1;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          if (this.inb(x + dx, y + dy) && this.goldKind[(y + dy) * n + x + dx] === 2) kind = 2;
        }
        this.lodes.push({ x: x + 0.5, y: y + 0.5, tx: x, ty: y, kind });
      }
    }
  }

  connected() {
    const n = this.n, seen = new Uint8Array(n * n);
    const a = this.bases[0], b = this.bases[1];
    const q = [a.y * n + a.x]; seen[q[0]] = 1;
    const goal = b.y * n + b.x;
    while (q.length) {
      const c = q.pop(), cx = c % n, cy = (c / n) | 0;
      if (c === goal) return true;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = cx + dx, y = cy + dy;
        if (!this.inb(x, y)) continue;
        const i = y * n + x;
        if (seen[i] || this.solid[i]) continue;
        seen[i] = 1; q.push(i);
      }
    }
    return false;
  }

  // nearest non-solid tile to (x,y); returns {x,y} tile coords
  nearestFree(x, y, maxR) {
    const tx = clamp(Math.floor(x), 0, this.n - 1), ty = clamp(Math.floor(y), 0, this.n - 1);
    if (!this.solid[ty * this.n + tx]) return { x: tx, y: ty };
    let best = null, bd = 1e9;
    for (let r = 1; r <= (maxR || 12); r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const px = tx + dx, py = ty + dy;
        if (!this.inb(px, py) || this.solid[py * this.n + px]) continue;
        const d = Math.hypot(px + 0.5 - x, py + 0.5 - y);
        if (d < bd) { bd = d; best = { x: px, y: py }; }
      }
      if (best) return best;
    }
    return { x: tx, y: ty };
  }

  lineClear(x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy);
    if (d < 0.01) return true;
    const steps = Math.ceil(d / 0.3), px = -dy / d * 0.28, py = dx / d * 0.28;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, x = x0 + dx * t, y = y0 + dy * t;
      if (this.solidAt(x, y) || this.solidAt(x + px, y + py) || this.solidAt(x - px, y - py)) return false;
    }
    return true;
  }

  // A*: path from (sx,sy) to any tile whose centre lies within `range` of the goal rect.
  // Returns { path: [{x,y}...], reached }. Falls back to the closest tile found.
  findPath(sx, sy, gx0, gy0, gx1, gy1, range) {
    const n = this.n, solid = this.solid, g = this._g, from = this._from, stamp = this._stamp, closed = this._closed;
    const hi = this._hi, hf = this._hf;
    const stx = clamp(Math.floor(sx), 0, n - 1), sty = clamp(Math.floor(sy), 0, n - 1);
    const start = sty * n + stx;
    const gcx = (gx0 + gx1) / 2, gcy = (gy0 + gy1) / 2;
    const slack = range + Math.hypot(gx1 - gx0, gy1 - gy0) / 2;
    const gen = ++this._gen;
    const H = (x, y) => {
      const dx = Math.abs(x + 0.5 - gcx), dy = Math.abs(y + 0.5 - gcy);
      return Math.max(0, Math.max(dx, dy) + 0.4142 * Math.min(dx, dy) - slack);
    };
    let hn = 0;
    const push = (i, f) => {
      if (hn >= hi.length) return;
      let c = hn++;
      while (c > 0) {
        const p = (c - 1) >> 1;
        if (hf[p] <= f) break;
        hi[c] = hi[p]; hf[c] = hf[p]; c = p;
      }
      hi[c] = i; hf[c] = f;
    };
    const pop = () => {
      const top = hi[0];
      hn--;
      if (hn > 0) {
        const li = hi[hn], lf = hf[hn];
        let c = 0;
        for (;;) {
          let k = c * 2 + 1;
          if (k >= hn) break;
          if (k + 1 < hn && hf[k + 1] < hf[k]) k++;
          if (hf[k] >= lf) break;
          hi[c] = hi[k]; hf[c] = hf[k]; c = k;
        }
        hi[c] = li; hf[c] = lf;
      }
      return top;
    };
    g[start] = 0; stamp[start] = gen; from[start] = -1;
    let best = start, bestH = H(stx, sty), found = -1, count = 0;
    push(start, bestH);
    while (hn > 0) {
      const cur = pop();
      if (closed[cur] === gen) continue;
      closed[cur] = gen;
      const cx = cur % n, cy = (cur / n) | 0;
      if (rectDist(cx + 0.5, cy + 0.5, gx0, gy0, gx1, gy1) <= range) { found = cur; break; }
      if (++count > 3200) break;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const ni = ny * n + nx;
        if (solid[ni] || closed[ni] === gen) continue;
        const diag = dx !== 0 && dy !== 0;
        if (diag && (solid[cy * n + nx] || solid[ny * n + cx])) continue;
        const ng = g[cur] + (diag ? 1.4142 : 1);
        if (stamp[ni] !== gen || ng < g[ni]) {
          g[ni] = ng; stamp[ni] = gen; from[ni] = cur;
          const hh = H(nx, ny);
          if (hh < bestH) { bestH = hh; best = ni; }
          push(ni, ng + hh);
        }
      }
    }
    const end = found >= 0 ? found : best;
    const path = [];
    let c = end;
    while (c !== start && c >= 0) { path.push({ x: (c % n) + 0.5, y: ((c / n) | 0) + 0.5 }); c = from[c]; }
    path.reverse();
    return { path, reached: found >= 0 };
  }

  // gold slowly seeps back out around lodes
  regrow(dt, rng) {
    this._regrowT += dt;
    if (this._regrowT < 2.5) return;
    this._regrowT = 0;
    const n = this.n;
    for (const l of this.lodes) {
      const a = rng() * Math.PI * 2, r = 1 + rng() * 2.6;
      const x = Math.floor(l.x + Math.cos(a) * r), y = Math.floor(l.y + Math.sin(a) * r);
      if (!this.inb(x, y)) continue;
      const i = y * n + x;
      if (this.solid[i] || this.occ[i]) continue;
      if (this.gold[i] < GOLD_MAX) {
        this.gold[i] = Math.min(GOLD_MAX, this.gold[i] + 70);
        if (!this.goldKind[i]) this.goldKind[i] = l.kind;
        if (this.terrain[i] !== T_SAND) this.terrain[i] = T_DIRT;
      }
    }
  }
}
