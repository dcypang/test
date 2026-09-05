// ---------------------------------------------------------------------------
// car.js - a drivable car: physics body + visuals + the effects it throws off
// (tyre smoke, dust, skid marks, brake glow, exhaust flames, lights).
// ---------------------------------------------------------------------------

const LIVERY_PRESETS = [
  { paint: [0.72, 0.06, 0.07], stripe: [0.95, 0.95, 0.93], style: 0, name: 'Rosso 7' },
  { paint: [0.05, 0.16, 0.52], stripe: [0.98, 0.78, 0.10], style: 1, name: 'Blu Corsa' },
  { paint: [0.93, 0.93, 0.94], stripe: [0.15, 0.16, 0.20], style: 2, name: 'Bianco' },
  { paint: [0.04, 0.05, 0.07], stripe: [0.85, 0.62, 0.08], style: 3, name: 'Nero' },
  { paint: [0.06, 0.36, 0.16], stripe: [0.92, 0.92, 0.90], style: 1, name: 'Verde' },
  { paint: [0.95, 0.55, 0.03], stripe: [0.10, 0.10, 0.12], style: 0, name: 'Arancio' },
  { paint: [0.55, 0.56, 0.60], stripe: [0.70, 0.05, 0.05], style: 2, name: 'Argento' },
  { paint: [0.35, 0.07, 0.42], stripe: [0.95, 0.90, 0.20], style: 3, name: 'Viola' },
  { paint: [0.02, 0.45, 0.50], stripe: [0.96, 0.96, 0.94], style: 1, name: 'Teal' },
  { paint: [0.86, 0.80, 0.10], stripe: [0.10, 0.10, 0.12], style: 0, name: 'Giallo' },
  { paint: [0.62, 0.20, 0.30], stripe: [0.95, 0.95, 0.93], style: 2, name: 'Bordeaux' },
  { paint: [0.14, 0.14, 0.16], stripe: [0.20, 0.60, 0.95], style: 1, name: 'Notte' },
];

// Rim turns per unit of road-wheel angle. With 0.60 rad of lock that is a shade
// over a turn and a half hand to hand, which is what a GT car feels like.
const WHEEL_RATIO = 3.2;
// Revs at which the first shift light comes up.
const SHIFT_LIGHT_FROM = 5800;
// Shoulder sockets, matching the spheres in the driver mesh.
const SHOULDER_LOCAL = [SEAT_X - 0.205, 0.965, -0.40];
const UPPER_ARM_LEN = 0.30;
const FOREARM_LEN = 0.32;
// A driver's arms are nearly straight at this reach, and a straight arm reads
// as a broomstick. Carrying the elbows this much further out and down is what
// real drivers do anyway, and it gives the arm a silhouette.
const ELBOW_BEND = 0.11;

// Two-bone IK: given a shoulder and a hand, find the elbow. The arm is a
// triangle with two known sides, so the elbow is somewhere on a circle; `hint`
// picks which point on it, and for a driver that is down and outboard.
function solveElbow(out, shoulder, hand, lu, lf, hint) {
  const d = v3.sub([0, 0, 0], hand, shoulder);
  const dist = v3.len(d);
  if (dist < 1e-4) { out[0] = shoulder[0]; out[1] = shoulder[1]; out[2] = shoulder[2]; return out; }
  const u = v3.scale([0, 0, 0], d, 1 / dist);
  // Out of reach: straighten the arm and let the bones stretch to cover it.
  const a = Math.min(dist, (dist * dist + lu * lu - lf * lf) / (2 * dist));
  const h = Math.sqrt(Math.max(0, lu * lu - a * a)) + ELBOW_BEND;
  let w = v3.sub([0, 0, 0], hint, v3.scale([0, 0, 0], u, v3.dot(hint, u)));
  if (v3.len(w) < 1e-5) w = [0, -1, 0];
  else v3.norm(w, w);
  out[0] = shoulder[0] + u[0] * a + w[0] * h;
  out[1] = shoulder[1] + u[1] * a + w[1] * h;
  out[2] = shoulder[2] + u[2] * a + w[2] * h;
  return out;
}

