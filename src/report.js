#!/usr/bin/env node
'use strict';

const fs = require('fs');

// Usage: node src/report.js results/gemini.jsonl results/muse.jsonl > report.md
function load(files) {
  return files.flatMap((f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
}

const pct = (rows) => (rows.length ? `${Math.round((100 * rows.reduce((s, r) => s + r.score, 0)) / rows.length)}%` : '–');
const median = (xs) => {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const uniq = (xs) => [...new Set(xs)];
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
const cell = (r) => (!r ? '' : r.status === 'error' ? 'ERR' : r.score === 1 ? '✓' : r.score === 0 ? '✗' : `${Math.round(r.score * 100)}%`);

function report(records) {
  const targets = uniq(records.map((r) => r.target));
  const of = (t, pred = () => true) => records.filter((r) => r.target === t && pred(r));
  const out = ['# Memory benchmark results', ''];
  out.push('Scores are the mean per-task score (partial credit on multi-value answers). Errors count as 0.', '');

  out.push('## Summary', '', table(
    ['Target', 'Conversational memory', 'Long-context recall', 'Overall', 'Errors', 'Median reply time'],
    targets.map((t) => {
      const lat = median(of(t, (r) => r.status === 'ok').map((r) => r.latencyMs));
      return [t, pct(of(t, (r) => r.suite === 'conversational')), pct(of(t, (r) => r.suite === 'long_context')), pct(of(t)),
        String(of(t, (r) => r.status === 'error').length), lat == null ? '–' : `${(lat / 1000).toFixed(1)} s`];
    }),
  ), '');

  const cats = uniq(records.filter((r) => r.suite === 'conversational').map((r) => r.category));
  if (cats.length) {
    out.push('## Conversational memory by category', '', table(
      ['Category', ...targets],
      cats.map((c) => [c, ...targets.map((t) => {
        const rows = of(t, (r) => r.category === c);
        return rows.length ? `${pct(rows)} (n=${rows.length})` : '–';
      })]),
    ), '');
  }

  const lc = records.filter((r) => r.suite === 'long_context');
  if (lc.length) {
    out.push('## Long-context recall', '', '✓ found, ✗ missed, % = share of needles found, ERR = the app returned no reply.', '');
    const sizes = uniq(lc.map((r) => r.meta.tokens)).sort((a, b) => a - b);
    const depths = uniq(lc.filter((r) => r.category === 'single_needle').map((r) => r.meta.depth)).sort((a, b) => a - b);
    for (const t of targets) {
      const find = (pred) => of(t, (r) => r.suite === 'long_context' && pred(r))[0];
      out.push(`### ${t}`, '', table(
        ['≈ tokens', ...depths.map((d) => `depth ${Math.round(d * 100)}%`), '3 needles'],
        sizes.map((s) => [s.toLocaleString('en-US'),
          ...depths.map((d) => cell(find((r) => r.category === 'single_needle' && r.meta.tokens === s && r.meta.depth === d))),
          cell(find((r) => r.category === 'multi_needle' && r.meta.tokens === s))]),
      ), '');
    }
  }

  const errors = records.filter((r) => r.status === 'error');
  if (errors.length) {
    out.push('## Errors', '', table(['Target', 'Task', 'Error'], errors.map((r) => [r.target, r.id, r.error.replace(/\|/g, '\\|')])), '');
  }
  return out.join('\n');
}

if (require.main === module) {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error('Usage: node src/report.js <results.jsonl>...');
    process.exit(1);
  }
  process.stdout.write(report(load(files)));
}

module.exports = { report, load };
