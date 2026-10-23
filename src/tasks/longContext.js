'use strict';

const { makeRng, inventWord } = require('../rng');

// Rough conversion used to size documents; real tokenizers differ by roughly ±20%.
const CHARS_PER_TOKEN = 4;

const PLACES = ['east wing', 'north dock', 'loading bay', 'cold store', 'server hall', 'west yard', 'boiler room', 'atrium'];
const ITEMS = ['conveyor', 'pump', 'generator', 'freight lift', 'chiller', 'compressor', 'forklift', 'air handler'];
const ACTIONS = ['inspected', 'cleaned', 'recalibrated', 'serviced', 'logged', 'tested', 'repainted', 'lubricated'];
const NOTES = [
  'No anomalies were reported.',
  'The shift supervisor signed off on the work.',
  'A follow-up visit was scheduled for next quarter.',
  'Readings were within normal tolerance.',
  'Spare parts were returned to inventory.',
  'The area was cleared for normal operations.',
];

// Synthetic maintenance-log filler. It is deliberately bland and never uses the
// words "archive" or "access code", so it cannot collide with a needle.
function filler(rng, chars) {
  const parts = [];
  let len = 0;
  let entry = rng.int(100, 900);
  while (len < chars) {
    const s = `Log entry ${entry++}: the crew ${rng.pick(ACTIONS)} ${rng.pick(ITEMS)} ${rng.int(1, 40)} in the ${rng.pick(PLACES)}, ` +
      `recording a reading of ${rng.int(10, 99)} units at ${rng.int(0, 23)}:${String(rng.int(0, 59)).padStart(2, '0')}. ${rng.pick(NOTES)}`;
    parts.push(s);
    len += s.length + 1;
  }
  return parts;
}

function makeNeedle(rng) {
  const archive = inventWord(rng, 2);
  const code = `${rng.int(1000, 9999)}-${inventWord(rng, 2).toUpperCase()}`;
  return { archive, code, text: `Important: the access code for the ${archive} archive is ${code}.` };
}

// Inserts needles at fractional depths (0 = start, 1 = end) between filler sentences.
function assemble(sentences, needles) {
  const out = sentences.slice();
  const placed = needles.map((n) => ({ ...n, index: Math.round(n.depth * out.length) })).sort((a, b) => b.index - a.index);
  for (const n of placed) out.splice(n.index, 0, n.text);
  return out.join(' ');
}

function prompt(doc, question) {
  return 'Below is a long document. Read it carefully, then answer the question that follows it.\n\n' +
    `<document>\n${doc}\n</document>\n\nQuestion: ${question}`;
}

// Builds the long-context recall suite: a single needle across a size × depth grid,
// plus a three-needle variant per size. Every task is a single message in a fresh chat.
function buildLongContext({ seed = 2, sizes = [2000, 8000, 32000, 64000, 128000], depths = [0, 0.25, 0.5, 0.75, 1], multiNeedle = true } = {}) {
  const rng = makeRng(seed);
  const tasks = [];
  for (const size of sizes) {
    for (const depth of depths) {
      const needle = { ...makeNeedle(rng), depth };
      const doc = assemble(filler(rng, size * CHARS_PER_TOKEN), [needle]);
      tasks.push({
        id: `lc-single-${size}-${Math.round(depth * 100)}`, suite: 'long_context', category: 'single_needle',
        steps: [], probe: prompt(doc, `What is the access code for the ${needle.archive} archive? Reply with just the code.`),
        expect: { all: [needle.code] }, meta: { tokens: size, depth, chars: doc.length },
      });
    }
    if (multiNeedle) {
      const needles = [0.15, 0.5, 0.85].map((depth) => ({ ...makeNeedle(rng), depth }));
      const doc = assemble(filler(rng, size * CHARS_PER_TOKEN), needles);
      const names = needles.map((n) => n.archive);
      tasks.push({
        id: `lc-multi-${size}`, suite: 'long_context', category: 'multi_needle',
        steps: [], probe: prompt(doc, `What are the access codes for the ${names.slice(0, -1).join(', ')} and ${names.at(-1)} archives?`),
        expect: { all: needles.map((n) => n.code) }, meta: { tokens: size, depths: needles.map((n) => n.depth), chars: doc.length },
      });
    }
  }
  return tasks;
}

module.exports = { buildLongContext, CHARS_PER_TOKEN };
