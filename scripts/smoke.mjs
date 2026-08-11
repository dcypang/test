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
// A 1280x720 frame of a million triangles through SwiftShader can take the
// better part of a minute. That is a property of the test rig, not the game.
page.setDefaultTimeout(120000);

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

  // Steering direction. The world is left handed and lookAt is right handed,
  // so it is entirely possible for the whole image to come out mirrored and
  // still look plausible - the giveaway is that steering right swings the view
  // the wrong way. Project a fixed landmark and watch which way it slides.
  const steerDir = await page.evaluate(() => {
    const g = window.__game;
    const v = g.player.vehicle;
    const ndcX = (pt) => {
      g.camera.applyProjection(16 / 9);
      const m = g.camera.viewProj;
      const w = m[3] * pt[0] + m[7] * pt[1] + m[11] * pt[2] + m[15];
      return { x: (m[0] * pt[0] + m[4] * pt[1] + m[8] * pt[2] + m[12]) / w, w };
    };
    const drive = (steer, throttle) => {
      g.input.driving = () => ({ throttle, brake: 0, steer, handbrake: 0, shiftUp: false, shiftDown: false });
    };
    const restore = g.input.driving.bind(g.input);
    drive(0, 0.7);
    for (let i = 0; i < 120; i++) g.update(1 / 60);
    const mark = [v.pos[0] + Math.sin(v.yaw) * 40, v.pos[1] + 1.0, v.pos[2] + Math.cos(v.yaw) * 40];
    const before = ndcX(mark);
    drive(1, 0.4);
    for (let i = 0; i < 40; i++) g.update(1 / 60);
    const after = ndcX(mark);
    g.input.driving = restore;
    return { before: before.x, after: after.x, wOk: before.w > 0 && after.w > 0 };
  });
  const steerOk = steerDir.wOk && steerDir.after < steerDir.before - 0.2;
  console.log(`steering right turns right on screen: ${steerOk ? 'ok' : 'FAIL'} `
    + `(landmark ndc ${steerDir.before.toFixed(2)} -> ${steerDir.after.toFixed(2)}, must decrease)`);
  if (!steerOk) errors.push('steering is mirrored: turning right moves the view left');

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

  // Skip to the last leg and teleport to the driveway, to check the arrival
  // flow and the house without driving the whole 2.7 km.
  await page.evaluate(() => {
    const g = window.__game;
    while (g.legIndex < g.legs.length - 1) g.advanceLeg();
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
