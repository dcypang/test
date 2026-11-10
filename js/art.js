'use strict';
// ---------------------------------------------------------------------------
// Procedural art. Every sprite in the game is drawn here with canvas paths;
// there are no image files. Buildings are assembled from textured isometric
// solids (stone courses, planks, shingles, thatch) and the same geometry is
// replayed in a "shadow pass" to produce a soft cast shadow for each one.
// Sprites are cached at 2x for crisp scaling.
// ---------------------------------------------------------------------------
const Art = (() => {
  const SS = 2, USCALE = 1.2, WALKF = 8;
  const cache = new Map();
  const STONE = '#aaa59a', STONE_D = '#858076', WOOD = '#8f663c', WOOD_D = '#5c3f22', PLASTER = '#decfa8',
    THATCH = '#c6a44e', DARK = '#2a1f16', GOLD = '#f0c33c', SKIN = '#e5b88c', IRON = '#b9bec6';
  const OUT = 'rgba(24,16,8,.5)';
  let rnd = Math.random;          // per-sprite deterministic RNG
  let SH = null;                  // shadow-pass context (null in the colour pass)
  let curShadow = null;
  // swallows every call and property write: stands in for the context during the shadow pass
  const NUL = new Proxy(function () {}, { get: () => NUL, set: () => true, apply: () => NUL });
  const LA = 0.0125, LB = -0.0045; // tile offset of a shadow per pixel of height

  function mk(w, h, ox, oy, draw) {
    const c = document.createElement('canvas');
    c.width = Math.ceil(w * SS); c.height = Math.ceil(h * SS);
    const ctx = c.getContext('2d');
    ctx.scale(SS, SS); ctx.translate(ox, oy);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    draw(ctx);
    return { c, w, h, ox, oy };
  }
  function cached(key, fn) { let s = cache.get(key); if (!s) { s = fn(); cache.set(key, s); } return s; }
  function strHash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }
  function blurred(src, px) {
    const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
    const g = c.getContext('2d'), off = src.width * 2 + 100;
    g.shadowColor = '#000'; g.shadowBlur = px; g.shadowOffsetX = off;
    g.drawImage(src, -off, 0);
    return c;
  }
  function silhouette(src, col) {
    const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
    const g = c.getContext('2d');
    g.drawImage(src, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = col; g.fillRect(0, 0, c.width, c.height);
    return c;
  }

  // ---- primitives ---------------------------------------------------------
  function poly(ctx, pts, fill, stroke, lw) {
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke !== null) { ctx.strokeStyle = stroke || OUT; ctx.lineWidth = lw || 0.7; ctx.stroke(); }
  }
  function line(ctx, a, b, col, lw) {
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
    ctx.strokeStyle = col; ctx.lineWidth = lw || 1; ctx.stroke();
  }
  function ell(ctx, x, y, rx, ry, fill, stroke) {
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 0.7; ctx.stroke(); }
  }
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  function quadL(ctx, y, xa, xb, z0, z1, fill, stroke) { poly(ctx, [ip(xa, y, z0), ip(xb, y, z0), ip(xb, y, z1), ip(xa, y, z1)], fill, stroke === undefined ? null : stroke); }
  function quadR(ctx, x, ya, yb, z0, z1, fill, stroke) { poly(ctx, [ip(x, ya, z0), ip(x, yb, z0), ip(x, yb, z1), ip(x, ya, z1)], fill, stroke === undefined ? null : stroke); }

  // polygon filled with a top-to-bottom gradient of one colour
  function face(ctx, pts, col, hi, lo, stroke) {
    let a = 1e9, b = -1e9;
    for (const p of pts) { if (p[1] < a) a = p[1]; if (p[1] > b) b = p[1]; }
    const g = ctx.createLinearGradient(0, a, 0, b + 0.01);
    g.addColorStop(0, shade(col, hi)); g.addColorStop(1, shade(col, lo));
    poly(ctx, pts, g, stroke);
  }

  // shadow pass helpers
  function sp(x, y, z) { return ip(x + z * LA, y + z * LB, 0); }
  function hull(pts) {
    pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    lo.pop(); up.pop();
    const h = lo.concat(up);
    if (h.length < 3) return;
    SH.beginPath(); h.forEach((p, i) => i ? SH.lineTo(p[0], p[1]) : SH.moveTo(p[0], p[1])); SH.closePath(); SH.fill();
  }
  function rectPts(x0, y0, x1, y1, z) { return [sp(x0, y0, z), sp(x1, y0, z), sp(x1, y1, z), sp(x0, y1, z)]; }
  function circPts(cx, cy, r, z) { const o = []; for (let i = 0; i < 12; i++) { const a = i / 12 * 6.2832; o.push(sp(cx + Math.cos(a) * r, cy + Math.sin(a) * r, z)); } return o; }

  // surface texture on a vertical face. P(u, z) maps face coords (tiles along, px up) to screen.
  function tex(ctx, P, W, z0, z1, mat) {
    const H = z1 - z0;
    if (!mat || H < 2.5 || W < 0.08) return;
    const jc = 'rgba(30,22,14,.27)';
    const q = (u0, u1, za, zb, fill) => poly(ctx, [P(u0, za), P(u1, za), P(u1, zb), P(u0, zb)], fill, null);
    if (typeof mat === 'number') { for (let i = 1; i <= mat; i++) { const z = z0 + H * i / (mat + 1); line(ctx, P(0, z), P(W, z), 'rgba(30,20,10,.22)', 0.6); } return; }
    if (mat === 'stone') {
      const rows = Math.max(1, Math.round(H / 5.5)), rh = H / rows, bw = 0.27;
      for (let r = 0; r < rows; r++) {
        const za = z0 + r * rh, zb = za + rh, off = (r % 2) * bw / 2 + 0.03;
        for (let u = -off; u < W; u += bw) {
          const u0 = Math.max(0, u), u1 = Math.min(W, u + bw);
          if (u1 - u0 < 0.04) continue;
          const t = rnd();
          if (t < 0.28) q(u0, u1, za, zb, `rgba(255,250,235,${(0.05 + 0.09 * rnd()).toFixed(3)})`);
          else if (t < 0.52) q(u0, u1, za, zb, `rgba(20,14,8,${(0.05 + 0.1 * rnd()).toFixed(3)})`);
          if (u0 > 0.01) line(ctx, P(u0, za), P(u0, zb), jc, 0.55);
        }
        if (r > 0) line(ctx, P(0, za), P(W, za), jc, 0.55);
      }
    } else if (mat === 'wood') {
      const rows = Math.max(1, Math.round(H / 4.2)), rh = H / rows;
      for (let r = 0; r < rows; r++) {
        const za = z0 + r * rh, zb = za + rh;
        q(0, W, za, zb, rnd() > 0.5 ? `rgba(255,236,200,${(0.03 + 0.07 * rnd()).toFixed(3)})` : `rgba(20,10,0,${(0.03 + 0.09 * rnd()).toFixed(3)})`);
        if (r > 0) line(ctx, P(0, za), P(W, za), 'rgba(30,18,6,.4)', 0.6);
        if (rnd() > 0.5) { const u = rnd() * W; line(ctx, P(u, za + 0.5), P(u, zb - 0.5), 'rgba(30,18,6,.3)', 0.5); }
      }
    } else if (mat === 'board') {
      const bw = 0.15;
      for (let u = 0; u < W; u += bw) {
        const u1 = Math.min(W, u + bw);
        q(u, u1, z0, z1, rnd() > 0.5 ? `rgba(255,236,200,${(0.03 + 0.07 * rnd()).toFixed(3)})` : `rgba(20,10,0,${(0.03 + 0.1 * rnd()).toFixed(3)})`);
        if (u > 0) line(ctx, P(u, z0), P(u, z1), 'rgba(30,18,6,.4)', 0.6);
      }
    } else if (mat === 'plaster') {
      for (let k = 0; k < 6; k++) { const u = rnd() * W * 0.8, z = z0 + rnd() * H * 0.8; q(u, u + W * (0.1 + 0.15 * rnd()), z, z + H * (0.08 + 0.12 * rnd()), rnd() > 0.5 ? 'rgba(120,96,60,.07)' : 'rgba(255,255,255,.08)'); }
      line(ctx, P(0, z0 + 1.2), P(W, z0 + 1.2), 'rgba(90,70,40,.25)', 1.6);
    }
  }

  function box(ctx, x0, y0, x1, y1, z0, z1, col, mat, topCol) {
    if (SH) { hull(rectPts(x0, y0, x1, y1, z0).concat(rectPts(x0, y0, x1, y1, z1))); return; }
    const Lc = shade(col, -0.05), Rc = shade(col, -0.3), T = topCol || shade(col, 0.18);
    face(ctx, [ip(x0, y1, z0), ip(x1, y1, z0), ip(x1, y1, z1), ip(x0, y1, z1)], Lc, 0.1, -0.16);
    tex(ctx, (u, z) => ip(x0 + u, y1, z), x1 - x0, z0, z1, mat);
    face(ctx, [ip(x1, y0, z0), ip(x1, y1, z0), ip(x1, y1, z1), ip(x1, y0, z1)], Rc, 0.06, -0.2);
    tex(ctx, (u, z) => ip(x1, y1 - u, z), y1 - y0, z0, z1, mat);
    poly(ctx, [ip(x0, y0, z1), ip(x1, y0, z1), ip(x1, y1, z1), ip(x0, y1, z1)], T);
    if (z1 - z0 > 5) {
      line(ctx, ip(x0, y1, z1), ip(x1, y1, z1), 'rgba(255,255,255,.3)', 0.8);
      line(ctx, ip(x1, y1, z0 + 1), ip(x1, y1, z1 - 1), 'rgba(255,255,255,.14)', 0.7);
    }
  }
  // soft shadow thrown on the walls just under a roof
  function eave(ctx, x0, y0, x1, y1, z, d) {
    for (let i = 0; i < 4; i++) {
      const a = 0.11 * (1 - i / 4), za = z - d * (i + 1) / 4, zb = z - d * i / 4;
      quadL(ctx, y1, x0, x1, za, zb, `rgba(10,6,0,${a.toFixed(3)})`);
      quadR(ctx, x1, y0, y1, za, zb, `rgba(10,6,0,${a.toFixed(3)})`);
    }
  }
  // roof plane between an eave edge and a ridge edge
  function slope(ctx, E0, E1, R0, R1, col, mat, hi, lo) {
    face(ctx, [E0, E1, R1, R0], col, hi, lo);
    const len = Math.hypot(E1[0] - E0[0], E1[1] - E0[1]), dep = Math.hypot(R0[0] - E0[0], R0[1] - E0[1]);
    if (mat === 'thatch') {
      const n = Math.round(len * dep / 9);
      for (let i = 0; i < n; i++) {
        const s = rnd(), t = rnd() * 0.85, a = mix(mix(E0, E1, s), mix(R0, R1, s), t), b = mix(mix(E0, E1, s), mix(R0, R1, s), Math.min(1, t + 0.12 + rnd() * 0.12));
        line(ctx, a, b, rnd() > 0.5 ? 'rgba(90,64,20,.3)' : 'rgba(255,240,170,.3)', 0.7);
      }
      for (let i = 1; i < 3; i++) line(ctx, mix(E0, R0, i / 3), mix(E1, R1, i / 3), 'rgba(70,48,14,.28)', 0.9);
      line(ctx, E0, E1, 'rgba(60,40,10,.5)', 1.3);
      return;
    }
    const rows = Math.max(2, Math.round(dep / 4.6)), cols = Math.max(1, Math.round(len / 6.5));
    for (let i = 0; i < rows; i++) {
      const a0 = mix(E0, R0, i / rows), a1 = mix(E1, R1, i / rows);
      if (i > 0) { line(ctx, a0, a1, 'rgba(0,0,0,.24)', 0.7); line(ctx, [a0[0], a0[1] + 0.9], [a1[0], a1[1] + 0.9], 'rgba(255,255,255,.1)', 0.5); }
      for (let j = 0; j < cols; j++) {
        const s = (j + (i % 2 ? 0.5 : 0)) / cols;
        if (s <= 0.01 || s >= 0.99) continue;
        const p = mix(mix(E0, E1, s), mix(R0, R1, s), i / rows), q = mix(mix(E0, E1, s), mix(R0, R1, s), (i + 1) / rows);
        line(ctx, p, q, 'rgba(0,0,0,.14)', 0.5);
      }
    }
    line(ctx, E0, E1, 'rgba(0,0,0,.35)', 1);
  }
  function gable(ctx, x0, y0, x1, y1, z, rise, col, axis, wallCol, mat) {
    if (axis === 'x') {
      const ym = (y0 + y1) / 2;
      if (SH) { hull(rectPts(x0, y0, x1, y1, z).concat([sp(x0, ym, z + rise), sp(x1, ym, z + rise)])); return; }
      poly(ctx, [ip(x0, y0, z), ip(x1, y0, z), ip(x1, ym, z + rise), ip(x0, ym, z + rise)], shade(col, -0.42));
      face(ctx, [ip(x1, y0, z), ip(x1, y1, z), ip(x1, ym, z + rise)], shade(wallCol, -0.3), 0.04, -0.14);
      slope(ctx, ip(x0, y1, z), ip(x1, y1, z), ip(x0, ym, z + rise), ip(x1, ym, z + rise), col, mat, 0.16, -0.16);
      line(ctx, ip(x0, ym, z + rise), ip(x1, ym, z + rise), shade(col, 0.4), 1.3);
      line(ctx, ip(x1, y1, z), ip(x1, ym, z + rise), shade(col, -0.45), 1.6);
      line(ctx, ip(x1, y0, z), ip(x1, ym, z + rise), shade(col, -0.5), 1.2);
    } else {
      const xm = (x0 + x1) / 2;
      if (SH) { hull(rectPts(x0, y0, x1, y1, z).concat([sp(xm, y0, z + rise), sp(xm, y1, z + rise)])); return; }
      poly(ctx, [ip(x0, y0, z), ip(x0, y1, z), ip(xm, y1, z + rise), ip(xm, y0, z + rise)], shade(col, -0.05));
      face(ctx, [ip(x0, y1, z), ip(x1, y1, z), ip(xm, y1, z + rise)], shade(wallCol, -0.06), 0.06, -0.12);
      slope(ctx, ip(x1, y1, z), ip(x1, y0, z), ip(xm, y1, z + rise), ip(xm, y0, z + rise), shade(col, -0.22), mat, 0.08, -0.14);
      line(ctx, ip(xm, y0, z + rise), ip(xm, y1, z + rise), shade(col, 0.35), 1.3);
      line(ctx, ip(x0, y1, z), ip(xm, y1, z + rise), shade(col, 0.2), 1.4);
      line(ctx, ip(x1, y1, z), ip(xm, y1, z + rise), shade(col, -0.45), 1.4);
    }
  }
  function pyramid(ctx, x0, y0, x1, y1, z, rise, col, mat) {
    if (SH) { hull(rectPts(x0, y0, x1, y1, z).concat([sp((x0 + x1) / 2, (y0 + y1) / 2, z + rise)])); return; }
    const a = ip((x0 + x1) / 2, (y0 + y1) / 2, z + rise);
    poly(ctx, [ip(x0, y0, z), ip(x1, y0, z), a], shade(col, -0.44));
    poly(ctx, [ip(x0, y0, z), ip(x0, y1, z), a], shade(col, -0.12));
    slope(ctx, ip(x0, y1, z), ip(x1, y1, z), a, a, shade(col, 0.04), mat, 0.16, -0.12);
    slope(ctx, ip(x1, y1, z), ip(x1, y0, z), a, a, shade(col, -0.26), mat, 0.06, -0.14);
    line(ctx, ip(x1, y1, z), a, shade(col, 0.32), 1);
  }
  function cyl(ctx, cx, cy, r, z0, z1, col, r2, mat) {
    const rt = r2 === undefined ? r : r2;
    if (SH) { hull(circPts(cx, cy, r, z0).concat(circPts(cx, cy, rt, z1))); return; }
    const [sx, sy] = ip(cx, cy, 0), rx = r * 45.25, ry = r * 22.63, rx2 = rt * 45.25, ry2 = rt * 22.63;
    const g = ctx.createLinearGradient(sx - rx, 0, sx + rx, 0);
    g.addColorStop(0, shade(col, -0.16)); g.addColorStop(0.3, shade(col, 0.14)); g.addColorStop(0.62, shade(col, -0.12)); g.addColorStop(1, shade(col, -0.46));
    ctx.beginPath();
    ctx.ellipse(sx, sy - z0, rx, ry, 0, 0, Math.PI, false);
    ctx.lineTo(sx - rx2, sy - z1);
    ctx.ellipse(sx, sy - z1, rx2, ry2, 0, Math.PI, 0, true);
    ctx.closePath();
    ctx.fillStyle = g; ctx.fill();
    if (mat === 'stone') {
      const H = z1 - z0, rows = Math.max(1, Math.round(H / 5.5)), rh = H / rows;
      ctx.strokeStyle = 'rgba(30,22,14,.24)'; ctx.lineWidth = 0.55;
      for (let k = 0; k < rows; k++) {
        const f = k / rows, f2 = (k + 1) / rows, ra = lerp(rx, rx2, f), rb = lerp(ry, ry2, f), za = z0 + k * rh;
        if (k > 0) { ctx.beginPath(); ctx.ellipse(sx, sy - za, ra, rb, 0, 0.06, Math.PI - 0.06); ctx.stroke(); }
        for (let a = 0.25 + (k % 2) * 0.2; a < Math.PI - 0.15; a += 0.4) {
          const x = Math.cos(a), y = Math.sin(a);
          ctx.beginPath(); ctx.moveTo(sx + x * ra, sy - za + y * rb); ctx.lineTo(sx + x * lerp(rx, rx2, f2), sy - za - rh + y * lerp(ry, ry2, f2)); ctx.stroke();
          if (rnd() < 0.3) { ctx.fillStyle = rnd() > 0.5 ? 'rgba(255,250,235,.09)' : 'rgba(20,14,8,.1)'; const xb = Math.cos(a + 0.4), yb = Math.sin(a + 0.4); ctx.beginPath(); ctx.moveTo(sx + x * ra, sy - za + y * rb); ctx.lineTo(sx + xb * ra, sy - za + yb * rb); ctx.lineTo(sx + xb * ra, sy - za - rh + yb * rb); ctx.lineTo(sx + x * ra, sy - za - rh + y * rb); ctx.fill(); }
        }
      }
    }
    ctx.beginPath();
    ctx.ellipse(sx, sy - z0, rx, ry, 0, 0, Math.PI, false);
    ctx.lineTo(sx - rx2, sy - z1);
    ctx.ellipse(sx, sy - z1, rx2, ry2, 0, Math.PI, 0, true);
    ctx.closePath(); ctx.strokeStyle = OUT; ctx.lineWidth = 0.7; ctx.stroke();
    ell(ctx, sx, sy - z1, rx2, ry2, shade(col, 0.2), OUT);
  }
  function cone(ctx, cx, cy, r, z, rise, col, mat) {
    if (SH) { hull(circPts(cx, cy, r, z).concat([sp(cx, cy, z + rise)])); return; }
    const [sx, sy] = ip(cx, cy, 0), rx = r * 45.25, ry = r * 22.63;
    const g = ctx.createLinearGradient(sx - rx, 0, sx + rx, 0);
    g.addColorStop(0, shade(col, -0.1)); g.addColorStop(0.3, shade(col, 0.22)); g.addColorStop(0.6, shade(col, -0.08)); g.addColorStop(1, shade(col, -0.44));
    ctx.beginPath(); ctx.moveTo(sx, sy - z - rise); ctx.lineTo(sx + rx, sy - z);
    ctx.ellipse(sx, sy - z, rx, ry, 0, 0, Math.PI, false);
    ctx.closePath(); ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = OUT; ctx.lineWidth = 0.7; ctx.stroke();
    ctx.strokeStyle = mat === 'thatch' ? 'rgba(80,56,16,.3)' : 'rgba(0,0,0,.2)'; ctx.lineWidth = 0.6;
    for (let k = 1; k < 4; k++) { const f = k / 4; ctx.beginPath(); ctx.ellipse(sx, sy - z - rise * f, rx * (1 - f), ry * (1 - f), 0, 0.1, Math.PI - 0.1); ctx.stroke(); }
    for (let a = 0.2; a < Math.PI; a += mat === 'thatch' ? 0.22 : 0.42) { ctx.beginPath(); ctx.moveTo(sx, sy - z - rise); ctx.lineTo(sx + Math.cos(a) * rx, sy - z + Math.sin(a) * ry); ctx.stroke(); }
  }
  function crenels(ctx, x0, y0, x1, y1, z, s, h, col) {
    if (SH) return;
    const list = [], nx = Math.max(2, Math.round((x1 - x0) / (s * 2))), ny = Math.max(2, Math.round((y1 - y0) / (s * 2)));
    for (let i = 0; i <= nx; i++) { const x = lerp(x0, x1 - s, i / nx); list.push([x, y0], [x, y1 - s]); }
    for (let i = 1; i < ny; i++) { const y = lerp(y0, y1 - s, i / ny); list.push([x0, y], [x1 - s, y]); }
    list.sort((a, b) => (a[0] + a[1]) - (b[0] + b[1]));
    for (const [x, y] of list) box(ctx, x, y, x + s, y + s, z, z + h, col);
  }
  // merlons around the rim of a round tower
  function ringCrenels(ctx, cx, cy, r, z, h, col) {
    if (SH) return;
    const list = [];
    for (let i = 0; i < 10; i++) { const a = i / 10 * 6.2832 + 0.3; list.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
    list.sort((a, b) => (a[0] + a[1]) - (b[0] + b[1]));
    for (const [x, y] of list) box(ctx, x - 0.07, y - 0.07, x + 0.07, y + 0.07, z, z + h, col);
  }
  function pole(ctx, x, y, z, h) {
    const a = ip(x, y, z);
    line(ctx, a, [a[0], a[1] - h], '#3c2c1c', 1.6); line(ctx, [a[0] - 0.4, a[1]], [a[0] - 0.4, a[1] - h], 'rgba(255,230,180,.35)', 0.5);
    ell(ctx, a[0], a[1] - h - 1, 1.4, 1.4, GOLD, '#7a5a10');
  }
  // window / arched opening on a left-facing (y = const) or right-facing (x = const) wall
  function winL(ctx, y, x, z, w, h) {
    quadL(ctx, y, x - w / 2 - 0.03, x + w / 2 + 0.03, z - 1, z + h + 1, '#5a3e22');
    quadL(ctx, y, x - w / 2, x + w / 2, z, z + h, '#22364a');
    poly(ctx, [ip(x - w / 2, y, z + h), ip(x + w / 2, y, z + h), ip(x - w / 2, y, z + h * 0.35)], 'rgba(170,210,240,.4)', null);
    line(ctx, ip(x, y, z), ip(x, y, z + h), '#5a3e22', 0.7); line(ctx, ip(x - w / 2, y, z + h / 2), ip(x + w / 2, y, z + h / 2), '#5a3e22', 0.7);
  }
  function winR(ctx, x, y, z, w, h) {
    quadR(ctx, x, y - w / 2 - 0.03, y + w / 2 + 0.03, z - 1, z + h + 1, '#4a321a');
    quadR(ctx, x, y - w / 2, y + w / 2, z, z + h, '#1a2a3a');
    poly(ctx, [ip(x, y - w / 2, z + h), ip(x, y + w / 2, z + h), ip(x, y + w / 2, z + h * 0.4)], 'rgba(150,190,220,.3)', null);
    line(ctx, ip(x, y, z), ip(x, y, z + h), '#4a321a', 0.7);
  }
  function archPts(P, c, z0, w, h) {
    const rz = Math.min(h * 0.5, w * 18), pts = [P(c - w / 2, z0), P(c + w / 2, z0)];
    for (let k = 0; k <= 8; k++) { const t = Math.PI * k / 8; pts.push(P(c + w / 2 * Math.cos(t), z0 + h - rz + rz * Math.sin(t))); }
    return pts;
  }
  function archL(ctx, y, xc, z0, w, h, fill, frame) {
    const P = (u, z) => ip(u, y, z);
    if (frame) poly(ctx, archPts(P, xc, z0, w + 0.1, h + 2), frame, null);
    poly(ctx, archPts(P, xc, z0, w, h), fill, 'rgba(0,0,0,.45)');
  }
  function archR(ctx, x, yc, z0, w, h, fill, frame) {
    const P = (u, z) => ip(x, u, z);
    if (frame) poly(ctx, archPts(P, yc, z0, w + 0.1, h + 2), frame, null);
    poly(ctx, archPts(P, yc, z0, w, h), fill, 'rgba(0,0,0,.45)');
  }
  function planksL(ctx, y, xa, xb, z0, z1) { for (let x = xa + 0.1; x < xb - 0.02; x += 0.1) line(ctx, ip(x, y, z0 + 0.5), ip(x, y, z1), 'rgba(0,0,0,.4)', 0.6); }
  function barrel(ctx, x, y, z) {
    if (SH) { hull(circPts(x, y, 0.14, z).concat(circPts(x, y, 0.14, z + 11))); return; }
    cyl(ctx, x, y, 0.14, z, z + 11, '#7b5630');
    const [sx, sy] = ip(x, y, z);
    for (const dz of [3, 8]) { ctx.beginPath(); ctx.ellipse(sx, sy - dz, 6.4, 3.2, 0, 0.1, Math.PI - 0.1); ctx.strokeStyle = '#3a3630'; ctx.lineWidth = 0.9; ctx.stroke(); }
  }
  function crate(ctx, x, y, z, s, h) {
    box(ctx, x - s, y - s, x + s, y + s, z, z + h, '#9a7444', 'wood');
    if (!SH) { line(ctx, ip(x - s, y + s, z), ip(x + s, y + s, z + h), 'rgba(50,30,10,.5)', 0.8); line(ctx, ip(x + s, y + s, z), ip(x + s, y - s, z + h), 'rgba(40,24,8,.5)', 0.8); }
  }
  function sack(ctx, x, y) { const [sx, sy] = ip(x, y, 0); ell(ctx, sx + 1, sy + 1, 5.4, 2.4, 'rgba(0,0,0,.2)'); ell(ctx, sx, sy - 2.5, 4.6, 4, '#d6c18a', OUT); ell(ctx, sx - 1.2, sy - 3.8, 2, 1.5, '#ebdcae'); line(ctx, [sx - 1.6, sy - 6.2], [sx + 1.6, sy - 6.2], '#8a6a3a', 1.2); }
  function goldPile(ctx, x, y, z, r) {
    const [gx, gy] = ip(x, y, z);
    ell(ctx, gx, gy, r, r * 0.5, '#b98a1c'); ell(ctx, gx - 0.6, gy - r * 0.22, r * 0.72, r * 0.4, '#e2b232'); ell(ctx, gx - 1, gy - r * 0.42, r * 0.42, r * 0.26, '#f6d458');
    for (let i = 0; i < 5; i++) { ctx.fillStyle = '#fff6c2'; ctx.fillRect(gx + (rnd() - 0.5) * r * 1.2, gy - rnd() * r * 0.6, 1, 1); }
  }
  function emblem(ctx, c, col, s) { poly(ctx, [[c[0], c[1] - s], [c[0] + s * 0.8, c[1]], [c[0], c[1] + s], [c[0] - s * 0.8, c[1]]], col.light, col.dark, 0.6); }

  // ---- buildings ----------------------------------------------------------
  const FLAGS = {
    keep: [[0, 0, 111]], barracks: [[-1.3, 0.55, 48]], mint: [[1.2, 0.45, 43]], siegeworks: [[1.3, -0.5, 45]], skyfire: [[-1.3, -1.3, 39], [1.3, 1.3, 39]],
    bombardtower: [[-0.5, -0.5, 66]], watchtower: [[0, 0, 81]], stable: [[-1.3, -0.72, 54]],
  };
  const BDRAW = {
    keep(ctx, col) {
      box(ctx, -1.46, -1.46, 1.46, 1.46, 0, 4, '#8f8a7e', 'stone');
      cyl(ctx, -1.2, -1.2, 0.3, 4, 42, STONE, 0.3, 'stone'); cone(ctx, -1.2, -1.2, 0.35, 42, 16, col.main);
      box(ctx, -1.22, -1.22, 1.22, 1.22, 4, 30, STONE, 'stone');
      // gate
      archL(ctx, 1.22, 0, 4, 0.72, 23, '#24180c', '#6f6a60');
      planksL(ctx, 1.22, -0.34, 0.34, 4, 19);
      for (const z of [9, 16]) line(ctx, ip(-0.33, 1.22, z), ip(0.33, 1.22, z), '#4a4640', 1.1);
      for (const x of [-0.8, 0.8]) quadL(ctx, 1.22, x - 0.035, x + 0.035, 12, 22, DARK);
      quadR(ctx, 1.22, -0.32, 0.32, 8, 26, col.main, OUT); quadR(ctx, 1.22, -0.32, 0.32, 23, 26, col.dark);
      emblem(ctx, ip(1.22, 0, 16), col, 4.2);
      for (const y of [-0.85, 0.85]) quadR(ctx, 1.22, y - 0.035, y + 0.035, 12, 22, '#1c140c');
      crenels(ctx, -1.22, -1.22, 1.22, 1.22, 30, 0.2, 5, STONE);
      cyl(ctx, 1.2, -1.2, 0.3, 4, 42, STONE, 0.3, 'stone'); cone(ctx, 1.2, -1.2, 0.35, 42, 16, col.main);
      cyl(ctx, -1.2, 1.2, 0.3, 4, 42, STONE, 0.3, 'stone'); cone(ctx, -1.2, 1.2, 0.35, 42, 16, col.main);
      box(ctx, -0.62, -0.62, 0.62, 0.62, 30, 64, '#b4afa4', 'stone');
      archL(ctx, 0.62, 0, 42, 0.2, 13, '#1c140c', '#7d786e'); archR(ctx, 0.62, 0, 42, 0.2, 13, '#140e08', '#6a665d');
      for (const x of [-0.38, 0.38]) quadL(ctx, 0.62, x - 0.03, x + 0.03, 46, 55, DARK);
      for (const y of [-0.38, 0.38]) quadR(ctx, 0.62, y - 0.03, y + 0.03, 46, 55, '#1c140c');
      box(ctx, -0.74, -0.74, 0.74, 0.74, 64, 68, STONE_D);
      crenels(ctx, -0.74, -0.74, 0.74, 0.74, 68, 0.18, 4, STONE);
      pyramid(ctx, -0.5, -0.5, 0.5, 0.5, 70, 24, col.main);
      pole(ctx, 0, 0, 93, 18);
      cyl(ctx, 1.2, 1.2, 0.3, 4, 42, STONE, 0.3, 'stone'); cone(ctx, 1.2, 1.2, 0.35, 42, 16, col.main);
      if (!SH) { const [sx, sy] = ip(1.2, 1.2, 26); ctx.fillStyle = DARK; ctx.fillRect(sx - 4.5, sy - 5, 1.6, 6); }
    },
    mill(ctx, col) {
      if (!SH) { const g = ctx.createRadialGradient(0, 2, 6, 0, 2, 42); g.addColorStop(0, 'rgba(150,130,90,.95)'); g.addColorStop(0.7, 'rgba(150,130,90,.7)'); g.addColorStop(1, 'rgba(150,130,90,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, 2, 44, 22, 0, 0, 7); ctx.fill(); }
      sack(ctx, -0.72, 0.2); sack(ctx, -0.55, 0.42);
      cyl(ctx, 0, 0, 0.62, 0, 40, '#c8bfac', 0.46, 'stone');
      archL(ctx, 0.56, -0.12, 0, 0.26, 15, '#2a1c0e', '#8a7a62');
      if (!SH) { ctx.fillStyle = '#1e2a36'; ctx.beginPath(); ctx.roundRect(5, -31, 4.4, 7, [2.2, 2.2, 0, 0]); ctx.fill(); ctx.strokeStyle = '#5a3e22'; ctx.lineWidth = 0.8; ctx.stroke(); }
      cyl(ctx, 0, 0, 0.475, 36, 41, col.main, 0.47);
      cone(ctx, 0, 0, 0.54, 41, 21, THATCH, 'thatch');
      sack(ctx, 0.62, 0.55);
      barrel(ctx, 0.25, 0.78, 0);
    },
    mint(ctx, col) {
      box(ctx, -1.46, -1.46, 1.46, 1.46, 0, 3, '#979182', 'stone');
      box(ctx, -1.22, -1.22, 0.55, 0.95, 3, 30, PLASTER, 'plaster');
      for (const x of [-1.22, -0.62, -0.05, 0.55]) line(ctx, ip(x, 0.95, 3), ip(x, 0.95, 30), WOOD_D, 1.5);
      line(ctx, ip(-1.22, 0.95, 18), ip(0.55, 0.95, 18), WOOD_D, 1.3); line(ctx, ip(-1.22, 0.95, 29.3), ip(0.55, 0.95, 29.3), WOOD_D, 1.4);
      line(ctx, ip(-0.62, 0.95, 18), ip(-0.05, 0.95, 30), WOOD_D, 1); line(ctx, ip(-1.22, 0.95, 30), ip(-0.62, 0.95, 18), WOOD_D, 1);
      for (const y of [-1.22, -0.4, 0.3, 0.95]) line(ctx, ip(0.55, y, 3), ip(0.55, y, 30), shade(WOOD_D, -0.2), 1.5);
      archL(ctx, 0.95, -0.34, 3, 0.4, 15, '#3a2614', WOOD_D); planksL(ctx, 0.95, -0.52, -0.16, 3, 13);
      winL(ctx, 0.95, -0.92, 20, 0.26, 7);
      if (!SH) { const [cx, cy] = ip(0.25, 0.95, 23); ell(ctx, cx, cy, 5.2, 5.6, '#b98a1c', '#5a400a'); ell(ctx, cx - 0.4, cy - 0.4, 4.2, 4.6, GOLD); ell(ctx, cx, cy, 2.2, 2.6, null, '#8a6a12'); ctx.fillStyle = '#fff6c2'; ctx.fillRect(cx - 2.6, cy - 3, 1.4, 1.4); }
      eave(ctx, -1.22, -1.22, 0.55, 0.95, 30, 5);
      gable(ctx, -1.32, -1.34, 0.65, 1.07, 30, 22, col.main, 'x', PLASTER);
      box(ctx, -0.7, -0.75, -0.42, -0.47, 38, 64, '#8a6f5c', 'stone'); box(ctx, -0.73, -0.78, -0.39, -0.44, 64, 66, '#6a5548');
      box(ctx, 0.55, -1.05, 1.3, 0.55, 3, 21, STONE, 'stone');
      archR(ctx, 1.3, -0.25, 3, 0.5, 14, '#33302c', '#6f6a60');
      for (const y of [-0.42, -0.25, -0.08]) line(ctx, ip(1.3, y, 3.5), ip(1.3, y, 14), '#5c5850', 0.8);
      line(ctx, ip(1.3, -0.5, 8.5), ip(1.3, 0, 8.5), '#5c5850', 0.8);
      crenels(ctx, 0.55, -1.05, 1.3, 0.55, 21, 0.16, 3, STONE);
      if (!SH) goldPile(ctx, 0.92, -0.25, 22, 9);
      pole(ctx, 1.2, 0.45, 24, 18);
      crate(ctx, 0.97, 1.15, 0, 0.21, 8); if (!SH) goldPile(ctx, 0.97, 1.15, 9, 6.5);
      crate(ctx, 0.36, 1.24, 0, 0.14, 6);
      barrel(ctx, -1.25, 1.22, 3);
    },
    barracks(ctx, col) {
      box(ctx, -1.46, -0.96, 1.46, 0.96, 0, 3, '#8a8170', 'stone');
      box(ctx, -1.3, -0.8, 0.95, 0.55, 3, 24, WOOD, 'wood');
      archL(ctx, 0.55, -0.3, 3, 0.42, 16, '#22160c', WOOD_D);
      winL(ctx, 0.55, -0.98, 12, 0.24, 7);
      if (!SH) for (const x of [0.22, 0.6]) { const [cx, cy] = ip(x, 0.55, 14); ell(ctx, cx, cy, 4.2, 4.8, col.dark, OUT); ell(ctx, cx - 0.3, cy - 0.3, 3.4, 4, col.main); ell(ctx, cx, cy, 1.4, 1.6, col.light); }
      winR(ctx, 0.95, -0.1, 11, 0.3, 7);
      eave(ctx, -1.3, -0.8, 0.95, 0.55, 24, 5);
      gable(ctx, -1.4, -0.92, 1.05, 0.67, 24, 19, col.main, 'x', WOOD);
      // yard: dummy and rack
      if (!SH) {
        { const a = ip(1.22, 0.3, 0); ell(ctx, a[0] + 1, a[1] + 1, 5, 2, 'rgba(0,0,0,.2)'); line(ctx, a, [a[0], a[1] - 16], WOOD_D, 2); line(ctx, [a[0] - 6, a[1] - 11], [a[0] + 6, a[1] - 11], WOOD_D, 2); ell(ctx, a[0], a[1] - 18, 3, 3, '#cdb37a', OUT); ctx.fillStyle = '#b89a5c'; ctx.fillRect(a[0] - 2.6, a[1] - 14, 5.2, 6); }
        { const a = ip(1.25, -0.45, 0); line(ctx, [a[0] - 7, a[1] - 4], [a[0] + 7, a[1] + 3], WOOD_D, 1.6);
          for (let i = -1; i <= 1; i++) { line(ctx, [a[0] + i * 5, a[1] + i * 2.5], [a[0] + i * 5 + 2, a[1] + i * 2.5 - 17], '#7a5a34', 1); line(ctx, [a[0] + i * 5 + 1.6, a[1] + i * 2.5 - 14], [a[0] + i * 5 + 2.2, a[1] + i * 2.5 - 19], IRON, 1.4); } }
      }
      pole(ctx, -1.3, 0.55, 3, 44);
      barrel(ctx, -1.35, 0.82, 3);
    },
    stable(ctx, col) {
      box(ctx, -1.46, -1.46, 1.46, 1.46, 0, 2, '#9a8a62');
      box(ctx, -1.3, -1.3, 1.3, -0.15, 2, 24, WOOD, 'board');
      for (const x of [-1.05, -0.3, 0.45]) {
        quadL(ctx, -0.15, x, x + 0.55, 2, 17, '#1e140c'); line(ctx, ip(x, -0.15, 17), ip(x + 0.55, -0.15, 17), WOOD_D, 1.4);
        quadL(ctx, -0.15, x, x + 0.55, 2, 9.5, '#6f4c28'); planksL(ctx, -0.15, x, x + 0.55, 2, 9.5); line(ctx, ip(x, -0.15, 9.5), ip(x + 0.55, -0.15, 9.5), WOOD_D, 1.2);
      }
      if (!SH) for (const [x, c] of [[-0.78, '#6b4a2e'], [0.72, '#3d3632']]) { const a = ip(x, -0.15, 12); ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(a[0] + 1.6, a[1] - 0.6, 3.6, 2.2, 0.5, 0, 7); ctx.fill(); ctx.strokeStyle = OUT; ctx.lineWidth = 0.6; ctx.stroke(); ctx.fillRect(a[0] - 2.4, a[1] - 0.6, 3, 4.6); line(ctx, [a[0] - 0.8, a[1] - 2.4], [a[0] - 1.2, a[1] - 4.4], c, 1.2); }
      quadL(ctx, -0.15, 1.05, 1.25, 7, 21, col.main, OUT); emblem(ctx, ip(1.15, -0.15, 14), col, 2.6);
      winR(ctx, 1.3, -0.72, 10, 0.36, 8);
      eave(ctx, -1.3, -1.3, 1.3, -0.15, 24, 5);
      gable(ctx, -1.42, -1.42, 1.42, -0.03, 24, 17, THATCH, 'x', WOOD, 'thatch');
      line(ctx, ip(-1.42, -0.03, 24), ip(1.42, -0.03, 24), col.main, 2.2);
      pole(ctx, -1.3, -0.72, 41, 12);
      box(ctx, -0.95, 0.45, -0.5, 0.9, 2, 10, '#d8b84e', 2);
      if (!SH) for (let i = 0; i < 14; i++) { const a = ip(-0.95 + rnd() * 0.45, 0.9, 2.5 + rnd() * 7); line(ctx, a, [a[0] + 2.4, a[1] + 0.6], 'rgba(130,100,20,.5)', 0.6); }
      box(ctx, 0.35, 0.55, 1.0, 0.8, 2, 6, WOOD_D); if (!SH) poly(ctx, [ip(0.39, 0.59, 6), ip(0.96, 0.59, 6), ip(0.96, 0.76, 6), ip(0.39, 0.76, 6)], '#3f7fa8', null);
      // paddock rails
      const rail = (a, b) => { for (const z of [5, 9]) { line(ctx, ip(a[0], a[1], z), ip(b[0], b[1], z), '#4a3218', 1.9); line(ctx, ip(a[0], a[1], z + 0.5), ip(b[0], b[1], z + 0.5), '#8a6238', 1); } };
      rail([-1.36, 0.0], [-1.36, 1.36]); rail([-1.36, 1.36], [1.36, 1.36]); rail([1.36, 1.36], [1.36, 0.0]);
      for (const [x, y] of [[-1.36, 0], [-1.36, 0.68], [-1.36, 1.36], [-0.45, 1.36], [0.45, 1.36], [1.36, 1.36], [1.36, 0.68], [1.36, 0]]) { line(ctx, ip(x, y, 0), ip(x, y, 11), '#3c2814', 2.4); line(ctx, ip(x, y, 0.5), ip(x, y, 10.5), '#7a5630', 1.2); }
    },
    beacon(ctx, col) {
      box(ctx, -0.8, -0.8, 0.8, 0.8, 0, 9, STONE_D, 'stone');
      archL(ctx, 0.8, 0, 0, 0.3, 8, '#1e140c');
      box(ctx, -0.42, -0.42, 0.42, 0.42, 9, 70, STONE, 'stone');
      quadL(ctx, 0.42, -0.17, 0.17, 33, 61, col.main, OUT); quadL(ctx, 0.42, -0.17, 0.17, 58, 61, col.dark); emblem(ctx, ip(0, 0.42, 46), col, 4);
      poly(ctx, [ip(-0.17, 0.42, 33), ip(0, 0.42, 36.5), ip(0.17, 0.42, 33), ip(0.17, 0.42, 31), ip(-0.17, 0.42, 31)], STONE, null);
      archR(ctx, 0.42, 0, 40, 0.14, 12, '#1c140c', '#6a665d');
      quadR(ctx, 0.42, -0.03, 0.03, 20, 28, '#1c140c');
      box(ctx, -0.6, -0.6, 0.6, 0.6, 70, 75, WOOD, 'wood');
      if (!SH) { const [bx, by] = ip(0, 0, 77); ell(ctx, bx, by, 9, 4.5, '#2e2a26', OUT); ell(ctx, bx, by - 1, 6, 2.8, '#5a2a0e'); }
      for (const [x, y] of [[-0.55, -0.55], [0.55, -0.55], [-0.55, 0.55], [0.55, 0.55]]) line(ctx, ip(x, y, 75), ip(x, y, 93), WOOD_D, 1.7);
      pyramid(ctx, -0.68, -0.68, 0.68, 0.68, 93, 17, col.main);
      barrel(ctx, 0.95, 0.4, 0);
    },
    siegeworks(ctx, col) {
      box(ctx, -1.46, -1.46, 1.46, 1.46, 0, 2, '#8f7d5c');
      box(ctx, -1.3, -1.3, 1.3, -0.5, 2, 22, WOOD, 'wood');
      archL(ctx, -0.5, 0.75, 2, 0.5, 15, '#20150c', WOOD_D);
      winL(ctx, -0.5, -0.9, 10, 0.26, 7);
      eave(ctx, -1.3, -1.3, 1.3, -0.5, 22, 4);
      gable(ctx, -1.4, -1.42, 1.4, -0.38, 22, 15, col.main, 'x', WOOD);
      for (const [x, y] of [[-1.25, -0.3], [0.1, -0.3]]) line(ctx, ip(x, y, 2), ip(x, y, 26), WOOD_D, 2.4);
      if (!SH) { const a = ip(-0.6, 0.45, 2); ell(ctx, a[0], a[1] + 3, 16, 5, 'rgba(0,0,0,.22)'); line(ctx, [a[0] - 12, a[1]], [a[0] + 12, a[1] + 2], WOOD, 3.2); line(ctx, [a[0] - 6, a[1]], [a[0], a[1] - 15], WOOD, 2.2); line(ctx, [a[0] + 7, a[1] + 1], [a[0], a[1] - 15], WOOD, 2.2); line(ctx, [a[0], a[1] - 14], [a[0] + 10, a[1] - 19], '#a67c4e', 1.6);
        for (const dx of [-9, 10]) { ell(ctx, a[0] + dx, a[1] + 3, 4.2, 4.2, '#5a3d22', '#2c1c0e'); ell(ctx, a[0] + dx, a[1] + 3, 1.2, 1.2, '#a67c4e'); } }
      for (const [x, y] of [[-1.25, 1.15], [0.1, 1.15]]) line(ctx, ip(x, y, 2), ip(x, y, 26), WOOD_D, 2.4);
      if (SH) hull(rectPts(-1.35, -0.4, 0.2, 1.25, 28));
      else { slope(ctx, ip(-1.35, 1.25, 30), ip(0.2, 1.25, 30), ip(-1.35, -0.4, 26), ip(0.2, -0.4, 26), shade(THATCH, -0.08), 'thatch', 0.1, -0.1); quadL(ctx, 1.25, -1.35, 0.2, 28.4, 30, shade(THATCH, -0.35)); }
      if (!SH) { const b = ip(0.95, 0.75, 2), t = [b[0], b[1] - 50], e = [b[0] - 24, b[1] - 44];
        line(ctx, b, t, '#3c2814', 3.2); line(ctx, [b[0] - 0.6, b[1]], [t[0] - 0.6, t[1]], '#8a6238', 1.1); line(ctx, t, e, WOOD_D, 2.2); line(ctx, [b[0], b[1] - 30], [e[0] + 10, e[1] + 2], WOOD, 1.4);
        line(ctx, e, [e[0], e[1] + 22], '#d9c9a0', 0.8); ctx.fillStyle = STONE_D; ctx.fillRect(e[0] - 3.4, e[1] + 22, 6.8, 5.4); ctx.strokeStyle = OUT; ctx.lineWidth = 0.6; ctx.strokeRect(e[0] - 3.4, e[1] + 22, 6.8, 5.4); }
      else hull([sp(0.9, 0.7, 0), sp(1.0, 0.8, 0), sp(0.95, 0.75, 52), sp(0.4, 1.1, 46)]);
      if (!SH) for (let i = 0; i < 3; i++) { const a = ip(0.75 + i * 0.16, -0.15 + i * 0.02, 3 + (i === 1 ? 4 : 0)); line(ctx, [a[0] - 11, a[1] - 5], [a[0] + 9, a[1] + 5], '#6b4826', 4.8); line(ctx, [a[0] - 11, a[1] - 6], [a[0] + 9, a[1] + 4], '#94683a', 1.4); ell(ctx, a[0] + 9, a[1] + 5, 2.1, 2.5, '#c9a56c', '#5c3f22'); }
      pole(ctx, 1.3, -0.5, 22, 22);
      barrel(ctx, 1.3, 1.25, 2); crate(ctx, 0.5, 1.3, 2, 0.13, 6);
    },
    academy(ctx, col) {
      box(ctx, -1.46, -1.46, 1.46, 1.46, 0, 3, '#bdb7a8', 'stone');
      box(ctx, -1.3, -1.3, 1.3, 1.3, 3, 6, '#cfc8b6');
      box(ctx, -1.1, -1.1, 1.1, 1.1, 6, 34, PLASTER, 'plaster');
      archL(ctx, 1.1, 0, 6, 0.5, 21, '#3a2816', '#b5aa90'); planksL(ctx, 1.1, -0.24, 0.24, 6, 17);
      winL(ctx, 1.1, -0.72, 15, 0.2, 10); winL(ctx, 1.1, 0.68, 15, 0.2, 10);
      winR(ctx, 1.1, -0.66, 14, 0.24, 11); winR(ctx, 1.1, 0.02, 14, 0.24, 11); winR(ctx, 1.1, 0.66, 14, 0.24, 11);
      for (const x of [-1.04, -0.5, 0.38, 0.92]) { quadL(ctx, 1.12, x, x + 0.13, 6, 32, '#f4ecd6', 'rgba(0,0,0,.25)'); quadL(ctx, 1.12, x + 0.08, x + 0.13, 6, 32, 'rgba(120,100,60,.22)'); quadL(ctx, 1.12, x - 0.02, x + 0.15, 30, 32.5, '#fbf5e4', 'rgba(0,0,0,.2)'); }
      for (const y of [-1.04, -0.36, 0.3, 0.92]) { quadR(ctx, 1.12, y, y + 0.13, 6, 32, '#cdc2a6', 'rgba(0,0,0,.25)'); quadR(ctx, 1.12, y - 0.02, y + 0.15, 30, 32.5, '#d9cfb6', 'rgba(0,0,0,.2)'); }
      eave(ctx, -1.1, -1.1, 1.1, 1.1, 34, 4);
      box(ctx, -1.2, -1.2, 1.2, 1.2, 34, 38, '#d2c8ad');
      cyl(ctx, 0, 0, 0.7, 38, 45, PLASTER);
      if (SH) hull(circPts(0, 0, 0.66, 45).concat(circPts(0, 0, 0.4, 66), [sp(0, 0, 82)]));
      else { const [dx, dy] = ip(0, 0, 45), rx = 0.66 * 45.25;
        const g = ctx.createRadialGradient(dx - rx * 0.4, dy - 16, 2, dx, dy - 6, rx * 1.15);
        g.addColorStop(0, shade(col.light, 0.35)); g.addColorStop(0.35, col.main); g.addColorStop(1, shade(col.dark, -0.25));
        ctx.beginPath(); ctx.ellipse(dx, dy, rx, 27, 0, Math.PI, 0, false); ctx.ellipse(dx, dy, rx, rx / 2, 0, 0, Math.PI, false);
        ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = OUT; ctx.lineWidth = 0.7; ctx.stroke();
        ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.lineWidth = 0.7;
        for (const k of [-0.62, -0.25, 0.2, 0.6]) { ctx.beginPath(); ctx.moveTo(dx, dy - 27); ctx.quadraticCurveTo(dx + rx * k * 1.25, dy - 16, dx + rx * k, dy + rx / 2 * Math.sqrt(1 - k * k)); ctx.stroke(); }
        line(ctx, [dx, dy - 27], [dx, dy - 36], '#b98a1c', 1.8); ell(ctx, dx, dy - 37.5, 2.6, 2.6, GOLD, '#7a5a10'); ctx.fillStyle = '#fff6c2'; ctx.fillRect(dx - 1.6, dy - 39, 1.2, 1.2); }
      if (!SH) for (const x of [-0.5, 0.5]) { const [sx, sy] = ip(x * 1.3, 1.36, 3); ell(ctx, sx, sy - 3, 4, 3.4, '#356b2c', OUT); ell(ctx, sx - 1, sy - 4.2, 2, 1.6, '#4f8f3e'); ctx.fillStyle = '#9a6a48'; ctx.fillRect(sx - 2.6, sy - 1, 5.2, 3.2); }
    },
    skyfire(ctx, col) {
      box(ctx, -1.42, -1.42, 1.42, 1.42, 0, 8, STONE_D, 'stone');
      box(ctx, -1.05, -1.05, 1.05, 1.05, 8, 14, STONE, 'stone');
      pole(ctx, -1.3, -1.3, 8, 30);
      box(ctx, -0.75, -0.55, 0.75, 0.55, 14, 22, WOOD, 'wood');
      if (SH) hull([sp(-0.66, 0.5, 22), sp(0.66, 0.5, 22), sp(0.66, -0.45, 60), sp(-0.66, -0.45, 60), sp(-0.66, -0.45, 22), sp(0.66, -0.45, 22)]);
      else {
        line(ctx, ip(0.66, -0.45, 22), ip(0.66, -0.45, 60), '#3c2814', 2.4); line(ctx, ip(-0.66, -0.45, 22), ip(-0.66, -0.45, 60), '#3c2814', 2.4);
        face(ctx, [ip(-0.66, 0.5, 22), ip(0.66, 0.5, 22), ip(0.66, -0.45, 60), ip(-0.66, -0.45, 60)], WOOD_D, 0.12, -0.2, OUT);
        for (let k = 1; k < 5; k++) line(ctx, mix(ip(-0.66, 0.5, 22), ip(-0.66, -0.45, 60), k / 5), mix(ip(0.66, 0.5, 22), ip(0.66, -0.45, 60), k / 5), 'rgba(0,0,0,.35)', 0.8);
        for (let i = 0; i < 6; i++) {
          const x = -0.55 + i * 0.22, a = ip(x, 0.42, 25), b = ip(x, -0.4, 60);
          line(ctx, a, b, '#2a1c10', 3.6); line(ctx, a, b, '#e2d8bc', 2.4); line(ctx, [a[0] - 0.5, a[1]], [b[0] - 0.5, b[1]], '#fbf5e4', 0.7);
          line(ctx, mix(a, b, 0.8), b, col.main, 2.8); poly(ctx, [b, [b[0] - 1.6, b[1] + 3], [b[0] + 1.6, b[1] + 3]], col.dark, null);
          line(ctx, a, mix(a, b, 0.1), DARK, 3);
        }
        line(ctx, ip(-0.66, 0.5, 22), ip(-0.66, -0.45, 22), WOOD, 1.6); line(ctx, ip(0.66, 0.5, 22), ip(0.66, -0.45, 22), WOOD, 1.6);
      }
      barrel(ctx, 1.05, 0.9, 8); barrel(ctx, 0.8, 1.12, 8); crate(ctx, -0.85, 1.12, 8, 0.15, 7);
      pole(ctx, 1.3, 1.3, 8, 30);
    },
    palisade(ctx, col) {
      if (SH) { hull(rectPts(-0.42, -0.42, 0.42, 0.42, 0).concat(rectPts(-0.42, -0.42, 0.42, 0.42, 22))); return; }
      const n = 4;
      for (let k = 0; k < 2; k++) for (let i = 0; i < n; i++) {
        const pts = k === 0 ? [[-0.42 + i * 0.28, -0.42], [-0.42, -0.42 + i * 0.28]] : [[-0.42 + i * 0.28, 0.42], [0.42, -0.42 + i * 0.28]];
        for (const [x, y] of pts) {
          const a = ip(x, y, 0), h = 19 + ((i * 7 + k * 3) % 4), base = k ? WOOD : shade(WOOD, -0.28);
          const g = ctx.createLinearGradient(a[0] - 3.2, 0, a[0] + 3.2, 0); g.addColorStop(0, shade(base, 0.16)); g.addColorStop(0.5, base); g.addColorStop(1, shade(base, -0.32));
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.moveTo(a[0] - 3.2, a[1]); ctx.lineTo(a[0] - 3.2, a[1] - h); ctx.lineTo(a[0], a[1] - h - 5.5); ctx.lineTo(a[0] + 3.2, a[1] - h); ctx.lineTo(a[0] + 3.2, a[1]); ctx.closePath(); ctx.fill();
          ctx.strokeStyle = OUT; ctx.lineWidth = 0.6; ctx.stroke();
          line(ctx, [a[0] - 0.6, a[1] - 3], [a[0] - 0.6, a[1] - h + 2], 'rgba(40,24,8,.3)', 0.5);
        }
        if (k === 0 && i === n - 1) box(ctx, -0.36, -0.36, 0.36, 0.36, 0, 12, shade(WOOD, -0.2));
      }
      line(ctx, ip(-0.42, 0.42, 13), ip(0.42, 0.42, 13), '#3c2814', 2.2); line(ctx, ip(-0.42, 0.42, 13.4), ip(0.42, 0.42, 13.4), col.main, 1.2);
      line(ctx, ip(0.42, 0.42, 13), ip(0.42, -0.42, 13), '#2c1c0e', 2.2);
    },
    watchtower(ctx, col) {
      box(ctx, -0.34, -0.34, 0.34, 0.34, 0, 36, WOOD, 'board');
      line(ctx, ip(-0.34, 0.34, 1), ip(0.34, 0.34, 35), '#3c2814', 1.5); line(ctx, ip(0.34, 0.34, 1), ip(-0.34, 0.34, 35), '#3c2814', 1.5);
      line(ctx, ip(0.34, 0.34, 1), ip(0.34, -0.34, 35), '#2c1c0e', 1.5); line(ctx, ip(0.34, -0.34, 1), ip(0.34, 0.34, 35), '#2c1c0e', 1.5);
      box(ctx, -0.5, -0.5, 0.5, 0.5, 36, 45, WOOD_D, 'wood');
      quadL(ctx, 0.5, -0.2, 0.2, 37, 44, col.main, OUT); emblem(ctx, ip(0, 0.5, 40.5), col, 2.4);
      for (const [x, y] of [[-0.46, -0.46], [0.46, -0.46], [-0.46, 0.46], [0.46, 0.46]]) line(ctx, ip(x, y, 45), ip(x, y, 57), '#3c2814', 1.7);
      pyramid(ctx, -0.6, -0.6, 0.6, 0.6, 56, 15, col.main);
      pole(ctx, 0, 0, 70, 10);
    },
    bolttower(ctx, col) {
      cyl(ctx, 0, 0, 0.44, 0, 44, STONE, 0.4, 'stone');
      cyl(ctx, 0, 0, 0.425, 27, 32, col.main, 0.42);
      if (!SH) { ctx.fillStyle = '#1c140c'; ctx.beginPath(); ctx.roundRect(-9, -25, 2.6, 9, 1.3); ctx.fill(); ctx.beginPath(); ctx.roundRect(4, -19, 2.4, 8, 1.2); ctx.fill(); ctx.beginPath(); ctx.roundRect(-12, -13, 5.6, 10, [2.8, 2.8, 0, 0]); ctx.fill(); }
      cyl(ctx, 0, 0, 0.5, 44, 49, STONE_D, 0.5, 'stone');
      ringCrenels(ctx, 0, 0, 0.44, 49, 4, STONE);
      if (!SH) { const [bx, by] = ip(0, 0, 54); line(ctx, [bx - 9, by + 3], [bx + 12, by - 4], '#3c2814', 3.4); line(ctx, [bx - 9, by + 2.4], [bx + 12, by - 4.6], '#8a6238', 1.2);
        ctx.beginPath(); ctx.moveTo(bx + 2, by - 10); ctx.quadraticCurveTo(bx + 14, by - 2, bx + 8, by + 8); ctx.strokeStyle = '#3c2814'; ctx.lineWidth = 2.8; ctx.stroke(); ctx.strokeStyle = '#a67c4e'; ctx.lineWidth = 1.3; ctx.stroke();
        line(ctx, [bx + 2, by - 10], [bx - 6, by + 2], '#e9dfc4', 0.7); line(ctx, [bx + 8, by + 8], [bx - 6, by + 2], '#e9dfc4', 0.7);
        poly(ctx, [[bx + 12, by - 6.4], [bx + 16.5, by - 5.6], [bx + 12.6, by - 2.2]], IRON, OUT); }
    },
    bombardtower(ctx, col) {
      cyl(ctx, 0, 0, 0.86, 0, 36, STONE, 0.76, 'stone');
      cyl(ctx, 0, 0, 0.775, 22, 28, col.main, 0.765);
      archL(ctx, 0.74, -0.38, 0, 0.3, 15, '#1e140c', '#6f6a60');
      if (!SH) { ctx.fillStyle = '#1c140c'; ctx.beginPath(); ctx.roundRect(14, -18, 2.6, 8, 1.3); ctx.fill(); }
      cyl(ctx, 0, 0, 0.84, 36, 42, STONE_D, 0.84, 'stone');
      ringCrenels(ctx, 0, 0, 0.78, 42, 4, STONE);
      pole(ctx, -0.5, -0.5, 43, 22);
      if (!SH) { const [bx, by] = ip(0, 0, 46); ell(ctx, bx, by + 3, 14, 7.4, '#3a342c');
        box(ctx, -0.18, -0.1, 0.12, 0.2, 43, 48, '#6b4826', 'wood');
        line(ctx, [bx - 4, by - 1], [bx + 22, by + 5], '#161412', 9); line(ctx, [bx - 4, by - 1], [bx + 22, by + 5], '#3a3632', 6.6); line(ctx, [bx - 4, by - 3], [bx + 22, by + 3], '#6a665e', 1.8);
        for (const k of [0.25, 0.7]) { const q = mix([bx - 4, by - 1], [bx + 22, by + 5], k); ell(ctx, q[0], q[1], 2, 4.6, null, '#0c0a08'); }
        ell(ctx, bx + 23, by + 5.2, 2.6, 4, '#0c0a08'); }
    },
  };

  function building(type, col) {
    return cached('b:' + type + ':' + col.main, () => {
      const d = BUILDINGS[type], half = (d.w + d.h) * 16, pad = 14, tall = d.tall + 16;
      const W = half * 2 + pad * 2, H = half + tall + pad * 2, ox = W / 2, oy = pad + tall + half / 2;
      rnd = mulberry32(strHash(type));
      const s = mk(W, H, ox, oy, ctx => BDRAW[type](ctx, col));
      // shadow pass: replay the solids as ground-projected hulls, then blur
      const W2 = W + d.tall * 0.7 + 24;
      const raw = mk(W2, H + 16, ox, oy, ctx => {
        SH = ctx; ctx.fillStyle = '#000';
        try { hull(rectPts(-d.w / 2 - 0.08, -d.h / 2 - 0.08, d.w / 2 + 0.08, d.h / 2 + 0.08, 0)); BDRAW[type](NUL, col); } finally { SH = null; }
      });
      s.sh = { c: blurred(raw.c, 5 * SS), w: W2, h: H + 16, ox, oy };
      return s;
    });
  }

  // live (animated) parts, drawn every frame on top of the cached sprite
  function pennant(ctx, ax, ay, t, ph, col, len) {
    const n = 6, up = [], lo = [];
    for (let i = 0; i <= n; i++) {
      const x = ax + i * len / n, wv = Math.sin(t * 6.5 - i * 1.05 + ph) * (0.3 + i * 0.42), h = 8 * (1 - i / (n + 0.6));
      up.push([x, ay + wv]); lo.push([x, ay + h + wv]);
    }
    ctx.beginPath(); ctx.moveTo(up[0][0], up[0][1]);
    for (let i = 1; i <= n; i++) ctx.lineTo(up[i][0], up[i][1]);
    for (let i = n; i >= 0; i--) ctx.lineTo(lo[i][0], lo[i][1]);
    ctx.closePath(); ctx.fillStyle = col.main; ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 0.6; ctx.stroke();
    ctx.beginPath(); for (let i = 0; i <= n - 1; i++) { const y = (up[i][1] + lo[i][1]) / 2; if (i) ctx.lineTo(up[i][0], y); else ctx.moveTo(up[i][0], y); }
    ctx.strokeStyle = col.light; ctx.lineWidth = 1.1; ctx.stroke();
  }
  function buildingAnim(ctx, b, sx, sy, t, col, lowGrain) {
    const fl = FLAGS[b.type];
    if (fl) for (let i = 0; i < fl.length; i++) { const a = ip(fl[i][0], fl[i][1], fl[i][2]); pennant(ctx, sx + a[0], sy + a[1], t, b.id * 1.7 + i, col, b.type === 'keep' ? 15 : 12); }
    if (b.type === 'mill') {
      const hx = sx + 11, hy = sy - 34, a0 = lowGrain ? b.id : t * 1.4 + b.id;
      ctx.lineCap = 'round';
      for (let i = 0; i < 4; i++) {
        const a = a0 + i * Math.PI / 2, L = 31, c = Math.cos(a), s = Math.sin(a);
        const tx = hx - 0.894 * L * c, ty = hy + 0.447 * L * c - L * s;
        const a2 = a + 0.3, c2 = Math.cos(a2), s2 = Math.sin(a2);
        const ux = hx - 0.894 * L * c2, uy = hy + 0.447 * L * c2 - L * s2;
        ctx.beginPath(); ctx.moveTo(lerp(hx, tx, 0.24), lerp(hy, ty, 0.24)); ctx.lineTo(tx, ty); ctx.lineTo(ux, uy); ctx.lineTo(lerp(hx, ux, 0.24), lerp(hy, uy, 0.24)); ctx.closePath();
        ctx.fillStyle = 'rgba(240,231,205,.95)'; ctx.fill(); ctx.strokeStyle = 'rgba(60,40,20,.7)'; ctx.lineWidth = 0.7; ctx.stroke();
        ctx.strokeStyle = 'rgba(90,64,34,.45)'; ctx.lineWidth = 0.5;
        for (let k = 1; k < 5; k++) { const f = 0.24 + 0.76 * k / 5; ctx.beginPath(); ctx.moveTo(lerp(hx, tx, f), lerp(hy, ty, f)); ctx.lineTo(lerp(hx, ux, f), lerp(hy, uy, f)); ctx.stroke(); }
        ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(tx, ty); ctx.strokeStyle = '#3c2814'; ctx.lineWidth = 2; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(tx, ty); ctx.strokeStyle = '#8a6238'; ctx.lineWidth = 0.8; ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(hx, hy, 3, 0, 7); ctx.fillStyle = col.dark; ctx.fill(); ctx.beginPath(); ctx.arc(hx - 0.5, hy - 0.5, 1.8, 0, 7); ctx.fillStyle = col.light; ctx.fill();
    } else if (b.type === 'beacon') {
      if (lowGrain) return;
      const f = 0.75 + 0.25 * Math.sin(t * 13 + b.id) * Math.sin(t * 7.3);
      ctx.globalCompositeOperation = 'lighter';
      const p = puff('fire'), r = 30 * f;
      ctx.globalAlpha = 0.55; ctx.drawImage(p, sx - r * 1.6, sy - 82 - r * 1.6, r * 3.2, r * 3.2);
      ctx.globalAlpha = 1; ctx.drawImage(p, sx - 9, sy - 82 - 12 * f, 18, 20 * f);
      ctx.globalCompositeOperation = 'source-over';
    } else if (b.type === 'skyfire') {
      if (b.charge >= SKY_T && !lowGrain) {
        const f = 0.6 + 0.4 * Math.sin(t * 6), p = puff('fire'), r = 16 + 5 * f;
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.5 + 0.3 * f;
        ctx.drawImage(p, sx + 14 - r, sy - 62 - r, r * 2, r * 2);
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      }
    }
  }

  // ---- units --------------------------------------------------------------
  function shadow(ctx, rx, ry) { curShadow = [rx, ry]; }
  function L(ctx, x0, y0, x1, y1, col, lw) { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.stroke(); }

  function man(ctx, col, o, ph, st) {
    const walk = st === 'walk', atk = st === 'atk';
    const sw = walk ? Math.sin(ph * Math.PI * 2) : 0;
    const bob = walk ? -Math.abs(Math.cos(ph * Math.PI * 2)) * 0.9 : 0;
    shadow(ctx, 5.5, 2.4);
    const tunic = o.tunic || col.main;
    if (o.robe) {
      ctx.fillStyle = o.robe; ctx.beginPath(); ctx.moveTo(-3, -13 + bob); ctx.lineTo(3, -13 + bob); ctx.lineTo(4.4 + sw * 0.6, 0); ctx.lineTo(-4.4 + sw * 0.6, 0); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = OUT; ctx.lineWidth = 0.6; ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.14)'; ctx.beginPath(); ctx.moveTo(-3, -13 + bob); ctx.lineTo(-1, -13 + bob); ctx.lineTo(-1.6 + sw * 0.6, 0); ctx.lineTo(-4.4 + sw * 0.6, 0); ctx.fill();
      L(ctx, -3.2, -8 + bob, 3.2, -8 + bob, col.main, 1.6);
      L(ctx, 0.6, -8 + bob, 0.8, -3 + bob, col.main, 1.2);
    } else {
      L(ctx, -1.2, -6 + bob, -1.2 + 3.2 * sw, -0.4, '#2e2118', 2.3); L(ctx, 1.2, -6 + bob, 1.2 - 3.2 * sw, -0.4, '#4a382a', 2.3);
      L(ctx, -1.2 + 3.2 * sw - 0.4, -0.2, -1.2 + 3.2 * sw + 1.6, -0.2, '#1e1610', 1.5); L(ctx, 1.2 - 3.2 * sw - 0.4, -0.2, 1.2 - 3.2 * sw + 1.6, -0.2, '#2a1e16', 1.5);
      ctx.fillStyle = tunic; ctx.beginPath(); ctx.roundRect(-3.2, -13.6 + bob, 6.4, 8.6, 1.7); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.2)'; ctx.fillRect(-3, -13 + bob, 1.8, 7.2);
      ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.fillRect(1.4, -13 + bob, 1.7, 7.4);
      if (o.mail) { ctx.fillStyle = IRON; ctx.beginPath(); ctx.roundRect(-3.2, -13.6 + bob, 6.4, 4, [1.7, 1.7, 0, 0]); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,.4)'; ctx.fillRect(-2.8, -13.2 + bob, 1.6, 3); }
      ctx.strokeStyle = OUT; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.roundRect(-3.2, -13.6 + bob, 6.4, 8.6, 1.7); ctx.stroke();
      L(ctx, -3.1, -7.3 + bob, 3.1, -7.3 + bob, '#2e2118', 1.2); ctx.fillStyle = GOLD; ctx.fillRect(-0.6, -7.9 + bob, 1.3, 1.3);
    }
    // head
    ctx.fillStyle = SKIN; ctx.beginPath(); ctx.arc(0.3, -16 + bob, 2.8, 0, 7); ctx.fill();
    ctx.strokeStyle = OUT; ctx.lineWidth = 0.5; ctx.stroke();
    ctx.fillStyle = 'rgba(120,70,40,.35)'; ctx.beginPath(); ctx.arc(0.3, -16 + bob, 2.8, -0.4, 1.2); ctx.fill();
    ctx.fillStyle = '#2a1c14'; ctx.fillRect(1.5, -16.6 + bob, 0.9, 0.9);
    ctx.strokeStyle = OUT; ctx.lineWidth = 0.5;
    if (o.helm) { ctx.fillStyle = o.helm; ctx.beginPath(); ctx.arc(0.3, -16.6 + bob, 3.05, Math.PI, 0); ctx.fill(); ctx.stroke(); ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillRect(-1.6, -19 + bob, 1.3, 1.5); L(ctx, -2.7, -16.5 + bob, 3.4, -16.5 + bob, shade(o.helm, -0.35), 0.8); if (o.plume) { L(ctx, 0.3, -19.4 + bob, -2.4, -22.2 + bob, col.dark, 2.4); L(ctx, 0.3, -19.4 + bob, -2.4, -22.2 + bob, col.light, 1.3); } }
    if (o.hood) { ctx.fillStyle = o.hood; ctx.beginPath(); ctx.arc(-0.2, -16.4 + bob, 3.2, Math.PI * 0.72, Math.PI * 0.06); ctx.fill(); ctx.stroke(); }
    if (o.hat) { ctx.fillStyle = o.hat; ctx.beginPath(); ctx.ellipse(0.3, -17.8 + bob, 4.6, 1.5, 0, 0, 7); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.arc(0.3, -18.2 + bob, 2.5, Math.PI, 0); ctx.fill(); if (o.feather) L(ctx, -1.6, -19.6 + bob, -4, -22.6 + bob, o.feather, 1.1); }
    ctx.strokeStyle = OUT; ctx.lineWidth = 0.5;
    const y = bob;
    switch (o.w) {
      case 'spear':
        if (atk) { L(ctx, -6, -10 + y, 13, -11 + y, '#3c2814', 2); L(ctx, -6, -10 + y, 13, -11 + y, '#8a6a3c', 1.1); ctx.fillStyle = IRON; ctx.beginPath(); ctx.moveTo(13, -12.8 + y); ctx.lineTo(17.6, -11 + y); ctx.lineTo(13, -9.2 + y); ctx.fill(); }
        else { L(ctx, 3.2, -1 + y, 6.2, -23 + y, '#3c2814', 2); L(ctx, 3.2, -1 + y, 6.2, -23 + y, '#8a6a3c', 1.1); ctx.fillStyle = IRON; ctx.beginPath(); ctx.moveTo(4.8, -23 + y); ctx.lineTo(6.7, -28 + y); ctx.lineTo(7.8, -22.8 + y); ctx.fill(); }
        L(ctx, 1, -11 + y, 4.4, -9.6 + y, SKIN, 1.7);
        break;
      case 'sword':
        if (atk) { L(ctx, 4, -10.5 + y, 12.4, -8 + y, '#40464e', 2.4); L(ctx, 4, -10.5 + y, 12.4, -8 + y, '#eef2f7', 1.3); } else { L(ctx, 4, -10.5 + y, 8.6, -20.4 + y, '#40464e', 2.4); L(ctx, 4, -10.5 + y, 8.6, -20.4 + y, '#eef2f7', 1.3); }
        L(ctx, 3, -11.6 + y, 5.2, -9.4 + y, '#8a6a12', 1.6); L(ctx, 1, -11.5 + y, 4.2, -10.4 + y, SKIN, 1.6);
        ctx.fillStyle = col.dark; ctx.beginPath(); ctx.ellipse(-2.8, -9.6 + y, 3.4, 4.3, 0, 0, 7); ctx.fill(); ctx.strokeStyle = OUT; ctx.lineWidth = 0.6; ctx.stroke();
        ctx.fillStyle = col.light; ctx.beginPath(); ctx.ellipse(-2.9, -9.7 + y, 2.4, 3.2, 0, 0, 7); ctx.fill(); ctx.fillStyle = IRON; ctx.beginPath(); ctx.arc(-2.9, -9.7 + y, 0.9, 0, 7); ctx.fill();
        break;
      case 'bow':
        ctx.beginPath(); ctx.arc(2.5, -11 + y, 6.8, -1.15, 1.15); ctx.strokeStyle = '#3c2410'; ctx.lineWidth = 2; ctx.stroke(); ctx.strokeStyle = '#9a6a34'; ctx.lineWidth = 1; ctx.stroke();
        if (atk) { L(ctx, 5.3, -17.2 + y, 0.5, -11 + y, '#f3ecd9', 0.5); L(ctx, 5.3, -4.8 + y, 0.5, -11 + y, '#f3ecd9', 0.5); L(ctx, 0.5, -11 + y, 11.5, -11 + y, '#e2d8bc', 0.9); }
        else L(ctx, 5.3, -17.2 + y, 5.3, -4.8 + y, '#f3ecd9', 0.5);
        L(ctx, 1, -11.5 + y, 7, -11 + y, SKIN, 1.5);
        ctx.fillStyle = '#6b4a2a'; ctx.fillRect(-4.8, -13.4 + y, 2, 7.4); ctx.fillStyle = '#e2d8bc'; ctx.fillRect(-4.6, -14.6 + y, 0.6, 1.6); ctx.fillRect(-3.6, -14.8 + y, 0.6, 1.8);
        break;
      case 'xbow':
        L(ctx, 1, -10.6 + y, 10, -10.6 + y, '#3c2814', 2.6); L(ctx, 1, -10.9 + y, 10, -10.9 + y, '#8a6238', 1.2);
        ctx.beginPath(); ctx.moveTo(8.6, -15.8 + y); ctx.quadraticCurveTo(11.8, -10.6 + y, 8.6, -5.4 + y); ctx.strokeStyle = '#40464e'; ctx.lineWidth = 2; ctx.stroke(); ctx.strokeStyle = IRON; ctx.lineWidth = 1; ctx.stroke();
        if (!atk) { L(ctx, 3, -11.6 + y, 10.5, -11.6 + y, '#f3ecd9', 0.7); L(ctx, 8.6, -15.8 + y, 3, -10.8 + y, '#f3ecd9', 0.4); L(ctx, 8.6, -5.4 + y, 3, -10.8 + y, '#f3ecd9', 0.4); }
        L(ctx, 0.6, -11.4 + y, 4, -10 + y, SKIN, 1.5);
        break;
      case 'gun':
        L(ctx, 0.5, -10.4 + y, 12, -11.7 + y, '#141210', 2.6); L(ctx, 0.5, -10.9 + y, 12, -12.1 + y, '#5a5650', 0.8); L(ctx, 0.2, -10 + y, 4.8, -9.4 + y, '#7a4d24', 2.6);
        L(ctx, 1, -11.6 + y, 5, -10.2 + y, SKIN, 1.4);
        if (atk) { ctx.fillStyle = '#ffe07a'; ctx.beginPath(); ctx.moveTo(12, -11.7 + y); ctx.lineTo(19, -15 + y); ctx.lineTo(16.6, -11.9 + y); ctx.lineTo(19.6, -9 + y); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(13.4, -11.8 + y, 1.6, 0, 7); ctx.fill(); }
        break;
      case 'tool':
        L(ctx, 2.6, -8 + y, 6.4, -19 + y, '#3c2814', 2); L(ctx, 2.6, -8 + y, 6.4, -19 + y, '#8a6a3c', 1.1); L(ctx, 3.6, -19.8 + y, 9.6, -17.4 + y, '#40464e', 3); L(ctx, 3.8, -20 + y, 9.4, -17.8 + y, IRON, 1.6);
        L(ctx, 1, -11 + y, 3.6, -10.4 + y, SKIN, 1.5);
        ctx.fillStyle = '#6b4a2a'; ctx.beginPath(); ctx.roundRect(-5.8, -13.2 + y, 3.2, 7, 1); ctx.fill(); ctx.strokeStyle = OUT; ctx.lineWidth = 0.5; ctx.stroke();
        break;
      case 'staff':
        L(ctx, 4.6, 0, 4.6, -21 + y, '#3c2814', 1.9); L(ctx, 4.6, 0, 4.6, -21 + y, '#8a6238', 0.9); L(ctx, 2.4, -18 + y, 6.8, -18 + y, '#8a6a12', 2.1); L(ctx, 4.6, -23 + y, 4.6, -15.4 + y, '#8a6a12', 2.1); L(ctx, 2.6, -18 + y, 6.6, -18 + y, GOLD, 1.2); L(ctx, 4.6, -22.6 + y, 4.6, -15.6 + y, GOLD, 1.2);
        L(ctx, 1.4, -11 + y, 4.4, -11.6 + y, SKIN, 1.5);
        if (atk) { const g = ctx.createRadialGradient(4.6, -19 + y, 0, 4.6, -19 + y, 8); g.addColorStop(0, 'rgba(255,250,200,.95)'); g.addColorStop(1, 'rgba(255,240,150,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(4.6, -19 + y, 8, 0, 7); ctx.fill(); }
        break;
    }
  }

  function horse(ctx, col, o, ph, st) {
    const walk = st === 'walk', atk = st === 'atk';
    const sw = walk ? Math.sin(ph * Math.PI * 2) : 0;
    const bob = walk ? -Math.abs(Math.sin(ph * Math.PI * 2)) * 1.1 : 0;
    shadow(ctx, 11, 3.8);
    const hc = o.horse, hd = shade(o.horse, -0.34), hl = shade(o.horse, 0.22);
    L(ctx, -6, -8 + bob, -6 - 4 * sw, -0.4, hd, 2.1); L(ctx, 5.6, -8 + bob, 5.6 - 4 * sw, -0.4, hd, 2.1);
    L(ctx, -4.2, -8 + bob, -4.2 + 4 * sw, -0.4, hc, 2.2); L(ctx, 7.2, -8 + bob, 7.2 + 4 * sw, -0.4, hc, 2.2);
    for (const fx of [-6 - 4 * sw, 5.6 - 4 * sw, -4.2 + 4 * sw, 7.2 + 4 * sw]) L(ctx, fx - 0.2, -0.3, fx + 1.2, -0.3, '#1a1410', 1.6);
    ctx.beginPath(); ctx.moveTo(-8.5, -12 + bob); ctx.quadraticCurveTo(-13.4, -11 + bob, -12.4 - sw, -3.6 + bob); ctx.strokeStyle = hd; ctx.lineWidth = 2.2; ctx.stroke();
    ctx.fillStyle = hc; ctx.beginPath(); ctx.ellipse(0, -10.5 + bob, 9.3, 4.7, 0, 0, 7); ctx.fill(); ctx.strokeStyle = OUT; ctx.lineWidth = 0.6; ctx.stroke();
    ctx.fillStyle = hl; ctx.beginPath(); ctx.ellipse(-0.8, -12.4 + bob, 6.6, 1.9, 0, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.beginPath(); ctx.ellipse(0.4, -8 + bob, 7.4, 1.9, 0, 0, 7); ctx.fill();
    // neck + head
    ctx.fillStyle = hc; ctx.beginPath(); ctx.moveTo(5, -13.5 + bob); ctx.lineTo(10.2, -21.2 + bob); ctx.lineTo(13.4, -19 + bob); ctx.lineTo(9.6, -8.6 + bob); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(13.6, -19.4 + bob, 3.6, 2.2, 0.5, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#16100c'; ctx.fillRect(13.6, -20.6 + bob, 1, 1);
    L(ctx, 10.6, -21.2 + bob, 10.2, -24 + bob, hd, 1.4);
    L(ctx, 5.6, -14 + bob, 10, -21.4 + bob, hd, 1.8);
    L(ctx, 12, -17.6 + bob, 4, -15.6 + bob, '#2a1c10', 0.6);
    ctx.strokeStyle = OUT; ctx.lineWidth = 0.6;
    if (o.capar) {
      ctx.fillStyle = col.main; ctx.beginPath(); ctx.moveTo(-8.6, -12.6 + bob); ctx.lineTo(8.2, -12.6 + bob); ctx.lineTo(8.8, -5.2 + bob); ctx.lineTo(4, -4.2 + bob); ctx.lineTo(-4, -5.2 + bob); ctx.lineTo(-9, -4.4 + bob); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(-8, -12.4 + bob, 15.6, 2.2);
      L(ctx, -8.8, -5.6 + bob, 8.8, -5.9 + bob, col.light, 1.2);
      ctx.fillStyle = col.light; ctx.beginPath(); ctx.moveTo(-3, -11 + bob); ctx.lineTo(-1.2, -8.6 + bob); ctx.lineTo(-3, -6.4 + bob); ctx.lineTo(-4.8, -8.6 + bob); ctx.fill();
    } else { ctx.fillStyle = '#5a3a1c'; ctx.beginPath(); ctx.roundRect(-3.6, -14.8 + bob, 6.8, 3.6, 1); ctx.fill(); ctx.stroke(); ctx.fillStyle = col.main; ctx.fillRect(-3.4, -12.6 + bob, 6.4, 2.4); }
    // rider
    L(ctx, 0.2, -14 + bob, 1.8, -7.2 + bob, '#2e2118', 2.2); L(ctx, 1, -7 + bob, 3, -7 + bob, '#1e1610', 1.5);
    ctx.strokeStyle = OUT; ctx.lineWidth = 0.6;
    ctx.fillStyle = o.mail ? IRON : col.main; ctx.beginPath(); ctx.roundRect(-3, -22.8 + bob, 6, 8.8, 1.6); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.26)'; ctx.fillRect(-2.7, -22.2 + bob, 1.6, 7.4);
    ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.fillRect(1.4, -22.2 + bob, 1.4, 7.6);
    if (o.mail) { ctx.fillStyle = col.main; ctx.fillRect(-3, -19 + bob, 6, 4.6); ctx.fillStyle = col.light; ctx.fillRect(-0.6, -18.4 + bob, 1.3, 3.2); }
    ctx.fillStyle = SKIN; ctx.beginPath(); ctx.arc(0.3, -25.2 + bob, 2.7, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#2a1c14'; ctx.fillRect(1.5, -25.8 + bob, 0.9, 0.9);
    if (o.helm) { ctx.fillStyle = o.helm; ctx.beginPath(); ctx.arc(0.3, -25.6 + bob, 3, Math.PI * 0.95, Math.PI * 0.12); ctx.fill(); ctx.stroke(); ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillRect(-1.6, -28 + bob, 1.3, 1.5); if (o.plume) { L(ctx, 0.3, -28.4 + bob, -3, -31.2 + bob, col.dark, 2.6); L(ctx, 0.3, -28.4 + bob, -3, -31.2 + bob, col.light, 1.4); } }
    else { ctx.fillStyle = '#5a4630'; ctx.beginPath(); ctx.arc(0.1, -25.8 + bob, 2.9, Math.PI * 0.8, Math.PI * 0.05); ctx.fill(); }
    ctx.strokeStyle = OUT; ctx.lineWidth = 0.6;
    if (o.w === 'lance') {
      if (atk) { L(ctx, -5, -18 + bob, 18, -17 + bob, '#3c2814', 2.1); L(ctx, -5, -18 + bob, 18, -17 + bob, '#8a6a3c', 1.1); ctx.fillStyle = IRON; ctx.beginPath(); ctx.moveTo(18, -18.8 + bob); ctx.lineTo(22.6, -17 + bob); ctx.lineTo(18, -15.2 + bob); ctx.fill(); }
      else { L(ctx, 2.4, -13 + bob, 6.2, -35 + bob, '#3c2814', 2.1); L(ctx, 2.4, -13 + bob, 6.2, -35 + bob, '#8a6a3c', 1.1); ctx.fillStyle = col.light; ctx.beginPath(); ctx.moveTo(6, -34.4 + bob); ctx.lineTo(12, -32.6 + bob); ctx.lineTo(5.5, -30.2 + bob); ctx.fill(); ctx.fillStyle = IRON; ctx.beginPath(); ctx.moveTo(5.2, -35 + bob); ctx.lineTo(6.8, -39 + bob); ctx.lineTo(7.4, -34.8 + bob); ctx.fill(); }
      ctx.fillStyle = col.dark; ctx.beginPath(); ctx.ellipse(-2.4, -18.6 + bob, 3.1, 4, 0, 0, 7); ctx.fill(); ctx.strokeStyle = OUT; ctx.lineWidth = 0.6; ctx.stroke();
      ctx.fillStyle = col.light; ctx.beginPath(); ctx.ellipse(-2.5, -18.7 + bob, 2.1, 3, 0, 0, 7); ctx.fill();
    } else {
      if (atk) { L(ctx, 3.4, -19.4 + bob, 11.4, -16.4 + bob, '#40464e', 2.3); L(ctx, 3.4, -19.4 + bob, 11.4, -16.4 + bob, '#eef2f7', 1.2); } else { L(ctx, 3.4, -19.4 + bob, 7, -28.4 + bob, '#40464e', 2.3); L(ctx, 3.4, -19.4 + bob, 7, -28.4 + bob, '#eef2f7', 1.2); }
      L(ctx, 1.2, -20.4 + bob, 3.6, -19.2 + bob, SKIN, 1.5);
    }
  }

  function ox(ctx, x, sw, bob) {
    const c = '#9a7f5e', d = '#6a543c';
    L(ctx, x - 3.6, -5 + bob, x - 3.6 - 2.4 * sw, -0.3, d, 2); L(ctx, x + 3.6, -5 + bob, x + 3.6 - 2.4 * sw, -0.3, d, 2);
    L(ctx, x - 2, -5 + bob, x - 2 + 2.4 * sw, -0.3, c, 2.1); L(ctx, x + 5, -5 + bob, x + 5 + 2.4 * sw, -0.3, c, 2.1);
    ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(x, -7.6 + bob, 6.9, 4.2, 0, 0, 7); ctx.fill(); ctx.strokeStyle = OUT; ctx.lineWidth = 0.6; ctx.stroke();
    ctx.fillStyle = 'rgba(255,240,210,.28)'; ctx.beginPath(); ctx.ellipse(x - 0.6, -9.4 + bob, 4.8, 1.6, 0, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.beginPath(); ctx.ellipse(x + 0.4, -5.4 + bob, 5.4, 1.6, 0, 0, 7); ctx.fill();
    ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(x + 7.4, -8.6 + bob, 3, 2.6, 0.3, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#d9c2a4'; ctx.beginPath(); ctx.ellipse(x + 9.2, -7.6 + bob, 1.4, 1.2, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#16100c'; ctx.fillRect(x + 7.6, -9.6 + bob, 0.9, 0.9);
    L(ctx, x + 7, -10.6 + bob, x + 5.4, -13.2 + bob, '#3c3024', 1.8); L(ctx, x + 8.4, -10.6 + bob, x + 10, -13.2 + bob, '#3c3024', 1.8);
    L(ctx, x + 7, -10.6 + bob, x + 5.4, -13.2 + bob, '#f3ead3', 1); L(ctx, x + 8.4, -10.6 + bob, x + 10, -13.2 + bob, '#f3ead3', 1);
  }
  function wheel(ctx, x, y, r, rot) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fillStyle = '#6a4a2a'; ctx.fill(); ctx.strokeStyle = '#22160a'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, r - 1, 0, 7); ctx.strokeStyle = '#8a6a44'; ctx.lineWidth = 0.6; ctx.stroke();
    for (let i = 0; i < 4; i++) { const a = rot + i * Math.PI / 4; L(ctx, x - Math.cos(a) * (r - 0.6), y - Math.sin(a) * (r - 0.6), x + Math.cos(a) * (r - 0.6), y + Math.sin(a) * (r - 0.6), '#c09a66', 0.7); }
    ctx.beginPath(); ctx.arc(x, y, 1, 0, 7); ctx.fillStyle = '#2a2420'; ctx.fill();
  }
  function plankBox(ctx, x, y, w, h, col) {
    const g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, shade(col, 0.14)); g.addColorStop(1, shade(col, -0.2));
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h); ctx.strokeStyle = OUT; ctx.lineWidth = 0.7; ctx.strokeRect(x, y, w, h);
    for (let k = 1; k * 2.4 < h; k++) L(ctx, x + 0.4, y + k * 2.4, x + w - 0.4, y + k * 2.4, 'rgba(30,18,6,.3)', 0.5);
  }

  const UDRAW = {
    spearman: (c, col, p, s) => man(c, col, { w: 'spear', hood: '#6b5a44' }, p, s),
    archer: (c, col, p, s) => man(c, col, { w: 'bow', hat: '#3f5f30', feather: '#e9e2cf' }, p, s),
    sapper: (c, col, p, s) => man(c, col, { w: 'tool', hat: '#8a6a3a', tunic: '#a88a5a' }, p, s),
    swordsman: (c, col, p, s) => man(c, col, { w: 'sword', helm: IRON, mail: true, plume: true }, p, s),
    arbalest: (c, col, p, s) => man(c, col, { w: 'xbow', helm: '#8d939c' }, p, s),
    friar: (c, col, p, s) => man(c, col, { w: 'staff', robe: '#7a5a3c', hood: '#5c4028' }, p, s),
    handgunner: (c, col, p, s) => man(c, col, { w: 'gun', hat: '#2e2a26', feather: '#c8342c', mail: true }, p, s),
    outrider: (c, col, p, s) => horse(c, col, { horse: '#a67c4e', w: 'sword' }, p, s),
    knight: (c, col, p, s) => horse(c, col, { horse: '#4a4040', w: 'lance', capar: true, mail: true, helm: IRON, plume: true }, p, s),
    oxcart(ctx, col, ph, st, cargo) {
      const walk = st === 'walk', sw = walk ? Math.sin(ph * Math.PI * 2) : 0, bob = walk ? -Math.abs(sw) * 0.6 : 0;
      shadow(ctx, 15, 4.4);
      ox(ctx, 8, sw, bob);
      L(ctx, -1, -6.5, 4, -7 + bob, '#3c2814', 1.5);
      plankBox(ctx, -14.2, -12.5, 13.4, 7.4, WOOD);
      ctx.fillStyle = col.main; ctx.fillRect(-14, -10.6, 13, 2.6); ctx.fillStyle = 'rgba(255,255,255,.2)'; ctx.fillRect(-14, -10.6, 13, 0.8);
      if (cargo > 0) {
        const hgt = cargo > 1 ? 4.8 : 2.6;
        ctx.fillStyle = '#b98a1c'; ctx.beginPath(); ctx.ellipse(-7.5, -12.6, 6.4, hgt, 0, Math.PI, 0); ctx.fill(); ctx.strokeStyle = '#6a4c0a'; ctx.lineWidth = 0.6; ctx.stroke();
        ctx.fillStyle = '#f0c33c'; ctx.beginPath(); ctx.ellipse(-8.2, -12.8, 4.6, hgt * 0.78, 0, Math.PI, 0); ctx.fill();
        ctx.fillStyle = '#fff3b0'; ctx.fillRect(-10, -13.4 - hgt * 0.5, 1.6, 1.2); ctx.fillRect(-6, -13 - hgt * 0.3, 1, 1);
      }
      wheel(ctx, -7.5, -3.9, 4.3, ph * 6.28);
    },
    wagon(ctx, col, ph, st) {
      const walk = st === 'walk', sw = walk ? Math.sin(ph * Math.PI * 2) : 0, bob = walk ? -Math.abs(sw) * 0.6 : 0;
      shadow(ctx, 17, 4.8);
      ox(ctx, 11, sw, bob);
      L(ctx, 0, -7, 6, -7 + bob, '#3c2814', 1.5);
      plankBox(ctx, -17, -10, 17, 5.4, WOOD);
      const g = ctx.createLinearGradient(0, -24, 0, -10); g.addColorStop(0, '#fbf6e6'); g.addColorStop(1, '#d6cbb0');
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-17.5, -10); ctx.quadraticCurveTo(-17, -24, -8.5, -24); ctx.quadraticCurveTo(0, -24, 0.5, -10); ctx.closePath(); ctx.fill(); ctx.strokeStyle = OUT; ctx.lineWidth = 0.7; ctx.stroke();
      ctx.fillStyle = col.main; ctx.beginPath(); ctx.moveTo(-11.5, -10); ctx.quadraticCurveTo(-11.5, -23.6, -8.5, -24); ctx.quadraticCurveTo(-5.5, -23.6, -5.5, -10); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(90,70,40,.35)'; ctx.lineWidth = 0.6; for (const x of [-14.6, -2.6]) { ctx.beginPath(); ctx.moveTo(x, -10); ctx.quadraticCurveTo(x + (x < -8 ? 1 : -1), -20, -8.5, -24); ctx.stroke(); }
      wheel(ctx, -13, -3.9, 4.2, ph * 6.28); wheel(ctx, -4, -3.9, 4.2, ph * 6.28 + 0.5);
    },
    ram(ctx, col, ph, st) {
      const atk = st === 'atk', ext = atk ? 5 : 0;
      shadow(ctx, 15, 4.6);
      L(ctx, -9 + ext, -8.5, 15 + ext, -8.5, '#2c1c0e', 5.4); L(ctx, -9 + ext, -8.5, 15 + ext, -8.5, '#6b4423', 4); L(ctx, -9 + ext, -9.6, 15 + ext, -9.6, '#94683a', 1);
      ctx.fillStyle = '#8d939c'; ctx.beginPath(); ctx.moveTo(13.6 + ext, -11.6); ctx.lineTo(20 + ext, -8.5); ctx.lineTo(13.6 + ext, -5.4); ctx.closePath(); ctx.fill(); ctx.strokeStyle = OUT; ctx.lineWidth = 0.7; ctx.stroke();
      ctx.fillStyle = '#d5dae2'; ctx.beginPath(); ctx.moveTo(13.8 + ext, -11.2); ctx.lineTo(19 + ext, -8.7); ctx.lineTo(13.8 + ext, -9); ctx.fill();
      const g = ctx.createLinearGradient(-13, 0, 11, 0); g.addColorStop(0, '#8a6844'); g.addColorStop(0.5, '#7b5a3a'); g.addColorStop(1, '#4e3620');
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-13, -6.5); ctx.lineTo(-1, -21.4); ctx.lineTo(11, -6.5); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = col.main; ctx.beginPath(); ctx.moveTo(-7.4, -13.4); ctx.lineTo(-1, -21.4); ctx.lineTo(5.4, -13.4); ctx.closePath(); ctx.fill(); ctx.stroke();
      for (const k of [0.3, 0.55, 0.8]) L(ctx, lerp(-1, -13, k), lerp(-21.4, -6.5, k), lerp(-1, 11, k), lerp(-21.4, -6.5, k), 'rgba(30,18,6,.3)', 0.6);
      L(ctx, -13, -6.5, 11, -6.5, '#3c2814', 1.9);
      wheel(ctx, -8.5, -3.5, 3.8, ph * 6.28); wheel(ctx, 0, -3.5, 3.8, ph * 6.28 + 1); wheel(ctx, 7.5, -3.5, 3.8, ph * 6.28 + 2);
    },
    mangonel(ctx, col, ph, st) {
      const atk = st === 'atk';
      shadow(ctx, 14, 4.4);
      plankBox(ctx, -11, -8.6, 22, 3.6, WOOD);
      L(ctx, 3, -8, 3, -18.4, '#2c1c0e', 3.2); L(ctx, 3, -8, 3, -18.4, WOOD, 1.8); L(ctx, 8.4, -8, 3, -18, '#3c2814', 1.6);
      if (atk) { L(ctx, 1, -8, 5, -25.4, '#2c1c0e', 3); L(ctx, 1, -8, 5, -25.4, '#94683a', 1.7); ctx.fillStyle = WOOD_D; ctx.beginPath(); ctx.arc(5.4, -26.4, 2.8, 0, 7); ctx.fill(); ctx.strokeStyle = OUT; ctx.lineWidth = 0.6; ctx.stroke(); }
      else { L(ctx, 2, -9, -10, -15, '#2c1c0e', 3); L(ctx, 2, -9, -10, -15, '#94683a', 1.7); ctx.fillStyle = WOOD_D; ctx.beginPath(); ctx.arc(-10.6, -15.6, 3, 0, 7); ctx.fill(); ctx.strokeStyle = OUT; ctx.lineWidth = 0.6; ctx.stroke(); ctx.fillStyle = '#8d939c'; ctx.beginPath(); ctx.arc(-10.6, -16.8, 2, 0, 7); ctx.fill(); ctx.fillStyle = '#d5dae2'; ctx.fillRect(-11.4, -18, 1, 1); L(ctx, -8, -14, 1, -8.4, '#d9c9a0', 0.6); }
      ctx.fillStyle = col.main; ctx.fillRect(-10.6, -8.2, 6, 2.8); ctx.fillStyle = 'rgba(255,255,255,.2)'; ctx.fillRect(-10.6, -8.2, 6, 0.8);
      wheel(ctx, -7, -3.7, 3.9, ph * 6.28); wheel(ctx, 7, -3.7, 3.9, ph * 6.28 + 1);
    },
    trebuchet(ctx, col, ph, st) {
      const atk = st === 'atk';
      shadow(ctx, 16, 5);
      plankBox(ctx, -13, -6.6, 26, 3.2, WOOD);
      for (const sx of [-8, 8]) { L(ctx, sx, -5, 0, -27, '#2c1c0e', 3.2); L(ctx, sx, -5, 0, -27, sx < 0 ? '#94683a' : '#6b4826', 1.8); }
      L(ctx, -4.4, -15, 4.4, -15, '#3c2814', 1.6);
      const cw = (x, y) => { const g = ctx.createLinearGradient(x, 0, x + 8, 0); g.addColorStop(0, '#6a645a'); g.addColorStop(1, '#2e2a26'); ctx.fillStyle = g; ctx.fillRect(x, y, 8, 8); ctx.strokeStyle = OUT; ctx.lineWidth = 0.7; ctx.strokeRect(x, y, 8, 8); L(ctx, x + 0.6, y + 2.6, x + 7.4, y + 2.6, 'rgba(0,0,0,.35)', 0.5); L(ctx, x + 0.6, y + 5.4, x + 7.4, y + 5.4, 'rgba(0,0,0,.35)', 0.5); };
      if (atk) { L(ctx, -5, -17, 9, -45, '#2c1c0e', 3); L(ctx, -5, -17, 9, -45, '#94683a', 1.6); cw(-9.5, -17); L(ctx, 9, -45, 13, -40, '#d9c9a0', 0.7); }
      else { L(ctx, 6, -33, -14, -11, '#2c1c0e', 3); L(ctx, 6, -33, -14, -11, '#94683a', 1.6); L(ctx, 6, -33, 6.5, -28, '#2c1c0e', 1); cw(2.5, -28.5); L(ctx, -14, -11, -9, -6.5, '#d9c9a0', 0.7); ctx.fillStyle = '#8d939c'; ctx.beginPath(); ctx.arc(-9, -7, 2.1, 0, 7); ctx.fill(); ctx.strokeStyle = OUT; ctx.lineWidth = 0.5; ctx.stroke(); }
      ctx.beginPath(); ctx.arc(0, -27, 1.6, 0, 7); ctx.fillStyle = '#2e2a26'; ctx.fill();
      ctx.fillStyle = col.main; ctx.beginPath(); ctx.moveTo(0, -28); ctx.lineTo(0, -35); ctx.lineTo(-6.4, -32.8); ctx.lineTo(0, -30.4); ctx.fill(); ctx.strokeStyle = OUT; ctx.lineWidth = 0.5; ctx.stroke();
      wheel(ctx, -10, -2.9, 3, ph * 6.28); wheel(ctx, 10, -2.9, 3, ph * 6.28 + 1);
    },
  };

  // state: 'idle' | 'walk' | 'atk'; frame: 0..WALKF-1; extra: cargo level for carts
  function unit(type, col, state, frame, extra) {
    return cached('u:' + type + ':' + col.main + ':' + state + ':' + frame + ':' + (extra || 0), () => {
      curShadow = null;
      const fig = mk(84, 84, 42, 64, ctx => UDRAW[type](ctx, col, frame / WALKF, state, extra || 0));
      const sh = curShadow || [6, 2.6], sil = silhouette(fig.c, '#17100a');
      return mk(84, 84, 42, 64, ctx => {
        ctx.save(); ctx.translate(sh[0] * 0.22, 0.4); ctx.scale(1, sh[1] / sh[0]);
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, sh[0] * 1.3);
        g.addColorStop(0, 'rgba(0,0,0,.5)'); g.addColorStop(0.55, 'rgba(0,0,0,.3)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, sh[0] * 1.3, 0, 7); ctx.fill(); ctx.restore();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 0.8;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]]) ctx.drawImage(sil, dx * 1.5, dy * 1.5);
        ctx.globalAlpha = 1; ctx.drawImage(fig.c, 0, 0);
      });
    });
  }

  // ---- gold, trees, lodes, particles --------------------------------------
  function gold(kind, level, v) {
    return cached('g:' + kind + ':' + level + ':' + (v % 3), () => mk(TW, TH + 12, HW, HH + 10, ctx => {
      const rng = mulberry32(kind * 31 + level * 7 + (v % 3) * 101);
      const n = 2 + level * 3, pts = [];
      for (let i = 0; i < n; i++) { const a = rng() * 6.28, r = Math.sqrt(rng()) * 0.42; pts.push([Math.cos(a) * r * TW * 0.8, Math.sin(a) * r * TH * 0.8, 1.7 + rng() * (1.3 + level * 0.55)]); }
      pts.sort((a, b) => a[1] - b[1]);
      for (const [x, y, s] of pts) {
        ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(x + 1.4, y + 0.8, s * 1.4, s * 0.6, 0, 0, 7); ctx.fill();
        ctx.strokeStyle = 'rgba(40,24,0,.6)'; ctx.lineWidth = 0.6;
        if (kind === 1) {
          ctx.fillStyle = '#b07f12'; ctx.beginPath(); ctx.moveTo(x - s, y); ctx.lineTo(x - s * 0.5, y - s * 1.3); ctx.lineTo(x + s * 0.6, y - s * 1.1); ctx.lineTo(x + s, y); ctx.closePath(); ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#f6d04a'; ctx.beginPath(); ctx.moveTo(x - s * 0.5, y - s * 1.3); ctx.lineTo(x + s * 0.6, y - s * 1.1); ctx.lineTo(x, y - s * 0.3); ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#dca726'; ctx.beginPath(); ctx.moveTo(x - s, y); ctx.lineTo(x - s * 0.5, y - s * 1.3); ctx.lineTo(x, y - s * 0.3); ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#fff6c2'; ctx.fillRect(x - s * 0.3, y - s * 1.2, 1.1, 1.1);
        } else {
          ctx.fillStyle = '#9a3214'; ctx.beginPath(); ctx.moveTo(x - s * 0.75, y); ctx.lineTo(x, y - s * 2.2); ctx.lineTo(x + s * 0.75, y); ctx.closePath(); ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#ff9a3c'; ctx.beginPath(); ctx.moveTo(x - s * 0.75, y); ctx.lineTo(x, y - s * 2.2); ctx.lineTo(x - s * 0.05, y); ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#ffe2a8'; ctx.fillRect(x - s * 0.3, y - s * 1.4, 1, 1.6);
        }
      }
    }));
  }

  function softShadow(ctx, x, y, rx, ry, a) {
    ctx.save(); ctx.translate(x, y); ctx.scale(1, ry / rx);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, `rgba(0,0,0,${a})`); g.addColorStop(0.6, `rgba(0,0,0,${a * 0.6})`); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, rx, 0, 7); ctx.fill(); ctx.restore();
  }
  function leafBall(ctx, x, y, r, base) {
    const g = ctx.createRadialGradient(x - r * 0.4, y - r * 0.45, r * 0.1, x, y, r);
    g.addColorStop(0, shade(base, 0.3)); g.addColorStop(0.55, base); g.addColorStop(1, shade(base, -0.42));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  }
  function trunk(ctx, h, w, col) {
    const g = ctx.createLinearGradient(-w, 0, w, 0); g.addColorStop(0, shade(col, 0.25)); g.addColorStop(0.5, col); g.addColorStop(1, shade(col, -0.4));
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-w * 1.5, 0); ctx.lineTo(-w * 0.8, -h); ctx.lineTo(w * 0.8, -h); ctx.lineTo(w * 1.5, 0); ctx.closePath(); ctx.fill();
  }
  function tree(v) {
    return cached('tree:' + v, () => mk(84, 104, 34, 92, ctx => {
      const rng = mulberry32(v * 77 + 5);
      softShadow(ctx, 9, 1, 24, 8, 0.42);
      if (v === 0 || v === 3) {
        // fir / spruce: stacked boughs
        const tiers = v === 0 ? 5 : 6, top = v === 0 ? 62 : 74, base = v === 0 ? '#2b5a2a' : '#24512e';
        trunk(ctx, 14, 2.4, '#5a3d22');
        for (let i = 0; i < tiers; i++) {
          const f = i / tiers, y = -9 - f * (top - 14), w = (v === 0 ? 17 : 14) * (1 - f * 0.78), h = (top - 9) / tiers * 1.9;
          const g = ctx.createLinearGradient(-w, 0, w, 0); g.addColorStop(0, shade(base, 0.2)); g.addColorStop(0.45, base); g.addColorStop(1, shade(base, -0.4));
          ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, y - h);
          const n = 6;
          for (let k = 0; k <= n; k++) { const x = lerp(w, -w, k / n); ctx.lineTo(x, y + (k % 2 ? 2.6 : 0) + Math.abs(k / n - 0.5) * -2); }
          ctx.closePath(); ctx.fill();
          ctx.fillStyle = 'rgba(8,24,10,.28)'; ctx.beginPath(); ctx.moveTo(-w, y); for (let k = 0; k <= n; k++) { const x = lerp(-w, w, k / n); ctx.lineTo(x, y + (k % 2 ? 2.6 : 0)); } ctx.lineTo(w * 0.8, y - 2.4); ctx.lineTo(-w * 0.8, y - 2.4); ctx.fill();
          ctx.strokeStyle = 'rgba(190,225,140,.25)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(-w * 0.7, y - 1.4); ctx.lineTo(-1, y - h + 2); ctx.stroke();
        }
      } else if (v === 4) {
        // birch: pale trunk, airy yellow-green crown
        trunk(ctx, 34, 1.9, '#e6e0d0');
        for (let i = 0; i < 6; i++) { ctx.fillStyle = '#3a342c'; ctx.fillRect(-1.6 + rng() * 2, -4 - i * 5, 1.8, 0.9); }
        const balls = [[-7, -36, 9], [7, -38, 9], [0, -47, 11], [-5, -57, 8], [6, -55, 8], [0, -64, 6]];
        for (const [x, y, r] of balls) leafBall(ctx, x + 1.4, y + 2, r, '#3f6a26');
        for (const [x, y, r] of balls) leafBall(ctx, x, y, r, '#7aa63a');
        for (let i = 0; i < 26; i++) { const b = balls[(rng() * balls.length) | 0]; ctx.fillStyle = rng() > 0.5 ? 'rgba(214,236,130,.5)' : 'rgba(40,70,20,.3)'; ctx.fillRect(b[0] + (rng() - 0.5) * b[2] * 1.5, b[1] + (rng() - 0.5) * b[2] * 1.5, 1.4, 1.2); }
      } else {
        // broadleaf: oak (1) and a rounder, lighter tree (2)
        const base = v === 1 ? '#3b6e30' : '#4f8632', dark = v === 1 ? '#234a22' : '#2f5c22';
        trunk(ctx, 20, 3, '#5f4124');
        ctx.strokeStyle = '#4a321a'; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(0, -18); ctx.lineTo(-7, -27); ctx.moveTo(0, -18); ctx.lineTo(7, -28); ctx.stroke();
        const balls = v === 1 ? [[-11, -28, 11], [11, -29, 11], [0, -33, 12], [-7, -43, 11], [8, -44, 10], [0, -53, 9]] : [[-9, -27, 10], [9, -27, 10], [0, -36, 13], [-6, -47, 9], [6, -47, 9]];
        for (const [x, y, r] of balls) leafBall(ctx, x + 2, y + 2.6, r, dark);
        for (const [x, y, r] of balls) leafBall(ctx, x, y, r, base);
        for (let i = 0; i < 34; i++) { const b = balls[(rng() * balls.length) | 0], a = rng() * 6.28, d = rng() * b[2] * 0.85; ctx.fillStyle = Math.sin(a) < 0 ? 'rgba(196,232,128,.4)' : 'rgba(16,40,14,.28)'; ctx.beginPath(); ctx.ellipse(b[0] + Math.cos(a) * d, b[1] + Math.sin(a) * d, 1.5, 1, a, 0, 7); ctx.fill(); }
      }
    }));
  }
  function lode(kind) {
    return cached('lode:' + kind, () => mk(80, 64, 38, 46, ctx => {
      softShadow(ctx, 6, 3, 34, 13, 0.4);
      const rocks = [[-14, 0, 16, 22, '#7d776c'], [10, 2, 18, 27, '#8a8478'], [-2, 6, 14, 15, '#989286']];
      for (const [x, y, w, h, c] of rocks) {
        const g = ctx.createLinearGradient(x - w, 0, x + w, 0); g.addColorStop(0, shade(c, 0.18)); g.addColorStop(0.5, c); g.addColorStop(1, shade(c, -0.35));
        ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x - w, y); ctx.lineTo(x - w * 0.5, y - h); ctx.lineTo(x + w * 0.4, y - h * 0.9); ctx.lineTo(x + w, y); ctx.lineTo(x, y + 6); ctx.closePath(); ctx.fill(); ctx.strokeStyle = OUT; ctx.lineWidth = 0.7; ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,.16)'; ctx.beginPath(); ctx.moveTo(x - w, y); ctx.lineTo(x - w * 0.5, y - h); ctx.lineTo(x - w * 0.1, y - h * 0.4); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(30,24,18,.3)'; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(x + w * 0.4, y - h * 0.9); ctx.lineTo(x + w * 0.1, y - h * 0.3); ctx.lineTo(x + w * 0.5, y + 1); ctx.stroke();
      }
      ctx.fillStyle = '#120e0a'; ctx.beginPath(); ctx.roundRect(-7, -6, 12, 14, [6, 6, 0, 0]); ctx.fill();
      L(ctx, -8, -6, -8, 8, '#2c1c0e', 2.6); L(ctx, 6, -6, 6, 8, '#2c1c0e', 2.6); L(ctx, -9.4, -7, 7.4, -7, '#2c1c0e', 2.8);
      L(ctx, -8.3, -5.6, -8.3, 8, '#8a6238', 1); L(ctx, 5.7, -5.6, 5.7, 8, '#8a6238', 1); L(ctx, -9, -7.5, 7, -7.5, '#8a6238', 1);
      const c = kind === 2 ? '#ff9a3c' : '#f6d04a';
      for (const [x, y] of [[-18, -8], [14, -14], [20, -3], [-10, -16], [8, -22], [-22, -2]]) { ctx.fillStyle = 'rgba(40,24,0,.5)'; ctx.fillRect(x - 0.5, y - 0.5, 3.6, 3.2); ctx.fillStyle = c; ctx.fillRect(x, y, 2.6, 2.2); ctx.fillStyle = '#fff6c2'; ctx.fillRect(x, y, 1, 1); }
    }));
  }

  // soft radial sprites for particles: 'smoke' | 'dust' | 'fire' | 'glow' (plain canvases)
  function puff(kind) {
    return cached('p:' + kind, () => {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      if (kind === 'smoke') { gr.addColorStop(0, 'rgba(92,88,82,.9)'); gr.addColorStop(0.5, 'rgba(70,66,62,.55)'); gr.addColorStop(1, 'rgba(60,56,52,0)'); }
      else if (kind === 'dust') { gr.addColorStop(0, 'rgba(206,182,136,.85)'); gr.addColorStop(0.5, 'rgba(190,166,120,.45)'); gr.addColorStop(1, 'rgba(180,156,110,0)'); }
      else if (kind === 'fire') { gr.addColorStop(0, 'rgba(255,252,220,1)'); gr.addColorStop(0.25, 'rgba(255,200,70,.9)'); gr.addColorStop(0.6, 'rgba(255,96,20,.45)'); gr.addColorStop(1, 'rgba(200,40,0,0)'); }
      else { gr.addColorStop(0, 'rgba(255,255,240,1)'); gr.addColorStop(0.3, 'rgba(255,236,170,.6)'); gr.addColorStop(1, 'rgba(255,220,120,0)'); }
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      if (kind === 'smoke') { const h = g.createRadialGradient(24, 22, 0, 24, 22, 16); h.addColorStop(0, 'rgba(170,166,160,.4)'); h.addColorStop(1, 'rgba(170,166,160,0)'); g.fillStyle = h; g.fillRect(0, 0, 64, 64); }
      return c;
    });
  }

  // ---- icons --------------------------------------------------------------
  function icon(type, col) {
    return cached('i:' + type + ':' + col.main, () => {
      const c = document.createElement('canvas'), W = 72, H = 54;
      c.width = W * 2; c.height = H * 2;
      const ctx = c.getContext('2d'); ctx.scale(2, 2);
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, '#5f93b8'); sky.addColorStop(0.62, '#bcd6da'); sky.addColorStop(0.63, '#5d8f3c'); sky.addColorStop(1, '#3a6426');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
      if (BUILDINGS[type]) {
        const s = building(type, col), d = BUILDINGS[type];
        const contentH = d.tall + (d.w + d.h) * 16, contentW = (d.w + d.h) * 32;
        const k = Math.min((H - 4) / contentH, (W - 2) / contentW);
        const cx = W / 2, cy = H - 3 - (d.w + d.h) * 8 * k;
        ctx.globalAlpha = 0.3; ctx.drawImage(s.sh.c, cx - s.sh.ox * k, cy - s.sh.oy * k, s.sh.w * k, s.sh.h * k); ctx.globalAlpha = 1;
        ctx.drawImage(s.c, cx - s.ox * k, cy - s.oy * k, s.w * k, s.h * k);
      } else {
        const s = unit(type, col, 'idle', 0, type === 'oxcart' ? 2 : 0), k = type === 'trebuchet' ? 1.25 : 1.75;
        ctx.drawImage(s.c, W / 2 - s.ox * k - (UNITS[type].armor === 'foot' ? 3 : 0), H - 7 - s.oy * k, s.w * k, s.h * k);
      }
      const vg = ctx.createRadialGradient(W / 2, H / 2, 16, W / 2, H / 2, 50); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.38)');
      ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
      return c;
    });
  }

  function draw(ctx, s, x, y, k) {
    if (k === undefined || k === 1) ctx.drawImage(s.c, x - s.ox, y - s.oy, s.w, s.h);
    else ctx.drawImage(s.c, x - s.ox * k, y - s.oy * k, s.w * k, s.h * k);
  }

  return { building, buildingAnim, unit, gold, tree, lode, puff, icon, draw, USCALE, WALKF };
})();
