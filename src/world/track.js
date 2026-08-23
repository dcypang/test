/**
 * The course centreline.
 *
 * Everything in the game — road mesh, scenery placement, traffic, the minimap,
 * even the physics — works in track space: a distance `s` along the centreline
 * plus a signed lateral offset. This module turns a seed into that centreline
 * and provides the lookups that convert between track space and world space.
 *
 * Frame convention, which the rest of the game depends on:
 *
 *   forward(h) = ( sin h, 0,  cos h )     a mesh's local +Z
 *   lateral(h) = ( cos h, 0, -sin h )     a mesh's local +X
 *   up         = ( 0,     1,  0     )
 *
 * That is exactly three.js's rotation about +Y, so a mesh placed on the course
 * only ever needs `rotation.y = heading` — no sign flips, no mirrored models.
 *
 * Note the axis is called `lateral`, not `right`, and the distinction is not
 * cosmetic. For a mesh built facing local +Z, "right" is `forward x up`, which
 * comes out as local -X — the same reason three.js's own camera looks down -Z
 * with +X to its right. So **positive `lateral` is the rider's LEFT**, and
 * increasing `heading` turns left (counter-clockwise seen from above).
 *
 * Everything downstream is consistent with that, and the steering input is
 * negated once, in physics.js, to convert player intent into this frame.
 */

import * as THREE from 'three';
import { makeNoise1D, fbm1D, clamp, lerp, mod, TAU } from '../engine/util.js';

export const TRACK_PRESETS = {
  highway: {
    id: 'highway',
    name: 'Coastal Highway',
    sky: 'day',
    seed: 20482,
    length: 7200,
    curviness: 0.55,
    hilliness: 1.0,
    roadHalfWidth: 7.2,
    laneCount: 4,
    shoulder: 3.0,
    scenery: 'rural',
    guardrail: 'metal',
    trafficDensity: 0.55,
    trafficSpeed: [24, 33],
    rain: 0,
    grass: 'summer',
    mountains: '#5f7286',
  },
  city: {
    id: 'city',
    name: 'Downtown Night',
    sky: 'night',
    seed: 77321,
    length: 6000,
    curviness: 0.8,
    hilliness: 0.35,
    roadHalfWidth: 7.6,
    laneCount: 4,
    shoulder: 2.2,
    scenery: 'city',
    guardrail: 'kerb',
    trafficDensity: 1.0,
    trafficSpeed: [16, 26],
    rain: 0.85,
    grass: 'summer',
    mountains: null,
  },
  canyon: {
    id: 'canyon',
    name: 'Canyon Run',
    sky: 'dusk',
    seed: 51190,
    length: 6600,
    curviness: 1.45,
    hilliness: 2.2,
    roadHalfWidth: 6.4,
    // Four lanes, like the other courses: the road texture bakes a four-lane
    // layout (edge lines, dashed dividers, double-yellow centre), so a
    // two-lane count here would put traffic where no lane is painted.
    laneCount: 4,
    shoulder: 1.6,
    scenery: 'canyon',
    guardrail: 'metal',
    trafficDensity: 0.4,
    trafficSpeed: [20, 28],
    rain: 0,
    grass: 'dry',
    mountains: '#6b5a52',
  },
};

/** Spacing between centreline samples, in metres. */
const DS = 4;

/**
 * Road built before the start line and after the finish line.
 *
 * The chase camera sits several metres behind the rider, so without a run-in
 * the bottom of the very first frame looks off the end of the world. The
 * run-out gives the finish somewhere to lead to instead of a cliff edge.
 */
const MARGIN = 70;

export class Track {
  constructor(preset) {
    this.preset = preset;
    // `length` is the full extent of built road; the race runs between
    // `startS` and `finishS`, leaving a margin of road at each end.
    this.length = preset.length + MARGIN * 2;
    this.startS = MARGIN;
    this.finishS = preset.length + MARGIN;
    this.raceLength = preset.length;
    this.halfWidth = preset.roadHalfWidth;
    this.shoulder = preset.shoulder;
    this.count = Math.floor(this.length / DS) + 1;
    this.ds = DS;

    this.x = new Float32Array(this.count);
    this.y = new Float32Array(this.count);
    this.z = new Float32Array(this.count);
    this.heading = new Float32Array(this.count);
    this.curvature = new Float32Array(this.count);
    this.camber = new Float32Array(this.count);

    this._build();
    this._bounds();

    // Scratch objects so per-frame sampling allocates nothing.
    this._v = new THREE.Vector3();
    this._t = new THREE.Vector3();
    this._n = new THREE.Vector3();
  }

