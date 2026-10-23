'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { buildConversational } = require('../src/tasks/conversational');
const { buildLongContext, CHARS_PER_TOKEN } = require('../src/tasks/longContext');
const { score } = require('../src/score');
const { MockAdapter } = require('../src/adapters/mock');

test('task generation is deterministic', () => {
  assert.deepStrictEqual(buildConversational(), buildConversational());
  assert.deepStrictEqual(buildLongContext({ sizes: [2000] }), buildLongContext({ sizes: [2000] }));
});

test('task ids are unique', () => {
  const tasks = [...buildConversational({ crossSession: true }), ...buildLongContext()];
  assert.strictEqual(new Set(tasks.map((t) => t.id)).size, tasks.length);
});

test('long-context documents hit the requested size and contain each needle once', () => {
  for (const t of buildLongContext({ sizes: [2000, 8000] })) {
    assert.ok(Math.abs(t.meta.chars - t.meta.tokens * CHARS_PER_TOKEN) / (t.meta.tokens * CHARS_PER_TOKEN) < 0.05, t.id);
    for (const code of t.expect.all) assert.strictEqual(t.probe.split(code).length - 1, 1, t.id);
  }
});

test('needle sits at the requested depth', () => {
  for (const t of buildLongContext({ sizes: [8000], multiNeedle: false })) {
    const pos = t.probe.indexOf(t.expect.all[0]) / t.probe.length;
    assert.ok(Math.abs(pos - t.meta.depth) < 0.03, `${t.id}: at ${pos}`);
  }
});

test('scoring ignores formatting and gives partial credit', () => {
  assert.strictEqual(score({ all: ['5829-TOVA'] }, 'The code is **5829 tova**.').score, 1);
  assert.strictEqual(score({ all: ['A1', 'B2'] }, 'a1 only').score, 0.5);
  assert.strictEqual(score({ all: ['Zorbex'] }, 'No idea').score, 0);
  assert.strictEqual(score({ abstain: true }, "You haven't told me your dentist's surname.").pass, true);
  assert.strictEqual(score({ abstain: true }, 'It is Dr Kloutra.').pass, false);
});

test('an unlimited mock passes every task; a small-window mock fails some', async () => {
  const tasks = [...buildConversational({ crossSession: true }), ...buildLongContext({ sizes: [2000, 32000] })];
  const runAll = async (adapter) => {
    const scores = [];
    for (const t of tasks) {
      await adapter.newChat();
      for (const s of t.steps) {
        if (s.type === 'newChat') await adapter.newChat();
        else await adapter.send(s.text);
      }
      scores.push(score(t.expect, await adapter.send(t.probe)).score);
    }
    return scores;
  };
  assert.ok((await runAll(new MockAdapter())).every((s) => s === 1));
  assert.ok((await runAll(new MockAdapter({ windowChars: 40000, persistentMemory: false }))).some((s) => s < 1));
});
