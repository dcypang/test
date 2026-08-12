// ---------------------------------------------------------------------------
// mesh.js - a CPU side geometry builder.
// Primitives are emitted through a transform stack and accumulated into one
// interleaved vertex array, so a whole town can end up as a handful of meshes.
// ---------------------------------------------------------------------------

class MeshBuilder {
  constructor() {
    this.verts = [];
    this.indices = [];
    this.stack = [];
    this.matrix = m4.create();
    this.material = { color: [0.8, 0.8, 0.8], rough: 0.7, metal: 0.0, emissive: 0.0, flag: FLAG_DEFAULT };
    this._nm = new Float32Array(9);
    this._nmDirty = true;
  }

  // --- transform stack ------------------------------------------------------

  push() { this.stack.push(new Float32Array(this.matrix)); return this; }

  pop() {
    if (this.stack.length) { this.matrix = this.stack.pop(); this._nmDirty = true; }
    return this;
  }

  applyMatrix(m) {
    this.matrix = m4.multiply(m4.create(), this.matrix, m);
    this._nmDirty = true;
    return this;
  }

  translate(x, y, z) { return this.applyMatrix(m4.translation(m4.create(), x, y, z)); }
  rotateX(a) { return this.applyMatrix(m4.rotationX(m4.create(), a)); }
  rotateY(a) { return this.applyMatrix(m4.rotationY(m4.create(), a)); }
  rotateZ(a) { return this.applyMatrix(m4.rotationZ(m4.create(), a)); }
  scale(x, y = x, z = x) { return this.applyMatrix(m4.scaling(m4.create(), x, y, z)); }

  // --- material -------------------------------------------------------------

  mat(color, rough = 0.7, metal = 0.0, emissive = 0.0, flag = FLAG_DEFAULT) {
    this.material = { color, rough, metal, emissive, flag };
    return this;
  }

  // --- raw emit -------------------------------------------------------------

  vertex(p, n) {
    if (this._nmDirty) { m4.normalMatrix(this._nm, this.matrix); this._nmDirty = false; }
    const m = this.matrix, nm = this._nm;
    const x = p[0], y = p[1], z = p[2];
    const wx = m[0] * x + m[4] * y + m[8] * z + m[12];
    const wy = m[1] * x + m[5] * y + m[9] * z + m[13];
    const wz = m[2] * x + m[6] * y + m[10] * z + m[14];
    let nx = nm[0] * n[0] + nm[3] * n[1] + nm[6] * n[2];
    let ny = nm[1] * n[0] + nm[4] * n[1] + nm[7] * n[2];
    let nz = nm[2] * n[0] + nm[5] * n[1] + nm[8] * n[2];
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const mt = this.material, c = mt.color;
    const idx = this.verts.length / VERTEX_FLOATS;
    this.verts.push(wx, wy, wz, nx, ny, nz, c[0], c[1], c[2], mt.rough, mt.metal, mt.emissive, mt.flag);
    return idx;
  }

  tri(a, b, c) { this.indices.push(a, b, c); return this; }

  quadIdx(a, b, c, d) { this.indices.push(a, b, c, a, c, d); return this; }

