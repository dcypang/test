'use strict';
// ---------------------------------------------------------------------------
// Simulation: players, entities, economy, production queues, combat
// ---------------------------------------------------------------------------
let G = null;
const CATS = ['build', 'defense', 'foot', 'mount'];
const CELL = 2;

function makePlayer(id, colorIdx, diff) {
  return {
    id, col: TEAM_COLORS[colorIdx], coin: START_COIN, shown: START_COIN, age: 0, ageUp: null,
    grainMake: 0, grainUse: 0, lowGrain: false, has: {},
    queues: { build: { items: [], ready: null }, defense: { items: [], ready: null }, foot: { items: [] }, mount: { items: [] } },
    mult: { income: diff ? diff.income : 1, build: diff ? diff.build : 1 },
    stats: { built: 0, trained: 0, kills: 0, lost: 0, razed: 0, earned: 0 },
    hawkCd: 0, defeated: false, ai: null, alertT: {}, primary: {},
  };
}

function newGame(opts) {
  const seed = opts.seed || ((Math.random() * 1e9) | 0);
  const map = new GameMap(MAP_N, seed);
  const n = map.n, cn = Math.ceil(n / CELL);
  G = {
    opts, map, time: 0, tickN: 0, ents: [], byId: new Map(), nextId: 1, units: [], blds: [],
    projs: [], parts: [], decals: [], floaters: [], pings: [], reveals: [], msgs: [],
    players: [], over: null, rng: mulberry32(seed ^ 0x9e3779b9), pathBudget: 0, claims: new Map(),
    vis: new Uint8Array(n * n), explored: new Uint8Array(n * n), fogDirty: true, human: 0,
    cn, cells: Array.from({ length: cn * cn }, () => []), lastEvent: null, shake: 0,
  };
  const diff = DIFFS[opts.diff || 'normal'];
  G.players.push(makePlayer(0, opts.color || 0, opts.demo ? diff : null));
  G.players.push(makePlayer(1, opts.enemyColor === undefined ? 1 : opts.enemyColor, diff));
  for (const p of G.players) {
    const b = map.bases[p.id];
    addBuilding('keep', p.id, b.x - 1, b.y - 1, true);
    const dir = p.id === 0 ? -1 : 1;
    addUnit('spearman', p.id, b.x + 0.5 - dir * 0.2, b.y + 0.5 - dir * 3.2);
    addUnit('spearman', p.id, b.x + 0.5 - dir * 1.4, b.y + 0.5 - dir * 3.2);
    addUnit('outrider', p.id, b.x + 0.5 + dir * -3.2, b.y + 0.5 - dir * 1);
  }
  G.players[1].ai = new AIPlayer(G.players[1], diff);
  if (opts.demo) G.players[0].ai = new AIPlayer(G.players[0], diff);
  rebuildLists();
  updateVisibility();
  return G;
}

// ---- entity management ----------------------------------------------------
function addBuilding(type, owner, tx, ty, instant) {
  const d = BUILDINGS[type], m = G.map;
  const b = {
    id: G.nextId++, kind: 'b', type, def: d, owner, tx, ty, w: d.w, h: d.h, x: tx + d.w / 2, y: ty + d.h / 2,
    hp: d.hp, maxHp: d.hp, built: instant ? 1 : 0, cool: 0, scan: G.rng() * 0.4, target: 0, repairing: false,
    rally: null, charge: 0, flash: 0, lastHit: -99, dead: false,
  };
  for (let y = ty; y < ty + d.h; y++) for (let x = tx; x < tx + d.w; x++) {
    const i = y * m.n + x; m.solid[i] = 1; m.occ[i] = b.id; m.gold[i] = 0;
  }
  G.ents.push(b); G.byId.set(b.id, b);
  for (const u of G.ents) {
    if (u.kind !== 'u' || u.dead) continue;
    if (u.x >= tx && u.x < tx + d.w && u.y >= ty && u.y < ty + d.h) {
      const f = m.nearestFree(u.x, u.y, 8); u.x = f.x + 0.5; u.y = f.y + 0.5; u.path = null;
    }
  }
  recalcPlayer(G.players[owner]);
  if (instant) onBuilt(b);
  return b;
}

function onBuilt(b) {
  const p = G.players[b.owner];
  recalcPlayer(p);
  if (b.type === 'mint') {
    const f = G.map.nearestFree(b.x - 0.5, b.y + b.h / 2 + 0.6, 6);
    const c = addUnit('oxcart', b.owner, f.x + 0.5, f.y + 0.5);
    c.order = { t: 'harvest', s: 'seek' };
  }
}

function addUnit(type, owner, x, y) {
  const d = UNITS[type];
  const u = {
    id: G.nextId++, kind: 'u', type, def: d, owner, x, y, hp: d.hp, maxHp: d.hp, dir: owner === 0 ? 1 : -1,
    order: { t: 'idle' }, path: null, pi: 0, goal: null, pathT: 0, cool: 0, scan: G.rng() * 0.5, anim: G.rng(),
    moving: false, atkAnim: 0, flash: 0, vet: 0, xp: 0, guard: { x, y }, cargo: 0, cargoVal: 0, idleT: 0,
    setupT: 0, lastHit: -99, dead: false, healT: 0,
  };
  G.ents.push(u); G.byId.set(u.id, u);
  return u;
}

function freeTiles(b) {
  const m = G.map;
  for (let y = b.ty; y < b.ty + b.h; y++) for (let x = b.tx; x < b.tx + b.w; x++) {
    const i = y * m.n + x;
    if (m.occ[i] === b.id) { m.solid[i] = 0; m.occ[i] = 0; }
  }
}

function recalcPlayer(p) {
  p.has = {}; p.grainMake = 0; p.grainUse = 0;
  for (const b of G.ents) {
    if (b.kind !== 'b' || b.dead || b.owner !== p.id) continue;
    const g = b.def.grain || 0;
    if (b.built >= 1) { p.has[b.type] = (p.has[b.type] || 0) + 1; if (g > 0) p.grainMake += g; }
    if (g < 0) p.grainUse -= g;
  }
  const was = p.lowGrain;
  p.lowGrain = p.grainUse > p.grainMake;
  if (p.lowGrain && !was && p.id === G.human && G.time > 1) notify('Grain is running short — build a Windmill', 'warn');
}

function rebuildLists() {
  G.units.length = 0; G.blds.length = 0;
  for (const c of G.cells) c.length = 0;
  for (const e of G.ents) {
    if (e.dead) continue;
    if (e.kind === 'u') {
      G.units.push(e);
      const cx = clamp((e.x / CELL) | 0, 0, G.cn - 1), cy = clamp((e.y / CELL) | 0, 0, G.cn - 1);
      G.cells[cy * G.cn + cx].push(e);
    } else G.blds.push(e);
  }
}

