/**
 * Arcade motorcycle dynamics.
 *
 * The bike is simulated in track space — distance along the centreline `s`,
 * signed lateral offset, and a yaw angle relative to the road tangent. That
 * makes lane logic, boundaries and traffic collisions trivial, and it means a
 * corner has to be *steered through*: the road's own curvature is subtracted
 * from the bike's yaw rate every step, so letting go of the bars runs you wide
 * exactly as it should.
 *
 * A crash drops out of track space into a plain rigid-body tumble, then snaps
 * back to the centreline on respawn.
 */

import * as THREE from 'three';
import { clamp, lerp, damp, approach, TAU, MPS_TO_MPH } from '../engine/util.js';

const G = 9.81;
const MASS = 250;             // bike + rider, kg
const WHEEL_R = 0.325;
const DRAG_CDA = 0.36;        // tucked sports bike
const RHO = 1.2;
const ROLL_RESIST = 0.015;

/**
 * Gearbox. `top` is the road speed (m/s) at the redline in that gear, `force`
 * the tractive force at the rear wheel at peak torque.
 */
const GEARS = [
  { top: 18, force: 5600 },
  { top: 30, force: 4300 },
  { top: 43, force: 3350 },
  { top: 56, force: 2700 },
  { top: 72, force: 2200 },
  { top: 95, force: 1850 },
];

const IDLE_RPM = 1400;
const REDLINE_RPM = 13500;

export class BikePhysics {
  constructor(track, options = {}) {
    this.track = track;
    this.wet = !!options.wet;

    this.grip = this.wet ? 0.86 : 1.16;
    this.brakeAccel = this.wet ? 8.4 : 11.2;

    // --- track-space state ---
    this.s = 0;
    this.lateral = 0;
    this.yawRel = 0;
    this.speed = 0;
    this.yawRate = 0;

    // --- presentation state ---
    this.lean = 0;
    this.pitch = 0;
    this.steerAngle = 0;
    this.gear = 0;
    this.rpm = IDLE_RPM;
    this.braking = 0;
    this.slip = 0;              // 0..1, how far past the grip limit we are
    this.offRoad = false;
    this.boosting = false;

    // --- crash state ---
    this.crashed = false;
    this.crashTimer = 0;
    this.crashRoll = 0;
    this.crashPitch = 0;
    this.crashYaw = 0;
    this.crashSpin = new THREE.Vector3();
    this.crashVel = new THREE.Vector3();
    this.crashPos = new THREE.Vector3();

    // --- derived, read by the renderer ---
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.heading = 0;
    this.groundY = 0;
    this.groundNormal = new THREE.Vector3(0, 1, 0);

    this._shiftCooldown = 0;
    this._c = {};
    this._tmp = new THREE.Vector3();

    this.reset(0);
  }

  reset(s = this.track.startS, speed = 0) {
    this.s = s;
    this.lateral = this.track.laneCentre(this.track.racingLane);
    this.yawRel = 0;
    this.speed = speed;
    this.yawRate = 0;
    this.lean = 0;
    this.pitch = 0;
    this.steerAngle = 0;
    this.gear = 0;
    this.rpm = IDLE_RPM;
    this.braking = 0;
    this.slip = 0;
    this.crashed = false;
    this.crashTimer = 0;
    this.crashRoll = 0;
    this.crashPitch = 0;
    this.crashYaw = 0;
    this._syncWorld();
  }

  get speedMph() {
    return this.speed * MPS_TO_MPH;
  }

  /** Metres covered since the start line, clamped to the race distance. */
  get progress() {
    return clamp(this.s - this.track.startS, 0, this.track.raceLength);
  }

  /** Fraction of the way to the redline in the current gear, 0..1. */
  get rpmFraction() {
    return clamp((this.rpm - IDLE_RPM) / (REDLINE_RPM - IDLE_RPM), 0, 1);
  }

  /* ----------------------------------------------------------------
     Main step
     ---------------------------------------------------------------- */

