'use strict';
// ---------------------------------------------------------------------------
// World renderer (isometric) and minimap
// ---------------------------------------------------------------------------
const View = { x: 0, y: 0, zoom: 1, W: 800, H: 600, dpr: 1 };

function w2s(wx, wy, z) {
  return [((wx - wy) * HW - View.x) * View.zoom + View.W / 2, ((wx + wy) * HH - (z || 0) - View.y) * View.zoom + View.H / 2];
}
function s2w(sx, sy) {
  const px = (sx - View.W / 2) / View.zoom + View.x, py = (sy - View.H / 2) / View.zoom + View.y;
  return { x: (px / HW + py / HH) / 2, y: (py / HH - px / HW) / 2 };
}
function clampView() {
  const n = G.map.n;
  View.x = clamp(View.x, -n * HW + 100, n * HW - 100);
  View.y = clamp(View.y, 60, n * TH - 60);
}
function centerOn(x, y) { View.x = (x - y) * HW; View.y = (x + y) * HH; clampView(); }

const Render = (() => {
  let fogC = null, fogCtx = null, fogImg = null;
  let mmBase = null, mmBaseT = -99;
  const list = [];

  function updateFog() {
    const n = G.map.n;
    if (!fogC) { fogC = document.createElement('canvas'); fogC.width = fogC.height = n; fogCtx = fogC.getContext('2d'); fogImg = fogCtx.createImageData(n, n); }
    const d = fogImg.data, vis = G.vis, ex = G.explored;
    for (let i = 0; i < n * n; i++) { d[i * 4] = 7; d[i * 4 + 1] = 9; d[i * 4 + 2] = 12; d[i * 4 + 3] = !ex[i] ? 255 : !vis[i] ? 112 : 0; }
    fogCtx.putImageData(fogImg, 0, 0);
    G.fogDirty = false;
  }

  function tileDiamond(ctx, tx, ty, w, h) {
    const a = ip(tx, ty), b = ip(tx + w, ty), c = ip(tx + w, ty + h), d = ip(tx, ty + h);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(d[0], d[1]); ctx.closePath();
  }

  function drawBar(ctx, x, y, w, f, col) {
    ctx.fillStyle = 'rgba(0,0,0,.65)'; ctx.fillRect(x - w / 2 - 1, y - 1, w + 2, 5);
    ctx.fillStyle = col || (f > 0.6 ? '#4fd24a' : f > 0.3 ? '#e8c53a' : '#e2432f'); ctx.fillRect(x - w / 2, y, Math.max(0, w * f), 3);
  }

  function drawUnit(ctx, u, ui) {
    const p = G.players[u.owner];
    const [sx, sy] = ip(u.x, u.y);
    const atk = u.atkAnim > 0, st = atk ? 'atk' : u.moving ? 'walk' : 'idle';
    const fr = u.moving && !atk ? Math.floor(u.anim * 4) % 4 : 0;
    const cargo = u.def.cart ? (u.cargo > CART_CAP * 0.6 ? 2 : u.cargo > 20 ? 1 : 0) : 0;
    const s = Art.unit(u.type, p.col, st, fr, cargo);
    const jig = u.order.s === 'mine' ? Math.sin(G.time * 22) * 0.6 : 0;
    ctx.save(); ctx.translate(sx + jig, sy); if (u.dir < 0) ctx.scale(-1, 1);
    ctx.drawImage(s.c, -s.ox, -s.oy, s.w, s.h);
    if (u.flash > 0) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.6; ctx.drawImage(s.c, -s.ox, -s.oy, s.w, s.h); }
    ctx.restore();
    if (u.vet) {
      const top = u.def.armor === 'foot' ? 24 : 34;
      ctx.strokeStyle = u.vet === 2 ? '#ffd84a' : '#f2f2f2'; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
      for (let i = 0; i < u.vet; i++) { ctx.beginPath(); ctx.moveTo(sx - 3.5, sy - top - i * 3); ctx.lineTo(sx, sy - top - 2.6 - i * 3); ctx.lineTo(sx + 3.5, sy - top - i * 3); ctx.stroke(); }
    }
  }

  function drawBuilding(ctx, b, ui) {
    const p = G.players[b.owner], s = Art.building(b.type, p.col);
    const [sx, sy] = ip(b.x, b.y);
    if (b.built < 1) {
      const k = clamp(b.built, 0.02, 1), sh = s.c.height * k;
      ctx.globalAlpha = 0.55 + 0.45 * k;
      ctx.drawImage(s.c, 0, s.c.height - sh, s.c.width, sh, sx - s.ox, sy - s.oy + s.h * (1 - k), s.w, s.h * k);
      ctx.globalAlpha = 1;
      return;
    }
    ctx.drawImage(s.c, sx - s.ox, sy - s.oy, s.w, s.h);
    if (b.flash > 0) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.4; ctx.drawImage(s.c, sx - s.ox, sy - s.oy, s.w, s.h); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; }
    Art.buildingAnim(ctx, b, sx, sy, G.time, p.col, p.lowGrain);
    const blink = Math.floor(G.time * 2.5) % 2 === 0;
    if (b.owner === G.human && blink) {
      if (p.lowGrain && b.def.grain < 0) { ctx.fillStyle = '#ffd23a'; ctx.strokeStyle = '#3a2a08'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(sx, sy - b.def.tall - 6, 7, 0, 7); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#3a2a08'; ctx.fillRect(sx - 1, sy - b.def.tall - 11, 2, 6); ctx.fillRect(sx - 1, sy - b.def.tall - 3.5, 2, 2); }
      else if (b.repairing) { ctx.fillStyle = '#58e06a'; ctx.strokeStyle = '#0c3a14'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(sx, sy - b.def.tall - 6, 7, 0, 7); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#0c3a14'; ctx.fillRect(sx - 4, sy - b.def.tall - 7, 8, 2); ctx.fillRect(sx - 1, sy - b.def.tall - 10, 2, 8); }
    }
  }

  function drawProj(ctx, p) {
    if (p.delay > 0) return;
    const a = ip(p.x, p.y, p.z), b = ip(p.px === undefined ? p.x0 : p.px, p.py === undefined ? p.y0 : p.py, p.pz === undefined ? p.z0 : p.pz);
    let dx = a[0] - b[0], dy = a[1] - b[1]; const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
    ctx.lineCap = 'round';
    switch (p.kind) {
      case 'arrow': ctx.strokeStyle = '#e9dfc4'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(a[0] - dx * 9, a[1] - dy * 9); ctx.lineTo(a[0], a[1]); ctx.stroke(); break;
      case 'bolt': ctx.strokeStyle = '#3a2c1e'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(a[0] - dx * 12, a[1] - dy * 12); ctx.lineTo(a[0], a[1]); ctx.stroke(); break;
      case 'shot': ctx.strokeStyle = 'rgba(255,230,150,.9)'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(a[0] - dx * 16, a[1] - dy * 16); ctx.lineTo(a[0], a[1]); ctx.stroke(); break;
      case 'rocket': {
        ctx.strokeStyle = '#e9dfc4'; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(a[0] - dx * 10, a[1] - dy * 10); ctx.lineTo(a[0], a[1]); ctx.stroke();
        ctx.fillStyle = '#ffb030'; ctx.beginPath(); ctx.arc(a[0] - dx * 12, a[1] - dy * 12, 3.4, 0, 7); ctx.fill();
        break;
      }
      default: {
        const g = ip(p.x, p.y, 0), r = p.kind === 'boulder' ? 4.2 : p.kind === 'ball' ? 3 : 3.2;
        ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(g[0], g[1], r * 1.2, r * 0.6, 0, 0, 7); ctx.fill();
        ctx.fillStyle = p.kind === 'ball' ? '#22201e' : '#8a857b'; ctx.beginPath(); ctx.arc(a[0], a[1], r, 0, 7); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 0.7; ctx.stroke();
      }
    }
  }

  function drawPart(ctx, p) {
    const [x, y] = ip(p.x, p.y, p.z), k = p.life / p.max;
    switch (p.kind) {
      case 'smoke': ctx.fillStyle = `rgba(70,66,62,${0.42 * (1 - k)})`; ctx.beginPath(); ctx.arc(x, y, p.size * (0.6 + k), 0, 7); ctx.fill(); break;
      case 'dust': ctx.fillStyle = `rgba(190,165,120,${0.45 * (1 - k)})`; ctx.beginPath(); ctx.arc(x, y, p.size * (0.6 + k), 0, 7); ctx.fill(); break;
      case 'fire': ctx.fillStyle = `rgba(255,${(220 - 140 * k) | 0},${(90 - 80 * k) | 0},${0.85 * (1 - k)})`; ctx.beginPath(); ctx.arc(x, y, p.size * (1 - k * 0.5), 0, 7); ctx.fill(); break;
      case 'debris': ctx.fillStyle = `rgba(50,40,30,${1 - k * 0.6})`; ctx.fillRect(x - p.size / 2, y - p.size / 2, p.size, p.size); break;
      case 'heal': ctx.fillStyle = `rgba(120,255,140,${1 - k})`; ctx.fillRect(x - 3, y - 1, 6, 2); ctx.fillRect(x - 1, y - 3, 2, 6); break;
    }
  }

  function draw(ctx, ui) {
    const { W, H, zoom, dpr } = View, m = G.map, n = m.n;
    if (G.fogDirty || !fogC) updateFog();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0a0d10'; ctx.fillRect(0, 0, W, H);
    const shx = G.shake > 0 ? (Math.random() - 0.5) * 10 * G.shake : 0, shy = G.shake > 0 ? (Math.random() - 0.5) * 10 * G.shake : 0;
    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * (W / 2 - View.x * zoom + shx), dpr * (H / 2 - View.y * zoom + shy));
    ctx.imageSmoothingEnabled = true;
    const L = View.x - W / 2 / zoom - 40, R = View.x + W / 2 / zoom + 40, T = View.y - H / 2 / zoom - 24, B = View.y + H / 2 / zoom + 24;
    // tile range from view corners
    const c = [s2w(0, 0), s2w(W, 0), s2w(0, H), s2w(W, H)];
    const x0 = clamp(Math.floor(Math.min(c[0].x, c[1].x, c[2].x, c[3].x)) - 1, 0, n - 1), x1 = clamp(Math.ceil(Math.max(c[0].x, c[1].x, c[2].x, c[3].x)) + 1, 0, n - 1);
    const y0 = clamp(Math.floor(Math.min(c[0].y, c[1].y, c[2].y, c[3].y)) - 1, 0, n - 1), y1 = clamp(Math.ceil(Math.max(c[0].y, c[1].y, c[2].y, c[3].y)) + 1, 0, n - 1);
    const ex = G.explored, vis = G.vis, wt = Math.floor(G.time * 1.3);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = (x - y) * HW, py = (x + y + 1) * HH;
      if (px < L || px > R || py < T || py > B) continue;
      const i = y * n + x;
      if (!ex[i]) continue;
      const t = m.terrain[i];
      const s = Art.tile(t, t === T_WATER ? m.variant[i] + wt : m.variant[i]);
      ctx.drawImage(s.c, px - s.ox, py - s.oy, s.w, s.h);
      const g = m.gold[i];
      if (g > 0) { const gs = Art.gold(m.goldKind[i] || 1, clamp(Math.ceil(g / 150), 1, 4), m.variant[i]); ctx.drawImage(gs.c, px - gs.ox, py - gs.oy, gs.w, gs.h); }
    }
    // decals
    for (const d of G.decals) {
      const [sx, sy] = ip(d.x, d.y), a = clamp((d.life - (G.time - d.t)) / 6, 0, 1);
      if (sx < L || sx > R || sy < T || sy > B) continue;
      if (d.kind === 'rubble') {
        ctx.fillStyle = `rgba(40,34,28,${0.55 * a})`; tileDiamond(ctx, d.x - d.w / 2 + 0.1, d.y - d.h / 2 + 0.1, d.w - 0.2, d.h - 0.2); ctx.fill();
        ctx.fillStyle = `rgba(120,112,100,${0.8 * a})`;
        for (let i = 0; i < 8 * d.w; i++) { const q = ip(d.x + Math.sin(i * 12.9 + d.x) * d.w * 0.4, d.y + Math.cos(i * 7.3 + d.y) * d.h * 0.4); ctx.fillRect(q[0], q[1], 4, 2.6); }
      } else if (d.kind === 'scorch') { ctx.fillStyle = `rgba(20,16,12,${0.4 * a})`; ctx.beginPath(); ctx.ellipse(sx, sy, 26, 13, 0, 0, 7); ctx.fill(); }
      else { ctx.fillStyle = `rgba(90,20,14,${0.5 * a})`; ctx.beginPath(); ctx.ellipse(sx, sy, d.big ? 10 : 6, d.big ? 4.4 : 2.8, 0, 0, 7); ctx.fill(); ctx.fillStyle = d.col; ctx.globalAlpha = 0.7 * a; ctx.fillRect(sx - 3, sy - 2, 6, 2.4); ctx.globalAlpha = 1; }
    }
    // selection rings + rally lines (under entities)
    const selSet = ui.selSet;
    for (const e of G.ents) {
      if (!selSet.has(e.id) || e.dead) continue;
      if (e.kind === 'u') {
        const [sx, sy] = ip(e.x, e.y), r = e.def.r * 38 + 3;
        ctx.strokeStyle = e.owner === G.human ? 'rgba(255,255,255,.95)' : 'rgba(255,90,70,.95)'; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.ellipse(sx, sy, r, r / 2, 0, 0, 7); ctx.stroke();
      } else {
        ctx.strokeStyle = e.owner === G.human ? 'rgba(255,255,255,.9)' : 'rgba(255,90,70,.95)'; ctx.lineWidth = 1.5;
        tileDiamond(ctx, e.tx - 0.06, e.ty - 0.06, e.w + 0.12, e.h + 0.12); ctx.stroke();
        if (e.rally && e.owner === G.human) {
          const a = ip(e.x, e.y), b = ip(e.rally.x, e.rally.y);
          ctx.setLineDash([5, 4]); ctx.strokeStyle = 'rgba(255,230,120,.85)'; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.setLineDash([]);
          ctx.fillStyle = '#ffe27a'; ctx.beginPath(); ctx.moveTo(b[0], b[1]); ctx.lineTo(b[0], b[1] - 16); ctx.lineTo(b[0] + 9, b[1] - 12); ctx.lineTo(b[0], b[1] - 8); ctx.fill();
          ctx.strokeStyle = '#4a3a1a'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(b[0], b[1]); ctx.lineTo(b[0], b[1] - 16); ctx.stroke();
        }
      }
    }
    for (const mk of ui.markers) {
      const k = (performance.now() - mk.t) / 500; if (k > 1) continue;
      const [sx, sy] = ip(mk.x, mk.y);
      ctx.strokeStyle = mk.col; ctx.globalAlpha = 1 - k; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(sx, sy, 16 * (1 - k * 0.6), 8 * (1 - k * 0.6), 0, 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
    }
    // depth-sorted entities
    list.length = 0;
    for (const e of G.ents) {
      if (e.dead) continue;
      const px = (e.x - e.y) * HW, py = (e.x + e.y) * HH;
      if (px < L - 120 || px > R + 120 || py < T - 40 || py > B + 150) continue;
      const i = clamp(Math.floor(e.y), 0, n - 1) * n + clamp(Math.floor(e.x), 0, n - 1);
      if (e.owner !== G.human) { if (e.kind === 'u' ? !vis[i] : !ex[i]) continue; }
      list.push({ d: e.x + e.y + (e.kind === 'b' ? 0.01 : 0), e, k: e.kind === 'u' ? 0 : 1 });
    }
    for (const t of m.trees) {
      const px = (t.x - t.y) * HW, py = (t.x + t.y) * HH;
      if (px < L || px > R || py < T || py > B + 70) continue;
      list.push({ d: t.x + t.y, e: t, k: 2 });
    }
    for (const l of m.lodes) {
      const px = (l.x - l.y) * HW, py = (l.x + l.y) * HH;
      if (px < L || px > R || py < T || py > B + 40) continue;
      list.push({ d: l.x + l.y, e: l, k: 3 });
    }
    list.sort((a, b) => a.d - b.d);
    for (const it of list) {
      const e = it.e;
      if (it.k === 0) drawUnit(ctx, e, ui);
      else if (it.k === 1) drawBuilding(ctx, e, ui);
      else if (it.k === 2) { const s = Art.tree(e.v), q = ip(e.x, e.y); Art.draw(ctx, s, q[0], q[1], e.s); }
      else { const s = Art.lode(e.kind), q = ip(e.x, e.y); Art.draw(ctx, s, q[0], q[1]); }
    }
    for (const p of G.projs) drawProj(ctx, p);
    for (const p of G.parts) drawPart(ctx, p);
    // fog of war: one smoothed draw of an n x n alpha map through the iso transform
    ctx.save(); ctx.transform(HW, HH, -HW, HH, 0, 0); ctx.imageSmoothingEnabled = true; ctx.drawImage(fogC, 0, 0); ctx.restore();
    // health bars
    for (const it of list) {
      if (it.k > 1) continue;
      const e = it.e;
      const show = selSet.has(e.id) || ui.hoverId === e.id || (G.time - e.lastHit < 2.5 && e.hp < e.maxHp);
      if (!show) continue;
      const [sx, sy] = ip(e.x, e.y);
      if (e.kind === 'u') {
        const top = e.def.armor === 'foot' ? 26 : e.type === 'trebuchet' ? 40 : 34;
        drawBar(ctx, sx, sy - top, 20, e.hp / e.maxHp);
        if (e.def.cart && selSet.has(e.id)) drawBar(ctx, sx, sy - top + 5, 20, e.cargo / CART_CAP, '#f0c33c');
      } else {
        drawBar(ctx, sx, sy - e.def.tall - 8, (e.w + e.h) * 11, e.hp / e.maxHp);
        if (e.type === 'skyfire' && e.built >= 1) drawBar(ctx, sx, sy - e.def.tall - 2, (e.w + e.h) * 11, e.charge / SKY_T, '#ff8a3a');
      }
    }
    // floaters
    ctx.font = 'bold 12px system-ui, sans-serif'; ctx.textAlign = 'center';
    for (const f of G.floaters) {
      const k = (G.time - f.t) / 1.6, q = ip(f.x, f.y, 30 + k * 26);
      ctx.globalAlpha = 1 - k * k; ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillText(f.text, q[0] + 1, q[1] + 1); ctx.fillStyle = f.col; ctx.fillText(f.text, q[0], q[1]);
    }
    ctx.globalAlpha = 1;
    // placement ghost
    const mode = ui.mode;
    if (mode && mode.t === 'place' && ui.mouse.inside) {
      const d = BUILDINGS[mode.type], p = G.players[G.human];
      const tx = mode.tx, ty = mode.ty, ok = canPlace(p, mode.type, tx, ty);
      for (let y = ty; y < ty + d.h; y++) for (let x = tx; x < tx + d.w; x++) {
        const bad = !m.inb(x, y) || m.solid[y * n + x] || m.gold[y * n + x] > 0;
        ctx.fillStyle = bad || !ok ? 'rgba(230,60,40,.45)' : 'rgba(90,230,100,.4)';
        tileDiamond(ctx, x + 0.04, y + 0.04, 0.92, 0.92); ctx.fill();
      }
      const s = Art.building(mode.type, p.col), q = ip(tx + d.w / 2, ty + d.h / 2);
      ctx.globalAlpha = 0.6; ctx.drawImage(s.c, q[0] - s.ox, q[1] - s.oy, s.w, s.h); ctx.globalAlpha = 1;
      if (d.weapon) { ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(q[0], q[1], d.weapon.range * 45.25, d.weapon.range * 22.63, 0, 0, 7); ctx.stroke(); }
    }
    if (mode && (mode.t === 'super' || mode.t === 'hawk') && ui.mouse.inside) {
      const w = s2w(ui.mouse.x, ui.mouse.y), q = ip(w.x, w.y), r = mode.t === 'super' ? 3 : 9;
      ctx.strokeStyle = mode.t === 'super' ? 'rgba(255,90,50,.9)' : 'rgba(255,230,120,.9)'; ctx.lineWidth = 2; ctx.setLineDash([8, 6]); ctx.lineDashOffset = -G.time * 30;
      ctx.beginPath(); ctx.ellipse(q[0], q[1], r * 45.25, r * 22.63, 0, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    }
    // screen-space overlays
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (ui.box) {
      const b = ui.box;
      ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.lineWidth = 1; ctx.fillStyle = 'rgba(255,255,255,.08)';
      ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); ctx.strokeRect(b.x0 + 0.5, b.y0 + 0.5, b.x1 - b.x0, b.y1 - b.y0);
    }
  }

  // ---- minimap ------------------------------------------------------------
  const MM_COL = { [T_GRASS]: [86, 132, 60], [T_SAND]: [198, 181, 128], [T_DIRT]: [148, 124, 84], [T_WATER]: [44, 105, 152], [T_FOREST]: [42, 84, 40], [T_ROCK]: [120, 112, 100] };
  function mmXY(cv, u, v) { const n = G.map.n; return [(u - v) * cv.width / (2 * n) + cv.width / 2, (u + v) * cv.height / (2 * n)]; }
  function mmInv(cv, mx, my) { const n = G.map.n, a = (mx - cv.width / 2) / (cv.width / (2 * n)), b = my / (cv.height / (2 * n)); return { x: (a + b) / 2, y: (b - a) / 2 }; }

  function minimap(cv, online) {
    const ctx = cv.getContext('2d'), m = G.map, n = m.n, w = cv.width, h = cv.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0a0d10'; ctx.fillRect(0, 0, w, h);
    if (!online) {
      ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 1;
      for (let i = -h; i < w; i += 9) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + h, h); ctx.stroke(); }
      return;
    }
    if (!mmBase || G.time - mmBaseT > 1.5 || G.time < mmBaseT) {
      if (!mmBase) { mmBase = document.createElement('canvas'); mmBase.width = mmBase.height = n; }
      const c2 = mmBase.getContext('2d'), img = c2.createImageData(n, n), d = img.data;
      for (let i = 0; i < n * n; i++) {
        let c = MM_COL[m.terrain[i]];
        if (m.gold[i] > 0) c = m.goldKind[i] === 2 ? [240, 140, 50] : [236, 196, 60];
        d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = 255;
      }
      c2.putImageData(img, 0, 0); mmBaseT = G.time;
    }
    const sx = w / (2 * n), sy = h / (2 * n);
    ctx.setTransform(sx, sy, -sx, sy, w / 2, 0);
    ctx.imageSmoothingEnabled = false; ctx.drawImage(mmBase, 0, 0);
    for (const e of G.ents) {
      if (e.dead) continue;
      const i = clamp(Math.floor(e.y), 0, n - 1) * n + clamp(Math.floor(e.x), 0, n - 1);
      if (e.owner !== G.human && (e.kind === 'u' ? !G.vis[i] : !G.explored[i])) continue;
      ctx.fillStyle = e.owner === G.human ? G.players[e.owner].col.light : G.players[e.owner].col.main;
      if (e.kind === 'b') ctx.fillRect(e.tx, e.ty, e.w, e.h); else ctx.fillRect(e.x - 0.7, e.y - 0.7, 1.4, 1.4);
    }
    ctx.imageSmoothingEnabled = true; if (fogC) ctx.drawImage(fogC, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // view frustum
    const cs = [s2w(0, 0), s2w(View.W, 0), s2w(View.W, View.H), s2w(0, View.H)].map(p => mmXY(cv, p.x, p.y));
    ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 1.5; ctx.beginPath();
    cs.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath(); ctx.stroke();
    for (const pg of G.pings) {
      const k = ((G.time - pg.t) % 1), q = mmXY(cv, pg.x, pg.y);
      ctx.strokeStyle = pg.kind === 'bad' ? `rgba(255,70,50,${1 - k})` : `rgba(255,230,120,${1 - k})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(q[0], q[1], 3 + k * 12, 0, 7); ctx.stroke();
    }
  }

  return { draw, minimap, mmInv, reset() { fogC = null; mmBase = null; mmBaseT = -99; } };
})();
