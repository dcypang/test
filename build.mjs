// Bundles src/*.js into a single self-contained index.html.
// No dependencies: `node build.mjs`.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const src = join(root, 'src');

// Load order matters: constants are evaluated at parse time.
const FILES = [
  'math.js',
  'gl.js',
  'mesh.js',
  'shaders.js',
  'physics.js',
  'car_model.js',
  'world.js',
  'props.js',
  'scenes.js',
  'renderer.js',
  'car.js',
  'ai.js',
  'audio.js',
  'hud.js',
  'ui.js',
  'game.js',
  'main.js',
];

const parts = FILES.map((name) => {
  const code = readFileSync(join(src, name), 'utf8');
  return `// ===== ${name} ${'='.repeat(Math.max(0, 62 - name.length))}\n${code}`;
});

const bundle = `'use strict';\n(function () {\n${parts.join('\n\n')}\n})();\n`;

const template = readFileSync(join(src, 'index.template.html'), 'utf8');
const html = template.replace('/*__BUNDLE__*/', () => bundle);

const out = join(root, 'index.html');
writeFileSync(out, html);

const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
console.log(`built index.html  (${FILES.length} modules, ${kb} KB)`);
