// Fast single screenshot of the player's car, for checking the model and the
// paint shader without running the whole smoke test.
//   node scripts/carshot.mjs out.png
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = process.argv[2] || join(root, 'shots', 'car.png');

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 620 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto('file://' + join(root, 'index.html'));
const start = Date.now();
while (Date.now() - start < 240000) {
  if (await page.evaluate(() => !!(window.__game && window.__game.state === 'menu')).catch(() => false)) break;
  await page.waitForTimeout(300);
}

await page.evaluate(() => {
  const g = window.__game;
  g.renderer.settings.shadows = false;
  g.renderer.settings.particles = false;
  g.startRace();
});
await page.waitForTimeout(400);

// Park a close three-quarter camera on the player's car and hold it there.
await page.evaluate(() => {
  const g = window.__game;
  g.raceState.countdown = 999;          // stay on the grid
  const c = g.player;
  g.updateMenu = function () {};
  const orbit = () => {
    const a = 2.3;
    const r = 6.2;
    g.camera.pos[0] = c.pos[0] + Math.sin(a) * r;
    g.camera.pos[1] = c.pos[1] + 1.5;
    g.camera.pos[2] = c.pos[2] + Math.cos(a) * r;
    g.camera.target[0] = c.pos[0];
    g.camera.target[1] = c.pos[1] + 0.55;
    g.camera.target[2] = c.pos[2];
    g.camera.fov = 40 * Math.PI / 180;
    g.camera.speedBlur = 0;
  };
  g.camera.update = orbit;
  orbit();
});
await page.waitForTimeout(2500);
await page.screenshot({ path: out });
console.log('wrote', out, errors.length ? 'ERRORS: ' + errors.slice(0, 5).join(' | ') : '(no errors)');
await browser.close();
