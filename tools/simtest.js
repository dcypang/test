#!/usr/bin/env node
/* Headless balance run: node tools/simtest.js [days] [policy]
   policy: none | widen (spend each evening on the worst jam) */
const path = require('path');
globalThis.window = globalThis;
require(path.join(__dirname, '../src/map-data.js'));
const Sim = require(path.join(__dirname, '../src/sim.js'));

const days = +process.argv[2] || 10, policy = process.argv[3] || 'none';
const sim = new Sim(window.BAY_MAP);
console.log('zones', sim.zones.length, 'links', sim.links.length, 'base daily trips', Math.round(sim.dailyTrips()), 'upkeep', sim.upkeep().toFixed(0));
let peak = 0, t0 = Date.now();
sim.onDay = s => {
  console.log(`day ${s.day}: trips ${s.trips} avg x${s.avg.toFixed(2)} gaveUp ${s.gaveUp} fares ${s.fares.toFixed(0)} tolls ${s.tolls.toFixed(0)} upkeep ${s.upkeep.toFixed(0)} spent ${s.spent.toFixed(0)} | money ${sim.money.toFixed(0)} mood ${sim.mood.toFixed(0)} peakCars ${peak}`);
  peak = 0;
};
sim.onOver = () => console.log('GAME OVER on day', sim.day, 'at', (sim.t / 60).toFixed(1));
function act() {
  // widen the most-delayed links we can afford
  const scored = sim.links.map(L => ({ L, s: L.cars.length * Math.min(sim.linkCost(L) / L.ff, 6) }))
    .filter(x => sim.linkCost(x.L) / x.L.ff > 1.6 && x.L.cars.length > 3 && !x.L.full).sort((a, b) => b.s - a.s);
  for (const x of scored.slice(0, 3)) {
    const e = x.L.edge, c = sim.widenCost(e);
    if (c !== null && c <= sim.money - 20) { sim.widen(e); console.log(`   widen ${e.pre}${e.ref} ${e.name} -> ${e.lanes} lanes ($${c}M)`); }
  }
}
let hourLog = process.argv[4] === 'hours';
while (!sim.over && sim.day <= days) {
  sim.step();
  if (sim.nCars > peak) peak = sim.nCars;
  if (sim.stepId % 600 === 0) {
    if (policy === 'widen') act();
    if (hourLog) {
      const w = sim.worst;
      console.log(`  ${(sim.t / 60).toFixed(0)}h cars ${sim.nCars} delay x${sim.delay.toFixed(2)} mood ${sim.mood.toFixed(1)}` + (w ? ` worst ${w.edge.pre}${w.edge.ref} ${w.edge.name} n=${w.cars.length}` : ''));
    }
  }
}
console.log('ms', Date.now() - t0, 'total trips', sim.totalTrips);
