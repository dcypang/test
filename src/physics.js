// ---------------------------------------------------------------------------
// physics.js - vehicle dynamics.
//
// Four wheel model with a simplified Pacejka tyre, longitudinal and lateral
// load transfer, aerodynamic drag and downforce, a real gearbox and per-wheel
// slip ratios integrated through wheel inertia. The substep count adapts to the
// frame time so the tyre model stays stable, and the car handles identically at
// 30 fps on a phone and 144 fps on a desktop.
// ---------------------------------------------------------------------------

const GRAVITY = 9.81;
const AIR_DENSITY = 1.225;

// Wheel indices.
const FL = 0, FR = 1, RL = 2, RR = 3;

const GEAR_RATIOS = [-3.15, 0, 3.42, 2.35, 1.78, 1.42, 1.16, 0.96];
const GEAR_REVERSE = 0;
const GEAR_NEUTRAL = 1;
const GEAR_FIRST = 2;
const FINAL_DRIVE = 3.90;
const DRIVETRAIN_EFFICIENCY = 0.90;
const IDLE_RPM = 950;
const REDLINE_RPM = 7900;
const LIMITER_RPM = 8100;

function engineTorque(rpm) {
  const r = clamp(rpm, 600, LIMITER_RPM);
  const x = r / 1000;
  let t = 300 + 250 * Math.exp(-Math.pow((x - 5.5) / 2.7, 2)) + 28 * Math.sin(x * 0.85);
  if (r > REDLINE_RPM - 300) t *= Math.max(0.0, 1 - (r - (REDLINE_RPM - 300)) / 600);
  if (r < 1400) t *= 0.55 + 0.45 * ((r - 600) / 800);
  return Math.max(t, 0);
}

// Surface presets: how much grip is available and how rough the ride is.
const SURFACES = {
  asphalt: { grip: 1.00, rolling: 0.014, rumble: 0.00, drag: 0.0, dust: 0 },
  kerb: { grip: 0.92, rolling: 0.018, rumble: 0.85, drag: 0.0, dust: 0 },
  grass: { grip: 0.48, rolling: 0.075, rumble: 0.35, drag: 0.6, dust: 1 },
  gravel: { grip: 0.55, rolling: 0.110, rumble: 0.50, drag: 1.2, dust: 2 },
  dirt: { grip: 0.62, rolling: 0.060, rumble: 0.30, drag: 0.4, dust: 2 },
  concrete: { grip: 0.95, rolling: 0.016, rumble: 0.05, drag: 0.0, dust: 0 },
};

class Wheel {
  constructor(x, z, radius, width, steered, driven) {
    this.x = x;             // lateral offset from the centreline (+ right)
    this.z = z;             // longitudinal offset from the CG (+ forward)
    this.radius = radius;
    this.width = width;
    this.steered = steered;
    this.driven = driven;
    this.omega = 0;         // rad/s
    this.steer = 0;         // rad
    this.spin = 0;          // visual rotation
    this.load = 0;          // N
    this.slipRatio = 0;
    this.slipAngle = 0;
    this.fx = 0;
    this.fy = 0;
    this.compression = 0;   // 0..1 for the suspension visual
    this.surface = SURFACES.asphalt;
    this.contact = true;
    this.slipSpeed = 0;     // m/s of contact patch scrub, drives smoke and marks
    this.worldPos = [0, 0, 0];
    this.temperature = 80;  // degC, purely cosmetic but it moves the grip a little
  }
}

