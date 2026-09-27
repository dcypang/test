// Shared steering-feel measurement, used by both the report (steerfeel.mjs)
// and the tuning loop (steerloop.mjs).
//
// "Feels wrong" cannot be fixed by squinting at the file, so this turns the
// feel of the steering into numbers. Everything measured here is something the
// player experiences directly: push the stick, see what the car does, how fast
// it does it, and whether it does the same thing next time.
//
// The targets are an arcade mobile racer's, not a simulator's, and that is a
// deliberate choice rather than a shortcut. On a phone you have one thumb, no
// force feedback, and no way to feel the rear stepping out until it has gone.
// So the car has to turn in promptly, answer in proportion to how far you
// push, hold on rather than snap, and straighten itself when you let go.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, 'src');
const FILES = ['math.js', 'gl.js', 'mesh.js', 'physics.js', 'car_model.js',
  'world.js', 'props.js', 'scenes.js', 'ai.js'];

// Geometry still gets built on the CPU; the uploads become no-ops.
const glStub = new Proxy({}, {
  get: (t, p) => (p === Symbol.toPrimitive ? () => 'glstub' : () => ({})),
});

export function makeHarness() {
  const ctx = vm.createContext({
    console, performance, Math, Date,
    Float32Array, Uint16Array, Uint32Array, Uint8Array, Int32Array, Map, Set,
    isFinite, parseFloat, parseInt, NaN, Infinity, Number, Object,
  });
  for (const f of FILES) vm.runInContext(readFileSync(join(src, f), 'utf8'), ctx, { filename: f });

  vm.runInContext(`
    function flatWorld() {
      return { sampleSurface: () => ({ height: 0, surface: SURFACES.asphalt, onRoad: true }) };
    }
    // Drop the car in already travelling. Accelerating up to speed each time
    // costs a hundred times as much simulation and measures the gearbox, not
    // the steering.
    function atSpeed(kmh, opts) {
      const v = new Vehicle(Object.assign({ assists: true }, opts || {}));
      const w = flatWorld();
      v.setPose(0, 0, 0, 0);
      const s = kmh / 3.6;
      v.vel[2] = s;
      v.speed = s;
      for (const wh of v.wheels) wh.omega = s / wh.radius;
      // Let the gearbox and the load transfer settle before measuring.
      for (let i = 0; i < 45; i++) {
        v.throttle = 0.25; v.brake = 0; v.steerInput = 0;
        v.update(1 / 60, w);
      }
      return { v, w };
    }
    // Hold a stick position and record what the car does.
    function steerStep(kmh, stick, seconds, opts) {
      const { v, w } = atSpeed(kmh, opts);
      const dt = 1 / 60;
      const trace = [];
      const hold = v.speedKmh;
      for (let i = 0; i < Math.round(seconds / dt); i++) {
        v.steerInput = stick;
        // Hold speed, so the measurement is about steering rather than about
        // the corner scrubbing the car down to a crawl.
        v.throttle = v.speedKmh < hold ? 0.6 : 0.1;
        v.brake = 0;
        v.update(dt, w);
        const vl = v.toLocal(v.vel);
        trace.push({
          t: (i + 1) * dt,
          yawRate: v.yawRate,
          beta: Math.atan2(vl[0], Math.abs(vl[2])),
          kmh: v.speedKmh,
        });
      }
      return trace;
    }
    function releaseTest(kmh) {
      const { v, w } = atSpeed(kmh);
      for (let i = 0; i < 90; i++) { v.steerInput = 1; v.throttle = 0.5; v.update(1 / 60, w); }
      const peak = Math.abs(v.yawRate);
      let t = 0;
      for (let i = 0; i < 300; i++) {
        v.steerInput = 0; v.throttle = 0.3; v.update(1 / 60, w);
        t += 1 / 60;
        if (Math.abs(v.yawRate) < peak * 0.1) break;
      }
      return t;
    }
  `, ctx);

  // The circuit, built once and reused: the AI guard below races on it.
  ctx.__glStub = glStub;
  vm.runInContext('var circuit = buildCircuit(__glStub);', ctx);
  vm.runInContext(`
    // A short seeded race, used as a guard rather than a benchmark. Tuning the
    // car purely for how it feels under a thumb will happily wreck the AI,
    // which drives the same physics with a controller of its own - so the AI
    // has to be part of the objective, not something checked afterwards.
    // One car, but long enough to cover a whole lap. A short race with a full
    // grid costs more and measures less: it never reaches the hard corners,
    // and most of what it does measure is cars blocking each other rather than
    // whether the AI can drive this car at all.
    function aiOffTrack(seconds) {
      let seed = 987654321;
      const realRandom = Math.random;
      Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
      const cars = [], drivers = [];
      for (let i = 0; i < 1; i++) {
        const car = { vehicle: new Vehicle({ assists: true, driverAids: false }), finished: false,
          forward() { return [Math.sin(this.vehicle.yaw), 0, Math.cos(this.vehicle.yaw)]; } };
        Object.defineProperty(car, 'pos', { get() { return this.vehicle.pos; } });
        Object.defineProperty(car, 'yaw', { get() { return this.vehicle.yaw; } });
        const g = circuit.grid[i];
        car.vehicle.setPose(g.x, g.z, g.yaw, circuit.world.groundHeight(g.x, g.z));
        cars.push(car);
        drivers.push(new RacingDriver(car, circuit.racingLine, 0.9));
      }
      let off = 0, n = 0;
      for (let t = 0; t < 60 * seconds; t++) {
        for (const d of drivers) d.update(1 / 60, cars, circuit.world);
        for (const c of cars) c.vehicle.update(1 / 60, circuit.world);
        for (const c of cars) {
          const hit = circuit.world.query(c.pos[0], c.pos[2]);
          n++;
          if (!hit || Math.abs(hit.lateral) > circuit.track.halfWidth + 1.4) off++;
        }
      }
      Math.random = realRandom;
      return 100 * off / n;
    }
  `, ctx);

  const run = (code) => vm.runInContext(code, ctx);
  return {
    run,
    setFeel: (params) => {
      ctx.__feel = params;
      run('Object.assign(STEER_FEEL, __feel)');
    },
    getFeel: () => run('JSON.parse(JSON.stringify(STEER_FEEL))'),
  };
}

