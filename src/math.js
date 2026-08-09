// ---------------------------------------------------------------------------
// math.js - vectors, matrices, splines and small numeric helpers.
// Everything is plain arrays / Float32Array so it can go straight into WebGL.
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function lerp(a, b, t) { return a + (b - a) * t; }
function smoothstep(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
function sign(x) { return x < 0 ? -1 : (x > 0 ? 1 : 0); }
function rnd(a, b) { return a + Math.random() * (b - a); }

// Wrap an angle into (-PI, PI].
function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

// Move `cur` toward `target` by at most `maxDelta`.
function approach(cur, target, maxDelta) {
  const d = target - cur;
  if (Math.abs(d) <= maxDelta) return target;
  return cur + sign(d) * maxDelta;
}

// Deterministic pseudo random so worlds regenerate identically every run.
function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- vec3 -------------------------------------------------------------------

const v3 = {
  make: (x = 0, y = 0, z = 0) => [x, y, z],
  set: (o, x, y, z) => { o[0] = x; o[1] = y; o[2] = z; return o; },
  copy: (o, a) => { o[0] = a[0]; o[1] = a[1]; o[2] = a[2]; return o; },
  add: (o, a, b) => { o[0] = a[0] + b[0]; o[1] = a[1] + b[1]; o[2] = a[2] + b[2]; return o; },
  sub: (o, a, b) => { o[0] = a[0] - b[0]; o[1] = a[1] - b[1]; o[2] = a[2] - b[2]; return o; },
  scale: (o, a, s) => { o[0] = a[0] * s; o[1] = a[1] * s; o[2] = a[2] * s; return o; },
  addScaled: (o, a, b, s) => { o[0] = a[0] + b[0] * s; o[1] = a[1] + b[1] * s; o[2] = a[2] + b[2] * s; return o; },
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  dist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
  cross: (o, a, b) => {
    const x = a[1] * b[2] - a[2] * b[1];
    const y = a[2] * b[0] - a[0] * b[2];
    const z = a[0] * b[1] - a[1] * b[0];
    o[0] = x; o[1] = y; o[2] = z; return o;
  },
  norm: (o, a) => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    o[0] = a[0] / l; o[1] = a[1] / l; o[2] = a[2] / l; return o;
  },
  lerp: (o, a, b, t) => {
    o[0] = a[0] + (b[0] - a[0]) * t;
    o[1] = a[1] + (b[1] - a[1]) * t;
    o[2] = a[2] + (b[2] - a[2]) * t;
    return o;
  },
};

// --- mat4 (column major, same layout WebGL expects) -------------------------

