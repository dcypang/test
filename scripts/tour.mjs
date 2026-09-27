// Stands in several states and photographs what you would see from the car.
//   node scripts/tour.mjs [tag]
//
// This is the only real test of "does a state look like that place": the map
// shows the outlines, but from the driver's seat you never see one. What you
// see is the ground, what grows on it, how hilly it is and what the town is
// built of.
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
  viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1,
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

// One state per kind of country, so every biome gets looked at.
const TOUR = ['AZ', 'CO', 'ME', 'FL', 'KS', 'VT', 'AK', 'HI', 'NM', 'LA'];

const seen = [];
for (const abbr of TOUR) {
  const info = await page.evaluate((abbr) => {
    const g = window.__game;
    const st = g.scene.states.find((s) => s.abbr === abbr);
    if (!st) return null;
    // Put the car in the state first. The shadow cascades and the chunk cull
    // are centred on the player, not on the camera, so photographing a state
    // from eight kilometres away renders its ground outside every cascade and
    // it comes back black - a fault in the rig, not in the game.
    const ground = g.scene.world.terrain(st.cx, st.cz);
    g.player.pos[0] = st.cx; g.player.pos[1] = ground; g.player.pos[2] = st.cz;
    g.player.vehicle.pos[0] = st.cx;
    g.player.vehicle.pos[1] = ground;
    g.player.vehicle.pos[2] = st.cz;

    // Stand at the town, looking across the state from about head height.
    const eye = [st.cx - 150, 0, st.cz - 140];
    eye[1] = g.scene.world.terrain(eye[0], eye[2]) + 7;
    const at = [st.cx, g.scene.world.terrain(st.cx, st.cz) + 3, st.cz];
    const cam = g.camera;
    const old = cam.update.bind(cam);
    cam.update = () => { cam.pos = eye.slice(); cam.target = at.slice(); };
    for (let i = 0; i < 4; i++) { g.update(1 / 60); g.draw(1 / 60); }
    cam.update = old;
    // The ground's own numbers, so the picture has something to be checked
    // against rather than being judged by eye alone.
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < 12; i++) {
      for (let j = 0; j < 12; j++) {
        const h = g.scene.world.terrain(
          st.x0 + (i / 11) * (st.x1 - st.x0), st.z0 + (j / 11) * (st.z1 - st.z0));
        if (h < lo) lo = h; if (h > hi) hi = h;
      }
    }
    // What colour the ground actually comes out, which is the only way to tell
    // whether two states look different or just have different numbers behind
    // them. Sampled low in the frame, where it is ground and not sky.
    const gc = g.renderer.gl.canvas;
    const c = document.createElement('canvas');
    c.width = gc.width; c.height = gc.height;
    const cx = c.getContext('2d');
    cx.drawImage(gc, 0, 0);
    const band = cx.getImageData(0, Math.round(c.height * 0.80), c.width,
      Math.round(c.height * 0.12)).data;
    let r = 0, gg = 0, b = 0, n = 0;
    for (let i = 0; i < band.length; i += 4) { r += band[i]; gg += band[i + 1]; b += band[i + 2]; n++; }
    return { name: st.name, biome: st.biome, relief: +(hi - lo).toFixed(1),
      town: st.town ? `${st.town.cols}x${st.town.rows}` : 'none',
      ground: [Math.round(r / n), Math.round(gg / n), Math.round(b / n)] };
  }, abbr);
  if (!info) { console.log(`  ${abbr}: not found`); continue; }
  await page.screenshot({ path: join(shots, `tour-${tag}-${abbr}.png`), timeout: 180000 });
  console.log(`  ${abbr}  ${info.name.padEnd(18)} ${info.biome.padEnd(10)} `
    + `relief ${String(info.relief).padStart(5)} m   ground rgb(${info.ground.join(',')})`);
  seen.push({ abbr, ground: info.ground });
}

// How far apart are the states, as colours? If two states render the same
// ground there is no point in them having different numbers behind them.
let worst = 1e9, pair = null;
for (let i = 0; i < seen.length; i++) {
  for (let j = i + 1; j < seen.length; j++) {
    const d = Math.abs(seen[i].ground[0] - seen[j].ground[0])
      + Math.abs(seen[i].ground[1] - seen[j].ground[1])
      + Math.abs(seen[i].ground[2] - seen[j].ground[2]);
    if (d < worst) { worst = d; pair = [seen[i].abbr, seen[j].abbr]; }
  }
}
console.log(`\nclosest pair: ${pair.join(' and ')}, ${worst}/765 apart in ground colour`);
await browser.close();
