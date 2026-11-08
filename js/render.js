// Canvas renderer: real building footprints, streets, parks and creeks, plus planning overlays.
'use strict';

SG.AREA_COLORS = {
  park: '#9cc77f', golf: '#a6d28a', sports: '#a9cf8d', forest: '#6f9a5c', grass: '#b3cf8f', orchard: '#b8c97c',
  water: '#7fb6dd', pool: '#7fc6e6', residential: null, commercial: '#e3d9cf', cemetery: '#a8c296', campus: '#e6e0d0',
  parking: '#d7d2c8', civic: '#e4ddd0', utility: '#d4cfc6',
};
SG.ROAD_STYLE = [
  // [width m, min px, fill, casing]
  [24, 3.2, '#f7c66b', '#a7804a'],  // freeway (Hwy 85)
  [16, 2.4, '#fbe3a0', '#a99a73'],  // arterial
  [12, 1.8, '#ffffff', '#a9a49a'],  // collector
  [9, 1.2, '#ffffff', '#b3aea3'],   // residential
  [6, 0.7, '#f4f1ea', '#c4bfb4'],   // service/driveway
  [3, 0.5, '#d9cfb3', null],        // track
  [2, 0.5, '#c9b68e', null],        // path
];

SG.Renderer = class Renderer {
  constructor(canvas, world, sim) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.w = world; this.sim = sim;
    this.scale = 0.12; this.cx = 0; this.cy = 0;
    this.overlay = 'none';
    this.dirty = true; this.zoneDirty = true;
    this.ghost = null;
    this.resize();
    this.fit();
  }
  setSim(sim) { this.sim = sim; this.dirty = this.zoneDirty = true; }
  resize() {
    const r = this.cv.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.cv.width = Math.max(1, Math.round(r.width * this.dpr));
    this.cv.height = Math.max(1, Math.round(r.height * this.dpr));
    this.vw = r.width; this.vh = r.height;
    this.dirty = true;
  }
  fit() {
    const xs = this.w.boundary.flatMap(r => Array.from(r.filter((_, i) => i % 2 === 0)));
    const ys = this.w.boundary.flatMap(r => Array.from(r.filter((_, i) => i % 2 === 1)));
    const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
    this.cx = (minx + maxx) / 2; this.cy = (miny + maxy) / 2;
    this.scale = Math.min(this.vw / (maxx - minx), this.vh / (maxy - miny)) * 0.95;
    this.minScale = this.scale * 0.5;
    this.dirty = true;
  }
  toScreen(x, y) { return [(x - this.cx) * this.scale + this.vw / 2, (y - this.cy) * this.scale + this.vh / 2]; }
  toWorld(sx, sy) { return [(sx - this.vw / 2) / this.scale + this.cx, (sy - this.vh / 2) / this.scale + this.cy]; }
  zoomAt(sx, sy, f) {
    const [wx, wy] = this.toWorld(sx, sy);
    this.scale = Math.max(this.minScale, Math.min(12, this.scale * f));
    this.cx = wx - (sx - this.vw / 2) / this.scale;
    this.cy = wy - (sy - this.vh / 2) / this.scale;
    this.dirty = true;
  }
  pan(dx, dy) { this.cx -= dx / this.scale; this.cy -= dy / this.scale; this.dirty = true; }
  viewBB() { const [a, b] = this.toWorld(0, 0), [c, d] = this.toWorld(this.vw, this.vh); return [a, b, c, d]; }

  path(p, close = true) {
    const ctx = this.ctx, s = this.scale, ox = this.vw / 2 - this.cx * s, oy = this.vh / 2 - this.cy * s;
    ctx.moveTo(p[0] * s + ox, p[1] * s + oy);
    for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i] * s + ox, p[i + 1] * s + oy);
    if (close) ctx.closePath();
  }

  // ---- offscreen grid layers (one pixel per zoning cell) ----
  gridCanvas(fill) {
    const w = this.w;
    const c = this._grid || (this._grid = document.createElement('canvas'));
    c.width = w.W; c.height = w.H;
    const g = c.getContext('2d');
    const img = g.createImageData(w.W, w.H);
    fill(img.data);
    g.putImageData(img, 0, 0);
    return c;
  }
  buildOverlay() {
    const w = this.w, N = w.W * w.H, mode = this.overlay;
    const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
    const zc = SG.ZONES.map(z => z.color ? hex(z.color) : null);
    this.overlayCanvas = this.gridCanvas(d => {
      for (let i = 0; i < N; i++) {
        if (!w.inCity[i]) continue;
        let rgb = null, a = 0;
        if (mode === 'zoning') { rgb = zc[w.zone[i]]; a = 150; }
        else if (mode === 'vacant') {
          const z = w.zone[i];
          if (w.claim[i] === -1 && z >= 1 && z <= 9 && w.roadDist[i] >= 1 && w.roadDist[i] <= 2) { rgb = [255, 140, 40]; a = 190; }
        } else if (mode === 'access') {
          const t = Math.min(1, w.roadDist[i] / 12);
          rgb = [Math.round(80 + 175 * t), Math.round(200 - 140 * t), 80]; a = 120;
        } else if (mode === 'fire') {
          const [x, y] = w.cellCenter(i);
          let cov = 0;
          for (const s of this.sim.services) if (s.service === 'fire' && Math.hypot(s.x - x, s.y - y) < s.radius) cov = 1;
          const hills = w.zone[i] === SG.Z.HR || w.zone[i] === SG.Z.OS || w.zone[i] === SG.Z.R_1_40_000;
          rgb = cov ? [80, 170, 240] : hills ? [230, 90, 60] : [240, 200, 90]; a = 110;
        }
        if (rgb) { d[4 * i] = rgb[0]; d[4 * i + 1] = rgb[1]; d[4 * i + 2] = rgb[2]; d[4 * i + 3] = a; }
      }
    });
    this.zoneDirty = false;
  }

  draw() {
    if (!this.dirty) return;
    this.dirty = false;
    const ctx = this.ctx, w = this.w, s = this.scale;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#9fb88c'; // surrounding hills and towns
    ctx.fillRect(0, 0, this.vw, this.vh);
    const vb = this.viewBB();

    // city land
    ctx.beginPath();
    for (const r of w.boundary) this.path(r);
    ctx.fillStyle = '#e9e5d3';
    ctx.fill('evenodd');

    // areas
    for (const a of w.areas) {
      if (a.removed) continue;
      const col = SG.AREA_COLORS[a.kind];
      if (!col) continue;
      if (!a.bb) a.bb = SG.World.bbox(a.pts);
      if (a.bb[2] < vb[0] || a.bb[0] > vb[2] || a.bb[3] < vb[1] || a.bb[1] > vb[3]) continue;
      ctx.beginPath(); this.path(a.pts); ctx.fillStyle = col; ctx.fill();
    }
    // creeks
    ctx.strokeStyle = '#6ea8d6'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1, 4 * s);
    ctx.beginPath();
    for (const wt of w.water) this.path(wt.pts, false);
    ctx.stroke();

    // overlay under buildings
    if (this.overlay !== 'none') {
      if (this.zoneDirty || !this.overlayCanvas) this.buildOverlay();
      const [sx, sy] = this.toScreen(w.x0, w.y0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.overlayCanvas, sx, sy, w.W * SG.CELL * s, w.H * SG.CELL * s);
      ctx.imageSmoothingEnabled = true;
    }

    // roads: casing pass then fill pass, minor to major
    const roads = s < 0.25 ? w.roads.filter(r => !r.removed && r.cls <= 3) : w.roadsIn(vb);
    const byCls = [[], [], [], [], [], [], []];
    for (const r of roads) if (!r.removed) byCls[r.cls].push(r);
    for (let pass = 0; pass < 2; pass++) {
      for (let c = 6; c >= 0; c--) {
        if (c >= 4 && s < 0.6) continue;
        const [wm, minPx, fill, casing] = SG.ROAD_STYLE[c];
        const lw = Math.max(minPx, wm * s);
        if (pass === 0 && !casing) continue;
        if (pass === 0 && lw < 2) continue;
        ctx.strokeStyle = pass === 0 ? casing : (s < 0.3 && c >= 2 ? '#fffdf7' : fill);
        ctx.lineWidth = pass === 0 ? lw + Math.max(1, 1.5 * s) : lw;
        if (c >= 5) ctx.setLineDash(pass ? [Math.max(2, 3 * s), Math.max(2, 2 * s)] : []);
        ctx.beginPath();
        for (const r of byCls[c]) this.path(r.pts, false);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // buildings
    const blds = s < 0.2 ? w.buildings : w.buildingsIn(vb);
    const shadow = s > 0.5;
    if (shadow) {
      ctx.fillStyle = 'rgba(40,45,35,0.22)';
      const sh = 1.6 * s;
      ctx.beginPath();
      for (const b of blds) {
        if (b.removed) continue;
        const off = sh * Math.min(4, b.levels || 1);
        ctx.save(); ctx.translate(off, off); this.path(b.pts); ctx.restore();
      }
      ctx.fill();
    }
    if (s < 0.2) {
      // cheap dots when zoomed far out
      for (const b of blds) {
        if (b.removed) continue;
        const [x, y] = this.toScreen(b.cx, b.cy);
        const k = SG.KIND[b.kind] || SG.KIND.other;
        ctx.fillStyle = k.roof;
        const r = Math.max(1, Math.sqrt(b.area) * s);
        ctx.fillRect(x - r / 2, y - r / 2, r, r);
      }
    } else {
      const groups = new Map();
      for (const b of blds) {
        if (b.removed) continue;
        const key = b.construction ? 'construction' : b.kind;
        let g = groups.get(key); if (!g) groups.set(key, g = []); g.push(b);
      }
      for (const [key, list] of groups) {
        const k = SG.KIND[key] || SG.KIND.other;
        ctx.beginPath();
        for (const b of list) this.path(b.pts);
        if (key === 'construction') {
          ctx.fillStyle = '#f5e7b0'; ctx.fill();
          ctx.setLineDash([3, 2]); ctx.strokeStyle = '#c28a1e'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]);
        } else {
          ctx.fillStyle = s > 1.2 ? k.roof : k.roof;
          ctx.fill();
          if (s > 0.9) { ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 0.7; ctx.stroke(); }
        }
      }
      if (s > 2) this.drawRoofRidges(blds);
    }

    // selection
    if (this.selected) {
      const sel = this.selected;
      ctx.beginPath();
      if (sel.pts) this.path(sel.pts, !sel.cls && sel.cls !== 0);
      ctx.strokeStyle = '#ff3d7f'; ctx.lineWidth = 3; ctx.stroke();
    }

    // boundary line
    ctx.beginPath();
    for (const r of w.boundary) this.path(r);
    ctx.setLineDash([8, 5]); ctx.strokeStyle = 'rgba(120,40,90,.75)'; ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]);

    this.drawLabels(vb);
    this.drawGhost();
  }

  drawRoofRidges(blds) {
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (const b of blds) {
      if (b.removed || b.pts.length !== 8 && b.pts.length > 12) continue;
      // ridge along the long axis of the bounding box
      const [a, c, d, e] = b.bb, horiz = d - a > e - c;
      const [x1, y1] = this.toScreen(horiz ? a + (d - a) * 0.2 : b.cx, horiz ? b.cy : c + (e - c) * 0.2);
      const [x2, y2] = this.toScreen(horiz ? d - (d - a) * 0.2 : b.cx, horiz ? b.cy : e - (e - c) * 0.2);
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    }
    ctx.stroke();
  }

  drawLabels(vb) {
    const ctx = this.ctx, s = this.scale, w = this.w;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const used = [];
    const free = (x, y, wd, h) => {
      for (const u of used) if (Math.abs(u[0] - x) < (u[2] + wd) / 2 && Math.abs(u[1] - y) < (u[3] + h) / 2) return false;
      used.push([x, y, wd, h]); return true;
    };
    // street names
    if (s > 0.9) {
      ctx.font = `${Math.min(13, 9 + s)}px system-ui, sans-serif`;
      const seen = new Set();
      for (const r of w.roadsIn(vb)) {
        if (!r.name || r.cls > 3 || seen.has(r.name)) continue;
        let best = 0, bi = 2; const p = r.pts;
        for (let i = 2; i < p.length; i += 2) { const L = Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]); if (L > best) { best = L; bi = i; } }
        const tw = ctx.measureText(r.name).width;
        if (best * s < tw + 10) continue;
        const [x1, y1] = this.toScreen(p[bi - 2], p[bi - 1]), [x2, y2] = this.toScreen(p[bi], p[bi + 1]);
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        if (mx < 0 || my < 0 || mx > this.vw || my > this.vh || !free(mx, my, tw, 14)) continue;
        seen.add(r.name);
        let ang = Math.atan2(y2 - y1, x2 - x1);
        if (ang > Math.PI / 2) ang -= Math.PI; if (ang < -Math.PI / 2) ang += Math.PI;
        ctx.save(); ctx.translate(mx, my); ctx.rotate(ang);
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.strokeText(r.name, 0, 0);
        ctx.fillStyle = '#4a4640'; ctx.fillText(r.name, 0, 0);
        ctx.restore();
      }
    }
    // places
    const big = /^(Saratoga|Hakone|Villa Montalvo|Montalvo|West Valley|Saratoga High|Mountain Winery|Saratoga Village|Congress Springs|El Quito|Wildwood|Quito)/i;
    const list = w.pois.filter(p => p.kind === 'place' || p.kind === 'suburb' || p.kind === 'neighbourhood' || big.test(p.name) ||
      ['school', 'college', 'library', 'townhall', 'park', 'museum', 'attraction', 'fire_station', 'place_of_worship', 'community_centre'].includes(p.kind));
    for (const a of w.areas) if (a.name && (a.kind === 'park' || a.kind === 'campus' || a.kind === 'golf') && !a._labelled) {
      // label named parks and campuses at their centroid
      if (!a.c) a.c = SG.World.centroid(a.pts);
      if (!a.ha) a.ha = SG.World.polyArea(a.pts) / 10000;
      list.push({ name: a.name, kind: a.kind, x: a.c[0], y: a.c[1], ha: a.ha });
    }
    list.sort((a, b) => (b.ha || 0) - (a.ha || 0));
    for (const p of list) {
      const big2 = p.kind === 'place' || p.kind === 'suburb' || p.kind === 'neighbourhood';
      if (!big2 && s < 0.35 && !(p.ha > 8)) continue;
      if (!big2 && s < 0.18) continue;
      const [x, y] = this.toScreen(p.x, p.y);
      if (x < -50 || y < -20 || x > this.vw + 50 || y > this.vh + 20) continue;
      ctx.font = big2 ? `600 ${p.name === 'Saratoga' ? 18 : 13}px system-ui, sans-serif` : `italic 11px system-ui, sans-serif`;
      const tw = ctx.measureText(p.name).width;
      if (!free(x, y, tw, 14)) continue;
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.strokeText(p.name, x, y);
      ctx.fillStyle = big2 ? '#6b2b56' : p.kind === 'park' || p.kind === 'golf' ? '#2f5a26' : '#3d3a52';
      ctx.fillText(p.name, x, y);
    }
  }

  drawGhost() {
    const g = this.ghost; if (!g) return;
    const ctx = this.ctx;
    if (g.type === 'brush') {
      const [x, y] = this.toScreen(g.x, g.y);
      ctx.beginPath(); ctx.arc(x, y, g.r * this.scale, 0, Math.PI * 2);
      ctx.fillStyle = g.color + '55'; ctx.fill(); ctx.strokeStyle = '#222'; ctx.lineWidth = 1; ctx.stroke();
    } else if (g.type === 'line') {
      ctx.beginPath(); this.path(g.pts, false);
      ctx.strokeStyle = g.ok ? 'rgba(60,140,255,.8)' : 'rgba(230,60,60,.8)'; ctx.lineWidth = Math.max(3, 9 * this.scale); ctx.lineCap = 'round'; ctx.stroke();
    } else if (g.type === 'poly') {
      ctx.beginPath(); this.path(g.pts);
      ctx.fillStyle = g.ok ? 'rgba(80,200,120,.55)' : 'rgba(230,70,60,.55)'; ctx.fill();
      ctx.strokeStyle = g.ok ? '#1f7a3e' : '#9c1f1f'; ctx.lineWidth = 2; ctx.stroke();
    }
  }

  // minimap: drawn once, then the viewport rectangle on top
  drawMinimap(mc) {
    const w = this.w, g = mc.getContext('2d');
    const W = mc.width, H = mc.height;
    if (!this._mini || this._miniDirty) {
      const c = this._mini || (this._mini = document.createElement('canvas'));
      c.width = W; c.height = H;
      const m = c.getContext('2d');
      const sx = W / (w.x1 - w.x0), sy = H / (w.y1 - w.y0), k = Math.min(sx, sy);
      this._miniK = k;
      m.fillStyle = '#9fb88c'; m.fillRect(0, 0, W, H);
      m.beginPath();
      for (const r of w.boundary) { m.moveTo((r[0] - w.x0) * k, (r[1] - w.y0) * k); for (let i = 2; i < r.length; i += 2) m.lineTo((r[i] - w.x0) * k, (r[i + 1] - w.y0) * k); m.closePath(); }
      m.fillStyle = '#e9e5d3'; m.fill();
      m.strokeStyle = '#c9b070'; m.lineWidth = 0.6; m.beginPath();
      for (const r of w.roads) if (!r.removed && r.cls <= 3) { const p = r.pts; m.moveTo((p[0] - w.x0) * k, (p[1] - w.y0) * k); for (let i = 2; i < p.length; i += 2) m.lineTo((p[i] - w.x0) * k, (p[i + 1] - w.y0) * k); }
      m.stroke();
      m.fillStyle = '#a26b52';
      for (const b of w.buildings) if (!b.removed) m.fillRect((b.cx - w.x0) * k, (b.cy - w.y0) * k, 1, 1);
      this._miniDirty = false;
    }
    g.drawImage(this._mini, 0, 0);
    const k = this._miniK, vb = this.viewBB();
    g.strokeStyle = '#ff3d7f'; g.lineWidth = 1.5;
    g.strokeRect((vb[0] - w.x0) * k, (vb[1] - w.y0) * k, (vb[2] - vb[0]) * k, (vb[3] - vb[1]) * k);
  }
  minimapToWorld(mx, my) { return [mx / this._miniK + this.w.x0, my / this._miniK + this.w.y0]; }
};