const m4 = {
  create: () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),

  identity(o) {
    o[0] = 1; o[1] = 0; o[2] = 0; o[3] = 0;
    o[4] = 0; o[5] = 1; o[6] = 0; o[7] = 0;
    o[8] = 0; o[9] = 0; o[10] = 1; o[11] = 0;
    o[12] = 0; o[13] = 0; o[14] = 0; o[15] = 1;
    return o;
  },

  copy(o, a) { o.set(a); return o; },

  multiply(o, a, b) {
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
    const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
    const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    for (let i = 0; i < 4; i++) {
      const b0 = b[i * 4], b1 = b[i * 4 + 1], b2 = b[i * 4 + 2], b3 = b[i * 4 + 3];
      o[i * 4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
      o[i * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
      o[i * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
      o[i * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    }
    return o;
  },

  perspective(o, fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2);
    o[0] = f / aspect; o[1] = 0; o[2] = 0; o[3] = 0;
    o[4] = 0; o[5] = f; o[6] = 0; o[7] = 0;
    o[8] = 0; o[9] = 0; o[10] = (far + near) / (near - far); o[11] = -1;
    o[12] = 0; o[13] = 0; o[14] = (2 * far * near) / (near - far); o[15] = 0;
    return o;
  },

  ortho(o, l, r, b, t, n, f) {
    o[0] = 2 / (r - l); o[1] = 0; o[2] = 0; o[3] = 0;
    o[4] = 0; o[5] = 2 / (t - b); o[6] = 0; o[7] = 0;
    o[8] = 0; o[9] = 0; o[10] = -2 / (f - n); o[11] = 0;
    o[12] = -(r + l) / (r - l); o[13] = -(t + b) / (t - b); o[14] = -(f + n) / (f - n); o[15] = 1;
    return o;
  },

  lookAt(o, eye, center, up) {
    const z = v3.norm([0, 0, 0], v3.sub([0, 0, 0], eye, center));
    let x = v3.cross([0, 0, 0], up, z);
    if (v3.len(x) < 1e-6) { x = v3.cross([0, 0, 0], [0, 0, 1], z); }
    v3.norm(x, x);
    const y = v3.cross([0, 0, 0], z, x);
    o[0] = x[0]; o[1] = y[0]; o[2] = z[0]; o[3] = 0;
    o[4] = x[1]; o[5] = y[1]; o[6] = z[1]; o[7] = 0;
    o[8] = x[2]; o[9] = y[2]; o[10] = z[2]; o[11] = 0;
    o[12] = -v3.dot(x, eye); o[13] = -v3.dot(y, eye); o[14] = -v3.dot(z, eye); o[15] = 1;
    return o;
  },

  translation(o, x, y, z) {
    m4.identity(o);
    o[12] = x; o[13] = y; o[14] = z;
    return o;
  },

  scaling(o, x, y, z) {
    m4.identity(o);
    o[0] = x; o[5] = y; o[10] = z;
    return o;
  },

  rotationY(o, a) {
    const c = Math.cos(a), s = Math.sin(a);
    m4.identity(o);
    o[0] = c; o[2] = -s; o[8] = s; o[10] = c;
    return o;
  },

  rotationX(o, a) {
    const c = Math.cos(a), s = Math.sin(a);
    m4.identity(o);
    o[5] = c; o[6] = s; o[9] = -s; o[10] = c;
    return o;
  },

  rotationZ(o, a) {
    const c = Math.cos(a), s = Math.sin(a);
    m4.identity(o);
    o[0] = c; o[1] = s; o[4] = -s; o[5] = c;
    return o;
  },

  // Yaw (Y) then pitch (X) then roll (Z), applied about the object origin,
  // followed by a translation. This is the transform every prop in the world uses.
  compose(o, pos, yaw, pitch, roll, sx = 1, sy = 1, sz = 1) {
    const cy = Math.cos(yaw), sy_ = Math.sin(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const cr = Math.cos(roll), sr = Math.sin(roll);
    // R = Ry * Rx * Rz
    const m00 = cy * cr + sy_ * sp * sr;
    const m01 = cp * sr;
    const m02 = -sy_ * cr + cy * sp * sr;
    const m10 = -cy * sr + sy_ * sp * cr;
    const m11 = cp * cr;
    const m12 = sy_ * sr + cy * sp * cr;
    const m20 = sy_ * cp;
    const m21 = -sp;
    const m22 = cy * cp;
    o[0] = m00 * sx; o[1] = m01 * sx; o[2] = m02 * sx; o[3] = 0;
    o[4] = m10 * sy; o[5] = m11 * sy; o[6] = m12 * sy; o[7] = 0;
    o[8] = m20 * sz; o[9] = m21 * sz; o[10] = m22 * sz; o[11] = 0;
    o[12] = pos[0]; o[13] = pos[1]; o[14] = pos[2]; o[15] = 1;
    return o;
  },

  invert(o, a) {
    const b00 = a[0] * a[5] - a[1] * a[4], b01 = a[0] * a[6] - a[2] * a[4];
    const b02 = a[0] * a[7] - a[3] * a[4], b03 = a[1] * a[6] - a[2] * a[5];
    const b04 = a[1] * a[7] - a[3] * a[5], b05 = a[2] * a[7] - a[3] * a[6];
    const b06 = a[8] * a[13] - a[9] * a[12], b07 = a[8] * a[14] - a[10] * a[12];
    const b08 = a[8] * a[15] - a[11] * a[12], b09 = a[9] * a[14] - a[10] * a[13];
    const b10 = a[9] * a[15] - a[11] * a[13], b11 = a[10] * a[15] - a[11] * a[14];
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return m4.identity(o);
    det = 1 / det;
    const r = [
      (a[5] * b11 - a[6] * b10 + a[7] * b09) * det,
      (a[2] * b10 - a[1] * b11 - a[3] * b09) * det,
      (a[13] * b05 - a[14] * b04 + a[15] * b03) * det,
      (a[10] * b04 - a[9] * b05 - a[11] * b03) * det,
      (a[6] * b08 - a[4] * b11 - a[7] * b07) * det,
      (a[0] * b11 - a[2] * b08 + a[3] * b07) * det,
      (a[14] * b02 - a[12] * b05 - a[15] * b01) * det,
      (a[8] * b05 - a[10] * b02 + a[11] * b01) * det,
      (a[4] * b10 - a[5] * b08 + a[7] * b06) * det,
      (a[1] * b08 - a[0] * b10 - a[3] * b06) * det,
      (a[12] * b04 - a[13] * b02 + a[15] * b00) * det,
      (a[9] * b02 - a[8] * b04 - a[11] * b00) * det,
      (a[5] * b07 - a[4] * b09 - a[6] * b06) * det,
      (a[0] * b09 - a[1] * b07 + a[2] * b06) * det,
      (a[13] * b01 - a[12] * b03 - a[14] * b00) * det,
      (a[8] * b03 - a[9] * b01 + a[10] * b00) * det,
    ];
    for (let i = 0; i < 16; i++) o[i] = r[i];
    return o;
  },

  // Inverse-transpose of the upper 3x3, packed as a mat3 for normal transforms.
  normalMatrix(o9, m) {
    const inv = m4.invert(m4.create(), m);
    o9[0] = inv[0]; o9[1] = inv[4]; o9[2] = inv[8];
    o9[3] = inv[1]; o9[4] = inv[5]; o9[5] = inv[9];
    o9[6] = inv[2]; o9[7] = inv[6]; o9[8] = inv[10];
    return o9;
  },

  transformPoint(o, m, p) {
    const x = p[0], y = p[1], z = p[2];
    o[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
    o[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    o[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    return o;
  },

  transformDir(o, m, p) {
    const x = p[0], y = p[1], z = p[2];
    o[0] = m[0] * x + m[4] * y + m[8] * z;
    o[1] = m[1] * x + m[5] * y + m[9] * z;
    o[2] = m[2] * x + m[6] * y + m[10] * z;
    return o;
  },
};

// --- splines ----------------------------------------------------------------

// Centripetal-ish Catmull-Rom through a closed or open list of [x,y,z] points.
function catmullRom(p0, p1, p2, p3, t, out) {
  const t2 = t * t, t3 = t2 * t;
  for (let i = 0; i < 3; i++) {
    out[i] = 0.5 * ((2 * p1[i]) +
      (-p0[i] + p2[i]) * t +
      (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 +
      (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3);
  }
  return out;
}

// Resample a control polygon into a dense, roughly arc-length uniform loop.
// Returns { points, tangents, normals, cumulative, length, closed }.
function buildSpline(control, closed, spacing) {
  const dense = [];
  const n = control.length;
  const segs = closed ? n : n - 1;
  const sub = 24;
  for (let i = 0; i < segs; i++) {
    const p0 = control[(i - 1 + n) % n];
    const p1 = control[i % n];
    const p2 = control[(i + 1) % n];
    const p3 = control[(i + 2) % n];
    const a = closed ? p0 : control[Math.max(0, i - 1)];
    const d = closed ? p3 : control[Math.min(n - 1, i + 2)];
    for (let s = 0; s < sub; s++) {
      dense.push(catmullRom(a, p1, p2, d, s / sub, [0, 0, 0]));
    }
  }
  if (!closed) dense.push(control[n - 1].slice());

  // Re-sample by arc length.
  let total = 0;
  const cum = [0];
  for (let i = 1; i < dense.length; i++) {
    total += v3.dist(dense[i], dense[i - 1]);
    cum.push(total);
  }
  if (closed) total += v3.dist(dense[0], dense[dense.length - 1]);

  const count = Math.max(8, Math.round(total / spacing));
  const step = total / count;
  const points = [];
  let idx = 0;
  for (let i = 0; i < count; i++) {
    const target = i * step;
    while (idx < cum.length - 2 && cum[idx + 1] < target) idx++;
    const segLen = (cum[idx + 1] - cum[idx]) || 1;
    const t = (target - cum[idx]) / segLen;
    const a = dense[idx], b = dense[Math.min(idx + 1, dense.length - 1)];
    points.push(v3.lerp([0, 0, 0], a, b, t));
  }
  if (!closed) points.push(dense[dense.length - 1].slice());

  return finishSpline(points, closed);
}

function finishSpline(points, closed) {
  const count = points.length;
  const tangents = [], normals = [], cumulative = [];
  let run = 0;
  for (let i = 0; i < count; i++) {
    const prev = points[(i - 1 + count) % count];
    const next = points[(i + 1) % count];
    let a = prev, b = next;
    if (!closed) {
      a = points[Math.max(0, i - 1)];
      b = points[Math.min(count - 1, i + 1)];
    }
    const t = v3.norm([0, 0, 0], v3.sub([0, 0, 0], b, a));
    tangents.push(t);
    // Road normal: perpendicular in the XZ plane (right hand side of travel).
    normals.push(v3.norm([0, 0, 0], [t[2], 0, -t[0]]));
    cumulative.push(run);
    if (i < count - 1) run += v3.dist(points[i], points[i + 1]);
    else if (closed) run += v3.dist(points[i], points[0]);
  }
  return { points, tangents, normals, cumulative, length: run, closed, count };
}

// Signed curvature (1/radius) at spline index i, positive turning left.
function splineCurvature(sp, i) {
  const n = sp.count;
  const a = sp.points[(i - 2 + n) % n];
  const b = sp.points[i % n];
  const c = sp.points[(i + 2) % n];
  const ab = Math.hypot(b[0] - a[0], b[2] - a[2]);
  const bc = Math.hypot(c[0] - b[0], c[2] - b[2]);
  const ca = Math.hypot(a[0] - c[0], a[2] - c[2]);
  const area2 = (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]);
  const denom = ab * bc * ca;
  if (denom < 1e-6) return 0;
  return (2 * area2) / denom;
}