  update(input, dt, events = {}) {
    if (this.crashed) {
      this._updateCrash(dt, events);
      return;
    }

    const track = this.track;
    const c = track.sample(this.s, this._c);

    // ---- surface --------------------------------------------------
    const edge = track.halfWidth;
    const absLat = Math.abs(this.lateral);
    this.offRoad = absLat > edge;
    const surfaceGrip = this.offRoad ? this.grip * 0.55 : this.grip;
    const surfaceDrag = this.offRoad ? 900 : 0;

    // ---- longitudinal ---------------------------------------------
    const throttle = input.throttle;
    this.braking = input.brake;

    this._updateGearbox(dt, throttle);
    const gear = GEARS[this.gear];
    // Torque curve: soft off idle, peak around 78% of the gear's range, then
    // falls away toward the limiter.
    const frac = clamp(this.speed / gear.top, 0, 1.05);
    const torqueShape = 0.55 + 0.45 * Math.sin(Math.min(frac, 1) * Math.PI * 0.92 + 0.18);
    const limiter = frac > 1.0 ? clamp(1 - (frac - 1) * 12, 0, 1) : 1;
    let drive = throttle * gear.force * torqueShape * limiter;

    // Traction limit: you cannot put down more than the tyre will hold, and
    // less again when leaned over or on a wet road.
    const leanLoss = 1 - clamp(Math.abs(this.lean) / 1.0, 0, 1) * 0.55;
    const maxDrive = surfaceGrip * MASS * G * 0.92 * leanLoss;
    if (drive > maxDrive) {
      this.slip = clamp((drive / maxDrive - 1) * 0.8, 0, 1);
      drive = maxDrive;
    } else {
      this.slip = damp(this.slip, 0, 0.02, dt);
    }

    const dragForce = 0.5 * RHO * DRAG_CDA * this.speed * this.speed;
    const rolling = ROLL_RESIST * MASS * G + surfaceDrag * (this.speed > 0.5 ? 1 : 0);
    const engineBrake = throttle < 0.05 ? 320 : 0;
    const brakeForce = this.braking * this.brakeAccel * MASS * (this.offRoad ? 0.6 : 1);
    const slopeForce = -Math.sin(c.pitch) * MASS * G;

    const net = drive - dragForce - rolling - engineBrake - brakeForce + slopeForce;
    this.speed += (net / MASS) * dt;
    if (this.speed < 0) this.speed = 0;
    this.boosting = throttle > 0.9 && net > 900;

    // ---- steering --------------------------------------------------
    // The lateral acceleration the tyres can hold sets the tightest line
    // available at this speed; below ~15 m/s steering lock is the limit instead.
    const latAccelLimit = surfaceGrip * G;
    const yawFromGrip = latAccelLimit / Math.max(this.speed, 5);
    const maxYawRate = Math.min(2.0, yawFromGrip);
    // The one place player intent is converted into the track frame. `steer`
    // is +1 for "right" as the player means it, but heading increases
    // counter-clockwise (see the note atop world/track.js), so a right turn
    // is a *decreasing* heading. Getting this backwards mirrors the controls.
    const targetYawRate = -input.steer * maxYawRate;

    // Steering response is quick but not instant, which is what stops the bike
    // feeling like it is on rails.
    const responsiveness = this.offRoad ? 5.0 : 8.5;
    this.yawRate = damp(this.yawRate, targetYawRate, Math.pow(0.5, responsiveness), dt);

    // Yaw relative to the road: the road's own curvature works against you.
    const roadYawRate = c.curvature * this.speed;
    this.yawRel += (this.yawRate - roadYawRate) * dt;
    this.yawRel = clamp(this.yawRel, -0.9, 0.9);

    // ---- integrate track position ---------------------------------
    const cosY = Math.cos(this.yawRel);
    const sinY = Math.sin(this.yawRel);
    this.s += this.speed * cosY * dt;
    this.lateral += this.speed * sinY * dt;

    // ---- lean ------------------------------------------------------
    // Lean follows the lateral acceleration actually being generated. It is
    // scaled down at low speed so the bike doesn't flop over at walking pace.
    const latAccel = this.speed * this.yawRate;
    const leanTarget = Math.atan2(latAccel, G) * clamp(this.speed / 14, 0.15, 1);
    this.lean = damp(this.lean, clamp(leanTarget, -0.95, 0.95), 0.0008, dt);

    // Visual steering: bars barely move at speed, and turn into the corner
    // when manoeuvring slowly.
    // Same conversion for the visible bar angle: the front wheel yaws with the
    // turn, so it follows the sign of the yaw rate, not of the raw input.
    const steerVisual = -input.steer * 0.26 * (1 - clamp(this.speed / 45, 0, 0.88));
    this.steerAngle = damp(this.steerAngle, steerVisual, 0.002, dt);

    // ---- pitch: wheelie and stoppie --------------------------------
    this._updatePitch(input, dt, drive, brakeForce);

    // ---- boundaries -------------------------------------------------
    this._checkBoundaries(dt, events);

    this._syncWorld();
  }

