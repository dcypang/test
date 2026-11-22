// Tools, input handling and side panels.
'use strict';

SG.UI = class UI {
  constructor(game) {
    this.g = game;
    this.tool = 'inspect';
    this.brush = 2; // cells radius
    this.$ = id => document.getElementById(id);
    this.buildToolbar();
    this.bindInput();
    this.bindChrome();
  }
  get w() { return this.g.world; }
  get sim() { return this.g.sim; }
  get r() { return this.g.renderer; }

  // ---------- toolbar ----------
  buildToolbar() {
    const tb = this.$('toolbar');
    let grp = 'Tools';
    const add = (id, icon, label, title, swatch) => {
      const b = document.createElement('button');
      b.className = 'tool'; b.dataset.tool = id; b.dataset.group = grp; b.title = title || label;
      b.innerHTML = swatch ? `<span class="ic"><span class="sw" style="background:${swatch}"></span></span>${label}` : `<span class="ic">${icon}</span>${label}`;
      b.onclick = () => this.setTool(id);
      tb.appendChild(b);
    };
    const group = t => { grp = t; const d = document.createElement('div'); d.className = 'tgroup'; d.textContent = t; d.dataset.group = t; tb.appendChild(d); };
    add('inspect', '🔍', 'Inspect', 'Inspect and pan (drag)');
    add('bulldoze', '🚜', 'Bulldoze', 'Demolish a building or road');
    group('Roads');
    for (const k of SG.ROAD_TYPE_ORDER) {
      const t = SG.ROAD_TYPES[k];
      add('road:' + k, t.icon, t.label, `${t.label} ($${SG.fmtInt(t.cost)}/m): ${t.desc}`);
    }
    add('upgrade', '⬆️', 'Upgrade', 'Change a road to another type in place (street → avenue → boulevard → highway)');
    add('reshape', '✏️', 'Reshape', 'Pick a road, then drag its handles to bend or move it');
    group('Zoning');
    for (const z of SG.ZONES) if (z.id) add('zone:' + z.id, '', z.code.replace(',000', 'k'), `${z.code}: ${z.name}`, z.color);
    group('Private');
    for (const k of ['adu', 'house', 'duplex', 'townhomes', 'apartments', 'mixeduse', 'commercial']) {
      const s = SG.BUILDS[k]; add('build:' + k, s.icon, s.label, `${s.label}: ${s.desc}`);
    }
    group('City');
    for (const k of ['park', 'firestation', 'library', 'community', 'trainstation']) {
      const s = SG.BUILDS[k]; add('build:' + k, s.icon, s.label, `${s.label} (${SG.fmtMoney(s.cost)}): ${s.desc}`);
    }
    this.setTool('inspect');

    const ov = this.$('overlays');
    for (const [id, label] of [['none', 'Map'], ['zoning', 'Zoning'], ['vacant', 'Vacant lots'], ['access', 'Street access'], ['fire', 'Fire coverage']]) {
      const b = document.createElement('button'); b.textContent = label; b.dataset.ov = id;
      b.onclick = () => this.setOverlay(id);
      ov.appendChild(b);
    }
    this.setOverlay('none');
  }
  setOverlay(id) {
    this.r.overlay = id; this.r.zoneDirty = true; this.r.dirty = true;
    document.querySelectorAll('#overlays button').forEach(b => b.classList.toggle('on', b.dataset.ov === id));
  }
  setTool(id) {
    if (this.roadPts && !(id.startsWith('road:') && id === this.tool)) this.cancelRoad();
    if (id !== this.tool) { this.armed = null; if (id !== 'reshape') this.reshape = null; }
    if (this.roadMode == null) {
      let o = {}; try { o = JSON.parse(localStorage.getItem('simsaratoga.roadopts') || '{}'); } catch (e) { /* ignore */ }
      this.roadMode = o.m || 'straight'; this.angleSnap = o.s !== false;
    }
    this.tool = id;
    document.querySelectorAll('.tool').forEach(b => b.classList.toggle('on', b.dataset.tool === id));
    this.r.ghost = null; this.r.dirty = true;
    const hint = this.$('hint');
    let msg = '';
    if (id.startsWith('zone:')) {
      const z = SG.ZONES[+id.slice(5)];
      msg = `Paint ${z.code} (${z.name}). Drag to paint, [ ] change brush size.`;
      if (this.r.overlay !== 'zoning') this.setOverlay('zoning');
    } else if (id === 'upgrade') msg = `Upgrade: pick the new type below, then ${this.touchMode ? 'tap' : 'click'} a road.`;
    else if (id === 'reshape') msg = `Reshape: ${this.touchMode ? 'tap' : 'click'} a road, then drag its handles.`;
    else if (id === 'bulldoze') msg = 'Click a building or road to demolish it.';
    else if (id.startsWith('build:')) {
      const s = SG.BUILDS[id.slice(6)];
      msg = s.private ? `${s.label}: point at a lot. Green = allowed, builds right away. Amber = zoning doesn't allow it (needs ${SG.ZONE_NEEDS[s.zones]}): you can still file for a variance.`
        : `${s.label}: ${SG.fmtMoney(s.cost)}. Click to build.`;
    }
    hint.textContent = msg; hint.style.display = msg ? 'block' : 'none';
    if (id.startsWith('road:')) this.roadHint();
    if (id.startsWith('zone:') && this.zoneMode === 'along') this.setHint(`${this.touchMode ? 'Tap' : 'Click'} a street to zone both sides of it ${SG.ZONES[+id.slice(5)].code}.`);
    this.renderToolOpts();
    if (this.onToolChange) this.onToolChange(id);
  }

  // ---------- input ----------
  bindInput() {
    const cv = this.$('map');
    const pointers = new Map();
    let drag = null, pinch = null;
    const pos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      const [x, y] = pos(e);
      const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      if (this.r.zoomSmooth) this.r.zoomSmooth(x, y, f); else this.r.zoomAt(x, y, f);
    }, { passive: false });

    cv.addEventListener('pointerdown', e => {
      cv.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, pos(e));
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), m: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], ang: Math.atan2(b[1] - a[1], b[0] - a[0]) };
        drag = null; return;
      }
      const [x, y] = pos(e);
      const touch = e.pointerType === 'touch';
      if (touch !== this.touchMode) { this.touchMode = touch; this.renderToolOpts(); }
      const orbit = !!this.r.orbit && (e.button === 2 || (e.button === 0 && (e.shiftKey || e.altKey)));
      // which tool takes this press? Otherwise it pans (and a press without movement is a tap/click)
      let consume = !(e.button === 1 || e.button === 2 || this.tool === 'inspect' || this.spaceDown || orbit);
      if (consume && this.tool === 'reshape') consume = this.reshapeDown(x, y);
      else if (consume && touch && this.tapTool()) consume = false; // on touch: drag pans, tap acts
      else if (consume && this.tool.startsWith('zone:') && this.zoneMode === 'along') consume = false;
      drag = { x, y, sx: x, sy: y, pan: !consume, orbit, moved: false, button: e.button, touch };
      if (!drag.pan) this.toolDown(...this.r.toWorld(x, y));
    });
    cv.addEventListener('pointermove', e => {
      const p = pos(e);
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]), m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
        this.r.pan(m[0] - pinch.m[0], m[1] - pinch.m[1]);
        this.r.zoomAt(m[0], m[1], d / pinch.d);
        if (this.r.orbit) { let da = ang - pinch.ang; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI; this.r.orbit(da / 0.006, 0); }
        pinch = { d, m, ang }; return;
      }
      if (drag && drag.pan) {
        if (Math.hypot(p[0] - drag.sx, p[1] - drag.sy) > 4) drag.moved = true;
        if (drag.orbit) this.r.orbit(p[0] - drag.x, p[1] - drag.y);
        else this.r.pan(p[0] - drag.x, p[1] - drag.y);
        drag.x = p[0]; drag.y = p[1]; return;
      }
      const [wx, wy] = this.worldAt(p);
      if (drag) {
        if (Math.hypot(p[0] - drag.sx, p[1] - drag.sy) > 4) drag.moved = true;
        this.toolDrag(wx, wy);
      } else this.toolHover(wx, wy);
    });
    const up = e => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (!drag) return;
      const p = pos(e);
      const [wx, wy] = this.worldAt(p, drag.pan);
      const d0 = drag; drag = null;
      if (d0.pan && !d0.moved && d0.button === 0 && !d0.orbit) {
        const t = this.tool;
        if (t === 'inspect') this.inspect(wx, wy);
        else if (t === 'reshape') this.reshapeTap(wx, wy);
        else if (t.startsWith('zone:') && this.zoneMode === 'along') this.zoneAlong(wx, wy);
        else if (d0.touch && this.tapTool()) this.tap(wx, wy, p[0], p[1]);
      } else if (!d0.pan) this.toolUp(wx, wy);
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);

    window.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      if (e.code === 'Space') { e.preventDefault(); this.g.setSpeed(this.g.speed ? 0 : (this.g.lastSpeed || 1)); }
      if (e.key === 'Enter' && this.roadPts) { this.finishRoad(); return; }
      if (e.key === 'Escape' && this.roadPts) { this.cancelRoad(); return; }
      if (e.key === 'Backspace' && this.roadPts) { e.preventDefault(); this.undoPoint(); return; }
      if ((e.key === 'Backspace' || e.key === 'Delete') && this.reshape) { e.preventDefault(); this.removeHandle(); return; }
      if (e.key === 'Escape' && (this.armed || this.reshape)) { this.disarm(); this.reshape = null; this.renderToolOpts(); return; }
      if (e.key === 'Escape') { this.setTool('inspect'); this.select(null); if (this.g.photo) this.g.setPhoto(false); }
      if (e.key === '[') { this.brush = Math.max(0, this.brush - 1); }
      if (e.key === ']') { this.brush = Math.min(12, this.brush + 1); }
      if (e.key === '+' || e.key === '=') this.r.zoomAt(this.r.vw / 2, this.r.vh / 2, 1.3);
      if (e.key === '-') this.r.zoomAt(this.r.vw / 2, this.r.vh / 2, 1 / 1.3);
      if (e.key === 'z') this.setOverlay(this.r.overlay === 'zoning' ? 'none' : 'zoning');
      if (e.key === 'v') this.g.toggleView();
      if (this.r.orbitSmooth) {
        if (e.key === 'q') this.r.orbitSmooth(-60, 0);
        if (e.key === 'e') this.r.orbitSmooth(60, 0);
        if (e.key === 'r') this.r.orbitSmooth(0, 40);
        if (e.key === 'f') this.r.orbitSmooth(0, -40);
        if (e.key === 't') this.camAction('tod');
        if (e.key === 'c') this.camAction('spin');
        if (e.key === 'p') this.camAction('photo');
      }
    });

    const mm = this.$('minimap');
    const mmGo = e => { const r = mm.getBoundingClientRect(); const k = mm.width / r.width; const [x, y] = this.r.minimapToWorld((e.clientX - r.left) * k, (e.clientY - r.top) * k); this.r.cx = x; this.r.cy = y; this.r.dirty = true; };
    mm.addEventListener('pointerdown', e => { mmGo(e); mm.setPointerCapture(e.pointerId); mm._d = true; });
    mm.addEventListener('pointermove', e => { if (mm._d) mmGo(e); });
    mm.addEventListener('pointerup', () => { mm._d = false; });
  }

  // Ground point under the cursor; inspecting and bulldozing hit buildings first in 3D.
  worldAt(p, inspecting) {
    const pick = (inspecting || this.tool === 'bulldoze' || this.tool === 'inspect') && this.r.pickWorld;
    return pick ? this.r.pickWorld(...p) : this.r.toWorld(...p);
  }
  toolHover(x, y) {
    const t = this.tool;
    if (t.startsWith('zone:') && this.zoneMode === 'along') {
      const road = this.roadAt(x, y);
      this.r.selected = road && road.cls <= 3 && !road.rail ? road : null; this.r.ghost = null;
    } else if (t.startsWith('zone:')) {
      this.r.ghost = { type: 'brush', x, y, r: (this.brush + 0.5) * SG.CELL, color: SG.ZONES[+t.slice(5)].color };
    } else if (t.startsWith('road:')) {
      this.roadPreview(x, y);
      return;
    } else if (t === 'upgrade') {
      this.upgradeHover(x, y); return;
    } else if (t === 'reshape') {
      return;
    } else if (t.startsWith('build:')) {
      const spec = SG.BUILDS[t.slice(6)];
      const st = this.site(spec, x, y);
      const warn = st.ok && (!st.meetsZoning || st.replace.length > 0) && !spec.area;
      this.r.ghost = { type: 'poly', pts: st.pts, ok: st.ok, warn, h: spec.area ? 0.6 : (spec.levels || 1) * 3.3 };
      const z = SG.ZONES[st.zid];
      const n = st.replace.length, repl = n ? ` It replaces ${n} building${n > 1 ? 's' : ''} on the site.` : '';
      const hint = this.$('hint');
      hint.style.display = 'block';
      hint.textContent = !st.ok ? `✗ ${st.why}.`
        : spec.private && !st.meetsZoning ? `⚠ ${spec.label} isn't allowed in ${z.code} (needs ${SG.ZONE_NEEDS[spec.zones]}). Click to rezone the lot and build, or file for a variance.${repl}`
        : !spec.private && st.annex ? `✓ ${spec.label} fits here. It's outside the city limits, so the city annexes the lot (${SG.fmtMoney(spec.cost)}).${repl}`
        : !spec.private && !st.meetsZoning ? `✓ ${spec.label} fits here. The lot is ${z.code}, so the city rezones it to PF when you build (${SG.fmtMoney(spec.cost)}).${repl}`
        : `✓ ${spec.label} fits here (${z ? z.code : ''}). Click to build${spec.private ? '' : ' (' + SG.fmtMoney(spec.cost) + ')'}.${repl}`;
    } else if (t === 'bulldoze') {
      const target = this.w.buildingAt(x, y) || this.roadAt(x, y);
      this.r.selected = target; this.r.ghost = null;
    } else this.r.ghost = null;
    this.r.dirty = true;
  }
  snapBuild(spec, x, y) {
    if (spec.kind !== 'adu') return [x, y];
    return [x, y];
  }
  // Where a project would go if dropped at (x, y): slides up to ~15 m to the nearest spot that fits,
  // otherwise it replaces what stands there. Returns { ok, why, x, y, pts, replace: [buildings], meetsZoning, zid }.
  site(spec, x, y) {
    const w = this.w;
    if (spec.needsRail) { // line the station up along the nearest track, platform beside it
      let best = null, bd = 60;
      for (const r of w.roadsIn([x - 60, y - 60, x + 60, y + 60])) {
        if (!r.rail || r.removed) continue;
        const p = r.pts;
        for (let i = 2; i < p.length; i += 2) {
          const d = Math.sqrt(SG.World.segDist2(x, y, p[i - 2], p[i - 1], p[i], p[i + 1]));
          if (d < bd) { bd = d; best = [p[i - 2], p[i - 1], p[i], p[i + 1]]; }
        }
      }
      if (!best) return { ok: false, why: 'A train station has to be next to a rail line (build Rail first)', x, y, pts: SG.World.rect(x, y, spec.w, spec.d, 0), replace: [] };
      const [ax, ay, bx, by] = best, L = Math.hypot(bx - ax, by - ay) || 1, ux = (bx - ax) / L, uy = (by - ay) / L;
      const t = Math.max(0, Math.min(L, (x - ax) * ux + (y - ay) * uy)), side = (x - ax) * -uy + (y - ay) * ux >= 0 ? 1 : -1;
      const off = SG.ROAD_TYPES.rail.w / 2 + spec.d / 2 + 2;
      const cx = ax + ux * t - uy * off * side, cy = ay + uy * t + ux * off * side;
      const pts = SG.World.rect(cx, cy, spec.w, spec.d, Math.atan2(uy, ux));
      const blk = w.siteBlockers(pts), zid = w.zoneAt(cx, cy);
      const res = { ok: true, x: cx, y: cy, pts, replace: blk.buildings, zid, meetsZoning: SG.zoneAllows(zid, spec), angle: Math.atan2(uy, ux) };
      if (!zid) res.annex = true; // the city annexes the station's lot
      if (blk.road) return Object.assign(res, { ok: false, why: `${blk.road.name || 'A road'} is in the way` });
      if (blk.water) return Object.assign(res, { ok: false, why: 'That spot is in a creek or pond' });
      const keep = blk.buildings.find(b => !this.replaceable(b, spec));
      if (keep) return Object.assign(res, { ok: false, why: `${(SG.KIND[keep.kind] || SG.KIND.other).name} in the way can't be replaced` });
      return res;
    }
    const at = (px, py) => {
      const nr = w.nearestRoad(px, py, 120);
      const pts = SG.World.rect(px, py, spec.w, spec.d, nr ? nr.angle : 0);
      return { x: px, y: py, pts, nr, blk: spec.area ? { buildings: [], road: null, water: w.areaK[w.cellOf(px, py)] === 4 } : w.siteBlockers(pts) };
    };
    const zid = w.zoneAt(x, y), annexOK = !spec.private; // the city can annex land for its own facilities
    if (!zid && !annexOK) return { ok: false, why: 'Outside city limits: paint a zone here first to annex the land', x, y, pts: at(x, y).pts, replace: [] };
    // the spot under the cursor if it's clear; otherwise the nearest spot within ~30 m that isn't on a
    // street or in water, preferring ones that need fewer buildings replaced
    let best = at(x, y);
    const fine = c => !c.blk.road && !c.blk.water && (annexOK || w.zoneAt(c.x, c.y)) && c.blk.buildings.every(b => this.replaceable(b, spec));
    if (!spec.area && (best.blk.buildings.length || best.blk.road || best.blk.water)) {
      let bestScore = fine(best) ? best.blk.buildings.length * 100 : Infinity;
      for (let r = 3; r <= 30; r += 3)
        for (let k = 0; k < 12; k++) {
          const c = at(x + Math.cos(k * Math.PI / 6) * r, y + Math.sin(k * Math.PI / 6) * r);
          if (!fine(c)) continue;
          const score = c.blk.buildings.length * 100 + r;
          if (score < bestScore) { bestScore = score; best = c; }
        }
    }
    const res = { ok: true, x: best.x, y: best.y, pts: best.pts, replace: best.blk.buildings, zid: w.zoneAt(best.x, best.y) };
    if (!res.zid) res.annex = true;
    if (best.blk.water) return Object.assign(res, { ok: false, why: 'That spot is in a creek or pond' });
    if (best.blk.road) return Object.assign(res, { ok: false, why: `${best.blk.road.name || 'A street'} is in the way` });
    const keep = res.replace.find(b => !this.replaceable(b, spec));
    if (keep) return Object.assign(res, { ok: false, why: `${(SG.KIND[keep.kind] || SG.KIND.other).name} in the way can't be replaced` });
    if (spec.area) return res;
    if (!best.nr || best.nr.dist > 80) return Object.assign(res, { ok: false, why: 'Needs street access within 80 m' });
    if (spec.kind === 'adu' && !this.hostHouse(best.x, best.y)) return Object.assign(res, { ok: false, why: 'An ADU must be on the lot of an existing home' });
    if (spec.kind === 'adu' && res.replace.length) return Object.assign(res, { ok: false, why: 'No room for an ADU on this lot' });
    res.meetsZoning = SG.zoneAllows(res.zid, spec);
    return res;
  }
  // Private projects may buy out homes and shops; schools, civic buildings and city facilities stay.
  replaceable(b, spec) {
    void spec;
    return !(['school', 'civic', 'utility', 'firestation', 'library', 'community'].includes(b.kind) || b.service);
  }
  canPlace(spec, x, y) { // kept for callers that only need a yes/no
    const s = this.site(spec, x, y);
    return { ok: s.ok, why: s.why, meetsZoning: s.meetsZoning };
  }
  // the zone a project needs, for "rezone and build"
  zoneFor(spec) {
    return { sfr: SG.Z.R_1_10_000, res: SG.Z.R_1_10_000, multi: SG.Z.R_M, mu: SG.Z.MU, com: SG.Z.C_N, pf: SG.Z.PF }[spec.zones] || SG.Z.R_M;
  }
  stationName(x, y) {
    const w = this.w, st = w.nearestNamedRoad(x, y, 300);
    if (st) return `${st.name.replace(/ (Road|Avenue|Drive|Way|Street|Boulevard|Lane|Court|Place|Circle|Terrace)$/, '')} Station`;
    const rail = w.roadsIn([x - 60, y - 60, x + 60, y + 60]).find(r => r.rail && !r.removed);
    const n = w.buildings.filter(b => b.kind === 'trainstation' && !b.removed).length + 1;
    return rail && rail.name ? `${rail.name.replace(/ (Line|Railway|Rail Line|Branch)$/, '')} Station ${n}` : `Station ${n}`;
  }
  rezoneSite(pts, zid, annex = false) {
    const w = this.w, bb = SG.World.bbox(pts), cells = [];
    const c0 = Math.floor((bb[0] - 8 - w.x0) / SG.CELL), c1 = Math.floor((bb[2] + 8 - w.x0) / SG.CELL);
    const r0 = Math.floor((bb[1] - 8 - w.y0) / SG.CELL), r1 = Math.floor((bb[3] + 8 - w.y0) / SG.CELL);
    for (let r = Math.max(0, r0); r <= Math.min(w.H - 1, r1); r++)
      for (let c = Math.max(0, c0); c <= Math.min(w.W - 1, c1); c++) {
        const i = r * w.W + c;
        if (!w.inCity[i] && !(annex && w.annexCells([i]))) continue;
        if (w.zone[i] === zid) continue;
        w.zone[i] = zid; cells.push(i);
      }
    this.sim.funds -= cells.length * 400;
    this.sim.markHot(cells);
    this.r.zoneDirty = true;
    return cells.length;
  }
  choose(title, body, buttons) {
    return new Promise(resolve => {
      this.modal(`<h2>${esc(title)}</h2><p>${body}</p><div class="row">${buttons.map((b, i) =>
        `<button class="btn${i === 0 ? ' primary' : ''}" data-choice="${esc(b[0])}">${esc(b[1])}</button>`).join('')}</div>`);
      const done = v => { this._askResolve = null; this.closeModal(); resolve(v); };
      this._askResolve = () => resolve(null);
      document.querySelectorAll('#modal [data-choice]').forEach(el => el.onclick = () => done(el.dataset.choice));
    });
  }
  hostHouse(x, y) {
    const c = this.w.cellOf(x, y); if (c < 0) return null;
    const id = this.w.claim[c];
    const b = id >= 0 ? this.w.buildings[id] : null;
    if (b && !b.removed && (b.kind === 'house' || b.kind === 'duplex')) return b;
    let best = null, bd = 45;
    for (const h of this.w.buildingsIn([x - 45, y - 45, x + 45, y + 45]))
      if (h.kind === 'house') { const d = Math.hypot(h.cx - x, h.cy - y); if (d < bd) { bd = d; best = h; } }
    return best;
  }

  toolDown(x, y) {
    const t = this.tool;
    if (t.startsWith('zone:')) { this.paintZone(x, y); }
    else if (t.startsWith('road:')) this.roadDown(x, y);
  }
  toolDrag(x, y) {
    const t = this.tool;
    if (t.startsWith('zone:')) { this.paintZone(x, y); this.toolHover(x, y); }
    else if (t.startsWith('road:')) this.roadPreview(x, y);
    else if (t === 'reshape') this.reshapeMove(x, y);
  }
  toolUp(x, y) {
    const t = this.tool, sim = this.sim, w = this.w;
    if (t.startsWith('zone:')) { this.flushZoneNews(+t.slice(5)); this.g.onWorldChange(); return; }
    if (t.startsWith('road:')) { this.roadUp(x, y); return; }
    if (t === 'reshape') { this.reshapeUp(); return; }
    if (t === 'upgrade') { this.upgradeAt(x, y); return; }
    if (t === 'bulldoze') { this.bulldozeAt(x, y); return; }
    if (t.startsWith('build:')) this.placeBuild(t.slice(6), x, y);
  }
  async bulldozeAt(x, y) {
    const sim = this.sim, w = this.w;
    {
      const b = w.buildingAt(x, y);
      if (b) {
        if (!b.inCity) { sim.say("That building is outside Saratoga's city limits."); return; }
        const cost = b.player ? 20000 : 60000 + b.value * 0.0;
        if (!b.player && b.units && !(await this.ask('Demolish this home?', `${w.addressOf(b) || 'This home'} is privately owned. The city has to buy it first: ${SG.fmtMoney(b.value * 1.6)}.`, 'Buy and demolish'))) return;
        const total = b.player ? cost : cost + (b.units || b.jobs ? b.value * 1.6 : 0);
        if (!sim.spend(total, 'demolition')) return;
        w.removeBuilding(b);
        sim.construction = sim.construction.filter(c => c !== b);
        sim.say(`Demolished ${SG.KIND[b.kind]?.name.toLowerCase() || 'building'}${w.addressOf(b) ? ' at ' + w.addressOf(b) : ''} (${SG.fmtMoney(total)}).`);
        this.r.selected = null; this.select(null);
        this.g.onWorldChange();
        return;
      }
      const rd = this.roadAt(x, y);
      if (rd) {
        if (rd.cls <= 1 && !(await this.ask('Remove a major road?', `${rd.name || 'This road'} is a major road. Remove this ${Math.round(rd.len)} m segment anyway?`, 'Remove it'))) return;
        if (!sim.spend(rd.len * 150, 'road removal')) return;
        w.removeRoad(rd); sim._roadsDirty = true;
        sim.say(`Removed a ${Math.round(rd.len)} m segment of ${rd.name || 'road'}.`);
        this.r.selected = null; this.g.onWorldChange();
      }
    }
  }

  async placeBuild(key, x, y) {
    const spec = SG.BUILDS[key], sim = this.sim, w = this.w;
    const st = this.site(spec, x, y);
    if (!st.ok) { sim.say(`Can't build here: ${st.why}.`, true); return; }
    x = st.x; y = st.y;
    const nr = w.nearestRoad(x, y, 120);
    if (spec.area) {
      if (!sim.spend(spec.cost, 'a park')) return;
      w.addPark(x, y, spec.w, spec.d);
      sim.say(`New ${spec.w * spec.d / 10000 * 2.47 | 0}-acre park opens${nr && nr.road.name ? ' on ' + nr.road.name : ''}.`);
      this.g.onWorldChange(); return;
    }
    const rep = st.replace, n = rep.length;
    const buy = rep.reduce((s, b) => s + (b.units || b.jobs ? b.value * 1.6 : 20000), 0);
    const list = rep.slice(0, 3).map(b => esc(w.addressOf(b) || (SG.KIND[b.kind] || SG.KIND.other).name.toLowerCase())).join('; ') + (n > 3 ? `; and ${n - 3} more` : '');
    if (!spec.private) {
      const z = SG.ZONES[st.zid], parts = [];
      if (n) parts.push(`The city buys and demolishes ${list} for ${SG.fmtMoney(buy)}.`);
      if (st.annex) parts.push('The lot is outside the city limits, so the city annexes it and zones it PF (public facility).');
      else if (!st.meetsZoning) parts.push(`The lot is zoned ${esc(z.code)}, so the Council rezones it to PF (public facility) first.`);
      if (parts.length && (await this.choose(`Build the ${spec.label.toLowerCase()} here?`, parts.join('<br><br>') + `<br><br>Construction: ${SG.fmtMoney(spec.cost)}.`,
        [['build', 'Build it'], ['cancel', 'Cancel']])) !== 'build') return;
      if (!sim.spend(spec.cost + buy, spec.label)) return;
      if (!st.meetsZoning) { const cells = this.rezoneSite(st.pts, SG.Z.PF, !!st.annex); sim.say(`City Council ${st.annex ? 'annexes and zones' : 'rezones'} ${(cells * SG.CELL * SG.CELL / 4046.86).toFixed(1)} acres PF for the ${spec.label.replace('Stn', 'Station').toLowerCase()}.`); }
      for (const b of rep) { w.removeBuilding(b); sim.construction = sim.construction.filter(c => c !== b); }
      const nice = spec.label.replace('Train Stn', 'Train Station').replace('Fire Stn', 'Fire Station').replace('Comm. Ctr', 'Community Center');
      const b = w.placeBuilding(x, y, spec, { service: spec.service, radius: spec.radius, upkeep: spec.upkeep, angle: st.angle,
        name: spec.needsRail ? this.stationName(x, y) : 'New ' + nice });
      b.built = sim.year;
      sim.say(`${b.name} opens${b.street ? ' on ' + b.street : ''}.`, true);
      this.g.onWorldChange(); return;
    }
    // private project
    const replText = n ? `<br><br>It replaces ${n} building${n > 1 ? 's' : ''} on the site (${list}); the developer buys ${n > 1 ? 'them' : 'it'}.` : '';
    let mode = 'build';
    if (!st.meetsZoning) {
      const z = SG.ZONES[st.zid], target = SG.ZONES[this.zoneFor(spec)];
      mode = await this.choose(`${spec.label} isn't allowed in ${z.code}`,
        `This lot is zoned ${esc(z.name)}. ${esc(spec.label)} needs ${esc(SG.ZONE_NEEDS[spec.zones])}.<br><br>` +
        `<b>Rezone and build</b>: the Council rezones this lot to ${esc(target.code)} and construction starts.<br>` +
        `<b>File for a variance</b>: it goes to the Planning Commission panel for your decision.${replText}`,
        [['rezone', `Rezone to ${target.code} and build`], ['variance', 'File for a variance'], ['cancel', 'Cancel']]);
      if (!mode || mode === 'cancel') return;
    } else if (n) {
      mode = (await this.choose(`Build ${spec.label.toLowerCase()} here?`, `${esc(spec.label)} fits here.${replText}`, [['build', 'Build it'], ['cancel', 'Cancel']])) || 'cancel';
      if (mode === 'cancel') return;
    }
    if (mode === 'rezone') {
      const target = this.zoneFor(spec), cells = this.rezoneSite(st.pts, target);
      sim.say(`City Council rezones ${(cells * SG.CELL * SG.CELL / 4046.86).toFixed(1)} acres${nr && nr.road.name ? ' on ' + nr.road.name : ''} to ${SG.ZONES[target].code} for new ${spec.label.toLowerCase()} (${SG.fmtMoney(cells * 400)}).`);
      if (target === SG.Z.MU || target === SG.Z.R_M) sim.approval -= 0.5;
    }
    const app = { build: key, x, y, why: 'Filed by you', ministerial: !!spec.ministerial, byPlayer: true, replaceIds: rep.map(b => b.id) };
    if (key === 'adu') app.host = this.hostHouse(x, y)?.id;
    sim.autoApprove = false;
    sim.addApp(app);
    sim.autoApprove = this.$('auto-approve').checked;
    const filed = sim.apps.find(a => a.id === sim.nextAppId - 1);
    if (filed && filed.check.ok) { sim.approve(filed); sim.funds += spec.fee || 0; }
    else if (filed) sim.say(`${spec.label} filed on ${filed.street} needs a variance (${filed.check.issues.join('; ')}). Approve or deny it in the Planning Commission panel.`, true);
    else sim.funds += spec.fee || 0;
    this.g.onWorldChange();
  }

  paintZone(x, y) {
    const zid = +this.tool.slice(5), w = this.w;
    const c = w.cellOf(x, y); if (c < 0) return;
    const cx = c % w.W, cy = (c / w.W) | 0, R = this.brush;
    let changed = 0;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      if (dx * dx + dy * dy > (R + 0.5) ** 2) continue;
      const X = cx + dx, Y = cy + dy;
      if (X < 0 || Y < 0 || X >= w.W || Y >= w.H) continue;
      const i = Y * w.W + X;
      if (w.zone[i] === zid && w.inCity[i]) continue;
      if (!w.inCity[i]) { if (w.annexCells([i])) this.annexed = (this.annexed || 0) + 1; }
      w.zone[i] = zid; changed++;
      this.sim.markHot([i]);
    }
    if (changed) {
      this.zoneChanges = (this.zoneChanges || 0) + changed;
      this.sim.funds -= changed * 400; // staff time, CEQA review, public hearings
      if (this.annexed) this.sim.funds -= this.annexed * 2500; // annexation studies, utilities, LAFCO fees
      this.r.zoneDirty = true; this.r.dirty = true;

    }
  }
  // one news item per brush stroke (sent on release, or after a pause)
  flushZoneNews(zid) {
    clearTimeout(this._zt);
    if (!this.zoneChanges) return;
    zid = zid || +this.tool.slice(5);
    {
      {
        const acres = this.zoneChanges * SG.CELL * SG.CELL / 4046.86;
        if (this.annexed) {
          const aa = this.annexed * SG.CELL * SG.CELL / 4046.86;
          this.sim.say(`County LAFCO approves annexation of ${aa.toFixed(1)} acres into Saratoga (${SG.fmtMoney(this.annexed * 2500)} in studies and fees).`, true);
          this.annexed = 0;
        }
        this.sim.say(`City Council rezones ${acres.toFixed(1)} acres to ${SG.ZONES[zid].code} (${SG.fmtMoney(this.zoneChanges * 400)} in studies and hearings).`);
        if (zid === SG.Z.MU || zid === SG.Z.R_M) this.sim.approval -= Math.min(4, acres / 10);
        this.zoneChanges = 0;
      }
    }
  }

  // Snap to the nearest point on an existing road (vertices preferred). Returns [x, y, road, end]
  // where end is true when the point is one of that road's two ends.
  snapRoad(x, y) {
    const tol = 14 / Math.max(0.15, this.r.scale) + 6;
    let best = null, bd = tol;
    for (const r of this.w.roadsIn([x - tol, y - tol, x + tol, y + tol])) {
      if (r.cls > 4) continue;
      const p = r.pts, n = p.length;
      for (let i = 0; i < n; i += 2) {
        const d = Math.hypot(p[i] - x, p[i + 1] - y) - 3; // small preference for vertices
        if (d < bd) { bd = d; best = [p[i], p[i + 1], r, i === 0 || i === n - 2]; }
      }
      for (let i = 2; i < n; i += 2) {
        const ax = p[i - 2], ay = p[i - 1], dx = p[i] - ax, dy = p[i + 1] - ay, l2 = dx * dx + dy * dy;
        const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
        const qx = ax + t * dx, qy = ay + t * dy, d = Math.hypot(qx - x, qy - y);
        if (d < bd) { bd = d; best = [qx, qy, r, false]; }
      }
    }
    return best || [x, y, null, false];
  }

  // ---------- road building: see roads.js ----------
  // Catmull-Rom through the control points, sampled every ~12 m.
  roadCurve(ctrl) {
    const P = ctrl.map(p => [p[0], p[1]]);
    if (P.length < 3) return P.flat();
    const out = [];
    for (let i = 0; i < P.length - 1; i++) {
      const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
      const n = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 12));
      for (let k = 0; k < n; k++) {
        const t = k / n, t2 = t * t, t3 = t2 * t;
        const f = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        out.push(f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1]));
      }
    }
    out.push(P[P.length - 1][0], P[P.length - 1][1]);
    return out;
  }
  roadAt(x, y) {
    const tol = Math.max(6, 8 / this.r.scale);
    const nr = this.w.nearestRoad(x, y, tol, false);
    return nr ? nr.road : null;
  }

  // ---------- inspector ----------
  inspect(x, y) {
    const b = this.w.buildingAt(x, y);
    if (b) return this.select(b);
    const rd = this.roadAt(x, y);
    if (rd) return this.select(rd);
    this.select({ lot: true, x, y });
  }
  select(obj) {
    this.selected = obj;
    this.r.selected = obj && obj.pts ? obj : null;
    this.r.dirty = true;
    this.renderInspector();
  }
  zoneChip(zid) {
    const z = SG.ZONES[zid];
    return z && z.color ? `<span class="zone-chip" style="background:${z.color}">${z.code}</span>` : '<span class="muted">outside city</span>';
  }
  renderInspector() {
    const el = this.$('inspect-body'), o = this.selected, w = this.w;
    if (!o) { el.innerHTML = '<span class="muted">Pick a building, road or lot to see its details.</span>'; return; }
    const kv = rows => `<dl class="kv">${rows.map(r => r === '-' ? '<div class="sep"></div>' : `<dt>${r[0]}</dt><dd class="${r[2] || ''}">${r[1]}</dd>`).join('')}</dl>`;
    if (o.lot) {
      const zid = w.zoneAt(o.x, o.y), z = SG.ZONES[zid];
      const area = w.areaAt(o.x, o.y);
      const c = w.cellOf(o.x, o.y);
      const vacant = c >= 0 && w.claim[c] === -1 && w.roadDist[c] <= 2;
      const nr = w.nearestRoad(o.x, o.y, 300, false);
      el.innerHTML = `<div class="ititle">${area && area.name ? area.name : zid ? 'Land' : 'Outside Saratoga'}</div>
        <div class="isub">${nr && nr.road.name ? 'Near ' + nr.road.name : ''}</div>` + kv([
        ['Zoning', this.zoneChip(zid)],
        ...(z && z.id ? [['District', z.name], ['Min. lot', z.minLot ? SG.fmtInt(z.minLot / SQFT_) + ' sq ft' : '—'],
          ['Max density', z.duPerAcre ? z.duPerAcre + ' homes/acre' : 'no housing'], ['Max height', z.maxHeightFt ? z.maxHeightFt + ' ft' : '—'],
          ['Lot coverage', z.coverage ? Math.round(z.coverage * 100) + '%' : '—'], ['Buildable now', vacant ? 'Yes, vacant' : 'No']] : []),
        ...(area ? [['Land cover', area.kind]] : []),
      ]) + (z && z.note ? `<p class="muted">${z.note}</p>` : '');
      return;
    }
    if (o.cls != null) {
      const cls = o.rail ? 'Rail line' : o.ramp ? 'Highway ramp (one-way)' : o.cls === 0 ? (o.oneway ? 'Freeway (one direction)' : 'Freeway') : ['Freeway', 'Arterial', 'Collector', 'Residential street', 'Service road / driveway', 'Track', 'Path or trail'][o.cls] || 'Road';
      el.innerHTML = `<div class="ititle">${esc(o.name) || 'Unnamed ' + cls.toLowerCase()}</div><div class="isub">${cls}</div>` +
        kv([['Segment length', Math.round(o.len) + ' m'], ['Width', Math.round(SG.roadWidth(o)) + ' m'], ...(o.el ? [['Bridge', `up to ${Math.round(Math.max(...o.el))} m high`]] : []),
          ...(o.built ? [['Built', o.built]] : []), ['Source', o.player ? 'Built in game' : 'OpenStreetMap']]) +
        `<div class="row" style="margin-top:8px"><button class="btn" id="road-reshape">✏️ Reshape</button><button class="btn" id="road-upgrade">⬆️ Upgrade…</button></div>` +
        `<div class="rename"><input id="road-name" maxlength="40" value="${esc(o.name)}" aria-label="Road name"><button class="btn" id="road-rename">Rename</button></div>`;
      const go = () => {
        const v = this.$('road-name').value.trim().replace(/\s+/g, ' ');
        if (!v || v === o.name) return;
        const old = o.name;
        // rename every segment that carries the same name, so the whole road changes
        for (const r of w.roads) if (!r.removed && old && r.name === old) { r.name = v; r.renamed = true; }
        o.name = v; o.renamed = true;
        this.sim.say(old ? `${old} is renamed ${v}.` : `The road is named ${v}.`);
        this.r.dirty = true; this.r.hudDirty = true; this.renderInspector();
      };
      this.$('road-rename').onclick = go;
      this.$('road-reshape').onclick = () => { this.setTool('reshape'); this.startReshape(o); };
      this.$('road-upgrade').onclick = () => { this.setTool('upgrade'); this.r.selected = o; this.r.dirty = true; };
      this.$('road-name').onkeydown = e => { if (e.key === 'Enter') go(); };
      return;
    }
    const b = o, k = SG.KIND[b.kind] || SG.KIND.other;
    const zid = w.zoneAt(b.cx, b.cy);
    const units = b.construction ? b.unitsWhenDone : b.units, jobs = b.construction ? b.jobsWhenDone : b.jobs;
    el.innerHTML = `<div class="ititle">${b.name || k.name}</div><div class="isub">${w.addressOf(b) || ''}${b.inCity ? '' : ' · outside city limits'}</div>` + kv([
      ['Type', k.name],
      ['Zoning', this.zoneChip(zid)],
      ['Footprint', `${SG.fmtInt(b.area)} m² (${SG.fmtInt(b.area / SQFT_)} sq ft)`],
      ['Stories', b.levels || 1],
      ...(units ? [['Homes', units], ['Residents', '~' + Math.round(units * SG.ECON.hhSize)]] : []),
      ...(jobs ? [['Jobs', jobs]] : []),
      ['Assessed value', SG.fmtMoney(b.value)],
      ...(b.construction ? [['Status', `Under construction, ${b.months} mo left`, 'neg']] : []),
      ...(b.built ? [['Built', b.built]] : []),
      ['Source', !b.original ? 'Built in game' : b.src === 'ms' ? 'Microsoft footprint (from imagery)' : 'OpenStreetMap footprint'],
    ]) + (b.inCity ? `<div class="row" style="margin-top:8px"><button class="btn danger" id="insp-demo">Demolish</button></div>` : '');
    const d = this.$('insp-demo');
    if (d) d.onclick = () => { const t = this.tool; this.tool = 'bulldoze'; this.toolUp(b.cx, b.cy); this.tool = t; };
  }

  // ---------- panels ----------
  bindChrome() {
    document.querySelectorAll('.speed button[data-speed]').forEach(b => b.onclick = () => this.g.setSpeed(+b.dataset.speed));
    this.$('menu-btn').onclick = () => this.menu();
    document.querySelectorAll('#camctl button').forEach(b => b.onclick = () => this.camAction(b.dataset.cam));
    this.$('auto-approve').onchange = e => { this.sim.autoApprove = e.target.checked; };
    this.$('modal').addEventListener('click', e => { if (e.target.id === 'modal') this.closeModal(); });
  }
  camAction(c) {
    const r = this.r;
    if (c === 'view') return this.g.toggleView();
    if (!r.orbitSmooth) return;
    if (c === 'rotl') r.orbitSmooth(-90, 0);
    if (c === 'rotr') r.orbitSmooth(90, 0);
    if (c === 'up') r.orbitSmooth(0, 60);
    if (c === 'down') r.orbitSmooth(0, -60);
    if (c === 'tod') { const t = r.cycleTod(); this.$('tod-btn').textContent = t.icon; this.ticker(`Time of day: ${t.label.toLowerCase()}.`); }
    if (c === 'photo') this.g.setPhoto(!this.g.photo);
    if (c === 'save') r.savePhoto(`simsaratoga-${this.sim.monthKey().replace(' ', '-').toLowerCase()}.png`);
    if (c === 'spin') { r.autoOrbit = !r.autoOrbit; this.$('spin-btn').classList.toggle('on', r.autoOrbit); }
  }
  renderStats() {
    const s = this.sim, st = s.rhnaStatus();
    this.$('s-date').textContent = s.monthKey();
    const f = this.$('s-funds'); f.textContent = SG.fmtMoney(s.funds); f.style.color = s.funds < 0 ? 'var(--bad)' : '';
    this.$('s-pop').textContent = SG.fmtInt(s.pop);
    this.$('s-units').textContent = SG.fmtInt(s.units);
    const ap = this.$('s-approval'); ap.textContent = Math.round(s.approval) + '%';
    ap.style.color = s.approval < 40 ? 'var(--bad)' : s.approval > 65 ? 'var(--good)' : '';
    this.$('s-rhna').textContent = `${SG.fmtInt(st.have)} / ${SG.fmtInt(st.target)} homes · ${s.compliant ? 'compliant' : 'OUT OF COMPLIANCE'}`;
    this.$('s-rhna').style.color = s.compliant ? '' : 'var(--bad)';
    const bar = this.$('s-rhna-bar'); bar.style.width = (st.frac * 100) + '%'; bar.style.background = st.have >= st.expected ? 'var(--good)' : 'var(--accent)';
    const d = s.demand();
    this.$('d-r').style.height = (d.r * 100) + '%'; this.$('d-c').style.height = (d.c * 100) + '%'; this.$('d-m').style.height = (d.m * 100) + '%';
  }
  renderApps() {
    const s = this.sim, el = this.$('apps-list');
    const cnt = this.$('apps-count'); cnt.textContent = s.apps.length; cnt.classList.toggle('hot', s.apps.length > 5);
    if (!s.apps.length) { el.innerHTML = '<div class="muted">No projects waiting for a decision.</div>'; return; }
    el.innerHTML = '';
    for (const a of s.apps.slice().reverse()) {
      const spec = SG.BUILDS[a.build];
      const d = document.createElement('div');
      d.className = 'app' + (a.forced ? ' forced' : '');
      d.innerHTML = `<div class="t">${spec.icon} ${spec.label}${a.units ? ` · ${a.units} home${a.units > 1 ? 's' : ''}` : ''}</div>
        <div class="d">${a.why} on ${a.street}. Zone ${a.check.zone}. ${a.check.ok ? 'Meets the code.' : '⚠ ' + a.check.issues.join('; ') + '.'}
        ${a.forced ? '<br><b>State law limits the city\'s power to deny this one.</b>' : ''}</div>
        <div class="b"><button class="yes">Approve</button><button class="no">Deny</button><button class="go" title="Show on map">⌖</button></div>`;
      d.querySelector('.yes').onclick = () => { s.approve(a); if (spec.fee) s.funds += spec.fee; this.g.onWorldChange(); };
      d.querySelector('.no').onclick = () => { s.deny(a); this.g.onWorldChange(); };
      d.querySelector('.go').onclick = () => {
        this.r.cx = a.x; this.r.cy = a.y; this.r.scale = Math.max(this.r.scale, 2.5);
        const nr = this.w.nearestRoad(a.x, a.y, 120);
        this.r.ghost = { type: 'poly', pts: SG.World.rect(a.x, a.y, spec.w, spec.d, nr ? nr.angle : 0), ok: a.check.ok, h: (spec.levels || 1) * 3.3 };
        this.r.dirty = true;
      };
      el.appendChild(d);
    }
  }
  renderBudget() {
    const s = this.sim, b = s.budget;
    const rows = [];
    for (const [k, v] of Object.entries(b.rev)) if (v) rows.push(`<dt>${k}</dt><dd class="pos">${SG.fmtMoney(v)}</dd>`);
    rows.push('<div class="sep"></div>');
    for (const [k, v] of Object.entries(b.exp)) if (v) rows.push(`<dt>${k}</dt><dd class="neg">-${SG.fmtMoney(v)}</dd>`);
    rows.push('<div class="sep"></div>', `<dt><b>Net</b></dt><dd class="${b.net >= 0 ? 'pos' : 'neg'}"><b>${SG.fmtMoney(b.net)}</b></dd>`);
    const f = s.approvalFactors || {};
    const fr = Object.entries(f).map(([k, v]) => `<dt>${k}</dt><dd class="${v >= 0 ? 'pos' : 'neg'}">${v >= 0 ? '+' : ''}${v.toFixed(1)}</dd>`).join('');
    this.$('budget-body').innerHTML = `<dl class="kv">${rows.join('')}</dl>
      <div class="slider">Parcel tax <select id="ptax">${[0, 50, 100, 150, 200, 300, 400].map(v => `<option value="${v}" ${v === s.parcelTax ? 'selected' : ''}>$${v}/yr</option>`).join('')}</select>
      <button class="btn" id="ptax-go">Put to voters</button></div>
      <h3 style="margin-top:14px">What residents think</h3><dl class="kv">${fr}</dl>`;
    this.$('ptax-go').onclick = () => { s.setParcelTax(+this.$('ptax').value); this.renderBudget(); };
  }
  ticker(msg, important) {
    const t = this.$('ticker-text');
    t.innerHTML = important ? `<b>${msg}</b>` : msg;
  }

  // ---------- modal ----------
  ask(title, body, okLabel = 'OK') {
    return new Promise(resolve => {
      this.modal(`<h2>${esc(title)}</h2><p>${esc(body)}</p><div class="row"><button class="btn danger" id="ask-ok">${esc(okLabel)}</button><button class="btn" id="ask-no">Cancel</button></div>`);
      const done = v => { this._askResolve = null; this.closeModal(); resolve(v); };
      this._askResolve = done;
      this.$('ask-ok').onclick = () => done(true);
      this.$('ask-no').onclick = () => done(false);
    });
  }
  modal(html) { this.$('modal-body').innerHTML = html; this.$('modal').classList.remove('hidden'); }
  closeModal() {
    this.$('modal').classList.add('hidden');
    if (this._askResolve) { const r = this._askResolve; this._askResolve = null; r(false); }
  }
  intro() {
    const m = window.SARATOGA_MAP, n = m.buildings.filter(b => b.in).length;
    this.modal(`<h2>Welcome to Saratoga</h2>
      <p>You're the planning director of <b>Saratoga, California</b>, a town of about 31,000 people in the foothills of the Santa Cruz Mountains.
      The map is built from <b>${SG.fmtInt(n)} real building footprints</b> and Saratoga's real streets, parks and creeks${m.synthetic ? ' (an approximate stand-in map: run <code>tools/fetch_osm.py</code> to load the real one)' : ', taken from OpenStreetMap'}.</p>
      <p>The state says Saratoga must plan for <b>${SG.fmtInt(SG.RHNA.target)} new homes</b> by 2031. Rezone land, decide on development projects, and keep the budget and residents happy.
      Fall too far behind and developers can use the <i>builder's remedy</i> to skip local zoning.</p>
      <ul>
        <li><b>Inspect</b> (drag to pan, scroll or pinch to zoom). Click anything to see its details.</li>
        <li><b>Roads</b>: pick Street, Avenue, Boulevard or Highway, click to place points (the road curves through them), and click the last point again or press Enter to finish. Joining an existing road finishes it too. New roads get real-sounding names; rename one by clicking it.</li>
        <li><b>Homes and apartments</b> go where the zoning lets them. Paint a zone along a street (R-1 for houses, R-M or MU for apartments) and developers build there over the following months. Or place one yourself with the <b>Private</b> tools: green means allowed, amber means it needs a variance.</li>
        <li><b>Room to grow</b>: there's open land all around the city. Painting a zone outside the city limits annexes it.</li>
        <li><b>City</b> tools build parks, fire stations and libraries with city money.</li>
        <li><b>3D view</b>: right-drag (or Shift-drag) to rotate and tilt, Q/E and R/F from the keyboard, two-finger twist on touch. Zoom all the way in and tilt down for street-level views.</li>
        <li><b>P</b> is photo mode: the interface steps aside and the lens gets a shallower focus. 💾 saves the picture.</li>
        <li><b>T</b> changes the time of day (sunset and night light up the town), <b>C</b> circles the camera, <b>V</b> switches to the flat map.</li>
        <li>Space pauses. Press Z for the zoning map. <b>[</b> and <b>]</b> change the brush size.</li>
      </ul>
      <div class="row"><button class="btn" id="m-start">Start planning</button></div>`);
    this.$('m-start').onclick = () => { this.closeModal(); this.g.setSpeed(1); };
  }
  menu() {
    const has = this.g.hasSave();
    this.modal(`<h2>Menu</h2>
      <div class="row"><button class="btn" id="m-save">Save</button>
      <button class="btn" id="m-load" ${has ? '' : 'disabled'}>Load saved city</button>
      <button class="btn danger" id="m-new">Start over</button>
      <button class="btn" id="m-help">How to play</button>
      <button class="btn" id="m-close">Close</button></div>
      ${this.g.r3d ? `<div class="slider">3D graphics <select id="m-gfx">${[['auto', 'Automatic'], ['high', 'High (always full detail)'], ['low', 'Low (no shadows or animation)']]
        .map(([v, l]) => `<option value="${v}" ${this.g.r3d.gfxMode === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>` : ''}
      <h3 style="margin-top:16px">Recent news</h3>
      <ul>${this.sim.news.slice(0, 10).map(n => `<li><span class="muted">${n.when}</span> ${n.msg}</li>`).join('') || '<li class="muted">Nothing yet.</li>'}</ul>
      <h3>History</h3>
      <ul>${this.sim.history.slice(-8).map(h => `<li>${h.y}: ${SG.fmtInt(h.pop)} residents, ${SG.fmtInt(h.units)} homes, ${SG.fmtMoney(h.funds)}</li>`).join('') || '<li class="muted">The first year is not over yet.</li>'}</ul>
      <p class="muted">Map data © OpenStreetMap contributors (ODbL)${/Microsoft/.test(window.SARATOGA_MAP.source) ? ', with building footprints from Microsoft Global ML Building Footprints (ODbL) where OpenStreetMap has none' : ''}, generated ${window.SARATOGA_MAP.generated}. Zoning districts are inferred from what is built and simplified for play; this is not the official Saratoga zoning map.</p>`);
    if (this.$('m-gfx')) this.$('m-gfx').onchange = e => this.g.r3d.setGfx(e.target.value);
    this.$('m-save').onclick = () => { this.g.save(); this.closeModal(); };
    this.$('m-load').onclick = () => { this.g.load(); this.closeModal(); };
    this.$('m-new').onclick = async () => { if (await this.ask('Start over?', 'Throw away this city and start again from today\'s Saratoga?', 'Start over')) this.g.newGame(); };
    this.$('m-help').onclick = () => this.intro();
    this.$('m-close').onclick = () => this.closeModal();
  }
};
const SQFT_ = 0.092903;

function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
