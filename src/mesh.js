// ---------------------------------------------------------------------------
// mesh.js - a CPU side geometry builder.
// Primitives are emitted through a transform stack and accumulated into one
// interleaved vertex array, so a whole town can end up as a handful of meshes.
// ---------------------------------------------------------------------------

class MeshBuilder {
  constructor() {
    // Vertices and indices live in growable typed arrays rather than plain
    // ones. Building a country means pushing tens of millions of floats and
    // then copying every one of them again on the way to the GPU; with plain
    // arrays that copying - append, chunk and the final upload - was half the
    // entire scene build. Typed arrays turn all three into memcpy.
    this.vbuf = new Float32Array(1024 * VERTEX_FLOATS);
    this.vlen = 0;
    this.ibuf = new Uint32Array(2048);
    this.ilen = 0;
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
    const idx = this.vlen / VERTEX_FLOATS;
    this._roomForVerts(VERTEX_FLOATS);
    const v = this.vbuf;
    let o = this.vlen;
    v[o++] = wx; v[o++] = wy; v[o++] = wz;
    v[o++] = nx; v[o++] = ny; v[o++] = nz;
    v[o++] = c[0]; v[o++] = c[1]; v[o++] = c[2];
    v[o++] = mt.rough; v[o++] = mt.metal; v[o++] = mt.emissive; v[o++] = mt.flag;
    this.vlen = o;
    return idx;
  }

  // Views over the used part, so everything that reads `verts` and `indices`
  // as flat arrays keeps working unchanged.
  get verts() { return this.vbuf.subarray(0, this.vlen); }
  get indices() { return this.ibuf.subarray(0, this.ilen); }

  _roomForVerts(floats) {
    if (this.vlen + floats <= this.vbuf.length) return;
    let cap = this.vbuf.length * 2;
    while (cap < this.vlen + floats) cap *= 2;
    const next = new Float32Array(cap);
    next.set(this.vbuf.subarray(0, this.vlen));
    this.vbuf = next;
  }

  _roomForIndices(count) {
    if (this.ilen + count <= this.ibuf.length) return;
    let cap = this.ibuf.length * 2;
    while (cap < this.ilen + count) cap *= 2;
    const next = new Uint32Array(cap);
    next.set(this.ibuf.subarray(0, this.ilen));
    this.ibuf = next;
  }

  tri(a, b, c) {
    this._roomForIndices(3);
    const i = this.ibuf;
    i[this.ilen++] = a; i[this.ilen++] = b; i[this.ilen++] = c;
    return this;
  }

  quadIdx(a, b, c, d) {
    this._roomForIndices(6);
    const i = this.ibuf;
    i[this.ilen++] = a; i[this.ilen++] = b; i[this.ilen++] = c;
    i[this.ilen++] = a; i[this.ilen++] = c; i[this.ilen++] = d;
    return this;
  }

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

  get vertexCount() { return this.vlen / VERTEX_FLOATS; }

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
    const key = (x, z) => Math.floor(x / cellSize) * 100003 + Math.floor(z / cellSize);

    // Vertices are remapped through a pair of typed arrays rather than a Map
    // per bucket. This runs over every triangle in the world - several million
    // of them once the country is built - and at that size a Map lookup and a
    // dozen separate pushes per vertex was half the entire scene build.
    const vertCount = v.length / VERTEX_FLOATS;
    const remap = new Int32Array(vertCount);
    const stamp = new Int32Array(vertCount).fill(-1);
    const buckets = [];
    const byKey = new Map();

    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * VERTEX_FLOATS, b = idx[t + 1] * VERTEX_FLOATS, c = idx[t + 2] * VERTEX_FLOATS;
      const cx = (v[a] + v[b] + v[c]) / 3;
      const cz = (v[a + 2] + v[b + 2] + v[c + 2]) / 3;
      const k = key(cx, cz);
      let bi = byKey.get(k);
      if (bi === undefined) {
        bi = buckets.length;
        byKey.set(k, bi);
        buckets.push(new MeshBuilder());
      }
      const out = buckets[bi];
      out._roomForVerts(3 * VERTEX_FLOATS);
      out._roomForIndices(3);
      for (let n = 0; n < 3; n++) {
        const src = idx[t + n];
        if (stamp[src] !== bi) {
          stamp[src] = bi;
          remap[src] = out.vlen / VERTEX_FLOATS;
          // One block copy of the whole vertex rather than thirteen writes.
          out.vbuf.set(v.subarray(src * VERTEX_FLOATS, src * VERTEX_FLOATS + VERTEX_FLOATS),
            out.vlen);
          out.vlen += VERTEX_FLOATS;
        }
        out.ibuf[out.ilen++] = remap[src];
      }
    }
    return buckets;
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
    const src = other.vbuf, srcLen = other.vlen;
    this._roomForVerts(srcLen);
    const dst = this.vbuf;
    let o = this.vlen;
    if (!matrix) {
      // Nothing to transform, so it is one block copy.
      dst.set(src.subarray(0, srcLen), o);
      o += srcLen;
    } else {
      const nm = new Float32Array(9);
      m4.normalMatrix(nm, matrix);
      const m = matrix;
      for (let i = 0; i < srcLen; i += VERTEX_FLOATS) {
        const x = src[i], y = src[i + 1], z = src[i + 2];
        // Inlined rather than through m4.transformPoint: this runs once per
        // vertex of every prop in the country and allocated a throwaway array
        // each time.
        dst[o++] = m[0] * x + m[4] * y + m[8] * z + m[12];
        dst[o++] = m[1] * x + m[5] * y + m[9] * z + m[13];
        dst[o++] = m[2] * x + m[6] * y + m[10] * z + m[14];
        const ax = src[i + 3], ay = src[i + 4], az = src[i + 5];
        const nx = nm[0] * ax + nm[3] * ay + nm[6] * az;
        const ny = nm[1] * ax + nm[4] * ay + nm[7] * az;
        const nz = nm[2] * ax + nm[5] * ay + nm[8] * az;
        const l = Math.hypot(nx, ny, nz) || 1;
        dst[o++] = nx / l; dst[o++] = ny / l; dst[o++] = nz / l;
        for (let k = 6; k < VERTEX_FLOATS; k++) dst[o++] = src[i + k];
      }
    }
    this.vlen = o;

    const si = other.ibuf, siLen = other.ilen;
    this._roomForIndices(siLen);
    const di = this.ibuf;
    let p = this.ilen;
    for (let i = 0; i < siLen; i++) di[p++] = base + si[i];
    this.ilen = p;
    return this;
  }

  // Copies, because the buffers keep growing underneath and a view onto them
  // would go stale.
  vertexArray() { return this.vbuf.slice(0, this.vlen); }

  indexArray() {
    const n = this.vertexCount;
    const src = this.ibuf.subarray(0, this.ilen);
    return n > 65535 ? src.slice() : new Uint16Array(src);
  }
}
