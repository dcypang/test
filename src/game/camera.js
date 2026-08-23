/**
 * Chase camera.
 *
 * The reference footage sits low and close behind the rear wheel, rises a
 * little with speed, and lets the bike drift toward the inside of the frame as
 * it leans. The camera also widens its field of view with speed — the cheapest
 * and most effective way to sell velocity.
 */

import * as THREE from 'three';
import { clamp, damp, lerp, TAU } from '../engine/util.js';

/**
 * `dist`/`height` are metres behind and above the bike's contact patch. They
 * are deliberately tight: the reference footage frames the bike at roughly a
 * third of the screen height, which needs the camera about four metres back
 * and under two metres up, not the comfortable six-plus a desktop racer uses.
 */
const MODES = [
  { name: 'chase', dist: 4.3, height: 1.74, look: 9.0, fovBase: 58, fovGain: 15, leanShift: 1.0 },
  { name: 'close', dist: 3.1, height: 1.50, look: 10.0, fovBase: 62, fovGain: 16, leanShift: 0.7 },
  { name: 'hood',  dist: 0.55, height: 1.32, look: 14.0, fovBase: 72, fovGain: 18, leanShift: 0.15 },
  { name: 'cine',  dist: 7.0, height: 2.60, look: 5.0, fovBase: 46, fovGain: 10, leanShift: 2.0 },
];

export class ChaseCamera {
  constructor(aspect) {
    // Far has to clear the sky dome (radius 4200) and the ridge backdrop.
    this.camera = new THREE.PerspectiveCamera(62, aspect, 0.3, 6000);
    this.modeIndex = 0;
    this.mode = MODES[0];

    this.position = new THREE.Vector3();
    this.lookAt = new THREE.Vector3();
    this.up = new THREE.Vector3(0, 1, 0);

    this.roll = 0;
    this.fov = this.mode.fovBase;
    this.shake = 0;
    this.shakeTime = 0;
    this.initialised = false;

    this._desired = new THREE.Vector3();
    this._target = new THREE.Vector3();
    this._offset = new THREE.Vector3();
    // Smoothed offsets from the bike — see the note in `update`.
    this._followOffset = new THREE.Vector3();
    this._lookOffset = new THREE.Vector3();
    this._followLook = new THREE.Vector3();
    this._lookInit = false;
    this._quat = new THREE.Quaternion();
    this._euler = new THREE.Euler(0, 0, 0, 'YXZ');
  }

  cycleMode() {
    this.modeIndex = (this.modeIndex + 1) % MODES.length;
    this.mode = MODES[this.modeIndex];
    return this.mode.name;
  }

  setMode(name) {
    const i = MODES.findIndex((m) => m.name === name);
    if (i >= 0) {
      this.modeIndex = i;
      this.mode = MODES[i];
    }
  }

  /** Add a burst of shake; `amount` is roughly 0..1. */
  addShake(amount) {
    this.shake = Math.min(1.4, this.shake + amount);
  }

