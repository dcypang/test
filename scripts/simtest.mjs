// Headless physics / AI harness. Loads the game's simulation modules into a
// Node context with a stub WebGL object, then runs fixed-timestep experiments:
// acceleration, braking, cornering, and a full AI race distance.
//   node scripts/simtest.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, 'src');

const FILES = ['math.js', 'gl.js', 'mesh.js', 'physics.js', 'car_model.js',
  'world.js', 'props.js', 'scenes.js', 'ai.js'];

// A WebGL stub: geometry still gets built on the CPU, uploads become no-ops.
const glStub = new Proxy({}, {
  get(target, prop) {
    if (prop === Symbol.toPrimitive) return () => 'glstub';
    return (...args) => ({ stub: String(prop) });
  },
});

const ctx = vm.createContext({
  console,
  performance,
  Math,
  Date,
  Float32Array, Uint16Array, Uint32Array, Uint8Array, Int32Array, Map, Set,
  isFinite, parseFloat, parseInt, NaN, Infinity,
});
for (const f of FILES) {
  vm.runInContext(readFileSync(join(src, f), 'utf8'), ctx, { filename: f });
}
vm.runInContext('const __gl = null;', ctx);
ctx.__glStub = glStub;

function run(code) { return vm.runInContext(code, ctx); }