class Vehicle {
  constructor(options = {}) {
    const spec = CAR_SPEC;
    this.mass = options.mass || spec.mass;
    this.inertiaYaw = this.mass * 1.72;
    this.wheelbase = spec.wheelbase;
    this.cgHeight = spec.cgHeight;
    this.trackFront = spec.trackFront;
    this.trackRear = spec.trackRear;

    const a = spec.frontAxleZ, b = spec.rearAxleZ;
    this.wheels = [
      new Wheel(-spec.trackFront / 2, a, spec.wheelRadiusFront, spec.wheelWidthFront, true, false),
      new Wheel(spec.trackFront / 2, a, spec.wheelRadiusFront, spec.wheelWidthFront, true, false),
      new Wheel(-spec.trackRear / 2, b, spec.wheelRadiusRear, spec.wheelWidthRear, false, true),
      new Wheel(spec.trackRear / 2, b, spec.wheelRadiusRear, spec.wheelWidthRear, false, true),
    ];
    this.wheelInertia = 1.25;

    // State.
    this.pos = [0, 0, 0];       // CG, y is the ride height above the surface
    this.yaw = 0;
    this.pitch = 0;
    this.roll = 0;
    this.vel = [0, 0, 0];       // world space
    this.yawRate = 0;
    this.vy = 0;
    this.airborne = false;
    this.rideHeight = 0.0;

    // Powertrain.
    this.gear = GEAR_FIRST;
    this.rpm = IDLE_RPM;
    this.clutch = 1;
    this.shiftTimer = 0;
    this.autoGearbox = true;
    this.engineRunning = true;

    // Inputs.
    this.throttle = 0;
    this.brake = 0;
    this.steerInput = 0;
    this.handbrake = 0;
    this.steerAngle = 0;

    // Aero.
    this.dragArea = 1.02;
    this.downforceArea = 2.55;
    this.aeroBalance = 0.44;      // fraction of downforce on the front axle

    // Tyre model.
    this.tyreGrip = options.grip || 1.0;
    this.assists = options.assists !== undefined ? options.assists : true;
    this.absEnabled = true;
    this.tractionControl = true;

    // Derived / telemetry.
    this.speed = 0;
    this.longAccel = 0;
    this.latAccel = 0;
    this.wheelSlipMax = 0;
    this.odometer = 0;
    this.engineLoad = 0;
    this.lastShiftDir = 0;
  }

  get forward() { return [Math.sin(this.yaw), 0, Math.cos(this.yaw)]; }
  get right() { return [Math.cos(this.yaw), 0, -Math.sin(this.yaw)]; }

  setPose(x, z, yaw, surfaceY = 0) {
    this.pos[0] = x; this.pos[2] = z; this.pos[1] = surfaceY;
    this.yaw = yaw;
    this.vel[0] = this.vel[1] = this.vel[2] = 0;
    this.yawRate = 0;
    this.vy = 0;
    this.speed = 0;
    this.gear = GEAR_FIRST;
    this.rpm = IDLE_RPM;
    for (const w of this.wheels) { w.omega = 0; w.slipRatio = 0; w.slipAngle = 0; }
  }

  // Steering lock falls off with speed, both because it is what real racks do
  // and because full lock at 250 km/h would be undriveable.
  maxSteerAngle() {
    return lerp(0.60, 0.16, clamp(this.speed / 62, 0, 1));
  }

  // Convert a world vector into car-local (x = right, z = forward).
  toLocal(v) {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    return [v[0] * c - v[2] * s, v[1], v[0] * s + v[2] * c];
  }

  toWorld(v) {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
  }

  // Substep count follows the frame time rather than being fixed.
  //
  // The tyre model is stiff at low speed: slip ratio is (wheel speed - road
  // speed) over a small reference speed, so a coarse step lets the wheel
  // overshoot and the slip ratio oscillates between large positive and
  // negative values. Traction control reads that as wheelspin and cuts the
  // throttle, and the car crawls away from a standing start. With a fixed four
  // substeps it took 4.0 s to reach 100 km/h at 120 fps but 6.7 s at 30 fps -
  // the same car, slower on a slower machine. Holding the substep at ~1/480 s
  // makes handling identical at 30, 60 or 144 fps.
  update(dt, world) {
    const steps = clamp(Math.ceil(dt * 480), 4, 24);
    const h = dt / steps;
    for (let i = 0; i < steps; i++) this.step(h, world);
    this.updateVisualAttitude(dt);
  }

