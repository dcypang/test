// Measures z-fighting, rather than squinting at screenshots for it.
//   node scripts/flicker.mjs [tag]
//
// Two surfaces at the same depth swap which one wins from frame to frame, and
// that swapping is the flicker. A still frame cannot show it, so this looks for
// the ambiguity itself.
//
// Nudging the camera does not work - a millimetre of movement is far below the
// depth buffer's own quantum out at the distances that fight, so nothing
// changes and the probe reports all clear. Instead the depth *mapping* is
// perturbed: in a perspective matrix the near and far planes touch only the z
// row, so moving the far plane by a twentieth of a percent leaves every pixel
// exactly where it was on screen and only changes how depth is quantised.
//
// A render with no depth ambiguity is then identical between the two. Every
// pixel that changes is two surfaces disagreeing about which one is in front,
// with no parallax to confuse it.
import { launch } from './browser.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';

const tag = process.argv[2] || 'now';
const root = dirname(dirname(fileURLToPath(import.meta.url)));

const browser = await launch();
const page = await (await browser.newContext({
  viewport: { width: 1280, height: 760 }, deviceScaleFactor: 1,
})).newPage();
page.on('pageerror', (e) => console.log('pageerror: ' + e.message));
await page.goto('file://' + join(root, 'index.html'));

const t0 = Date.now();
while (Date.now() - t0 < 600000) {
  if (await page.evaluate(() => window.__game && window.__game.state === 'menu')
    .catch(() => false)) break;
  await page.waitForTimeout(300);
}

await page.evaluate(() => {
  const g = window.__game;
  g.manualStep = true;
  g.startRace();
  g.raceState.countdown = 0;
  g.startDriveHome();
  while (g.legIndex < g.legs.length - 1) g.advanceLeg();
  g.update(1 / 60);
  // The HUD is drawn on a separate canvas, but the banner text and the map
  // would still be counted if anything animated; freeze what we can.
  g.hud.compact = false;
});

const views = [
  ['a town crossroads, low',   [778, 3.2, 733], [804, 0.2, 759]],
  ['a town crossroads, above', [804, 62, 789],  [804, 0, 759]],
  ['roads running together',   [520, 26, 740],  [520, 0, 690]],
  ['a long straight',          [500, 2.6, 1080], [500, 1.4, 300]],
  ['the country from height',  [500, 340, 1200], [500, 0, 400]],
];

// Both renders and the comparison happen in the page: a frame of pixels does
// not survive the trip back through the driver, and only the count is wanted.
const measure = (from, at) => page.evaluate(([from, at]) => {
  const g = window.__game;
  const cam = g.camera;
  const grab = (farScale) => {
    // Perturb the depth mapping rather than the camera. In a perspective matrix
    // the near and far planes touch only the z row, so moving the far plane by
    // a twentieth of a percent leaves every pixel exactly where it was and
    // changes only how depth is quantised. A render with no depth ambiguity in
    // it is then bit-identical, and every pixel that does change is two
    // surfaces disagreeing about which is in front.
    const old = cam.update.bind(cam);
    const oldProj = cam.applyProjection.bind(cam);
    cam.update = () => { cam.pos = from.slice(); cam.target = at.slice(); };
    // The game's own near and far, whatever they currently are, with the far
    // plane scaled: hardcoding them here would silently stop measuring the
    // build once they were tuned.
    const near = g.camera.nearPlane, far = g.camera.farPlane;
    cam.applyProjection = (aspect) => oldProj(aspect, near, far * farScale);
    for (let i = 0; i < 3; i++) { g.update(0); g.draw(0); }
    cam.update = old;
    cam.applyProjection = oldProj;
    const gc = g.renderer.gl.canvas;
    const c = document.createElement('canvas');
    c.width = gc.width; c.height = gc.height;
    const cx = c.getContext('2d');
    cx.drawImage(gc, 0, 0);
    return cx.getImageData(0, 0, c.width, c.height).data;
  };
  const a = grab(1), b = grab(1.0005);
  let changed = 0;
  const n = a.length / 4;
  // The scene in grey with the ambiguous pixels picked out in red, because the
  // number says how much is fighting and the picture says what.
  const mask = document.createElement('canvas');
  mask.width = g.renderer.gl.canvas.width;
  mask.height = g.renderer.gl.canvas.height;
  const mx = mask.getContext('2d');
  const img = mx.createImageData(mask.width, mask.height);
  for (let i = 0; i < a.length; i += 4) {
    const hit = Math.abs(a[i] - b[i]) > 18 || Math.abs(a[i + 1] - b[i + 1]) > 18
      || Math.abs(a[i + 2] - b[i + 2]) > 18;
    if (hit) changed++;
    const grey = (a[i] * 0.3 + a[i + 1] * 0.6 + a[i + 2] * 0.1) * 0.5;
    img.data[i] = hit ? 255 : grey;
    img.data[i + 1] = hit ? 0 : grey;
    img.data[i + 2] = hit ? 0 : grey;
    img.data[i + 3] = 255;
  }
  mx.putImageData(img, 0, 0);
  return { pct: 100 * changed / n, pixels: n, mask: mask.toDataURL('image/png') };
}, [from, at]);

console.log(`z-fighting probe (${tag}) - share of pixels that flip when the`);
console.log('far plane moves by a twentieth of a percent (no parallax at all)\n');
let worst = 0;
mkdirSync(join(root, 'shots'), { recursive: true });
for (const [name, from, at] of views) {
  const { pct, mask } = await measure(from, at);
  worst = Math.max(worst, pct);
  const file = `zf-${tag}-${name.replace(/[^a-z]+/gi, '-')}.png`;
  writeFileSync(join(root, 'shots', file),
    Buffer.from(mask.split(',')[1], 'base64'));
  console.log(`  ${name.padEnd(28)} ${pct.toFixed(2)}% of pixels  ${file}`);
}
console.log(`\nworst view: ${worst.toFixed(2)}%`);
await browser.close();
