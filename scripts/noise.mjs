// Measures how much the picture boils when nothing is moving.
//   node scripts/noise.mjs [tag]
//
// A still scene should render the same way twice. Anything that changes between
// two frames of a frozen world is noise the player sees as crawling or
// glitching, and it is invisible in a single screenshot.
//
// Grain is the usual source, and where it is applied decides who suffers: added
// in linear light before the gamma encode, a fixed amplitude is nothing against
// a bright sky and enormous against a dark surface, so car interiors, tyres and
// shadows crawl while the sky it was meant to smooth stays clean. This reports
// the noise separately for the dark, middle and bright parts of the frame, so
// that asymmetry shows up as a number rather than as a complaint.
import { launch } from './browser.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const tag = process.argv[2] || 'now';
const root = dirname(dirname(fileURLToPath(import.meta.url)));

const browser = await launch();
const page = await (await browser.newContext({
  viewport: { width: 1000, height: 620 }, deviceScaleFactor: 1,
})).newPage();
page.on('pageerror', (e) => console.log('pageerror: ' + e.message));
await page.goto('file://' + join(root, 'index.html'));

const t0 = Date.now();
while (Date.now() - t0 < 600000) {
  if (await page.evaluate(() => window.__game && window.__game.state === 'menu')
    .catch(() => false)) break;
  await page.waitForTimeout(300);
}

const measure = (mode) => page.evaluate((mode) => {
  const g = window.__game;
  g.manualStep = true;
  if (mode === 'cockpit') {
    g.startRace();
    g.raceState.countdown = 0;
    for (let i = 0; i < 60; i++) g.update(1 / 60);
    g.camera.mode = 3;
  } else {
    g.startDriveHome();
    while (g.legIndex < g.legs.length - 1) g.advanceLeg();
    for (let i = 0; i < 40; i++) g.update(1 / 60);
    g.camera.mode = 0;
  }
  for (let i = 0; i < 30; i++) { g.update(1 / 60); g.draw(1 / 60); }

  const grab = () => {
    // Draw twice with the world frozen: only time-varying effects can differ.
    g.draw(1 / 60);
    const gc = g.renderer.gl.canvas, c = document.createElement('canvas');
    c.width = gc.width; c.height = gc.height;
    const cx = c.getContext('2d');
    cx.drawImage(gc, 0, 0);
    return cx.getImageData(0, 0, c.width, c.height).data;
  };
  const a = grab(), b = grab();
  const bucket = [{ n: 0, s: 0 }, { n: 0, s: 0 }, { n: 0, s: 0 }];
  for (let i = 0; i < a.length; i += 4) {
    const lum = (a[i] * 0.3 + a[i + 1] * 0.6 + a[i + 2] * 0.1);
    const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1])
      + Math.abs(a[i + 2] - b[i + 2]);
    const k = lum < 60 ? 0 : lum < 170 ? 1 : 2;
    bucket[k].n++; bucket[k].s += d / 3;
  }
  return bucket.map((x) => +(x.n ? x.s / x.n : 0).toFixed(2));
}, mode);

console.log(`frame-to-frame noise (${tag}), average change per pixel out of 255`);
console.log('view      dark    mid     bright');
let worst = 0;
for (const mode of ['cockpit', 'country']) {
  const [d, m, b] = await measure(mode);
  worst = Math.max(worst, d, m, b);
  console.log(`  ${mode.padEnd(8)} ${String(d).padStart(5)}  ${String(m).padStart(5)}  ${String(b).padStart(5)}`);
}
console.log(`\nworst: ${worst.toFixed(2)}/255`);
console.log(worst > 1.2 ? 'FAIL  the picture boils when nothing is moving'
  : ' ok   a still scene renders still');
await browser.close();
process.exit(worst > 1.2 ? 1 : 0);