  step(dt, world) {
    const wheels = this.wheels;

    // --- steering ------------------------------------------------------------
    const speed = Math.hypot(this.vel[0], this.vel[2]);
    this.speed = speed;
    // Speed sensitive lock: full lock when parking, much less at racing speed.
    const maxSteer = this.maxSteerAngle();
    const target = this.steerInput * maxSteer;
    const rate = lerp(5.0, 2.4, clamp(speed / 55, 0, 1));
    this.steerAngle = approach(this.steerAngle, target, rate * dt * (1 + Math.abs(target - this.steerAngle) * 2));

    // Ackermann: the inside wheel turns more than the outside.
    for (const w of wheels) {
      if (!w.steered) { w.steer = 0; continue; }
      const s = this.steerAngle;
      if (Math.abs(s) < 1e-4) { w.steer = s; continue; }
      const turnRadius = this.wheelbase / Math.tan(Math.abs(s));
      const inner = Math.atan(this.wheelbase / (turnRadius - this.trackFront / 2));
      const outer = Math.atan(this.wheelbase / (turnRadius + this.trackFront / 2));
      const isInner = (s > 0) === (w.x > 0);
      w.steer = sign(s) * (isInner ? inner : outer);
    }

    // --- surface sampling ----------------------------------------------------
    const cosY = Math.cos(this.yaw), sinY = Math.sin(this.yaw);
    let groundY = 0, groundCount = 0;
    for (const w of wheels) {
      const wx = this.pos[0] + w.x * cosY + w.z * sinY;
      const wz = this.pos[2] - w.x * sinY + w.z * cosY;
      const info = world ? world.sampleSurface(wx, wz) : null;
      w.surface = info ? info.surface : SURFACES.asphalt;
      w.groundY = info ? info.height : 0;
      w.worldPos[0] = wx; w.worldPos[1] = w.groundY; w.worldPos[2] = wz;
      groundY += w.groundY; groundCount++;
    }
    groundY /= groundCount || 1;

    // --- vertical motion (kerbs and crests can get the car light) -----------
    this.vy -= GRAVITY * dt;
    this.pos[1] += this.vy * dt;
    if (this.pos[1] <= groundY) {
      if (this.vy < -0.4) this.vy *= -0.18;         // small bounce
      else this.vy = 0;
      this.pos[1] = groundY;
      this.airborne = false;
    } else if (this.pos[1] > groundY + 0.04) {
      this.airborne = true;
    }
    const airborne = this.airborne;

    // --- load distribution ---------------------------------------------------
    const L = this.wheelbase;
    const staticFront = this.mass * GRAVITY * 0.5;
    const staticRear = this.mass * GRAVITY * 0.5;
    const q = 0.5 * AIR_DENSITY * speed * speed;
    const downforce = q * this.downforceArea;
    const dfFront = downforce * this.aeroBalance;
    const dfRear = downforce * (1 - this.aeroBalance);

    const longTransfer = this.mass * this.longAccel * this.cgHeight / L;
    const latTransferF = this.mass * this.latAccel * this.cgHeight / this.trackFront * 0.52;
    const latTransferR = this.mass * this.latAccel * this.cgHeight / this.trackRear * 0.48;

    const axleFront = staticFront + dfFront - longTransfer;
    const axleRear = staticRear + dfRear + longTransfer;

    const loads = [
      axleFront / 2 - latTransferF,
      axleFront / 2 + latTransferF,
      axleRear / 2 - latTransferR,
      axleRear / 2 + latTransferR,
    ];

    // --- engine and gearbox --------------------------------------------------
    const ratio = GEAR_RATIOS[this.gear] * FINAL_DRIVE;
    const drivenWheels = wheels.filter((w) => w.driven);
    let drivenOmega = 0;
    for (const w of drivenWheels) drivenOmega += w.omega;
    drivenOmega /= drivenWheels.length;

    if (this.gear !== GEAR_NEUTRAL) {
      const targetRpm = Math.abs(drivenOmega * ratio) * 60 / TAU;
      this.rpm = lerp(this.rpm, Math.max(targetRpm, IDLE_RPM * 0.92), clamp(dt * 18, 0, 1));
    } else {
      const free = IDLE_RPM + this.throttle * 6200;
      this.rpm = lerp(this.rpm, free, clamp(dt * 4.5, 0, 1));
    }
    this.rpm = clamp(this.rpm, IDLE_RPM * 0.9, LIMITER_RPM);

    this.shiftTimer = Math.max(0, this.shiftTimer - dt);
    if (this.autoGearbox) this.autoShift(dt, speed);

    let throttle = this.throttle;
    if (this.rpm >= LIMITER_RPM - 40) throttle *= 0.05;                 // rev limiter
    if (this.shiftTimer > 0) throttle *= 0.12;                          // torque cut on shift

    // Traction control trims throttle when the rear tyres light up.
    if (this.tractionControl && this.assists) {
      const spin = Math.max(Math.abs(wheels[RL].slipRatio), Math.abs(wheels[RR].slipRatio));
      if (spin > 0.16) throttle *= clamp(1 - (spin - 0.16) * 3.2, 0.12, 1);
    }

    const torque = this.engineRunning ? engineTorque(this.rpm) * throttle : 0;
    const clutchEngaged = this.shiftTimer <= 0 && this.gear !== GEAR_NEUTRAL;
    const axleTorque = clutchEngaged ? torque * ratio * DRIVETRAIN_EFFICIENCY : 0;
    this.engineLoad = throttle;

    // Engine braking pulls the revs down when off throttle.
    const engineBrake = clutchEngaged ? (1 - throttle) * (this.rpm / REDLINE_RPM) * 55 * Math.abs(ratio) : 0;

    // --- brakes ---------------------------------------------------------------
    const brakeBias = 0.62;
    const maxBrakeTorque = 5200;
    const brakeFront = this.brake * maxBrakeTorque * brakeBias;
    const brakeRear = this.brake * maxBrakeTorque * (1 - brakeBias);
    const handbrakeTorque = this.handbrake * 2400;

    // --- per wheel tyre forces -------------------------------------------------
    let forceX = 0, forceZ = 0, moment = 0;
    this.wheelSlipMax = 0;

    const vLocal = this.toLocal(this.vel);

    for (let i = 0; i < 4; i++) {
      const w = wheels[i];
      w.load = Math.max(0, loads[i]);
      if (airborne) w.load = 0;

      // Contact patch velocity in car frame.
      const vx = vLocal[0] + this.yawRate * w.z;
      const vz = vLocal[2] - this.yawRate * w.x;

      // Rotate into the wheel frame.
      const cs = Math.cos(w.steer), sn = Math.sin(w.steer);
      const vLongW = vz * cs + vx * sn;
      const vLatW = vx * cs - vz * sn;

      // Slip ratio with a low speed guard so standstill does not blow up.
      const refSpeed = Math.max(Math.abs(vLongW), 1.6);
      const slipRatio = (w.omega * w.radius - vLongW) / refSpeed;
      const slipAngle = Math.atan2(vLatW, Math.max(Math.abs(vLongW), 1.2));
      w.slipRatio = slipRatio;
      w.slipAngle = slipAngle;

      const surface = w.surface;
      const gripScale = this.tyreGrip * surface.grip;
      const mu = 1.62 * gripScale * (1 - 0.11 * (w.load / 3600 - 1));
      const peak = Math.max(0, mu * w.load);

      // Pacejka style curves.
      const Bx = 11.0, Cx = 1.62, Ex = -0.42;
      const By = 8.4, Cy = 1.40, Ey = -0.30;
      const sx = Bx * slipRatio;
      const sy = By * slipAngle;
      let fx = peak * Math.sin(Cx * Math.atan(sx - Ex * (sx - Math.atan(sx))));
      let fy = -peak * Math.sin(Cy * Math.atan(sy - Ey * (sy - Math.atan(sy))));

      // Combined slip: the tyre cannot exceed its friction circle.
      const total = Math.hypot(fx, fy);
      if (total > peak && total > 1e-3) {
        const k = peak / total;
        fx *= k; fy *= k;
      }
      if (airborne) { fx = 0; fy = 0; }

      // Wheel spin dynamics.
      let wheelTorque = 0;
      if (w.driven && clutchEngaged) wheelTorque += axleTorque / drivenWheels.length;
      const brakeT = (w.z > 0 ? brakeFront : brakeRear) + (w.z < 0 ? handbrakeTorque : 0);
      const rollingResist = w.load * surface.rolling * 0.5;

      let netTorque = wheelTorque - fx * w.radius;
      if (w.driven) netTorque -= engineBrake / drivenWheels.length;

      // ABS releases the brake when the wheel is about to lock.
      let appliedBrake = brakeT;
      if (this.absEnabled && this.assists && slipRatio < -0.18 && Math.abs(vLongW) > 3) {
        appliedBrake *= clamp(1 + (slipRatio + 0.18) * 4.0, 0.05, 1);
      }
      const brakeDir = -sign(w.omega);
      const brakeApplied = Math.abs(w.omega) < 0.6 && appliedBrake > 0
        ? -w.omega * this.wheelInertia / Math.max(dt, 1e-4) * 0.5   // hold at a stop
        : brakeDir * (appliedBrake + rollingResist);
      netTorque += brakeApplied;

      w.omega += (netTorque / this.wheelInertia) * dt;
      if (appliedBrake > 40 && Math.abs(w.omega) < 0.5 && Math.abs(vLongW) < 0.7) w.omega = 0;
      w.spin += w.omega * dt;

      // Accumulate chassis forces (rotate back out of the wheel frame).
      const fLong = fx * cs - fy * sn;
      const fLat = fx * sn + fy * cs;
      forceZ += fLong;
      forceX += fLat;
      moment += fLat * w.z - fLong * w.x;

      w.fx = fx; w.fy = fy;
      w.slipSpeed = Math.hypot(slipRatio * refSpeed, vLatW) * (w.load > 1 ? 1 : 0);
      this.wheelSlipMax = Math.max(this.wheelSlipMax, Math.abs(slipRatio));
      w.contact = !airborne;

      // Tyre temperature drifts with how hard the tyre is working.
      const work = Math.abs(w.slipSpeed) * 0.06;
      w.temperature += (70 + work * 26 - w.temperature) * clamp(dt * 0.35, 0, 1);
    }

    // --- aerodynamics and resistance --------------------------------------------
    const drag = q * this.dragArea;
    const speedDir = speed > 0.01 ? [this.vel[0] / speed, 0, this.vel[2] / speed] : [0, 0, 0];
    const dragLocal = this.toLocal([-speedDir[0] * drag, 0, -speedDir[2] * drag]);
    forceX += dragLocal[0];
    forceZ += dragLocal[2];

    // Surface drag when a wheel is off the racing surface.
    let offDrag = 0;
    for (const w of wheels) offDrag += w.surface.drag;
    if (offDrag > 0) {
      const f = offDrag * 0.25 * this.mass * 0.28 * clamp(speed / 12, 0, 1);
      forceZ -= sign(vLocal[2]) * f;
    }

    // --- integrate -----------------------------------------------------------
    const ax = forceX / this.mass;
    const az = forceZ / this.mass;
    this.longAccel = lerp(this.longAccel, az, clamp(dt * 12, 0, 1));
    this.latAccel = lerp(this.latAccel, ax, clamp(dt * 12, 0, 1));

    // The accelerations are inertial but expressed in the rotating car frame,
    // so the body-frame rate of change is a - (omega x v) with omega = yawRate
    // about +Y:  omega x v = (r*vz, 0, -r*vx).
    const newVx = vLocal[0] + (ax - this.yawRate * vLocal[2]) * dt;
    const newVz = vLocal[2] + (az + this.yawRate * vLocal[0]) * dt;
    const worldV = this.toWorld([newVx, 0, newVz]);
    this.vel[0] = worldV[0];
    this.vel[2] = worldV[2];

    if (!airborne) {
      this.yawRate += (moment / this.inertiaYaw) * dt;
      // A little yaw damping keeps the car from oscillating at the limit.
      this.yawRate -= this.yawRate * clamp(dt * 0.6, 0, 1);
    } else {
      this.yawRate -= this.yawRate * clamp(dt * 0.25, 0, 1);
    }

    // Optional stability control. Two jobs, both only active outside normal
    // cornering so it never fights the driver mid-corner:
    //  1. bleed off yaw rate beyond what the steering angle can justify;
    //  2. unwind a large body slip angle back toward the direction of travel.
    // `beta` is positive when the velocity points right of the nose, which is
    // exactly the sign the correction needs - inverting it turns the aid into
    // a spin amplifier.
    if (this.assists && !airborne && speed > 5) {
      const beta = Math.atan2(vLocal[0], Math.abs(vLocal[2]));
      const kinematic = speed * Math.tan(this.steerAngle) / this.wheelbase;
      const gripLimit = (1.55 * GRAVITY) / Math.max(speed, 1);
      const allowed = clamp(kinematic, -gripLimit, gripLimit);

      const over = Math.abs(this.yawRate) - Math.abs(allowed) - 0.05;
      if (over > 0) {
        this.yawRate -= sign(this.yawRate) * Math.min(over, 2.0) * clamp(dt * 2.8, 0, 1);
      }
      const betaExcess = Math.max(0, Math.abs(beta) - 0.14) * sign(beta);
      if (betaExcess !== 0) {
        this.yawRate += betaExcess * 2.2 * clamp(dt * 3.0, 0, 1);
      }
    }

    this.yaw += this.yawRate * dt;
    this.pos[0] += this.vel[0] * dt;
    this.pos[2] += this.vel[2] * dt;
    this.odometer += Math.hypot(this.vel[0], this.vel[2]) * dt;

    // Kill microscopic creep so a parked car stays parked.
    if (Math.hypot(this.vel[0], this.vel[2]) < 0.06 && this.throttle < 0.02) {
      this.vel[0] *= 0.5; this.vel[2] *= 0.5;
      if (Math.abs(this.yawRate) < 0.02) this.yawRate *= 0.5;
    }
  }

