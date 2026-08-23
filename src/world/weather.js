/**
 * Rain and road spray.
 *
 * The rain volume is a box that rides with the camera and wraps particles as
 * they fall out of it, so a few thousand points cover an apparently infinite
 * downpour. Fall velocity is biased backwards by the rider's own speed, which
 * is what makes rain read as "fast" rather than just "wet".
 */

import * as THREE from 'three';
import { rainTexture, glowTexture } from '../engine/textures.js';
import { makeRng, rand, clamp } from '../engine/util.js';

const BOX = { x: 46, y: 26, z: 46 };

export class Rain {
  constructor(scene, settings, intensity = 1) {
    this.scene = scene;
    this.intensity = intensity;
    this.count = Math.floor(settings.rainCount * intensity);
    this.enabled = this.count > 0;
    if (!this.enabled) return;

    const rng = makeRng(3312);
    const positions = new Float32Array(this.count * 3);
    const speeds = new Float32Array(this.count);
    for (let i = 0; i < this.count; i++) {
      positions[i * 3] = rand(rng, -BOX.x, BOX.x);
      positions[i * 3 + 1] = rand(rng, -4, BOX.y);
      positions[i * 3 + 2] = rand(rng, -BOX.z, BOX.z);
      speeds[i] = rand(rng, 26, 42);
    }
    this.speeds = speeds;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    // The box moves with the camera, so per-frame culling would be wrong.
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 80);

    this.material = new THREE.PointsMaterial({
      map: rainTexture(),
      size: 0.6,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      color: 0xc8dcf0,
      fog: true,
    });

    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 8;
    scene.add(this.points);

    this.geo = geo;
    this._drift = new THREE.Vector3();
    this._rng = rng;
  }

  /**
   * @param camPos    camera world position — the volume centres on this
   * @param velocity  rider velocity, used to slant the fall
   */
  update(dt, camPos, velocity) {
    if (!this.enabled) return;
    const pos = this.geo.attributes.position.array;
    const rng = this._rng;

    // The whole volume is parented to the camera, so particle coordinates stay
    // local and wrapping is a plain range check — no world-space bookkeeping.
    // Moving it first means this frame's motion is already relative to the new
    // centre, which avoids a one-frame smear when the camera jumps on respawn.
    const prevX = this.points.position.x;
    const prevZ = this.points.position.z;
    this.points.position.set(camPos.x, camPos.y, camPos.z);
    const camDx = camPos.x - prevX;
    const camDz = camPos.z - prevZ;

    // Slant grows with speed but saturates: fully horizontal rain looks wrong.
    const slant = clamp(velocity.length() / 60, 0, 1.1);
    this._drift.copy(velocity);
    if (this._drift.lengthSq() > 1e-6) this._drift.normalize();
    this._drift.multiplyScalar(-slant * 22);
    const dx = this._drift.x * dt - camDx;
    const dz = this._drift.z * dt - camDz;

    for (let i = 0; i < this.count; i++) {
      const i3 = i * 3;
      pos[i3] += dx;
      pos[i3 + 1] -= this.speeds[i] * dt;
      pos[i3 + 2] += dz;

      if (pos[i3 + 1] < -8) {
        pos[i3 + 1] = BOX.y;
        pos[i3] = rand(rng, -BOX.x, BOX.x);
        pos[i3 + 2] = rand(rng, -BOX.z, BOX.z);
      }
      if (pos[i3] > BOX.x) pos[i3] -= BOX.x * 2;
      else if (pos[i3] < -BOX.x) pos[i3] += BOX.x * 2;
      if (pos[i3 + 2] > BOX.z) pos[i3 + 2] -= BOX.z * 2;
      else if (pos[i3 + 2] < -BOX.z) pos[i3 + 2] += BOX.z * 2;
    }
    this.geo.attributes.position.needsUpdate = true;
  }

  dispose() {
    if (!this.enabled) return;
    this.scene.remove(this.points);
    this.geo.dispose();
    this.material.dispose();
  }
}