  _updateGearbox(dt, throttle) {
    this._shiftCooldown = Math.max(0, this._shiftCooldown - dt);
    const gear = GEARS[this.gear];
    const frac = this.speed / gear.top;

    if (this._shiftCooldown === 0) {
      if (frac > 0.985 && this.gear < GEARS.length - 1) {
        this.gear++;
        this._shiftCooldown = 0.28;
      } else if (this.gear > 0 && this.speed < GEARS[this.gear - 1].top * 0.72) {
        this.gear--;
        this._shiftCooldown = 0.28;
      }
    }

    const g = GEARS[this.gear];
    const target = lerp(IDLE_RPM, REDLINE_RPM, clamp(this.speed / g.top, 0, 1.02));
    // Blip toward the limiter when the throttle is pinned in neutral-ish revs.
    const idleBlip = this.speed < 1 ? IDLE_RPM + throttle * 4200 : target;
    this.rpm = damp(this.rpm, Math.max(target, idleBlip), 0.0001, dt);
  }

  _updatePitch(input, dt, drive, brakeForce) {
    let target = 0;

    // Wheelie: needs power, low-ish speed and either the dedicated button or a
    // hard enough launch to loft it anyway.
    const wheelieAuthority = clamp(1 - this.speed / 42, 0, 1);
    const wantWheelie = input.wheelie && input.throttle > 0.6;
    const powerLift = clamp(drive / (MASS * G) - 0.72, 0, 1);
    if (!this.offRoad && wheelieAuthority > 0 && (wantWheelie || powerLift > 0)) {
      const strength = wantWheelie ? 1 : clamp(powerLift * 1.6, 0, 1);
      target = strength * wheelieAuthority * 0.85;
      // Leaning over kills a wheelie — as it should.
      target *= 1 - clamp(Math.abs(this.lean) / 0.6, 0, 1);
    }

    // Stoppie: hard braking pitches the nose down a little.
    if (brakeForce > MASS * G * 0.6 && this.speed > 6) {
      target -= clamp(brakeForce / (MASS * G) - 0.6, 0, 0.5) * 0.22;
    }

    // `damp`'s smoothing is the fraction of the gap left after one second, so
    // the smaller number is the faster response: the front lifts sharply and
    // comes back down under its own weight.
    const rate = target > this.pitch ? 0.0004 : 0.02;
    this.pitch = damp(this.pitch, clamp(target, -0.14, 1.05), rate, dt);
  }

  _checkBoundaries(dt, events) {
    const track = this.track;
    const edge = track.halfWidth;
    const barrier = edge + track.shoulder - 0.5;
    const absLat = Math.abs(this.lateral);

    if (absLat > edge + 0.2 && events.onRumble) {
      events.onRumble(clamp((absLat - edge) / track.shoulder, 0, 1) * (this.speed / 40));
    }

    if (absLat > barrier) {
      const glancing = Math.abs(this.yawRel) < 0.16 && this.speed < 34;
      if (glancing) {
        // Scrape along the barrier: bleed speed, get pushed back on line.
        this.lateral = Math.sign(this.lateral) * barrier;
        this.speed *= 1 - dt * 1.4;
        this.yawRel = damp(this.yawRel, -Math.sign(this.lateral) * 0.05, 0.02, dt);
        events.onScrape?.(this.speed);
      } else {
        this.crash('barrier', events);
      }
    }

    if (this.s >= track.finishS) {
      events.onFinish?.();
    }
  }

  /* ----------------------------------------------------------------
     Crashing
     ---------------------------------------------------------------- */

