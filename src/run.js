#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { parseArgs } = require('util');
const { buildConversational } = require('./tasks/conversational');
const { buildLongContext } = require('./tasks/longContext');
const { createAdapter } = require('./adapters');
const { score } = require('./score');

const HELP = `Usage: node src/run.js --target <mock|mock-small|gemini|muse> [options]

  --suite <list>        conversational,long_context (default: both)
  --repeats <n>         repetitions of each conversational category (default 3)
  --delays <list>       distractor turns for recall tests (default 0,5,15)
  --sizes <list>        long-context sizes in approx. tokens (default 2000,8000,32000,64000,128000)
  --depths <list>       needle depths 0..1 (default 0,0.25,0.5,0.75,1)
  --cross-session       include the cross-chat memory test (writes fake facts into the account's memory)
  --only <regex>        run only task ids matching the regex
  --out <file>          results JSONL (default results/<target>.jsonl)
  --resume              skip task ids already in the results file
  --list                print the tasks and exit, without running them
  --cdp <url>           attach to your signed-in Chrome, e.g. http://localhost:9222 (web targets)
  --storage-state <f>   Playwright storage state file to launch with (web targets)
  --headed              show the browser when launching (web targets)
  --selectors <file>    override src/adapters/targets.json
  --pace-ms <n>         pause between messages (default 0 for mock targets, 2000 for web)
  --timeout-ms <n>      per-reply timeout (default 180000)
`;

const list = (s, f = Number) => s.split(',').map((x) => f(x.trim()));

function parse(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      target: { type: 'string' }, suite: { type: 'string', default: 'conversational,long_context' },
      repeats: { type: 'string', default: '3' }, delays: { type: 'string', default: '0,5,15' },
      sizes: { type: 'string', default: '2000,8000,32000,64000,128000' }, depths: { type: 'string', default: '0,0.25,0.5,0.75,1' },
      'cross-session': { type: 'boolean', default: false }, only: { type: 'string' }, out: { type: 'string' },
      resume: { type: 'boolean', default: false }, list: { type: 'boolean', default: false },
      cdp: { type: 'string' }, 'storage-state': { type: 'string' }, headed: { type: 'boolean', default: false },
      selectors: { type: 'string' }, 'pace-ms': { type: 'string' }, 'timeout-ms': { type: 'string', default: '180000' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  return values;
}

function buildTasks(o) {
  const suites = list(o.suite, String);
  let tasks = [];
  if (suites.includes('conversational')) {
    tasks.push(...buildConversational({ repeats: Number(o.repeats), delays: list(o.delays), crossSession: o['cross-session'] }));
  }
  if (suites.includes('long_context')) tasks.push(...buildLongContext({ sizes: list(o.sizes), depths: list(o.depths) }));
  if (o.only) tasks = tasks.filter((t) => new RegExp(o.only).test(t.id));
  return tasks;
}

async function runTask(adapter, task, paceMs) {
  const pause = () => (paceMs ? new Promise((r) => setTimeout(r, paceMs)) : null);
  await adapter.newChat();
  for (const step of task.steps) {
    if (step.type === 'newChat') await adapter.newChat();
    else await adapter.send(step.text);
    await pause();
  }
  const started = Date.now();
  const reply = await adapter.send(task.probe);
  return { reply, latencyMs: Date.now() - started };
}

async function main() {
  const o = parse(process.argv.slice(2));
  if (o.help || (!o.target && !o.list)) {
    process.stdout.write(HELP);
    return;
  }
  const tasks = buildTasks(o);
  if (o.list) {
    for (const t of tasks) console.log(`${t.id}\t${t.steps.length} setup turns\t${t.probe.length} probe chars`);
    console.log(`${tasks.length} tasks`);
    return;
  }

  const isMock = o.target.startsWith('mock');
  const paceMs = Number(o['pace-ms'] ?? (isMock ? 0 : 2000));
  const out = o.out ?? path.join('results', `${o.target}.jsonl`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const done = new Set();
  if (o.resume && fs.existsSync(out)) {
    for (const line of fs.readFileSync(out, 'utf8').split('\n').filter(Boolean)) {
      const r = JSON.parse(line);
      if (r.status === 'ok') done.add(r.id);
    }
  } else {
    fs.writeFileSync(out, '');
  }

  const adapter = createAdapter(o.target, {
    cdp: o.cdp, storageState: o['storage-state'], headless: !o.headed,
    selectors: o.selectors, timeoutMs: Number(o['timeout-ms']),
  });
  await adapter.init();
  let passed = 0;
  let ran = 0;
  try {
    for (const task of tasks) {
      if (done.has(task.id)) continue;
      const rec = { id: task.id, target: o.target, suite: task.suite, category: task.category, meta: task.meta, timestamp: new Date().toISOString() };
      try {
        const { reply, latencyMs } = await runTask(adapter, task, paceMs);
        Object.assign(rec, { status: 'ok', reply: reply.slice(0, 2000), latencyMs }, score(task.expect, reply));
      } catch (err) {
        Object.assign(rec, { status: 'error', error: String(err.message ?? err), score: 0, pass: false });
      }
      fs.appendFileSync(out, `${JSON.stringify(rec)}\n`);
      ran++;
      if (rec.pass) passed++;
      console.log(`${rec.pass ? 'PASS' : rec.status === 'error' ? 'ERR ' : 'FAIL'}  ${task.id}  ${rec.detail ?? rec.error}`);
    }
  } finally {
    await adapter.close();
  }
  console.log(`\n${passed}/${ran} passed; results in ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
