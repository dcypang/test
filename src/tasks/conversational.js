'use strict';

const { makeRng, inventWord } = require('../rng');

// Every fact is stated as "my <attr> is <value>" and probed as "What is my <attr>?".
// Values are invented so the only way to answer is to remember them. No value may
// contain a period, which keeps the simulated backend's parser simple.
const ATTRIBUTES = [
  { attr: "cat's name", value: (r) => inventWord(r, 2) },
  { attr: 'locker code', value: (r) => String(r.int(1000, 9999)) },
  { attr: "sister's name", value: (r) => inventWord(r, 3) },
  { attr: 'license plate', value: (r) => `${inventWord(r, 1).slice(0, 2).toUpperCase()}-${r.int(1000, 9999)}` },
  { attr: 'project codename', value: (r) => inventWord(r, 3) },
  { attr: 'apartment number', value: (r) => String(r.int(100, 989)) },
  { attr: 'wifi network name', value: (r) => `${inventWord(r, 2)}-${r.int(10, 99)}` },
  { attr: "dentist's surname", value: (r) => inventWord(r, 3) },
  { attr: 'gym membership number', value: (r) => `GM${r.int(100000, 999999)}` },
  { attr: "boat's name", value: (r) => inventWord(r, 2) },
  { attr: 'favorite tea blend', value: (r) => `${inventWord(r, 2)} oolong` },
  { attr: 'bike lock combination', value: (r) => `${r.int(0, 9)}${r.int(0, 9)}${r.int(0, 9)}${r.int(0, 9)}` },
];

const DISTRACTORS = [
  'Give me one fun fact about octopuses.',
  'What is a good name for a houseplant? Just one suggestion.',
  'In one sentence, why is the sky blue?',
  'Suggest a quick 10-minute stretching routine in one line.',
  'What rhymes with "orange"? One short answer.',
  'Name one classic board game and say why it is fun.',
  'In one sentence, what does a sommelier do?',
  'Give me a one-line tip for staying focused while studying.',
  'What is the capital of Australia?',
  'Recommend one sci-fi novel in a single sentence.',
  'How many legs does a spider have?',
  'Give me a one-sentence summary of photosynthesis.',
  'What is a haiku? Answer briefly.',
  'Suggest one easy dinner idea for a weeknight.',
  'In one sentence, what causes ocean tides?',
  'Name a famous painting and its painter.',
  'What is the boiling point of water in Celsius?',
  'Give me one synonym for "happy".',
  'What is one benefit of drinking water? One sentence.',
  'Translate "good morning" into Spanish.',
];

const PREAMBLE =
  'I am going to chat with you about a few things. Please keep every reply under 40 words.';

function sayFact(f) {
  return `Just so you know, my ${f.attr} is ${f.value}.`;
}

function freshFacts(rng, n) {
  return rng.shuffle(ATTRIBUTES).slice(0, n).map((a) => ({ attr: a.attr, value: a.value(rng) }));
}

function distractors(rng, n) {
  const out = [];
  let pool = [];
  while (out.length < n) {
    if (pool.length === 0) pool = rng.shuffle(DISTRACTORS);
    out.push(pool.pop());
  }
  return out;
}

function say(text) {
  return { type: 'say', text };
}

// Builds the conversational-memory suite. Each task runs in a fresh chat and ends
// with exactly one scored probe.
function buildConversational({ seed = 1, repeats = 3, delays = [0, 5, 15], crossSession = false } = {}) {
  const rng = makeRng(seed);
  const tasks = [];
  const add = (category, steps, probe, expect, meta = {}) =>
    tasks.push({ id: `conv-${category}-${tasks.filter((t) => t.category === category).length + 1}`, suite: 'conversational', category, steps, probe, expect, meta });

  for (let rep = 0; rep < repeats; rep++) {
    // 1. Single-fact recall after N unrelated turns.
    for (const d of delays) {
      const [f] = freshFacts(rng, 1);
      add(`recall_after_${d}_turns`, [say(PREAMBLE), say(sayFact(f)), ...distractors(rng, d).map(say)],
        `What is my ${f.attr}?`, { all: [f.value] }, { delay: d, facts: [f] });
    }

    // 2. Several facts interleaved with chatter; probe asks for two of them at once.
    {
      const facts = freshFacts(rng, 5);
      const steps = [say(PREAMBLE)];
      for (const f of facts) steps.push(say(sayFact(f)), ...distractors(rng, 2).map(say));
      const [a, b] = rng.shuffle(facts);
      add('multi_fact', steps, `What is my ${a.attr}, and what is my ${b.attr}?`, { all: [a.value, b.value] }, { facts });
    }

    // 3. Knowledge update: the newest value must win.
    {
      const [f] = freshFacts(rng, 1);
      const fresh = ATTRIBUTES.find((x) => x.attr === f.attr).value(rng);
      add('fact_update', [
        say(PREAMBLE), say(sayFact(f)), ...distractors(rng, 3).map(say),
        say(`Correction: my ${f.attr} is now ${fresh}.`), ...distractors(rng, 2).map(say),
      ], `What is my ${f.attr} right now?`, { all: [fresh] }, { old: f.value, new: fresh });
    }

    // 4. Abstention: ask about something never mentioned. A correct answer admits it doesn't know.
    {
      const facts = freshFacts(rng, 4);
      const [asked, ...told] = facts;
      const steps = [say(PREAMBLE)];
      for (const f of told) steps.push(say(sayFact(f)), ...distractors(rng, 1).map(say));
      add('abstention', steps, `What is my ${asked.attr}?`, { abstain: true }, { asked: asked.attr });
    }

    // 5. Cross-session: tell it in one chat, ask in a brand-new chat. This exercises the
    // app's persistent memory and writes fake facts into the account, so it is opt-in.
    if (crossSession) {
      const [f] = freshFacts(rng, 1);
      add('cross_session', [
        say(`Please remember this for future conversations: my ${f.attr} is ${f.value}.`),
        { type: 'newChat' },
      ], `What is my ${f.attr}?`, { all: [f.value] }, { facts: [f] });
    }
  }
  return tasks;
}

module.exports = { buildConversational, ATTRIBUTES, DISTRACTORS };