  crash(cause, events = {}) {
    if (this.crashed) return;
    this.crashed = true;
    this.crashTimer = 0;
    this.cause = cause;

    // Hand the current motion over to the rigid-body tumble.
    this._syncWorld();
    this.crashPos.copy(this.position);
    this.crashVel.copy(this.velocity).multiplyScalar(0.55);
    this.crashVel.y = 3.2 + Math.min(this.speed, 45) * 0.06;

    const spinScale = clamp(this.speed / 30, 0.4, 2.4);
    this.crashSpin.set(
      (Math.random() - 0.5) * 5 * spinScale,
      (Math.random() - 0.5) * 4 * spinScale,
      (Math.random() > 0.5 ? 1 : -1) * (2.5 + Math.random() * 4) * spinScale,
    );

    events.onCrash?.(cause, this.speed);
  }

  _updateCrash(dt, events) {
    this.crashTimer += dt;

    // Ballistic tumble with a soft ground bounce.
    this.crashVel.y -= G * dt;
    this.crashPos.addScaledVector(this.crashVel, dt);

    const groundY = this._groundUnder(this.crashPos.x, this.crashPos.z);
    if (this.crashPos.y < groundY + 0.35) {
      this.crashPos.y = groundY + 0.35;
      if (this.crashVel.y < 0) this.crashVel.y *= -0.32;
      this.crashVel.x *= 0.86;
      this.crashVel.z *= 0.86;
      this.crashSpin.multiplyScalar(0.82);
    }

    this.crashPitch += this.crashSpin.x * dt;
    this.crashYaw += this.crashSpin.y * dt;
    this.crashRoll += this.crashSpin.z * dt;

    this.position.copy(this.crashPos);
    this.velocity.copy(this.crashVel);
    this.groundY = groundY;
    this.speed = Math.hypot(this.crashVel.x, this.crashVel.z);
    this.braking = 0;
    this.slip = 0;

    if (this.crashTimer > 2.1) {
      this.respawn();
      events.onRespawn?.();
    }
  }

  /** Put the rider back on the racing line, a little way back and slowed. */
  respawn() {
    const track = this.track;
    // Rewind slightly so the player re-approaches whatever caught them out.
    this.s = track.clampS(Math.max(track.startS, this.s - 12));
    this.lateral = track.laneCentre(track.racingLane);
    this.yawRel = 0;
    this.yawRate = 0;
    this.speed = Math.min(this.speed, 14);
    this.lean = 0;
    this.pitch = 0;
    this.steerAngle = 0;
    this.gear = 0;
    this.crashed = false;
    this.crashTimer = 0;
    this.crashRoll = 0;
    this.crashPitch = 0;
    this.crashYaw = 0;
    this._syncWorld();
  }

  _groundUnder(x, z) {
    const s = this.track.nearestS(x, z, this.s);
    const lat = this.track.lateralAt(s, x, z);
    return this.track.heightAt(s, clamp(lat, -60, 60));
  }

  /* ----------------------------------------------------------------
     Track space -> world space
     ---------------------------------------------------------------- */

  _syncWorld() {
    if (this.crashed) return;
    const track = this.track;
    const c = track.sample(this.s, this._c);
    const cosH = Math.cos(c.heading);
    const sinH = Math.sin(c.heading);

    this.groundY = c.y + Math.sin(c.camber) * this.lateral;
    this.position.set(
      c.x + cosH * this.lateral,
      this.groundY,
      c.z - sinH * this.lateral,
    );
    this.heading = c.heading + this.yawRel;
    track.normal(this.s, this.groundNormal);

    const fwdX = Math.sin(this.heading);
    const fwdZ = Math.cos(this.heading);
    this.velocity.set(fwdX * this.speed, 0, fwdZ * this.speed);
  }

  /** Snapshot consumed by the bike mesh and the camera. */
  getRenderState(out = {}) {
    out.position = this.position;
    out.heading = this.heading;
    out.lean = this.lean;
    out.pitch = this.pitch;
    out.steerAngle = this.steerAngle;
    out.speed = this.speed;
    out.groundY = this.groundY;
    out.groundNormal = this.groundNormal;
    out.braking = this.braking;
    out.crashed = this.crashed;
    out.crashRoll = this.crashRoll;
    out.crashPitch = this.crashPitch;
    out.crashYaw = this.crashYaw;
    out.boosting = this.boosting;
    return out;
  }
}
