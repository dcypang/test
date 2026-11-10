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
    const add = (id, icon, label, title, swatch) => {
      const b = document.createElement('button');
      b.className = 'tool'; b.dataset.tool = id; b.title = title || label;
      b.innerHTML = swatch ? `<span class="ic"><span class="sw" style="background:${swatch}"></span></span>${label}` : `<span class="ic">${icon}</span>${label}`;
      b.onclick = () => this.setTool(id);
      tb.appendChild(b);
    };
    const group = t => { const d = document.createElement('div'); d.className = 'tgroup'; d.textContent = t; tb.appendChild(d); };
    add('inspect', '🔍', 'Inspect', 'Inspect and pan (drag)');
    add('bulldoze', '🚜', 'Bulldoze', 'Demolish a building or road');
    add('road', '🛣️', 'Road', 'Drag to build a street ($900/m)');
    group('Zoning');
    for (const z of SG.ZONES) if (z.id) add('zone:' + z.id, '', z.code.replace(',000', 'k'), `${z.code}: ${z.name}`, z.color);
    group('Private');
    for (const k of ['adu', 'house', 'duplex', 'townhomes', 'apartments', 'mixeduse', 'commercial']) {
      const s = SG.BUILDS[k]; add('build:' + k, s.icon, s.label, `${s.label}: ${s.desc}`);
    }
    group('City');
    for (const k of ['park', 'firestation', 'library', 'community']) {
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
    this.tool = id;
    document.querySelectorAll('.tool').forEach(b => b.classList.toggle('on', b.dataset.tool === id));
    this.r.ghost = null; this.r.dirty = true;
    const hint = this.$('hint');
    let msg = '';
    if (id.startsWith('zone:')) {
      const z = SG.ZONES[+id.slice(5)];
      msg = `Paint ${z.code} (${z.name}). Drag to paint, [ ] change brush size.`;
      if (this.r.overlay !== 'zoning') this.setOverlay('zoning');
    } else if (id === 'road') msg = 'Drag from an existing street to lay a new one.';
    else if (id === 'bulldoze') msg = 'Click a building or road to demolish it.';
    else if (id.startsWith('build:')) {
      const s = SG.BUILDS[id.slice(6)];
      msg = s.private ? `${s.label}: click a lot to file a project. It must meet zoning to pass.` : `${s.label}: ${SG.fmtMoney(s.cost)}. Click to build.`;
    }
    hint.textContent = msg; hint.style.display = msg ? 'block' : 'none';
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
      const panMode = e.button === 1 || e.button === 2 || this.tool === 'inspect' || this.spaceDown;
      const orbit = !!this.r.orbit && (e.button === 2 || (e.button === 0 && (e.shiftKey || e.altKey)));
      drag = { x, y, sx: x, sy: y, pan: panMode || orbit, orbit, moved: false, button: e.button };
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
      if (drag.pan && !drag.moved && drag.button === 0) this.inspect(wx, wy);
      else if (!drag.pan) this.toolUp(wx, wy);
      drag = null;
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);

    window.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      if (e.code === 'Space') { e.preventDefault(); this.g.setSpeed(this.g.speed ? 0 : (this.g.lastSpeed || 1)); }
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
    if (t.startsWith('zone:')) {
      this.r.ghost = { type: 'brush', x, y, r: (this.brush + 0.5) * SG.CELL, color: SG.ZONES[+t.slice(5)].color };
    } else if (t.startsWith('build:')) {
      const spec = SG.BUILDS[t.slice(6)];
      const [px, py] = this.snapBuild(spec, x, y);
      const nr = this.w.nearestRoad(px, py, 120);
      const pts = SG.World.rect(px, py, spec.w, spec.d, nr ? nr.angle : 0);
      const ok = this.canPlace(spec, px, py, pts).ok;
      this.r.ghost = { type: 'poly', pts, ok, h: spec.area ? 0.6 : (spec.levels || 1) * 3.3 };
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
  canPlace(spec, x, y, pts) {
    const w = this.w, zid = w.zoneAt(x, y);
    if (!zid) return { ok: false, why: 'Outside city limits' };
    if (spec.area) {
      const c = w.cellOf(x, y);
      return w.areaK[c] === 4 ? { ok: false, why: 'Water' } : { ok: true };
    }
    if (!w.footprintClear(pts)) return { ok: false, why: 'Something is in the way' };
    if (!w.nearestRoad(x, y, 80)) return { ok: false, why: 'Needs street access within 80 m' };
    if (spec.kind === 'adu') {
      const host = this.hostHouse(x, y);
      if (!host) return { ok: false, why: 'An ADU must be on the lot of an existing home' };
    }
    if (!spec.private && !SG.zoneAllows(zid, spec)) return { ok: false, why: `Not allowed in ${SG.ZONES[zid].code}; rezone to PF first` };
    return { ok: true, meetsZoning: SG.zoneAllows(zid, spec) };
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
    else if (t === 'road') { this.roadStart = this.snapRoad(x, y); }
  }
  toolDrag(x, y) {
    const t = this.tool;
    if (t.startsWith('zone:')) { this.paintZone(x, y); this.toolHover(x, y); }
    else if (t === 'road' && this.roadStart) {
      const [ex, ey] = this.snapRoad(x, y);
      const len = Math.hypot(ex - this.roadStart[0], ey - this.roadStart[1]);
      this.r.ghost = { type: 'line', pts: [...this.roadStart, ex, ey], ok: len > 10 && this.sim.funds > len * 900 };
      this.r.dirty = true;
      this.$('hint').textContent = `New street: ${Math.round(len)} m, ${SG.fmtMoney(len * 900)}`;
    }
  }
  toolUp(x, y) {
    const t = this.tool, sim = this.sim, w = this.w;
    if (t.startsWith('zone:')) { this.g.onWorldChange(); return; }
    if (t === 'road' && this.roadStart) {
      const [ex, ey] = this.snapRoad(x, y);
      const len = Math.hypot(ex - this.roadStart[0], ey - this.roadStart[1]);
      if (len > 10 && sim.spend(len * 900, 'a new street')) {
        w.addRoad([...this.roadStart, ex, ey], 3, 'New street');
        sim._roadsDirty = true;
        sim.say(`New street built: ${Math.round(len)} m.`);
        this.g.onWorldChange();
      }
      this.roadStart = null; this.r.ghost = null; this.setTool('road');
      return;
    }
    if (t === 'bulldoze') {
      const b = w.buildingAt(x, y);
      if (b) {
        if (!b.inCity) { sim.say("That building is outside Saratoga's city limits."); return; }
        const cost = b.player ? 20000 : 60000 + b.value * 0.0;
        if (!b.player && b.units && !confirm(`Demolish ${w.addressOf(b) || 'this home'}? The city has to buy it first: ${SG.fmtMoney(b.value * 1.6)}.`)) return;
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
        if (rd.cls <= 1 && !confirm(`${rd.name || 'This road'} is a major road. Remove this segment anyway?`)) return;
        if (!sim.spend(rd.len * 150, 'road removal')) return;
        w.removeRoad(rd); sim._roadsDirty = true;
        sim.say(`Removed a ${Math.round(rd.len)} m segment of ${rd.name || 'road'}.`);
        this.r.selected = null; this.g.onWorldChange();
      }
      return;
    }
    if (t.startsWith('build:')) this.placeBuild(t.slice(6), x, y);
  }

  placeBuild(key, x, y) {
    const spec = SG.BUILDS[key], sim = this.sim, w = this.w;
    const nr = w.nearestRoad(x, y, 120);
    const pts = SG.World.rect(x, y, spec.w, spec.d, nr ? nr.angle : 0);
    const chk = this.canPlace(spec, x, y, pts);
    if (!chk.ok) { sim.say(`Can't build here: ${chk.why}.`); return; }
    if (spec.area) {
      if (!sim.spend(spec.cost, 'a park')) return;
      w.addPark(x, y, spec.w, spec.d);
      sim.say(`New ${spec.w * spec.d / 10000 * 2.47 | 0}-acre park opens${nr && nr.road.name ? ' on ' + nr.road.name : ''}.`);
      this.g.onWorldChange(); return;
    }
    if (!spec.private) {
      if (!sim.spend(spec.cost, spec.label)) return;
      const b = w.placeBuilding(x, y, spec, { service: spec.service, radius: spec.radius, upkeep: spec.upkeep, name: 'New ' + spec.label.replace('Stn', 'Station').replace('Comm. Ctr', 'Community Center') });
      b.built = sim.year;
      sim.say(`${b.name} opens${b.street ? ' on ' + b.street : ''}.`, true);
      this.g.onWorldChange(); return;
    }
    // private project: goes through planning review
    const app = { build: key, x, y, why: 'Filed by you', ministerial: !!spec.ministerial, byPlayer: true };
    if (key === 'adu') app.host = this.hostHouse(x, y)?.id;
    sim.autoApprove = false;
    sim.addApp(app);
    sim.autoApprove = this.$('auto-approve').checked;
    const filed = sim.apps.find(a => a.id === sim.nextAppId - 1);
    if (filed && filed.check.ok) { sim.approve(filed); sim.funds += spec.fee || 0; }
    else if (filed) sim.say(`${spec.label} filed on ${filed.street} needs a variance (${filed.check.issues.join('; ')}). Decide in the Planning Commission panel.`);
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
      if (!w.inCity[i] || w.zone[i] === zid) continue;
      w.zone[i] = zid; changed++;
    }
    if (changed) {
      this.zoneChanges = (this.zoneChanges || 0) + changed;
      this.sim.funds -= changed * 400; // staff time, CEQA review, public hearings
      this.r.zoneDirty = true; this.r.dirty = true;
      clearTimeout(this._zt);
      this._zt = setTimeout(() => {
        const acres = this.zoneChanges * SG.CELL * SG.CELL / 4046.86;
        this.sim.say(`City Council rezones ${acres.toFixed(1)} acres to ${SG.ZONES[zid].code} (${SG.fmtMoney(this.zoneChanges * 400)} in studies and hearings).`);
        if (zid === SG.Z.MU || zid === SG.Z.R_M) this.sim.approval -= Math.min(4, acres / 10);
        this.zoneChanges = 0;
      }, 600);
    }
  }

  snapRoad(x, y) {
    let best = null, bd = 25 / Math.max(0.3, this.r.scale) + 8;
    for (const r of this.w.roadsIn([x - 40, y - 40, x + 40, y + 40])) {
      if (r.cls > 4) continue;
      const p = r.pts;
      for (let i = 0; i < p.length; i += 2) { const d = Math.hypot(p[i] - x, p[i + 1] - y); if (d < bd) { bd = d; best = [p[i], p[i + 1]]; } }
    }
    return best || [x, y];
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
      const cls = ['Freeway', 'Arterial', 'Collector', 'Residential street', 'Service road / driveway', 'Track', 'Path or trail'][o.cls];
      el.innerHTML = `<div class="ititle">${o.name || 'Unnamed ' + cls.toLowerCase()}</div><div class="isub">${cls}</div>` +
        kv([['Segment length', Math.round(o.len) + ' m'], ['Source', o.player ? 'Built in game' : 'OpenStreetMap']]);
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
      ['Source', b.original ? 'OpenStreetMap footprint' : 'Built in game'],
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
  modal(html) { this.$('modal-body').innerHTML = html; this.$('modal').classList.remove('hidden'); }
  closeModal() { this.$('modal').classList.add('hidden'); }
  intro() {
    const m = window.SARATOGA_MAP, n = m.buildings.filter(b => b.in).length;
    this.modal(`<h2>Welcome to Saratoga</h2>
      <p>You're the planning director of <b>Saratoga, California</b>, a town of about 31,000 people in the foothills of the Santa Cruz Mountains.
      The map is built from <b>${SG.fmtInt(n)} real building footprints</b> and Saratoga's real streets, parks and creeks${m.synthetic ? ' (an approximate stand-in map: run <code>tools/fetch_osm.py</code> to load the real one)' : ', taken from OpenStreetMap'}.</p>
      <p>The state says Saratoga must plan for <b>${SG.fmtInt(SG.RHNA.target)} new homes</b> by 2031. Rezone land, decide on development projects, and keep the budget and residents happy.
      Fall too far behind and developers can use the <i>builder's remedy</i> to skip local zoning.</p>
      <ul>
        <li><b>Inspect</b> (drag to pan, scroll or pinch to zoom). Click anything to see its details.</li>
        <li><b>Zoning</b> tools paint districts: R-1-40,000 hillside lots, the Village (C-H), mixed-use housing sites (MU)…</li>
        <li><b>Private</b> tools file projects. ADUs and SB 9 duplexes must be approved by state law.</li>
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
      <p class="muted">Map data © OpenStreetMap contributors (ODbL), generated ${window.SARATOGA_MAP.generated}. Zoning districts are inferred from what is built and simplified for play; this is not the official Saratoga zoning map.</p>`);
    if (this.$('m-gfx')) this.$('m-gfx').onchange = e => this.g.r3d.setGfx(e.target.value);
    this.$('m-save').onclick = () => { this.g.save(); this.closeModal(); };
    this.$('m-load').onclick = () => { this.g.load(); this.closeModal(); };
    this.$('m-new').onclick = () => { if (confirm('Throw away this city and start over?')) { this.g.newGame(); this.closeModal(); } };
    this.$('m-help').onclick = () => this.intro();
    this.$('m-close').onclick = () => this.closeModal();
  }
};
const SQFT_ = 0.092903;
