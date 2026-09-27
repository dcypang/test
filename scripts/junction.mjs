// Photographs road junctions and a long straight, which is where the two
// rendering complaints show up.
//   node scripts/junction.mjs [tag]
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
});

// Park the camera by hand: the game's own camera follows the car, and the car
// is not where the junctions are.
const look = async (name, from, at) => {
  await page.evaluate(([from, at]) => {
    const g = window.__game;
    const cam = g.camera;
    g._freeCam = true;
    cam.pos = from.slice();
    cam.target = at.slice();
    const old = cam.update.bind(cam);
    cam.update = () => { cam.pos = from.slice(); cam.target = at.slice(); };
    for (let i = 0; i < 3; i++) { g.update(1 / 60); g.draw(1 / 60); }
    cam.update = old;
  }, [from, at]);
  await page.screenshot({ path: join(shots, `j-${tag}-${name}.png`), timeout: 180000 });
  console.log('  shot', name);
};

// A town crossroads, from just above the tarmac and from the air.
await look('cross-low', [804 - 26, 3.2, 759 - 26], [804, 0.2, 759]);
await look('cross-air', [804, 62, 759 + 30], [804, 0, 759]);
// Where the route home runs over the town streets.
await look('overlap', [520, 26, 700 + 40], [520, 0, 690]);
// A long straight: the distance where markings and tarmac start to fight.
await look('long', [500, 2.6, 1080], [500, 1.4, 300]);

await browser.close();
