/**
 * Road, verge, terrain and barrier geometry.
 *
 * The course is emitted as fixed-length chunks so the frustum can cull most of
 * it. Within a chunk every surface is one ribbon of quads swept along the
 * centreline, which keeps the vertex count low and the normals continuous.
 */

import * as THREE from 'three';
import {
  roadTexture, roadRoughnessTexture, grassTexture, dirtTexture, concreteTexture,
} from '../engine/textures.js';
import { makeNoise1D, fbm1D, clamp, lerp, makeCanvas } from '../engine/util.js';

/** Metres of course per chunk. */
const CHUNK = 240;
/** Metres of road covered by one vertical repeat of the road texture. */
const ROAD_TILE = 32;

/**
 * Lateral offsets, as multiples/offsets from the road edge, that make up the
 * terrain skirt on each side. Index 0 sits at the outer edge of the verge.
 */
const TERRAIN_STEPS = [0, 5, 14, 30, 60, 110, 190];

export class RoadBuilder {
  constructor(track, settings, sky) {
    this.track = track;
    this.settings = settings;
    this.sky = sky;
    this.group = new THREE.Group();
    this.group.name = 'road';
    this.disposables = [];
    this.terrainNoise = makeNoise1D(track.preset.seed + 4242);
  }

  build() {
    this._makeMaterials();
    const chunks = Math.ceil(this.track.length / CHUNK);
    for (let c = 0; c < chunks; c++) {
      const s0 = c * CHUNK;
      const s1 = Math.min(this.track.length, s0 + CHUNK);
      this._buildChunk(s0, s1);
    }
    this._buildStartFinish();
    return this.group;
  }

  /* ----------------------------------------------------------------
     Materials
     ---------------------------------------------------------------- */

  _makeMaterials() {
    const p = this.track.preset;
    const wet = this.sky.preset.wet;
    const aniso = this.settings.anisotropy;

    const roadMap = roadTexture({ wet, aniso });
    roadMap.repeat.set(1, 1);
    const roadRough = roadRoughnessTexture({ wet });

    this.roadMat = new THREE.MeshStandardMaterial({
      map: roadMap,
      roughnessMap: roadRough,
      roughness: wet ? 0.34 : 0.92,
      metalness: wet ? 0.35 : 0.04,
      envMapIntensity: wet ? 1.5 : 0.35,
      color: wet ? 0x8d949c : 0xffffff,
    });

    const vergeIsSidewalk = p.guardrail === 'kerb';
    const vergeMap = vergeIsSidewalk ? concreteTexture() : dirtTexture();
    this.vergeMat = new THREE.MeshStandardMaterial({
      map: vergeMap,
      roughness: wet ? 0.6 : 0.95,
      metalness: 0,
      envMapIntensity: wet ? 0.7 : 0.3,
      color: vergeIsSidewalk ? 0xb9bcbb : 0xffffff,
    });

    const groundMap = vergeIsSidewalk ? concreteTexture() : grassTexture(p.grass);
    this.terrainMat = new THREE.MeshStandardMaterial({
      map: groundMap,
      roughness: 0.98,
      metalness: 0,
      envMapIntensity: 0.2,
      color: vergeIsSidewalk ? 0x4a4d52 : 0xffffff,
    });

    this.railMat = new THREE.MeshStandardMaterial({
      color: 0xb8bcc2,
      roughness: 0.45,
      metalness: 0.85,
      envMapIntensity: 1.0,
      side: THREE.DoubleSide,
    });

    this.kerbMat = new THREE.MeshStandardMaterial({
      color: 0xa8aaa8,
      roughness: 0.85,
      metalness: 0.0,
    });

    this.disposables.push(this.roadMat, this.vergeMat, this.terrainMat, this.railMat, this.kerbMat);
  }

  /* ----------------------------------------------------------------
     Chunk assembly
     ---------------------------------------------------------------- */

