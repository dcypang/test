'use strict';

const fs = require('fs');
const path = require('path');
const { PROFILES } = require('./mock');
const { WebChatAdapter } = require('./web');

function loadTargets(selectorsFile) {
  const file = selectorsFile ?? path.join(__dirname, 'targets.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function createAdapter(target, opts = {}) {
  if (PROFILES[target]) return PROFILES[target]();
  const targets = loadTargets(opts.selectors);
  if (!targets[target]) {
    throw new Error(`unknown target "${target}"; choose one of: ${[...Object.keys(PROFILES), ...Object.keys(targets)].join(', ')}`);
  }
  return new WebChatAdapter(target, targets[target], opts);
}

module.exports = { createAdapter, loadTargets };