function forUnitsNear(x, y, r, fn) {
  const x0 = clamp(((x - r) / CELL) | 0, 0, G.cn - 1), x1 = clamp(((x + r) / CELL) | 0, 0, G.cn - 1);
  const y0 = clamp(((y - r) / CELL) | 0, 0, G.cn - 1), y1 = clamp(((y + r) / CELL) | 0, 0, G.cn - 1);
  for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
    const c = G.cells[cy * G.cn + cx];
    for (let i = 0; i < c.length; i++) fn(c[i]);
  }
}

// distance from entity a's centre to entity t (rect for buildings)
function entDist(a, t) {
  if (t.kind === 'b') return rectDist(a.x, a.y, t.tx, t.ty, t.tx + t.w, t.ty + t.h);
  return Math.hypot(a.x - t.x, a.y - t.y);
}

function visibleTo(owner, t) {
  if (owner !== G.human || G.players[owner].ai || G.opts.reveal) return true;
  const m = G.map;
  if (t.kind === 'b') return G.explored[clamp(Math.floor(t.y), 0, m.n - 1) * m.n + clamp(Math.floor(t.x), 0, m.n - 1)] === 1;
  return G.vis[clamp(Math.floor(t.y), 0, m.n - 1) * m.n + clamp(Math.floor(t.x), 0, m.n - 1)] === 1;
}

// ---- messages & effects ---------------------------------------------------
function notify(text, kind, x, y) {
  G.msgs.push({ text, kind: kind || 'info', t: G.time });
  if (G.msgs.length > 30) G.msgs.shift();
  if (x !== undefined) { G.pings.push({ x, y, t: G.time, kind: kind || 'info' }); G.lastEvent = { x, y }; }
}
function alertOnce(p, key, gap, text, kind, x, y, sfx) {
  if (p.id !== G.human) return;
  if (G.time - (p.alertT[key] || -99) < gap) return;
  p.alertT[key] = G.time;
  notify(text, kind, x, y);
  if (sfx) Sfx.play(sfx);
}

function part(kind, x, y, z, o) {
  if (G.parts.length > 900) return;
  G.parts.push(Object.assign({ kind, x, y, z, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 3 }, o));
}
function fxExplosion(x, y, size, z) {
  const r = G.rng, zz = z || 4;
  part('flash', x, y, zz + 8, { max: 0.28, size: 34 * size });
  part('ring', x, y, 0, { max: 0.5, size: 36 * size });
  for (let i = 0; i < 7 * size; i++) part('fire', x + (r() - 0.5) * 0.6 * size, y + (r() - 0.5) * 0.6 * size, zz + r() * 10, { vz: 14 + r() * 30, max: 0.35 + r() * 0.4, size: 5 + r() * 6 * size });
  for (let i = 0; i < 6 * size; i++) part('smoke', x + (r() - 0.5) * 0.8 * size, y + (r() - 0.5) * 0.8 * size, zz + 8, { vz: 14 + r() * 18, max: 1.1 + r() * 1.0, size: 6 + r() * 7 * size, vx: 0.12, vy: -0.05 });
  for (let i = 0; i < 6 * size; i++) { const a = r() * 6.28, s = 1 + r() * 2.8; part('debris', x, y, zz + 4, { vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: 30 + r() * 60, max: 0.8 + r() * 0.6, size: 1.6 + r() * 2, col: r() > 0.5 ? '#3a2e24' : '#7a7468' }); }
  for (let i = 0; i < 5 * size; i++) { const a = r() * 6.28, s = 1.5 + r() * 3; part('spark', x, y, zz + 6, { vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: 40 + r() * 60, max: 0.5 + r() * 0.5, size: 2.2, grav: 1 }); }
}
function fxHit(x, y, z) {
  const r = G.rng;
  for (let i = 0; i < 3; i++) { const a = r() * 6.28; part('spark', x, y, z, { vx: Math.cos(a) * 1.6, vy: Math.sin(a) * 1.6, vz: 10 + r() * 30, max: 0.22 + r() * 0.15, size: 1.8, grav: 1 }); }
}
function fxDust(x, y, n) {
  const r = G.rng;
  for (let i = 0; i < n; i++) part('dust', x + (r() - 0.5) * 0.6, y + (r() - 0.5) * 0.6, 2, { vz: 6 + r() * 8, max: 0.5 + r() * 0.4, size: 3 + r() * 3 });
}
function floater(text, x, y, col) { G.floaters.push({ text, x, y, t: G.time, col: col || '#ffe27a' }); }

// ---- availability & production -------------------------------------------
function availability(p, type) {
  const d = defOf(type);
  if (d.kind === 'b' && !p.has.keep) return { ok: false, why: 'Requires a Keep' };
  if (d.kind === 'u' && !p.has[d.from]) return { ok: false, why: 'Requires ' + BUILDINGS[d.from].name };
  if (d.age > p.age) return { ok: false, why: 'Requires ' + AGES[d.age].name };
  for (const r of d.req) if (!p.has[r]) return { ok: false, why: 'Requires ' + BUILDINGS[r].name };
  return { ok: true };
}
function catOf(type) { return defOf(type).tab; }

function queueItem(p, type) {
  const a = availability(p, type);
  if (!a.ok) return { ok: false, why: a.why };
  const cat = catOf(type), q = p.queues[cat];
  if (cat === 'build' || cat === 'defense') {
    if (q.ready || q.items.length) return { ok: false, why: 'Builders are busy' };
    q.items.push({ type, progress: 0, paid: 0 });
  } else {
    if (q.items.length >= 24) return { ok: false, why: 'Queue is full' };
    q.items.push({ type, progress: 0, paid: 0 });
  }
  return { ok: true };
}

function cancelItem(p, type) {
  const cat = catOf(type), q = p.queues[cat];
  if (q.ready === type) { q.ready = null; p.coin += defOf(type).cost; return true; }
  for (let i = q.items.length - 1; i >= 0; i--) {
    if (q.items[i].type === type) { p.coin += q.items[i].paid; q.items.splice(i, 1); return true; }
  }
  return false;
}

function producersOf(p, type) {
  const out = [];
  for (const b of G.blds) if (b.owner === p.id && b.type === type && b.built >= 1) out.push(b);
  return out;
}