// Point a unit-length +Z bone from `from` to `to`, stretched to fit.
function boneMatrix(out, from, to) {
  const d = v3.sub([0, 0, 0], to, from);
  const len = Math.max(v3.len(d), 1e-4);
  const yaw = Math.atan2(d[0], d[2]);
  const pitch = -Math.asin(clamp(d[1] / len, -1, 1));
  return m4.compose(out, from, yaw, pitch, 0, 1, 1, len);
}

class Car {
  constructor(meshes, options = {}) {
    this.meshes = meshes;
    this.vehicle = new Vehicle(options);
    this.livery = options.livery || LIVERY_PRESETS[0];
    this.number = options.number !== undefined ? options.number : 7;
    this.name = options.name || this.livery.name;
    this.isPlayer = !!options.isPlayer;
    // Its own plate, built as its own mesh: the body mesh is shared by every
    // car on the road, so a number that differs from car to car cannot live in
    // it. One extra draw call each, a few hundred triangles.
    this.plate = options.plate || null;
    this.plateMesh = options.plateMesh || null;
    this.dirt = 0;
    this.damage = 0;
    this.headlightsOn = false;
    this.brakeGlow = 0;
    this.reverseLight = 0;
    this.indicator = 0;          // -1 left, 0 off, 1 right
    this.indicatorPhase = 0;
    this.lastSkid = [null, null, null, null];
    this.smokeTimer = 0;
    this.exhaustTimer = 0;
    this.bodyMatrix = m4.create();
    this.tmp = m4.create();
    this.tmp2 = m4.create();

    // Race bookkeeping.
    this.lap = 0;
    this.lapStart = 0;
    this.lastLapTime = 0;
    this.bestLapTime = 0;
    this.lapTimes = [];
    this.progress = 0;
    this.totalProgress = 0;
    this.position = 1;
    this.finished = false;
    this.finishTime = 0;
  }

  get pos() { return this.vehicle.pos; }
  get yaw() { return this.vehicle.yaw; }
  get speed() { return this.vehicle.speed; }

  setPose(x, z, yaw, world) {
    const y = world ? world.groundHeight(x, z) : 0;
    this.vehicle.setPose(x, z, yaw, y);
    this.teleported();
  }

  // Same, but the car keeps moving. Used where the drive home hands over from
  // one world to the next.
  rebase(x, z, yaw, world) {
    const y = world ? world.groundHeight(x, z) : 0;
    this.vehicle.rebase(x, z, yaw, y);
    this.teleported();
  }

  // Anything that moves the car without driving it there has to say so. The
  // scenery sweep traces the segment from last frame's position, and after a
  // jump that segment crosses the whole map - so the car gets rewound to the
  // first wall between where it was and where it was put.
  teleported() {
    this.lastSkid = [null, null, null, null];
    if (!this.prevPos) this.prevPos = [0, 0, 0];
    this.prevPos[0] = this.pos[0];
    this.prevPos[1] = this.pos[1];
    this.prevPos[2] = this.pos[2];
  }

  // Forward vector in world space.
  forward(out = [0, 0, 0]) {
    out[0] = Math.sin(this.vehicle.yaw); out[1] = 0; out[2] = Math.cos(this.vehicle.yaw);
    return out;
  }

  right(out = [0, 0, 0]) {
    out[0] = Math.cos(this.vehicle.yaw); out[1] = 0; out[2] = -Math.sin(this.vehicle.yaw);
    return out;
  }

  // A point on the car in world space, given local coordinates.
  localToWorld(local, out = [0, 0, 0]) {
    const v = this.vehicle;
    const c = Math.cos(v.yaw), s = Math.sin(v.yaw);
    const y = local[1] - this.bodyDrop();
    out[0] = v.pos[0] + local[0] * c + local[2] * s;
    out[1] = v.pos[1] + y;
    out[2] = v.pos[2] - local[0] * s + local[2] * c;
    return out;
  }

  bodyDrop() {
    const w = this.vehicle.wheels;
    return (w[0].compression + w[1].compression + w[2].compression + w[3].compression) / 4;
  }