  _buildChunk(s0, s1) {
    const track = this.track;
    const ds = track.ds;
    const rows = Math.max(2, Math.round((s1 - s0) / ds) + 1);
    const HW = track.halfWidth;
    const SH = track.shoulder;
    const isCity = track.preset.guardrail === 'kerb';

    // Sample the centreline once and reuse it for every surface in the chunk.
    const line = [];
    const c = {};
    for (let r = 0; r < rows; r++) {
      const s = s0 + (r / (rows - 1)) * (s1 - s0);
      track.sample(s, c);
      line.push({
        s,
        x: c.x, y: c.y, z: c.z,
        cosH: Math.cos(c.heading),
        sinH: Math.sin(c.heading),
        camber: c.camber,
      });
    }

    const centre = new THREE.Vector3(
      (line[0].x + line[rows - 1].x) * 0.5,
      (line[0].y + line[rows - 1].y) * 0.5,
      (line[0].z + line[rows - 1].z) * 0.5,
    );

    // --- road surface -------------------------------------------------
    this._ribbon(line, centre, [[-HW, -HW * 0.5, 0, HW * 0.5, HW]], this.roadMat, {
      uv: (lat) => (lat + HW) / (2 * HW),
      vScale: 1 / ROAD_TILE,
      yOffset: () => 0,
    });

    // --- verge / sidewalk ---------------------------------------------
    const vergeLift = isCity ? 0.16 : -0.06;   // city kerbs step up, dirt steps down
    this._ribbon(line, centre, [
      [-(HW + SH), -(HW + 0.35), -HW],
      [HW, HW + 0.35, HW + SH],
    ], this.vergeMat, {
      uv: (lat) => (Math.abs(lat) - HW) / 2.5,
      vScale: 1 / 6,
      yOffset: (lat) => (Math.abs(lat) <= HW + 0.02 ? -0.01 : vergeLift),
    });

    // --- terrain skirt --------------------------------------------------
    const outer = HW + SH;
    this._ribbon(line, centre, [
      TERRAIN_STEPS.map((d) => -(outer + d)).reverse(),
      TERRAIN_STEPS.map((d) => outer + d),
    ], this.terrainMat, {
      worldUv: true,
      yOffset: (lat, pt) => this._terrainHeight(lat, pt, vergeLift),
    });

    // --- barriers -------------------------------------------------------
    if (track.preset.guardrail === 'metal') {
      this._guardrail(line, centre, outer - 0.25);
    } else {
      this._kerb(line, centre, HW + 0.18, vergeLift);
    }
  }

  /**
   * Height of the terrain at a lateral offset, relative to the road surface.
   * Rises away from the road with fractal noise so the course sits in a shallow
   * cutting rather than on a flat plain.
   */
  _terrainHeight(lat, pt, vergeLift) {
    const track = this.track;
    const outer = track.halfWidth + track.shoulder;
    const dist = Math.abs(lat) - outer;
    if (dist <= 0.001) return vergeLift;

    const p = track.preset;
    const amp = p.scenery === 'canyon' ? 3.2 : p.scenery === 'city' ? 0.5 : 1.5;
    // Blend in over the first 15 m so the shoulder joins the terrain cleanly.
    const blend = clamp(dist / 15, 0, 1);
    const n = fbm1D(this.terrainNoise, (pt.s * 0.013) + Math.abs(lat) * 0.05, 3, 2.0, 0.5);

    // A gentle embankment: down at the edge, then climbing away.
    const bank = -0.9 + Math.pow(clamp(dist / 60, 0, 1), 0.75) * amp * 7;
    const roughness = n * amp * (1.2 + dist * 0.05) * blend;
    return lerp(vergeLift, bank + roughness, blend);
  }