function updateProduction(p, dt) {
  const slow = p.lowGrain ? 0.5 : 1;
  for (const cat of CATS) {
    const q = p.queues[cat];
    const isB = cat === 'build' || cat === 'defense';
    if (isB && !p.has.keep) {
      for (const it of q.items) p.coin += it.paid;
      q.items.length = 0;
      if (q.ready) { p.coin += defOf(q.ready).cost; q.ready = null; }
      continue;
    }
    if (!q.items.length || (isB && q.ready)) continue;
    const it = q.items[0], d = defOf(it.type);
    let n = 1;
    if (!isB) {
      n = p.has[d.from] || 0;
      if (!n) { p.coin += it.paid; q.items.shift(); continue; }
    }
    const speed = slow * p.mult.build * (1 + 0.25 * Math.min(3, n - 1));
    const dp = Math.min(dt * speed / d.time, 1 - it.progress), need = d.cost * dp;
    if (p.coin < need) { it.stalled = true; continue; }
    it.stalled = false; p.coin -= need; it.paid += need; it.progress += dp;
    if (it.progress >= 0.9999) {
      q.items.shift();
      if (isB) {
        q.ready = it.type;
        if (p.id === G.human) { notify(d.name + ' ready to place', 'good'); Sfx.play('ready'); }
      } else spawnUnit(p, it.type);
    }
  }
  if (p.ageUp) {
    const a = AGES[p.age + 1];
    if (!p.has.keep) { p.coin += p.ageUp.paid; p.ageUp = null; }
    else {
      const dp = Math.min(dt * slow * p.mult.build / a.time, 1 - p.ageUp.progress), need = a.cost * dp;
      if (p.coin >= need) {
        p.coin -= need; p.ageUp.paid += need; p.ageUp.progress += dp;
        if (p.ageUp.progress >= 0.9999) {
          p.age++; p.ageUp = null;
          if (p.id === G.human) { notify('You have entered the ' + a.name, 'good'); Sfx.play('age'); }
          else notify('The enemy has entered the ' + a.name, 'warn');
        }
      }
    }
  }
  if (p.hawkCd > 0) p.hawkCd -= dt;
  // rolling coin counter
  const diff = p.coin - p.shown;
  if (Math.abs(diff) < 1) p.shown = p.coin; else p.shown += diff * Math.min(1, dt * 9);
}

function ageUpStatus(p) {
  if (p.age >= AGES.length - 1) return { ok: false, why: 'Final age reached', done: true };
  const a = AGES[p.age + 1];
  if (p.ageUp) return { ok: false, why: 'Advancing…', busy: true };
  if (!p.has.keep) return { ok: false, why: 'Requires a Keep' };
  for (const r of a.req) if (!p.has[r]) return { ok: false, why: 'Requires ' + BUILDINGS[r].name };
  return { ok: true };
}
function startAgeUp(p) {
  const s = ageUpStatus(p);
  if (!s.ok) return s;
  p.ageUp = { progress: 0, paid: 0 };
  return s;
}

function spawnUnit(p, type) {
  const d = UNITS[type];
  let prods = producersOf(p, d.from);
  if (!prods.length) return null;
  let b = prods.find(x => x.id === p.primary[d.from]) || prods[0];
  const f = G.map.nearestFree(b.x - 0.3 + G.rng() * 0.6, b.ty + b.h + 0.5, 6);
  const u = addUnit(type, p.id, f.x + 0.5, f.y + 0.5);
  p.stats.trained++;
  if (d.cart) u.order = { t: 'harvest', s: 'seek' };
  else {
    const r = b.rally || { x: b.x + (G.rng() - 0.5) * 2.4, y: b.ty + b.h + 1.6 + G.rng() * 1.4 };
    const jx = b.rally ? (G.rng() - 0.5) * 1.6 : 0, jy = b.rally ? (G.rng() - 0.5) * 1.6 : 0;
    orderMove(u, r.x + jx, r.y + jy);
  }
  if (p.id === G.human) Sfx.play('unit', 0.6);
  return u;
}

function canPlace(p, type, tx, ty, ignoreAdj) {
  const d = BUILDINGS[type], m = G.map, n = m.n;
  if (tx < 1 || ty < 1 || tx + d.w > n - 1 || ty + d.h > n - 1) return false;
  for (let y = ty; y < ty + d.h; y++) for (let x = tx; x < tx + d.w; x++) {
    const i = y * n + x;
    if (m.solid[i] || m.gold[i] > 0) return false;
  }
  let enemyIn = false;
  forUnitsNear(tx + d.w / 2, ty + d.h / 2, Math.max(d.w, d.h), u => {
    if (u.owner !== p.id && u.x >= tx && u.x < tx + d.w && u.y >= ty && u.y < ty + d.h) enemyIn = true;
  });
  if (enemyIn) return false;
  if (ignoreAdj) return true;
  for (const b of G.blds) {
    if (b.owner !== p.id || b.type === 'palisade') continue;
    const dx = Math.max(0, b.tx - (tx + d.w), tx - (b.tx + b.w)), dy = Math.max(0, b.ty - (ty + d.h), ty - (b.ty + b.h));
    if (Math.max(dx, dy) <= 3) return true;
  }
  return false;
}

function placeReady(p, cat, tx, ty) {
  const q = p.queues[cat];
  if (!q.ready || !canPlace(p, q.ready, tx, ty)) return null;
  const b = addBuilding(q.ready, p.id, tx, ty, false);
  q.ready = null; p.stats.built++;
  fxDust(b.x, b.y, 10);
  Sfx.at('place', b.x, b.y);
  return b;
}

function sellBuilding(b) {
  if (b.dead || b.built < 1) return false;
  const p = G.players[b.owner];
  const refund = Math.round(b.def.cost * 0.5 * b.hp / b.maxHp);
  p.coin += refund;
  b.dead = true; freeTiles(b); recalcPlayer(p);
  fxDust(b.x, b.y, 14);
  if (b.owner === G.human) { floater('+' + refund, b.x, b.y); Sfx.play('coin'); }
  return true;
}

function captureBuilding(b, owner) {
  const old = G.players[b.owner], nu = G.players[owner];
  b.owner = owner; b.target = 0; b.rally = null; b.repairing = false; b.charge = 0;
  recalcPlayer(old); recalcPlayer(nu);
  if (owner === G.human) { notify(b.def.name + ' captured!', 'good', b.x, b.y); Sfx.play('capture'); }
  else alertOnce(old, 'cap', 1, 'Our ' + b.def.name + ' has been seized!', 'bad', b.x, b.y, 'alert');
}

function deployWagon(u) {
  const tx = Math.round(u.x - 1.5), ty = Math.round(u.y - 1.5), p = G.players[u.owner];
  const sx = u.x, sy = u.y; u.x = -99; u.y = -99;
  rebuildLists();
  if (!canPlace(p, 'keep', tx, ty, true)) { u.x = sx; u.y = sy; rebuildLists(); return false; }
  u.dead = true;
  addBuilding('keep', u.owner, tx, ty, false);
  Sfx.at('place', sx, sy);
  return true;
}

