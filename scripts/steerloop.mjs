// Ten iterations of tuning the steering feel, measured rather than guessed.
//
//   node scripts/steerloop.mjs             10 iterations, prints the block to paste
//   node scripts/steerloop.mjs 20          more iterations
//   node scripts/steerloop.mjs --apply     write the winner back into physics.js
//
// Each iteration is one pass of coordinate descent over STEER_FEEL: take each
// parameter in turn, try it a step up and a step down, keep whichever scores
// best against the targets in steerlib.mjs, and shrink the step as the search
// settles. Every candidate is a full run of the measurement battery, so the
// numbers in the log are the same ones the scorecard prints.
//
// Coordinate descent rather than anything cleverer because the space is eleven
// parameters wide, one evaluation costs half a second, and the surface has
// obvious ridges - lock against damping, damping against grip assist - that a
// per-axis search walks along quite happily.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeHarness, measure, score, report } from './steerlib.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

// [min, max, initial step]. Anything not listed is left alone.
const SPACE = {
  lockMargin: [0.7, 2.6, 0.25],
  understeerK: [0.0, 0.020, 0.004],
  rackLow: [3.0, 14.0, 2.0],
  rackHigh: [2.0, 12.0, 2.0],
  inputGamma: [1.0, 2.4, 0.2],
  yawDamp: [0.0, 12.0, 2.0],
  gripAssist: [0.0, 8.0, 1.0],
  escYaw: [0.5, 6.0, 0.8],
  escBeta: [0.5, 6.0, 0.8],
  betaThreshold: [0.06, 0.30, 0.04],
  lockPark: [0.45, 0.80, 0.05],
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round = (v) => +v.toFixed(4);

const h = makeHarness();
const evals = { n: 0 };

function evaluate(params) {
  h.setFeel(params);
  evals.n++;
  const m = measure(h);
  return { m, s: score(m) };
}

const iterations = Number(process.argv.find((a) => /^\d+$/.test(a))) || 10;

let best = h.getFeel();
let bestRun = evaluate(best);
const history = [{ iter: 0, penalty: bestRun.s.penalty, note: 'starting point' }];

console.log(`steering tuning loop — ${iterations} iterations\n`);
console.log(`iter 0   penalty ${bestRun.s.penalty.toFixed(3)}   (starting point)`);
console.log(`         worst: ${bestRun.s.misses.slice(0, 4).map(([k, v]) => `${k} ${v}`).join(', ')}\n`);

const steps = {};
for (const [k, [, , step]] of Object.entries(SPACE)) steps[k] = step;

for (let iter = 1; iter <= iterations; iter++) {
  let improvedAny = false;
  const changed = [];

  for (const [key, [lo, hi]] of Object.entries(SPACE)) {
    const step = steps[key];
    if (step <= 1e-4) continue;
    const current = best[key];
    let localBest = null;

    for (const dir of [1, -1]) {
      const value = clamp(round(current + dir * step), lo, hi);
      if (value === current) continue;
      const trial = Object.assign({}, best, { [key]: value });
      const run = evaluate(trial);
      if (run.s.penalty < (localBest ? localBest.run.s.penalty : bestRun.s.penalty) - 1e-6) {
        localBest = { value, run };
      }
    }

    if (localBest) {
      changed.push(`${key} ${current} -> ${localBest.value}`);
      best = Object.assign({}, best, { [key]: localBest.value });
      bestRun = localBest.run;
      improvedAny = true;
    } else {
      // No gain either way: this axis is at a local optimum, so look closer.
      steps[key] = round(step * 0.5);
    }
  }

  history.push({ iter, penalty: bestRun.s.penalty, note: changed.join(', ') || 'no move' });
  console.log(`iter ${String(iter).padEnd(3)} penalty ${bestRun.s.penalty.toFixed(3)}`
    + `   ${changed.length ? changed.join(', ') : 'no improvement, refining steps'}`);
  if (bestRun.s.misses.length) {
    console.log(`         worst: ${bestRun.s.misses.slice(0, 4).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  } else {
    console.log('         every target met');
  }

  // Nothing moved and every step is tiny: further iterations cannot help.
  if (!improvedAny && Object.values(steps).every((s) => s < 0.02)) {
    console.log('\nconverged early — no axis can improve at any step size');
    break;
  }
}

console.log('\n--- final ---\n');
h.setFeel(best);
const finalM = measure(h);
report(finalM, score(finalM));

console.log('\nprogress: ' + history.map((r) => r.penalty.toFixed(2)).join('  ->  '));
console.log(`${evals.n} evaluations\n`);

const block = Object.entries(best)
  .map(([k, v]) => `  ${k}: ${typeof v === 'number' ? round(v) : v},`).join('\n');
console.log('winning parameters:\n{\n' + block + '\n}');

if (process.argv.includes('--apply')) {
  const file = join(root, 'src', 'physics.js');
  let s = readFileSync(file, 'utf8');
  let n = 0;
  for (const [k, v] of Object.entries(best)) {
    const re = new RegExp(`(\\n  ${k}: )(-?[0-9.]+)(,)`);
    if (re.test(s)) { s = s.replace(re, `$1${round(v)}$3`); n++; }
  }
  writeFileSync(file, s);
  console.log(`\napplied ${n} parameters to src/physics.js`);
}
