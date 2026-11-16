/* Bay Gridlock – traffic simulation core. No DOM; runs in the browser and in Node. */
(function (root) {
  'use strict';

  var KJ = 3;            // jam density: cars per lane-km
  var DT = 0.1;          // sim minutes per step
  var DAY = 1440;
  var START_T = 300;     // a new game starts at 5:00 AM
  var AGENTS_PER_K = 1.05; // commuter dots per thousand residents
  var GROWTH = 1.05;     // demand growth per day
  var MOOD_K = 25;       // mood points a perfect day is worth

  // v in km per sim-minute, flow in cars per lane per minute, money in $M
  var CLS = {
    fwy: { label: 'Freeway', mph: 65, v: 105 / 60, flow: 1.0, widen: 14, build: 45, upkeep: 0.012, max: 6 },
    br:  { label: 'Bridge',  mph: 55, v: 88 / 60,  flow: 1.0, widen: 60, build: 230, upkeep: 0.05, max: 6 },
    pri: { label: 'Highway', mph: 45, v: 72 / 60,  flow: 0.8, widen: 9,  build: 22, upkeep: 0.008, max: 4 },
    sec: { label: 'Road',    mph: 35, v: 56 / 60,  flow: 0.6, widen: 6,  build: 12, upkeep: 0.005, max: 3 }
  };
  var TOLL_FEE = [0, 0.005, 0.012];   // $M per crossing
  var TOLL_MIN = [0, 4, 11];         // how many minutes of detour a driver will accept to dodge it
  var TOLL_LABEL = ['Free', '$7', '$18'];
  var UPGRADE_COST = 26;             // $M per km, surface road -> freeway
  var WATER_COST = 110;              // $M per km over open water (2 lanes each way)

  function rnd() { return Math.random(); }

  function Heap() { this.k = []; this.v = []; }
  Heap.prototype.push = function (key, val) {
    var k = this.k, v = this.v, i = k.length; k.push(key); v.push(val);
    while (i > 0) { var p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  };
  Heap.prototype.pop = function () {
    var k = this.k, v = this.v, top = v[0], lk = k.pop(), lv = v.pop(), n = k.length;
    if (n) {
      var i = 0;
      for (;;) {
        var c = 2 * i + 1; if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  };

  function Sim(map, save) {
    var i;
    this.map = map; this.W = map.w; this.H = map.h;
    this.nodes = map.nodes.map(function (p, i) { return { id: i, x: p[0], y: p[1], out: [], inc: [], zone: -1 }; });
    this.edges = []; this.links = [];
    this.land = map.land.map(function (f) {
      var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (var i = 0; i < f.length; i += 2) { x0 = Math.min(x0, f[i]); x1 = Math.max(x1, f[i]); y0 = Math.min(y0, f[i + 1]); y1 = Math.max(y1, f[i + 1]); }
      return { p: f, x0: x0, y0: y0, x1: x1, y1: y1 };
    });
    for (i = 0; i < map.edges.length; i++) {
      var e = map.edges[i];
      this._addEdge({ a: e.a, b: e.b, pts: e.p, cls: e.c, ref: e.r, pre: e.h, lanes: e.l, name: e.n || '',
        toll: e.c === 'br' ? 1 : 0, built: false, bridge: e.c === 'br' });
    }
    this.baseEdges = this.edges.length;
    var nodes = this.nodes;
    this.zones = map.zones.map(function (z, i) {
      nodes[z.i].zone = i;
      return { id: i, name: z.n, node: z.i, pop: z.p, jobs: z.j, gw: !!z.g, queue: [], qh: 0 };
    });
    var Z = this.zones.length, N = this.nodes.length;
    this.next = []; this.ffT = [];
    for (i = 0; i < Z; i++) { this.next.push(new Int32Array(N)); this.ffT.push(new Float32Array(N)); }
    this.dist = new Float64Array(N);

    this.day = 1; this.t = START_T; this.now = START_T; this.stepId = 0; this.rz = 0;
    this.money = 400; this.mood = 60; this.growth = 1; this.over = false;
    this.totalTrips = 0; this.nCars = 0; this.delay = 1; this.builtCount = 0;
    this.worst = null; this.lastHour = Math.floor(this.t / 60);
    this.onDay = null; this.onOver = null;
    this._resetDay();
    if (save) this._restore(save);
    this._rebuildRouting();
    this._buildOD();
  }

  Sim.CLS = CLS; Sim.DT = DT; Sim.TOLL_LABEL = TOLL_LABEL; Sim.KJ = KJ;

  Sim.prototype._resetDay = function () {
    this.stat = { trips: 0, ratioSum: 0, fares: 0, tolls: 0, gaveUp: 0, spent: 0 };
  };

  Sim.prototype._addEdge = function (o) {
    var p = o.pts, n = p.length / 2, cum = new Float32Array(n), len = 0, i;
    for (i = 1; i < n; i++) { len += Math.hypot(p[2 * i] - p[2 * i - 2], p[2 * i + 1] - p[2 * i - 1]); cum[i] = len; }
    var e = { id: this.edges.length, a: o.a, b: o.b, pts: p, cum: cum, len: len, cls: o.cls, ref: o.ref || '', pre: o.pre || '',
      lanes: o.lanes, name: o.name || '', toll: o.toll || 0, built: !!o.built, bridge: !!o.bridge, links: [] };
    this.edges.push(e);
    for (var d = 0; d < 2; d++) {
      var L = { id: this.links.length, edge: e, dir: d, from: d ? e.b : e.a, to: d ? e.a : e.b, len: len, cars: [], credit: 0,
        tt: 0, ff: 0, vf: 0, capN: 0, flow: 0, gap: 0, creditMax: 1, own: 0, sp: 0, full: false };
      this.links.push(L); e.links.push(L);
      this.nodes[L.from].out.push(L.id); this.nodes[L.to].inc.push(L.id);
      this._refreshLink(L); L.tt = L.ff;
    }
    return e;
  };

  Sim.prototype._refreshLink = function (L) {
    var e = L.edge, c = CLS[e.cls];
    L.vf = c.v; L.ff = L.len / c.v;
    L.capN = Math.max(3, Math.round(e.lanes * L.len * KJ));
    L.flow = e.lanes * c.flow;
    L.creditMax = Math.max(1, L.flow * 0.4);
    L.gap = 1 / (e.lanes * KJ);
    if (L.tt < L.ff) L.tt = L.ff;
  };

  // ---- routing ---------------------------------------------------------------
  Sim.prototype.linkCost = function (L) {
    var t = L.tt, cars = L.cars;
    if (cars.length) { var age = this.now - cars[0].enter; if (age > t) t = age; }
    return t;
  };

  Sim.prototype._dijkstra = function (z, free) {
    var dist = this.dist, links = this.links, nodes = this.nodes, next = this.next[z];
    dist.fill(Infinity); if (!free) next.fill(-1);
    var h = new Heap(), dn = this.zones[z].node;
    dist[dn] = 0; h.push(0, dn);
    while (h.k.length) {
      var d = h.k[0], u = h.pop();
      if (d > dist[u]) continue;
      var inc = nodes[u].inc;
      for (var i = 0; i < inc.length; i++) {
        var L = links[inc[i]], c;
        if (free) c = L.ff;
        else c = this.linkCost(L) * (0.94 + 0.12 * rnd()) + TOLL_MIN[L.edge.toll];
        var nd = d + c, v = L.from;
        if (nd < dist[v]) { dist[v] = nd; if (!free) next[v] = L.id; h.push(nd, v); }
      }
    }
    if (free) this.ffT[z].set(dist);
  };

  Sim.prototype._rebuildRouting = function () {
    for (var z = 0; z < this.zones.length; z++) { this._dijkstra(z, true); this._dijkstra(z, false); }
  };

  // ---- demand ----------------------------------------------------------------
  // Gravity model: residents of i pick a job in j by jobs_j * exp(-drive time / 26 min).
  // Rebuilt every night, so a new bridge really does induce new trips across it.
  Sim.prototype._buildOD = function () {
    var Z = this.zones, n = Z.length, pi = [], pj = [], cum = [], tot = 0;
    for (var i = 0; i < n; i++) {
      var w = [], s = 0, j;
      for (j = 0; j < n; j++) {
        var t = this.ffT[j][Z[i].node];
        var x = (i === j || !isFinite(t)) ? 0 : Z[j].jobs * Math.exp(-t / 26);
        if (Z[i].gw && Z[j].gw) x *= 0.25;
        w.push(x); s += x;
      }
      if (s <= 0) continue;
      var workers = Z[i].pop * AGENTS_PER_K;
      for (j = 0; j < n; j++) if (w[j] > 0) { tot += workers * w[j] / s; pi.push(i); pj.push(j); cum.push(tot); }
    }
    this.od = { i: pi, j: pj, cum: cum, total: tot };
  };

  function gauss(h, mu, sd) { var d = (h - mu) / sd; return Math.exp(-0.5 * d * d) / (sd * 2.5066); }
  // share of a day's one-way commute volume leaving per hour, split by kind
  Sim.prototype.demandAt = function (h) {
    return { am: gauss(h, 7.6, 1.05), pm: gauss(h, 17.4, 1.35), mid: (h > 8.5 && h < 21 ? 0.04 : 0.003) };
  };
  Sim.prototype.dailyTrips = function () { return this.od.total * this.growth * 2.5; };

  Sim.prototype._spawn = function (dt) {
    var r = this.demandAt(this.t / 60), sum = r.am + r.pm + r.mid;
    var lam = this.od.total * this.growth * sum * dt / 60;
    // Poisson sample
    var k = 0, p = Math.exp(-lam), s = p, u = rnd();
    while (u > s && k < 60) { k++; p *= lam / k; s += p; }
    var od = this.od, cum = od.cum, n = cum.length;
    while (k-- > 0) {
      var x = rnd() * od.total, lo = 0, hi = n - 1;
      while (lo < hi) { var m = (lo + hi) >> 1; if (cum[m] < x) lo = m + 1; else hi = m; }
      var a = od.i[lo], b = od.j[lo], y = rnd() * sum;
      if (y > r.am && (y < r.am + r.pm || rnd() < 0.5)) { var tmp = a; a = b; b = tmp; }
      this.zones[a].queue.push({ dest: b, t0: this.now });
    }
  };

  Sim.prototype._release = function () {
    var Z = this.zones, links = this.links;
    for (var i = 0; i < Z.length; i++) {
      var z = Z[i], q = z.queue;
      if (z.qh >= q.length) { if (q.length) { q.length = 0; z.qh = 0; } continue; }
      // look a little way down the line so one blocked on-ramp does not hold up every driveway
      for (var k = z.qh, seen = 0, out = 0; k < q.length && seen < 24 && out < 8; seen++) {
        var trip = q[k];
        if (this.now - trip.t0 > 150) { q.splice(k, 1); this._fail(); continue; }   // never got out of the driveway
        var li = this.next[trip.dest][z.node];
        if (li < 0) { q.splice(k, 1); continue; }
        var L = links[li];
        if (L.cars.length >= L.capN) { k++; continue; }
        out++;
        if (k === z.qh) z.qh++; else q.splice(k, 1);
        if (k < z.qh) k = z.qh;
        var ff = this.ffT[trip.dest][z.node];
        L.cars.push({ pos: 0, lane: (rnd() * L.edge.lanes) | 0, dest: trip.dest, destNode: Z[trip.dest].node,
          t0: trip.t0, ff: ff, wait: 0, v: L.vf, enter: this.now, stamp: this.stepId });
        this.nCars++;
        if (L.edge.toll) this._toll(L.edge);
      }
      if (z.qh > 64) { q.splice(0, z.qh); z.qh = 0; }
    }
  };

  Sim.prototype._toll = function (e) { var f = TOLL_FEE[e.toll]; this.money += f; this.stat.tolls += f; };

  Sim.prototype._score = function (ratio) {
    // a smooth trip is +1; anything past 1.4x the open-road time costs, and a 2x+ crawl costs a lot
    var s = ratio <= 1.2 ? 1 : ratio <= 1.4 ? 1 - (ratio - 1.2) * 5 : ratio <= 2 ? -(ratio - 1.4) * 5 : -3 - (ratio - 2) * 3.33;
    if (s < -8) s = -8;
    this.mood += s * MOOD_K / this.dailyTrips();
    if (this.mood > 100) this.mood = 100;
    this.delay += (Math.min(ratio, 6) - this.delay) * 0.01;
    if (this.mood <= 0 && !this.over) { this.mood = 0; this.over = true; if (this.onOver) this.onOver(); }
  };
  Sim.prototype._fail = function () { this.stat.gaveUp++; this._score(6); };

  Sim.prototype._arrive = function (c) {
    var time = this.now - c.t0, ratio = time / Math.max(c.ff, 3);
    var ontime = (3 - ratio) / 1.7; ontime = ontime > 1 ? 1 : ontime < 0.15 ? 0.15 : ontime;
    var fare = (0.003 + 0.00055 * c.ff) * ontime;
    this.money += fare; this.stat.fares += fare; this.stat.trips++; this.stat.ratioSum += Math.min(ratio, 6);
    this.totalTrips++; this.nCars--;
    this._score(ratio);
  };

  // Returns true when the car left link L (arrived or moved on).
  // A link lets out lanes x flow cars a minute, so the jam sits on the road that is too narrow.
  Sim.prototype._leave = function (c, L) {
    var node = L.to, forced = c.wait > 40;
    if (!forced && L.credit < 1) { L.own++; return false; }
    if (node === c.destNode) {
      if (!forced) L.credit -= 1;
      L.tt += (this.now - c.enter - L.tt) * 0.3; this._arrive(c); return true;
    }
    var li = this.next[c.dest][node];
    if (li < 0) { this.nCars--; return true; }
    var N = this.links[li];
    if (N.edge === L.edge && this.nodes[node].out.length > 1) {   // no pointless U-turns
      var out = this.nodes[node].out, best = -1, bd = Infinity;
      for (var i = 0; i < out.length; i++) {
        var M = this.links[out[i]]; if (M.edge === L.edge) continue;
        var d = M.ff + this.ffT[c.dest][M.to]; if (d < bd) { bd = d; best = out[i]; }
      }
      if (best >= 0) N = this.links[best];
    }
    if (!forced && N.cars.length >= N.capN) { L.sp++; return false; }
    if (!forced) L.credit -= 1;
    L.tt += (this.now - c.enter - L.tt) * 0.3;
    c.pos = 0; c.enter = this.now; c.stamp = this.stepId; c.wait = 0; c.v = N.vf;
    c.lane = (rnd() * N.edge.lanes) | 0;
    N.cars.push(c);
    if (N.edge.toll) this._toll(N.edge);
    return true;
  };

  Sim.prototype._move = function (L, dt) {
    var cars = L.cars, n = cars.length;
    if (!n) { L.tt += (L.ff - L.tt) * 0.05; return; }
    var dens = n / L.capN;
    var f = dens < 0.25 ? 1 : 1 - (dens - 0.25) * 1.07; if (f < 0.2) f = 0.2;
    var step = L.vf * f * dt, gap = L.gap, limit = L.len, queued = true, w = 0, sid = this.stepId, now = this.now;
    for (var i = 0; i < n; i++) {
      var c = cars[i];
      if (c.stamp === sid) { cars[w++] = c; if (c.pos - gap < limit) limit = c.pos - gap; queued = false; continue; }
      var np = c.pos + step;
      if (np >= limit) {
        if (queued) {
          if (this._leave(c, L)) continue;
          c.wait += dt;
          if (now - c.t0 > 5 * c.ff + 90) { this.nCars--; this._fail(); continue; }   // gave up
        }
        np = limit;
      } else queued = false;
      if (np < c.pos) np = c.pos;
      c.v = (np - c.pos) / dt; c.pos = np; limit = np - gap;
      cars[w++] = c;
    }
    cars.length = w;
  };

  Sim.prototype.step = function () {
    if (this.over) return;
    var dt = DT, links = this.links, n = links.length, k, L;
    this.stepId++; this.t += dt; this.now += dt;
    this._spawn(dt); this._release();
    var off = (this.stepId * 131) % n;
    if (this.stepId & 1) for (k = 0; k < n; k++) { L = links[(k + off) % n]; if (L.credit < L.creditMax) L.credit += L.flow * dt; this._move(L, dt); }
    else for (k = n - 1; k >= 0; k--) { L = links[(k + off) % n]; if (L.credit < L.creditMax) L.credit += L.flow * dt; this._move(L, dt); }
    this._dijkstra(this.rz, false); this.rz = (this.rz + 1) % this.zones.length;
    var h = Math.floor(this.t / 60);
    if (h !== this.lastHour) { this.lastHour = h; this._findWorst(); }
    if (this.t >= DAY) this._endDay();
  };

  // Once an hour: which road is the worst bottleneck? `full` marks links that are only
  // backed up because the road ahead of them is jammed.
  Sim.prototype._findWorst = function () {
    var best = null, bs = 8, links = this.links;
    for (var i = 0; i < links.length; i++) {
      var L = links[i], r = this.linkCost(L) / L.ff;
      L.full = L.sp > L.own; var own = L.own; L.own = 0; L.sp = 0;
      if (L.full || r < 1.8 || L.cars.length < 4 || own < 5) continue;
      var s = L.cars.length * Math.min(r, 6);
      if (s > bs) { bs = s; best = L; }
    }
    this.worst = best;
  };

  Sim.prototype.upkeep = function () {
    var u = 0;
    for (var i = 0; i < this.edges.length; i++) { var e = this.edges[i]; u += e.len * e.lanes * 2 * CLS[e.cls].upkeep; }
    return u;
  };

  Sim.prototype._endDay = function () {
    var s = this.stat, up = this.upkeep();
    this.money -= up;
    var sum = { day: this.day, trips: s.trips, avg: s.trips ? s.ratioSum / s.trips : 1, fares: s.fares, tolls: s.tolls,
      upkeep: up, gaveUp: s.gaveUp, spent: s.spent, net: s.fares + s.tolls - up - s.spent, mood: this.mood };
    this.day++; this.t -= DAY; this.lastHour = 0;
    this.growth *= GROWTH;
    this._resetDay();
    for (var z = 0; z < this.zones.length; z++) this._dijkstra(z, true);
    this._buildOD();
    if (this.onDay) this.onDay(sum);
  };

  // ---- player actions --------------------------------------------------------
  Sim.prototype._spend = function (c) { this.money -= c; this.stat.spent += c; };
  Sim.prototype._changed = function (e) {
    this._refreshLink(e.links[0]); this._refreshLink(e.links[1]); this._rebuildRouting();
  };

  Sim.prototype.widenCost = function (e) {
    if (e.lanes >= CLS[e.cls].max) return null;
    return Math.max(4, Math.round(e.len * CLS[e.cls].widen * (1 + 0.15 * (e.lanes - 1))));
  };
  Sim.prototype.widen = function (e) {
    var c = this.widenCost(e);
    if (c === null || c > this.money) return false;
    this._spend(c); e.lanes++; this._changed(e); return true;
  };
  Sim.prototype.upgradeCost = function (e) {
    if (e.cls !== 'pri' && e.cls !== 'sec') return null;
    return Math.max(6, Math.round(e.len * UPGRADE_COST * (e.cls === 'sec' ? 1.3 : 1)));
  };
  Sim.prototype.upgrade = function (e) {
    var c = this.upgradeCost(e);
    if (c === null || c > this.money) return false;
    this._spend(c); e.cls = 'fwy'; if (e.lanes < 2) e.lanes = 2;
    e.links[0].tt = 0; e.links[1].tt = 0; this._changed(e); return true;
  };
  Sim.prototype.canToll = function (e) { return e.bridge; };
  Sim.prototype.setToll = function (e, lvl) { if (!e.bridge) return false; e.toll = lvl; this._rebuildRouting(); return true; };

  Sim.prototype.isLand = function (x, y) {
    var land = this.land;
    for (var k = 0; k < land.length; k++) {
      var P = land[k]; if (x < P.x0 || x > P.x1 || y < P.y0 || y > P.y1) continue;
      var p = P.p, inside = false;
      for (var i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
        if ((p[i + 1] > y) !== (p[j + 1] > y) && x < (p[j] - p[i]) * (y - p[i + 1]) / (p[j + 1] - p[i + 1]) + p[i]) inside = !inside;
      }
      if (inside) return true;
    }
    return false;
  };

  // price a straight new road between two junctions
  Sim.prototype.quote = function (a, b, cls) {
    var A = this.nodes[a], B = this.nodes[b], len = Math.hypot(B.x - A.x, B.y - A.y);
    var q = { a: a, b: b, cls: cls, len: len, water: 0, cost: 0, ok: true, why: '' };
    if (a === b) { q.ok = false; q.why = 'Pick a different junction.'; return q; }
    if (len > 45) { q.ok = false; q.why = 'Too long. Keep new roads under 28 miles.'; }
    for (var i = 0; i < this.edges.length; i++) {
      var e = this.edges[i];
      if (((e.a === a && e.b === b) || (e.a === b && e.b === a)) && e.len < len * 1.15) { q.ok = false; q.why = 'A road already links these two junctions. Add lanes to it.'; }
    }
    var n = Math.max(2, Math.ceil(len / 0.2)), wet = 0;
    for (var k = 1; k < n; k++) { var t = k / n; if (!this.isLand(A.x + (B.x - A.x) * t, A.y + (B.y - A.y) * t)) wet++; }
    q.water = len * wet / (n - 1);
    var c = CLS[cls];
    q.cost = Math.round((len - q.water) * c.build + q.water * WATER_COST * (cls === 'fwy' ? 1 : 0.6));
    return q;
  };
  Sim.prototype.build = function (q) {
    if (!q.ok || q.cost > this.money) return null;
    this._spend(q.cost);
    var A = this.nodes[q.a], B = this.nodes[q.b];
    this.builtCount++;
    var e = this._addEdge({ a: q.a, b: q.b, pts: [A.x, A.y, B.x, B.y], cls: q.cls, ref: '', pre: '', lanes: 2,
      name: (q.water > 0.5 ? 'New crossing ' : 'New road ') + this.builtCount, toll: 0, built: true, bridge: q.water > 0.5 });
    this._rebuildRouting();
    return e;
  };

  // ---- save / load -----------------------------------------------------------
  Sim.prototype.serialize = function () {
    var base = [], built = [], i, e;
    for (i = 0; i < this.edges.length; i++) {
      e = this.edges[i];
      if (i < this.baseEdges) base.push([e.lanes, e.cls, e.toll]);
      else built.push({ a: e.a, b: e.b, cls: e.cls, lanes: e.lanes, toll: e.toll, bridge: e.bridge, name: e.name });
    }
    return { v: 1, day: this.day, t: this.t, money: this.money, mood: this.mood, growth: this.growth,
      total: this.totalTrips, over: this.over, base: base, built: built, n: this.builtCount };
  };
  Sim.prototype._restore = function (s) {
    if (!s || s.v !== 1 || !s.base || s.base.length !== this.baseEdges) return;
    var i, e;
    for (i = 0; i < this.baseEdges; i++) { e = this.edges[i]; e.lanes = s.base[i][0]; e.cls = s.base[i][1]; e.toll = s.base[i][2]; }
    for (i = 0; i < s.built.length; i++) {
      var b = s.built[i], A = this.nodes[b.a], B = this.nodes[b.b];
      if (!A || !B) continue;
      this._addEdge({ a: b.a, b: b.b, pts: [A.x, A.y, B.x, B.y], cls: b.cls, lanes: b.lanes, toll: b.toll, bridge: b.bridge, name: b.name, built: true });
    }
    for (i = 0; i < this.links.length; i++) { this.links[i].tt = 0; this._refreshLink(this.links[i]); }
    this.day = s.day; this.t = s.t; this.now = (s.day - 1) * DAY + s.t; this.money = s.money; this.mood = s.mood;
    this.growth = s.growth; this.totalTrips = s.total || 0; this.over = !!s.over; this.builtCount = s.n || s.built.length;
    this.lastHour = Math.floor(this.t / 60);
  };

  root.BaySim = Sim;
  if (typeof module !== 'undefined' && module.exports) module.exports = Sim;
})(typeof window !== 'undefined' ? window : globalThis);