function launchSkyfire(p, b, x, y) {
  if (b.charge < SKY_T || p.lowGrain) return false;
  b.charge = 0;
  for (let i = 0; i < 14; i++) {
    const a = G.rng() * 6.28, r = Math.sqrt(G.rng()) * 2.7;
    G.projs.push({ kind: 'rocket', delay: i * 0.16, x0: b.x, y0: b.y, z0: 50, x: b.x, y: b.y, z: 50, tx: x + Math.cos(a) * r, ty: y + Math.sin(a) * r, tz: 0,
      tid: 0, dmg: 115, type: 'fire', splash: 1.7, owner: p.id, src: b.id, t: 0, dur: 3.4, arcPx: 260 });
  }
  Sfx.play('siren');
  const other = G.players[1 - p.id];
  if (p.id === G.human) notify('Skyfire barrage away!', 'good');
  else if (other.id === G.human) notify('Enemy Skyfire launched — take cover!', 'bad', x, y);
  return true;
}

function useHawk(p, x, y) {
  if (p.hawkCd > 0 || !p.has.beacon || p.lowGrain) return false;
  p.hawkCd = HAWK_T;
  G.reveals.push({ x, y, r: 9, until: G.time + 16, owner: p.id });
  return true;
}

// ---- orders ---------------------------------------------------------------
function setIdle(u) { u.order = { t: 'idle' }; u.path = null; u.goal = null; u.guard = { x: u.x, y: u.y }; u.idleT = 0; u.setupT = 0; }
function setGoalPoint(u, x, y) {
  const m = G.map;
  x = clamp(x, 0.5, m.n - 0.5); y = clamp(y, 0.5, m.n - 0.5);
  if (m.solidAt(x, y)) { const f = m.nearestFree(x, y, 14); x = f.x + 0.5; y = f.y + 0.5; }
  const fx = Math.floor(x), fy = Math.floor(y);
  u.goal = { x0: fx, y0: fy, x1: fx + 1, y1: fy + 1, range: 0, exact: true, px: x, py: y };
  u.path = null;
}
function setGoalEnt(u, t, range) {
  if (t.kind === 'b') u.goal = { x0: t.tx, y0: t.ty, x1: t.tx + t.w, y1: t.ty + t.h, range, id: t.id, tx: t.x, ty: t.y };
  else u.goal = { x0: t.x, y0: t.y, x1: t.x, y1: t.y, range: Math.max(range, 0.75), id: t.id, tx: t.x, ty: t.y };
  u.path = null;
}
function orderMove(u, x, y) { u.order = { t: 'move' }; setGoalPoint(u, x, y); u.setupT = 0; }
function orderAMove(u, x, y) {
  if (!u.def.weapon) return orderMove(u, x, y);
  u.order = { t: 'amove', x, y }; u.goal = null; u.path = null; u.setupT = 0;
}
function orderAttack(u, t) {
  if (!u.def.weapon || (u.def.weapon.bOnly && t.kind !== 'b')) return orderMove(u, t.x, t.y);
  u.order = { t: 'attack', target: t.id }; u.goal = null; u.path = null;
}
function orderHarvest(u, tile) { u.order = { t: 'harvest', s: 'seek', pref: tile }; u.goal = null; u.path = null; }
function orderReturn(u) { u.order = { t: 'harvest', s: 'return' }; u.goal = null; u.path = null; }
function orderCapture(u, t) { u.order = { t: 'capture', target: t.id }; u.goal = null; u.path = null; }

// ---- movement -------------------------------------------------------------
function unitSpeed(u) {
  let s = u.def.speed;
  if (u.def.cart && u.cargo > CART_CAP * 0.5) s *= 0.82;
  if (u.vet === 2) s *= 1.1;
  return s;
}
function smoothPath(u) {
  let k = 0;
  while (k < 4 && u.pi + 1 < u.path.length && G.map.lineClear(u.x, u.y, u.path[u.pi + 1].x, u.path[u.pi + 1].y)) { u.pi++; k++; }
}
// returns true when the path is finished
function followPath(u, dt) {
  const m = G.map;
  if (!u.path) {
    if (!u.goal) return true;
    if (G.pathBudget <= 0) return false;
    G.pathBudget--;
    const g = u.goal, r = m.findPath(u.x, u.y, g.x0, g.y0, g.x1, g.y1, g.range);
    u.path = r.path; u.pi = 0; u.pathT = G.time; u.reached = r.reached;
    if (g.exact && r.reached) { if (u.path.length) u.path[u.path.length - 1] = { x: g.px, y: g.py }; else u.path.push({ x: g.px, y: g.py }); }
    smoothPath(u);
  }
  if (u.pi >= u.path.length) return true;
  const wp = u.path[u.pi];
  if (m.solidAt(wp.x, wp.y) && !m.solidAt(u.x, u.y)) { u.path = null; return false; }
  const dx = wp.x - u.x, dy = wp.y - u.y, dd = Math.hypot(dx, dy), sp = unitSpeed(u) * dt;
  // crowded destination: if others keep shoving us back from the final waypoint, call it arrived
  if (u.pi === u.path.length - 1 && dd < 1.6) {
    if (u.lastDD !== undefined && dd > u.lastDD - sp * 0.35) u.stallT = (u.stallT || 0) + dt; else u.stallT = 0;
    u.lastDD = dd;
    if (u.stallT > 0.35) { u.pi = u.path.length; u.stallT = 0; u.lastDD = undefined; return true; }
  } else { u.stallT = 0; u.lastDD = undefined; }
  if (dd <= sp) { u.x = wp.x; u.y = wp.y; u.pi++; if (u.pi < u.path.length) smoothPath(u); }
  else {
    u.x += dx / dd * sp; u.y += dy / dd * sp;
    const sdx = dx - dy;
    if (Math.abs(sdx) > 0.15 * dd) u.dir = sdx > 0 ? 1 : -1;
  }
  u.moving = true;
  return u.pi >= u.path.length;
}
function face(u, t) { const sdx = (t.x - u.x) - (t.y - u.y); if (Math.abs(sdx) > 0.05) u.dir = sdx > 0 ? 1 : -1; }