  update(dt, world, renderer) {
    const v = this.vehicle;
    v.update(dt, world);

    // Lights.
    this.brakeGlow = lerp(this.brakeGlow, v.brake > 0.04 ? 1 : 0, clamp(dt * 14, 0, 1));
    this.reverseLight = lerp(this.reverseLight, v.gear === GEAR_REVERSE ? 1 : 0, clamp(dt * 10, 0, 1));
    if (this.indicator !== 0) this.indicatorPhase += dt * 3.2;
    else this.indicatorPhase = 0;

    if (renderer) this.emitEffects(dt, world, renderer);
  }

  emitEffects(dt, world, renderer) {
    const v = this.vehicle;
    const speed = v.speed;

    for (let i = 0; i < 4; i++) {
      const w = v.wheels[i];
      if (!w.contact) { this.lastSkid[i] = null; continue; }

      const cx = w.worldPos[0], cz = w.worldPos[2], cy = w.groundY + 0.012;
      const slipping = w.slipSpeed;
      const dust = w.surface.dust;

      // Skid marks on hard surfaces once the tyre is really scrubbing.
      if (dust === 0 && slipping > 4.2 && speed > 2.5) {
        const prev = this.lastSkid[i];
        const alpha = clamp((slipping - 4.0) / 12, 0.06, 0.55);
        if (prev) {
          const d = Math.hypot(cx - prev[0], cz - prev[2]);
          if (d > 0.22) {
            const dx = (cx - prev[0]) / d, dz = (cz - prev[2]) / d;
            renderer.addSkidQuad(prev[0], prev[1], prev[2], cx, cy, cz, w.width * 0.42, dx, dz, alpha);
            this.lastSkid[i] = [cx, cy, cz];
          }
        } else {
          this.lastSkid[i] = [cx, cy, cz];
        }
      } else {
        this.lastSkid[i] = null;
      }

      if (!renderer.settings.particles) continue;

      // Tyre smoke.
      if (dust === 0 && slipping > 7 && Math.random() < clamp(slipping / 26, 0, 0.85)) {
        renderer.spawnParticle(
          [cx + rnd(-0.1, 0.1), cy + 0.10, cz + rnd(-0.1, 0.1)],
          [rnd(-0.6, 0.6) - v.vel[0] * 0.08, rnd(0.4, 1.2), rnd(-0.6, 0.6) - v.vel[2] * 0.08],
          { life: rnd(0.9, 1.7), size: 0.34, grow: 3.4, tint: [0.60, 0.60, 0.62], alpha: 0.16, drag: 1.1, gravity: 0.35 });
      }
      // Dust and gravel spray off the racing surface.
      if (dust > 0 && speed > 3 && Math.random() < clamp(speed / 30, 0, 0.9)) {
        const tint = dust > 1 ? [0.52, 0.45, 0.34] : [0.42, 0.44, 0.28];
        renderer.spawnParticle(
          [cx + rnd(-0.15, 0.15), cy + 0.08, cz + rnd(-0.15, 0.15)],
          [rnd(-1.2, 1.2) - v.vel[0] * 0.18, rnd(0.8, 2.2), rnd(-1.2, 1.2) - v.vel[2] * 0.18],
          { life: rnd(0.8, 1.8), size: 0.26, grow: 3.0, tint, alpha: 0.22, drag: 1.4, gravity: 0.2 });
        this.dirt = Math.min(1, this.dirt + dt * 0.35);
      }
    }

    // Exhaust: a puff on overrun, a flame on a hard downshift.
    this.exhaustTimer -= dt;
    if (this.exhaustTimer <= 0) {
      this.exhaustTimer = 0.05;
      const overrun = v.throttle < 0.06 && v.rpm > 4200 && speed > 8;
      if (overrun && Math.random() < 0.35) {
        for (const sx of [-0.30, 0.30]) {
          const p = this.localToWorld([sx, 0.30, -2.40]);
          renderer.spawnParticle(p, [rnd(-0.3, 0.3) - v.vel[0] * 0.3, rnd(0.2, 0.7), rnd(-0.3, 0.3) - v.vel[2] * 0.3],
            { life: 0.34, size: 0.10, grow: 3.4, tint: [1.6, 0.55, 0.12], alpha: 0.7, drag: 3.0, gravity: 0.9, additive: true });
        }
      }
      if (v.throttle > 0.7 && v.rpm > 6800 && Math.random() < 0.2) {
        for (const sx of [-0.30, 0.30]) {
          const p = this.localToWorld([sx, 0.30, -2.42]);
          renderer.spawnParticle(p, [0, 0.2, 0],
            { life: 0.10, size: 0.16, grow: 1.6, tint: [2.2, 1.1, 0.4], alpha: 0.9, drag: 4, gravity: 0 });
        }
      }
    }

    // Brake disc glow under heavy braking.
    if (v.brake > 0.55 && speed > 18) {
      for (const w of v.wheels) {
        if (Math.random() > 0.25) continue;
        const p = this.localToWorld([w.x * 0.92, w.radius, w.z]);
        renderer.addGlow(p, [0.9, 0.22, 0.05], 0.26, 0.30 * v.brake);
      }
    }
  }

