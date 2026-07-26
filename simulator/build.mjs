/* Bundle src/app.js (three.js inlined, minified) into a single-file
   simulator/index.html. Usage: node build.mjs
   Requires: npm i three esbuild (resolved via NODE_PATH or local node_modules). */
import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "src", "bundle.js");

await build({
  entryPoints: [join(here, "src", "app.js")],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  outfile: out,
  logLevel: "warning",
});

const tpl = readFileSync(join(here, "src", "template.html"), "utf8");
const js = readFileSync(out, "utf8");
const html = tpl.replace("/*__BUNDLE__*/", () => js);
writeFileSync(join(here, "index.html"), html);
console.log("simulator/index.html written,", (html.length/1024).toFixed(0), "KB");