  /**
   * Sweep one or more lateral spans along the sampled centreline.
   *
   * `strips` is an array of lat arrays; every strip lands in a single geometry
   * so the left and right verges (or terrain skirts) cost one draw call
   * between them rather than one each. Lateral offsets within a strip must
   * increase, which is what makes the shared winding face upward.
   *
   * `opts.uv(lat)` gives U; when `opts.worldUv` is set, UVs come from world XZ.
   */
  _ribbon(line, centre, strips, material, opts = {}) {
    const rows = line.length;
    let vertCount = 0;
    let quadCount = 0;
    for (const lats of strips) {
      vertCount += rows * lats.length;
      quadCount += (rows - 1) * (lats.length - 1);
    }

    const positions = new Float32Array(vertCount * 3);
    const uvs = new Float32Array(vertCount * 2);
    const indices = new (vertCount > 65535 ? Uint32Array : Uint16Array)(quadCount * 6);

    let vi = 0;
    let ui = 0;
    let ii = 0;
    let base = 0;

    for (const lats of strips) {
      const cols = lats.length;
      for (let r = 0; r < rows; r++) {
        const pt = line[r];
        const sinCam = Math.sin(pt.camber);
        for (let cIdx = 0; cIdx < cols; cIdx++) {
          const lat = lats[cIdx];
          const dy = opts.yOffset ? opts.yOffset(lat, pt) : 0;
          const x = pt.x + pt.cosH * lat;
          const y = pt.y + sinCam * lat + dy;
          const z = pt.z - pt.sinH * lat;
          positions[vi++] = x - centre.x;
          positions[vi++] = y - centre.y;
          positions[vi++] = z - centre.z;

          if (opts.worldUv) {
            uvs[ui++] = x / 26;
            uvs[ui++] = z / 26;
          } else {
            uvs[ui++] = opts.uv(lat);
            uvs[ui++] = pt.s * (opts.vScale ?? 1 / 8);
          }
        }
      }

      for (let r = 0; r < rows - 1; r++) {
        for (let cIdx = 0; cIdx < cols - 1; cIdx++) {
          const a = base + r * cols + cIdx;
          const b = a + 1;
          const d = a + cols;
          const e = d + 1;
          // Columns run left-to-right (+X) and rows run forward (+Z), so this
          // order is the one whose face normal points at the sky.
          indices[ii++] = a; indices[ii++] = d; indices[ii++] = b;
          indices[ii++] = b; indices[ii++] = d; indices[ii++] = e;
        }
      }
      base += rows * cols;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    const mesh = new THREE.Mesh(geo, material);
    mesh.position.copy(centre);
    mesh.receiveShadow = this.settings.shadows;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.group.add(mesh);
    this.disposables.push(geo);
    return mesh;
  }

  /**
   * W-profile steel guardrail down both shoulders, plus posts every 4 m.
   *
   * Both sides land in one geometry and one InstancedMesh: a barrier is two
   * thin strips of metal, and paying four draw calls per chunk for them is not
   * a trade worth making on a phone.
   */
  _guardrail(line, centre, lat) {
    // (lateral offset from the rail line, height) tracing the beam section.
    // The mirrored side reuses it with the offsets negated.
    const section = [
      [0.0, 0.42], [0.09, 0.52], [0.0, 0.62],
      [0.0, 0.72], [0.09, 0.82], [0.0, 0.92],
    ];
    const rows = line.length;
    const cols = section.length;
    const sides = [1, -1];
    const vertCount = rows * cols * sides.length;
    const quadCount = (rows - 1) * (cols - 1) * sides.length;

    const positions = new Float32Array(vertCount * 3);
    const uvs = new Float32Array(vertCount * 2);
    const indices = new (vertCount > 65535 ? Uint32Array : Uint16Array)(quadCount * 6);

    let vi = 0;
    let ui = 0;
    let ii = 0;
    let base = 0;

    for (const side of sides) {
      for (let r = 0; r < rows; r++) {
        const pt = line[r];
        const sinCam = Math.sin(pt.camber);
        for (let c = 0; c < cols; c++) {
          const [dl, h] = section[c];
          const l = side * (lat + dl);
          positions[vi++] = pt.x + pt.cosH * l - centre.x;
          positions[vi++] = pt.y + sinCam * l + h - centre.y;
          positions[vi++] = pt.z - pt.sinH * l - centre.z;
          uvs[ui++] = c / (cols - 1);
          uvs[ui++] = pt.s / 4;
        }
      }
      for (let r = 0; r < rows - 1; r++) {
        for (let c = 0; c < cols - 1; c++) {
          const a = base + r * cols + c;
          const b = a + 1;
          const d = a + cols;
          const e = d + 1;
          indices[ii++] = a; indices[ii++] = d; indices[ii++] = b;
          indices[ii++] = b; indices[ii++] = d; indices[ii++] = e;
        }
      }
      base += rows * cols;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    const mesh = new THREE.Mesh(geo, this.railMat);
    mesh.position.copy(centre);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.group.add(mesh);
    this.disposables.push(geo);

    // Posts for both sides, batched into one instanced mesh per chunk.
    const step = 4;
    const perSide = Math.max(1, Math.floor((line[rows - 1].s - line[0].s) / step));
    const postGeo = new THREE.BoxGeometry(0.12, 0.95, 0.12);
    const posts = new THREE.InstancedMesh(postGeo, this.railMat, perSide * sides.length);
    posts.castShadow = false;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3(1, 1, 1);
    const euler = new THREE.Euler();

    let instance = 0;
    for (const side of sides) {
      for (let i = 0; i < perSide; i++) {
        const r = Math.min(rows - 1, Math.floor((i / perSide) * (rows - 1)));
        const pt = line[r];
        const l = side * lat;
        pos.set(
          pt.x + pt.cosH * l - centre.x,
          pt.y + Math.sin(pt.camber) * l + 0.32 - centre.y,
          pt.z - pt.sinH * l - centre.z,
        );
        euler.set(0, Math.atan2(pt.sinH, pt.cosH), 0);   // = heading
        q.setFromEuler(euler);
        m.compose(pos, q, scale);
        posts.setMatrixAt(instance++, m);
      }
    }
    posts.instanceMatrix.needsUpdate = true;
    posts.position.copy(centre);
    posts.matrixAutoUpdate = false;
    posts.updateMatrix();
    posts.computeBoundingSphere();
    this.group.add(posts);
    this.disposables.push(postGeo);
  }

  /** City kerb: a low concrete lip between road and sidewalk, both sides. */
  _kerb(line, centre, lat, lift) {
    const rows = line.length;
    const sides = [1, -1];
    const cols = 3;
    const vertCount = rows * cols * sides.length;
    const quadCount = (rows - 1) * (cols - 1) * sides.length;

    const positions = new Float32Array(vertCount * 3);
    const uvs = new Float32Array(vertCount * 2);
    const indices = new (vertCount > 65535 ? Uint32Array : Uint16Array)(quadCount * 6);

    let vi = 0;
    let ui = 0;
    let ii = 0;
    let base = 0;

    for (const side of sides) {
      // Columns must run left-to-right in lateral order for the shared winding
      // to face up and roadward, so the left-hand kerb traces the other way.
      const profile = [[0, 0], [0, 0.15 + lift], [0.22 * side, 0.15 + lift]];
      if (side < 0) profile.reverse();

      for (let r = 0; r < rows; r++) {
        const pt = line[r];
        const sinCam = Math.sin(pt.camber);
        for (let c = 0; c < cols; c++) {
          const [dl, h] = profile[c];
          const l = side * lat + dl;
          positions[vi++] = pt.x + pt.cosH * l - centre.x;
          positions[vi++] = pt.y + sinCam * l + h - centre.y;
          positions[vi++] = pt.z - pt.sinH * l - centre.z;
          uvs[ui++] = c / (cols - 1);
          uvs[ui++] = pt.s / 3;
        }
      }
      for (let r = 0; r < rows - 1; r++) {
        for (let c = 0; c < cols - 1; c++) {
          const a = base + r * cols + c;
          const b = a + 1;
          const d = a + cols;
          const e = d + 1;
          indices[ii++] = a; indices[ii++] = d; indices[ii++] = b;
          indices[ii++] = b; indices[ii++] = d; indices[ii++] = e;
        }
      }
      base += rows * cols;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, this.kerbMat);
    mesh.position.copy(centre);
    mesh.receiveShadow = this.settings.shadows;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.group.add(mesh);
    this.disposables.push(geo);
  }

  /* ----------------------------------------------------------------
     Start / finish banding
     ---------------------------------------------------------------- */

  _buildStartFinish() {
    const tex = checkerTexture();
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.7,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    this.disposables.push(mat);

    for (const s of [this.track.startS, this.track.finishS]) {
      this.group.add(this._band(s, 2.4, mat));
    }

    // A gantry over the finish so it reads from a long way out.
    this.group.add(this._gantry(this.track.finishS));
  }

  _band(s, depth, material) {
    const track = this.track;
    const HW = track.halfWidth;
    const geo = new THREE.PlaneGeometry(HW * 2, depth, 4, 1);
    const positions = geo.attributes.position;
    const c0 = track.sample(s - depth / 2, {});
    const centre = new THREE.Vector3(c0.x, c0.y, c0.z);
    const tmp = {};
    for (let i = 0; i < positions.count; i++) {
      // Negating X mirrors the plane laterally, which is what keeps the
      // inherited winding facing up once +Y is remapped onto the course
      // direction. The band is symmetric, so the mirror is invisible.
      const lat = -positions.getX(i);
      const along = positions.getY(i);
      track.sample(s + along, tmp);
      const cosH = Math.cos(tmp.heading);
      const sinH = Math.sin(tmp.heading);
      positions.setXYZ(
        i,
        tmp.x + cosH * lat - centre.x,
        tmp.y + Math.sin(tmp.camber) * lat + 0.02 - centre.y,
        tmp.z - sinH * lat - centre.z,
      );
    }
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    this.disposables.push(geo);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.copy(centre);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    return mesh;
  }

  _gantry(s) {
    const track = this.track;
    const HW = track.halfWidth;
    const group = new THREE.Group();
    const c = track.sample(s, {});
    group.position.set(c.x, c.y, c.z);
    group.rotation.y = c.heading;

    const postMat = new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.6, metalness: 0.6 });
    const bannerMat = new THREE.MeshStandardMaterial({
      color: 0x2fd98a,
      emissive: 0x1f8f5c,
      emissiveIntensity: 0.7,
      roughness: 0.5,
    });
    this.disposables.push(postMat, bannerMat);

    const postGeo = new THREE.CylinderGeometry(0.22, 0.26, 7, 8);
    this.disposables.push(postGeo);
    for (const sign of [-1, 1]) {
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(sign * (HW + 1.2), 3.5, 0);
      post.castShadow = this.settings.shadows;
      group.add(post);
    }
    const beamGeo = new THREE.BoxGeometry((HW + 1.4) * 2, 1.5, 0.5);
    this.disposables.push(beamGeo);
    const beam = new THREE.Mesh(beamGeo, bannerMat);
    beam.position.set(0, 6.6, 0);
    group.add(beam);

    return group;
  }

  dispose() {
    for (const d of this.disposables) d.dispose?.();
    this.disposables.length = 0;
    this.group.clear();
  }
}

let _checker = null;
function checkerTexture() {
  if (_checker) return _checker;
  const S = 256;
  const canvas = makeCanvas(S, 64);
  const ctx = canvas.getContext('2d');
  const cell = 32;
  for (let y = 0; y < 64; y += cell) {
    for (let x = 0; x < S; x += cell) {
      const on = ((x / cell) + (y / cell)) % 2 === 0;
      ctx.fillStyle = on ? '#f2f4f6' : '#16181c';
      ctx.fillRect(x, y, cell, cell);
    }
  }
  _checker = new THREE.CanvasTexture(canvas);
  _checker.colorSpace = THREE.SRGBColorSpace;
  _checker.wrapS = THREE.RepeatWrapping;
  _checker.repeat.set(6, 1);
  return _checker;
}
