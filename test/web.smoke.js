'use strict';

// End-to-end check of the Playwright adapter against the local fake chat page.
// Run with: npm run test:web   (needs a Chromium that Playwright can launch)
const test = require('node:test');
const assert = require('node:assert');
const { startFakeChat } = require('./fake-chat-server');
const { WebChatAdapter } = require('../src/adapters/web');
const { loadTargets } = require('../src/adapters');
const { buildConversational } = require('../src/tasks/conversational');
const { buildLongContext } = require('../src/tasks/longContext');
const { score } = require('../src/score');

test('web adapter drives a streaming chat UI', { timeout: 300000 }, async () => {
  const server = await startFakeChat();
  const cfg = { ...loadTargets().gemini, newChatUrl: `http://127.0.0.1:${server.address().port}/` };
  const adapter = new WebChatAdapter('fake', cfg, { stableMs: 500 });
  await adapter.init();
  try {
    const tasks = [
      ...buildConversational({ repeats: 1, delays: [2] }),
      ...buildLongContext({ sizes: [32000], depths: [0.5] }),
    ];
    for (const t of tasks) {
      await adapter.newChat();
      for (const s of t.steps) await adapter.send(s.text);
      const reply = await adapter.send(t.probe);
      assert.strictEqual(score(t.expect, reply).score, 1, `${t.id}: ${reply}`);
    }
  } finally {
    await adapter.close();
    server.close();
  }
});
