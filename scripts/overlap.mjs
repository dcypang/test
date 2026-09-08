// Finds tarmac that is covered by more than one road.
//   node scripts/overlap.mjs
//
// Every road is built as its own ribbon lifted a couple of centimetres off the
// terrain. Where two of them cover the same ground the two ribbons are at the
// same height, and which one the depth test keeps is undefined - so the surface
// flickers between them as the camera moves, and both sets of lane markings are
// drawn through each other.
//
// This measures how much of the network that affects, which is the difference
// between a rendering nuisance and the reason junctions look wrong.
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

const report = vm.runInContext(`(() => {
  const gl = new Proxy({}, { get: () => (() => ({})) });
  const out = {};
  for (const [label, build] of [['circuit', buildCircuit], ['country', buildHomeRoute]]) {
    const scene = build(gl);
    const P = scene.world.paths;

    // Bucket every path's samples so a point can ask which roads are near it.
    const CELL = 24;
    const grid = new Map();
    for (let i = 0; i < P.length; i++) {
      const sp = P[i].spline;
      for (let k = 0; k < sp.count; k++) {
        const p = sp.points[k];
        const cx = Math.floor(p[0] / CELL), cz = Math.floor(p[2] / CELL);
        for (let dx = -1; dx <= 1; dx++) {
          for (let dz = -1; dz <= 1; dz++) {
            const key = (cx + dx) + ',' + (cz + dz);
            let l = grid.get(key);
            if (!l) { l = []; grid.set(key, l); }
            l.push([i, k]);
          }
        }
      }
    }

    // Walk each road down its centreline and ask how many roads cover the point.
    let onePath = 0, twoPlus = 0, threePlus = 0;
    const pairs = new Map();
    const spots = [];
    for (let i = 0; i < P.length; i++) {
      const sp = P[i].spline;
      const step = sp.length / sp.count;
      for (let k = 0; k < sp.count; k++) {
        const p = sp.points[k];
        const cover = new Set();
        const near = grid.get(Math.floor(p[0] / CELL) + ',' + Math.floor(p[2] / CELL)) || [];
        for (const [j, kk] of near) {
          if (j === i) continue;
          const q = P[j].spline.points[kk];
          const d = Math.hypot(q[0] - p[0], q[2] - p[2]);
          // Both ribbons cover this point if it is inside the other's width.
          if (d < P[j].halfWidth + 0.6) cover.add(j);
        }
        if (cover.size === 0) { onePath += step; continue; }
        twoPlus += step;
        if (cover.size > 1) threePlus += step;
        for (const j of cover) {
          const key = [P[i].type, P[j].type].sort().join(' over ');
          pairs.set(key, (pairs.get(key) || 0) + step);
        }
        if (spots.length < 8 && k % 7 === 0) {
          spots.push({ x: Math.round(p[0]), z: Math.round(p[2]),
            road: P[i].name || '(unnamed)', over: [...cover].map((j) => P[j].name || '(unnamed)') });
        }
      }
    }
    out[label] = {
      roads: P.length,
      clearMetres: Math.round(onePath),
      doubledMetres: Math.round(twoPlus),
      tripledMetres: Math.round(threePlus),
      doubledPct: +(100 * twoPlus / (onePath + twoPlus)).toFixed(1),
      byType: Object.fromEntries([...pairs].map(([k, v]) => [k, Math.round(v)])
        .sort((a, b) => b[1] - a[1])),
      spots,
    };
  }
  return JSON.stringify(out);
})()`, ctx);

const r = JSON.parse(report);
for (const [label, d] of Object.entries(r)) {
  console.log(`\n--- ${label} ---`);
  console.log(`${d.roads} roads, ${d.clearMetres} m of tarmac covered once, `
    + `${d.doubledMetres} m covered twice or more (${d.doubledPct}%)`);
  console.log(`${d.tripledMetres} m covered three times or more`);
  console.log('by road type:', JSON.stringify(d.byType));
  console.log('examples:');
  for (const s of d.spots) console.log(`  [${s.x},${s.z}] ${s.road} over ${s.over.join(', ')}`);
}

// What the depth buffer can actually resolve, which is the other half of it.
console.log('\n--- depth resolution, near 0.15 m, far 2600 m, 24-bit ---');
const near = 0.15, far = 2600, levels = 2 ** 24;
for (const d of [10, 50, 100, 200, 400, 800, 1600]) {
  // Spacing between adjacent depth values at distance d.
  const res = (d * d * (far - near)) / (near * far * levels);
  console.log(`  at ${String(d).padStart(4)} m: ${(res * 1000).toFixed(1)} mm`);
}
console.log('  road sits 20 mm over the terrain, markings 4 mm over the road');