  // Add the glowing lamps for this car to the renderer.
  submitLights(renderer, night) {
    const v = this.vehicle;
    const showHead = this.headlightsOn;
    if (showHead) {
      for (const sx of [-0.63, 0.63]) {
        const p = this.localToWorld([sx, 0.55, 2.20]);
        renderer.addGlow(p, [1.0, 0.95, 0.82], 0.42, 0.55);
      }
    }
    const brake = this.brakeGlow;
    for (const sx of [-0.62, 0.62]) {
      const p = this.localToWorld([sx, 0.64, -2.34]);
      const on = Math.max(brake, night * 0.45, showHead ? 0.35 : 0);
      if (on > 0.02) renderer.addGlow(p, [1.0, 0.10, 0.06], 0.30 + brake * 0.16, 0.28 * on + brake * 0.35);
    }
    if (brake > 0.2) {
      const p = this.localToWorld([0, 0.74, -2.32]);
      renderer.addGlow(p, [1.0, 0.12, 0.06], 0.20, 0.4 * brake);
    }
    if (this.reverseLight > 0.2) {
      const p = this.localToWorld([0, 0.50, -2.34]);
      renderer.addGlow(p, [0.9, 0.95, 1.0], 0.24, 0.35 * this.reverseLight);
    }
    if (this.indicator !== 0 && Math.sin(this.indicatorPhase * Math.PI) > 0) {
      const sx = this.indicator * 0.66;
      for (const z of [2.16, -2.30]) {
        const p = this.localToWorld([sx, z > 0 ? 0.52 : 0.64, z]);
        renderer.addGlow(p, [1.0, 0.45, 0.03], 0.24, 0.75);
      }
    }
  }

  // Build the model matrices and hand everything to the renderer.
  render(renderer, options = {}) {
    const v = this.vehicle;
    const drop = this.bodyDrop();
    const paintOpts = {
      paint: this.livery.paint,
      stripe: this.livery.stripe,
      livery: this.livery.style,
      dirt: this.dirt,
      roundel: options.roundel !== false,
    };

    m4.compose(this.bodyMatrix, [v.pos[0], v.pos[1] - drop, v.pos[2]], v.yaw, v.pitch, v.roll);
    renderer.submit(this.meshes.body, this.bodyMatrix, paintOpts);
    // Plates ride with the body, and take the same dirt the body does.
    if (this.plateMesh) {
      renderer.submit(this.plateMesh, this.bodyMatrix, { dirt: this.dirt });
    }

    if (!options.hideInterior) {
      renderer.submit(this.meshes.interior, this.bodyMatrix, EMPTY_OPTS);
      // Inside the car the camera is sitting where the head is, so the head
      // comes off; the body, legs and arms all stay.
      const driver = options.inside ? this.meshes.driverNoHead : this.meshes.driver;
      renderer.submit(driver, this.bodyMatrix, EMPTY_OPTS);
      this.renderControls(renderer, options);
    }

    // Wheels.
    for (let i = 0; i < 4; i++) {
      const w = v.wheels[i];
      const localY = w.radius - w.compression + drop;
      const wm = m4.compose(m4.create(), [w.x, localY, w.z], w.steer, 0, 0);
      m4.multiply(wm, this.bodyMatrix, wm);
      const spinM = m4.rotationX(m4.create(), w.spin);
      const full = m4.multiply(m4.create(), wm, spinM);
      renderer.submit(i < 2 ? this.meshes.wheelFront : this.meshes.wheelRear, full, EMPTY_OPTS);
      renderer.submit(i < 2 ? this.meshes.caliperFront : this.meshes.caliperRear, wm, EMPTY_OPTS);
    }

    // Glass last so it blends over everything.
    renderer.submit(this.meshes.glass, this.bodyMatrix, { transparent: true, alpha: 0.92 });
  }

