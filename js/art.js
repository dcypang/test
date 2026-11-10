'use strict';
// ---------------------------------------------------------------------------
// Procedural art. Every sprite in the game is drawn here with canvas paths;
// there are no image files. Sprites are cached at 2x for crisp scaling.
// ---------------------------------------------------------------------------
const Art = (() => {
  const SS = 2;
  const cache = new Map();
  const STONE = '#a7a297', STONE_D = '#827d73', WOOD = '#8d643a', WOOD_D = '#5c3f22', PLASTER = '#dccca4',
    THATCH = '#c4a24c', DARK = '#2c2118', GOLD = '#f0c33c', SKIN = '#e5b88c', IRON = '#b9bec6';
  const OUT = 'rgba(24,16,8,.5)';

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
  function quadL(ctx, y, xa, xb, z0, z1, fill, stroke) { poly(ctx, [ip(xa, y, z0), ip(xb, y, z0), ip(xb, y, z1), ip(xa, y, z1)], fill, stroke === undefined ? null : stroke); }
  function quadR(ctx, x, ya, yb, z0, z1, fill, stroke) { poly(ctx, [ip(x, ya, z0), ip(x, yb, z0), ip(x, yb, z1), ip(x, ya, z1)], fill, stroke === undefined ? null : stroke); }

  function box(ctx, x0, y0, x1, y1, z0, z1, col, lines, topCol) {
    const L = shade(col, -0.08), R = shade(col, -0.32), T = topCol || shade(col, 0.16);
    poly(ctx, [ip(x0, y1, z0), ip(x1, y1, z0), ip(x1, y1, z1), ip(x0, y1, z1)], L);
    poly(ctx, [ip(x1, y0, z0), ip(x1, y1, z0), ip(x1, y1, z1), ip(x1, y0, z1)], R);
    if (lines) {
      const lc = 'rgba(30,20,10,.22)';
      for (let i = 1; i <= lines; i++) {
        const z = z0 + (z1 - z0) * i / (lines + 1);
        line(ctx, ip(x0, y1, z), ip(x1, y1, z), lc, 0.6);
        line(ctx, ip(x1, y0, z), ip(x1, y1, z), lc, 0.6);
      }
    }
    poly(ctx, [ip(x0, y0, z1), ip(x1, y0, z1), ip(x1, y1, z1), ip(x0, y1, z1)], T);
  }
  function gable(ctx, x0, y0, x1, y1, z, rise, col, axis, wallCol) {
    if (axis === 'x') {
      const ym = (y0 + y1) / 2;
      poly(ctx, [ip(x0, y0, z), ip(x1, y0, z), ip(x1, ym, z + rise), ip(x0, ym, z + rise)], shade(col, -0.4));
      poly(ctx, [ip(x1, y0, z), ip(x1, y1, z), ip(x1, ym, z + rise)], shade(wallCol, -0.3));
      poly(ctx, [ip(x0, y1, z), ip(x1, y1, z), ip(x1, ym, z + rise), ip(x0, ym, z + rise)], col);
      for (let i = 1; i < 4; i++) line(ctx, ip(x0, lerp(y1, ym, i / 4), z + rise * i / 4), ip(x1, lerp(y1, ym, i / 4), z + rise * i / 4), 'rgba(0,0,0,.14)', 0.6);
      line(ctx, ip(x0, ym, z + rise), ip(x1, ym, z + rise), shade(col, 0.3), 1);
    } else {
      const xm = (x0 + x1) / 2;
      poly(ctx, [ip(x0, y0, z), ip(x0, y1, z), ip(xm, y1, z + rise), ip(xm, y0, z + rise)], shade(col, -0.1));
      poly(ctx, [ip(x0, y1, z), ip(x1, y1, z), ip(xm, y1, z + rise)], shade(wallCol, -0.08));
      poly(ctx, [ip(x1, y0, z), ip(x1, y1, z), ip(xm, y1, z + rise), ip(xm, y0, z + rise)], shade(col, -0.28));
      for (let i = 1; i < 4; i++) line(ctx, ip(lerp(x1, xm, i / 4), y0, z + rise * i / 4), ip(lerp(x1, xm, i / 4), y1, z + rise * i / 4), 'rgba(0,0,0,.14)', 0.6);
      line(ctx, ip(xm, y0, z + rise), ip(xm, y1, z + rise), shade(col, 0.25), 1);
    }
  }
  function pyramid(ctx, x0, y0, x1, y1, z, rise, col) {
    const a = ip((x0 + x1) / 2, (y0 + y1) / 2, z + rise);
    poly(ctx, [ip(x0, y0, z), ip(x1, y0, z), a], shade(col, -0.42));
    poly(ctx, [ip(x0, y0, z), ip(x0, y1, z), a], shade(col, -0.15));
    poly(ctx, [ip(x0, y1, z), ip(x1, y1, z), a], shade(col, 0.06));
    poly(ctx, [ip(x1, y0, z), ip(x1, y1, z), a], shade(col, -0.28));
  }
  function cyl(ctx, cx, cy, r, z0, z1, col, r2) {
    const [sx, sy] = ip(cx, cy, 0), rx = r * 45.25, ry = r * 22.63;
    const rt = r2 === undefined ? r : r2, rx2 = rt * 45.25, ry2 = rt * 22.63;
    const g = ctx.createLinearGradient(sx - rx, 0, sx + rx, 0);
    g.addColorStop(0, shade(col, -0.12)); g.addColorStop(0.35, shade(col, 0.1)); g.addColorStop(1, shade(col, -0.42));
    ctx.beginPath();
    ctx.ellipse(sx, sy - z0, rx, ry, 0, 0, Math.PI, false);
    ctx.lineTo(sx - rx2, sy - z1);
    ctx.ellipse(sx, sy - z1, rx2, ry2, 0, Math.PI, 0, true);
    ctx.closePath();
    ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = OUT; ctx.lineWidth = 0.7; ctx.stroke();
    ell(ctx, sx, sy - z1, rx2, ry2, shade(col, 0.2), OUT);
  }
  function cone(ctx, cx, cy, r, z, rise, col) {
    const [sx, sy] = ip(cx, cy, 0), rx = r * 45.25, ry = r * 22.63;
    const g = ctx.createLinearGradient(sx - rx, 0, sx + rx, 0);
    g.addColorStop(0, shade(col, -0.05)); g.addColorStop(0.35, shade(col, 0.18)); g.addColorStop(1, shade(col, -0.4));
    ctx.beginPath(); ctx.moveTo(sx, sy - z - rise); ctx.lineTo(sx + rx, sy - z);
    ctx.ellipse(sx, sy - z, rx, ry, 0, 0, Math.PI, false);
    ctx.closePath(); ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = OUT; ctx.lineWidth = 0.7; ctx.stroke();
  }
  function crenels(ctx, x0, y0, x1, y1, z, s, h, col) {
    const list = [], nx = Math.max(2, Math.round((x1 - x0) / (s * 2))), ny = Math.max(2, Math.round((y1 - y0) / (s * 2)));
    for (let i = 0; i <= nx; i++) { const x = lerp(x0, x1 - s, i / nx); list.push([x, y0], [x, y1 - s]); }
    for (let i = 1; i < ny; i++) { const y = lerp(y0, y1 - s, i / ny); list.push([x0, y], [x1 - s, y]); }
    list.sort((a, b) => (a[0] + a[1]) - (b[0] + b[1]));
    for (const [x, y] of list) box(ctx, x, y, x + s, y + s, z, z + h, col);
  }
  function flag(ctx, x, y, z, h, col, dir) {
    const a = ip(x, y, z), d = dir || 1;
    line(ctx, a, [a[0], a[1] - h], '#4a3a2a', 1.2);
    poly(ctx, [[a[0], a[1] - h], [a[0] + 11 * d, a[1] - h + 3.5], [a[0], a[1] - h + 7]], col.main, 'rgba(0,0,0,.4)');
    line(ctx, [a[0], a[1] - h + 2], [a[0] + 6 * d, a[1] - h + 3.5], col.light, 0.8);
  }
  function groundShadow(ctx, w, h) {
    const o = 0.22;
    poly(ctx, [ip(-w / 2 + o, -h / 2 - o, 0), ip(w / 2 + o + 0.3, -h / 2 - o - 0.3, 0), ip(w / 2 + o, h / 2 - o, 0), ip(-w / 2 + o, h / 2 - o, 0)], 'rgba(0,0,0,.2)', null);
  }

  // ---- buildings ----------------------------------------------------------
  const BDRAW = {
    keep(ctx, col) {
      box(ctx, -1.46, -1.46, 1.46, 1.46, 0, 4, '#8f8a7e');
      cyl(ctx, -1.2, -1.2, 0.3, 4, 42, STONE); cone(ctx, -1.2, -1.2, 0.34, 42, 15, col.main);
      box(ctx, -1.22, -1.22, 1.22, 1.22, 4, 30, STONE, 4);
      // gate
      quadL(ctx, 1.22, -0.34, 0.34, 4, 21, '#3a2a18');
      poly(ctx, [ip(-0.34, 1.22, 21), ip(0, 1.22, 26), ip(0.34, 1.22, 21)], '#3a2a18', null);
      for (let i = -2; i <= 2; i++) line(ctx, ip(i * 0.12, 1.22, 5), ip(i * 0.12, 1.22, 21), 'rgba(0,0,0,.35)', 0.7);
      quadR(ctx, 1.22, -0.3, 0.3, 9, 25, col.main, OUT);
      quadR(ctx, 1.22, -0.12, 0.12, 12, 22, col.light);
      crenels(ctx, -1.22, -1.22, 1.22, 1.22, 30, 0.2, 5, STONE);
      cyl(ctx, 1.2, -1.2, 0.3, 4, 42, STONE); cone(ctx, 1.2, -1.2, 0.34, 42, 15, col.main);
      cyl(ctx, -1.2, 1.2, 0.3, 4, 42, STONE); cone(ctx, -1.2, 1.2, 0.34, 42, 15, col.main);
      box(ctx, -0.62, -0.62, 0.62, 0.62, 30, 64, shade(STONE, 0.06), 5);
      quadL(ctx, 0.62, -0.07, 0.07, 42, 55, DARK); quadR(ctx, 0.62, -0.07, 0.07, 42, 55, DARK);
      quadL(ctx, 0.62, -0.42, -0.3, 46, 54, DARK); quadL(ctx, 0.62, 0.3, 0.42, 46, 54, DARK);
      box(ctx, -0.74, -0.74, 0.74, 0.74, 64, 68, STONE_D);
      crenels(ctx, -0.74, -0.74, 0.74, 0.74, 68, 0.18, 4, STONE);
      pyramid(ctx, -0.5, -0.5, 0.5, 0.5, 70, 24, col.main);
      flag(ctx, 0, 0, 92, 16, col);
      cyl(ctx, 1.2, 1.2, 0.3, 4, 42, STONE); cone(ctx, 1.2, 1.2, 0.34, 42, 15, col.main);
    },
    mill(ctx, col) {
      ell(ctx, 0, 2, 40, 19, '#9c8f6c');
      for (const [x, y] of [[-30, 2], [-24, 8], [26, 8]]) { ell(ctx, x, y, 5, 3.4, '#d9c48a', OUT); }
      cyl(ctx, 0, 0, 0.62, 0, 40, '#c2b9a6', 0.46);
      ctx.fillStyle = DARK; ctx.beginPath(); ctx.roundRect(-16, -17, 8, 14, [4, 4, 0, 0]); ctx.fill();
      ctx.fillStyle = DARK; ctx.fillRect(4, -30, 4, 6);
      cyl(ctx, 0, 0, 0.47, 36, 41, col.main, 0.47);
      cone(ctx, 0, 0, 0.52, 41, 20, THATCH);
    },
    mint(ctx, col) {
      box(ctx, -1.46, -1.46, 1.46, 1.46, 0, 3, '#979182');
      box(ctx, -1.22, -1.22, 0.55, 0.95, 3, 30, PLASTER);
      for (const x of [-1.22, -0.62, -0.05, 0.55]) line(ctx, ip(x, 0.95, 3), ip(x, 0.95, 30), WOOD_D, 1.4);
      line(ctx, ip(-1.22, 0.95, 18), ip(0.55, 0.95, 18), WOOD_D, 1.2);
      for (const y of [-1.22, -0.4, 0.3, 0.95]) line(ctx, ip(0.55, y, 3), ip(0.55, y, 30), shade(WOOD_D, -0.2), 1.4);
      quadL(ctx, 0.95, -0.56, -0.12, 3, 17, '#4a321c', OUT);
      quadL(ctx, 0.95, -1.05, -0.78, 20, 27, '#5d7fa0', OUT);
      { const [cx, cy] = ip(0.25, 0.95, 22); ell(ctx, cx, cy, 5, 5.4, GOLD, '#7a5a10'); ell(ctx, cx, cy, 2.4, 2.8, null, '#7a5a10'); }
      gable(ctx, -1.32, -1.34, 0.65, 1.07, 30, 22, col.main, 'x', PLASTER);
      box(ctx, -0.7, -0.75, -0.42, -0.47, 38, 64, '#806d5f', 3);
      box(ctx, 0.55, -1.05, 1.3, 0.55, 3, 21, STONE, 3);
      quadR(ctx, 1.3, -0.5, 0.0, 3, 15, '#3b2c1e', OUT);
      crenels(ctx, 0.55, -1.05, 1.3, 0.55, 21, 0.16, 3, STONE);
      // gold on the vault roof and at the dock
      { const [gx, gy] = ip(0.92, -0.25, 22); ell(ctx, gx, gy, 9, 4.5, '#d9a82a'); ell(ctx, gx - 1, gy - 2, 6, 3.4, GOLD); ell(ctx, gx - 2, gy - 3.4, 2.4, 1.4, '#fff3b0'); }
      box(ctx, 0.75, 0.95, 1.2, 1.35, 0, 8, WOOD, 1);
      { const [gx, gy] = ip(0.97, 1.15, 9); ell(ctx, gx, gy, 6.5, 3.4, GOLD, '#8a6a12'); }
      box(ctx, 0.2, 1.1, 0.5, 1.38, 0, 6, WOOD_D);
    },
    barracks(ctx, col) {
      box(ctx, -1.46, -0.96, 1.46, 0.96, 0, 3, '#8a8170');
      box(ctx, -1.3, -0.8, 0.95, 0.55, 3, 24, WOOD, 5);
      quadL(ctx, 0.55, -0.5, -0.1, 3, 18, DARK, OUT);
      for (const x of [0.25, 0.6]) { const [cx, cy] = ip(x, 0.55, 14); ell(ctx, cx, cy, 4, 4.6, col.main, OUT); ell(ctx, cx, cy, 1.4, 1.6, col.light); }
      quadL(ctx, 0.55, -1.1, -0.8, 12, 19, '#3a2c20');
      gable(ctx, -1.4, -0.92, 1.05, 0.67, 24, 19, col.main, 'x', WOOD);
      // yard: dummy and rack
      { const a = ip(1.22, 0.3, 0); line(ctx, a, [a[0], a[1] - 16], WOOD_D, 2); line(ctx, [a[0] - 6, a[1] - 11], [a[0] + 6, a[1] - 11], WOOD_D, 2); ell(ctx, a[0], a[1] - 18, 3, 3, '#cdb37a', OUT); }
      { const a = ip(1.25, -0.45, 0); line(ctx, [a[0] - 7, a[1] - 4], [a[0] + 7, a[1] + 3], WOOD_D, 1.6);
        for (let i = -1; i <= 1; i++) line(ctx, [a[0] + i * 5, a[1] + i * 2.5], [a[0] + i * 5 + 2, a[1] + i * 2.5 - 17], IRON, 1.1); }
      flag(ctx, -1.3, 0.55, 3, 44, col);
    },
    stable(ctx, col) {
      box(ctx, -1.46, -1.46, 1.46, 1.46, 0, 2, '#9a8a62');
      box(ctx, -1.3, -1.3, 1.3, -0.15, 2, 24, WOOD, 5);
      for (const x of [-1.05, -0.3, 0.45]) { quadL(ctx, -0.15, x, x + 0.55, 2, 17, DARK); line(ctx, ip(x, -0.15, 10), ip(x + 0.55, -0.15, 10), WOOD_D, 1.4); }
      quadL(ctx, -0.15, 1.05, 1.25, 7, 21, col.main, OUT);
      quadR(ctx, 1.3, -0.95, -0.5, 9, 18, '#3a2c20');
      gable(ctx, -1.42, -1.42, 1.42, -0.03, 24, 17, THATCH, 'x', WOOD);
      line(ctx, ip(-1.42, -0.03, 24), ip(1.42, -0.03, 24), col.main, 2);
      box(ctx, -0.95, 0.45, -0.5, 0.9, 2, 10, '#d8b84e', 2);
      box(ctx, 0.35, 0.55, 1.0, 0.8, 2, 6, WOOD_D);
      // paddock rails
      const rail = (a, b) => { for (const z of [5, 9]) line(ctx, ip(a[0], a[1], z), ip(b[0], b[1], z), '#6d4c2a', 1.3); };
      rail([-1.36, 0.0], [-1.36, 1.36]); rail([-1.36, 1.36], [1.36, 1.36]); rail([1.36, 1.36], [1.36, 0.0]);
      for (const [x, y] of [[-1.36, 0], [-1.36, 0.68], [-1.36, 1.36], [-0.45, 1.36], [0.45, 1.36], [1.36, 1.36], [1.36, 0.68], [1.36, 0]]) line(ctx, ip(x, y, 0), ip(x, y, 11), WOOD_D, 1.8);
    },
    beacon(ctx, col) {
      box(ctx, -0.8, -0.8, 0.8, 0.8, 0, 9, STONE_D, 1);
      quadL(ctx, 0.8, -0.14, 0.14, 0, 8, DARK);
      box(ctx, -0.42, -0.42, 0.42, 0.42, 9, 70, STONE, 9);
      quadL(ctx, 0.42, -0.16, 0.16, 34, 60, col.main, OUT); quadL(ctx, 0.42, -0.07, 0.07, 38, 56, col.light);
      quadR(ctx, 0.42, -0.06, 0.06, 40, 52, DARK);
      box(ctx, -0.6, -0.6, 0.6, 0.6, 70, 75, WOOD);
      { const [bx, by] = ip(0, 0, 77); ell(ctx, bx, by, 9, 4.5, '#3a3430', OUT); }
      for (const [x, y] of [[-0.55, -0.55], [0.55, -0.55], [-0.55, 0.55], [0.55, 0.55]]) line(ctx, ip(x, y, 75), ip(x, y, 93), WOOD_D, 1.6);
      pyramid(ctx, -0.66, -0.66, 0.66, 0.66, 93, 16, col.main);
    },
    siegeworks(ctx, col) {
      box(ctx, -1.46, -1.46, 1.46, 1.46, 0, 2, '#8f7d5c');
      box(ctx, -1.3, -1.3, 1.3, -0.5, 2, 22, WOOD, 4);
      quadL(ctx, -0.5, 0.5, 1.0, 2, 16, DARK);
      gable(ctx, -1.4, -1.42, 1.4, -0.38, 22, 15, col.main, 'x', WOOD);
      // open shed
      for (const [x, y] of [[-1.25, -0.3], [0.1, -0.3]]) line(ctx, ip(x, y, 2), ip(x, y, 26), WOOD_D, 2.2);
      // half-built engine under the shed
      { const a = ip(-0.6, 0.45, 2); line(ctx, [a[0] - 12, a[1]], [a[0] + 12, a[1] + 2], WOOD, 3); line(ctx, [a[0] - 6, a[1]], [a[0], a[1] - 15], WOOD, 2); line(ctx, [a[0] + 7, a[1] + 1], [a[0], a[1] - 15], WOOD, 2); ell(ctx, a[0] - 9, a[1] + 2, 4, 4, null, WOOD_D); ell(ctx, a[0] + 10, a[1] + 4, 4, 4, null, WOOD_D); }
      for (const [x, y] of [[-1.25, 1.15], [0.1, 1.15]]) line(ctx, ip(x, y, 2), ip(x, y, 26), WOOD_D, 2.2);
      poly(ctx, [ip(-1.35, -0.4, 26), ip(0.2, -0.4, 26), ip(0.2, 1.25, 30), ip(-1.35, 1.25, 30)], shade(THATCH, -0.1));
      // crane
      { const b = ip(0.95, 0.75, 2), t = [b[0], b[1] - 50], e = [b[0] - 24, b[1] - 44];
        line(ctx, b, t, WOOD_D, 2.6); line(ctx, t, e, WOOD_D, 2); line(ctx, [b[0], b[1] - 30], [e[0] + 10, e[1] + 2], WOOD, 1.3);
        line(ctx, e, [e[0], e[1] + 22], '#cbb98a', 0.8); ctx.fillStyle = STONE_D; ctx.fillRect(e[0] - 3, e[1] + 22, 6, 5); }
      // logs
      for (let i = 0; i < 3; i++) { const a = ip(0.75 + i * 0.16, -0.15 + i * 0.02, 3 + (i === 1 ? 4 : 0)); line(ctx, [a[0] - 11, a[1] - 5], [a[0] + 9, a[1] + 5], '#7a5530', 4.4); ell(ctx, a[0] + 9, a[1] + 5, 2, 2.4, '#c9a56c'); }
      flag(ctx, 1.3, -0.5, 22, 22, col);
    },
    academy(ctx, col) {
      box(ctx, -1.46, -1.46, 1.46, 1.46, 0, 3, '#bdb7a8');
      box(ctx, -1.3, -1.3, 1.3, 1.3, 3, 6, '#cfc8b6');
      box(ctx, -1.1, -1.1, 1.1, 1.1, 6, 34, PLASTER);
      for (const x of [-0.95, -0.55, 0.43, 0.83]) quadL(ctx, 1.1, x, x + 0.13, 6, 32, '#f2ead4', 'rgba(0,0,0,.25)');
      for (const y of [-0.95, -0.4, 0.27, 0.83]) quadR(ctx, 1.1, y, y + 0.13, 6, 32, '#c9bfa5', 'rgba(0,0,0,.25)');
      quadL(ctx, 1.1, -0.24, 0.24, 6, 24, '#4a3520', OUT);
      poly(ctx, [ip(-0.24, 1.1, 24), ip(0, 1.1, 29), ip(0.24, 1.1, 24)], '#4a3520', null);
      quadR(ctx, 1.1, -0.2, 0.08, 14, 25, '#5d7fa0', OUT);
      box(ctx, -1.2, -1.2, 1.2, 1.2, 34, 38, '#cdc3a8');
      cyl(ctx, 0, 0, 0.7, 38, 45, PLASTER);
      { const [dx, dy] = ip(0, 0, 45), rx = 0.66 * 45.25;
        const g = ctx.createLinearGradient(dx - rx, 0, dx + rx, 0);
        g.addColorStop(0, col.main); g.addColorStop(0.3, col.light); g.addColorStop(1, col.dark);
        ctx.beginPath(); ctx.ellipse(dx, dy, rx, 27, 0, Math.PI, 0, false); ctx.ellipse(dx, dy, rx, rx / 2, 0, 0, Math.PI, false);
        ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = OUT; ctx.lineWidth = 0.7; ctx.stroke();
        line(ctx, [dx, dy - 27], [dx, dy - 36], GOLD, 1.6); ell(ctx, dx, dy - 37, 2.2, 2.2, GOLD, '#7a5a10'); }
    },
    skyfire(ctx, col) {
      box(ctx, -1.42, -1.42, 1.42, 1.42, 0, 8, STONE_D, 1);
      box(ctx, -1.05, -1.05, 1.05, 1.05, 8, 14, STONE);
      flag(ctx, -1.3, -1.3, 8, 30, col);
      box(ctx, -0.75, -0.55, 0.75, 0.55, 14, 22, WOOD, 1);
      // inclined rack
      poly(ctx, [ip(-0.66, 0.5, 22), ip(0.66, 0.5, 22), ip(0.66, -0.45, 60), ip(-0.66, -0.45, 60)], WOOD_D);
      for (let i = 0; i < 6; i++) {
        const x = -0.55 + i * 0.22, a = ip(x, 0.42, 25), b = ip(x, -0.4, 60);
        line(ctx, a, b, '#d9cfb4', 2.4);
        line(ctx, [lerp(a[0], b[0], 0.82), lerp(a[1], b[1], 0.82)], b, col.main, 2.6);
        line(ctx, a, [lerp(a[0], b[0], 0.1), lerp(a[1], b[1], 0.1)], DARK, 2.8);
      }
      for (const [x, y] of [[-0.66, 0.5], [0.66, 0.5]]) line(ctx, ip(x, y, 22), ip(x, y - 0.9, 22), WOOD, 1.6);
      line(ctx, ip(0.66, -0.45, 22), ip(0.66, -0.45, 60), WOOD, 2); line(ctx, ip(-0.66, -0.45, 22), ip(-0.66, -0.45, 60), WOOD, 2);
      cyl(ctx, 1.05, 0.9, 0.16, 8, 20, '#6d4c2a'); cyl(ctx, 0.8, 1.1, 0.16, 8, 20, '#7a5530');
      flag(ctx, 1.3, 1.3, 8, 30, col);
    },
    palisade(ctx, col) {
      const n = 4;
      for (let k = 0; k < 2; k++) for (let i = 0; i < n; i++) {
        // back row then front row of stakes
        const pts = k === 0 ? [[-0.42 + i * 0.28, -0.42], [-0.42, -0.42 + i * 0.28]] : [[-0.42 + i * 0.28, 0.42], [0.42, -0.42 + i * 0.28]];
        for (const [x, y] of pts) {
          const a = ip(x, y, 0), h = 19 + ((i * 7 + k * 3) % 4);
          ctx.fillStyle = k ? WOOD : shade(WOOD, -0.25);
          ctx.beginPath(); ctx.moveTo(a[0] - 3.2, a[1]); ctx.lineTo(a[0] - 3.2, a[1] - h); ctx.lineTo(a[0], a[1] - h - 5); ctx.lineTo(a[0] + 3.2, a[1] - h); ctx.lineTo(a[0] + 3.2, a[1]); ctx.closePath(); ctx.fill();
          ctx.strokeStyle = OUT; ctx.lineWidth = 0.6; ctx.stroke();
        }
        if (k === 0 && i === n - 1) box(ctx, -0.36, -0.36, 0.36, 0.36, 0, 12, shade(WOOD, -0.2));
      }
      line(ctx, ip(-0.42, 0.42, 12), ip(0.42, 0.42, 12), col.main, 1.4);
    },
    watchtower(ctx, col) {
      box(ctx, -0.34, -0.34, 0.34, 0.34, 0, 36, WOOD, 6);
      line(ctx, ip(-0.34, 0.34, 0), ip(0.34, 0.34, 36), WOOD_D, 1.2); line(ctx, ip(0.34, 0.34, 0), ip(-0.34, 0.34, 36), WOOD_D, 1.2);
      box(ctx, -0.48, -0.48, 0.48, 0.48, 36, 45, WOOD_D, 1);
      quadL(ctx, 0.48, -0.2, 0.2, 37, 44, col.main, OUT);
      for (const [x, y] of [[-0.44, -0.44], [0.44, -0.44], [-0.44, 0.44], [0.44, 0.44]]) line(ctx, ip(x, y, 45), ip(x, y, 56), WOOD_D, 1.5);
      pyramid(ctx, -0.56, -0.56, 0.56, 0.56, 56, 14, col.main);
    },
    bolttower(ctx, col) {
      cyl(ctx, 0, 0, 0.42, 0, 44, STONE);
      cyl(ctx, 0, 0, 0.43, 27, 32, col.main);
      ctx.fillStyle = DARK; ctx.fillRect(-8, -24, 3, 8);
      cyl(ctx, 0, 0, 0.5, 44, 50, STONE_D);
      { const [bx, by] = ip(0, 0, 53); line(ctx, [bx - 9, by + 3], [bx + 12, by - 4], WOOD_D, 2.6);
        ctx.beginPath(); ctx.moveTo(bx + 2, by - 10); ctx.quadraticCurveTo(bx + 14, by - 2, bx + 8, by + 8); ctx.strokeStyle = WOOD; ctx.lineWidth = 2; ctx.stroke();
        line(ctx, [bx + 2, by - 10], [bx - 6, by + 2], '#d9cfb4', 0.7); line(ctx, [bx + 8, by + 8], [bx - 6, by + 2], '#d9cfb4', 0.7); }
    },
    bombardtower(ctx, col) {
      cyl(ctx, 0, 0, 0.86, 0, 36, STONE, 0.76);
      cyl(ctx, 0, 0, 0.775, 22, 28, col.main, 0.765);
      ctx.fillStyle = DARK; ctx.beginPath(); ctx.roundRect(-22, -15, 9, 14, [4, 4, 0, 0]); ctx.fill();
      cyl(ctx, 0, 0, 0.84, 36, 43, STONE_D);
      { const [bx, by] = ip(0, 0, 46); ell(ctx, bx, by + 2, 13, 7, '#4a443c');
        line(ctx, [bx - 4, by], [bx + 22, by + 6], '#2e2b28', 8); line(ctx, [bx - 4, by - 1.5], [bx + 22, by + 4.5], '#5a5650', 2);
        ell(ctx, bx + 23, by + 6, 3, 4.4, '#141210'); }
      flag(ctx, -0.5, -0.5, 43, 22, col);
    },
  };

  function building(type, col) {
    return cached('b:' + type + ':' + col.main, () => {
      const d = BUILDINGS[type], half = (d.w + d.h) * 16, pad = 14, tall = d.tall + 16;
      const W = half * 2 + pad * 2, H = half + tall + pad * 2;
      return mk(W, H, W / 2, pad + tall + half / 2, ctx => { groundShadow(ctx, d.w, d.h); BDRAW[type](ctx, col); });
    });
  }

  // live (animated) parts, drawn every frame on top of the cached sprite
  function buildingAnim(ctx, b, sx, sy, t, col, lowGrain) {
    if (b.type === 'mill') {
      const hx = sx + 11, hy = sy - 34, a0 = lowGrain ? b.id : t * 1.4 + b.id;
      ctx.lineCap = 'round';
      for (let i = 0; i < 4; i++) {
        const a = a0 + i * Math.PI / 2, L = 30, c = Math.cos(a), s = Math.sin(a);
        const tx = hx - 0.894 * L * c, ty = hy + 0.447 * L * c - L * s;
        // sail cloth: offset perpendicular
        const a2 = a + 0.28, c2 = Math.cos(a2), s2 = Math.sin(a2);
        const ux = hx - 0.894 * L * c2, uy = hy + 0.447 * L * c2 - L * s2;
        ctx.beginPath(); ctx.moveTo(lerp(hx, tx, 0.25), lerp(hy, ty, 0.25)); ctx.lineTo(tx, ty); ctx.lineTo(ux, uy); ctx.lineTo(lerp(hx, ux, 0.25), lerp(hy, uy, 0.25)); ctx.closePath();
        ctx.fillStyle = 'rgba(238,228,200,.92)'; ctx.fill(); ctx.strokeStyle = 'rgba(60,40,20,.6)'; ctx.lineWidth = 0.6; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(tx, ty); ctx.strokeStyle = WOOD_D; ctx.lineWidth = 1.6; ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(hx, hy, 2.6, 0, 7); ctx.fillStyle = col.main; ctx.fill();
    } else if (b.type === 'beacon') {
      if (lowGrain) return;
      const f = 0.75 + 0.25 * Math.sin(t * 13 + b.id) * Math.sin(t * 7.3);
      const g = ctx.createRadialGradient(sx, sy - 82, 1, sx, sy - 82, 20 * f);
      g.addColorStop(0, 'rgba(255,220,120,.95)'); g.addColorStop(0.35, 'rgba(255,140,40,.6)'); g.addColorStop(1, 'rgba(255,90,20,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy - 82, 20, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff2b0'; ctx.beginPath(); ctx.ellipse(sx, sy - 82, 3.5, 5 * f, 0, 0, 7); ctx.fill();
    } else if (b.type === 'skyfire') {
      const k = b.charge / SKY_T;
      if (k >= 1 && !lowGrain) {
        const f = 0.6 + 0.4 * Math.sin(t * 6);
        ctx.fillStyle = `rgba(255,${150 + 80 * f | 0},60,${0.35 + 0.3 * f})`;
        ctx.beginPath(); ctx.arc(sx + 14, sy - 62, 9 + 3 * f, 0, 7); ctx.fill();
      }
    }
  }

  // ---- units --------------------------------------------------------------
  function shadow(ctx, rx, ry) { ctx.fillStyle = 'rgba(0,0,0,.26)'; ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, 7); ctx.fill(); }
  function L(ctx, x0, y0, x1, y1, col, lw) { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.stroke(); }

  function man(ctx, col, o, ph, st) {
    const walk = st === 'walk', atk = st === 'atk';
    const sw = walk ? Math.sin(ph * Math.PI * 2) : 0;
    const bob = walk ? -Math.abs(Math.cos(ph * Math.PI * 2)) * 0.9 : 0;
    shadow(ctx, 5.5, 2.4);
    const tunic = o.tunic || col.main;
    if (o.robe) {
      ctx.fillStyle = o.robe; ctx.beginPath(); ctx.moveTo(-3, -13 + bob); ctx.lineTo(3, -13 + bob); ctx.lineTo(4.2 + sw * 0.6, 0); ctx.lineTo(-4.2 + sw * 0.6, 0); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = OUT; ctx.lineWidth = 0.6; ctx.stroke();
      L(ctx, -3, -8 + bob, 3, -8 + bob, col.main, 1.4);
    } else {
      L(ctx, -1.2, -6 + bob, -1.2 + 3.2 * sw, 0, '#3a2b1f', 2.1);
      L(ctx, 1.2, -6 + bob, 1.2 - 3.2 * sw, 0, '#4a382a', 2.1);
      ctx.fillStyle = tunic; ctx.beginPath(); ctx.roundRect(-3.1, -13.4 + bob, 6.2, 8.2, 1.6); ctx.fill();
      ctx.strokeStyle = OUT; ctx.lineWidth = 0.6; ctx.stroke();
      L(ctx, -3, -7.4 + bob, 3, -7.4 + bob, '#3a2b1f', 1);
      if (o.mail) { ctx.fillStyle = IRON; ctx.fillRect(-3.1, -13.4 + bob, 6.2, 3.4); }
    }
    // head
    ctx.fillStyle = SKIN; ctx.beginPath(); ctx.arc(0.3, -15.8 + bob, 2.7, 0, 7); ctx.fill();
    ctx.strokeStyle = OUT; ctx.lineWidth = 0.5; ctx.stroke();
    if (o.helm) { ctx.fillStyle = o.helm; ctx.beginPath(); ctx.arc(0.3, -16.3 + bob, 2.9, Math.PI, 0); ctx.fill(); ctx.stroke(); if (o.plume) L(ctx, 0.3, -19 + bob, -2.2, -21.5 + bob, col.light, 1.6); }
    if (o.hood) { ctx.fillStyle = o.hood; ctx.beginPath(); ctx.arc(-0.2, -16.2 + bob, 3, Math.PI * 0.75, Math.PI * 0.05); ctx.fill(); }
    if (o.hat) { ctx.fillStyle = o.hat; ctx.beginPath(); ctx.ellipse(0.3, -17.6 + bob, 4.4, 1.4, 0, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(0.3, -18 + bob, 2.4, Math.PI, 0); ctx.fill(); }
    const y = bob;
    switch (o.w) {
      case 'spear':
        if (atk) { L(ctx, -6, -10 + y, 13, -11 + y, '#7a5a34', 1.3); ctx.fillStyle = IRON; ctx.beginPath(); ctx.moveTo(13, -12.6 + y); ctx.lineTo(17, -11 + y); ctx.lineTo(13, -9.4 + y); ctx.fill(); }
        else { L(ctx, 3.2, -1 + y, 6.2, -23 + y, '#7a5a34', 1.3); ctx.fillStyle = IRON; ctx.beginPath(); ctx.moveTo(5, -23 + y); ctx.lineTo(6.6, -27.5 + y); ctx.lineTo(7.6, -22.8 + y); ctx.fill(); }
        L(ctx, 1, -11 + y, 4.2, -9.5 + y, SKIN, 1.5);
        break;
      case 'sword':
        if (atk) L(ctx, 4, -10.5 + y, 12, -8 + y, '#e3e7ee', 1.6); else L(ctx, 4, -10.5 + y, 8.5, -20 + y, '#e3e7ee', 1.6);
        L(ctx, 1, -11.5 + y, 4.2, -10.4 + y, SKIN, 1.5);
        ctx.fillStyle = col.light; ctx.beginPath(); ctx.ellipse(-2.8, -9.6 + y, 3.1, 3.9, 0, 0, 7); ctx.fill(); ctx.strokeStyle = col.dark; ctx.lineWidth = 0.9; ctx.stroke();
        break;
      case 'bow':
        ctx.beginPath(); ctx.arc(2.5, -11 + y, 6.6, -1.15, 1.15); ctx.strokeStyle = '#7a4d24'; ctx.lineWidth = 1.3; ctx.stroke();
        if (atk) { L(ctx, 5.2, -17 + y, 0.5, -11 + y, '#e9e2cf', 0.5); L(ctx, 5.2, -5 + y, 0.5, -11 + y, '#e9e2cf', 0.5); L(ctx, 0.5, -11 + y, 11, -11 + y, '#d9cfb4', 0.9); }
        else L(ctx, 5.2, -17 + y, 5.2, -5 + y, '#e9e2cf', 0.5);
        L(ctx, 1, -11.5 + y, 7, -11 + y, SKIN, 1.4);
        ctx.fillStyle = '#6b4a2a'; ctx.fillRect(-4.6, -13 + y, 1.8, 7);
        break;
      case 'xbow':
        L(ctx, 1, -10.6 + y, 10, -10.6 + y, '#6b4a2a', 1.9);
        ctx.beginPath(); ctx.moveTo(8.6, -15.5 + y); ctx.quadraticCurveTo(11.5, -10.6 + y, 8.6, -5.7 + y); ctx.strokeStyle = IRON; ctx.lineWidth = 1.3; ctx.stroke();
        if (!atk) L(ctx, 3, -11.4 + y, 10.5, -11.4 + y, '#e9e2cf', 0.7);
        break;
      case 'gun':
        L(ctx, 0.5, -10.4 + y, 11.5, -11.6 + y, '#2e2a26', 1.9); L(ctx, 0.5, -10.2 + y, 4.5, -9.6 + y, '#7a4d24', 2.3);
        if (atk) { ctx.fillStyle = '#ffe07a'; ctx.beginPath(); ctx.moveTo(11.5, -11.6 + y); ctx.lineTo(18, -14.5 + y); ctx.lineTo(16, -11.8 + y); ctx.lineTo(18.5, -9.2 + y); ctx.closePath(); ctx.fill(); }
        break;
      case 'tool':
        L(ctx, 2.6, -8 + y, 6.4, -19 + y, '#7a5a34', 1.3); L(ctx, 3.8, -19.6 + y, 9.2, -17.6 + y, IRON, 2.2);
        ctx.fillStyle = '#6b4a2a'; ctx.beginPath(); ctx.roundRect(-5.6, -13 + y, 3, 6.6, 1); ctx.fill();
        break;
      case 'staff':
        L(ctx, 4.6, 0, 4.6, -21 + y, '#6b4a2a', 1.2); L(ctx, 2.6, -18 + y, 6.6, -18 + y, GOLD, 1.3); L(ctx, 4.6, -22.5 + y, 4.6, -15.5 + y, GOLD, 1.3);
        if (atk) { ctx.fillStyle = 'rgba(255,240,170,.75)'; ctx.beginPath(); ctx.arc(4.6, -19 + y, 5, 0, 7); ctx.fill(); }
        break;
    }
  }

  function horse(ctx, col, o, ph, st) {
    const walk = st === 'walk', atk = st === 'atk';
    const sw = walk ? Math.sin(ph * Math.PI * 2) : 0;
    const bob = walk ? -Math.abs(Math.sin(ph * Math.PI * 2)) * 1.1 : 0;
    shadow(ctx, 11, 3.8);
    const hc = o.horse, hd = shade(o.horse, -0.3);
    L(ctx, -6, -8 + bob, -6 - 4 * sw, 0, hd, 1.9); L(ctx, 5.6, -8 + bob, 5.6 - 4 * sw, 0, hd, 1.9);
    L(ctx, -4.2, -8 + bob, -4.2 + 4 * sw, 0, hc, 2); L(ctx, 7.2, -8 + bob, 7.2 + 4 * sw, 0, hc, 2);
    // tail
    ctx.beginPath(); ctx.moveTo(-8.5, -12 + bob); ctx.quadraticCurveTo(-13, -11 + bob, -12 - sw, -4 + bob); ctx.strokeStyle = hd; ctx.lineWidth = 1.8; ctx.stroke();
    ctx.fillStyle = hc; ctx.beginPath(); ctx.ellipse(0, -10.5 + bob, 9.2, 4.6, 0, 0, 7); ctx.fill(); ctx.strokeStyle = OUT; ctx.lineWidth = 0.6; ctx.stroke();
    // neck + head
    ctx.fillStyle = hc; ctx.beginPath(); ctx.moveTo(5, -13.5 + bob); ctx.lineTo(10.2, -21 + bob); ctx.lineTo(13.2, -19 + bob); ctx.lineTo(9.6, -8.6 + bob); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(13.4, -19.4 + bob, 3.5, 2.1, 0.5, 0, 7); ctx.fill(); ctx.stroke();
    L(ctx, 10.4, -21 + bob, 10, -23.6 + bob, hd, 1.2);
    L(ctx, 6, -14 + bob, 10, -21 + bob, hd, 1.2);
    if (o.capar) {
      ctx.fillStyle = col.main; ctx.beginPath(); ctx.moveTo(-8.4, -12.5 + bob); ctx.lineTo(8, -12.5 + bob); ctx.lineTo(8.6, -5.4 + bob); ctx.lineTo(-8.8, -5.4 + bob); ctx.closePath(); ctx.fill(); ctx.stroke();
      L(ctx, -8.6, -6 + bob, 8.6, -6 + bob, col.light, 1.1);
    } else { ctx.fillStyle = col.main; ctx.fillRect(-3.4, -14.6 + bob, 6.4, 3.4); }
    // rider
    L(ctx, 0.2, -14 + bob, 1.8, -7.4 + bob, '#3a2b1f', 2);
    ctx.fillStyle = o.mail ? IRON : col.main; ctx.beginPath(); ctx.roundRect(-2.9, -22.6 + bob, 5.8, 8.6, 1.5); ctx.fill(); ctx.stroke();
    if (o.mail) { ctx.fillStyle = col.main; ctx.fillRect(-2.9, -19 + bob, 5.8, 3.2); }
    ctx.fillStyle = SKIN; ctx.beginPath(); ctx.arc(0.3, -25 + bob, 2.6, 0, 7); ctx.fill(); ctx.stroke();
    if (o.helm) { ctx.fillStyle = o.helm; ctx.beginPath(); ctx.arc(0.3, -25.5 + bob, 2.8, Math.PI, 0); ctx.fill(); ctx.stroke(); if (o.plume) L(ctx, 0.3, -28 + bob, -2.6, -30.4 + bob, col.light, 1.7); }
    if (o.w === 'lance') {
      if (atk) { L(ctx, -5, -18 + bob, 18, -17 + bob, '#7a5a34', 1.4); ctx.fillStyle = IRON; ctx.beginPath(); ctx.moveTo(18, -18.6 + bob); ctx.lineTo(22, -17 + bob); ctx.lineTo(18, -15.4 + bob); ctx.fill(); }
      else { L(ctx, 2.4, -13 + bob, 6.2, -35 + bob, '#7a5a34', 1.4); ctx.fillStyle = col.light; ctx.beginPath(); ctx.moveTo(6, -34 + bob); ctx.lineTo(11.5, -32.4 + bob); ctx.lineTo(5.6, -30.6 + bob); ctx.fill(); }
      ctx.fillStyle = col.light; ctx.beginPath(); ctx.ellipse(-2.4, -18.6 + bob, 2.8, 3.6, 0, 0, 7); ctx.fill(); ctx.strokeStyle = col.dark; ctx.lineWidth = 0.9; ctx.stroke();
    } else {
      if (atk) L(ctx, 3.4, -19.4 + bob, 11, -16.6 + bob, '#e3e7ee', 1.5); else L(ctx, 3.4, -19.4 + bob, 6.8, -28 + bob, '#e3e7ee', 1.5);
    }
  }

  function ox(ctx, x, sw, bob) {
    const c = '#9a7f5e', d = '#6f5a41';
    L(ctx, x - 3.6, -5 + bob, x - 3.6 - 2.4 * sw, 0, d, 1.8); L(ctx, x + 3.6, -5 + bob, x + 3.6 - 2.4 * sw, 0, d, 1.8);
    L(ctx, x - 2, -5 + bob, x - 2 + 2.4 * sw, 0, c, 1.9); L(ctx, x + 5, -5 + bob, x + 5 + 2.4 * sw, 0, c, 1.9);
    ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(x, -7.6 + bob, 6.8, 4.1, 0, 0, 7); ctx.fill(); ctx.strokeStyle = OUT; ctx.lineWidth = 0.6; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(x + 7.4, -8.6 + bob, 2.9, 2.5, 0.3, 0, 7); ctx.fill(); ctx.stroke();
    L(ctx, x + 7, -10.6 + bob, x + 5.4, -13 + bob, '#efe6cf', 1.1); L(ctx, x + 8.4, -10.6 + bob, x + 10, -13 + bob, '#efe6cf', 1.1);
  }
  function wheel(ctx, x, y, r, rot) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fillStyle = '#5a3d22'; ctx.fill(); ctx.strokeStyle = '#2c1c0e'; ctx.lineWidth = 1; ctx.stroke();
    for (let i = 0; i < 4; i++) { const a = rot + i * Math.PI / 4; L(ctx, x - Math.cos(a) * r, y - Math.sin(a) * r, x + Math.cos(a) * r, y + Math.sin(a) * r, '#a67c4e', 0.7); }
  }

  const UDRAW = {
    spearman: (c, col, p, s) => man(c, col, { w: 'spear', hood: '#6b5a44' }, p, s),
    archer: (c, col, p, s) => man(c, col, { w: 'bow', hat: '#4d6b3a' }, p, s),
    sapper: (c, col, p, s) => man(c, col, { w: 'tool', hat: '#8a6a3a', tunic: '#a88a5a' }, p, s),
    swordsman: (c, col, p, s) => man(c, col, { w: 'sword', helm: IRON, mail: true }, p, s),
    arbalest: (c, col, p, s) => man(c, col, { w: 'xbow', helm: '#8d939c' }, p, s),
    friar: (c, col, p, s) => man(c, col, { w: 'staff', robe: '#7a5a3c', hood: '#5c4028' }, p, s),
    handgunner: (c, col, p, s) => man(c, col, { w: 'gun', hat: '#2e2a26', mail: true }, p, s),
    outrider: (c, col, p, s) => horse(c, col, { horse: '#a67c4e', w: 'sword', hat: 1 }, p, s),
    knight: (c, col, p, s) => horse(c, col, { horse: '#4a4040', w: 'lance', capar: true, mail: true, helm: IRON, plume: true }, p, s),
    oxcart(ctx, col, ph, st, cargo) {
      const walk = st === 'walk', sw = walk ? Math.sin(ph * Math.PI * 2) : 0, bob = walk ? -Math.abs(sw) * 0.6 : 0;
      shadow(ctx, 15, 4.4);
      ox(ctx, 8, sw, bob);
      L(ctx, -1, -6.5, 4, -7 + bob, '#5c3f22', 1.3);
      ctx.fillStyle = WOOD; ctx.beginPath(); ctx.moveTo(-14.5, -12.5); ctx.lineTo(-0.5, -12.5); ctx.lineTo(-1.5, -5); ctx.lineTo(-13.5, -5); ctx.closePath(); ctx.fill(); ctx.strokeStyle = OUT; ctx.lineWidth = 0.7; ctx.stroke();
      ctx.fillStyle = col.main; ctx.fillRect(-14, -10.4, 13, 2.4);
      if (cargo > 0) {
        ctx.fillStyle = cargo > 1 ? '#f4cc48' : '#dcae30';
        ctx.beginPath(); ctx.ellipse(-7.5, -12.6, 6.2, cargo > 1 ? 4.6 : 2.6, 0, Math.PI, 0); ctx.fill(); ctx.strokeStyle = '#8a6a12'; ctx.lineWidth = 0.6; ctx.stroke();
        ctx.fillStyle = '#fff3b0'; ctx.fillRect(-9, -15 - (cargo > 1 ? 1 : 0), 1.6, 1.2);
      }
      wheel(ctx, -7.5, -3.8, 4.1, ph * 6.28);
    },
    wagon(ctx, col, ph, st) {
      const walk = st === 'walk', sw = walk ? Math.sin(ph * Math.PI * 2) : 0, bob = walk ? -Math.abs(sw) * 0.6 : 0;
      shadow(ctx, 17, 4.8);
      ox(ctx, 11, sw, bob);
      L(ctx, 0, -7, 6, -7 + bob, '#5c3f22', 1.3);
      ctx.fillStyle = WOOD; ctx.fillRect(-17, -10, 17, 5.4); ctx.strokeStyle = OUT; ctx.lineWidth = 0.7; ctx.strokeRect(-17, -10, 17, 5.4);
      ctx.fillStyle = '#efe6cf'; ctx.beginPath(); ctx.moveTo(-17.5, -10); ctx.quadraticCurveTo(-17, -24, -8.5, -24); ctx.quadraticCurveTo(0, -24, 0.5, -10); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = col.main; ctx.beginPath(); ctx.moveTo(-11.5, -10); ctx.quadraticCurveTo(-11.5, -23.6, -8.5, -24); ctx.quadraticCurveTo(-5.5, -23.6, -5.5, -10); ctx.closePath(); ctx.fill();
      wheel(ctx, -13, -3.8, 4, ph * 6.28); wheel(ctx, -4, -3.8, 4, ph * 6.28 + 0.5);
    },
    ram(ctx, col, ph, st) {
      const atk = st === 'atk', ext = atk ? 5 : 0;
      shadow(ctx, 15, 4.6);
      L(ctx, -9 + ext, -8.5, 15 + ext, -8.5, '#6b4423', 4.2);
      ctx.fillStyle = '#8d939c'; ctx.beginPath(); ctx.moveTo(14 + ext, -11.2); ctx.lineTo(19.5 + ext, -8.5); ctx.lineTo(14 + ext, -5.8); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#7b5a3a'; ctx.beginPath(); ctx.moveTo(-13, -6.5); ctx.lineTo(-1, -21); ctx.lineTo(11, -6.5); ctx.closePath(); ctx.fill(); ctx.strokeStyle = OUT; ctx.lineWidth = 0.7; ctx.stroke();
      ctx.fillStyle = col.main; ctx.beginPath(); ctx.moveTo(-7.4, -13.2); ctx.lineTo(-1, -21); ctx.lineTo(5.4, -13.2); ctx.closePath(); ctx.fill();
      L(ctx, -13, -6.5, 11, -6.5, WOOD_D, 1.6);
      wheel(ctx, -8.5, -3.4, 3.6, ph * 6.28); wheel(ctx, 0, -3.4, 3.6, ph * 6.28 + 1); wheel(ctx, 7.5, -3.4, 3.6, ph * 6.28 + 2);
    },
    mangonel(ctx, col, ph, st) {
      const atk = st === 'atk';
      shadow(ctx, 14, 4.4);
      ctx.fillStyle = WOOD; ctx.fillRect(-11, -8.4, 22, 3.4); ctx.strokeStyle = OUT; ctx.lineWidth = 0.7; ctx.strokeRect(-11, -8.4, 22, 3.4);
      L(ctx, 3, -8, 3, -18, WOOD_D, 2.2); L(ctx, 8, -8, 3, -18, WOOD_D, 1.4);
      if (atk) { L(ctx, 1, -8, 5, -25, '#7a5530', 2.1); ctx.fillStyle = WOOD_D; ctx.beginPath(); ctx.arc(5.4, -26, 2.6, 0, 7); ctx.fill(); }
      else { L(ctx, 2, -9, -10, -15, '#7a5530', 2.1); ctx.fillStyle = WOOD_D; ctx.beginPath(); ctx.arc(-10.6, -15.6, 2.8, 0, 7); ctx.fill(); ctx.fillStyle = '#8d939c'; ctx.beginPath(); ctx.arc(-10.6, -16.6, 1.9, 0, 7); ctx.fill(); }
      ctx.fillStyle = col.main; ctx.fillRect(-10.6, -8.2, 6, 3);
      wheel(ctx, -7, -3.6, 3.7, ph * 6.28); wheel(ctx, 7, -3.6, 3.7, ph * 6.28 + 1);
    },
    trebuchet(ctx, col, ph, st) {
      const atk = st === 'atk';
      shadow(ctx, 16, 5);
      ctx.fillStyle = WOOD; ctx.fillRect(-13, -6.4, 26, 3); ctx.strokeStyle = OUT; ctx.lineWidth = 0.7; ctx.strokeRect(-13, -6.4, 26, 3);
      L(ctx, -8, -5, 0, -27, WOOD_D, 2.2); L(ctx, 8, -5, 0, -27, WOOD_D, 2.2); L(ctx, -4.4, -15, 4.4, -15, WOOD_D, 1.3);
      if (atk) {
        L(ctx, -5, -17, 9, -45, '#7a5530', 2); ctx.fillStyle = '#4a443c'; ctx.fillRect(-9.5, -17, 8, 8); ctx.strokeRect(-9.5, -17, 8, 8);
        L(ctx, 9, -45, 13, -40, '#d9cfb4', 0.7);
      } else {
        L(ctx, 6, -33, -14, -11, '#7a5530', 2); L(ctx, 6, -33, 6.5, -28, '#2c1c0e', 1); ctx.fillStyle = '#4a443c'; ctx.fillRect(2.5, -28.5, 8, 8); ctx.strokeRect(2.5, -28.5, 8, 8);
        L(ctx, -14, -11, -9, -6.5, '#d9cfb4', 0.7); ctx.fillStyle = '#8d939c'; ctx.beginPath(); ctx.arc(-9, -6.8, 2, 0, 7); ctx.fill();
      }
      ctx.fillStyle = col.main; ctx.beginPath(); ctx.moveTo(0, -27); ctx.lineTo(0, -34); ctx.lineTo(-6, -32); ctx.lineTo(0, -30); ctx.fill();
      wheel(ctx, -10, -2.8, 2.9, ph * 6.28); wheel(ctx, 10, -2.8, 2.9, ph * 6.28 + 1);
    },
  };

  // state: 'idle' | 'walk' | 'atk'; frame: 0..3; extra: cargo level for carts
  function unit(type, col, state, frame, extra) {
    return cached('u:' + type + ':' + col.main + ':' + state + ':' + frame + ':' + (extra || 0), () =>
      mk(76, 76, 38, 60, ctx => UDRAW[type](ctx, col, frame / 4, state, extra || 0)));
  }

  // ---- terrain ------------------------------------------------------------
  function diamond(ctx, grow) {
    const g = grow || 0;
    ctx.beginPath(); ctx.moveTo(0, -HH - g / 2); ctx.lineTo(HW + g, 0); ctx.lineTo(0, HH + g / 2); ctx.lineTo(-HW - g, 0); ctx.closePath();
  }
  const TILE_BASE = {
    [T_GRASS]: ['#5f8f3e', '#659643', '#5a8a3c', '#6a9a47'],
    [T_SAND]: ['#cdbb85', '#c6b47e'],
    [T_DIRT]: ['#9a8358', '#93794f', '#a18a5f'],
    [T_WATER]: ['#2f6f9e', '#2b6996', '#3275a4', '#2e6d9b'],
    [T_FOREST]: ['#456e31', '#3f672d'],
    [T_ROCK]: ['#8a7f6a'],
  };
  function tile(t, v) {
    const bases = TILE_BASE[t], k = v % bases.length;
    return cached('t:' + t + ':' + (v % (bases.length * 2)), () => mk(TW + 4, TH + 4, HW + 2, HH + 2, ctx => {
      const rng = mulberry32(t * 977 + (v % (bases.length * 2)) * 131 + 5);
      diamond(ctx, 1.2); ctx.fillStyle = bases[k]; ctx.fill();
      ctx.save(); diamond(ctx, 0); ctx.clip();
      const dots = t === T_WATER ? 7 : 22;
      for (let i = 0; i < dots; i++) {
        const x = (rng() - 0.5) * TW, y = (rng() - 0.5) * TH;
        if (t === T_WATER) { ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x - 5, y); ctx.quadraticCurveTo(x, y - 1.6, x + 5, y); ctx.stroke(); }
        else if (t === T_GRASS || t === T_FOREST) { ctx.strokeStyle = rng() > 0.5 ? 'rgba(30,60,20,.3)' : 'rgba(170,210,110,.3)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 1, y - 2.4); ctx.stroke(); }
        else { ctx.fillStyle = rng() > 0.5 ? 'rgba(60,40,20,.22)' : 'rgba(255,240,200,.2)'; ctx.fillRect(x, y, 1.6, 1.1); }
      }
      if (t === T_GRASS && rng() > 0.62) { const x = (rng() - 0.5) * 30, y = (rng() - 0.5) * 12; ctx.fillStyle = ['#e8e0a0', '#e9b7c9', '#ffffff'][(rng() * 3) | 0]; ctx.fillRect(x, y, 1.6, 1.6); ctx.fillRect(x + 4, y + 2, 1.4, 1.4); }
      ctx.restore();
    }));
  }
  function gold(kind, level, v) {
    return cached('g:' + kind + ':' + level + ':' + (v % 3), () => mk(TW, TH + 12, HW, HH + 10, ctx => {
      const rng = mulberry32(kind * 31 + level * 7 + (v % 3) * 101);
      const n = 2 + level * 3, pts = [];
      for (let i = 0; i < n; i++) { const a = rng() * 6.28, r = Math.sqrt(rng()) * 0.42; pts.push([Math.cos(a) * r * TW * 0.8, Math.sin(a) * r * TH * 0.8, 1.6 + rng() * (1.2 + level * 0.5)]); }
      pts.sort((a, b) => a[1] - b[1]);
      for (const [x, y, s] of pts) {
        ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(x + 1, y + 1, s * 1.3, s * 0.6, 0, 0, 7); ctx.fill();
        if (kind === 1) {
          ctx.fillStyle = '#c9951c'; ctx.beginPath(); ctx.moveTo(x - s, y); ctx.lineTo(x - s * 0.5, y - s * 1.3); ctx.lineTo(x + s * 0.6, y - s * 1.1); ctx.lineTo(x + s, y); ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#f6d04a'; ctx.beginPath(); ctx.moveTo(x - s * 0.5, y - s * 1.3); ctx.lineTo(x + s * 0.6, y - s * 1.1); ctx.lineTo(x, y - s * 0.3); ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#fff6c2'; ctx.fillRect(x - s * 0.3, y - s * 1.2, 1, 1);
        } else {
          ctx.fillStyle = '#b3401c'; ctx.beginPath(); ctx.moveTo(x - s * 0.7, y); ctx.lineTo(x, y - s * 2.1); ctx.lineTo(x + s * 0.7, y); ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#ff9a3c'; ctx.beginPath(); ctx.moveTo(x - s * 0.7, y); ctx.lineTo(x, y - s * 2.1); ctx.lineTo(x - s * 0.05, y); ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#ffe2a8'; ctx.fillRect(x - s * 0.25, y - s * 1.3, 1, 1.4);
        }
      }
    }));
  }
  function tree(v) {
    return cached('tree:' + v, () => mk(56, 80, 28, 70, ctx => {
      ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(3, 0, 15, 6, 0, 0, 7); ctx.fill();
      L(ctx, 0, 0, 0, -16, '#5a3d22', 3.6);
      if (v === 0) {
        for (let i = 0; i < 4; i++) { const y = -12 - i * 11, w = 15 - i * 3;
          ctx.fillStyle = i % 2 ? '#2f5d2a' : '#2a5426'; ctx.beginPath(); ctx.moveTo(-w, y); ctx.lineTo(0, y - 19); ctx.lineTo(w, y); ctx.closePath(); ctx.fill();
          ctx.fillStyle = 'rgba(140,190,90,.28)'; ctx.beginPath(); ctx.moveTo(-w, y); ctx.lineTo(0, y - 19); ctx.lineTo(-w * 0.2, y); ctx.closePath(); ctx.fill(); }
      } else {
        const g = v === 1 ? ['#33652c', '#3d7634', '#4a8a3e'] : ['#4a7a2a', '#588c32', '#6aa03e'];
        const blobs = [[-8, -26, 11], [8, -27, 11], [0, -36, 13], [-4, -44, 9], [6, -43, 8]];
        for (const [x, y, r] of blobs) { ctx.fillStyle = g[0]; ctx.beginPath(); ctx.arc(x + 1.5, y + 2, r, 0, 7); ctx.fill(); }
        for (const [x, y, r] of blobs) { ctx.fillStyle = g[1]; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); }
        for (const [x, y, r] of blobs) { ctx.fillStyle = g[2]; ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.5, 0, 7); ctx.fill(); }
      }
    }));
  }
  function lode(kind) {
    return cached('lode:' + kind, () => mk(72, 60, 36, 44, ctx => {
      ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(3, 2, 30, 13, 0, 0, 7); ctx.fill();
      const rocks = [[-14, 0, 16, 22, '#7d776c'], [10, 2, 18, 27, '#8a8478'], [-2, 6, 14, 15, '#989286']];
      for (const [x, y, w, h, c] of rocks) {
        ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(x - w, y); ctx.lineTo(x - w * 0.5, y - h); ctx.lineTo(x + w * 0.4, y - h * 0.9); ctx.lineTo(x + w, y); ctx.lineTo(x, y + 6); ctx.closePath(); ctx.fill(); ctx.strokeStyle = OUT; ctx.lineWidth = 0.7; ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,.14)'; ctx.beginPath(); ctx.moveTo(x - w, y); ctx.lineTo(x - w * 0.5, y - h); ctx.lineTo(x - w * 0.1, y - h * 0.4); ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = '#1c1612'; ctx.beginPath(); ctx.roundRect(-7, -6, 12, 14, [6, 6, 0, 0]); ctx.fill();
      L(ctx, -8, -6, -8, 8, WOOD_D, 1.8); L(ctx, 6, -6, 6, 8, WOOD_D, 1.8); L(ctx, -9, -7, 7, -7, WOOD_D, 2);
      const c = kind === 2 ? '#ff9a3c' : '#f6d04a';
      for (const [x, y] of [[-18, -8], [14, -14], [20, -3], [-10, -16], [8, -22]]) { ctx.fillStyle = c; ctx.fillRect(x, y, 2.4, 2); }
    }));
  }

  // ---- icons --------------------------------------------------------------
  function icon(type, col) {
    return cached('i:' + type + ':' + col.main, () => {
      const c = document.createElement('canvas'), W = 72, H = 54;
      c.width = W * 2; c.height = H * 2;
      const ctx = c.getContext('2d'); ctx.scale(2, 2);
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#4f6a3c'); g.addColorStop(1, '#2f4526');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      if (BUILDINGS[type]) {
        const s = building(type, col), d = BUILDINGS[type];
        const contentH = d.tall + (d.w + d.h) * 16, contentW = (d.w + d.h) * 32;
        const k = Math.min((H - 4) / contentH, (W - 2) / contentW);
        const cx = W / 2, cy = H - 3 - (d.w + d.h) * 8 * k;
        ctx.drawImage(s.c, cx - s.ox * k, cy - s.oy * k, s.w * k, s.h * k);
      } else {
        const s = unit(type, col, 'idle', 0, type === 'oxcart' ? 2 : 0), k = type === 'trebuchet' ? 1.25 : 1.75;
        ctx.drawImage(s.c, W / 2 - s.ox * k - (UNITS[type].armor === 'foot' ? 3 : 0), H - 8 - s.oy * k, s.w * k, s.h * k);
      }
      return c;
    });
  }

  function draw(ctx, s, x, y, k) {
    if (k === undefined || k === 1) ctx.drawImage(s.c, x - s.ox, y - s.oy, s.w, s.h);
    else ctx.drawImage(s.c, x - s.ox * k, y - s.oy * k, s.w * k, s.h * k);
  }

  return { building, buildingAnim, unit, tile, gold, tree, lode, icon, draw, diamond };
})();
