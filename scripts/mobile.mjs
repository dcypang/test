// Emulates a phone and checks the touch controls actually drive the car.
//   node scripts/mobile.mjs
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
const ctx = await browser.newContext({
  viewport: { width: 760, height: 380 },   // a phone held sideways
  deviceScaleFactor: 1,
  hasTouch: true,
  isMobile: true,
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto('file://' + join(root, 'index.html'));

const waitFor = async (fn, ms, label) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await page.evaluate(fn).catch(() => false)) return true;
    await page.waitForTimeout(300);
  }
  console.log('  ! timed out waiting for ' + label);
  return false;
};

// Advance the game a fixed amount of simulated time, independent of how slowly
// software rendering happens to be painting.
const pump = (seconds) => page.evaluate((secs) => {
  const steps = Math.round(secs * 60);
  for (let i = 0; i < steps; i++) window.__game.update(1 / 60);
}, seconds);

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push(pass);
  console.log(`${pass ? ' ok ' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

await waitFor(() => window.__game && window.__game.state === 'menu', 240000, 'menu');
check('detected as a touch device', await page.evaluate(() => window.__game.isTouch));
check('auto-selected the light render preset',
  await page.evaluate(() => window.__game.settings.quality === 'fast'
    && window.__game.renderer.settings.shadows === false));

await page.screenshot({ path: join(shots, 'm1-menu.png') });

// --- race with touch --------------------------------------------------------
await page.evaluate(() => { window.__game.startRace(); });
// The overlay is shown from inside the game loop, so step the loop rather than
// waiting on wall-clock time - software rendering paints about once a second.
await pump(0.2);
check('touch overlay is showing', await page.evaluate(
  () => !document.getElementById('touchControls').classList.contains('hidden')));
check('HUD switched to the compact layout', await page.evaluate(() => window.__game.hud.compact));
await page.evaluate(() => { window.__game.raceState.countdown = 0.1; });
await page.waitForTimeout(700);
await page.screenshot({ path: join(shots, 'm2-race.png') });

// Hold the GO pedal.
const gas = await page.locator('.touch-pedal.gas').boundingBox();
await page.mouse.move(gas.x + gas.width / 2, gas.y + gas.height / 2);
const odoBefore = await page.evaluate(() => window.__game.player.vehicle.odometer);
await page.mouse.down();
await pump(3);
const onGas = await page.evaluate((o) => ({
  throttle: window.__game.player.vehicle.throttle,
  moved: window.__game.player.vehicle.odometer - o,
  kmh: Math.round(window.__game.player.vehicle.speedKmh),
}), odoBefore);
check('GO pedal opens the throttle', onGas.throttle > 0.9, `throttle=${onGas.throttle.toFixed(2)}`);
check('car accelerates under touch control', onGas.kmh > 40,
  `${onGas.kmh} km/h after 3 s`);

// Steer while still on the gas.
const pad = await page.locator('.touch-steer').boundingBox();
const px = pad.x + pad.width / 2, py = pad.y + pad.height - 40;
await page.mouse.up();
await page.mouse.move(px, py);
await page.mouse.down();
await page.mouse.move(px + 80, py, { steps: 6 });
await pump(0.4);
const steerRight = await page.evaluate(() => window.__game.player.vehicle.steerInput);
await page.mouse.move(px - 80, py, { steps: 6 });
await pump(0.4);
const steerLeft = await page.evaluate(() => window.__game.player.vehicle.steerInput);
await page.mouse.up();
await pump(0.3);
const steerRest = await page.evaluate(() => window.__game.touch.state.steer);
check('stick steers right', steerRight > 0.5, `steer=${steerRight.toFixed(2)}`);
check('stick steers left', steerLeft < -0.5, `steer=${steerLeft.toFixed(2)}`);
check('steering recentres on release', Math.abs(steerRest) < 0.01);

// The stick is a circle, so a thumb that wanders off the horizontal must still
// steer by its sideways component alone.
await page.mouse.move(px, py);
await page.mouse.down();
await page.mouse.move(px + 70, py - 70, { steps: 6 });
await pump(0.2);
const diagonal = await page.evaluate(() => window.__game.touch.state.steer);
await page.mouse.up();
await pump(0.2);
check('diagonal push still steers by its sideways part', diagonal > 0.5 && diagonal <= 1.0,
  `steer=${diagonal.toFixed(2)}`);

// Inverting the stick must flip the sign and nothing else.
await page.evaluate(() => { window.__game.touch.invertSteer = true; });
await page.mouse.move(px, py);
await page.mouse.down();
await page.mouse.move(px + 80, py, { steps: 6 });
await pump(0.2);
const inverted = await page.evaluate(() => window.__game.touch.state.steer);
await page.mouse.up();
await page.evaluate(() => { window.__game.touch.invertSteer = false; });
await pump(0.2);
check('inverted stick reverses the direction', inverted < -0.5, `steer=${inverted.toFixed(2)}`);
await page.screenshot({ path: join(shots, 'm3-driving.png') });

// Brake pedal.
const brake = await page.locator('.touch-pedal.brake').boundingBox();
await page.mouse.move(brake.x + brake.width / 2, brake.y + brake.height / 2);
await page.mouse.down();
await page.waitForTimeout(500);
// Assert the input path, not the vehicle: holding the brake at a standstill
// legitimately selects reverse, which zeroes vehicle.brake.
check('BRAKE pedal feeds the brake input', await page.evaluate(() => {
  const out = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
  window.__game.touch.driving(out);
  return out.brake > 0.9;
}));
await page.mouse.up();

// Camera button.
const before = await page.evaluate(() => window.__game.camera.mode);
await page.locator('.touch-btn[data-tap="camera"]').dispatchEvent('pointerdown');
await pump(0.1);
check('camera button cycles the view',
  await page.evaluate((b) => window.__game.camera.mode !== b, before));

// --- drive home extras ------------------------------------------------------
await page.evaluate(() => { window.__game.startDriveHome(); });
await pump(0.2);
check('road buttons appear for the drive home', await page.evaluate(
  () => !document.querySelector('.touch-road').classList.contains('hidden')));
await page.locator('.touch-btn[data-tap="indicateRight"]').dispatchEvent('pointerdown');
await pump(0.1);
check('indicator button works', await page.evaluate(() => window.__game.player.indicator === 1));

// The GPS, by touch: the map button opens it, tapping a pin sets the
// destination, and the driving controls get out of the way while it is up.
// Run it on the town leg, which is the one with somewhere to go.
await page.evaluate(() => {
  const g = window.__game;
  while (g.legIndex < g.legs.length - 1) g.advanceLeg();
});
await pump(0.2);
await page.locator('.touch-btn[data-tap="map"]').dispatchEvent('pointerdown');
await pump(0.3);
check('map button opens the GPS', await page.evaluate(() => window.__game.mapOpen));
check('driving controls hide behind the map, map button stays', await page.evaluate(() => {
  const vis = (sel) => {
    const el = document.querySelector(sel);
    return !!el && el.getClientRects().length > 0;
  };
  return !vis('.touch-steer') && !vis('.touch-pedals')
    && vis('.touch-btn[data-tap="map"]');
}));
check('the stick cannot drive the car from behind the map', await page.evaluate(() => {
  const out = { throttle: 1, brake: 0, steer: 0, handbrake: 0 };
  window.__game.touch.driving(out);
  return out.steer === 0;
}));
await page.screenshot({ path: join(shots, 'm7-gps.png') });

const picked = await page.evaluate(() => {
  const g = window.__game;
  // Tap the pin the map itself drew, using the screen position it recorded.
  const target = (g.scene.places || []).find((p) => p.kind === 'fuel');
  if (!target || target._sx === undefined) return null;
  const r = g.hud.canvas.getBoundingClientRect();
  const sx = r.left + (target._sx / g.hud.width) * r.width;
  const sy = r.top + (target._sy / g.hud.height) * r.height;
  g.hud.canvas.dispatchEvent(new PointerEvent('pointerdown', {
    clientX: sx, clientY: sy, bubbles: true,
  }));
  return { want: target.name, got: g.chosenPlace && g.chosenPlace.name };
});
check('tapping a pin sets the destination',
  picked && picked.got === picked.want, picked ? `${picked.got}` : 'no pin drawn');
await pump(0.2);
check('picking a destination puts you back behind the wheel', await page.evaluate(
  () => !window.__game.mapOpen && !document.querySelector('.touch').classList.contains('map-open')));

// And the button toggles it, so the map is not a one-way trip.
await page.locator('.touch-btn[data-tap="map"]').dispatchEvent('pointerdown');
await pump(0.2);
await page.locator('.touch-btn[data-tap="map"]').dispatchEvent('pointerdown');
await pump(0.2);
check('map button closes the GPS again', await page.evaluate(() => !window.__game.mapOpen));
await page.screenshot({ path: join(shots, 'm4-drive.png') });

// --- portrait ---------------------------------------------------------------
await page.setViewportSize({ width: 380, height: 760 });
await page.waitForTimeout(700);
check('portrait shows the rotate prompt',
  await page.evaluate(() => getComputedStyle(document.getElementById('rotate')).display !== 'none'));
check('driving input is held while portrait',
  await page.evaluate(() => window.__game.orientationBlocked === true));
await page.screenshot({ path: join(shots, 'm5-portrait.png') });
// The prompt must not be a dead end: an embedded frame can be portrait-shaped
// however the phone is held.
await page.locator('#rotateAnyway').click();
await page.waitForTimeout(300);
check('portrait prompt can be dismissed', await page.evaluate(
  () => getComputedStyle(document.getElementById('rotate')).display === 'none'
    && window.__game.orientationBlocked === false));
await page.evaluate(() => { window.__game.ignorePortrait = false; });
await page.setViewportSize({ width: 760, height: 380 });
await page.waitForTimeout(700);
check('landscape clears the prompt',
  await page.evaluate(() => getComputedStyle(document.getElementById('rotate')).display === 'none'
    && window.__game.orientationBlocked === false));

console.log('\n--- console errors ---');
console.log(errors.length ? errors.slice(0, 5).join('\n') : '(none)');
const failed = checks.filter((c) => !c).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
await browser.close();
process.exit(failed || errors.length ? 1 : 0);
