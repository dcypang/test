'use strict';
// ---------------------------------------------------------------------------
// Computer opponent. Plays by the same rules and queues as the human; the
// difficulty level only scales its income and build speed, and its patience.
// ---------------------------------------------------------------------------
const AI_PLAN = [
  ['mill', 1], ['mint', 1], ['barracks', 1], ['watchtower', 1], ['stable', 1], ['mill', 2], ['mint', 2], ['beacon', 1],
  ['AGE', 1],
  ['siegeworks', 1], ['watchtower', 2], ['mill', 3], ['bolttower', 1], ['academy', 1], ['bolttower', 2], ['mill', 4],
  ['AGE', 2],
  ['bombardtower', 1], ['skyfire', 1], ['mill', 5], ['bolttower', 3], ['bombardtower', 2], ['watchtower', 3],
];
const AI_FOOT = { spearman: [3, 1.5, 0.6], archer: [3, 1.5, 0.6], swordsman: [0, 4, 3], arbalest: [0, 3, 2.5], friar: [0, 0.6, 0.7], handgunner: [0, 0, 4] };
const AI_MOUNT = { outrider: [1.5, 0.6, 0.3], knight: [0, 4, 4], ram: [0, 1.2, 1.2], mangonel: [0, 1.5, 1.5], trebuchet: [0, 0, 1.6] };

class AIPlayer {
  constructor(p, diff) {
    this.p = p; this.diff = diff;
    this.t = 0.5 + p.id * 0.37;
    this.state = 'gather';
    this.waveSize = diff.wave; this.wave = 0;
    this.defT = 0; this.target = null; this.failPlace = 0; this.retargetT = 0;
  }
  enemy() { return G.players[1 - this.p.id]; }
  home() {
    for (const b of G.blds) if (b.owner === this.p.id && b.type === 'keep') return b;
    for (const b of G.blds) if (b.owner === this.p.id && b.type !== 'palisade') return b;
    return null;
  }
  enemyBase() {
    const e = this.enemy();
    for (const b of G.blds) if (b.owner === e.id && b.type === 'keep') return b;
    for (const b of G.blds) if (b.owner === e.id) return b;
    return G.map.bases[e.id];
  }
  rallyPt() {
    const h = this.home() || G.map.bases[this.p.id], e = this.enemyBase();
    const dx = e.x - h.x, dy = e.y - h.y, d = Math.hypot(dx, dy) || 1;
    const f = G.map.nearestFree(h.x + dx / d * 8, h.y + dy / d * 8, 10);
    return { x: f.x + 0.5, y: f.y + 0.5 };
  }
  count(type) {
    let n = 0;
    for (const b of G.blds) if (b.owner === this.p.id && b.type === type) n++;
    for (const c of CATS) { const q = this.p.queues[c]; if (q.ready === type) n++; for (const it of q.items) if (it.type === type) n++; }
    return n;
  }
  countUnits(type) {
    let n = 0;
    for (const u of G.units) if (u.owner === this.p.id && u.type === type) n++;
    for (const it of this.p.queues[UNITS[type].tab].items) if (it.type === type) n++;
    return n;
  }
  army() { return G.units.filter(u => u.owner === this.p.id && (u.def.weapon || u.def.heal)); }

  update(dt) {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 1;
    if (!this.home()) { this.manageArmy(); return; }
    this.manageBuild();
    this.managePlace();
    this.manageUnits();
    this.manageArmy();
    this.manageExtras();
  }

  manageBuild() {
    const p = this.p;
    const free = { build: !p.queues.build.ready && !p.queues.build.items.length, defense: !p.queues.defense.ready && !p.queues.defense.items.length };
    for (const [type, n] of AI_PLAN) {
      if (type === 'AGE') {
        if (p.age >= n) continue;
        if (!p.ageUp && ageUpStatus(p).ok && p.coin > AGES[n].cost * 0.4) startAgeUp(p);
        break;
      }
      if (this.count(type) >= n) continue;
      const d = BUILDINGS[type];
      if (!free[d.tab]) continue;
      if (!availability(p, type).ok) continue;
      // keep the grain positive: slip a windmill in first if this would brown out
      if (d.grain < 0 && p.grainMake - p.grainUse + d.grain < 0 && free.build && this.pendingGrain() <= 0) {
        if (queueItem(p, 'mill').ok) free.build = false;
        if (d.tab === 'build') continue;
      }
      if (d.tab === 'defense' && p.coin < d.cost * 0.6) continue;
      if (queueItem(p, type).ok) free[d.tab] = false;
    }
    if (p.lowGrain && free.build && this.pendingGrain() <= 0) queueItem(p, 'mill');
  }
  pendingGrain() {
    let n = 0; const q = this.p.queues.build;
    if (q.ready === 'mill') n++;
    for (const it of q.items) if (it.type === 'mill') n++;
    for (const b of G.blds) if (b.owner === this.p.id && b.type === 'mill' && b.built < 1) n++;
    return n;
  }