  autoShift(dt, speed) {
    if (this.shiftTimer > 0) return;
    const wantReverse = this.gear === GEAR_REVERSE;

    // Creep out of reverse or into first depending on which way the driver asks.
    if (speed < 0.9) {
      if (this.throttle > 0.05 && this.gear === GEAR_REVERSE && this.reverseRequest !== true) {
        this.gear = GEAR_FIRST;
      }
      if (this.reverseRequest === true && this.gear !== GEAR_REVERSE) {
        this.gear = GEAR_REVERSE;
        this.shiftTimer = 0.25;
        return;
      }
    }
    if (wantReverse) return;

    const upAt = REDLINE_RPM - 350;
    const downAt = 3200;
    if (this.rpm > upAt && this.gear < GEAR_RATIOS.length - 1 && this.throttle > 0.15) {
      this.gear++;
      this.shiftTimer = 0.13;
      this.lastShiftDir = 1;
    } else if (this.rpm < downAt && this.gear > GEAR_FIRST) {
      // Check the next gear down would not immediately hit the limiter.
      const nextRatio = GEAR_RATIOS[this.gear - 1] * FINAL_DRIVE;
      const wheelOmega = (this.wheels[RL].omega + this.wheels[RR].omega) / 2;
      const projected = Math.abs(wheelOmega * nextRatio) * 60 / TAU;
      if (projected < REDLINE_RPM - 500) {
        this.gear--;
        this.shiftTimer = 0.16;
        this.lastShiftDir = -1;
      }
    }
  }

