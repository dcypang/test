/**
 * Small math / helper toolbox shared by the whole game.
 * Kept dependency-free so it can be unit-tested in isolation.
 */

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const smoothstep = (t) => t * t * (3 - 2 * t);
export const mod = (a, n) => ((a % n) + n) % n;

/** Shortest signed angular difference from `a` to `b`, in radians. */
export const angleDelta = (a, b) => mod(b - a + Math.PI, TAU) - Math.PI;

/**
 * Frame-rate independent exponential approach.
 * `smoothing` is the fraction of the gap remaining after one second.
 */
export function damp(current, target, smoothing, dt) {
  return lerp(current, target, 1 - Math.pow(smoothing, dt));
}

/** Move `current` toward `target` by at most `maxDelta`. */
export function approach(current, target, maxDelta) {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

/** Deterministic PRNG (mulberry32) so a given seed always builds the same course. */
export function makeRng(seed = 1) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cheap 1D value noise with cubic interpolation — used for road curvature and hills. */
export function makeNoise1D(seed = 1) {
  const rng = makeRng(seed);
  const size = 512;
  const table = new Float32Array(size);
  for (let i = 0; i < size; i++) table[i] = rng() * 2 - 1;
  return function noise(x) {
    const xi = Math.floor(x);
    const f = x - xi;
    const a = table[mod(xi, size)];
    const b = table[mod(xi + 1, size)];
    return lerp(a, b, smoothstep(f));
  };
}

/** Fractal sum of the 1D noise above. */
export function fbm1D(noise, x, octaves = 4, lacunarity = 2, gain = 0.5) {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise(x * freq) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** Pick a random element from an array. */
export const pick = (rng, arr) => arr[Math.floor(rng() * arr.length) % arr.length];

/** Random float in [lo, hi). */
export const rand = (rng, lo, hi) => lo + rng() * (hi - lo);

/** Format seconds as mm:ss.cs — matches the reference HUD clock. */
export function formatTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds * 100) % 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

export const MPS_TO_MPH = 2.2369362920544;
export const MPS_TO_KMH = 3.6;

/** Create an offscreen 2D canvas at `size` square, ready to draw into. */
export function makeCanvas(size, height = size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = height;
  return canvas;
}

/**
 * Sprinkle value noise over an existing canvas context — the base grain for
 * asphalt, dirt and concrete. Operates on the whole canvas.
 */
export function grainOverlay(ctx, w, h, amount, rng, tint = [0, 0, 0]) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng() * 2 - 1) * amount;
    d[i] = clamp(d[i] + n + tint[0], 0, 255);
    d[i + 1] = clamp(d[i + 1] + n + tint[1], 0, 255);
    d[i + 2] = clamp(d[i + 2] + n + tint[2], 0, 255);
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * Soft blotches, used to break up flat texture fills (oil stains on asphalt,
 * patchy colour on grass).
 */
export function blotches(ctx, w, h, count, rng, colorFn, rMin, rMax) {
  for (let i = 0; i < count; i++) {
    const x = rng() * w;
    const y = rng() * h;
    const r = rand(rng, rMin, rMax);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const c = colorFn(rng);
    g.addColorStop(0, c.replace('ALPHA', '0.5'));
    g.addColorStop(1, c.replace('ALPHA', '0'));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }
}