/**
 * Particle puffs thrown up behind the rear wheel: spray on a wet road, dust
 * on a dry one, plus tyre smoke when the rear breaks traction.
 */
export class Spray {
  constructor(scene, settings, wet) {
    this.scene = scene;
    this.enabled = settings.sparks;
    this.wet = wet;
    this.max = settings.name === 'low' ? 40 : 110;
    this.alive = 0;

    this.pos = new Float32Array(this.max * 3);
    this.vel = new Float32Array(this.max * 3);
    this.life = new Float32Array(this.max);
    this.maxLife = new Float32Array(this.max);
    this.size = new Float32Array(this.max);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aScale', new THREE.BufferAttribute(this.size, 1));
    geo.setDrawRange(0, 0);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);

    this.material = new THREE.PointsMaterial({
      map: glowTexture(0.1),
      size: 1.0,
      sizeAttenuation: true,
      transparent: true,
      opacity: wet ? 0.32 : 0.28,
      depthWrite: false,
      color: wet ? 0xdce8f4 : 0xc9bda6,
      fog: true,
    });
    // PointsMaterial has only a uniform size; patch in a per-particle multiplier
    // so puffs can grow as they dissipate.
    this.material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('void main() {', 'attribute float aScale;\nvoid main() {')
        .replace('gl_PointSize = size;', 'gl_PointSize = size * aScale;');
    };

    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 7;
    scene.add(this.points);
    this.geo = geo;
    this._rng = makeRng(551);
  }

  /** Emit `n` particles from a world position with a base velocity. */
  emit(n, origin, baseVel, spread = 2.5) {
    if (!this.enabled) return;
    const rng = this._rng;
    for (let k = 0; k < n && this.alive < this.max; k++) {
      const i = this.alive++;
      const i3 = i * 3;
      this.pos[i3] = origin.x + rand(rng, -0.2, 0.2);
      this.pos[i3 + 1] = origin.y + rand(rng, 0, 0.2);
      this.pos[i3 + 2] = origin.z + rand(rng, -0.2, 0.2);
      this.vel[i3] = baseVel.x * 0.18 + rand(rng, -spread, spread);
      this.vel[i3 + 1] = rand(rng, 1.2, 4.0);
      this.vel[i3 + 2] = baseVel.z * 0.18 + rand(rng, -spread, spread);
      this.maxLife[i] = rand(rng, 0.35, 0.9);
      this.life[i] = this.maxLife[i];
      this.size[i] = rand(rng, 0.4, 1.3);
    }
  }

  update(dt) {
    if (!this.enabled) return;
    for (let i = this.alive - 1; i >= 0; i--) {
      const i3 = i * 3;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // Swap-remove keeps the live particles packed at the front of the
        // buffer, so the draw range stays tight without a sort.
        const last = --this.alive;
        if (last !== i) {
          const l3 = last * 3;
          this.pos[i3] = this.pos[l3]; this.pos[i3 + 1] = this.pos[l3 + 1]; this.pos[i3 + 2] = this.pos[l3 + 2];
          this.vel[i3] = this.vel[l3]; this.vel[i3 + 1] = this.vel[l3 + 1]; this.vel[i3 + 2] = this.vel[l3 + 2];
          this.life[i] = this.life[last];
          this.maxLife[i] = this.maxLife[last];
          this.size[i] = this.size[last];
        }
        continue;
      }
      this.vel[i3 + 1] -= 7 * dt;              // gravity, softened
      this.vel[i3] *= 1 - dt * 1.6;            // air drag
      this.vel[i3 + 2] *= 1 - dt * 1.6;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      // Grow as they dissipate.
      this.size[i] += dt * 1.4;
    }
    this.geo.setDrawRange(0, this.alive);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aScale.needsUpdate = true;
  }

  clear() {
    this.alive = 0;
    if (this.geo) this.geo.setDrawRange(0, 0);
  }

  dispose() {
    if (!this.points) return;
    this.scene.remove(this.points);
    this.geo.dispose();
    this.material.dispose();
  }
}