  // The wheel, its shift lights and the driver's arms. Everything here hangs
  // off one matrix, so the hands cannot drift off the rim however far it turns.
  renderControls(renderer, options) {
    const v = this.vehicle;
    const meshes = this.meshes;

    // Wheel, in car-local space first: the arms are rigged against it and that
    // is far easier to reason about before the body transform goes on.
    const local = m4.compose(m4.create(), WHEEL_POS, 0, 0, 0);
    m4.multiply(local, local, m4.rotationX(m4.create(), WHEEL_TILT));
    // Positive steerAngle is a right-hand turn, and from the driver's seat
    // (behind the wheel, looking along +Z) a positive Z rotation reads as
    // clockwise - so no negation. With one, the rim turned left as the car
    // turned right.
    m4.multiply(local, local, m4.rotationZ(m4.create(), v.steerAngle * WHEEL_RATIO));

    const world = m4.multiply(m4.create(), this.bodyMatrix, local);
    renderer.submit(meshes.steering, world, EMPTY_OPTS);

    // Shift lights: one draw per colour band, lit in turn as the revs climb.
    if (meshes.shiftLights) {
      const t = clamp((v.rpm - SHIFT_LIGHT_FROM) / (LIMITER_RPM - SHIFT_LIGHT_FROM), 0, 1);
      // The red pair flashes rather than sitting on, the way a real one nags.
      const flash = v.rpm > LIMITER_RPM - 260 && Math.sin(performance.now() * 0.045) < 0 ? 0.06 : 1;
      for (let b = 0; b < meshes.shiftLights.length; b++) {
        const lit = t > (b + 0.3) / 3;
        const level = !lit ? 0.05 : (b === 2 ? flash : 1);
        renderer.submit(meshes.shiftLights[b], world,
          { emissiveTint: [level, level, level] });
      }
    }

    if (options.hideArms) return;

    // Arms. The hands ride round with the rim and the elbows follow.
    for (const side of [-1, 1]) {
      const a = side > 0 ? GRIP_ANGLE : Math.PI - GRIP_ANGLE;
      const grip = m4.multiply(m4.create(),
        m4.translation(m4.create(), Math.cos(a) * WHEEL_RADIUS, Math.sin(a) * WHEEL_RADIUS, 0),
        m4.rotationZ(m4.create(), a));
      const gloveLocal = m4.multiply(m4.create(), local, grip);
      renderer.submit(side > 0 ? meshes.gloveRight : meshes.gloveLeft,
        m4.multiply(m4.create(), this.bodyMatrix, gloveLocal), EMPTY_OPTS);

      const hand = m4.transformPoint([0, 0, 0], gloveLocal, [0, 0, -0.045]);
      const shoulder = [SHOULDER_LOCAL[0] + (side > 0 ? 0.41 : 0), SHOULDER_LOCAL[1], SHOULDER_LOCAL[2]];
      const elbow = solveElbow([0, 0, 0], shoulder, hand,
        UPPER_ARM_LEN, FOREARM_LEN, [side * 0.75, -0.66, 0]);
      // A shoulder sits beside the eye, so from the seat the upper arm is a
      // slab across the lens. Real drivers see their forearms and nothing else,
      // and so does this camera.
      if (!options.inside) {
        renderer.submit(meshes.upperArm,
          m4.multiply(m4.create(), this.bodyMatrix, boneMatrix(m4.create(), shoulder, elbow)), EMPTY_OPTS);
      }
      renderer.submit(meshes.forearm,
        m4.multiply(m4.create(), this.bodyMatrix, boneMatrix(m4.create(), elbow, hand)), EMPTY_OPTS);
    }
  }
}