function separate() {
  const m = G.map;
  for (const u of G.units) {
    if (u.dead) continue;
    forUnitsNear(u.x, u.y, 1.0, v => {
      if (v.id <= u.id || v.dead) return;
      const min = u.def.r + v.def.r;
      let dx = v.x - u.x, dy = v.y - u.y, d = Math.hypot(dx, dy);
      if (d >= min) return;
      if (d < 0.001) { const a = (u.id * 2.39996) % 6.28; dx = Math.cos(a); dy = Math.sin(a); d = 1; }
      const push = (min - d) * 0.5, px = dx / d * push, py = dy / d * push;
      const fu = u.order.s === 'mine' || u.order.s === 'unload', fv = v.order.s === 'mine' || v.order.s === 'unload';
      if (!fv) { const nx = v.x + px * (fu ? 2 : 1), ny = v.y + py * (fu ? 2 : 1); if (!m.solidAt(nx, ny)) { v.x = nx; v.y = ny; } }
      if (!fu) { const nx = u.x - px * (fv ? 2 : 1), ny = u.y - py * (fv ? 2 : 1); if (!m.solidAt(nx, ny)) { u.x = nx; u.y = ny; } }
    });
  }
}

// ---- combat ---------------------------------------------------------------
function acquire(e, R) {
  const w = e.def.weapon;
  let best = null, bs = 1e9;
  if (!w.bOnly) forUnitsNear(e.x, e.y, R, t => {
    if (t.owner === e.owner || t.dead) return;
    const d = Math.hypot(t.x - e.x, t.y - e.y);
    if (d > R || (w.minRange && d < w.minRange)) return;
    if (!visibleTo(e.owner, t)) return;
    const s = d + (t.def.weapon ? 0 : 2.5);
    if (s < bs) { bs = s; best = t; }
  });
  for (const b of G.blds) {
    if (b.owner === e.owner || b.dead) continue;
    const d = rectDist(e.x, e.y, b.tx, b.ty, b.tx + b.w, b.ty + b.h);
    if (d > R || (w.minRange && d < w.minRange)) continue;
    if (!visibleTo(e.owner, b)) continue;
    const s = d + (b.def.weapon ? 0.6 : 4) + (b.type === 'palisade' ? 8 : 0);
    if (s < bs) { bs = s; best = b; }
  }
  return best;
}

function fireWeapon(e, t, w) {
  const vm = e.kind === 'u' ? [1, 1.25, 1.5][e.vet] : 1;
  e.cool = w.cd * (e.vet === 2 ? 0.8 : 1); e.atkAnim = 0.32;
  const dmg = w.dmg * vm;
  if (!w.proj) {
    applyDamage(t, dmg, w.type, e);
    Sfx.at(w.sfx || 'sword', e.x, e.y);
    if (t.kind === 'u') fxHit(lerp(e.x, t.x, 0.7), lerp(e.y, t.y, 0.7), 12);
    if (w.type === 'ram') fxDust(t.kind === 'b' ? lerp(e.x, t.x, 0.4) : t.x, t.kind === 'b' ? lerp(e.y, t.y, 0.4) : t.y, 4);
  } else {
    const z0 = e.kind === 'b' ? (e.def.fireZ || 40) : 12;
    const d = Math.max(0.5, Math.hypot(t.x - e.x, t.y - e.y));
    G.projs.push({ kind: w.proj, x0: e.x, y0: e.y, z0, x: e.x, y: e.y, z: z0, tx: t.x, ty: t.y, tz: t.kind === 'b' ? 14 : 8,
      tid: w.splash ? 0 : t.id, dmg, type: w.type, splash: w.splash || 0, owner: e.owner, src: e.id, t: 0, dur: Math.max(0.12, d / w.pspeed), arcPx: (w.arc || 0) * d * 32 });
    Sfx.at(w.sfx || (w.proj === 'arrow' ? 'arrow' : 'bolt'), e.x, e.y);
    if (w.proj === 'shot' || w.proj === 'ball') { part('flash', e.x, e.y, z0, { max: 0.12, size: w.proj === 'ball' ? 26 : 11 }); part('smoke', e.x, e.y, z0, { vz: 10, max: 0.9, size: w.proj === 'ball' ? 10 : 4.5, vx: 0.1 }); }
  }
}

function areaDamage(x, y, r, dmg, type, owner, src) {
  forUnitsNear(x, y, r, t => {
    if (t.owner === owner || t.dead) return;
    const d = Math.hypot(t.x - x, t.y - y);
    if (d < r) applyDamage(t, dmg * (1 - 0.6 * d / r), type, src);
  });
  for (const b of G.blds) {
    if (b.owner === owner || b.dead) continue;
    const d = rectDist(x, y, b.tx, b.ty, b.tx + b.w, b.ty + b.h);
    if (d < r) applyDamage(b, dmg * (1 - 0.6 * d / r), type, src);
  }
}

function applyDamage(t, dmg, type, src) {
  if (t.dead) return;
  const arm = t.kind === 'b' ? (t.def.armor || 'building') : t.def.armor;
  t.hp -= dmg * DMG[type][arm];
  t.lastHit = G.time; t.flash = 0.12;
  const p = G.players[t.owner];
  if (t.kind === 'b') alertOnce(p, 'base', 12, 'Our holdings are under attack!', 'bad', t.x, t.y, 'alert');
  else if (t.def.cart) alertOnce(p, 'cart', 12, 'An ox cart is under attack!', 'bad', t.x, t.y, 'alert');
  else alertOnce(p, 'unit', 15, 'Our soldiers are under attack', 'warn', t.x, t.y);
  if (p.ai && src && !src.dead) p.ai.onAttacked(t, src);
  if (t.kind === 'u' && t.order.t === 'idle' && t.def.weapon && src && !src.dead && src.owner !== t.owner && !(t.def.weapon.bOnly && src.kind !== 'b')) {
    t.order = { t: 'attack', target: src.id, auto: true, home: { x: t.guard.x, y: t.guard.y } }; t.goal = null; t.path = null;
  }
  if (t.hp <= 0) kill(t, src);
}

function kill(t, src) {
  t.dead = true; t.hp = 0;
  const p = G.players[t.owner];
  p.stats.lost++;
  if (src && src.owner !== t.owner) {
    const sp = G.players[src.owner];
    if (t.kind === 'b') sp.stats.razed++; else sp.stats.kills++;
    if (src.kind === 'u' && !src.dead && src.def.weapon) {
      src.xp += t.def.cost;
      const need = src.vet === 0 ? src.def.cost * 2 : src.def.cost * 5;
      if (src.vet < 2 && src.xp >= need) {
        src.vet++;
        const k = src.maxHp; src.maxHp = Math.round(src.def.hp * (1 + 0.25 * src.vet)); src.hp += src.maxHp - k;
        if (src.owner === G.human) { floater(src.vet === 2 ? 'Elite!' : 'Veteran!', src.x, src.y, '#fff'); Sfx.at('promote', src.x, src.y); }
      }
    }
  }
  if (t.kind === 'b') {
    freeTiles(t); recalcPlayer(p);
    fxExplosion(t.x, t.y, Math.max(1.2, t.w * 0.9), 10);
    G.decals.push({ kind: 'rubble', x: t.x, y: t.y, w: t.w, h: t.h, t: G.time, life: 70 });
    Sfx.at(t.type === 'palisade' ? 'thud' : 'crash', t.x, t.y);
    if (t.w >= 2) G.shake = Math.max(G.shake, 0.35);
    if (t.owner === G.human) notify(t.def.name + ' destroyed', 'bad', t.x, t.y);
  } else {
    if (t.def.armor === 'engine') { fxExplosion(t.x, t.y, 0.7, 6); Sfx.at('thud', t.x, t.y); }
    else Sfx.at('die', t.x, t.y);
    G.decals.push({ kind: 'corpse', x: t.x, y: t.y, t: G.time, life: 16, big: t.def.armor === 'engine', type: t.type, owner: t.owner, dir: t.dir });
    if (t.def.cart && t.owner === G.human) notify('Ox cart lost', 'bad', t.x, t.y);
  }
}

