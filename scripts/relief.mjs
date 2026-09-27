// Does the country actually change shape from state to state, and is it still
// drivable where it does?
//   node scripts/relief.mjs
//
// Relief is the thing you see most of from a car, so it is worth measuring
// rather than eyeballing: how much height a state has in it, and how steep the
// roads got as a result.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const FILES = ['math.js', 'gl.js', 'mesh.js', 'physics.js', 'car_model.js',
  'world.js', 'props.js', 'state_shapes.js', 'scenes.js', 'ai.js'];
const ctx = vm.createContext({
  console, performance, Math, Date,
  Float32Array, Uint16Array, Uint32Array, Uint8Array, Int32Array, Map, Set,
  isFinite, parseFloat, parseInt, NaN, Infinity,
});
for (const f of FILES) {
  vm.runInContext(readFileSync(join(root, 'src', f), 'utf8'), ctx, { filename: f });
}

const out = JSON.parse(vm.runInContext(`(() => {
  const gl = new Proxy({}, { get: () => (() => ({})) });
  const scene = buildHomeRoute(gl);
  const world = scene.world;

  // Height spread inside each state, sampled on a lattice over its own cell.
  const rows = [];
  for (const st of scene.states) {
    let lo = Infinity, hi = -Infinity, n = 0;
    for (let i = 1; i < 14; i++) {
      for (let j = 1; j < 14; j++) {
        const x = st.x0 + (i / 14) * (st.x1 - st.x0);
        const z = st.z0 + (j / 14) * (st.z1 - st.z0);
        if (!pointInShape(x, z, st.polys, st.boxes)) continue;
        const h = world.terrain(x, z);
        if (h < lo) lo = h; if (h > hi) hi = h; n++;
      }
    }
    if (n > 4) rows.push({ abbr: st.abbr, biome: st.biome, spread: +(hi - lo).toFixed(1) });
  }
  rows.sort((a, b) => b.spread - a.spread);

  // Steepest gradient on any road, and where.
  let steep = 0, steepAt = null, steepRoad = null;
  const grades = [];
  for (const p of world.paths) {
    const sp = p.spline;
    for (let i = 1; i < sp.count; i++) {
      const a = sp.points[i - 1], b = sp.points[i];
      const run = Math.hypot(b[0] - a[0], b[2] - a[2]);
      if (run < 0.5) continue;
      const g = Math.abs(b[1] - a[1]) / run;
      grades.push(g);
      if (g > steep) { steep = g; steepAt = [Math.round(b[0]), Math.round(b[2])]; steepRoad = p.name || '(unnamed)'; }
    }
  }
  grades.sort((a, b) => a - b);
  const q = (f) => grades[Math.floor(grades.length * f)];

  return JSON.stringify({
    rows, steep: +(steep * 100).toFixed(1), steepAt, steepRoad,
    median: +(q(0.5) * 100).toFixed(2), p99: +(q(0.99) * 100).toFixed(1),
    samples: grades.length,
  });
})()`, ctx));

console.log('height spread within each state, metres (top and bottom 8)\n');
const show = (r) => console.log(`  ${r.abbr}  ${String(r.spread).padStart(5)} m   ${r.biome}`);
out.rows.slice(0, 8).forEach(show);
console.log('  ...');
out.rows.slice(-8).forEach(show);

const flat = out.rows[out.rows.length - 1].spread, hilly = out.rows[0].spread;
console.log(`\nhilliest state is ${(hilly / Math.max(0.01, flat)).toFixed(1)}x the flattest`);
console.log(`road gradients: median ${out.median}%, 99th ${out.p99}%, `
  + `steepest ${out.steep}% on ${out.steepRoad} at [${out.steepAt}]`);
console.log(out.steep > 22 ? 'FAIL  something is too steep to drive'
  : ' ok   every road is inside a drivable gradient');
process.exit(out.steep > 22 ? 1 : 0);