  _build() {
    const p = this.preset;
    const curveNoise = makeNoise1D(p.seed);
    const hillNoise = makeNoise1D(p.seed + 991);

    let heading = 0;
    let x = 0;
    let z = 0;

    for (let i = 0; i < this.count; i++) {
      const s = i * DS;

      // Curvature from fractal noise. The wavelength (280 m) gives sweepers a
      // sports bike can actually carry speed through.
      let k = fbm1D(curveNoise, s / 280, 3, 2.1, 0.45) * 0.0075 * p.curviness;

      // Gently pull the course back toward its original bearing so a long
      // random walk can't fold the road on top of itself.
      k -= heading * 0.00022;

      // Straighten around the start and finish so both lines sit on a
      // clean piece of road and the run-in is dead ahead.
      const endFade = clamp(Math.min(s, this.length - s) / 250, 0, 1);
      k *= endFade;

      this.curvature[i] = k;
      this.heading[i] = heading;
      this.x[i] = x;
      this.z[i] = z;

      // Elevation: long swells plus a smaller ripple.
      const hill =
        fbm1D(hillNoise, s / 520, 3, 2.0, 0.5) * 14 * p.hilliness +
        Math.sin(s / 143) * 1.6 * p.hilliness;
      this.y[i] = hill * endFade;

      // Banking follows curvature: the outside of the turn is the high side.
      // k > 0 is a left-hander (heading increases counter-clockwise), whose
      // outside is the rider's right — the negative-lateral edge — so the
      // camber has to be negative to lift it.
      this.camber[i] = clamp(-k * 340, -0.14, 0.14);

      // Integrate forward. The course runs toward +Z at heading 0.
      heading += k * DS;
      x += Math.sin(heading) * DS;
      z += Math.cos(heading) * DS;
    }

    // Smooth elevation so the tangent stays continuous under the wheels.
    const smoothed = new Float32Array(this.y);
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 1; i < this.count - 1; i++) {
        smoothed[i] = (this.y[i - 1] + this.y[i] * 2 + this.y[i + 1]) * 0.25;
      }
      this.y.set(smoothed);
    }
  }

  _bounds() {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < this.count; i++) {
      if (this.x[i] < minX) minX = this.x[i];
      if (this.x[i] > maxX) maxX = this.x[i];
      if (this.z[i] < minZ) minZ = this.z[i];
      if (this.z[i] > maxZ) maxZ = this.z[i];
    }
    this.bounds = { minX, maxX, minZ, maxZ };
  }

  /** Clamp a distance to the course, so lookups near the ends stay valid. */
  clampS(s) {
    return clamp(s, 0, this.length - 0.001);
  }

  /**
   * Interpolated centreline data at distance `s`.
   * Writes into `out` to avoid allocating; returns `out`.
   */
  sample(s, out = {}) {
    const cs = this.clampS(s);
    const f = cs / DS;
    const i = Math.min(this.count - 2, Math.floor(f));
    const t = f - i;

    out.x = lerp(this.x[i], this.x[i + 1], t);
    out.y = lerp(this.y[i], this.y[i + 1], t);
    out.z = lerp(this.z[i], this.z[i + 1], t);
    out.heading = lerp(this.heading[i], this.heading[i + 1], t);
    out.curvature = lerp(this.curvature[i], this.curvature[i + 1], t);
    out.camber = lerp(this.camber[i], this.camber[i + 1], t);
    // Road pitch: rise over run between the two bracketing samples.
    out.pitch = Math.atan2(this.y[i + 1] - this.y[i], DS);
    return out;
  }

  /** World position of a point at (s, lateral). `lateral` is +right. */
  toWorld(s, lateral, out = new THREE.Vector3()) {
    const c = this.sample(s, this._sampleCache || (this._sampleCache = {}));
    const cosH = Math.cos(c.heading);
    const sinH = Math.sin(c.heading);
    out.set(
      c.x + cosH * lateral,
      c.y + Math.sin(c.camber) * lateral,
      c.z - sinH * lateral,
    );
    return out;
  }

  /** Unit forward vector at `s`. */
  forward(s, out = new THREE.Vector3()) {
    const c = this.sample(s, this._fCache || (this._fCache = {}));
    const cp = Math.cos(c.pitch);
    return out.set(Math.sin(c.heading) * cp, Math.sin(c.pitch), Math.cos(c.heading) * cp);
  }

  /**
   * Surface normal at `s`.
   *
   * Derived from the two surface tangents rather than by rotating world-up,
   * so it can't drift out of agreement with `toWorld`: the across-tangent is
   * exactly the direction `toWorld` moves in as `lateral` increases.
   */
  normal(s, out = new THREE.Vector3()) {
    const c = this.sample(s, this._nCache || (this._nCache = {}));
    const cp = Math.cos(c.pitch);
    _fwd.set(Math.sin(c.heading) * cp, Math.sin(c.pitch), Math.cos(c.heading) * cp);
    _across.set(Math.cos(c.heading), Math.sin(c.camber), -Math.sin(c.heading));
    return out.crossVectors(_fwd, _across).normalize();
  }

  /** Ground height under a track-space point. */
  heightAt(s, lateral) {
    const c = this.sample(s, this._hCache || (this._hCache = {}));
    return c.y + Math.sin(c.camber) * lateral;
  }

  /**
   * Nearest track distance to a world position — used by the crash recovery
   * and by traffic that has been pushed off-line. `hint` seeds the search so
   * the common case costs a handful of comparisons.
   */
  nearestS(worldX, worldZ, hint = 0) {
    const hintIndex = clamp(Math.round(hint / DS), 0, this.count - 1);
    const span = 90;                    // ±360 m around the hint
    let bestI = hintIndex;
    let bestD = Infinity;
    const lo = Math.max(0, hintIndex - span);
    const hi = Math.min(this.count - 1, hintIndex + span);
    for (let i = lo; i <= hi; i++) {
      const dx = this.x[i] - worldX;
      const dz = this.z[i] - worldZ;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; bestI = i; }
    }
    return bestI * DS;
  }

  /** Signed lateral offset of a world position relative to the centreline. */
  lateralAt(s, worldX, worldZ) {
    const c = this.sample(s, this._lCache || (this._lCache = {}));
    const dx = worldX - c.x;
    const dz = worldZ - c.z;
    // Project onto the right vector (cos h, 0, -sin h).
    return dx * Math.cos(c.heading) - dz * Math.sin(c.heading);
  }

  /**
   * The forward lane nearest the centre line — the one a rider racing the
   * course would actually use, with road on both sides rather than a shoulder
   * immediately to hand. Used for spawning and for recovery after a crash.
   */
  get racingLane() {
    const lanes = this.forwardLanes;
    return lanes[lanes.length - 1];
  }

  /** Centre of lane `i` (0 = rider's-right edge) as a lateral offset. */
  laneCentre(i) {
    const lanes = this.preset.laneCount;
    const laneWidth = (this.halfWidth * 2) / lanes;
    return -this.halfWidth + laneWidth * (i + 0.5);
  }

  get laneWidth() {
    return (this.halfWidth * 2) / this.preset.laneCount;
  }

  /**
   * Lanes travelling in the player's direction.
   *
   * Low lane indices are at negative `lateral`, which — per the note at the
   * top of this file — is the rider's right. The road texture bakes an
   * American layout with a double-yellow centre line, so the player and the
   * traffic going their way belong on that side of it.
   */
  get forwardLanes() {
    const lanes = this.preset.laneCount;
    return Array.from({ length: Math.max(1, Math.floor(lanes / 2)) }, (_, i) => i);
  }

  /** Oncoming lanes: the far side of the centre line. */
  get oncomingLanes() {
    const lanes = this.preset.laneCount;
    return Array.from({ length: Math.max(1, lanes / 2) }, (_, i) => Math.floor(lanes / 2) + i);
  }
}

const _fwd = new THREE.Vector3();
const _across = new THREE.Vector3();