const results = [];
const check = (name, value, min, max, unit = '') => {
  const ok = value >= min && value <= max;
  results.push(ok);
  const v = typeof value === 'number' ? value.toFixed(2) : value;
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${name.padEnd(38)} ${String(v).padStart(9)}${unit}  (expected ${min}–${max})`);
};

console.log('building scenes (CPU geometry only)...');
run(`
  var circuit = buildCircuit(__glStub);
  var home = buildHomeRoute(__glStub);
`);
const trackLen = run('circuit.track.spline.length');
const routeLen = run('home.routeLength');
console.log(`circuit length ${trackLen.toFixed(0)} m, route home ${routeLen.toFixed(0)} m\n`);

// --- straight line acceleration --------------------------------------------
run(`
  function flatWorld() {
    return { sampleSurface: () => ({ height: 0, surface: SURFACES.asphalt, onRoad: true }) };
  }
  function newCar(assists) {
    var v = new Vehicle({ assists: assists });
    v.setPose(0, 0, 0, 0);
    return v;
  }
  // Run the same launch at several frame rates. Handling must not depend on
  // how fast the machine happens to be painting.
  function accelTest(dt) {
    var v = newCar(true), w = flatWorld();
    var t = 0, t100 = -1, t200 = -1, topSpeed = 0;
    while (t < 45) {
      v.throttle = 1; v.brake = 0; v.steerInput = 0;
      v.update(dt, w); t += dt;
      var kmh = v.speed * 3.6;
      if (t100 < 0 && kmh >= 100) t100 = t;
      if (t200 < 0 && kmh >= 200) t200 = t;
      topSpeed = Math.max(topSpeed, kmh);
    }
    return { t100: t100, t200: t200, topSpeed: topSpeed };
  }
  var accel = accelTest(1 / 120);
  var accel60 = accelTest(1 / 60);
  var accel30 = accelTest(1 / 30);
`);
const accel = run('accel');
const accel60 = run('accel60');
const accel30 = run('accel30');
console.log(`0-100 km/h at 120/60/30 fps: ${accel.t100.toFixed(2)} / ${accel60.t100.toFixed(2)} / ${accel30.t100.toFixed(2)} s`);
check('0-100 km/h', accel.t100, 2.4, 5.5, ' s');
check('0-100 km/h at 60 fps', accel60.t100, 2.4, 5.5, ' s');
check('0-100 km/h at 30 fps', accel30.t100, 2.4, 5.5, ' s');
// The whole point: the car must feel the same on a fast desktop and a phone.
check('frame-rate spread in 0-100', Math.abs(accel60.t100 - accel.t100), 0, 0.35, ' s');
check('frame-rate spread at 30 fps', Math.abs(accel30.t100 - accel.t100), 0, 0.60, ' s');
check('0-200 km/h', accel.t200, 8.0, 20.0, ' s');
check('top speed (45 s run)', accel.topSpeed, 240, 330, ' km/h');

// --- braking ----------------------------------------------------------------
run(`
  function brakeTest() {
    var v = newCar(true), w = flatWorld();
    var dt = 1 / 240;
    // Get to 100 km/h.
    while (v.speed * 3.6 < 100) { v.throttle = 1; v.update(dt, w); }
    v.throttle = 0;
    var x0 = v.pos[0], z0 = v.pos[2], t = 0;
    while (v.speed > 0.4 && t < 12) { v.brake = 1; v.throttle = 0; v.update(dt, w); t += dt; }
    return { dist: Math.hypot(v.pos[0] - x0, v.pos[2] - z0), time: t };
  }
  var braking = brakeTest();
`);
const braking = run('braking');
check('100-0 km/h braking distance', braking.dist, 25, 60, ' m');

// --- steady state cornering --------------------------------------------------
run(`
  function skidpad() {
    var v = newCar(false), w = flatWorld();
    var dt = 1 / 240, best = 0;
    for (var steer = 0.15; steer <= 1.0; steer += 0.05) {
      var c = newCar(false);
      for (var i = 0; i < 240 * 12; i++) {
        c.throttle = 0.45; c.brake = 0; c.steerInput = steer;
        c.update(dt, w);
      }
      var lat = Math.abs(c.latAccel) / 9.81;
      if (isFinite(lat) && c.speed > 5) best = Math.max(best, lat);
    }
    return best;
  }
  var latG = skidpad();
`);
check('peak lateral g', run('latG'), 1.05, 2.2, ' g');

// --- surface grip -------------------------------------------------------------
run(`
  function grassTest() {
    var v = newCar(true);
    var w = { sampleSurface: () => ({ height: 0, surface: SURFACES.grass, onRoad: false }) };
    var dt = 1 / 120, t = 0;
    while (t < 12) { v.throttle = 1; v.update(dt, w); t += dt; }
    return v.speed * 3.6;
  }
  var grassSpeed = grassTest();
`);
check('12 s flat out on grass', run('grassSpeed'), 40, 165, ' km/h');

// --- AI lap ---------------------------------------------------------------------
run(`
  function aiRace(seconds) {
    // The AI makes deliberate random mistakes. Unseeded, one run to the next
    // varies by ten seconds a lap and several percent off track, which is far
    // more than most changes to the driver are worth - so tuning against it
    // measures noise. Seed it and the numbers mean something.
    var seed = 987654321;
    Math.random = function () {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    var cars = [];
    var drivers = [];
    for (var i = 0; i < 4; i++) {
      var car = {
        vehicle: new Vehicle({ assists: true, driverAids: false }),
        pos: null, yaw: 0, finished: false,
        forward: function () { return [Math.sin(this.vehicle.yaw), 0, Math.cos(this.vehicle.yaw)]; },
      };
      Object.defineProperty(car, 'pos', { get: function () { return this.vehicle.pos; } });
      Object.defineProperty(car, 'yaw', { get: function () { return this.vehicle.yaw; } });
      var g = circuit.grid[i];
      car.vehicle.setPose(g.x, g.z, g.yaw, circuit.world.groundHeight(g.x, g.z));
      cars.push(car);
      drivers.push(new RacingDriver(car, circuit.racingLine, 0.9));
    }
    var dt = 1 / 60, t = 0;
    var lapStart = [0, 0, 0, 0], laps = [0, 0, 0, 0], lapTimes = [];
    var startAlong = 0;
    var lastAlong = cars.map(() => 0);
    var offTrack = 0, samples = 0;
    var maxSpeed = 0;
    while (t < seconds) {
      for (var i = 0; i < drivers.length; i++) drivers[i].update(dt, cars, circuit.world);
      for (var i = 0; i < cars.length; i++) cars[i].vehicle.update(dt, circuit.world);
      t += dt;
      // Progress tracking for car 0.
      var v0 = cars[0].vehicle;
      maxSpeed = Math.max(maxSpeed, v0.speed * 3.6);
      var hit = circuit.world.query(v0.pos[0], v0.pos[2]);
      samples++;
      if (!hit || Math.abs(hit.lateral) > circuit.track.halfWidth + 1.4) offTrack++;
      for (var i = 0; i < cars.length; i++) {
        var idx = nearestIndex(circuit.track.spline, cars[i].pos[0], cars[i].pos[2], 0, circuit.track.spline.count);
        var along = circuit.track.spline.cumulative[idx];
        if (lastAlong[i] > circuit.track.spline.length * 0.8 && along < circuit.track.spline.length * 0.2) {
          laps[i]++;
          if (i === 0) lapTimes.push(t - lapStart[0]);
          lapStart[i] = t;
        }
        lastAlong[i] = along;
      }
    }
    return {
      laps: laps, lapTimes: lapTimes, offTrackPct: offTrack / samples * 100,
      maxSpeed: maxSpeed,
      distance: cars.map(function (c) { return c.vehicle.odometer; }),
    };
  }
  var race = aiRace(150);
`);
const race = run('race');
console.log(`\nAI race (150 s, 4 cars): laps=${JSON.stringify(race.laps)}  distance=${race.distance.map((d) => d.toFixed(0)).join(', ')} m`);
console.log(`lap times: ${race.lapTimes.map((t) => t.toFixed(2)).join(', ')}`);
check('AI distance covered in 150 s', race.distance[0], 3000, 12000, ' m');
check('AI time off track', race.offTrackPct, 0, 12, ' %');
check('AI top speed', race.maxSpeed, 150, 320, ' km/h');
if (race.lapTimes.length) {
  const avg = race.lapTimes.reduce((a, b) => a + b, 0) / race.lapTimes.length;
  check('AI average lap time', avg, 45, 130, ' s');
}

// --- traffic ---------------------------------------------------------------------
run(`
  function trafficTest(seconds) {
    var drivers = [];
    for (var i = 0; i < 6; i++) {
      var car = {
        vehicle: new Vehicle({ assists: true }), brakeGlow: 0,
        forward: function () { return [Math.sin(this.vehicle.yaw), 0, Math.cos(this.vehicle.yaw)]; },
        setPose: function (x, z, yaw, w) { this.vehicle.setPose(x, z, yaw, w.groundHeight(x, z)); },
      };
      Object.defineProperty(car, 'pos', { get: function () { return this.vehicle.pos; } });
      Object.defineProperty(car, 'yaw', { get: function () { return this.vehicle.yaw; } });
      var d = new TrafficDriver(car, home.route, 1, 2.1, 50);
      d.placeAt(10 + i * 12, home.world);
      drivers.push(d);
    }
    var lights = new TrafficLightSystem(home.trafficLights);
    var dt = 1 / 60, t = 0, offRoad = 0, samples = 0, speeds = [];
    while (t < seconds) {
      lights.update(dt);
      var cars = drivers.map(function (d) { return d.car; });
      for (var i = 0; i < drivers.length; i++) drivers[i].update(dt, home.world, cars, home.trafficLights);
      for (var i = 0; i < drivers.length; i++) drivers[i].car.vehicle.update(dt, home.world);
      t += dt;
      for (var i = 0; i < drivers.length; i++) {
        var v = drivers[i].car.vehicle;
        var hit = home.world.query(v.pos[0], v.pos[2]);
        samples++;
        if (!hit || Math.abs(hit.lateral) > home.route.halfWidth + 1.0) offRoad++;
      }
      if (Math.floor(t * 2) !== Math.floor((t - dt) * 2)) {
        speeds.push(drivers[0].car.vehicle.speed * 3.6);
      }
    }
    var avg = speeds.reduce(function (a, b) { return a + b; }, 0) / speeds.length;
    return { offRoadPct: offRoad / samples * 100, avgSpeed: avg, distance: drivers[0].car.vehicle.odometer };
  }
  var traffic = trafficTest(90);
`);
const traffic = run('traffic');
console.log(`\ntraffic (90 s, 6 cars): avg speed ${traffic.avgSpeed.toFixed(1)} km/h, distance ${traffic.distance.toFixed(0)} m`);
check('traffic stays on its road', traffic.offRoadPct, 0, 12, ' %');
check('traffic average speed', traffic.avgSpeed, 18, 60, ' km/h');

// --- surface query sanity -----------------------------------------------------
run(`
  function surfaceScan() {
    var sp = circuit.track.spline;
    var onRoad = 0, total = 0, maxStep = 0, prev = null;
    for (var i = 0; i < sp.count; i++) {
      var p = sp.points[i];
      var s = circuit.world.sampleSurface(p[0], p[2]);
      total++;
      if (s.onRoad) onRoad++;
      if (prev !== null) maxStep = Math.max(maxStep, Math.abs(s.height - prev));
      prev = s.height;
    }
    return { pct: onRoad / total * 100, maxStep: maxStep };
  }
  var scan = surfaceScan();
`);
const scan = run('scan');
check('track centreline reads as road', scan.pct, 99.9, 100, ' %');
check('max height step between samples', scan.maxStep, 0, 0.5, ' m');

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
