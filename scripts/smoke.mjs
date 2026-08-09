// Headless smoke test: loads the game in Chromium, drives it through the race
// and the drive home, and reports console errors plus screenshots.
//   node scripts/smoke.mjs [--shots dir]
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const shotDir = process.argv.includes('--shots')
  ? process.argv[process.argv.indexOf('--shots') + 1]
  : join(root, 'shots');
mkdirSync(shotDir, { recursive: true });

const errors = [];
const logs = [];

const browser = await chromium.launch({
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--enable-webgl',
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });

page.on('console', (msg) => {
  const t = `${msg.type()}: ${msg.text()}`;
  logs.push(t);
  if (msg.type() === 'error') errors.push(t);
});
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}\n${err.stack}`));

await page.goto('file://' + join(root, 'index.html'));

async function waitFor(fn, timeout, label) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await page.evaluate(fn).catch(() => false)) return true;
    await page.waitForTimeout(250);
  }
  console.log(`  ! timed out waiting for ${label}`);
  return false;
}

console.log('waiting for boot...');
const booted = await waitFor(() => window.__game && window.__game.state === 'menu', 180000, 'menu');
console.log('booted:', booted);
if (booted) {
  await page.evaluate(() => {
    // Low settings so SwiftShader can keep up.
    window.__game.settings.quality = 'fast';
    window.__game.renderer.settings.shadows = false;
    window.__game.renderer.settings.particles = false;
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(shotDir, '01-menu.png') });

  console.log('starting race...');
  await page.evaluate(() => window.__game.startRace());
  await page.waitForTimeout(2000);
  await page.screenshot({ path: join(shotDir, '02-grid.png') });

  // Skip the countdown and drive.
  await page.evaluate(() => { window.__game.raceState.countdown = 0.2; });
  await page.waitForTimeout(1000);
  await page.keyboard.down('w');
  await page.waitForTimeout(6000);
  await page.screenshot({ path: join(shotDir, '03-racing.png') });
  await page.keyboard.down('d');
  await page.waitForTimeout(1500);
  await page.keyboard.up('d');
  await page.waitForTimeout(2500);
  await page.keyboard.up('w');
  await page.screenshot({ path: join(shotDir, '04-racing2.png') });

  const telemetry = await page.evaluate(() => {
    const g = window.__game;
    const v = g.player.vehicle;
    return {
      state: g.state,
      speedKmh: Math.round(v.speedKmh),
      rpm: Math.round(v.rpm),
      gear: v.gearLabel,
      pos: v.pos.map((n) => Math.round(n)),
      lap: g.player.lap,
      position: g.player.position,
      onRoad: g.scene.world.sampleSurface(v.pos[0], v.pos[2]).onRoad,
      aiSpeeds: g.drivers.map((d) => Math.round(d.car.vehicle.speed * 3.6)),
    };
  });
  console.log('race telemetry:', JSON.stringify(telemetry));

  // Cockpit view.
  await page.evaluate(() => { window.__game.camera.mode = 3; });
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(shotDir, '05-cockpit.png') });
  await page.evaluate(() => { window.__game.camera.mode = 0; });

  console.log('drive home...');
  await page.evaluate(() => window.__game.startDriveHome());
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(shotDir, '06-home-start.png') });
  await page.keyboard.down('w');
  await page.waitForTimeout(8000);
  await page.keyboard.up('w');
  await page.screenshot({ path: join(shotDir, '07-driving.png') });

  const driveTel = await page.evaluate(() => {
    const g = window.__game;
    const v = g.player.vehicle;
    return {
      state: g.state,
      speedKmh: Math.round(v.speedKmh),
      rating: Math.round(g.driveState.rating),
      remaining: Math.round(g.driveState.remaining),
      instruction: g.driveState.nav && g.driveState.nav.instruction,
      zone: g.driveState.zone && g.driveState.zone.label,
      traffic: g.traffic.length,
      onRoad: g.scene.world.sampleSurface(v.pos[0], v.pos[2]).onRoad,
    };
  });
  console.log('drive telemetry:', JSON.stringify(driveTel));

  // Teleport to the driveway to check the arrival flow and the house.
  await page.evaluate(() => {
    const g = window.__game;
    const d = g.scene.destination;
    g.player.setPose(d.x, d.z - 14, d.yaw, g.scene.world);
    g.driveState.hint = g.scene.route.spline.count - 3;
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(shotDir, '08-home.png') });
  await page.keyboard.down('w');
  await page.waitForTimeout(1400);
  await page.keyboard.up('w');
  await page.waitForTimeout(4500);
  await page.screenshot({ path: join(shotDir, '09-arrived.png') });
  const arrived = await page.evaluate(() => window.__game.state);
  console.log('final state:', arrived);

  const fps = await page.evaluate(() => new Promise((resolve) => {
    let frames = 0;
    const t0 = performance.now();
    const tick = () => {
      frames++;
      if (performance.now() - t0 > 2000) resolve(Math.round(frames / ((performance.now() - t0) / 1000)));
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
  console.log('fps (swiftshader, software):', fps);
}

console.log('\n--- console errors ---');
if (errors.length === 0) console.log('(none)');
for (const e of errors.slice(0, 30)) console.log(e);

const warnings = logs.filter((l) => l.includes('warning') || l.includes('WARNING'));
if (warnings.length) {
  console.log('\n--- warnings ---');
  for (const w of warnings.slice(0, 10)) console.log(w);
}

await browser.close();
process.exit(errors.length ? 1 : 0);
