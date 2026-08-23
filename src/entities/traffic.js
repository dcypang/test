/**
 * AI traffic.
 *
 * Vehicles live in track space like the player, which makes lane discipline,
 * following distance and collision tests one-dimensional. A fixed pool is
 * recycled around the rider: anything that falls too far behind is respawned
 * ahead, so the road is always populated without ever growing the pool.
 */

import * as THREE from 'three';
import { mergeGeometries, colorize, roundedBox } from '../engine/geometry.js';
import { makeRng, rand, pick, clamp, damp, lerp, TAU } from '../engine/util.js';

const BODY_COLORS = [
  0xb8bcc0, 0x2c3138, 0x8e1f24, 0x1f3a63, 0xd8d9db,
  0x3d5a44, 0x6a6d70, 0xc4772a, 0x101216, 0x4a4e88,
];

/** Vehicle silhouettes. Dimensions are in metres. */
const SHAPES = [
  { name: 'sedan',   length: 4.6, width: 1.82, height: 1.42, mass: 1.0 },
  { name: 'hatch',   length: 4.0, width: 1.76, height: 1.48, mass: 0.9 },
  { name: 'suv',     length: 4.9, width: 1.94, height: 1.78, mass: 1.2 },
  { name: 'pickup',  length: 5.4, width: 1.96, height: 1.82, mass: 1.3 },
  { name: 'van',     length: 5.6, width: 2.02, height: 2.30, mass: 1.4 },
  { name: 'bus',     length: 10.5, width: 2.50, height: 3.15, mass: 3.0 },
];

/* ==================================================================
   Geometry
   ================================================================== */

/**
 * Build one vehicle. Returns geometry split into three buckets:
 * `paint` (tinted per vehicle), `trim` (shared) and `glow` (shared emissive).
 */
function vehicleGeometry(shape, rng) {
  const L = shape.length;
  const W = shape.width;
  const H = shape.height;
  const paint = [];
  const trim = [];
  const glow = [];

  const wheelR = clamp(H * 0.22, 0.3, 0.46);
  const bodyBottom = wheelR * 0.72;

  if (shape.name === 'bus' || shape.name === 'van') {
    // One tall box with a rounded roof.
    const body = roundedBox(W, H - bodyBottom, L, 0.18, 2);
    body.translate(0, bodyBottom + (H - bodyBottom) / 2, 0);
    paint.push(body);

    // Window band all the way round.
    const glass = new THREE.BoxGeometry(W * 1.005, H * 0.30, L * 0.86);
    glass.translate(0, H * 0.68, L * 0.02);
    trim.push(colorize(glass, 0x161c24));
  } else {
    // Lower body.
    const lower = roundedBox(W, H * 0.46, L, 0.16, 2);
    lower.translate(0, bodyBottom + H * 0.23, 0);
    paint.push(lower);

    // Cabin: shorter, narrower, set back.
    const cabinL = shape.name === 'pickup' ? L * 0.38 : L * 0.54;
    const cabinZ = shape.name === 'pickup' ? -L * 0.08 : -L * 0.02;
    const cabin = roundedBox(W * 0.88, H * 0.42, cabinL, 0.14, 2);
    cabin.translate(0, bodyBottom + H * 0.60, cabinZ);
    paint.push(cabin);

    // Greenhouse, inset so the pillars read as paint.
    const glass = new THREE.BoxGeometry(W * 0.90, H * 0.30, cabinL * 0.90);
    glass.translate(0, bodyBottom + H * 0.62, cabinZ);
    trim.push(colorize(glass, 0x161c24));

    if (shape.name === 'pickup') {
      // Bed walls.
      for (const side of [-1, 1]) {
        const wall = new THREE.BoxGeometry(W * 0.08, H * 0.26, L * 0.42);
        wall.translate(side * W * 0.46, bodyBottom + H * 0.52, L * 0.26);
        paint.push(wall);
      }
      const tailgate = new THREE.BoxGeometry(W * 0.96, H * 0.26, 0.08);
      tailgate.translate(0, bodyBottom + H * 0.52, L * 0.47);
      paint.push(tailgate);
    }
  }

  // Bumpers.
  for (const z of [-L * 0.49, L * 0.49]) {
    const bumper = new THREE.BoxGeometry(W * 0.98, H * 0.14, 0.14);
    bumper.translate(0, bodyBottom + H * 0.10, z);
    trim.push(colorize(bumper, 0x24282d));
  }

  // Wheels: simple cylinders, plenty at this distance.
  const axleZ = shape.name === 'bus' ? [-L * 0.36, L * 0.30] : [-L * 0.32, L * 0.32];
  for (const z of axleZ) {
    for (const side of [-1, 1]) {
      const tyre = new THREE.CylinderGeometry(wheelR, wheelR, W * 0.14, 10);
      tyre.rotateZ(Math.PI / 2);
      tyre.translate(side * W * 0.46, wheelR, z);
      trim.push(colorize(tyre, 0x141518));

      const hub = new THREE.CylinderGeometry(wheelR * 0.55, wheelR * 0.55, W * 0.15, 8);
      hub.rotateZ(Math.PI / 2);
      hub.translate(side * W * 0.47, wheelR, z);
      trim.push(colorize(hub, 0x7d8288));
    }
  }

  // Lights. Vehicles are modelled nose-toward +Z, matching the track frame.
  for (const side of [-1, 1]) {
    const head = new THREE.BoxGeometry(W * 0.24, H * 0.10, 0.06);
    head.translate(side * W * 0.32, bodyBottom + H * 0.26, L * 0.50);
    glow.push(colorize(head, 0xfff2d0));

    const tail = new THREE.BoxGeometry(W * 0.22, H * 0.09, 0.06);
    tail.translate(side * W * 0.33, bodyBottom + H * 0.28, -L * 0.50);
    glow.push(colorize(tail, 0xff2418));
  }

  void rng;
  return {
    paint: mergeGeometries(paint),
    trim: mergeGeometries(trim),
    glow: mergeGeometries(glow),
  };
}