  managePlace() {
    const p = this.p;
    for (const cat of ['build', 'defense']) {
      const q = p.queues[cat];
      if (!q.ready) continue;
      const s = this.findSpot(q.ready);
      if (s) {
        const b = placeReady(p, cat, s.x, s.y);
        if (b) { this.failPlace = 0; if (b.type === 'barracks' || b.type === 'stable' || b.type === 'siegeworks') b.rally = this.rallyPt(); continue; }
      }
      if (++this.failPlace > 25) { cancelItem(p, q.ready); this.failPlace = 0; }
    }
  }

  findSpot(type) {
    const p = this.p, d = BUILDINGS[type], m = G.map, n = m.n, h = this.home();
    if (!h) return null;
    const e = this.enemyBase(), R = 15;
    const ex = e.x - h.x, ey = e.y - h.y, el = Math.hypot(ex, ey) || 1;
    const isDef = d.tab === 'defense';
    let golds = null;
    if (type === 'mint') {
      golds = [];
      for (let y = Math.max(0, h.ty - 22); y < Math.min(n, h.ty + 25); y++) for (let x = Math.max(0, h.tx - 22); x < Math.min(n, h.tx + 25); x++) if (m.gold[y * n + x] > 0) golds.push([x + 0.5, y + 0.5]);
    }
    let best = null, bs = 1e9;
    for (let ty = Math.floor(h.y - R); ty <= h.y + R; ty++) for (let tx = Math.floor(h.x - R); tx <= h.x + R; tx++) {
      if (!canPlace(p, type, tx, ty)) continue;
      // keep a walkable lane around ordinary buildings
      let ok = true;
      if (!isDef) {
        for (let y = ty - 1; y <= ty + d.h && ok; y++) for (let x = tx - 1; x <= tx + d.w; x++) {
          if (x >= tx && x < tx + d.w && y >= ty && y < ty + d.h) continue;
          if (!m.inb(x, y) || m.occ[y * n + x]) { ok = false; break; }
        }
      } else {
        for (let y = ty - 1; y <= ty + d.h && ok; y++) for (let x = tx - 1; x <= tx + d.w; x++) if (m.inb(x, y) && m.occ[y * n + x]) { ok = false; break; }
      }
      if (!ok) continue;
      const cx = tx + d.w / 2, cy = ty + d.h / 2, dk = Math.hypot(cx - h.x, cy - h.y);
      const along = ((cx - h.x) * ex + (cy - h.y) * ey) / el;
      let s;
      if (type === 'mint') {
        let gd = 1e9;
        for (const g of golds) { const dd = Math.hypot(g[0] - cx, g[1] - cy); if (dd < gd) gd = dd; }
        if (gd < 2.6) continue;
        s = gd * 2 + dk * 0.3;
      } else if (isDef) {
        s = Math.abs(dk - 7.5) * 1.2 - along * 0.5 + G.rng() * 3;
      } else if (type === 'mill' || type === 'skyfire' || type === 'academy') {
        s = dk + along * 0.5 + G.rng();
      } else s = dk + G.rng();
      if (s < bs) { bs = s; best = { x: tx, y: ty }; }
    }
    return best;
  }

  pick(table) {
    const p = this.p; let tot = 0; const opts = [];
    for (const k in table) { const w = table[k][p.age]; if (w > 0 && availability(p, k).ok) { opts.push([k, w]); tot += w; } }
    if (!opts.length) return null;
    let r = G.rng() * tot;
    for (const [k, w] of opts) { r -= w; if (r <= 0) return k; }
    return opts[0][0];
  }

