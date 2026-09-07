// Grabs the GPS map on its own, which is the one screen where every state's
// shape is visible at once.
//   node scripts/mapshot.mjs
import { launch } from './browser.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const shots = join(root, 'shots');
mkdirSync(shots, { recursive: true });

const browser = await launch();
const page = await (await browser.newContext({
  viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1,
})).newPage();
page.on('pageerror', (e) => console.log('pageerror: ' + e.message));
await page.goto('file://' + join(root, 'index.html'));

const t0 = Date.now();
while (Date.now() - t0 < 600000) {
  if (await page.evaluate(() => window.__game && window.__game.state === 'menu')
    .catch(() => false)) break;
  await page.waitForTimeout(300);
}

const info = await page.evaluate(() => {
  const g = window.__game;
  g.manualStep = true;
  g.startRace();
  g.raceState.countdown = 0;
  g.startDriveHome();
  while (g.legIndex < g.legs.length - 1) g.advanceLeg();
  g.update(1 / 60);
  g.setMapMode ? g.setMapMode(true) : (g.mapOpen = true);
  g.mapOpen = true;
  for (let i = 0; i < 4; i++) { g.update(1 / 60); g.draw(1 / 60); }
  return {
    states: g.scene.states.length,
    rings: g.scene.states.reduce((s, st) => s + st.polys.length, 0),
    vertices: g.scene.states.reduce((s, st) =>
      s + st.polys.reduce((t, r) => t + r.length, 0), 0),
    towns: g.scene.states.filter((s) => s.town).length,
  };
});
console.log(JSON.stringify(info));
await page.screenshot({ path: join(shots, 'map-states.png'), timeout: 180000 });
await browser.close();
