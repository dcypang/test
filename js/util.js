'use strict';
// ---------------------------------------------------------------------------
// Shared constants and small helpers
// ---------------------------------------------------------------------------
const TW = 64, TH = 32, HW = 32, HH = 16;   // isometric tile size (px)
const STEP = 1 / 30;                        // fixed simulation step (s)

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;

function rectDist(px, py, x0, y0, x1, y1) {
  const dx = Math.max(x0 - px, 0, px - x1);
  const dy = Math.max(y0 - py, 0, py - y1);
  return Math.hypot(dx, dy);
}

function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [n >> 16 & 255, n >> 8 & 255, n & 255];
}

const _shadeCache = new Map();
// f < 0 darkens toward black, f > 0 lightens toward white
function shade(hex, f) {
  const key = hex + f;
  let v = _shadeCache.get(key);
  if (v) return v;
  const [r, g, b] = hexToRgb(hex);
  const t = f < 0 ? 0 : 255, p = Math.abs(f);
  v = `rgb(${Math.round(r + (t - r) * p)},${Math.round(g + (t - g) * p)},${Math.round(b + (t - b) * p)})`;
  _shadeCache.set(key, v);
  return v;
}

function fmtTime(s) {
  s = Math.max(0, Math.ceil(s));
  const m = Math.floor(s / 60), r = s % 60;
  return m + ':' + (r < 10 ? '0' : '') + r;
}

// tile coords -> iso pixel coords (z is height in px)
function ip(x, y, z) { return [(x - y) * HW, (x + y) * HH - (z || 0)]; }
