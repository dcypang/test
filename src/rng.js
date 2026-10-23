'use strict';

// Small seeded PRNG (mulberry32) so every run of a suite produces identical prompts.
function makeRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = (arr) => arr[Math.floor(next() * arr.length)];
  const shuffle = (arr) => {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  return { next, int, pick, shuffle };
}

// Pronounceable made-up words, so a model cannot guess a value from prior knowledge.
const ONSETS = ['b', 'd', 'f', 'g', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'v', 'z', 'br', 'dr', 'kl', 'tr', 'sk', 'th'];
const VOWELS = ['a', 'e', 'i', 'o', 'u', 'ai', 'ou', 'ea'];
function inventWord(rng, syllables = 3) {
  let w = '';
  for (let i = 0; i < syllables; i++) w += rng.pick(ONSETS) + rng.pick(VOWELS);
  w += rng.pick(['n', 'r', 'x', 's', 'l', '']);
  return w[0].toUpperCase() + w.slice(1);
}

module.exports = { makeRng, inventWord };