  shiftUp() {
    if (this.shiftTimer > 0) return;
    if (this.gear < GEAR_RATIOS.length - 1) { this.gear++; this.shiftTimer = 0.13; this.lastShiftDir = 1; }
  }

  shiftDown() {
    if (this.shiftTimer > 0) return;
    if (this.gear > GEAR_REVERSE) { this.gear--; this.shiftTimer = 0.16; this.lastShiftDir = -1; }
  }

  // Body attitude: dive, squat and roll follow the accelerations, and the
  // suspension compression per corner drives the wheel visuals.
  updateVisualAttitude(dt) {
    const targetPitch = clamp(this.longAccel * 0.016, -0.075, 0.075);
    const targetRoll = clamp(-this.latAccel * 0.014, -0.075, 0.075);
    this.pitch = lerp(this.pitch, targetPitch, clamp(dt * 7, 0, 1));
    this.roll = lerp(this.roll, targetRoll, clamp(dt * 7, 0, 1));

    const nominal = this.mass * GRAVITY / 4;
    for (const w of this.wheels) {
      const target = clamp((w.load - nominal) / (nominal * 2.4), -0.6, 1) * 0.055;
      w.compression = lerp(w.compression, this.airborne ? -0.035 : target, clamp(dt * 9, 0, 1));
    }
  }

  // Speed in km/h, signed so reversing reads negative.
  get speedKmh() {
    const local = this.toLocal(this.vel);
    return Math.hypot(this.vel[0], this.vel[2]) * 3.6 * (local[2] < -0.4 ? -1 : 1);
  }

  get gearLabel() {
    if (this.gear === GEAR_REVERSE) return 'R';
    if (this.gear === GEAR_NEUTRAL) return 'N';
    return String(this.gear - 1);
  }

  // Push the car out of a wall / another car.
  applyImpulse(nx, nz, magnitude, restitution = 0.35) {
    const vn = this.vel[0] * nx + this.vel[2] * nz;
    if (vn < 0) {
      const j = -(1 + restitution) * vn;
      this.vel[0] += nx * j;
      this.vel[2] += nz * j;
    }
    this.vel[0] += nx * magnitude;
    this.vel[2] += nz * magnitude;
  }
}