const settled = (trace, key) => {
  const from = Math.floor(trace.length * 0.66);
  let s = 0;
  for (let i = from; i < trace.length; i++) s += Math.abs(trace[i][key]);
  return s / (trace.length - from);
};

const t90 = (trace) => {
  const target = settled(trace, 'yawRate') * 0.9;
  for (const p of trace) if (Math.abs(p.yawRate) >= target) return p.t;
  return trace[trace.length - 1].t;
};

const overshoot = (trace) => {
  const s = settled(trace, 'yawRate');
  if (s < 1e-4) return 0;
  let peak = 0;
  for (const p of trace) peak = Math.max(peak, Math.abs(p.yawRate));
  return (peak - s) / s;
};

export function measure(h) {
  const out = {};

  // Response, grip and geometry at three speeds.
  for (const kmh of [60, 120, 180]) {
    const tr = h.run(`steerStep(${kmh}, 1, 2.6)`);
    out[`t90_${kmh}`] = t90(tr);
    out[`yaw_${kmh}`] = settled(tr, 'yawRate');
    out[`overshoot_${kmh}`] = overshoot(tr);
    const speed = settled(tr, 'kmh') / 3.6;
    out[`radius_${kmh}`] = out[`yaw_${kmh}`] > 1e-3 ? speed / out[`yaw_${kmh}`] : 9999;
    // Lateral g is the thing the player actually feels as "how hard is it
    // cornering". Radius is not a fair measure of consistency: it is v^2 over
    // lateral acceleration, so tripling the speed multiplies it by nine no
    // matter what the car does. Asking for a narrow radius spread asks for
    // something no car can deliver, and tuning against it makes the car worse
    // everywhere else to chase a number that cannot move.
    out[`latG_${kmh}`] = out[`yaw_${kmh}`] * speed / 9.81;
  }

  // Half a stick should give about half the turn. With one thumb and no force
  // feedback, proportionality is the only feedback channel the player has.
  const stick = [0.25, 0.5, 0.75, 1.0];
  const yaws = stick.map((s) => settled(h.run(`steerStep(120, ${s}, 2.2)`), 'yawRate'));
  const full = yaws[yaws.length - 1] || 1e-6;
  out.yawCurve = yaws.map((y) => +(y / full).toFixed(3));
  out.linearityError = Math.max(...stick.map((s, i) => Math.abs(yaws[i] / full - s)));

  // Full lock at speed should hold on, not snap into a spin.
  const hard = h.run(`steerStep(170, 1, 4.0)`);
  out.maxBeta = Math.max(...hard.map((p) => Math.abs(p.beta)));

  // Let go mid-corner and the car should straighten itself: on a phone the
  // thumb has usually already moved on.
  out.recoverTime = h.run('releaseTest(120)');

  // The same stick should pull about the same g at 60 as at 180 - that is
  // what "the same car at any speed" means to a player's inner ear.
  const gs = [out.latG_60, out.latG_120, out.latG_180];
  out.latGSpread = Math.max(...gs) / Math.min(...gs);

  // Whatever the car does under a thumb, the AI has to be able to drive it.
  out.aiOffTrack = h.run('aiOffTrack(80)');

  // A car that cannot make a village junction is not driveable on the road.
  const slow = h.run(`steerStep(30, 1, 3.0)`);
  const ys = settled(slow, 'yawRate');
  out.radius_30 = ys > 1e-3 ? (settled(slow, 'kmh') / 3.6) / ys : 9999;

  return out;
}

