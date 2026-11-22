// Road, highway, ramp and rail tools: drawing modes (straight, curve, freeform) with angle
// snapping, reshaping existing roads by dragging handles, upgrading a road's type in place,
// and zoning both sides of a street in one go. Mixed into SG.UI.
'use strict';

(function () {
  const P = SG.UI.prototype;
  const DEG = Math.PI / 180;

  P.roadType = function () { return SG.ROAD_TYPES[(this.tool || '').slice(5)] || SG.ROAD_TYPES.street; };
  P.screenTol = function (px) { return px / Math.max(0.05, this.r.scale); };

  // ---------- geometry ----------
  // pts for a list of control points [x, y, road?, end?] in a drawing mode
  P.buildCurve = function (ctrl, mode) {
    const Q = ctrl.map(p => [p[0], p[1]]);
    if (Q.length < 2) return Q.flat();
    if (mode === 'free') return this.roadCurve(ctrl);
    if (mode === 'curve') { // start, then (control, end) pairs: quadratic Béziers
      const out = [Q[0][0], Q[0][1]];
      let a = Q[0];
      for (let i = 1; i < Q.length; i += 2) {
        const c = Q[i], b = Q[i + 1];
        if (!b) { out.push(c[0], c[1]); break; } // a trailing control point acts as the end
        const n = Math.max(4, Math.ceil((Math.hypot(c[0] - a[0], c[1] - a[1]) + Math.hypot(b[0] - c[0], b[1] - c[1])) / 10));
        for (let k = 1; k <= n; k++) {
          const t = k / n, u = 1 - t;
          out.push(u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]);
        }
        a = b;
      }
      return out;
    }
    return Q.flat(); // straight: a polyline through the points
  };
  // direction of a road near (x, y)
  P.roadDirAt = function (road, x, y) {
    const p = road.pts; let best = Infinity, ang = 0;
    for (let i = 2; i < p.length; i += 2) {
      const d = SG.World.segDist2(x, y, p[i - 2], p[i - 1], p[i], p[i + 1]);
      if (d < best) { best = d; ang = Math.atan2(p[i + 1] - p[i - 1], p[i] - p[i - 2]); }
    }
    return ang;
  };
  // keep the new segment at a multiple of 15° from the previous segment (or the road it starts on)
  P.snapAngle = function (p) {
    const pts = this.roadPts;
    if (!this.angleSnap || !pts || !pts.length || p[2]) return p;
    const a = pts[pts.length - 1];
    let ref = 0;
    if (pts.length >= 2) { const b = pts[pts.length - 2]; ref = Math.atan2(a[1] - b[1], a[0] - b[0]); }
    else if (a[2]) ref = this.roadDirAt(a[2], a[0], a[1]);
    const dx = p[0] - a[0], dy = p[1] - a[1], L = Math.hypot(dx, dy);
    if (L < 1) return p;
    const ang = Math.atan2(dy, dx), step = 15 * DEG;
    const snapped = ref + Math.round((ang - ref) / step) * step;
    return [a[0] + Math.cos(snapped) * L, a[1] + Math.sin(snapped) * L, null, false, Math.round(((snapped - ref) / DEG % 360 + 540) % 360 - 180)];
  };

  // ---------- drawing ----------
  P.roadDown = function (x, y) {
    const t = this.roadType();
    let p = this.snapRoad(x, y);
    if (!this.roadPts) {
      this.roadPts = [p]; this.roadKey = t.key; this.roadDownAt = [x, y];
      this.roadPreview(x, y); this.renderToolOpts(); return;
    }
    p = this.snapAngle(p);
    const last = this.roadPts[this.roadPts.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) < this.screenTol(10) + 3) { this.finishRoad(); return; } // tapped the last point again
    this.roadPts.push(p);
    this.roadDownAt = null;
    const curveNeedsEnd = this.roadMode === 'curve' && this.roadPts.length % 2 === 0; // that was a control point
    if (p[2] && this.roadPts.length >= 2 && !curveNeedsEnd) { this.finishRoad(); return; } // joined an existing road
    this.roadPreview(x, y); this.renderToolOpts();
  };
  P.roadUp = function (x, y) {
    // on a desktop a single press-drag-release draws a straight road
    if (this.roadPts && this.roadPts.length === 1 && this.roadDownAt) {
      const d = Math.hypot(x - this.roadDownAt[0], y - this.roadDownAt[1]);
      if (d > this.screenTol(20)) { this.roadPts.push(this.snapAngle(this.snapRoad(x, y))); this.finishRoad(); }
    }
    this.roadDownAt = null;
  };
  P.undoPoint = function () {
    if (!this.roadPts) return;
    this.roadPts.pop();
    if (!this.roadPts.length) this.roadPts = null;
    const c = this.lastCursor || [0, 0];
    this.roadPreview(c[0], c[1]); this.renderToolOpts();
  };
  P.cancelRoad = function () { this.roadPts = null; this.r.ghost = null; this.r.dirty = true; this.renderToolOpts(); };
  P.roadLength = function (pts) { let L = 0; for (let i = 2; i < pts.length; i += 2) L += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]); return L; };
  // buildings a road of width wM would run through (ignoring ones already inside `except`)
  P.roadVictims = function (pts, wM, exceptPts, exceptW) {
    const hw = wM / 2 + 1;
    const bb = SG.World.bbox(pts), out = [];
    const near = (b, p, h) => { const r = Math.sqrt(b.area) * 0.42 + h; for (let i = 2; i < p.length; i += 2) if (SG.World.segDist2(b.cx, b.cy, p[i - 2], p[i - 1], p[i], p[i + 1]) < r * r) return true; return false; };
    for (const b of this.w.buildingsIn([bb[0] - 30, bb[1] - 30, bb[2] + 30, bb[3] + 30])) {
      if (!near(b, pts, hw)) continue;
      if (exceptPts && near(b, exceptPts, exceptW / 2 + 1)) continue;
      out.push(b);
    }
    return out;
  };
  P.buyCost = function (victims) { return victims.reduce((s, b) => s + (b.player ? 20000 : (b.units || b.jobs ? b.value * 1.6 : 20000)), 0); };
  P.roadPreview = function (x, y) {
    this.lastCursor = [x, y];
    if (!this.roadPts) { this.r.ghost = null; this.r.dirty = true; this.roadHint(); return; }
    const t = SG.ROAD_TYPES[this.roadKey], p = this.touchMode ? this.roadPts[this.roadPts.length - 1] : this.snapAngle(this.snapRoad(x, y));
    const ctrl = this.touchMode ? this.roadPts : this.roadPts.concat([p]);
    const pts = this.buildCurve(ctrl, this.roadMode);
    const len = this.roadLength(pts), victims = this.roadVictims(pts, t.w), buy = this.buyCost(victims), build = len * t.cost;
    const ok = len > 10 && this.sim.funds - build - buy > -2000000;
    this.r.ghost = { type: 'line', pts, ok, w: t.w, ctrl: ctrl.map(q => [q[0], q[1]]).flat() };
    this.r.dirty = true;
    const seg = this.roadPts.length >= 1 ? Math.hypot(p[0] - this.roadPts[this.roadPts.length - 1][0], p[1] - this.roadPts[this.roadPts.length - 1][1]) : 0;
    this.setHint(`${t.label}: ${Math.round(len)} m, ${SG.fmtMoney(build)}` +
      (victims.length ? ` + ${SG.fmtMoney(buy)} to buy ${victims.length} building${victims.length > 1 ? 's' : ''}` : '') +
      (!this.touchMode && seg > 1 ? ` · this segment ${Math.round(seg)} m${p[4] != null ? `, ${p[4]}°` : ''}` : '') +
      (p[2] ? ` · joins ${p[2].name || 'a road'}` : '') +
      (this.roadMode === 'curve' ? (this.roadPts.length % 2 === 1 ? ' · next: the bend' : ' · next: the end') : ''));
  };
  P.roadHint = function () {
    const t = this.roadType(), touch = this.touchMode;
    const how = this.roadMode === 'curve' ? `${touch ? 'Tap' : 'Click'} the start, then the bend, then the end`
      : this.roadMode === 'free' ? `${touch ? 'Tap' : 'Click'} points; the road curves smoothly through them`
      : `${touch ? 'Tap' : 'Click'} the start, then each corner`;
    this.setHint(`${t.label} ($${SG.fmtInt(t.cost)}/m): ${how}. ${touch ? 'Tap ✓ to finish.' : 'Click the last point again or press Enter to finish; Backspace undoes a point.'}` +
      (t.ramp ? ' Draw from the highway to a street for an off-ramp, from a street to the highway for an on-ramp.' : '') +
      (t.rail ? ' Then add Train Stations along it.' : ''));
  };
  P.setHint = function (msg) { const h = this.$('hint'); h.textContent = msg; h.style.display = msg ? 'block' : 'none'; };

  P.finishRoad = async function () {
    const ctrl = this.roadPts, key = this.roadKey, sim = this.sim, w = this.w, t = SG.ROAD_TYPES[key];
    this.roadPts = null; this.renderToolOpts();
    const clear = () => { this.r.ghost = null; this.r.dirty = true; this.roadHint(); };
    if (!ctrl || ctrl.length < 2) return clear();
    const pts = this.buildCurve(ctrl, this.roadMode), len = this.roadLength(pts);
    if (len < 10) return clear();
    const victims = this.roadVictims(pts, t.w).filter(b => !b.removed), buy = this.buyCost(victims), build = len * t.cost;
    if (victims.length && !(await this.ask(`Build through ${victims.length} building${victims.length > 1 ? 's' : ''}?`,
      `This ${t.label.toLowerCase()} runs through ${victims.length} building${victims.length > 1 ? 's' : ''}. The city would buy and demolish ${victims.length > 1 ? 'them' : 'it'} for ${SG.fmtMoney(buy)}, on top of ${SG.fmtMoney(build)} to build it.`, 'Build it'))) return clear();
    if (!sim.spend(build + buy, 'this ' + t.label.toLowerCase())) return clear();
    for (const b of victims) { w.removeBuilding(b); sim.construction = sim.construction.filter(x => x !== b); }
    const name = this.nameNewRoad(ctrl, t);
    const road = w.addRoad(pts, t.cls, name, { type: key, ctrl: ctrl.map(q => [q[0], q[1]]), mode: this.roadMode });
    road.built = sim.year;
    if (!t.rail && t.cls >= 1) { // lots along a new street are where developers look first
      const near = [];
      w.traceLine(road.pts, c => { for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const k = c + dy * w.W + dx; if (k >= 0 && k < w.zone.length) near.push(k); } });
      sim.markHot(near);
    }
    sim._roadsDirty = true;
    const bridges = road.el ? ' with bridges' : '';
    sim.say(`${name} opens: ${Math.round(len)} m of new ${t.label.toLowerCase()}${bridges} (${SG.fmtMoney(build + buy)}).`, true);
    this.r.ghost = null;
    this.select(road);
    this.g.onWorldChange();
    this.roadHint();
  };
  // continue the name of a same-type road it extends; ramps are named after their highway
  P.nameNewRoad = function (ctrl, t) {
    const a = ctrl[0], z = ctrl[ctrl.length - 1], w = this.w;
    if (t.ramp) {
      const hwyStart = a[2] && a[2].cls === 0 && !a[2].ramp ? a[2] : null, hwyEnd = z[2] && z[2].cls === 0 && !z[2].ramp ? z[2] : null;
      const street = (hwyStart ? z[2] : a[2]) || null;
      const hwy = hwyStart || hwyEnd;
      if (hwy && hwy.name) return `${hwy.name} ${hwyStart ? 'exit to' : 'on-ramp from'} ${street && street.name ? street.name : 'local streets'}`;
      return `${SG.roadName(w, 0, () => this.sim.rand())} ramp`;
    }
    const cont = [a, z].find(q => q[2] && q[3] && SG.roadTypeOf(q[2]).key === t.key && q[2].name);
    return cont ? cont[2].name : SG.roadName(w, t.cls, () => this.sim.rand());
  };

  // ---------- upgrade ----------
  P.upgradeTarget = function () { return SG.ROAD_TYPES[this.upgradeKey || 'avenue']; };
  P.upgradeQuote = function (road) {
    const t = this.upgradeTarget(), from = SG.roadTypeOf(road);
    if (!road || road.cls > 4 && !road.rail) return { ok: false, why: 'Pick a road' };
    if (!!t.rail !== !!road.rail) return { ok: false, why: t.rail ? 'Only rail can become rail' : 'Rail can only be rebuilt as rail' };
    if (from.key === t.key && SG.roadWidth(road) === t.w) return { ok: false, why: `${road.name || 'This road'} is already a ${t.label.toLowerCase()}` };
    const victims = this.roadVictims(road.pts, t.w, road.pts, SG.roadWidth(road)).filter(b => !b.removed);
    const build = road.len * t.cost * 0.6, buy = this.buyCost(victims);
    return { ok: true, t, from, victims, build, buy, total: build + buy };
  };
  P.upgradeAt = async function (x, y) {
    const road = this.roadAt(x, y);
    if (!road) { this.sim.say('Pick a road to upgrade.'); return; }
    const q = this.upgradeQuote(road);
    if (!q.ok) { this.sim.say(q.why + '.'); return; }
    const verb = SG.ROAD_TYPE_ORDER.indexOf(q.t.key) < SG.ROAD_TYPE_ORDER.indexOf(q.from.key) ? 'Upgrade' : 'Change';
    if (!(await this.ask(`${verb} ${road.name || 'this road'} to a ${q.t.label.toLowerCase()}?`,
      `This ${Math.round(road.len)} m segment becomes a ${q.t.label.toLowerCase()} for ${SG.fmtMoney(q.build)}` +
      (q.victims.length ? `, and the wider road needs ${q.victims.length} building${q.victims.length > 1 ? 's' : ''} bought out for ${SG.fmtMoney(q.buy)}.` : '.'), verb))) return;
    if (!this.sim.spend(q.total, 'the upgrade')) return;
    for (const b of q.victims) { this.w.removeBuilding(b); this.sim.construction = this.sim.construction.filter(c => c !== b); }
    this.w.editRoad(road, { cls: q.t.cls, w: q.t.w, oneway: !!q.t.oneway, ramp: !!q.t.ramp, rail: !!q.t.rail, divided: !!q.t.divided });
    this.sim._roadsDirty = true;
    this.sim.say(`${road.name || 'Road'} is now a ${q.t.label.toLowerCase()} (${SG.fmtMoney(q.total)}).`, true);
    this.select(road);
    this.g.onWorldChange();
  };

  // ---------- reshape ----------
  // handles: a player road's own control points, or a simplified outline of a mapped road
  P.handlesFor = function (road) {
    if (road.ctrl && road.ctrl.length >= 2) return road.ctrl.map(q => [q[0], q[1]]);
    const pts = [];
    for (let i = 0; i < road.pts.length; i += 2) pts.push([road.pts[i], road.pts[i + 1]]);
    let tol = 2, out = pts;
    while (out.length > 14 && tol < 200) { out = simplify(pts, tol); tol *= 1.6; }
    return out;
  };
  P.startReshape = function (road) {
    if (!road || (road.cls > 4 && !road.rail)) { this.reshape = null; this.renderToolOpts(); return; }
    this.reshape = { road, handles: this.handlesFor(road), drag: -1, sel: -1, mode: road.mode || (road.ctrl ? 'free' : 'straight') };
    if (this.reshape.mode === 'curve') this.reshape.mode = 'free';
    this.r.selected = road;
    this.reshapeGhost();
    this.renderToolOpts();
    this.setHint(`Reshaping ${road.name || 'a road'}: drag the white handles. ${this.touchMode ? 'Tap' : 'Click'} the road to add a handle.`);
  };
  P.reshapeGhost = function (pts) {
    const s = this.reshape;
    if (!s) { this.r.ghost = null; this.r.dirty = true; return; }
    this.r.ghost = { type: 'line', pts: pts || Array.from(s.road.pts), ok: true, w: SG.roadWidth(s.road), ctrl: s.handles.flat(), sel: s.sel };
    this.r.dirty = true; this.r.hudDirty = true;
  };
  P.handleAt = function (sx, sy) {
    const s = this.reshape; if (!s) return -1;
    const rad = this.touchMode ? 26 : 13;
    let best = -1, bd = rad;
    s.handles.forEach((h, i) => {
      const q = this.r.toScreen(h[0], h[1]);
      const d = Math.hypot(q[0] - sx, q[1] - sy);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  };
  // pointer went down with the reshape tool: grab a handle if one is under it
  P.reshapeDown = function (sx, sy) {
    const i = this.handleAt(sx, sy);
    if (i < 0) return false;
    this.reshape.drag = i; this.reshape.sel = i;
    this.reshape.before = { pts: this.reshape.road.pts, ctrl: this.reshape.road.ctrl, handles: this.reshape.handles.map(h => h.slice()) };
    this.renderToolOpts();
    return true;
  };
  P.reshapeMove = function (x, y) {
    const s = this.reshape; if (!s || s.drag < 0) return;
    const end = s.drag === 0 || s.drag === s.handles.length - 1;
    let p = [x, y];
    if (end) { const q = this.snapRoad(x, y); if (q[2] && q[2] !== s.road) p = [q[0], q[1]]; }
    s.handles[s.drag] = p;
    const pts = this.buildCurve(s.handles, s.mode);
    this.reshapeGhost(pts);
    const t = SG.roadTypeOf(s.road), victims = this.roadVictims(pts, SG.roadWidth(s.road), Array.from(s.road.pts), SG.roadWidth(s.road));
    this.setHint(`${s.road.name || 'Road'}: ${Math.round(this.roadLength(pts))} m` + (victims.length ? ` · would buy ${victims.length} building${victims.length > 1 ? 's' : ''}` : '') + ` · ${t.label}`);
  };
  P.reshapeUp = async function () {
    const s = this.reshape; if (!s || s.drag < 0) return;
    s.drag = -1;
    const road = s.road, pts = this.buildCurve(s.handles, s.mode), W = SG.roadWidth(road);
    const moved = s.handles.some((h, i) => Math.hypot(h[0] - s.before.handles[i][0], h[1] - s.before.handles[i][1]) > 0.5);
    if (!moved) { this.reshapeGhost(); return; }
    const victims = this.roadVictims(pts, W, Array.from(road.pts), W).filter(b => !b.removed);
    const t = SG.roadTypeOf(road), buy = this.buyCost(victims);
    const build = Math.abs(this.roadLength(pts) - road.len) * t.cost + road.len * t.cost * 0.25;
    if (victims.length && !(await this.ask(`Reshape through ${victims.length} building${victims.length > 1 ? 's' : ''}?`,
      `The new shape runs through ${victims.length} building${victims.length > 1 ? 's' : ''}; the city would buy ${victims.length > 1 ? 'them' : 'it'} for ${SG.fmtMoney(buy)}, plus ${SG.fmtMoney(build)} for the roadwork.`, 'Reshape'))) {
      s.handles = s.before.handles; this.reshapeGhost(); return;
    }
    if (!this.sim.spend(build + buy, 'the roadwork')) { s.handles = s.before.handles; this.reshapeGhost(); return; }
    for (const b of victims) { this.w.removeBuilding(b); this.sim.construction = this.sim.construction.filter(c => c !== b); }
    this.reshapeUndo = { road, pts: s.before.pts, ctrl: s.before.ctrl, refund: build };
    this.w.editRoad(road, { pts, ctrl: s.handles.map(h => h.slice()), mode: s.mode });
    this.sim._roadsDirty = true;
    this.sim.say(`${road.name || 'Road'} reshaped (${SG.fmtMoney(build + buy)}).`);
    this.g.onWorldChange();
    this.reshapeGhost(); this.renderToolOpts();
  };
  // click/tap with the reshape tool, not on a handle: pick a road, or add a handle to the one being shaped
  P.reshapeTap = function (x, y) {
    const s = this.reshape, road = this.roadAt(x, y);
    if (s && road === s.road) {
      // insert a handle at the closest place between two handles
      const H = s.handles; let bi = 1, bd = Infinity;
      for (let i = 1; i < H.length; i++) { const d = SG.World.segDist2(x, y, H[i - 1][0], H[i - 1][1], H[i][0], H[i][1]); if (d < bd) { bd = d; bi = i; } }
      H.splice(bi, 0, [x, y]); s.sel = bi;
      if (s.mode === 'straight' && H.length > 2) s.mode = 'free';
      this.reshapeGhost(); this.renderToolOpts();
      return;
    }
    this.startReshape(road);
  };
  P.removeHandle = function () {
    const s = this.reshape; if (!s || s.sel < 0 || s.handles.length <= 2) return;
    s.before = { pts: s.road.pts, ctrl: s.road.ctrl, handles: s.handles.map(h => h.slice()) };
    s.handles.splice(s.sel, 1); s.sel = -1; s.drag = 0;
    s.drag = 0; // apply through the normal path
    this.reshapeUp();
  };
  P.undoReshape = function () {
    const u = this.reshapeUndo; if (!u) return;
    this.reshapeUndo = null;
    this.w.editRoad(u.road, { pts: Array.from(u.pts), ctrl: u.ctrl, mode: u.road.mode });
    this.sim.funds += u.refund;
    this.sim.say(`Undid the reshape of ${u.road.name || 'the road'}.`);
    this.g.onWorldChange();
    if (this.reshape && this.reshape.road === u.road) this.startReshape(u.road);
  };

  // ---------- zoning along a street ----------
  P.zoneAlong = function (x, y) {
    const road = this.roadAt(x, y), w = this.w, zid = +this.tool.slice(5);
    if (!road || road.cls > 3 || road.rail) { this.sim.say('Pick a street to zone along.'); return; }
    const depth = this.alongDepth || 2, cells = new Set();
    w.traceLine(road.pts, c => {
      const cx = c % w.W, cy = (c / w.W) | 0;
      for (let dy = -depth; dy <= depth; dy++) for (let dx = -depth; dx <= depth; dx++) {
        const X = cx + dx, Y = cy + dy;
        if (X < 0 || Y < 0 || X >= w.W || Y >= w.H) continue;
        const i = Y * w.W + X;
        if (!w.roadMask[i]) cells.add(i);
      }
    });
    let changed = 0;
    for (const i of cells) {
      if (w.zone[i] === zid && w.inCity[i]) continue;
      if (!w.inCity[i] && w.annexCells([i])) this.annexed = (this.annexed || 0) + 1;
      w.zone[i] = zid; changed++;
    }
    if (!changed) { this.sim.say(`${road.name || 'That street'} is already zoned ${SG.ZONES[zid].code}.`); return; }
    this.sim.markHot([...cells]);
    this.zoneChanges = (this.zoneChanges || 0) + changed;
    this.sim.funds -= changed * 400 + (this.annexed || 0) * 2500;
    this.flushZoneNews(zid);
    this.r.zoneDirty = true;
    this.g.onWorldChange();
  };

  // ---------- options bar under the hint ----------
  P.renderToolOpts = function () {
    const el = this.$('toolopts'); if (!el) return;
    const t = this.tool || '', btn = (id, label, on, title) => `<button data-opt="${id}" class="${on ? 'on' : ''}" title="${esc(title || label)}">${label}</button>`;
    let h = '';
    if (t.startsWith('road:')) {
      h += `<span class="grp">${btn('mode:straight', '📏 Straight', this.roadMode === 'straight', 'Straight segments between your points')}${btn('mode:curve', '⤴ Curve', this.roadMode === 'curve', 'Start, bend, end: a smooth curve')}${btn('mode:free', '〰 Free', this.roadMode === 'free', 'Freeform: curves smoothly through every point')}</span>`;
      h += `<span class="grp">${btn('snap', '📐 15°', this.angleSnap, 'Snap angles to 15° steps')}</span>`;
      if (this.roadPts) h += `<span class="grp">${btn('undo', '↶ Undo', false, 'Remove the last point (Backspace)')}${btn('done', '✓ Done', false, 'Finish the road (Enter)')}${btn('cancel', '✕', false, 'Cancel (Esc)')}</span>`;
    } else if (t === 'upgrade') {
      h += `<span class="grp">${SG.ROAD_TYPE_ORDER.map(k => btn('up:' + k, SG.ROAD_TYPES[k].icon + ' ' + SG.ROAD_TYPES[k].label, (this.upgradeKey || 'avenue') === k)).join('')}</span>`;
    } else if (t === 'reshape') {
      if (this.reshape) h += `<span class="grp">${this.reshape.sel >= 0 && this.reshape.handles.length > 2 ? btn('rmhandle', '⌫ Remove handle') : ''}${btn('rsdone', '✓ Done')}</span>`;
      if (this.reshapeUndo) h += `<span class="grp">${btn('rsundo', '↶ Undo reshape')}</span>`;
    } else if (t.startsWith('zone:')) {
      h += `<span class="grp">${btn('zmode:brush', '🖌 Brush', this.zoneMode !== 'along')}${btn('zmode:along', '🛣 Along street', this.zoneMode === 'along', 'Tap a street to zone both sides of it')}</span>`;
      if (this.zoneMode !== 'along') h += `<span class="grp">${btn('brush:-', '−')}<span class="lbl">${(this.brush * 2 + 1) * SG.CELL} m</span>${btn('brush:+', '+')}</span>`;
    }
    if (this.armed) h += `<span class="grp">${btn('confirm', '✓ ' + (this.armed.label || 'Build here'))}${btn('disarm', '✕')}</span>`;
    el.innerHTML = h;
    el.style.display = h ? 'flex' : 'none';
    el.querySelectorAll('[data-opt]').forEach(b => b.onclick = e => { e.stopPropagation(); this.toolOpt(b.dataset.opt); });
  };
  P.toolOpt = function (o) {
    if (o.startsWith('mode:')) { this.roadMode = o.slice(5); if (this.roadPts && this.roadMode === 'curve' && this.roadPts.length > 1) this.roadPts.length = 1; this.roadHint(); }
    else if (o === 'snap') this.angleSnap = !this.angleSnap;
    else if (o === 'undo') this.undoPoint();
    else if (o === 'done') this.finishRoad();
    else if (o === 'cancel') this.cancelRoad();
    else if (o.startsWith('up:')) { this.upgradeKey = o.slice(3); this.setHint(`Upgrade: ${this.touchMode ? 'tap' : 'click'} a road to turn it into a ${this.upgradeTarget().label.toLowerCase()}.`); }
    else if (o === 'rmhandle') this.removeHandle();
    else if (o === 'rsdone') { this.reshape = null; this.r.selected = null; this.r.ghost = null; this.r.dirty = true; }
    else if (o === 'rsundo') this.undoReshape();
    else if (o.startsWith('zmode:')) this.zoneMode = o.slice(6);
    else if (o === 'brush:-') this.brush = Math.max(0, this.brush - 1);
    else if (o === 'brush:+') this.brush = Math.min(12, this.brush + 1);
    else if (o === 'confirm') this.fireArmed();
    else if (o === 'disarm') this.disarm();
    try { localStorage.setItem('simsaratoga.roadopts', JSON.stringify({ m: this.roadMode, s: this.angleSnap })); } catch (e) { /* ignore */ }
    this.renderToolOpts();
  };

  // ---------- touch: tap to preview, tap again (or ✓) to act ----------
  P.tapTool = function () {
    const t = this.tool || '';
    return t.startsWith('road:') || t.startsWith('build:') || t === 'bulldoze' || t === 'upgrade' || (t.startsWith('zone:') && this.zoneMode === 'along');
  };
  P.tap = function (x, y, sx, sy) {
    const t = this.tool;
    if (t.startsWith('road:')) { this.roadDown(x, y); return; }
    if (t.startsWith('zone:')) { this.zoneAlong(x, y); return; }
    // build, bulldoze, upgrade: first tap previews, a second tap on the same spot confirms
    const a = this.armed;
    if (a && a.tool === t && Math.hypot(sx - a.sx, sy - a.sy) < 40) { this.fireArmed(); return; }
    this.armed = { tool: t, x, y, sx, sy, label: t === 'bulldoze' ? 'Demolish' : t === 'upgrade' ? 'Upgrade' : 'Build here' };
    this.toolHover(x, y);
    if (t === 'upgrade') this.upgradeHover(x, y);
    this.renderToolOpts();
  };
  P.fireArmed = function () {
    const a = this.armed; if (!a) return;
    this.armed = null; this.renderToolOpts();
    if (a.tool.startsWith('build:')) this.placeBuild(a.tool.slice(6), a.x, a.y);
    else if (a.tool === 'bulldoze') this.bulldozeAt(a.x, a.y);
    else if (a.tool === 'upgrade') this.upgradeAt(a.x, a.y);
  };
  P.disarm = function () { this.armed = null; this.r.ghost = null; this.r.selected = null; this.r.dirty = true; this.renderToolOpts(); };
  P.upgradeHover = function (x, y) {
    const road = this.roadAt(x, y);
    this.r.selected = road; this.r.ghost = null; this.r.dirty = true;
    if (!road) { this.setHint(`Upgrade: ${this.touchMode ? 'tap' : 'click'} a road to turn it into a ${this.upgradeTarget().label.toLowerCase()}.`); return; }
    const q = this.upgradeQuote(road);
    this.setHint(q.ok ? `${road.name || 'Road'} → ${q.t.label}: ${SG.fmtMoney(q.total)}${q.victims.length ? ` (buys ${q.victims.length} building${q.victims.length > 1 ? 's' : ''})` : ''}` : q.why);
  };

  // Ramer–Douglas–Peucker
  function simplify(pts, tol) {
    if (pts.length < 3) return pts;
    let idx = -1, md = 0;
    const [a, b] = [pts[0], pts[pts.length - 1]];
    for (let i = 1; i < pts.length - 1; i++) { const d = Math.sqrt(SG.World.segDist2(pts[i][0], pts[i][1], a[0], a[1], b[0], b[1])); if (d > md) { md = d; idx = i; } }
    if (md <= tol) return [a, b];
    return simplify(pts.slice(0, idx + 1), tol).slice(0, -1).concat(simplify(pts.slice(idx), tol));
  }
})();