function updateProjectiles(dt) {
  const ps = G.projs;
  for (let i = ps.length - 1; i >= 0; i--) {
    const p = ps[i];
    if (p.delay > 0) { p.delay -= dt; if (p.delay <= 0) Sfx.at('rocket', p.x0, p.y0); continue; }
    p.t += dt / p.dur;
    let tgt = null;
    if (p.tid) { tgt = G.byId.get(p.tid); if (tgt && !tgt.dead) { p.tx = tgt.x; p.ty = tgt.y; } }
    const k = Math.min(1, p.t);
    p.px = p.x; p.py = p.y; p.pz = p.z;
    p.x = lerp(p.x0, p.tx, k); p.y = lerp(p.y0, p.ty, k);
    p.z = lerp(p.z0, p.tz, k) + p.arcPx * 4 * k * (1 - k);
    if (p.kind === 'rocket' && G.tickN % 2 === 0) part('fire', p.x, p.y, p.z, { max: 0.3, size: 4, vz: -4 });
    if (p.t >= 1) {
      ps.splice(i, 1);
      const src = G.byId.get(p.src) || null;
      if (p.splash) {
        areaDamage(p.tx, p.ty, p.splash, p.dmg, p.type, p.owner, src);
        fxExplosion(p.tx, p.ty, p.kind === 'rocket' ? 1.5 : p.kind === 'stone' ? 0.6 : 0.9, 2);
        if (p.kind !== 'stone') G.decals.push({ kind: 'scorch', x: p.tx, y: p.ty, t: G.time, life: 30 });
        Sfx.at(p.kind === 'rocket' ? 'boom' : 'thud', p.tx, p.ty);
        if (p.kind === 'rocket') G.shake = Math.max(G.shake, 0.3);
      } else if (tgt && !tgt.dead) { applyDamage(tgt, p.dmg, p.type, src); if (p.kind === 'shot' || p.kind === 'bolt') fxHit(p.tx, p.ty, p.tz); }
    }
  }
}

