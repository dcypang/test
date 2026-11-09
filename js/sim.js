// Monthly simulation: growth, development applications, budget, approval, housing law.
'use strict';

SG.Sim = class Sim {
  constructor(world) {
    this.w = world;
    this.year = 2025; this.month = 0;
    this.funds = SG.ECON.startFunds;
    this.parcelTax = 0;          // $/parcel/year, needs voter approval to raise
    this.approval = 68;
    this.rhnaPermitted = 0;      // units permitted this cycle (game start = Jan 2025)
    this.rhnaBaseline = 380;     // units assumed already permitted 2023–2024
    this.compliant = true;
    this.apps = [];              // pending development applications
    this.construction = [];      // approved, under construction
    this.history = [];
    this.news = [];
    this.nextAppId = 1;
    this.autoApprove = true;
    this.services = [];          // {x,y,service,radius}
    this.denials = 0;
    this.seed = 1234567;
    this.recount();
    this.baseUnits = this.units;
    this.budget = this.computeBudget();
  }

  rand() { // deterministic LCG so saves replay similarly
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  recount() {
    let units = 0, jobs = 0, value = 0, parcels = 0, com = 0, mu = 0;
    for (const b of this.w.buildings) {
      if (b.removed || !b.inCity) continue;
      units += b.units; jobs += b.jobs; value += b.value;
      if (b.units) parcels++;
      if (b.kind === 'commercial' || b.kind === 'mixeduse') com += b.jobs;
      if (b.kind === 'mixeduse') mu += b.units;
    }
    this.units = units; this.jobs = jobs; this.assessed = value; this.parcels = parcels; this.comJobs = com;
    this.pop = Math.round(units * SG.ECON.hhSize * 0.96); // ~4% vacancy
    if (this.roadKmCache == null || this._roadsDirty) { this.roadKmCache = this.roadKm(); this._roadsDirty = false; }
    let parkHa = 0;
    for (const a of this.w.areas) if (!a.removed && (a.kind === 'park' || a.kind === 'sports')) {
      const [cx, cy] = SG.World.centroid(a.pts);
      const c = this.w.cellOf(cx, cy);
      if (c >= 0 && this.w.inCity[c]) parkHa += SG.World.polyArea(a.pts) / 10000;
    }
    this.parkHa = parkHa;
    this.services = this.w.buildings.filter(b => !b.removed && b.service).map(b => ({ x: b.cx, y: b.cy, service: b.service, radius: b.radius }));
  }
  roadKm() {
    let m = 0;
    for (const r of this.w.roads) if (!r.removed && r.cls <= 3) {
      const c = this.w.cellOf(r.pts[0], r.pts[1]);
      if (c >= 0 && this.w.inCity[c]) m += r.len;
    }
    return m / 1000;
  }

  computeBudget() {
    const E = SG.ECON;
    const rev = {
      'Property tax (city share)': this.assessed * E.propTaxRate * E.cityShare,
      'Sales tax': this.comJobs * E.salesTaxPerJob,
      'Fees, franchise & other': this.pop * E.otherRevPerCapita,
      'Parcel tax': this.parcels * this.parcelTax,
    };
    let svcUpkeep = 0;
    for (const b of this.w.buildings) if (!b.removed && b.player && b.upkeep) svcUpkeep += b.upkeep;
    const exp = {
      'Sheriff contract': this.pop * E.lawPerCapita,
      'Streets & storm drains': this.roadKmCache * E.roadPerKm,
      'Parks & open space': this.parkHa * E.parkPerHa,
      'Administration & planning': E.adminBase + this.units * 60,
      'New city facilities': svcUpkeep,
    };
    const sum = o => Object.values(o).reduce((a, b) => a + b, 0);
    return { rev, exp, net: sum(rev) - sum(exp), totalRev: sum(rev), totalExp: sum(exp) };
  }

  // Months elapsed / total in the RHNA cycle, and units expected by now.
  rhnaStatus() {
    const { start, end, target } = SG.RHNA;
    const total = (end.y - start.y) * 12 + (end.m - start.m);
    const done = (this.year - start.y) * 12 + (this.month - start.m);
    const have = this.rhnaBaseline + this.rhnaPermitted;
    return { have, target, expected: Math.round(target * Math.min(1, done / total)), monthsLeft: total - done, frac: Math.min(1, have / target) };
  }

  // Development demand 0..1 for residential, commercial and mixed-use.
  demand() {
    const appeal = 0.55 + (this.approval - 50) / 200;
    const r = Math.max(0.05, Math.min(1, 0.85 * appeal + (this.compliant ? 0 : 0.2)));
    const jobsPerHH = this.comJobs / Math.max(1, this.units);
    const c = Math.max(0.05, Math.min(1, 0.9 - jobsPerHH * 3));
    let mu = 0, rm = 0;
    for (let i = 0; i < this.w.zone.length; i++) { const z = this.w.zone[i]; if (z === SG.Z.MU) mu++; else if (z === SG.Z.R_M) rm++; }
    const acre = SG.CELL * SG.CELL / 4046.86;
    const m = mu ? Math.min(1, r * 1.1) : 0;
    return { r, c, m, muAcres: mu * acre, rmAcres: rm * acre };
  }

  monthKey() { return SG.MONTHS[this.month] + ' ' + this.year; }

  say(msg, important = false) {
    this.news.unshift({ when: this.monthKey(), msg, important });
    if (this.news.length > 40) this.news.pop();
    if (this.onNews) this.onNews(msg, important);
  }

  // ---------- growth ----------
  // Find a vacant, zoned, road-adjacent cell where a project of this type fits.
  findSite(filter, tries = 400) {
    const w = this.w, N = w.zone.length;
    for (let t = 0; t < tries; t++) {
      const i = Math.floor(this.rand() * N);
      if (!w.inCity[i] || w.claim[i] !== -1) continue;
      if (w.roadDist[i] < 1 || w.roadDist[i] > 2) continue;
      if (!filter(w.zone[i], i)) continue;
      return i;
    }
    return -1;
  }
  findRedevelopSite(zoneTest, tries = 300) {
    // an older low-density building sitting in an up-zoned district
    const w = this.w, list = w.buildings;
    for (let t = 0; t < tries; t++) {
      const b = list[Math.floor(this.rand() * list.length)];
      if (b.removed || !b.inCity || b.player) continue;
      if (!['house', 'commercial', 'other', 'accessory'].includes(b.kind)) continue;
      const z = w.zoneAt(b.cx, b.cy);
      if (zoneTest(z) && w.roadDist[w.cellOf(b.cx, b.cy)] <= 2) return b;
    }
    return null;
  }

  proposeProjects() {
    const d = this.demand();
    const Z = SG.Z, B = SG.BUILDS;
    const tryPropose = (build, zoneTest, why, opts = {}) => {
      let replace = null, x, y;
      const spec = B[build];
      let i = -1;
      for (let k = 0; k < 6 && i < 0; k++) {
        const c = this.findSite((z) => zoneTest(z));
        if (c < 0) break;
        const [cx, cy] = this.w.cellCenter(c);
        const nr = this.w.nearestRoad(cx, cy, 120);
        if (nr && this.w.footprintClear(SG.World.rect(cx, cy, spec.w, spec.d, nr.angle))) i = c;
      }
      if (i >= 0) [x, y] = this.w.cellCenter(i);
      else if (opts.redevelop) {
        for (let k = 0; k < 8 && !replace; k++) {
          const cand = this.findRedevelopSite(zoneTest);
          if (!cand) break;
          const nr = this.w.nearestRoad(cand.cx, cand.cy, 120);
          if (nr && this.w.footprintClear(SG.World.rect(cand.cx, cand.cy, spec.w, spec.d, nr.angle), this.w.lotGroup(cand))) replace = cand;
        }
        if (!replace) return;
        x = replace.cx; y = replace.cy;
      } else return;
      this.addApp({ build, x, y, replace, why, forced: !!opts.forced, ministerial: !!B[build].ministerial });
    };
    // Single-family infill on vacant lots
    if (this.rand() < 0.55 * d.r) tryPropose('house', z => z >= 1 && z <= 5, 'Custom home on a vacant lot');
    // ADUs: Saratoga's most common new home type
    const aduTries = Math.round(4 * d.r + this.rand());
    for (let n = 0; n < aduTries; n++) {
      for (let k = 0; k < 20; k++) {
        const b = this.w.buildings[Math.floor(this.rand() * this.w.buildings.length)];
        if (b.removed || !b.inCity || b.kind !== 'house') continue;
        const spot = this.aduSpot(b);
        if (spot) { this.addApp({ build: 'adu', x: spot[0], y: spot[1], host: b.id, why: 'Backyard ADU', ministerial: true }); break; }
      }
    }
    if (this.rand() < 0.12 * d.r) {
      const b = this.findRedevelopSite(z => z >= 2 && z <= 5);
      if (b && b.kind === 'house') this.addApp({ build: 'duplex', x: b.cx, y: b.cy, replace: b, why: 'SB 9 lot split', ministerial: true });
    }
    // more land zoned for density -> more developers interested
    const multiRounds = 1 + Math.floor((d.muAcres + d.rmAcres) / 25);
    for (let k = 0; k < multiRounds; k++) {
      if (this.rand() < 0.3 * d.r) tryPropose('townhomes', z => z === Z.R_M || z === Z.MU, 'Townhome project', { redevelop: true });
      if (this.rand() < 0.2 * d.r) tryPropose('apartments', z => z === Z.R_M || z === Z.MU, 'Apartment project', { redevelop: true });
    }
    for (let k = 0; k < 1 + Math.floor(d.muAcres / 15); k++)
      if (this.rand() < 0.3 * d.m) tryPropose('mixeduse', z => z === Z.MU, 'Mixed-use project', { redevelop: true });
    if (this.rand() < 0.3 * d.c) tryPropose('commercial', z => z === Z.C_N || z === Z.C_H || z === Z.MU, 'Retail building', { redevelop: true });
    // Builder's remedy: when the housing element is out of compliance, developers may
    // file projects that ignore local zoning, as long as enough units are affordable.
    if (!this.compliant && this.rand() < 0.3) {
      const i = this.findSite(z => z >= 1 && z <= 5, 600);
      const [x, y] = i >= 0 ? this.w.cellCenter(i) : [0, 0];
      const nr = i >= 0 && this.w.nearestRoad(x, y, 120);
      if (nr && this.w.footprintClear(SG.World.rect(x, y, B.apartments.w, B.apartments.d, nr.angle))) {
        this.addApp({ build: 'apartments', x, y, why: "Builder's remedy project (ignores local zoning)", forced: true });
      }
    }
  }
  aduSpot(host) {
    const nr = this.w.nearestRoad(host.cx, host.cy, 120);
    if (!nr) return null;
    // put it behind the house, away from the street
    const ang = nr.angle + Math.PI / 2;
    for (const sign of [1, -1]) {
      for (const dist of [18, 24, 30]) {
        const x = host.cx + Math.cos(ang) * dist * sign, y = host.cy + Math.sin(ang) * dist * sign;
        const n2 = this.w.nearestRoad(x, y, 200);
        if (n2 && n2.dist < nr.dist) continue; // that was toward the street
        const pts = SG.World.rect(x, y, SG.BUILDS.adu.w, SG.BUILDS.adu.d, nr.angle);
        if (this.w.footprintClear(pts)) return [x, y];
      }
    }
    return null;
  }

  addApp(a) {
    if (this.apps.length > 30) return;
    const spec = SG.BUILDS[a.build];
    a.id = this.nextAppId++;
    const nr = this.w.nearestRoad(a.x, a.y, 120, false);
    a.street = nr && nr.road.name ? nr.road.name : 'unnamed street';
    a.units = spec.units || 0;
    a.check = this.checkCode(a);
    a.filed = this.monthKey();
    if (a.check.blocked && !a.byPlayer) return; // developers don't file on sites that can't work
    if (a.check.ok && (a.ministerial || this.autoApprove)) { this.approve(a, true); return; }
    if (a.forced && this.autoApprove) { this.approve(a, true); return; }
    this.apps.push(a);
  }

  // Does a project meet the code at this spot?
  checkCode(a) {
    const spec = SG.BUILDS[a.build];
    const w = this.w;
    const zid = w.zoneAt(a.x, a.y);
    const z = SG.ZONES[zid];
    const issues = [];
    if (!zid) issues.push('Outside city limits');
    else if (!SG.zoneAllows(zid, spec) && !a.forced) issues.push(`${spec.label} not allowed in ${z.code}`);
    if (spec.levels && z && z.maxHeightFt && spec.levels * 12 > z.maxHeightFt + 4 && !a.forced && !spec.ministerial)
      issues.push(`Height ~${spec.levels * 12} ft exceeds ${z.maxHeightFt} ft limit`);
    const nr = w.nearestRoad(a.x, a.y, 120);
    const pts = SG.World.rect(a.x, a.y, spec.w, spec.d, nr ? nr.angle : 0);
    if (!w.footprintClear(pts, a.replace ? w.lotGroup(a.replace) : null)) issues.push('Site is not clear');
    if (!nr) issues.push('No street access');
    return { ok: issues.length === 0, issues, zone: z ? z.code : '—', blocked: issues.includes('Site is not clear') || !nr || !zid };
  }

  approve(a, auto = false) {
    this.apps = this.apps.filter(x => x !== a);
    a.check = this.checkCode(a);
    if (a.check.blocked) { if (!auto) this.say(`Project on ${a.street} can't be built: ${a.check.issues.join(', ')}.`); return false; }
    const spec = SG.BUILDS[a.build];
    if (a.replace && !a.replace.removed) for (const id of this.w.lotGroup(a.replace)) this.w.removeBuilding(this.w.buildings[id]);
    const b = this.w.placeBuilding(a.x, a.y, spec, { built: null, construction: true, appId: a.id });
    b.months = a.build === 'adu' ? 4 : a.build === 'house' || a.build === 'duplex' ? 10 : a.build === 'mixeduse' ? 26 : 18;
    b.totalMonths = b.months;
    b.unitsWhenDone = b.units; b.jobsWhenDone = b.jobs; b.units = 0; b.jobs = 0;
    this.construction.push(b);
    if (a.units) this.rhnaPermitted += a.units;
    if (!a.check.ok && !a.forced && !a.ministerial) this.approval -= 1.5; // neighbours object to variances
    if (!auto || a.units >= 20) this.say(`Approved: ${spec.label}${a.units ? ` (${a.units} home${a.units > 1 ? 's' : ''})` : ''} on ${a.street}.`, a.units >= 20);
    if (this.onChange) this.onChange();
    return true;
  }
  deny(a) {
    this.apps = this.apps.filter(x => x !== a);
    if (a.forced) {
      this.say(`Court overturns denial of builder's remedy project on ${a.street}; city pays legal fees.`, true);
      this.funds -= 1500000;
      this.approve(a, true);
      return;
    }
    if (a.ministerial) {
      this.say(`State HCD warns Saratoga: ${SG.BUILDS[a.build].label} projects must be approved ministerially.`, true);
      this.approval -= 1; this.funds -= 250000;
    }
    this.denials++;
    this.approval += a.units >= 20 ? 0.8 : 0.1;
    if (this.onChange) this.onChange();
  }

  // ---------- monthly step ----------
  step() {
    this.month++;
    if (this.month > 11) { this.month = 0; this.year++; }

    // construction
    for (const b of this.construction) {
      b.months--;
      if (b.months <= 0) {
        b.construction = false; b.built = this.year;
        b.units = b.unitsWhenDone; b.jobs = b.jobsWhenDone;
      }
    }
    if (this.construction.length) this.w.version++; // building heights grow as they go up
    this.construction = this.construction.filter(b => b.construction && !b.removed);

    this.proposeProjects();
    this.recount();
    this.budget = this.computeBudget();
    this.funds += this.budget.net / 12;

    // approval rating drifts toward a target set by how the city is run
    const target = this.approvalTarget();
    this.approval += (target.value - this.approval) * 0.08;
    this.approval = Math.max(0, Math.min(100, this.approval));
    this.approvalFactors = target.factors;

    // housing element compliance check every 6 months
    if (this.month % 6 === 0 && this.year >= 2026) {
      const st = this.rhnaStatus();
      const was = this.compliant;
      this.compliant = st.have >= st.expected * 0.6;
      if (was && !this.compliant) this.say("State HCD finds Saratoga's housing element out of compliance. Builder's remedy projects may be filed.", true);
      if (!was && this.compliant) this.say('Housing element back in compliance with state law.', true);
    }
    if (this.month === 0) {
      this.history.push({ y: this.year - 1, pop: this.pop, units: this.units, funds: this.funds, approval: this.approval });
      const st = this.rhnaStatus();
      this.say(`${this.year - 1} in review: ${SG.fmtInt(this.pop)} residents, ${SG.fmtInt(st.have)} of ${SG.fmtInt(st.target)} RHNA homes permitted.`, true);
    }
    this.randomEvent();
    if (this.funds < -5000000 && this.onCrisis) this.onCrisis();
  }

  approvalTarget() {
    const f = {};
    const st = this.rhnaStatus();
    f['Budget'] = this.budget.net >= 0 ? 6 : Math.max(-15, this.budget.net / 400000);
    if (this.funds < 0) f['Budget'] -= 10;
    f['Parks per resident'] = Math.max(-8, Math.min(8, (this.parkHa / Math.max(1, this.pop / 1000) - 3) * 2));
    const roadCap = this.roadKmCache * 260;
    const trips = this.pop * 0.8 + this.jobs * 0.6;
    f['Traffic'] = Math.max(-15, Math.min(4, (roadCap - trips) / Math.max(1, roadCap) * 10));
    f['Parcel tax'] = -this.parcelTax / 40;
    f['Fire protection'] = this.fireCoverage() * 8 - 4;
    const growth = (this.units - this.baseUnits) / Math.max(1, this.baseUnits);
    f['Change to town character'] = -Math.min(12, growth * 60);
    f['State housing law'] = this.compliant ? 2 : -8;
    f['Commercial life'] = Math.max(-4, Math.min(5, (this.comJobs / Math.max(1, this.units)) * 40 - 3));
    const value = 62 + Object.values(f).reduce((a, b) => a + b, 0);
    return { value: Math.max(5, Math.min(98, value)), factors: f };
  }
  fireCoverage() {
    // existing county fire stations are assumed to cover most of the city;
    // the hills are the weak spot, new stations close the gap
    const fires = this.services.filter(s => s.service === 'fire');
    return Math.min(1, 0.6 + fires.length * 0.2);
  }

  randomEvent() {
    const r = this.rand();
    const m = this.month;
    const events = [
      [m === 3, 'Cherry blossoms bring crowds to Hakone Gardens.'],
      [m === 6, 'Summer concert season opens at the Mountain Winery.'],
      [m === 8, 'Celebrate Saratoga street festival fills Big Basin Way.'],
      [m === 9 && r < 0.5, 'Red flag warning in the foothills: residents urged to clear brush.'],
      [m === 1, 'Planning Commission study session on the Housing Element.'],
      [m === 4, 'Villa Montalvo announces its summer arts program.'],
      [m === 10, 'Leaves turn along Saratoga Creek; Wildwood Park trail reopens.'],
      [r < 0.05, 'Highway 85 backups spill onto Saratoga Avenue at rush hour.'],
      [r > 0.97, 'Heritage Preservation Commission reviews a historic home on Saratoga-Los Gatos Road.'],
    ];
    for (const [cond, msg] of events) if (cond) { this.say(msg); break; }
    if (m === 9 && r < 0.08 && this.fireCoverage() < 0.8) {
      this.say('Grass fire in the hills is contained after burning 30 acres. Residents call for better fire coverage.', true);
      this.approval -= 4;
    }
  }

  // ---------- player actions ----------
  spend(amount, what) {
    if (this.funds - amount < -2000000) { this.say(`Not enough money for ${what}.`, true); return false; }
    this.funds -= amount;
    return true;
  }
  setParcelTax(v) {
    // a new parcel tax needs two-thirds of voters
    const support = 0.75 - v / 800 + (this.approval - 60) / 200;
    const passed = v <= this.parcelTax || support >= 0.667;
    this.say(passed ? `Voters approve a parcel tax of $${v} per parcel (${Math.round(support * 100)}% yes).`
      : `Parcel tax measure fails with ${Math.round(support * 100)}% yes (two-thirds needed).`, true);
    if (passed) this.parcelTax = v;
    this.budget = this.computeBudget();
    return passed;
  }

  // ---------- save/load ----------
  toJSON() {
    const w = this.w;
    const removedOrig = w.buildings.filter(b => b.original && b.removed).map(b => b.id);
    const added = w.buildings.filter(b => !b.original && !b.removed).map(b => ({
      kind: b.kind, pts: Array.from(b.pts, v => Math.round(v * 10) / 10), levels: b.levels, units: b.unitsWhenDone ?? b.units,
      jobs: b.jobsWhenDone ?? b.jobs, value: b.value, street: b.street, built: b.built, months: b.construction ? b.months : 0,
      service: b.service, radius: b.radius, upkeep: b.upkeep, name: b.name,
    }));
    const removedRoads = w.roads.filter(r => r.original && r.removed).map(r => r.id);
    const addedRoads = w.roads.filter(r => !r.original && !r.removed).map(r => ({ cls: r.cls, pts: Array.from(r.pts, v => Math.round(v * 10) / 10), name: r.name }));
    const parks = w.playerParks.map(p => Array.from(p.pts, v => Math.round(v * 10) / 10));
    // run-length encode the zoning grid
    const z = w.zone, rle = [];
    for (let i = 0; i < z.length;) { let j = i; while (j < z.length && z[j] === z[i] && j - i < 65535) j++; rle.push(z[i], j - i); i = j; }
    return {
      v: 1, year: this.year, month: this.month, funds: this.funds, parcelTax: this.parcelTax, approval: this.approval,
      rhnaPermitted: this.rhnaPermitted, compliant: this.compliant, seed: this.seed, baseUnits: this.baseUnits,
      history: this.history, news: this.news.slice(0, 15), nextAppId: this.nextAppId, denials: this.denials,
      removedOrig, added, removedRoads, addedRoads, parks, zone: rle,
    };
  }
  static fromJSON(world, s) {
    for (const id of s.removedRoads) world.roads[id].removed = true;
    for (const r of s.addedRoads) { const rr = world.addRoadRaw({ cls: r.cls, pts: new Float32Array(r.pts), name: r.name, player: true }); world.indexRoad(rr); }
    world.computeRoadDist();
    for (const id of s.removedOrig) world.buildings[id].removed = true;
    let k = 0;
    for (let i = 0; i < s.zone.length; i += 2) for (let n = 0; n < s.zone[i + 1]; n++) world.zone[k++] = s.zone[i];
    for (const p of s.parks) {
      const a = { id: world.areas.length, kind: 'park', pts: new Float32Array(p), name: 'New park', player: true };
      world.areas.push(a); world.playerParks.push(a);
      world.fillPoly(a.pts, i => { world.areaK[i] = 1; });
    }
    const sim = new SG.Sim(world);
    sim.baseUnits = s.baseUnits;
    const pending = [];
    for (const b of s.added) {
      const nb = world.addBuildingRaw({ kind: b.kind, pts: new Float32Array(b.pts), inCity: true, levels: b.levels, units: b.units, jobs: b.jobs,
        value: b.value, street: b.street, built: b.built, player: true, service: b.service, radius: b.radius, upkeep: b.upkeep, name: b.name || '' });
      world.initBuilding(nb); world.indexBuilding(nb);
      if (b.months > 0) { nb.construction = true; nb.months = b.months; nb.unitsWhenDone = nb.units; nb.jobsWhenDone = nb.jobs; nb.units = 0; nb.jobs = 0; pending.push(nb); }
    }
    world.computeClaims();
    Object.assign(sim, {
      year: s.year, month: s.month, funds: s.funds, parcelTax: s.parcelTax, approval: s.approval, rhnaPermitted: s.rhnaPermitted,
      compliant: s.compliant, seed: s.seed, history: s.history, news: s.news, nextAppId: s.nextAppId, denials: s.denials || 0,
    });
    sim.construction = pending;
    sim._roadsDirty = true;
    sim.recount();
    sim.budget = sim.computeBudget();
    return sim;
  }
};
