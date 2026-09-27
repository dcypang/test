// ---------------------------------------------------------------------------
// ai.js - two drivers.
//
// RacingDriver follows the pre-computed racing line, brakes for corners from
// the line's speed profile, and steps around slower cars.
// TrafficDriver keeps to its lane on public roads, obeys traffic lights and
// leaves a gap to the car in front.
// ---------------------------------------------------------------------------

// Walk a spline index forward/backward to the nearest sample near `hint`.
function nearestIndex(spline, x, z, hint, window = 30) {
  const n = spline.count;
  let best = hint, bestD = Infinity;
  for (let k = -window; k <= window; k++) {
    const i = spline.closed
      ? ((hint + k) % n + n) % n
      : clamp(hint + k, 0, n - 1);
    const p = spline.points[i];
    const d = (p[0] - x) * (p[0] - x) + (p[2] - z) * (p[2] - z);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

class RacingDriver {
  constructor(car, line, skill = 0.9) {
    this.car = car;
    this.line = line;
    this.skill = skill;
    this.index = 0;
    this.lateralBias = 0;
    this.targetBias = 0;
    this.mistakeTimer = rnd(4, 22);
    this.mistake = 0;
    this.mistakeHold = 0;
    this.reactTimer = 0;
    this.stuckTimer = 0;
    this.recovering = 0;
  }

  update(dt, cars, world) {
    const car = this.car;
    const v = car.vehicle;
    const line = this.line;
    const n = line.count;

    // A car that has been thrown off can end up nearer a completely different
    // part of the lap than the one it was following. A narrow search would keep
    // aiming it at the old section and drive it in circles through a field, so
    // re-localise across the whole line once we are clearly lost.
    this.index = nearestIndex(line, v.pos[0], v.pos[2], this.index, 24);
    {
      const p = line.points[this.index];
      if (Math.hypot(v.pos[0] - p[0], v.pos[2] - p[2]) > 25) {
        this.index = nearestIndex(line, v.pos[0], v.pos[2], this.index, line.count >> 1);
      }
    }

    // Occasional imperfection so the field is not robotic.
    this.mistakeTimer -= dt;
    if (this.mistakeTimer <= 0) {
      // A quick driver makes fewer errors and smaller ones, and leaves longer
      // between them.
      this.mistakeTimer = rnd(6, 26) * lerp(1.0, 2.4, this.skill);
      this.mistake = Math.pow(1 - this.skill, 1.4) * rnd(0.2, 1.0);
      this.mistakeHold = rnd(0.6, 1.5) * lerp(1.0, 0.55, this.skill);
    }
    if (this.mistakeHold > 0) {
      this.mistakeHold -= dt;
      if (this.mistakeHold <= 0) this.mistake = 0;
    }

    // --- where to aim ---------------------------------------------------------
    const speed = v.speed;
    // A shorter lookahead tracks the line tightly; too long and the car drifts
    // wide and starts to oscillate.
    const lookDist = clamp(6.5 + speed * 0.42, 8, 32);
    const spacing = line.length / n;
    const lookAhead = Math.max(2, Math.round(lookDist / spacing));

    // How far the car is from its line - used to slow down when recovering.
    const here = line.points[this.index];
    const offLine = Math.hypot(v.pos[0] - here[0], v.pos[2] - here[2]);
    const aimIdx = (this.index + lookAhead) % n;
    const aim = line.points[aimIdx];
    const aimNormal = line.normals[aimIdx];

    // --- avoid the car in front ----------------------------------------------
    this.targetBias *= 0.94;
    let blockedSpeed = Infinity;
    const fwd = car.forward();
    for (const other of cars) {
      if (other === car) continue;
      const dx = other.pos[0] - v.pos[0];
      const dz = other.pos[2] - v.pos[2];
      const dist = Math.hypot(dx, dz);
      if (dist > 26 || dist < 0.01) continue;
      const ahead = (dx * fwd[0] + dz * fwd[2]) / dist;
      if (ahead < 0.72) continue;
      const lateral = dx * -fwd[2] + dz * fwd[0];
      if (Math.abs(lateral) > 3.0) continue;
      // Pick the side with more room and commit to it.
      const side = Math.abs(lateral) < 0.4 ? (this.index % 2 === 0 ? 1 : -1) : -sign(lateral);
      const urgency = clamp((26 - dist) / 26, 0, 1);
      this.targetBias = clamp(this.targetBias + side * urgency * 2.6, -3.6, 3.6);
      if (dist < 12) blockedSpeed = Math.min(blockedSpeed, other.vehicle.speed + (dist - 5) * 0.8);
    }
    this.lateralBias = lerp(this.lateralBias, this.targetBias, clamp(dt * 3.0, 0, 1));

    const aimX = aim[0] + aimNormal[0] * this.lateralBias;
    const aimZ = aim[2] + aimNormal[2] * this.lateralBias;

    // --- steering ---------------------------------------------------------------
    // Curvature feed-forward plus feedback on heading and cross-track error.
    //
    // The feed-forward is the important half. A purely geometric controller
    // (pure pursuit, or a gain on heading error) has to let an error build up
    // before it steers at all, and at racing speed the error it needs is wider
    // than the road. Steering the corner's own curvature up front means the
    // feedback only ever has to trim.
    //
    // `kUnderSteer` is this car's measured understeer gradient: the extra lock
    // it needs per unit of lateral acceleration on top of the kinematic angle.
    // Leave it out and the car runs wide through every fast corner.
    //
    // It is a property of the car, so it has to be re-measured whenever the car
    // changes. Resizing the steering rack moved it from 0.0026 to 0.0065, and
    // until it was re-fitted the field spent a fifth of the lap in the gravel
    // while every steering-feel number looked fine.
    const kUnderSteer = 0.0065;
    const ffLead = Math.max(1, Math.round(lookDist * 0.5 / spacing));
    const ffIdx = ((this.index + ffLead) % n + n) % n;
    // splineCurvature is positive turning left; positive steering is right.
    const kappa = -splineCurvature(line, ffIdx);
    let desiredAngle = kappa * v.wheelbase + kUnderSteer * kappa * speed * speed;

    // Heading error against the line's own tangent.
    const tanHere = line.tangents[this.index];
    const headingErr = wrapAngle(Math.atan2(tanHere[0], tanHere[2]) - v.yaw);
    desiredAngle += headingErr * 0.55;

    // Cross-track error, softened by speed so it stays gentle at 200 km/h and
    // still has authority at walking pace.
    const nrmHere = line.normals[this.index];
    const crossTrack = (v.pos[0] - here[0]) * nrmHere[0] + (v.pos[2] - here[2]) * nrmHere[2];
    desiredAngle += clamp(Math.atan2(-crossTrack * 0.9, 9 + speed), -0.09, 0.09);

    // Kept for the recovery logic below: heading error toward the aim point.
    const err = wrapAngle(Math.atan2(aimX - v.pos[0], aimZ - v.pos[2]) - v.yaw);

    // Counter-steer into a slide. Even a clumsy driver catches slides - what
    // separates them is corner speed and consistency, not whether they know
    // which way to turn - so this keeps a floor independent of skill.
    const local = v.toLocal(v.vel);
    const beta = speed > 3 ? Math.atan2(local[0], Math.abs(local[2])) : 0;
    desiredAngle += beta * (0.36 + 0.24 * this.skill);

    // A little yaw damping settles the last of the weave.
    desiredAngle -= v.yawRate * 0.03;

    // Never ask for more lock than the tyres can convert into cornering. Past
    // that angle the front simply slides, the car runs wide, and the controller
    // asks for even more - the classic AI death spiral. At 200 km/h the useful
    // maximum is only about a degree.
    const aeroFactor = 1 + 0.5 * AIR_DENSITY * 2.55 * speed * speed / (CAR_SPEC.mass * GRAVITY);
    const aMax = GRAVITY * 1.5 * aeroFactor;
    // ...and never more than the rack can actually give. The steering lock is
    // sized against the grip available at the current speed, so asking beyond
    // it does not just waste the request: the division below saturates, every
    // feedback term in this controller loses its authority at once, and the
    // car tracks the line with an on/off switch. That is not a hypothetical -
    // it put the field 19% off track the first time the rack was resized.
    const maxUseful = Math.min(
      Math.atan(v.wheelbase * aMax / Math.max(speed * speed, 25)),
      v.maxSteerAngle());

    // Imperfection is scaled against the lock that is actually usable, so a
    // slower driver wanders a little rather than being thrown off the road.
    desiredAngle += this.mistake * Math.sin(this.mistakeTimer * 7) * maxUseful * 0.10;
    desiredAngle = clamp(desiredAngle, -maxUseful, maxUseful);

    v.steerInput = clamp(desiredAngle / v.maxSteerAngle(), -1, 1);

    // --- speed -----------------------------------------------------------------
    const brakeLook = Math.max(3, Math.round((14 + speed * 1.35) / spacing));
    let target = Infinity;
    for (let k = 0; k <= brakeLook; k++) {
      const i = (this.index + k) % n;
      const distAhead = k * spacing;
      // How fast we can be here and still make the corner ahead.
      const allowed = Math.sqrt(Math.max(0, line.speeds[i] * line.speeds[i] + 2 * 11.5 * distAhead));
      target = Math.min(target, allowed);
    }
    // The pace fraction is well under 1 because the speed profile is a static
    // per-corner upper bound: it takes no account of having to change direction
    // between corners, or of the car arriving slightly off line. Push it too
    // far and the AI gets slower, not faster, because it spends the difference
    // sliding. Swept on this circuit with the harness seeded: 0.79 is the last
    // value that gains, and by 0.82 the field is 23% off track and four
    // seconds a lap slower. 0.78 sits just inside that cliff.
    target *= lerp(0.52, 0.78, this.skill) * (1 - this.mistake * 0.22);
    target = Math.min(target, blockedSpeed);

    // If the car has been thrown well off the line, rejoin calmly instead of
    // trying to keep corner speed while pointing at a hedge. The threshold has
    // to sit outside normal tracking error, and the ramp has to be gradual:
    // a step change here shows up as a panic stab of brake mid-corner.
    if (offLine > 15) target = Math.min(target, Math.max(11, 42 - (offLine - 15) * 1.1));

    const err2 = target - speed;
    let wantThrottle = 0, wantBrake = 0;
    if (err2 > 0.6) {
      wantThrottle = clamp(err2 * lerp(0.35, 0.55, this.skill), 0, 1);
    } else if (err2 < -0.6) {
      wantBrake = clamp(-err2 * 0.24, 0, 1);
    } else {
      wantThrottle = clamp(0.25 + err2 * 0.2, 0, lerp(0.5, 0.75, this.skill));
    }
    // Roll onto the pedals rather than stamping on them: an instant jump from
    // no brake to full brake mid-corner unloads the rear and spins the car. A
    // quicker driver rolls on faster, but still rolls.
    v.throttle = approach(v.throttle, wantThrottle, dt * lerp(6.0, 9.0, this.skill));
    v.brake = approach(v.brake, wantBrake, dt * lerp(3.6, 5.2, this.skill));

    // Braking hard while the wheel is turned is how you spin a rear-drive car.
    // Trade one against the other the way a real driver does.
    const lock = Math.abs(v.steerInput);
    if (lock > 0.25) v.brake *= clamp(1.25 - lock * 1.05, 0.25, 1);
    if (v.brake > 0.7) v.steerInput *= clamp(1.35 - v.brake * 0.55, 0.55, 1);
    // Feed the power in gently on corner exit rather than snapping to full.
    if (lock > 0.35 && speed > 12) v.throttle *= clamp(1.35 - lock * 0.75, 0.45, 1);

    // Understeer response. Past roughly 9 degrees of front slip the tyre is
    // over the peak of its curve, so more lock makes it worse - lift, add a
    // dab of brake, and unwind until the front bites again.
    // Understeer response. Once the front is past the peak of its slip curve
    // more lock only makes it worse, so lift, add a dab of brake, and unwind
    // until the front bites again. Reacting slightly before the true peak is
    // deliberate: by the time the peak is obvious the car is already wide.
    const frontSlip = (Math.abs(v.wheels[FL].slipAngle) + Math.abs(v.wheels[FR].slipAngle)) * 0.5;
    if (frontSlip > 0.16 && speed > 10) {
      const excess = frontSlip - 0.16;
      v.throttle *= clamp(1 - excess * 6, 0.1, 1);
      v.brake = Math.max(v.brake, clamp(excess * 1.6, 0, 0.4));
      v.steerInput *= clamp(1 - excess * 2.4, 0.35, 1);
    }

    // --- recovery ---------------------------------------------------------------
    const surf = world.sampleSurface(v.pos[0], v.pos[2]);
    if (speed < 2.2 && !car.finished) this.stuckTimer += dt; else this.stuckTimer = 0;
    if (this.stuckTimer > 2.5 && this.recovering <= 0) this.recovering = 1.4;

    if (this.recovering > 0) {
      // Back up, turned toward the line, then try again.
      this.recovering -= dt;
      v.reverseRequest = true;
      v.throttle = 0.5;
      v.brake = 0;
      v.steerInput = -clamp(err * 1.5, -1, 1);
      if (this.recovering <= 0) { v.reverseRequest = false; this.stuckTimer = 0; }
    } else {
      v.reverseRequest = false;
      if (!surf.onRoad) v.throttle *= 0.6;    // gather it up off track
    }

    // Last resort: a car that has been beached for a long time is placed back
    // on the racing line facing the right way, the way a marshal would.
    if (this.stuckTimer > 6 || offLine > 42) {
      const idx = this.index;
      const p = line.points[idx];
      const t = line.tangents[idx];
      v.setPose(p[0], p[2], Math.atan2(t[0], t[2]), world.groundHeight(p[0], p[2]));
      v.gear = GEAR_FIRST;
      this.stuckTimer = 0;
      this.recovering = 0;
    }

    v.handbrake = 0;
  }
}

// --- traffic ----------------------------------------------------------------

class TrafficDriver {
  constructor(car, path, direction, laneOffset, speedLimit) {
    this.car = car;
    this.path = path;
    this.direction = direction;         // +1 forward along the spline, -1 back
    this.laneOffset = laneOffset;       // signed lateral offset for its lane
    this.speedLimit = speedLimit;
    this.index = 0;
    this.done = false;
    this.stopTimer = 0;
    this.hornCooldown = 0;
  }

  placeAt(index, world) {
    const sp = this.path.spline;
    const i = clamp(index, 0, sp.count - 1);
    this.index = i;
    const p = sp.points[i], n = sp.normals[i], t = sp.tangents[i];
    const x = p[0] + n[0] * this.laneOffset;
    const z = p[2] + n[2] * this.laneOffset;
    const yaw = Math.atan2(t[0] * this.direction, t[2] * this.direction);
    this.car.setPose(x, z, yaw, world);
    this.car.vehicle.gear = GEAR_FIRST;
  }

  update(dt, world, obstacles, lights) {
    const car = this.car;
    const v = car.vehicle;
    const sp = this.path.spline;
    const n = sp.count;
    const dir = this.direction;

    this.index = nearestIndex(sp, v.pos[0], v.pos[2], this.index, 20);
    if ((dir > 0 && this.index >= n - 3) || (dir < 0 && this.index <= 2)) {
      this.done = true;
      return;
    }

    const spacing = sp.length / n;
    const speed = v.speed;
    const lookAhead = Math.max(2, Math.round(clamp(6 + speed * 0.55, 7, 32) / spacing));
    const aimIdx = clamp(this.index + lookAhead * dir, 0, n - 1);
    const aim = sp.points[aimIdx], aimN = sp.normals[aimIdx];
    const aimX = aim[0] + aimN[0] * this.laneOffset;
    const aimZ = aim[2] + aimN[2] * this.laneOffset;

    const desiredYaw = Math.atan2((aimX - v.pos[0]) * 1, (aimZ - v.pos[2]) * 1);
    const err = wrapAngle(desiredYaw - v.yaw);
    v.steerInput = clamp(err * 1.9, -1, 1);

    // Corner speed from the local curvature.
    let target = this.speedLimit / 3.6;
    for (let k = 0; k < lookAhead + 6; k++) {
      const i = clamp(this.index + k * dir, 0, n - 1);
      const curv = Math.abs(splineCurvature(sp, i)) + 1e-5;
      const cornerV = Math.sqrt(0.35 * GRAVITY / curv);
      const distAhead = k * spacing;
      target = Math.min(target, Math.sqrt(Math.max(0, cornerV * cornerV + 2 * 3.0 * distAhead)));
    }

    // Traffic lights.
    if (lights) {
      const fwd = car.forward();
      for (const light of lights) {
        if (light.state === 'green') continue;
        const dx = light.pos[0] - v.pos[0], dz = light.pos[2] - v.pos[2];
        const dist = Math.hypot(dx, dz);
        if (dist > 60) continue;
        const ahead = (dx * fwd[0] + dz * fwd[2]);
        if (ahead < 4) continue;
        const stopDist = Math.max(0, ahead - 7);
        const allowed = Math.sqrt(Math.max(0, 2 * 3.2 * stopDist));
        target = Math.min(target, allowed);
      }
    }

    // Car in front.
    const fwd = car.forward();
    for (const other of obstacles) {
      if (other === car) continue;
      const dx = other.pos[0] - v.pos[0], dz = other.pos[2] - v.pos[2];
      const dist = Math.hypot(dx, dz);
      if (dist > 34 || dist < 0.01) continue;
      const ahead = (dx * fwd[0] + dz * fwd[2]) / dist;
      if (ahead < 0.80) continue;
      const lateral = Math.abs(dx * -fwd[2] + dz * fwd[0]);
      if (lateral > 2.6) continue;
      const gap = Math.max(0, dist - 7.5);
      const otherSpeed = other.vehicle ? other.vehicle.speed : 0;
      target = Math.min(target, Math.sqrt(Math.max(0, otherSpeed * otherSpeed + 2 * 2.6 * gap)));
    }

    const err2 = target - speed;
    if (err2 > 0.4) {
      v.throttle = clamp(err2 * 0.30, 0, 0.75);
      v.brake = 0;
    } else if (err2 < -0.3) {
      v.throttle = 0;
      v.brake = clamp(-err2 * 0.30, 0, 1);
    } else {
      v.throttle = clamp(0.18 + err2 * 0.2, 0, 0.4);
      v.brake = 0;
    }
    if (target < 0.6) { v.brake = 1; v.throttle = 0; }

    car.brakeGlow = lerp(car.brakeGlow, v.brake > 0.05 ? 1 : 0, clamp(dt * 12, 0, 1));
    v.handbrake = 0;
  }
}

// Traffic light controller: a simple two-phase cycle shared by every junction.
class TrafficLightSystem {
  constructor(lights) {
    this.lights = lights;
    this.cycle = 22;
    for (const l of lights) {
      l.timer = l.phase || 0;
      l.state = 'green';
    }
  }

  update(dt) {
    for (const l of this.lights) {
      l.timer = (l.timer + dt) % this.cycle;
      const t = l.timer;
      if (t < 12) l.state = 'green';
      else if (t < 14.4) l.state = 'amber';
      else l.state = 'red';
    }
  }

  // Glow colours for the three lamps of one head.
  static lampColors(state) {
    return [
      state === 'red' ? [1.0, 0.10, 0.05] : [0.16, 0.02, 0.02],
      state === 'amber' ? [1.0, 0.62, 0.05] : [0.16, 0.10, 0.02],
      state === 'green' ? [0.15, 1.0, 0.35] : [0.02, 0.14, 0.05],
    ];
  }
}
