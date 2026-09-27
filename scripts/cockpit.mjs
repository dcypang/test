// The near plane is the cheapest depth precision there is, but it clips.
// This photographs every camera view so anything cut off is obvious, and
// measures how close the nearest drawn thing actually gets.
//   node scripts/cockpit.mjs [tag]
import { launch } from './browser.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

const tag = process.argv[2] || 'now';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const shots = join(root, 'shots');
mkdirSync(shots, { recursive: true });

const browser = await launch();
const page = await (await browser.newContext({
  viewport: { width: 1100, height: 660 }, deviceScaleFactor: 1,
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
  for (let i = 0; i < 60; i++) g.update(1 / 60);
});

const near = await page.evaluate(() => window.__game.camera.nearPlane);
console.log(`near plane ${near} m`);

for (let mode = 0; mode < 5; mode++) {
  const info = await page.evaluate((mode) => {
    const g = window.__game;
    g.camera.mode = mode;
    // The camera eases between views, so a few frames after switching it is
    // still in flight and every measurement taken then is of nowhere.
    for (let i = 0; i < 90; i++) { g.update(1 / 60); g.draw(1 / 60); }
    // How close the car's own bodywork gets to the eye, which is what the near
    // plane would cut into first.
    const c = g.player;
    const eye = g.camera.pos;
    let closest = Infinity;
    const f = g.camera.forward;
    for (const p of [[0, 0.4, 2.4], [0, 0.9, 1.2], [0.8, 0.5, 0.4], [-0.8, 0.5, 0.4],
      [0, 1.15, 0.1], [0, 0.35, -2.3], [0, 0.75, 0.55]]) {
      const w = c.localToWorld(p);
      const dx = w[0] - eye[0], dy = w[1] - eye[1], dz = w[2] - eye[2];
      // Only what is in front of the camera can be clipped by the near plane.
      if (dx * f[0] + dy * f[1] + dz * f[2] <= 0) continue;
      closest = Math.min(closest, Math.hypot(dx, dy, dz));
    }
    return { mode, closest: +closest.toFixed(2), inside: !!g.camera.inside, name: g.camera.modeName || '' };
  }, mode);
  await page.screenshot({ path: join(shots, `cam-${tag}-${mode}.png`), timeout: 180000 });
  const flag = info.closest < near ? '  <-- INSIDE THE NEAR PLANE' : '';
  console.log(`  view ${mode}${info.inside ? ' (cockpit)' : ''}: `
    + `nearest bodywork ${info.closest} m${flag}`);
}
await browser.close();
