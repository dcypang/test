// Photographs every vehicle in the fleet, side on and three-quarter, so the
// shapes can be compared against each other and against the real thing.
//   node scripts/fleet.mjs [tag]
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
  viewport: { width: 1000, height: 460 }, deviceScaleFactor: 1,
})).newPage();
page.on('pageerror', (e) => console.log('pageerror: ' + e.message));
await page.goto('file://' + join(root, 'index.html'));

const t0 = Date.now();
while (Date.now() - t0 < 600000) {
  if (await page.evaluate(() => window.__game && window.__game.state === 'menu')
    .catch(() => false)) break;
  await page.waitForTimeout(300);
}

const names = await page.evaluate(() => Object.keys(window.__vehicles || {}));
if (!names.length) {
  console.log('no fleet exposed; add window.__vehicles for this probe');
  await browser.close();
  process.exit(1);
}

await page.evaluate(() => {
  const g = window.__game;
  g.manualStep = true;
  g.startRace();
  g.raceState.countdown = 0;
  for (let i = 0; i < 30; i++) g.update(1 / 60);
});

for (const key of names) {
  const info = await page.evaluate((key) => {
    const g = window.__game;
    const spec = window.__vehicles[key];
    // Park the chosen shape where the player's car is and look along it.
    const kit = g.buildPlayerCarMeshes(key);
    g.player.meshes = kit;
    // Away from the grid: parked among seven other cars, the subject was always
    // behind one of them.
    const base = g.player.vehicle;
    base.pos[0] = 1200; base.pos[2] = 1200;
    base.pos[1] = g.scene.world.terrain(1200, 1200);
    base.yaw = 0;
    g.player.pos[0] = base.pos[0]; g.player.pos[1] = base.pos[1]; g.player.pos[2] = base.pos[2];
    const p = g.player.pos;
    const cam = g.camera;
    const old = cam.update.bind(cam);
    // Side elevation, level with the waistline. A three-quarter view from above
    // flattens a tall car into a low one and every shape looked the same.
    const eye = [p[0] + 11.0, p[1] + 1.05, p[2] + 0.1];
    cam.update = () => { cam.pos = eye.slice(); cam.target = [p[0], p[1] + 0.95, p[2]]; };
    for (let i = 0; i < 3; i++) { g.update(1 / 60); g.draw(1 / 60); }
    cam.update = old;
    return { label: spec.label, length: spec.length, width: spec.width,
      wheelbase: spec.wheelbase, mass: spec.mass, wheelR: spec.wheelR };
  }, key);
  await page.screenshot({ path: join(shots, `fleet-${tag}-${key}.png`), timeout: 180000 });
  console.log(`  ${key.padEnd(12)} ${info.label.padEnd(16)} `
    + `${info.length.toFixed(2)} x ${info.width.toFixed(2)} m  `
    + `wb ${info.wheelbase.toFixed(2)}  ${info.mass} kg  wheel r${info.wheelR}`);
}
await browser.close();
