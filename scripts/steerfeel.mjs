// Prints the steering-feel scorecard for the current physics.js.
//   node scripts/steerfeel.mjs
//   node scripts/steerfeel.mjs --json
import { makeHarness, measure, score, report } from './steerlib.mjs';

const h = makeHarness();
const m = measure(h);
const s = score(m);

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ metrics: m, ...s }));
} else {
  console.log('steering feel — targets are for an arcade mobile racer\n');
  report(m, s);
}
