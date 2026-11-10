'use strict';
// ---------------------------------------------------------------------------
// Ground renderer. Terrain is painted into cached screen-space chunks: every
// tile contributes a soft-edged, textured blob, layered water < sand < dirt <
// grass < forest floor so that borders blend instead of meeting on a grid.
// Water gets depth shading, shore foam and animated glints; cloud shadows
// drift over everything.
// ---------------------------------------------------------------------------
const Terrain = (() => {
  const CW = 512, CHH = 320, MAXC = 30, BW = 128, BH = 72;
  let S = 1.5, chunks = new Map(), blobs = new Map(), depth = null, shore = null, tick = 0, prime = true;
  let foam = null, glints = null, cloudPat = null, mapRef = null;
  const ORDER = [T_WATER, T_SAND, T_DIRT, T_GRASS, T_FOREST];
  const COLS = {
    [T_WATER]: ['#4a9db3', '#3a86a9', '#2d70a0', '#245e92'],
    [T_SAND]: ['#cfbc86', '#c9b57d', '#d5c390', '#c4af77'],
    [T_DIRT]: ['#8d7246', '#96794c', '#9d8253', '#a58a5b'],
    [T_GRASS]: ['#4f7c31', '#588837', '#61933c', '#6a9c43'],
    [T_FOREST]: ['#39602a', '#3f672d', '#456e31', '#3b632b'],
  };
  const hash = (x, y) => (Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) >>> 0;
  const kindOf = t => t === T_ROCK ? T_DIRT : t;

  function canvas(w, h) { const c = document.createElement('canvas'); c.width = Math.ceil(w); c.height = Math.ceil(h); return c; }

  // a tile-sized diamond with a lumpy feathered edge, used as an alpha mask
  function softDiamond(g, rng, grow, blur, lumps, fills) {
    const OFF = 6000;
    g.save();
    g.scale(S, S); g.translate(BW / 2 - OFF, BH / 2);
    g.shadowColor = '#000'; g.shadowBlur = blur * S; g.shadowOffsetX = OFF * S; g.shadowOffsetY = 0;
    g.fillStyle = '#000';
    g.beginPath();
    g.moveTo(0, -HH - grow / 2); g.lineTo(HW + grow, 0); g.lineTo(0, HH + grow / 2); g.lineTo(-HW - grow, 0); g.closePath();
    for (let i = 0; i < lumps; i++) {
      const t = rng() * 4, k = t % 1, q = Math.floor(t);
      const cs = [[0, -HH], [HW, 0], [0, HH], [-HW, 0]], a = cs[q], b = cs[(q + 1) % 4];
      const x = lerp(a[0], b[0], k) * 1.16, y = lerp(a[1], b[1], k) * 1.16, r = 5 + rng() * 8;
      g.moveTo(x + r, y); g.arc(x, y, r, 0, Math.PI * 2);
    }
    for (let i = 0; i < fills; i++) g.fill();
    g.restore();
  }

  function makeBlob(type, sh, v) {
    const c = canvas(BW * S, BH * S), g = c.getContext('2d');
    const rng = mulberry32(type * 1009 + sh * 101 + v * 13 + 7);
    softDiamond(g, rng, 10, 9, 10, 3);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = COLS[type][sh]; g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'source-atop';
    g.scale(S, S); g.translate(BW / 2, BH / 2);
    const rx = () => (rng() - 0.5) * 84, ry = () => (rng() - 0.5) * 44;
    const blotch = (n, a) => { for (let i = 0; i < n; i++) { g.fillStyle = rng() > 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,220,${a})`; g.beginPath(); g.ellipse(rx(), ry(), 6 + rng() * 12, 3 + rng() * 6, 0, 0, 7); g.fill(); } };
    g.lineCap = 'round';
    if (type === T_GRASS || type === T_FOREST) {
      blotch(7, 0.05);
      for (let i = 0; i < 46; i++) {
        const x = rx(), y = ry(), l = 1.6 + rng() * 2.2;
        g.strokeStyle = rng() > 0.45 ? 'rgba(24,52,16,.34)' : 'rgba(176,214,112,.3)'; g.lineWidth = 0.8;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rng() - 0.5) * 1.6, y - l); g.stroke();
      }
      if (type === T_FOREST) for (let i = 0; i < 14; i++) { g.fillStyle = rng() > 0.5 ? 'rgba(92,62,30,.4)' : 'rgba(20,36,14,.4)'; g.fillRect(rx(), ry(), 1.8, 1.2); }
    } else if (type === T_DIRT) {
      blotch(7, 0.06);
      for (let i = 0; i < 26; i++) { g.fillStyle = rng() > 0.5 ? 'rgba(54,36,16,.3)' : 'rgba(238,218,170,.26)'; g.beginPath(); g.ellipse(rx(), ry(), 0.7 + rng() * 1.3, 0.5 + rng() * 0.7, 0, 0, 7); g.fill(); }
      for (let i = 0; i < 4; i++) { const x = rx(), y = ry(); g.strokeStyle = 'rgba(60,40,18,.16)'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 8 + rng() * 10, y + 3 + rng() * 4); g.stroke(); }
    } else if (type === T_SAND) {
      blotch(5, 0.04);
      for (let i = 0; i < 5; i++) { const x = rx(), y = ry(); g.strokeStyle = 'rgba(255,248,214,.3)'; g.lineWidth = 0.9; g.beginPath(); g.moveTo(x - 9, y); g.quadraticCurveTo(x, y - 2.6, x + 9, y); g.stroke(); }
      for (let i = 0; i < 16; i++) { g.fillStyle = 'rgba(108,84,44,.24)'; g.fillRect(rx(), ry(), 1.1, 0.9); }
    } else {
      blotch(5, 0.035);
      for (let i = 0; i < 4; i++) { const x = rx(), y = ry(); g.strokeStyle = 'rgba(255,255,255,.07)'; g.lineWidth = 1.1; g.beginPath(); g.moveTo(x - 10, y); g.quadraticCurveTo(x, y - 2, x + 10, y); g.stroke(); }
    }
    return c;
  }
  function blob(type, sh, v) {
    const k = type * 100 + sh * 10 + v;
    let b = blobs.get(k);
    if (!b) { b = makeBlob(type, sh, v); blobs.set(k, b); }
    return b;
  }
  function makeFoam() {
    const c = canvas(BW * S, BH * S), g = c.getContext('2d');
    softDiamond(g, mulberry32(99), 15, 8, 5, 2);
    g.globalCompositeOperation = 'source-in'; g.fillStyle = '#eaf6f4'; g.fillRect(0, 0, c.width, c.height);
    return c;
  }
  function makeGlints() {
    const out = [];
    for (let v = 0; v < 3; v++) {
      const c = canvas(40, 16), g = c.getContext('2d');
      g.strokeStyle = '#fff'; g.lineWidth = 1.6; g.lineCap = 'round';
      g.beginPath(); g.moveTo(5, 9); g.quadraticCurveTo(12 + v * 3, 4, 20, 8); g.quadraticCurveTo(28 - v * 2, 12, 35, 7); g.stroke();
      out.push(c);
    }
    return out;
  }
  function makeClouds() {
    const N = 256, c = canvas(N, N), g = c.getContext('2d'), rng = mulberry32(4242);
    for (let i = 0; i < 9; i++) {
      const cx = rng() * N, cy = rng() * N;
      for (let j = 0; j < 5; j++) {
        const x = cx + (rng() - 0.5) * 60, y = cy + (rng() - 0.5) * 34, r = 20 + rng() * 26;
        for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) {
          const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
          gr.addColorStop(0, 'rgba(0,10,20,.5)'); gr.addColorStop(1, 'rgba(0,10,20,0)');
          g.fillStyle = gr; g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
        }
      }
    }
    return c;
  }

  function analyse(m) {
    const n = m.n;
    depth = new Uint8Array(n * n); shore = new Uint8Array(n * n);
    const isW = (x, y) => !m.inb(x, y) || m.terrain[y * n + x] === T_WATER;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = y * n + x;
      if (m.terrain[i] === T_WATER) {
        let d = 3;
        for (let r = 1; r <= 3 && d === 3; r++) for (let dy = -r; dy <= r && d === 3; dy++) for (let dx = -r; dx <= r; dx++) if (!isW(x + dx, y + dy)) { d = r - 1; break; }
        depth[i] = d;
      } else {
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (m.inb(x + dx, y + dy) && m.terrain[(y + dy) * n + x + dx] === T_WATER) shore[i] = 1;
      }
    }
  }

  function details(g, m, list) {
    g.lineCap = 'round';
    for (const t of list) {
      const h = hash(t.x * 7 + 3, t.y * 11 + 5), ox = ((h >> 3) % 40) - 20, oy = ((h >> 9) % 18) - 9, x = t.px + ox, y = t.py + oy;
      if (t.k === T_GRASS) {
        if (h % 5 < 2) {
          for (let i = -2; i <= 2; i++) { g.strokeStyle = i % 2 ? '#2f5a20' : '#75a84a'; g.lineWidth = 0.9; g.beginPath(); g.moveTo(x + i * 0.9, y); g.quadraticCurveTo(x + i * 1.6, y - 3, x + i * 2.2, y - 5 - (h >> (i + 4) & 1)); g.stroke(); }
        } else if (h % 19 === 0) {
          const c = ['#f4f0c8', '#f2c2d4', '#ffffff', '#f3d24e', '#c7b4f0'][(h >> 5) % 5];
          for (let i = 0; i < 4; i++) { const fx = x + ((h >> (i * 3)) % 9) - 4, fy = y + ((h >> (i * 2 + 1)) % 5) - 2; g.strokeStyle = '#3c6a26'; g.lineWidth = 0.7; g.beginPath(); g.moveTo(fx, fy + 2.4); g.lineTo(fx, fy); g.stroke(); g.fillStyle = c; g.beginPath(); g.arc(fx, fy, 1.1, 0, 7); g.fill(); }
        } else if (h % 31 === 0) {
          g.fillStyle = 'rgba(0,0,0,.2)'; g.beginPath(); g.ellipse(x + 1, y + 1, 4, 1.8, 0, 0, 7); g.fill();
          g.fillStyle = '#8d8a80'; g.beginPath(); g.moveTo(x - 3.5, y); g.lineTo(x - 1.5, y - 3.2); g.lineTo(x + 2.4, y - 2.6); g.lineTo(x + 3.6, y); g.closePath(); g.fill();
          g.fillStyle = '#b3b0a4'; g.beginPath(); g.moveTo(x - 3.5, y); g.lineTo(x - 1.5, y - 3.2); g.lineTo(x, y - 1); g.closePath(); g.fill();
        }
      } else if (t.k === T_DIRT) {
        if (h % 7 === 0) { for (let i = 0; i < 3; i++) { const px = x + ((h >> (i * 4)) % 11) - 5, py = y + ((h >> (i * 3 + 2)) % 5) - 2; g.fillStyle = 'rgba(0,0,0,.2)'; g.beginPath(); g.ellipse(px + 0.6, py + 0.5, 1.8, 1, 0, 0, 7); g.fill(); g.fillStyle = i % 2 ? '#a39a88' : '#857c6c'; g.beginPath(); g.ellipse(px, py, 1.6, 1.1, 0, 0, 7); g.fill(); } }
        else if (h % 17 === 0) { for (let i = -1; i <= 1; i++) { g.strokeStyle = '#b89f5e'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(x + i, y); g.lineTo(x + i * 2.2, y - 4.5); g.stroke(); } }
      } else if (t.k === T_SAND) {
        if (t.shore && h % 4 === 0) {
          for (let i = -1; i <= 1; i++) { g.strokeStyle = '#4f7d33'; g.lineWidth = 0.9; g.beginPath(); g.moveTo(x + i * 1.6, y); g.lineTo(x + i * 2.6, y - 8 - (i ? 0 : 3)); g.stroke(); g.fillStyle = '#6b4a26'; g.fillRect(x + i * 2.6 - 0.7, y - 10 - (i ? 0 : 3), 1.4, 2.8); }
        } else if (h % 11 === 0) { g.fillStyle = '#efe6cf'; g.beginPath(); g.ellipse(x, y, 1.5, 1, 0.4, 0, 7); g.fill(); g.fillStyle = '#b9a88a'; g.fillRect(x + 4, y + 1, 1.2, 0.9); }
      } else if (t.k === T_FOREST) {
        if (h % 3 === 0) { g.fillStyle = 'rgba(0,0,0,.2)'; g.beginPath(); g.ellipse(x + 1, y + 1, 5, 2.2, 0, 0, 7); g.fill(); for (let i = 0; i < 3; i++) { g.fillStyle = ['#2f5a24', '#3a6b2b', '#4a7f35'][i]; g.beginPath(); g.arc(x - 2 + i * 2, y - 1.6 - (i === 1 ? 1.4 : 0), 2.8 - i * 0.3, 0, 7); g.fill(); } }
        else if (h % 23 === 0) { g.fillStyle = '#e9e2d0'; g.fillRect(x - 0.4, y - 2, 0.9, 2); g.fillStyle = '#b5482e'; g.beginPath(); g.arc(x, y - 2, 1.6, Math.PI, 0); g.fill(); }
      }
    }
  }

  function buildChunk(ci, cj) {
    const m = mapRef, n = m.n, X0 = ci * CW - n * HW, Y0 = cj * CHH;
    const MX = 76, MY = 44, list = [];
    const inv = (px, py) => [(px / HW + py / HH) / 2, (py / HH - px / HW) / 2];
    const cs = [inv(X0 - MX, Y0 - MY), inv(X0 + CW + MX, Y0 - MY), inv(X0 - MX, Y0 + CHH + MY), inv(X0 + CW + MX, Y0 + CHH + MY)];
    const x0 = clamp(Math.floor(Math.min(...cs.map(c => c[0]))), 0, n - 1), x1 = clamp(Math.ceil(Math.max(...cs.map(c => c[0]))), 0, n - 1);
    const y0 = clamp(Math.floor(Math.min(...cs.map(c => c[1]))), 0, n - 1), y1 = clamp(Math.ceil(Math.max(...cs.map(c => c[1]))), 0, n - 1);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = (x - y) * HW, py = (x + y + 1) * HH;
      if (px < X0 - MX || px > X0 + CW + MX || py < Y0 - MY || py > Y0 + CHH + MY) continue;
      const i = y * n + x, k = kindOf(m.terrain[i]);
      list.push({ x, y, px, py, k, sh: k === T_WATER ? depth[i] : (m.variant[i] >> 4) & 3, v: hash(x, y) % 3, shore: shore[i] });
    }
    if (!list.length) return { empty: true, used: tick };
    const c = canvas((CW + 2) * S, (CHH + 2) * S), g = c.getContext('2d');
    g.scale(S, S); g.translate(1 - X0, 1 - Y0);
    for (const type of ORDER) {
      if (type === T_SAND) { g.globalAlpha = 0.5; for (const t of list) if (t.shore) g.drawImage(foam, t.px - BW / 2, t.py - BH / 2, BW, BH); g.globalAlpha = 1; }
      for (const t of list) if (t.k === type) g.drawImage(blob(type, t.sh, t.v), t.px - BW / 2, t.py - BH / 2, BW, BH);
    }
    details(g, m, list);
    return { c, X0, Y0, used: tick };
  }

  function ensure(m) {
    if (mapRef === m && depth) return;
    mapRef = m; chunks.clear(); analyse(m); prime = true;
    S = (window.devicePixelRatio || 1) >= 2 ? 2 : 1.5;
    if (!foam || foam.width !== Math.ceil(BW * S)) { blobs.clear(); foam = makeFoam(); }
    if (!glints) glints = makeGlints();
  }

  // L,T,R,B: visible bounds in iso pixels
  function draw(ctx, m, L, T, R, B) {
    ensure(m);
    tick++;
    const n = m.n;
    let budget = prime ? 99 : 2;
    prime = false;
    const i0 = Math.floor((L + n * HW) / CW), i1 = Math.floor((R + n * HW) / CW);
    const j0 = Math.max(0, Math.floor(T / CHH)), j1 = Math.min(Math.floor(n * TH / CHH), Math.floor(B / CHH));
    for (let j = j0; j <= j1; j++) for (let i = Math.max(0, i0); i <= Math.min(Math.floor(2 * n * HW / CW), i1); i++) {
      const key = j * 64 + i;
      let ch = chunks.get(key);
      if (!ch) { if (budget <= 0) continue; budget--; ch = buildChunk(i, j); chunks.set(key, ch); }
      ch.used = tick;
      if (!ch.empty) ctx.drawImage(ch.c, ch.X0 - 1, ch.Y0 - 1, CW + 2, CHH + 2);
    }
    if (chunks.size > MAXC) {
      let old = null, ok = -1;
      for (const [k, ch] of chunks) if (ch.used < tick && (old === null || ch.used < old)) { old = ch.used; ok = k; }
      if (ok >= 0) chunks.delete(ok);
    }
  }

  // animated glints on visible water tiles
  function drawWater(ctx, m, x0, x1, y0, y1, L, T, R, B, time, explored) {
    const n = m.n;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * n + x;
      if (m.terrain[i] !== T_WATER || !explored[i]) continue;
      const px = (x - y) * HW, py = (x + y + 1) * HH;
      if (px < L || px > R || py < T || py > B) continue;
      const h = hash(x, y), ph = time * 0.9 + (h % 628) / 100, a = Math.sin(ph);
      if (a < 0.15) continue;
      ctx.globalAlpha = (a - 0.15) * (depth[i] ? 0.34 : 0.5);
      ctx.drawImage(glints[h % 3], px - 20 + ((h >> 8) % 24) - 12 + Math.sin(ph * 0.5) * 4, py - 8 + ((h >> 4) % 12) - 6, 40, 16);
    }
    ctx.globalAlpha = 1;
  }

  function drawClouds(ctx, L, T, R, B, time) {
    if (!cloudPat) cloudPat = ctx.createPattern(makeClouds(), 'repeat');
    const sc = 6, per = 256 * sc, ox = (time * 16) % per, oy = (time * 6) % per;
    ctx.save();
    ctx.globalAlpha = 0.34;
    ctx.translate(ox, oy); ctx.scale(sc, sc);
    ctx.fillStyle = cloudPat;
    ctx.fillRect((L - ox) / sc, (T - oy) / sc, (R - L) / sc, (B - T) / sc);
    ctx.restore();
  }

  return { draw, drawWater, drawClouds, reset() { mapRef = null; chunks.clear(); depth = null; } };
})();