function updateParticles(dt) {
  const ps = G.parts;
  for (let i = ps.length - 1; i >= 0; i--) {
    const p = ps[i];
    p.life += dt;
    if (p.life >= p.max) { ps[i] = ps[ps.length - 1]; ps.pop(); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    if (p.kind === 'debris' || p.grav) { p.vz -= 160 * dt; if (p.z < 0) { p.z = 0; p.vz *= -0.3; p.vx *= 0.5; p.vy *= 0.5; } }
  }
  for (let i = G.decals.length - 1; i >= 0; i--) if (G.time - G.decals[i].t > G.decals[i].life) G.decals.splice(i, 1);
  for (let i = G.floaters.length - 1; i >= 0; i--) if (G.time - G.floaters[i].t > 1.6) G.floaters.splice(i, 1);
  for (let i = G.pings.length - 1; i >= 0; i--) if (G.time - G.pings[i].t > 4) G.pings.splice(i, 1);
  if (G.shake > 0) G.shake = Math.max(0, G.shake - dt);
}

// ---- unit behaviours ------------------------------------------------------
function endAttack(u) {
  const o = u.order;
  u.setupT = 0;
  if (o.resume) { u.order = o.resume; u.goal = null; u.path = null; }
  else if (o.auto && o.home && Math.hypot(u.x - o.home.x, u.y - o.home.y) > 2.5) { orderMove(u, o.home.x, o.home.y); }
  else setIdle(u);
}

function unitAttack(u, dt) {
  const o = u.order, w = u.def.weapon, t = G.byId.get(o.target);
  if (!w || !t || t.dead || t.owner === u.owner || !visibleTo(u.owner, t)) return endAttack(u);
  if (o.auto && !o.resume && o.home && Math.hypot(u.x - o.home.x, u.y - o.home.y) > 9) { orderMove(u, o.home.x, o.home.y); return; }
  const dd = entDist(u, t);
  if (dd <= w.range + 0.1) {
    if (w.minRange && dd < w.minRange) { if (o.auto) endAttack(u); return; }
    face(u, t); u.path = null; u.goal = null; o.stuck = 0;
    if (w.setup && u.setupT < w.setup) { u.setupT += dt; return; }
    if (u.cool <= 0) fireWeapon(u, t, w);
    return;
  }
  u.setupT = 0;
  if (!u.goal || u.goal.id !== t.id || (Math.hypot(u.goal.tx - t.x, u.goal.ty - t.y) > 1 && G.time - u.pathT > 0.5)) setGoalEnt(u, t, Math.max(w.range - 0.35, 0.6));
  if (dd < 2.4 && t.kind === 'u' && G.map.lineClear(u.x, u.y, t.x, t.y)) {
    const dx = t.x - u.x, dy = t.y - u.y, d = Math.hypot(dx, dy) || 1, sp = unitSpeed(u) * dt;
    u.x += dx / d * sp; u.y += dy / d * sp; face(u, t); u.moving = true;
  } else if (followPath(u, dt)) {
    o.stuck = (o.stuck || 0) + dt;
    if (o.stuck > 1.2) { if (o.auto || !u.reached) return endAttack(u); o.stuck = 0; }
    if (G.time - u.pathT > 0.5) u.goal = null;
  }
}

function unitIdle(u, dt) {
  u.scan -= dt;
  if (u.scan > 0) return;
  u.scan = 0.35 + G.rng() * 0.15;
  const d = u.def;
  if (d.weapon) {
    const t = acquire(u, Math.max(d.weapon.range + 1.5, 5));
    if (t) { u.order = { t: 'attack', target: t.id, auto: true, home: { x: u.guard.x, y: u.guard.y } }; u.goal = null; u.path = null; return; }
  }
  if (d.cart) { u.idleT += 0.4; if (u.idleT > 4) u.order = { t: 'harvest', s: u.cargo >= CART_CAP ? 'return' : 'seek' }; }
}

function unitHeal(u, dt) {
  const h = u.def.heal;
  u.healT -= dt;
  if (u.healT > 0) return;
  u.healT = 0.5;
  let best = null, bs = 1;
  forUnitsNear(u.x, u.y, h.range, t => {
    if (t.owner !== u.owner || t.dead || t === u || t.def.armor === 'engine' || t.hp >= t.maxHp) return;
    if (Math.hypot(t.x - u.x, t.y - u.y) > h.range) return;
    const f = t.hp / t.maxHp;
    if (f < bs) { bs = f; best = t; }
  });
  if (best) {
    best.hp = Math.min(best.maxHp, best.hp + h.rate * 0.5);
    u.atkAnim = 0.45; face(u, best);
    part('heal', best.x, best.y, 14, { vz: 14, max: 0.7, size: 3 });
    if (G.rng() < 0.2) Sfx.at('heal', u.x, u.y);
  }
}

function findGold(u, pref) {
  const m = G.map, n = m.n;
  let rx = u.x, ry = u.y;
  if (pref !== undefined && pref >= 0) { rx = (pref % n) + 0.5; ry = ((pref / n) | 0) + 0.5; }
  let best = -1, bs = 1e9;
  for (let i = 0; i < n * n; i++) {
    if (m.gold[i] <= 0 || m.solid[i]) continue;
    if (u.bad && u.bad.has(i)) continue;
    const x = (i % n) + 0.5, y = ((i / n) | 0) + 0.5;
    let s = Math.hypot(x - rx, y - ry) + 0.35 * Math.hypot(x - u.x, y - u.y) - (m.goldKind[i] === 2 ? 1.5 : 0);
    const c = G.claims.get(i);
    if (c && c !== u.id) { const o = G.byId.get(c); if (o && !o.dead && o.order.tile === i) s += 3.5; }
    if (s < bs) { bs = s; best = i; }
  }
  return best;
}

function unitHarvest(u, dt) {
  const o = u.order, m = G.map, n = m.n, p = G.players[u.owner];
  switch (o.s) {
    case 'seek': {
      if (u.cargo >= CART_CAP - 0.5) { o.s = 'return'; u.goal = null; u.path = null; return; }
      if (o.wait > 0) { o.wait -= dt; return; }
      const i = findGold(u, o.pref);
      if (i < 0) { if (u.cargo > 0) { o.s = 'return'; u.goal = null; u.path = null; } else o.wait = 2; return; }
      o.tile = i; G.claims.set(i, u.id);
      setGoalPoint(u, (i % n) + 0.5, ((i / n) | 0) + 0.5); o.s = 'go';
      return;
    }
    case 'go': {
      if (m.gold[o.tile] <= 0) { o.s = 'seek'; return; }
      const tx = (o.tile % n) + 0.5, ty = ((o.tile / n) | 0) + 0.5;
      if (Math.hypot(u.x - tx, u.y - ty) < 0.55) { o.s = 'mine'; u.path = null; u.goal = null; return; }
      if (followPath(u, dt)) {
        if (Math.hypot(u.x - tx, u.y - ty) < 1.2) o.s = 'mine';
        else { (u.bad || (u.bad = new Set())).add(o.tile); o.s = 'seek'; o.wait = 0.5; }
      }
      return;
    }
    case 'mine': {
      const have = m.gold[o.tile];
      if (have <= 0) { m.goldKind[o.tile] = 0; G.claims.delete(o.tile); o.pref = o.tile; o.s = 'seek'; return; }
      const take = Math.min(have, MINE_RATE * dt, CART_CAP - u.cargo);
      m.gold[o.tile] -= take; u.cargo += take; u.cargoVal += take * (m.goldKind[o.tile] === 2 ? 2 : 1);
      u.mining = G.time;
      if (G.tickN % 12 === 0) part('dust', u.x + 0.3 * u.dir, u.y, 2, { vz: 8, max: 0.5, size: 3 });
      if (u.cargo >= CART_CAP - 0.5) { o.pref = o.tile; G.claims.delete(o.tile); o.s = 'return'; o.mint = 0; u.goal = null; u.path = null; }
      return;
    }
    case 'return': {
      let mint = G.byId.get(o.mint);
      if (!mint || mint.dead || mint.owner !== u.owner || mint.built < 1) {
        mint = null; let bd = 1e9;
        for (const b of G.blds) if (b.owner === u.owner && b.type === 'mint' && b.built >= 1) { const d = entDist(u, b); if (d < bd) { bd = d; mint = b; } }
        if (!mint) { o.wait = 1; return; }
        o.mint = mint.id; u.goal = null;
      }
      if (entDist(u, mint) < 1.15) { o.s = 'unload'; face(u, mint); u.path = null; u.goal = null; return; }
      if (!u.goal) setGoalEnt(u, mint, 0.9);
      if (followPath(u, dt)) {
        if (entDist(u, mint) < 1.9) { o.s = 'unload'; face(u, mint); }
        else if (G.time - u.pathT > 1) { u.goal = null; o.mint = 0; }
      }
      return;
    }
    case 'unload': {
      const amt = Math.min(u.cargo, UNLOAD_RATE * dt);
      if (u.cargo > 0.01) {
        const val = u.cargoVal * amt / u.cargo * p.mult.income;
        u.cargo -= amt; u.cargoVal -= u.cargoVal * amt / (u.cargo + amt);
        p.coin += val; p.stats.earned += val; o.got = (o.got || 0) + val;
      }
      if (u.cargo <= 0.01) {
        u.cargo = 0; u.cargoVal = 0;
        if (u.owner === G.human && o.got) { floater('+' + Math.round(o.got), u.x, u.y); Sfx.at('coin', u.x, u.y); }
        o.got = 0; o.s = 'seek'; u.goal = null; u.path = null;
      }
      return;
    }
  }
}

function unitCapture(u, dt) {
  const o = u.order, t = G.byId.get(o.target);
  if (!t || t.dead || t.kind !== 'b') return setIdle(u);
  if (entDist(u, t) <= 1.05) {
    if (t.owner === u.owner) { t.hp = t.maxHp; if (u.owner === G.human) Sfx.at('ready', t.x, t.y); }
    else captureBuilding(t, u.owner);
    u.dead = true;
    return;
  }
  if (!u.goal || u.goal.id !== t.id) setGoalEnt(u, t, 0.8);
  if (followPath(u, dt)) { if (G.time - u.pathT > 1) u.goal = null; }
}

function updateUnit(u, dt) {
  const o = u.order;
  if (u.cool > 0) u.cool -= dt;
  if (u.atkAnim > 0) u.atkAnim -= dt;
  if (u.flash > 0) u.flash -= dt;
  u.moving = false;
  if (u.vet >= 2 && u.hp < u.maxHp) u.hp = Math.min(u.maxHp, u.hp + 2 * dt);
  switch (o.t) {
    case 'idle': unitIdle(u, dt); break;
    case 'move': if (followPath(u, dt)) setIdle(u); break;
    case 'amove': {
      u.scan -= dt;
      if (u.scan <= 0) {
        u.scan = 0.35;
        const t = acquire(u, Math.max(u.def.weapon.range + 1.5, 5));
        if (t) { u.order = { t: 'attack', target: t.id, auto: true, resume: o }; u.goal = null; u.path = null; break; }
      }
      if (!u.goal) setGoalPoint(u, o.x, o.y);
      if (followPath(u, dt)) setIdle(u);
      break;
    }
    case 'attack': unitAttack(u, dt); break;
    case 'harvest': unitHarvest(u, dt); break;
    case 'capture': unitCapture(u, dt); break;
  }
  if (u.def.heal) unitHeal(u, dt);
  if (u.moving) u.anim += dt * (u.def.armor === 'mounted' ? 2.6 : 2.1) * (u.def.speed > 2 ? 1.2 : 1);
}

function updateBuilding(b, dt) {
  const p = G.players[b.owner], d = b.def;
  if (b.flash > 0) b.flash -= dt;
  if (b.built < 1) {
    b.built += dt / 1.3;
    if (b.built >= 1) { b.built = 1; onBuilt(b); }
    return;
  }
  if (b.repairing) {
    if (b.hp >= b.maxHp) b.repairing = false;
    else {
      const gain = b.maxHp / 22 * dt, cost = gain * d.cost * 0.35 / b.maxHp;
      if (p.coin >= cost) { p.coin -= cost; b.hp = Math.min(b.maxHp, b.hp + gain); }
    }
  }
  if (b.hp < b.maxHp * 0.5 && G.tickN % 6 === 0) {
    const r = G.rng;
    const fx = b.x + (r() - 0.5) * b.w * 0.6, fy = b.y + (r() - 0.5) * b.h * 0.6, fz = d.tall * 0.35 + r() * 10;
    part('smoke', fx, fy, fz + 8, { vz: 16 + r() * 10, max: 1.2 + r() * 0.8, size: 5 + r() * 5, vx: 0.14, vy: -0.05 });
    if (b.hp < b.maxHp * 0.3) { part('fire', fx, fy, fz, { vz: 12 + r() * 12, max: 0.5 + r() * 0.4, size: 5 + r() * 5 }); if (r() < 0.4) part('spark', fx, fy, fz + 6, { vx: (r() - 0.5) * 1.5, vy: (r() - 0.5) * 1.5, vz: 30 + r() * 30, max: 0.7, size: 1.6, grav: 1 }); }
  }
  if (b.type === 'mint' && !p.lowGrain && G.tickN % 10 === 0) part('smoke', b.x - 0.56, b.y - 0.61, 66, { vz: 12, max: 1.4, size: 4, vx: 0.15 });
  const w = d.weapon;
  if (w) {
    if (d.grain < 0 && p.lowGrain) return;
    if (b.cool > 0) b.cool -= dt;
    b.scan -= dt;
    let t = b.target ? G.byId.get(b.target) : null;
    if (t) { const dd = entDist(b, t); if (t.dead || t.owner === b.owner || dd > w.range || (w.minRange && dd < w.minRange)) t = null; }
    if (!t && b.scan <= 0) { b.scan = 0.3; t = acquire(b, w.range); if (t && t.type === 'palisade') t = null; }
    b.target = t ? t.id : 0;
    if (t && b.cool <= 0) fireWeapon(b, t, w);
  }
  if (b.type === 'skyfire' && !p.lowGrain) {
    const was = b.charge;
    b.charge = Math.min(SKY_T, b.charge + dt);
    if (was < SKY_T && b.charge >= SKY_T) {
      if (b.owner === G.human) { notify('Skyfire Battery is ready', 'good'); Sfx.play('ready'); }
      else notify('Enemy Skyfire Battery is ready!', 'bad');
    }
  }
}

// ---- visibility (fog of war for the human player) -------------------------
function updateVisibility() {
  const m = G.map, n = m.n, vis = G.vis, ex = G.explored;
  if (G.opts.reveal) { vis.fill(1); ex.fill(1); G.fogDirty = true; return; }
  vis.fill(0);
  const mark = (cx, cy, r) => {
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(n - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(n - 1, Math.ceil(cy + r)), r2 = r * r;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r2) { const i = y * n + x; vis[i] = 1; ex[i] = 1; }
    }
  };
  for (const e of G.ents) {
    if (e.dead || e.owner !== G.human) continue;
    mark(e.x, e.y, e.kind === 'b' ? (e.built < 1 ? 3 : e.def.sight + e.w / 2) : e.def.sight);
  }
  for (let i = G.reveals.length - 1; i >= 0; i--) {
    const r = G.reveals[i];
    if (G.time > r.until) { G.reveals.splice(i, 1); continue; }
    if (r.owner === G.human) mark(r.x, r.y, r.r);
  }
  G.fogDirty = true;
}

