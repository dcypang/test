#!/usr/bin/env node
'use strict';

// Opens a visible browser so you can sign in, then saves the session for --storage-state.
// Usage: node src/login.js <gemini|muse> [out-file]
// Google may refuse sign-in from an automated browser; if it does, use --cdp with your own Chrome instead.
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { loadTargets } = require('./adapters');

async function main() {
  const [target, outArg] = process.argv.slice(2);
  const cfg = loadTargets()[target];
  if (!cfg) {
    console.error('Usage: node src/login.js <gemini|muse> [out-file]');
    process.exit(1);
  }
  const out = outArg ?? path.join('.auth', `${target}.json`);
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(cfg.newChatUrl);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise((resolve) => rl.question(`Sign in to ${cfg.label} in the browser window, then press Enter here... `, resolve));
  rl.close();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await context.storageState({ path: out });
  await browser.close();
  console.log(`Saved session to ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