// [min, max, weight, unit, label]
export const TARGETS = {
  t90_60: [0.10, 0.28, 2, 's', 'turn-in delay at 60'],
  t90_120: [0.10, 0.30, 3, 's', 'turn-in delay at 120'],
  t90_180: [0.10, 0.36, 2, 's', 'turn-in delay at 180'],
  overshoot_120: [0.0, 0.14, 3, '', 'yaw overshoot at 120'],
  linearityError: [0.0, 0.10, 4, '', 'stick-to-yaw linearity error'],
  maxBeta: [0.0, 0.40, 3, 'rad', 'worst slip angle, full lock at 170'],
  recoverTime: [0.10, 1.20, 2, 's', 'self-centring after letting go'],
  latGSpread: [1.0, 1.45, 2, 'x', 'cornering g spread, 60 to 180'],
  latG_120: [1.05, 1.55, 3, 'g', 'cornering g at full lock, 120'],
  latG_180: [1.20, 1.95, 2, 'g', 'cornering g at full lock, 180'],
  radius_30: [4.0, 12.0, 1, 'm', 'full-lock radius at 30'],
  aiOffTrack: [0.0, 6.0, 4, '%', 'AI time off track on the same car'],
};

export function score(m) {
  let penalty = 0;
  const misses = [];
  for (const [key, [min, max, weight]] of Object.entries(TARGETS)) {
    const v = m[key];
    let miss = 0;
    if (!Number.isFinite(v)) miss = 10;
    else if (v < min) miss = (min - v) / Math.max(Math.abs(min), 1e-6);
    else if (v > max) miss = (v - max) / Math.max(Math.abs(max), 1e-6);
    penalty += miss * weight;
    if (miss > 0) misses.push([key, +miss.toFixed(3)]);
  }
  misses.sort((a, b) => b[1] - a[1]);
  return { penalty: +penalty.toFixed(4), misses };
}

export function report(m, s) {
  for (const [key, [min, max, , unit, label]] of Object.entries(TARGETS)) {
    const v = m[key];
    const ok = v >= min && v <= max;
    console.log(`${ok ? ' ok ' : 'FAIL'}  ${label.padEnd(38)} ${v.toFixed(2).padStart(8)}${unit.padEnd(4)}`
      + `(want ${min}–${max})`);
  }
  console.log(`\nyaw response at 120 for 1/4, 1/2, 3/4, full stick: ${m.yawCurve.join(' / ')}`
    + '   (want 0.25 / 0.50 / 0.75 / 1.00)');
  console.log(`corner radius at 30/60/120/180 km/h: ${[m.radius_30, m.radius_60, m.radius_120, m.radius_180]
    .map((r) => r.toFixed(0) + ' m').join('  ')}`);
  console.log(`cornering g at 60/120/180:           ${[m.latG_60, m.latG_120, m.latG_180]
    .map((g) => g.toFixed(2) + ' g').join('   ')}`);
  console.log(`\npenalty ${s.penalty}  (0 = every target met)`);
  if (s.misses.length) console.log('worst: ' + s.misses.slice(0, 5).map(([k, v]) => `${k} ${v}`).join(', '));
}
