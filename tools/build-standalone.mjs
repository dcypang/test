/**
 * Build a single self-contained HTML file.
 *
 * Normal play needs no build step — `index.html` loads the ES modules and the
 * vendored three.js directly. This script exists for the other case: hosting
 * the game somewhere that wants one file, or handing it to someone as a single
 * artefact. It inlines the stylesheet and bundles every module (including
 * three.js and the post-processing addons) into one classic script, so the
 * result has no imports, no import map and no subresources at all.
 *
 *   node tools/build-standalone.mjs [outfile]
 */

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] || path.join(root, 'dist', 'redline-rider.html');

const result = await build({
  entryPoints: [path.join(root, 'src/main.js')],
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  minify: true,
  legalComments: 'none',
  write: false,
  alias: {
    // The import map does this at runtime; esbuild needs it at build time.
    three: path.join(root, 'vendor/three.module.min.js'),
  },
});

const js = result.outputFiles[0].text;
const css = fs.readFileSync(path.join(root, 'styles/hud.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

// Keep only the page body: the artifact/standalone host supplies the skeleton.
const bodyMatch = html.match(/<body>([\s\S]*?)<\/body>/);
if (!bodyMatch) throw new Error('index.html: no <body> found');
const body = bodyMatch[1]
  .replace(/<script type="module"[^>]*><\/script>/g, '')
  .trim();

// The page's own <title> carries a descriptive tail for the browser tab when
// served locally; the standalone build is named as a product, so trim it.
const rawTitle = (html.match(/<title>([^<]*)<\/title>/) || [, 'Redline Rider'])[1];
const title = rawTitle.split(/\s+[—-]\s+/)[0].trim();

const page = `<title>${title}</title>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
<style>
${css}
</style>

${body}

<script>
${js}
</script>
`;

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, page);

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log(`wrote ${out}`);
console.log(`  script ${kb(js.length)}  css ${kb(css.length)}  total ${kb(page.length)}`);
