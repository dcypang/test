// Proves the drive home can actually be completed: takes the race to the flag,
// follows the results screen through to the road, then drives the player's own
// car the whole route and checks it arrives on the driveway.
//   node scripts/drivehome.mjs
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const shots = join(root, 'shots');
mkdirSync(shots, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await (await browser.newContext({ viewport: { width: 900, height: 560 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('file://' + join(root, 'index.html'));

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push(pass);
  console.log(`${pass ? ' ok ' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

const t0 = Date.now();
while (Date.now() - t0 < 240000) {
  if (await page.evaluate(() => window.__game && window.__game.state === 'menu').catch(() => false)) break;
  await page.waitForTimeout(300);
}

// --- the race, taken to the flag ---------------------------------------------
await page.evaluate(() => {
  window.__game.settings.laps = 2;
  window.__game.renderer.settings.particles = false;
  window.__game.startRace();
  window.__game.raceState.countdown = 0.05;
});
const raced = await page.evaluate(() => {
  const g = window.__game;
  // Hand the player's car to a racing driver so the race can actually finish.
  // The AI makes deliberate random mistakes; seed them so the run repeats.
  let seed = 20240607;
  Math.random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const { RacingDriver } = window.__drivers;
  const auto = new RacingDriver(g.player, g.scene.racingLine, 0.85);
  // The driver has to run inside the input hook: applyPlayerInput overwrites
  // the vehicle every frame, so anything written before g.update is lost.
  const v = g.player.vehicle;
  g.input.driving = () => {
    auto.update(1 / 60, g.cars, g.scene.world);
    return { throttle: v.throttle, brake: v.brake, steer: v.steerInput,
             handbrake: v.handbrake, shiftUp: false, shiftDown: false };
  };
  let stuck = 0;
  for (let i = 0; i < 60 * 400 && g.state === 'race'; i++) {
    g.update(1 / 60);
    // Same recovery a player gets from the R key, so one spin does not end it.
    stuck = v.speed < 1.5 ? stuck + 1 / 60 : 0;
    if (stuck > 6) { g.resetPlayerToTrack(); stuck = 0; }
  }
  return { state: g.state, lap: g.player.lap, finished: g.player.finished };
});
check('the race reaches the flag', raced.state === 'results',
  `state=${raced.state} lap=${raced.lap}`);
check('the results screen is up', await page.evaluate(
  () => !document.getElementById('results').classList.contains('hidden')));
check('the results screen offers the drive home', await page.evaluate(() => {
  const b = document.getElementById('resultsDrive');
  return !!b && b.offsetParent !== null;
}));
await page.screenshot({ path: join(shots, 'h1-results.png') });

// --- the road home, taken by the button on the results screen ----------------
if (raced.state === 'results') await page.locator('#resultsDrive').click();
else await page.evaluate(() => window.__game.startDriveHome());
await page.evaluate(() => window.__game.update(1 / 60));
check('the drive home starts from the results screen',
  await page.evaluate(() => window.__game.state === 'drive'));

await page.evaluate(() => window.__game.update(1 / 60));
const startInfo = await page.evaluate(() => {
  const g = window.__game;
  return {
    kind: g.scene.kind,
    legs: g.legs.map((l) => Math.round(l.route.spline.length)),
    remaining: Math.round(g.driveState.remaining),
    onRoad: g.scene.world.sampleSurface(g.player.pos[0], g.player.pos[2]).onRoad,
  };
});
check('the drive home starts at the circuit, not in the town',
  startInfo.kind === 'circuit', `scene=${startInfo.kind}`);
check('the car starts on the road', startInfo.onRoad,
  `legs ${startInfo.legs.join(' + ')} m, ${startInfo.remaining} m to go`);
check('the satnav counts the whole journey from the pit lane',
  startInfo.remaining > 2200, `${startInfo.remaining} m`);
await page.screenshot({ path: join(shots, 'h2-road.png') });

// Drive the whole way with a traffic driver at the wheel of the player's car.
const home = await page.evaluate(() => {
  const g = window.__game;
  const first = g.legs[0].route.spline;
  const lane = first.normals[1];
  const offset = ((g.player.pos[0] - first.points[1][0]) * lane[0]
    + (g.player.pos[2] - first.points[1][2]) * lane[2]);
  const { TrafficDriver } = window.__drivers;
  const limitNow = () => (g.driveState && g.driveState.zone ? g.driveState.zone.limit : 60);
  let auto = new TrafficDriver(g.player, g.legs[0].route, 1, offset, limitNow());
  let onDrive = false;
  let legSeen = 0;
  const handover = [];
  const v = g.player.vehicle;
  g.input.driving = () => {
    // Follow whichever road the game puts us on: pit lane, paddock exit,
    // public road, and finally the driveway - the same chain a player drives.
    if (g.legIndex !== legSeen) {
      legSeen = g.legIndex;
      handover.push({ leg: g.legIndex, scene: g.scene.kind, kmh: Math.round(v.speedKmh) });
      auto = new TrafficDriver(g.player, g.legs[g.legIndex].route, 1,
        g.legs[g.legIndex].home ? 2.1 : 0, limitNow());
      auto.index = 0;
      auto.done = false;
    }
    if (!auto.done) {
      // Same obstacle list the game gives its own traffic, so this driver
      // queues at lights instead of rear-ending the back of the queue.
      auto.update(1 / 60, g.scene.world, g.traffic.map((t) => t.car), g.lightSystem.lights);
    }
    if (auto.done && !onDrive && g.legIndex === g.legs.length - 1) {
      onDrive = true;
      auto = new TrafficDriver(g.player, g.scene.driveway, 1, 0, 20);
      auto.index = 0;
    }
    if (!auto.done) auto.speedLimit = limitNow();
    if (auto.done) {
      const d = onDrive ? g.scene.destination : null;
      if (d) {
        // Park it the way a person would: creep at the garage door and stop.
        const dx = d.x - v.pos[0], dz = d.z - v.pos[2];
        const dist = Math.hypot(dx, dz);
        const bearing = Math.atan2(Math.sin(Math.atan2(dx, dz) - v.yaw),
          Math.cos(Math.atan2(dx, dz) - v.yaw));
        v.steerInput = Math.max(-1, Math.min(1, bearing * 2.0));
        const creep = dist > 1.4 && v.speed < 2.2;
        v.throttle = creep ? 0.16 : 0;
        v.brake = creep ? 0 : 1;
      } else {
        // The path driver gives up a few points short; keep rolling so the
        // game sees us cross the end of the leg.
        v.steerInput = 0;
        v.throttle = v.speed < 9 ? 0.35 : 0;
        v.brake = 0;
      }
    }
    return { throttle: v.throttle, brake: v.brake, steer: v.steerInput,
             handbrake: v.handbrake, shiftUp: false, shiftDown: false };
  };
  let minDist = Infinity, offRoad = 0, frames = 0;
  const navSeen = new Set();
  const offTrace = [];
  let stalled = 0;
  for (let i = 0; i < 60 * 900 && g.state === 'drive'; i++) {
    g.update(1 / 60);
    frames++;
    // The R key, in test form: never let one wedged car hang the whole run.
    stalled = (v.speed < 0.6 && !g.driveState.arrived) ? stalled + 1 / 60 : 0;
    if (stalled > 6) { g.resetPlayerToTrack(); stalled = 0; }
    minDist = Math.min(minDist, g.driveState.distHome === undefined ? Infinity : g.driveState.distHome);
    if (g.driveState.nav) navSeen.add(g.driveState.nav.instruction);
    if (!g.scene.world.sampleSurface(g.player.pos[0], g.player.pos[2]).onRoad) {
      offRoad++;
      if (offTrace.length < 6 && offRoad % 120 === 1) {
        const hit = g.scene.world.query(g.player.pos[0], g.player.pos[2]);
        offTrace.push({ leg: g.legIndex, remaining: Math.round(g.driveState.remaining),
          lat: hit ? +hit.lateral.toFixed(1) : null, kmh: Math.round(v.speedKmh),
          zone: g.driveState.zone && g.driveState.zone.label });
      }
    }
    if (g.driveState.arrived && g.state !== 'drive') break;
  }
  return {
    state: g.state,
    arrived: g.driveState.arrived,
    minDist: +minDist.toFixed(1),
    radius: g.scene.destination.radius,
    remaining: Math.round(g.driveState.remaining),
    rating: Math.round(g.driveState.rating),
    km: +(g.player.vehicle.odometer / 1000).toFixed(2),
    offRoadPct: +(100 * offRoad / frames).toFixed(1),
    minutes: +(g.driveState.elapsed / 60).toFixed(1),
    nav: Array.from(navSeen),
    handover, offTrace,
  };
});
console.log('   ', JSON.stringify(home));
check('the route leads all the way home', home.minDist < home.radius,
  `closest approach ${home.minDist} m, driveway radius ${home.radius} m`);
check('arrival triggers on the driveway', home.arrived);
check('the game reaches the arrived state', home.state === 'arrived', `state=${home.state}`);
check('the arrival summary is up', await page.evaluate(
  () => !document.getElementById('arrived').classList.contains('hidden')));
check('the car stayed on the road', home.offRoadPct < 15, `${home.offRoadPct}% off road`);
check('the satnav calls the turn into the driveway',
  home.nav.some((n) => n.includes('driveway')), home.nav.join(' | '));
check('the satnav counts the driveway, not just the road',
  home.nav.some((n) => n.includes('drive to the garage')));
check('the road leaves the circuit and reaches the town',
  home.handover.length === 2 && home.handover[1].scene === 'home',
  JSON.stringify(home.handover));
check('the car keeps its momentum through the gate',
  home.handover.length === 2 && home.handover[1].kmh > 25,
  `${home.handover.length === 2 ? home.handover[1].kmh : '?'} km/h crossing into the town`);
await page.screenshot({ path: join(shots, 'h3-arrived.png') });

// --- the shop, and hitting things -------------------------------------------
// Both are checked on a fresh drive: the run above parks the car for good.
const extras = await page.evaluate(() => {
  const g = window.__game;
  g.startDriveHome();
  while (g.legIndex < g.legs.length - 1) g.advanceLeg();
  g.update(1 / 60);
  const out = {};

  // Park in the shop layby and wait.
  const shop = g.scene.shopStop;
  const v = g.player.vehicle;
  g.input.driving = () => ({ throttle: 0, brake: 1, steer: 0, handbrake: 1, shiftUp: false, shiftDown: false });
  g.player.setPose(shop.x, shop.z, 0, g.scene.world);
  for (let i = 0; i < 60 * 4; i++) g.update(1 / 60);
  out.shopped = g.driveState.shopped;
  out.shopPromptSeen = !!g.driveState.shopNear || g.driveState.shopped;

  // Drive at something solid and see whether the world pushes back. It has to
  // be a roadside object: the road containment will not let the car wander far
  // enough off to reach a tree in a field.
  const sp = g.scene.route.spline;
  const world = g.scene.world;
  let target = null, at = 0;
  for (let i = 40; i < sp.count - 40 && !target; i++) {
    const p = sp.points[i], n = sp.normals[i];
    for (const s2 of world.solids) {
      const dx = s2.x - p[0], dz = s2.z - p[2];
      const lat = dx * n[0] + dz * n[2];
      const along = Math.hypot(dx, dz);
      if (s2.hard === 1 && along < 9 && Math.abs(lat) > 4.8 && Math.abs(lat) < 8.5) {
        target = s2; at = i; break;
      }
    }
  }
  if (!target) return Object.assign(out, { hitTested: false });

  const t0 = sp.tangents[at];
  // Point straight at it from 13 m out, already rolling, and see what happens.
  const dirX = target.x - (target.x - t0[0]), dirZ = target.z - (target.z - t0[2]);
  const len = Math.hypot(dirX, dirZ) || 1;
  const ux = dirX / len, uz = dirZ / len;
  g.player.setPose(target.x - ux * 13, target.z - uz * 13, Math.atan2(ux, uz), world);
  const v2 = g.player.vehicle;
  v2.vel[0] = ux * 17; v2.vel[2] = uz * 17;      // about 60 km/h
  v2.gear = 3;
  g.renderer.settings.particles = true;
  g.renderer.particles.length = 0;
  const before = { damage: g.player.damage };
  let peak = 0;
  g.input.driving = () => ({ throttle: 1, brake: 0, steer: 0, handbrake: 0, shiftUp: false, shiftDown: false });
  let minGap = Infinity;
  for (let i = 0; i < 60 * 3; i++) {
    g.update(1 / 60);
    peak = Math.max(peak, g.renderer.particles.length);
    minGap = Math.min(minGap, Math.hypot(g.player.pos[0] - target.x, g.player.pos[2] - target.z));
  }
  return Object.assign(out, {
    hitTested: true,
    obstacleRadius: +target.r.toFixed(2),
    minGap: +minGap.toFixed(2),
    blockedAt: +(target.r + 0.98).toFixed(2),
    damageGained: +(g.player.damage - before.damage).toFixed(3),
    peakParticles: peak,
    solidCount: world.solids.length,
  });
});
console.log('   ', JSON.stringify(extras));
check('stopping in the layby counts as visiting the shop', extras.shopped);
// The shell never overlaps the collider: the car is stopped at exactly the sum
// of the two radii, which is what "solid" means here.
check('scenery is solid', extras.hitTested && extras.minGap >= extras.blockedAt - 0.15,
  `held off at ${extras.minGap} m, shell + obstacle = ${extras.blockedAt} m, `
  + `${extras.solidCount} colliders`);
check('hitting something does damage', extras.damageGained > 0.02,
  `+${extras.damageGained}`);
check('hitting something throws sparks and debris', extras.peakParticles > 5,
  `${extras.peakParticles} particles`);

console.log('\n--- console errors ---');
console.log(errors.length ? errors.slice(0, 5).join('\n') : '(none)');
const failed = checks.filter((c) => !c).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
await browser.close();
process.exit(failed || errors.length ? 1 : 0);