function checkVictory() {
  if (G.over) return;
  const alive = [false, false];
  for (const e of G.ents) {
    if (e.dead) continue;
    if ((e.kind === 'b' && e.type !== 'palisade') || (e.kind === 'u' && e.def.deploy)) alive[e.owner] = true;
  }
  if (!alive[0] || !alive[1]) {
    G.over = { winner: alive[0] ? 0 : 1, time: G.time };
    G.players[alive[0] ? 1 : 0].defeated = true;
  }
}

// ---- main step ------------------------------------------------------------
function stepGame(dt) {
  G.time += dt; G.tickN++;
  G.pathBudget = 16;
  rebuildLists();
  for (const p of G.players) updateProduction(p, dt);
  for (let i = 0; i < G.ents.length; i++) {
    const e = G.ents[i];
    if (e.dead) continue;
    if (e.kind === 'b') updateBuilding(e, dt); else updateUnit(e, dt);
  }
  separate();
  updateProjectiles(dt);
  updateParticles(dt);
  G.map.regrow(dt, G.rng);
  for (const p of G.players) if (p.ai && !G.over) p.ai.update(dt);
  let anyDead = false;
  for (const e of G.ents) if (e.dead) { anyDead = true; G.byId.delete(e.id); }
  if (anyDead) G.ents = G.ents.filter(e => !e.dead);
  if (G.tickN % 6 === 0) updateVisibility();
  if (G.tickN % 30 === 0) checkVictory();
}