/* ==================================================================
   Traffic manager
   ================================================================== */

class Vehicle {
  constructor(meshGroup, shape, paintMat) {
    this.group = meshGroup;
    this.shape = shape;
    this.paintMat = paintMat;
    this.active = false;

    this.s = 0;
    this.lane = 0;
    this.lateral = 0;
    this.targetLateral = 0;
    this.speed = 0;
    this.targetSpeed = 0;
    this.oncoming = false;
    this.laneTimer = 0;
    this.braking = false;
    this.nearMissed = false;
  }
}

export class Traffic {
  constructor(scene, track, settings, sky) {
    this.scene = scene;
    this.track = track;
    this.settings = settings;
    this.night = !!sky.preset.wet;
    this.rng = makeRng(track.preset.seed + 313);

    this.count = Math.round(settings.trafficCount * track.preset.trafficDensity);
    this.speedRange = track.preset.trafficSpeed;

    this.group = new THREE.Group();
    this.group.name = 'traffic';
    scene.add(this.group);

    this.disposables = [];
    this._makeMaterials();
    this._makeGeometries();

    this.vehicles = [];
    for (let i = 0; i < this.count; i++) this.vehicles.push(this._makeVehicle());

    this._pos = new THREE.Vector3();
    this._c = {};
  }

  _makeMaterials() {
    this.trimMat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.45, metalness: 0.35,
      envMapIntensity: this.night ? 1.3 : 0.9,
    });
    this.glowMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      emissive: 0xffffff,
      emissiveIntensity: this.night ? 2.4 : 0.6,
      roughness: 0.4,
    });
    this.glowMat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance *= vColor.rgb;',
      );
    };
    this.disposables.push(this.trimMat, this.glowMat);
  }

  _makeGeometries() {
    this.shapeGeos = SHAPES.map((shape) => {
      const geos = vehicleGeometry(shape, this.rng);
      this.disposables.push(geos.paint, geos.trim, geos.glow);
      return geos;
    });
  }

  _makeVehicle() {
    const rng = this.rng;
    // Buses are rare; ordinary cars dominate.
    let shapeIndex = Math.floor(rng() * SHAPES.length);
    if (SHAPES[shapeIndex].name === 'bus' && rng() > 0.3) shapeIndex = 0;
    const shape = SHAPES[shapeIndex];
    const geos = this.shapeGeos[shapeIndex];

    const group = new THREE.Group();
    const cc = this.settings.clearcoat;
    const Paint = cc ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
    const paintMat = new Paint({
      color: pick(rng, BODY_COLORS),
      roughness: cc ? 0.42 : 0.32,
      metalness: cc ? 0.15 : 0.4,
      envMapIntensity: this.night ? 1.2 : 0.7,
      ...(cc ? { clearcoat: 1.0, clearcoatRoughness: 0.08 } : {}),
    });
    this.disposables.push(paintMat);

    const paintMesh = new THREE.Mesh(geos.paint, paintMat);
    const trimMesh = new THREE.Mesh(geos.trim, this.trimMat);
    const glowMesh = new THREE.Mesh(geos.glow, this.glowMat);
    paintMesh.castShadow = this.settings.shadows;
    trimMesh.castShadow = false;
    group.add(paintMesh, trimMesh, glowMesh);
    group.visible = false;
    this.group.add(group);

    return new Vehicle(group, shape, paintMat);
  }

  /* ----------------------------------------------------------------
     Spawning
     ---------------------------------------------------------------- */

  /** Fill the road around `playerS` from scratch. */
  reset(playerS) {
    for (const v of this.vehicles) {
      v.active = false;
      v.group.visible = false;
    }
    for (const v of this.vehicles) this._spawn(v, playerS, true);
  }

  _spawn(v, playerS, initial = false) {
    const rng = this.rng;
    const track = this.track;

    // About a third of traffic comes the other way, which is what makes
    // overtaking across the centre line feel dangerous.
    v.oncoming = track.preset.laneCount > 2 && rng() < 0.34;

    const lanes = v.oncoming ? track.oncomingLanes : track.forwardLanes;
    v.lane = pick(rng, lanes);
    v.lateral = track.laneCentre(v.lane);
    v.targetLateral = v.lateral;

    const [lo, hi] = this.speedRange;
    v.targetSpeed = rand(rng, lo, hi) * (v.shape.name === 'bus' ? 0.8 : 1);
    v.speed = v.targetSpeed;
    v.laneTimer = rand(rng, 4, 16);
    v.braking = false;
    v.nearMissed = false;

    // Spread the initial fill both sides of the rider, but never inside the
    // clear zone — starting the race already touching a bus is not a race.
    // Later respawns always appear far enough ahead that nobody sees them pop in.
    const CLEAR = 60;
    let ahead;
    if (initial) {
      ahead = rand(rng, -140, 420 - CLEAR * 2);
      if (ahead > -CLEAR) ahead += CLEAR * 2;
    } else {
      ahead = rand(rng, 260, 620);
    }
    v.s = playerS + (v.oncoming ? Math.max(ahead, 220) : ahead);

    if (v.s < 10 || v.s > track.length - 10) {   // outside the built road
      v.active = false;
      v.group.visible = false;
      return;
    }

    v.active = true;
    v.group.visible = true;
  }

  /* ----------------------------------------------------------------
     Update
     ---------------------------------------------------------------- */

  /**
   * @param player      the BikePhysics instance
   * @param dt          frame delta
   * @param onCollision called with (vehicle, closingSpeed) on contact
   * @param onNearMiss  called once per vehicle when it is squeezed past
   */
  update(player, dt, onCollision, onNearMiss) {
    const track = this.track;
    const playerS = player.s;

    for (const v of this.vehicles) {
      if (!v.active) {
        this._spawn(v, playerS);
        continue;
      }

      // ---- longitudinal AI ----
      const ahead = this._vehicleAhead(v);
      let desired = v.targetSpeed;
      if (ahead) {
        const gap = Math.abs(ahead.s - v.s) - (v.shape.length + ahead.shape.length) / 2;
        // Two-second rule, roughly. Inside that, match speed; inside a third
        // of it, brake hard.
        const safeGap = Math.max(8, v.speed * 2);
        if (gap < safeGap) {
          desired = lerp(ahead.speed * 0.92, v.targetSpeed, clamp(gap / safeGap, 0, 1));
        }
        if (gap < safeGap * 0.35) desired = Math.min(desired, ahead.speed * 0.7);
      }
      v.braking = desired < v.speed - 0.6;
      v.speed = damp(v.speed, Math.max(0, desired), 0.06, dt);

      // ---- lane changes ----
      v.laneTimer -= dt;
      if (v.laneTimer <= 0) {
        v.laneTimer = rand(this.rng, 6, 20);
        const lanes = v.oncoming ? track.oncomingLanes : track.forwardLanes;
        if (lanes.length > 1 && this.rng() < 0.45) {
          const next = pick(this.rng, lanes);
          if (next !== v.lane && this._laneClear(v, next)) {
            v.lane = next;
            v.targetLateral = track.laneCentre(next);
          }
        }
      }
      v.lateral = damp(v.lateral, v.targetLateral, 0.02, dt);

      // ---- integrate ----
      v.s += v.speed * dt * (v.oncoming ? -1 : 1);

      // ---- recycle ----
      const rel = v.s - playerS;
      const tooFar = v.oncoming ? rel < -90 : (rel < -160 || rel > 900);
      if (tooFar || v.s < 4 || v.s > track.length - 4) {
        this._spawn(v, playerS);
        continue;
      }

      // ---- place in the world ----
      track.sample(v.s, this._c);
      const c = this._c;
      const cosH = Math.cos(c.heading);
      const sinH = Math.sin(c.heading);
      v.group.position.set(
        c.x + cosH * v.lateral,
        c.y + Math.sin(c.camber) * v.lateral,
        c.z - sinH * v.lateral,
      );
      v.group.rotation.set(
        -c.pitch * (v.oncoming ? -1 : 1),
        c.heading + (v.oncoming ? Math.PI : 0),
        c.camber * (v.oncoming ? -1 : 1),
        'YXZ',
      );

      // ---- collision with the player ----
      if (!player.crashed) {
        const ds = Math.abs(v.s - playerS);
        const dl = Math.abs(v.lateral - player.lateral);
        const hitLong = (v.shape.length + 2.1) / 2;
        const hitLat = (v.shape.width + 0.78) / 2;
        if (ds < hitLong && dl < hitLat) {
          const closing = v.oncoming
            ? player.speed + v.speed
            : Math.abs(player.speed - v.speed);
          onCollision?.(v, closing);
        } else if (
          !v.nearMissed &&
          player.speed > 18 &&
          ds < hitLong + 2.0 &&
          dl < hitLat + 1.1
        ) {
          // Squeezing past counts once per vehicle; the flag resets when the
          // vehicle is recycled back onto the road ahead.
          v.nearMissed = true;
          onNearMiss?.(v);
        }
      }
    }
  }

  /** Nearest vehicle in front of `v` in the same lane and direction. */
  _vehicleAhead(v) {
    let best = null;
    let bestGap = Infinity;
    for (const o of this.vehicles) {
      if (o === v || !o.active || o.oncoming !== v.oncoming || o.lane !== v.lane) continue;
      const rel = v.oncoming ? v.s - o.s : o.s - v.s;
      if (rel > 0 && rel < bestGap) { bestGap = rel; best = o; }
    }
    return bestGap < 200 ? best : null;
  }

  /** True when `lane` has room for `v` to move into it. */
  _laneClear(v, lane) {
    for (const o of this.vehicles) {
      if (o === v || !o.active || o.lane !== lane || o.oncoming !== v.oncoming) continue;
      if (Math.abs(o.s - v.s) < 22) return false;
    }
    return true;
  }

  /** Track-space positions of active vehicles, for the minimap. */
  forEachActive(fn) {
    for (const v of this.vehicles) {
      if (v.active) fn(v);
    }
  }

  dispose() {
    this.scene.remove(this.group);
    for (const d of this.disposables) d.dispose?.();
    this.disposables.length = 0;
    this.group.clear();
  }
}