  // Four corner points in winding order; normal derived from the corners.
  quad(p0, p1, p2, p3, normal) {
    let n = normal;
    if (!n) {
      const u = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
      const v = [p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]];
      n = v3.norm([0, 0, 0], v3.cross([0, 0, 0], u, v));
    }
    const a = this.vertex(p0, n), b = this.vertex(p1, n);
    const c = this.vertex(p2, n), d = this.vertex(p3, n);
    return this.quadIdx(a, b, c, d);
  }

  // --- primitives -----------------------------------------------------------

  // Axis aligned box centred on the current origin.
  box(sx, sy, sz, offset = [0, 0, 0]) {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const [ox, oy, oz] = offset;
    const p = (x, y, z) => [ox + x * hx, oy + y * hy, oz + z * hz];
    // +X, -X, +Y, -Y, +Z, -Z
    this.quad(p(1, -1, 1), p(1, -1, -1), p(1, 1, -1), p(1, 1, 1), [1, 0, 0]);
    this.quad(p(-1, -1, -1), p(-1, -1, 1), p(-1, 1, 1), p(-1, 1, -1), [-1, 0, 0]);
    this.quad(p(-1, 1, 1), p(1, 1, 1), p(1, 1, -1), p(-1, 1, -1), [0, 1, 0]);
    this.quad(p(-1, -1, -1), p(1, -1, -1), p(1, -1, 1), p(-1, -1, 1), [0, -1, 0]);
    this.quad(p(-1, -1, 1), p(1, -1, 1), p(1, 1, 1), p(-1, 1, 1), [0, 0, 1]);
    this.quad(p(1, -1, -1), p(-1, -1, -1), p(-1, 1, -1), p(1, 1, -1), [0, 0, -1]);
    return this;
  }

  // Box with chamfered vertical edges - reads far better than a hard cube on
  // buildings, kerbstones and body panels.
  chamferBox(sx, sy, sz, chamfer, offset = [0, 0, 0]) {
    const c = Math.min(chamfer, sx / 2 - 1e-3, sz / 2 - 1e-3);
    const hx = sx / 2 - c, hz = sz / 2 - c, hy = sy / 2;
    const [ox, oy, oz] = offset;
    const ring = [];
    const corners = [[hx, hz], [-hx, hz], [-hx, -hz], [hx, -hz]];
    const dirs = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
    const steps = 3;
    for (let i = 0; i < 4; i++) {
      const [cx, cz] = corners[i];
      const base = Math.atan2(dirs[i][1], dirs[i][0]) - Math.PI / 4;
      for (let s = 0; s <= steps; s++) {
        const a = base + (s / steps) * (Math.PI / 2);
        ring.push([cx + Math.cos(a) * c, cz + Math.sin(a) * c]);
      }
    }
    const top = [], bottom = [];
    for (const [x, z] of ring) {
      const nrm = v3.norm([0, 0, 0], [x - 0, 0, z - 0]);
      const tIdx = this.vertex([ox + x, oy + hy, oz + z], nrm);
      const bIdx = this.vertex([ox + x, oy - hy, oz + z], nrm);
      top.push(tIdx); bottom.push(bIdx);
    }
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length;
      this.quadIdx(bottom[i], bottom[j], top[j], top[i]);
    }
    // Caps.
    const capTop = ring.map(([x, z]) => this.vertex([ox + x, oy + hy, oz + z], [0, 1, 0]));
    for (let i = 1; i < capTop.length - 1; i++) this.tri(capTop[0], capTop[i], capTop[i + 1]);
    const capBot = ring.map(([x, z]) => this.vertex([ox + x, oy - hy, oz + z], [0, -1, 0]));
    for (let i = 1; i < capBot.length - 1; i++) this.tri(capBot[0], capBot[i + 1], capBot[i]);
    return this;
  }

  // Cylinder along +Y, centred at the origin.
  cylinder(radiusTop, radiusBottom, height, segments = 16, capTop = true, capBottom = true) {
    const hy = height / 2;
    const topRing = [], botRing = [];
    const slope = (radiusBottom - radiusTop) / height;
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * TAU;
      const cx = Math.cos(a), cz = Math.sin(a);
      const n = v3.norm([0, 0, 0], [cx, slope, cz]);
      topRing.push(this.vertex([cx * radiusTop, hy, cz * radiusTop], n));
      botRing.push(this.vertex([cx * radiusBottom, -hy, cz * radiusBottom], n));
    }
    for (let i = 0; i < segments; i++) {
      this.quadIdx(botRing[i], botRing[i + 1], topRing[i + 1], topRing[i]);
    }
    if (capTop && radiusTop > 1e-5) {
      const center = this.vertex([0, hy, 0], [0, 1, 0]);
      const ring = [];
      for (let i = 0; i <= segments; i++) {
        const a = (i / segments) * TAU;
        ring.push(this.vertex([Math.cos(a) * radiusTop, hy, Math.sin(a) * radiusTop], [0, 1, 0]));
      }
      for (let i = 0; i < segments; i++) this.tri(center, ring[i], ring[i + 1]);
    }
    if (capBottom && radiusBottom > 1e-5) {
      const center = this.vertex([0, -hy, 0], [0, -1, 0]);
      const ring = [];
      for (let i = 0; i <= segments; i++) {
        const a = (i / segments) * TAU;
        ring.push(this.vertex([Math.cos(a) * radiusBottom, -hy, Math.sin(a) * radiusBottom], [0, -1, 0]));
      }
      for (let i = 0; i < segments; i++) this.tri(center, ring[i + 1], ring[i]);
    }
    return this;
  }

  // UV sphere centred on the origin.
  sphere(radius, segments = 16, rings = 10, squashY = 1) {
    const grid = [];
    for (let r = 0; r <= rings; r++) {
      const phi = (r / rings) * Math.PI;
      const row = [];
      for (let s = 0; s <= segments; s++) {
        const theta = (s / segments) * TAU;
        const n = [Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta)];
        row.push(this.vertex([n[0] * radius, n[1] * radius * squashY, n[2] * radius],
          v3.norm([0, 0, 0], [n[0], n[1] / squashY, n[2]])));
      }
      grid.push(row);
    }
    for (let r = 0; r < rings; r++) {
      for (let s = 0; s < segments; s++) {
        this.quadIdx(grid[r][s], grid[r + 1][s], grid[r + 1][s + 1], grid[r][s + 1]);
      }
    }
    return this;
  }

  // Flat convex polygon in the XZ plane at height y.
  polygonXZ(points, y = 0, up = true) {
    const n = up ? [0, 1, 0] : [0, -1, 0];
    const idx = points.map((p) => this.vertex([p[0], y, p[1]], n));
    for (let i = 1; i < idx.length - 1; i++) {
      if (up) this.tri(idx[0], idx[i], idx[i + 1]);
      else this.tri(idx[0], idx[i + 1], idx[i]);
    }
    return this;
  }

  // Loft a sequence of rings (each an array of equal-length [x,y,z] points).
  // Normals are derived from the surface derivatives, so the result is smooth.
  // `matFn(i, j)` may switch the active material per vertex, which is how the
  // car body gets a carbon undertray without a second mesh.
  loft(rings, closedRing = true, capStart = false, capEnd = false, matFn = null) {
    const rows = rings.length;
    const cols = rings[0].length;
    const idx = [];
    for (let i = 0; i < rows; i++) {
      const row = [];
      for (let j = 0; j < cols; j++) {
        const p = rings[i][j];
        if (matFn) matFn(i, j, this);
        const jPrev = closedRing ? (j - 1 + cols) % cols : Math.max(0, j - 1);
        const jNext = closedRing ? (j + 1) % cols : Math.min(cols - 1, j + 1);
        const iPrev = Math.max(0, i - 1);
        const iNext = Math.min(rows - 1, i + 1);
        const du = v3.sub([0, 0, 0], rings[i][jNext], rings[i][jPrev]);
        const dv = v3.sub([0, 0, 0], rings[iNext][j], rings[iPrev][j]);
        let n = v3.cross([0, 0, 0], dv, du);
        if (v3.len(n) < 1e-9) n = [0, 1, 0];
        v3.norm(n, n);
        row.push(this.vertex(p, n));
      }
      idx.push(row);
    }
    for (let i = 0; i < rows - 1; i++) {
      const lim = closedRing ? cols : cols - 1;
      for (let j = 0; j < lim; j++) {
        const j2 = (j + 1) % cols;
        this.quadIdx(idx[i][j], idx[i + 1][j], idx[i + 1][j2], idx[i][j2]);
      }
    }
    if (capStart) this._capRing(rings[0], true);
    if (capEnd) this._capRing(rings[rows - 1], false);
    return this;
  }

  _capRing(ring, reverse) {
    const c = [0, 0, 0];
    for (const p of ring) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
    c[0] /= ring.length; c[1] /= ring.length; c[2] /= ring.length;
    // Approximate cap normal from the ring plane.
    const n = v3.norm([0, 0, 0], v3.cross([0, 0, 0],
      v3.sub([0, 0, 0], ring[1], ring[0]),
      v3.sub([0, 0, 0], ring[2], ring[0])));
    if (reverse) v3.scale(n, n, -1);
    const ci = this.vertex(c, n);
    const ids = ring.map((p) => this.vertex(p, n));
    for (let i = 0; i < ids.length; i++) {
      const j = (i + 1) % ids.length;
      if (reverse) this.tri(ci, ids[j], ids[i]);
      else this.tri(ci, ids[i], ids[j]);
    }
    return this;
  }

  // A flat ribbon along a spline: used for road surfaces, kerbs and markings.
  // `leftFn(i)` / `rightFn(i)` return lateral offsets in metres.
  ribbon(spline, leftFn, rightFn, heightFn, options = {}) {
    const { closed = spline.closed, from = 0, to = spline.count, step = 1 } = options;
    const rowsIdx = [];
    const limit = closed ? spline.count : to;
    for (let k = from; k <= limit; k += step) {
      const i = ((k % spline.count) + spline.count) % spline.count;
      if (!closed && k >= to) break;
      const p = spline.points[i];
      const nrm = spline.normals[i];
      const l = leftFn(i, k), r = rightFn(i, k);
      const h = heightFn ? heightFn(i, k) : 0;
      const a = [p[0] + nrm[0] * l, p[1] + h, p[2] + nrm[2] * l];
      const b = [p[0] + nrm[0] * r, p[1] + h, p[2] + nrm[2] * r];
      rowsIdx.push([this.vertex(a, [0, 1, 0]), this.vertex(b, [0, 1, 0])]);
    }
    if (closed) rowsIdx.push(rowsIdx[0]);
    for (let i = 0; i < rowsIdx.length - 1; i++) {
      this.quadIdx(rowsIdx[i][0], rowsIdx[i + 1][0], rowsIdx[i + 1][1], rowsIdx[i][1]);
    }
    return this;
  }

  // --- utilities ------------------------------------------------------------

  get vertexCount() { return this.verts.length / VERTEX_FLOATS; }

  // Recolour vertices in place; `fn(pos, color, flag)` may mutate `color`.
  recolor(fn) {
    const v = this.verts;
    for (let i = 0; i < v.length; i += VERTEX_FLOATS) {
      const pos = [v[i], v[i + 1], v[i + 2]];
      const col = [v[i + 6], v[i + 7], v[i + 8]];
      if (fn(pos, col, v[i + 12], [v[i + 3], v[i + 4], v[i + 5]]) !== false) {
        v[i + 6] = col[0]; v[i + 7] = col[1]; v[i + 8] = col[2];
      }
    }
    return this;
  }

  // Re-flag every ordinary surface in this builder as cabin trim, so the shader
  // can light it as something under a roof. Screens, lenses and painted panels
  // keep their own flags: an unlit dash readout is unlit wherever it is.
  markCabin() {
    const v = this.verts;
    for (let i = 0; i < v.length; i += VERTEX_FLOATS) {
      if (v[i + 12] === FLAG_DEFAULT) v[i + 12] = FLAG_CABIN;
    }
    return this;
  }

  // Split into a grid of chunks by triangle centroid, so the renderer can
  // throw away what is off screen. One mesh for a whole city is one draw call
  // that cannot be culled: every building behind you is still transformed,
  // twice, before the depth test discovers it was never visible.
  //
  // Returns builders, not meshes, so the caller decides what to upload.
  chunk(cellSize) {
    const v = this.verts, idx = this.indices;
    const buckets = new Map();
    const key = (x, z) => Math.floor(x / cellSize) * 100003 + Math.floor(z / cellSize);

    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * VERTEX_FLOATS, b = idx[t + 1] * VERTEX_FLOATS, c = idx[t + 2] * VERTEX_FLOATS;
      const cx = (v[a] + v[b] + v[c]) / 3;
      const cz = (v[a + 2] + v[b + 2] + v[c + 2]) / 3;
      const k = key(cx, cz);
      let bucket = buckets.get(k);
      if (!bucket) { bucket = { mb: new MeshBuilder(), remap: new Map() }; buckets.set(k, bucket); }
      const out = bucket.mb;
      const tri = [];
      for (const src of [idx[t], idx[t + 1], idx[t + 2]]) {
        let dst = bucket.remap.get(src);
        if (dst === undefined) {
          dst = out.verts.length / VERTEX_FLOATS;
          const o = src * VERTEX_FLOATS;
          for (let f = 0; f < VERTEX_FLOATS; f++) out.verts.push(v[o + f]);
          bucket.remap.set(src, dst);
        }
        tri.push(dst);
      }
      out.indices.push(tri[0], tri[1], tri[2]);
    }
    return Array.from(buckets.values()).map((b) => b.mb);
  }

  bounds() {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    const v = this.verts;
    for (let i = 0; i < v.length; i += VERTEX_FLOATS) {
      for (let k = 0; k < 3; k++) {
        if (v[i + k] < min[k]) min[k] = v[i + k];
        if (v[i + k] > max[k]) max[k] = v[i + k];
      }
    }
    return { min, max };
  }

  append(other, matrix) {
    const base = this.vertexCount;
    const v = other.verts;
    const nm = new Float32Array(9);
    if (matrix) m4.normalMatrix(nm, matrix);
    for (let i = 0; i < v.length; i += VERTEX_FLOATS) {
      if (matrix) {
        const p = m4.transformPoint([0, 0, 0], matrix, [v[i], v[i + 1], v[i + 2]]);
        const nx = nm[0] * v[i + 3] + nm[3] * v[i + 4] + nm[6] * v[i + 5];
        const ny = nm[1] * v[i + 3] + nm[4] * v[i + 4] + nm[7] * v[i + 5];
        const nz = nm[2] * v[i + 3] + nm[5] * v[i + 4] + nm[8] * v[i + 5];
        const l = Math.hypot(nx, ny, nz) || 1;
        this.verts.push(p[0], p[1], p[2], nx / l, ny / l, nz / l);
      } else {
        this.verts.push(v[i], v[i + 1], v[i + 2], v[i + 3], v[i + 4], v[i + 5]);
      }
      for (let k = 6; k < VERTEX_FLOATS; k++) this.verts.push(v[i + k]);
    }
    for (const idx of other.indices) this.indices.push(base + idx);
    return this;
  }

  vertexArray() { return new Float32Array(this.verts); }

  indexArray() {
    const n = this.vertexCount;
    return n > 65535 ? new Uint32Array(this.indices) : new Uint16Array(this.indices);
  }
}
