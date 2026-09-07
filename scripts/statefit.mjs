// Checks the real state outlines are usable as ground, not just as pictures.
//   node scripts/statefit.mjs
//
// A shaped state is only worth having if what stands in it stands on it: the
// town on its own land rather than on the neutral ground between states, the
// outline a sane silhouette rather than a sliver or a knot. Everything here is
// geometry, so it runs on the source directly with no browser and no GL.
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (f) => readFileSync(join(root, 'src', f), 'utf8');

// The state machinery only, lifted out of scenes.js: everything from the grid
// down to the table, stopping before the first function that wants a world.
const scenes = read('scenes.js');
const slice = scenes.slice(scenes.indexOf('const STATE_COLS'),
  scenes.indexOf('function stateAt(x, z)'));
const ctx = createContext({ Math, console, OUT: null });
runInContext([read('math.js'), read('state_shapes.js'), slice,
  'OUT = { STATES, pointInShape, pointInPoly, ringArea, COL_W, ROW_D };'].join('\n'), ctx);
const { STATES, pointInShape, ringArea, COL_W, ROW_D } = ctx.OUT;

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push(pass);
  console.log(`${pass ? ' ok ' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

// --- the outlines themselves ------------------------------------------------
check('every state has an outline', STATES.every((s) => s.polys.length > 0),
  `${STATES.length} states`);

const thin = STATES.filter((s) => {
  const [x0, z0, x1, z1] = s.boxes.reduce((a, b) => [
    Math.min(a[0], b[0]), Math.min(a[1], b[1]),
    Math.max(a[2], b[2]), Math.max(a[3], b[3])], [Infinity, Infinity, -Infinity, -Infinity]);
  return Math.min(x1 - x0, z1 - z0) < 180;
});
check('no state is a sliver', thin.length === 0,
  thin.length ? thin.map((s) => s.abbr).join(',') : 'thinnest side over 180 m');

const detail = STATES.reduce((s, st) => s + st.polys.reduce((t, r) => t + r.length, 0), 0);
check('the outlines carry real detail', detail > 1200,
  `${detail} vertices, ${(detail / STATES.length).toFixed(0)} per state`);

// Islands are the point of allowing more than one ring.
const islanders = STATES.filter((s) => s.polys.length > 1).map((s) => s.abbr);
check('states with islands keep them', islanders.length >= 5, islanders.join(','));
check('Michigan has its Upper Peninsula',
  STATES.find((s) => s.abbr === 'MI').polys.length >= 2);
check('Hawaii is a chain, not a blob',
  STATES.find((s) => s.abbr === 'HI').polys.length >= 4,
  `${STATES.find((s) => s.abbr === 'HI').polys.length} islands`);

// Proportions: a state has to be recognisably its own shape, not the cell's.
const aspect = (s) => {
  const [x0, z0, x1, z1] = s.boxes.reduce((a, b) => [
    Math.min(a[0], b[0]), Math.min(a[1], b[1]),
    Math.max(a[2], b[2]), Math.max(a[3], b[3])], [Infinity, Infinity, -Infinity, -Infinity]);
  return (x1 - x0) / (z1 - z0);
};
// Real width-to-height, measured off a map, for a few with no ambiguity.
const WANT = { TN: 3.4, WY: 1.4, DE: 0.36, NV: 0.60, TX: 1.05, CO: 1.4, KS: 1.7 };
const off = Object.entries(WANT)
  .map(([a, want]) => ({ a, want, got: aspect(STATES.find((s) => s.abbr === a)) }))
  .filter((r) => Math.abs(r.got - r.want) / r.want > 0.28);
check('states keep their real proportions', off.length === 0,
  off.length ? off.map((r) => `${r.a} ${r.got.toFixed(2)} want ${r.want}`).join(', ')
    : Object.keys(WANT).join(','));

// Size follows area, or Texas and Delaware come out the same size. Measured
// across the state rather than by the area inside its outline: Alaska is
// spidery and Connecticut is a solid lump, so by area alone the two come out
// alike even though nobody looking at them would say so.
// The side of the square a state would cover if it were folded into one, which
// is what "how big does it read" means for a shape that is neither square nor
// solid. The longest side alone would call a thin island the size of Texas.
const spanOf = (s) => {
  const [x0, z0, x1, z1] = s.boxes.reduce((a, b) => [
    Math.min(a[0], b[0]), Math.min(a[1], b[1]),
    Math.max(a[2], b[2]), Math.max(a[3], b[3])], [Infinity, Infinity, -Infinity, -Infinity]);
  return Math.sqrt((x1 - x0) * (z1 - z0));
};
const big = ['TX', 'CA', 'MT', 'AK'].map((a) => spanOf(STATES.find((s) => s.abbr === a)));
const small = ['DE', 'RI', 'DC', 'VI'].map((a) => spanOf(STATES.find((s) => s.abbr === a)));
check('big states are drawn bigger than small ones',
  Math.min(...big) > Math.max(...small) * 1.4,
  `${Math.round(Math.min(...big))} m vs ${Math.round(Math.max(...small))} m across`);

// --- and they have to stay in their own cell --------------------------------
const spill = STATES.filter((s) => s.boxes.some((b) =>
  b[0] < s.x0 - 0.5 || b[2] > s.x1 + 0.5 || b[1] < s.z0 - 0.5 || b[3] > s.z1 + 0.5));
check('no state overlaps its neighbours', spill.length === 0,
  spill.length ? spill.map((s) => s.abbr).join(',') : 'every outline inside its own cell');

// Idaho is the one state that is not its own shape, and that is a measured
// decision rather than an oversight: Ashcombe, the circuit road and the house
// fill 99% x 99% of its cell, and a real Idaho - which is tall and narrow, and
// only 0.62 as wide as it is deep - covers 42% of that even when it is scaled
// up until it spills into Oregon. Half the city would stand on the neutral
// ground between states with the state line down the high street.
const id = STATES.find((s) => s.abbr === 'ID');
check('Idaho is the documented full-cell exception',
  id.polys.length === 1 && id.polys[0].length === 4 && !id.town,
  'the home state holds Ashcombe, the circuit and the house');
// Four is the floor rather than a rounder number because the District of
// Columbia really is a quadrilateral - a square with the Virginia side given
// back - and a check that called that too simple would be wrong about the
// place, not about the drawing.
check('every other state has a real outline',
  STATES.filter((s) => s.abbr !== 'ID').every((s) =>
    s.polys.reduce((t, r) => t + r.length, 0) >= 4),
  `${STATES.length - 1} of ${STATES.length} states drawn from boundary data`);

// --- towns ------------------------------------------------------------------
const townless = STATES.filter((s) => !s.town && s.abbr !== 'ID').map((s) => s.abbr);
check('every state but Idaho has a town', townless.length === 0,
  townless.length ? townless.join(',') : 'Idaho has Ashcombe instead');

const offshore = [];
for (const st of STATES) {
  if (!st.town) continue;
  const { cols, rows, gap } = st.town;
  const w = cols * gap, d = rows * gap * 0.86;
  // Corners and edge midpoints: a town that pokes out of a bay passes a
  // corner-only test.
  const probes = [];
  for (let i = 0; i <= 4; i++) {
    for (let j = 0; j <= 4; j++) {
      probes.push([st.cx + (i / 4 - 0.5) * w, st.cz + (j / 4 - 0.5) * d]);
    }
  }
  const out = probes.filter(([x, z]) => !pointInShape(x, z, st.polys, st.boxes));
  if (out.length) offshore.push(`${st.abbr}(${out.length}/${probes.length})`);
}
check('every town stands on its own state', offshore.length === 0,
  offshore.length ? offshore.join(' ') : `${STATES.length - 1} towns on their own ground`);

const sizes = {};
for (const s of STATES) {
  const k = s.town ? `${s.town.cols}x${s.town.rows}` : 'Ashcombe';
  sizes[k] = (sizes[k] || 0) + 1;
}
check('town size follows the state', Object.keys(sizes).length >= 3,
  JSON.stringify(sizes));

// The cell is the budget; a state that fills it leaves no room for the roads
// between states.
const room = STATES.map((s) => s.room);
check('every state has room to build in', Math.min(...room) > 80,
  `smallest clearance ${Math.round(Math.min(...room))} m `
  + `(${STATES.find((s) => s.room === Math.min(...room)).abbr})`);

console.log(`\ncells ${COL_W[0]} x ${ROW_D[0]} m`);
const failed = checks.filter((c) => !c).length;
console.log(`${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