  /**
   * @param bike     the bike state: { position, heading, lean, speed, crashed }
   * @param roadUp   surface normal at the bike, so the camera banks on cambers
   * @param dt       frame delta in seconds
   * @param speedRef top speed used to normalise the FOV curve
   */
  update(bike, roadUp, dt, speedRef = 85) {
    const m = this.mode;
    const speedT = clamp(bike.speed / speedRef, 0, 1.2);

    // Ease back a little as speed builds, but stay low: a camera that climbs
    // with speed flattens the road and kills the sense of pace.
    const dist = m.dist * (1 + speedT * 0.14);
    const height = m.height + speedT * 0.14;

    // Heading the camera trails: while crashed we stop following the bike's
    // spin and hold the last stable heading, which keeps the tumble readable.
    const heading = bike.crashed ? (this._crashHeading ?? bike.heading) : bike.heading;
    if (!bike.crashed) this._crashHeading = bike.heading;

    // Lean pushes the camera to the outside of the corner.
    const lateral = -Math.sin(bike.lean) * m.leanShift;

    this._offset.set(
      Math.sin(heading) * -dist + Math.cos(heading) * lateral,
      height,
      Math.cos(heading) * -dist - Math.sin(heading) * lateral,
    );
    // Smoothing is applied to the camera's offset from the bike, never to its
    // world position. Damping the world position makes the camera lag by an
    // amount proportional to speed — at 60 m/s that is several metres of drift
    // backwards, so the bike shrinks exactly when it should feel fastest.
    // Damping the offset lets the camera track the bike's travel rigidly while
    // still easing through changes of heading, lean and speed.
    if (!this.initialised) {
      this._followOffset.copy(this._offset);
      this.initialised = true;
    } else {
      const ease = bike.crashed ? 0.06 : 0.0012;
      this._followOffset.x = damp(this._followOffset.x, this._offset.x, ease, dt);
      this._followOffset.y = damp(this._followOffset.y, this._offset.y, bike.crashed ? 0.1 : 0.01, dt);
      this._followOffset.z = damp(this._followOffset.z, this._offset.z, ease, dt);
    }
    this.position.copy(bike.position).add(this._followOffset);

    // Keep the camera above the road surface no matter what the terrain does.
    const floor = bike.groundY + 0.95;
    if (this.position.y < floor) this.position.y = floor;

    // Look ahead down the road rather than at the bike itself. Same treatment:
    // the aim point is smoothed relative to the bike, not in world space.
    const look = m.look * (1 + speedT * 0.5);
    this._lookOffset.set(
      Math.sin(heading) * look,
      1.05 + speedT * 0.2,
      Math.cos(heading) * look,
    );
    if (this._lookInit) {
      const k = 1 - Math.pow(0.004, dt);
      this._followLook.lerp(this._lookOffset, k);
    } else {
      this._followLook.copy(this._lookOffset);
      this._lookInit = true;
    }
    this.lookAt.copy(bike.position).add(this._followLook);

    // Roll follows the bike's lean. The road camber deliberately does not feed
    // in here: the surface normal is a world vector, so its X component means
    // something different at every heading and using it as a roll term made
    // the horizon tip according to which way the course happened to be facing.
    const targetRoll = bike.crashed ? 0 : bike.lean * 0.22;
    this.roll = damp(this.roll, targetRoll, 0.02, dt);
    void roadUp;

    // FOV opens up with speed and snaps a little wider under hard acceleration.
    const targetFov = m.fovBase + m.fovGain * Math.pow(speedT, 1.35) + (bike.boosting ? 3 : 0);
    this.fov = damp(this.fov, targetFov, 0.05, dt);

    // ---- apply ------------------------------------------------------
    // Aim with a true world up, then roll about the camera's own view axis.
    // Tilting the *world* up vector instead only produces a roll while the
    // camera happens to look along Z; as the course turns, that same vector
    // gains a component along the view direction and starts yawing the shot
    // instead — and degenerates completely when the two align.
    this.camera.position.copy(this.position);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.lookAt);
    if (this.roll !== 0) this.camera.rotateZ(this.roll);

    if (this.shake > 0.001) {
      this.shakeTime += dt;
      const t = this.shakeTime;
      const s = this.shake;
      // Layered sines beat random noise here: the motion stays continuous, so
      // it reads as vibration rather than per-frame jitter.
      this.camera.position.x += Math.sin(t * 47.3) * s * 0.12;
      this.camera.position.y += Math.sin(t * 61.7 + 1.3) * s * 0.10;
      this.camera.rotateZ(Math.sin(t * 39.1 + 0.7) * s * 0.014);
      this.shake = Math.max(0, this.shake - dt * 2.2);
    }

    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Snap straight to the ideal pose — used on respawn so there's no swoop. */
  snap(bike) {
    this.initialised = false;
    this._lookInit = false;
    this._crashHeading = bike.heading;
    this.lookAt.copy(bike.position);
    this.shake = 0;
  }

  resize(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
