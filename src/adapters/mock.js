'use strict';

// Simulated backend for testing the harness offline. It keeps only the last
// `windowChars` characters of the chat (like a context window) and answers
// questions by looking up stated facts in that window. With `persistentMemory`,
// facts the user asks it to "remember" survive into new chats.
class MockAdapter {
  constructor({ name = 'mock', windowChars = Infinity, persistentMemory = true } = {}) {
    this.name = name;
    this.windowChars = windowChars;
    this.persistentMemory = persistentMemory;
    this.saved = new Map();
    this.history = '';
  }

  async init() {}
  async close() {}

  async newChat() {
    this.history = '';
  }

  async send(text) {
    this.history += `\n${text}`;
    const visible = this.history.slice(-this.windowChars);
    const facts = new Map(this.persistentMemory ? this.saved : []);
    for (const m of visible.matchAll(/my ([a-z' ]+?) is (?:now )?([^\s.][^.]*?)\./gi)) facts.set(m[1].toLowerCase(), m[2]);
    for (const m of visible.matchAll(/access code for the (\w+) archive is ([\w-]+)\./g)) facts.set(m[1].toLowerCase(), m[2]);
    if (this.persistentMemory && /remember this/i.test(text)) {
      for (const m of text.matchAll(/my ([a-z' ]+?) is ([^\s.][^.]*?)\./gi)) this.saved.set(m[1].toLowerCase(), m[2]);
    }
    if (!text.includes('?')) return 'Got it.';
    const question = text.slice(text.lastIndexOf('Question:') + 1).toLowerCase();
    const hits = [...facts].filter(([key]) => question.includes(key)).map(([key, v]) => `${key}: ${v}`);
    return hits.length ? `Here you go: ${hits.join('; ')}.` : "I don't know, you haven't told me that.";
  }
}

const PROFILES = {
  'mock': () => new MockAdapter({ name: 'mock' }),
  // ~10k-token window and no cross-chat memory, so the report shows realistic failures.
  'mock-small': () => new MockAdapter({ name: 'mock-small', windowChars: 40000, persistentMemory: false }),
};

module.exports = { MockAdapter, PROFILES };