  manageUnits() {
    const p = this.p, q = p.queues, armyN = this.army().length;
    const mints = p.has.mint || 0;
    if (p.has.stable && mints && this.countUnits('oxcart') < Math.min(mints * 2, 5) && !q.mount.items.some(i => i.type === 'oxcart')) queueItem(p, 'oxcart');
    if (armyN >= this.diff.cap) return;
    if (p.coin < 350 && armyN > 4) return;
    // do not starve an age advance or a big building
    const saving = p.ageUp || (q.build.items[0] && q.build.items[0].stalled);
    if (saving && armyN > 8) return;
    if (p.has.barracks && q.foot.items.length < 2) { const k = this.pick(AI_FOOT); if (k) queueItem(p, k); }
    if (p.has.stable && q.mount.items.length < 2 && p.coin > 600) { const k = this.pick(AI_MOUNT); if (k) queueItem(p, k); }
  }

  pickTarget(from) {
    const e = this.enemy(); let best = null, bs = 1e9;
    for (const b of G.blds) {
      if (b.owner !== e.id) continue;
      const s = Math.hypot(b.x - from.x, b.y - from.y) + (b.type === 'palisade' ? 30 : 0);
      if (s < bs) { bs = s; best = b; }
    }
    if (!best) for (const u of G.units) { if (u.owner !== e.id) continue; const s = Math.hypot(u.x - from.x, u.y - from.y); if (s < bs) { bs = s; best = u; } }
    return best;
  }

  manageArmy() {
    const army = this.army();
    if (!army.length) { this.state = 'gather'; return; }
    const rally = this.rallyPt();
    if (this.state === 'gather') {
      for (const u of army) if (u.order.t === 'idle' && Math.hypot(u.x - rally.x, u.y - rally.y) > 6) orderAMove(u, rally.x + (G.rng() - 0.5) * 4, rally.y + (G.rng() - 0.5) * 4);
      const fighters = army.filter(u => u.def.weapon).length;
      if (G.time > this.diff.first && fighters >= this.waveSize) {
        this.state = 'attack'; this.wave++;
        this.waveSize = Math.min(this.diff.maxWave, this.waveSize + this.diff.grow);
        this.target = null; this.retargetT = 0;
      }
    }
    if (this.state === 'attack') {
      if (army.filter(u => u.def.weapon).length <= 2) {
        this.state = 'gather';
        for (const u of army) orderMove(u, rally.x + (G.rng() - 0.5) * 3, rally.y + (G.rng() - 0.5) * 3);
        return;
      }
      let cx = 0, cy = 0; for (const u of army) { cx += u.x; cy += u.y; } cx /= army.length; cy /= army.length;
      let t = this.target ? G.byId.get(this.target) : null;
      const fresh = !t || t.dead || t.owner === this.p.id;
      if (fresh) { t = this.pickTarget({ x: cx, y: cy }); this.target = t ? t.id : null; }
      if (!t) return;
      for (const u of army) {
        if (fresh || u.order.t === 'idle') {
          if (u.def.weapon && u.def.weapon.bOnly && t.kind === 'b') orderAttack(u, t);
          else orderAMove(u, t.x + (G.rng() - 0.5) * 2, t.y + (G.rng() - 0.5) * 2);
        }
      }
    }
  }

  onAttacked(victim, src) {
    if (G.time < this.defT) return;
    const h = this.home();
    if (!h) return;
    if (victim.kind === 'u' && !victim.def.cart) return;
    if (Math.hypot(victim.x - h.x, victim.y - h.y) > 22) return;
    this.defT = G.time + 3;
    for (const u of this.army()) {
      if (this.state === 'attack' && Math.hypot(u.x - h.x, u.y - h.y) > 16) continue;
      if (u.order.t === 'attack' && !u.order.auto) continue;
      orderAMove(u, src.x + (G.rng() - 0.5) * 2, src.y + (G.rng() - 0.5) * 2);
    }
  }

  manageExtras() {
    const p = this.p, e = this.enemy();
    for (const b of G.blds) {
      if (b.owner !== p.id || b.built < 1) continue;
      if (!b.repairing && b.hp < b.maxHp * 0.6 && p.coin > 400 && b.type !== 'palisade') b.repairing = true;
      if (b.type === 'skyfire' && b.charge >= SKY_T && !p.lowGrain) {
        let best = null, bs = -1;
        for (const t of G.blds) {
          if (t.owner !== e.id) continue;
          let s = 0;
          for (const o of G.blds) if (o.owner === e.id && Math.hypot(o.x - t.x, o.y - t.y) < 3.5) s += o.def.cost;
          if (s > bs) { bs = s; best = t; }
        }
        if (best) launchSkyfire(p, b, best.x, best.y);
      }
    }
  }
}
