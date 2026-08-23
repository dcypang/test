/**
 * Scenery: the geometry library for roadside props and the rules that place
 * them along the course.
 *
 * Props are grouped into fixed-length regions and emitted as one InstancedMesh per
 * (region, type). Regions give the frustum something to cull; instancing keeps
 * each visible region down to a handful of draw calls.
 */

import * as THREE from 'three';
import { mergeGeometries, colorize, distort, instanceFrom, roundedBox } from '../engine/geometry.js';
import { buildingTextures, glowTexture } from '../engine/textures.js';
import { makeRng, rand, pick, clamp, lerp, TAU } from '../engine/util.js';

const REGION = 500;

/** Prop types small enough to be worth a shadow. */
const SHADOW_CASTERS = new Set(['pine', 'broadleaf', 'palm', 'bush', 'rock', 'pole', 'fence', 'sign', 'lamp', 'barrier']);

/* ==================================================================
   Prop geometry
   ================================================================== */

/** Conifer: tapered trunk with three stacked skirts. Base sits at y = 0. */
function pineGeometry(rng) {
  const parts = [];
  const h = rand(rng, 5.5, 9.5);
  const trunkH = h * 0.26;
  const trunk = new THREE.CylinderGeometry(h * 0.022, h * 0.04, trunkH, 5);
  trunk.translate(0, trunkH / 2, 0);
  parts.push(colorize(trunk, 0x4a3527));

  const tiers = 3;
  let y = trunkH * 0.75;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1 || 1);
    const r = lerp(h * 0.24, h * 0.10, t);
    const ch = lerp(h * 0.42, h * 0.30, t);
    const cone = new THREE.ConeGeometry(r, ch, 7);
    cone.translate(0, y + ch / 2, 0);
    // Darker toward the base of each skirt, which reads as self-shadowing.
    parts.push(colorize(cone, new THREE.Color(0x2f5226).multiplyScalar(lerp(0.78, 1.12, t))));
    y += ch * 0.58;
  }
  return mergeGeometries(parts);
}

/** Broadleaf: trunk plus a clump of low-poly canopy spheres. */
function broadleafGeometry(rng) {
  const parts = [];
  const h = rand(rng, 4.5, 8);
  const trunkH = h * 0.45;
  const trunk = new THREE.CylinderGeometry(h * 0.035, h * 0.06, trunkH, 6);
  trunk.translate(0, trunkH / 2, 0);
  parts.push(colorize(trunk, 0x53412e));

  const blobs = 4 + Math.floor(rng() * 3);
  const green = new THREE.Color(0x3f6b2c);
  for (let i = 0; i < blobs; i++) {
    // Detail 1: at detail 0 a canopy this size reads as a faceted boulder.
    const r = h * rand(rng, 0.13, 0.21);
    const blob = new THREE.IcosahedronGeometry(r, 1);
    blob.translate(
      rand(rng, -h * 0.16, h * 0.16),
      trunkH + rand(rng, 0, h * 0.34),
      rand(rng, -h * 0.16, h * 0.16),
    );
    parts.push(colorize(blob, green.clone().multiplyScalar(rand(rng, 0.72, 1.24))));
  }
  return mergeGeometries(parts);
}

/** Palm: a leaning trunk with drooping fronds — the city street tree. */
function palmGeometry(rng) {
  const parts = [];
  const h = rand(rng, 7, 12);
  const segs = 6;
  const lean = rand(rng, -0.16, 0.16);
  for (let i = 0; i < segs; i++) {
    const t = i / segs;
    const segH = h / segs;
    const r = lerp(h * 0.028, h * 0.016, t);
    const seg = new THREE.CylinderGeometry(r, r * 1.1, segH * 1.05, 6);
    // Bend the trunk progressively so it curves rather than kinks.
    seg.translate(Math.sin(t * 1.4) * lean * h, segH * (i + 0.5), 0);
    parts.push(colorize(seg, new THREE.Color(0x6b5a42).multiplyScalar(lerp(0.85, 1.1, t))));
  }

  const topX = Math.sin(1.4) * lean * h;
  const fronds = 9;
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * TAU + rng() * 0.3;
    const len = h * rand(rng, 0.28, 0.42);
    const frond = new THREE.ConeGeometry(h * 0.05, len, 4, 1, true);
    frond.rotateZ(Math.PI / 2);
    frond.translate(len / 2, 0, 0);
    // Fronds arch outward and down.
    const droop = rand(rng, -0.75, -0.25);
    frond.rotateZ(droop);
    frond.rotateY(a);
    frond.translate(topX, h, 0);
    parts.push(colorize(frond, new THREE.Color(0x3d6b30).multiplyScalar(rand(rng, 0.8, 1.2))));
  }
  return mergeGeometries(parts);
}

function bushGeometry(rng, dry = false) {
  const parts = [];
  const base = dry ? 0x6d6a3c : 0x3d5c2a;
  const blobs = 2 + Math.floor(rng() * 3);
  for (let i = 0; i < blobs; i++) {
    const r = rand(rng, 0.5, 1.1);
    const blob = new THREE.IcosahedronGeometry(r, 0);
    blob.scale(1, 0.75, 1);
    blob.translate(rand(rng, -0.5, 0.5), r * 0.7, rand(rng, -0.5, 0.5));
    parts.push(colorize(blob, new THREE.Color(base).multiplyScalar(rand(rng, 0.75, 1.25))));
  }
  return mergeGeometries(parts);
}

function rockGeometry(rng, scale = 1) {
  const geo = new THREE.IcosahedronGeometry(scale, 1);
  distort(geo, (x, y, z) => (Math.sin(x * 3.1 + y * 2.3) + Math.cos(z * 2.7 - y * 1.9)) * scale * 0.16);
  geo.scale(1, rand(rng, 0.55, 0.9), 1);
  geo.translate(0, scale * 0.35, 0);
  return colorize(geo, new THREE.Color(0x6d6357).multiplyScalar(rand(rng, 0.8, 1.2)));
}

/** Wooden ranch fence: one post plus the two rails that run from it. */
function fenceGeometry() {
  const parts = [];
  const wood = 0x7a6248;
  const post = new THREE.BoxGeometry(0.12, 1.25, 0.12);
  post.translate(0, 0.62, 0);
  parts.push(colorize(post, wood));
  for (const y of [0.5, 0.95]) {
    const rail = new THREE.BoxGeometry(0.08, 0.11, 3.0);
    rail.translate(0, y, 1.5);
    parts.push(colorize(rail, new THREE.Color(wood).multiplyScalar(1.12)));
  }
  return mergeGeometries(parts);
}

/** Timber utility pole with a crossarm — the highway's vertical rhythm. */
function powerPoleGeometry(rng) {
  const parts = [];
  const h = rand(rng, 10, 12.5);
  const pole = new THREE.CylinderGeometry(0.13, 0.19, h, 7);
  pole.translate(0, h / 2, 0);
  parts.push(colorize(pole, 0x5d4c3a));

  const arm = new THREE.BoxGeometry(2.6, 0.16, 0.16);
  arm.translate(0, h - 0.7, 0);
  parts.push(colorize(arm, 0x4f4133));

  const arm2 = new THREE.BoxGeometry(1.9, 0.14, 0.14);
  arm2.translate(0, h - 1.7, 0);
  parts.push(colorize(arm2, 0x4f4133));

  for (const x of [-1.1, 0, 1.1]) {
    const ins = new THREE.CylinderGeometry(0.08, 0.09, 0.22, 6);
    ins.translate(x, h - 0.5, 0);
    parts.push(colorize(ins, 0x9aa0a6));
  }
  return mergeGeometries(parts);
}

/** Cantilever street lamp. Returns the pole and the lens separately. */
function streetLampGeometry() {
  const parts = [];
  const h = 9.0;
  const pole = new THREE.CylinderGeometry(0.11, 0.16, h, 8);
  pole.translate(0, h / 2, 0);
  parts.push(colorize(pole, 0x3f464d));

  // Curved arm: short segments swung through a quarter turn.
  const segs = 6;
  const reach = 3.2;
  for (let i = 0; i < segs; i++) {
    const t = i / segs;
    const a = t * (Math.PI / 2);
    const seg = new THREE.CylinderGeometry(0.085, 0.09, 0.72, 6);
    seg.rotateZ(-Math.PI / 2 + a * 0.85);
    seg.translate(
      Math.sin(a) * reach,
      h + (1 - Math.cos(a)) * 1.0,
      0,
    );
    parts.push(colorize(seg, 0x3f464d));
  }

  const housing = new THREE.BoxGeometry(1.0, 0.2, 0.42);
  housing.translate(reach + 0.35, h + 0.92, 0);
  parts.push(colorize(housing, 0x353b41));

  const pole0 = mergeGeometries(parts);

  const lens = new THREE.BoxGeometry(0.86, 0.09, 0.34);
  lens.translate(reach + 0.35, h + 0.80, 0);

  return { pole: pole0, lens, reach, height: h + 0.8 };
}

function trafficLightGeometry() {
  const parts = [];
  const h = 6.4;
  const pole = new THREE.CylinderGeometry(0.11, 0.15, h, 8);
  pole.translate(0, h / 2, 0);
  parts.push(colorize(pole, 0x2f353b));
  const arm = new THREE.BoxGeometry(4.0, 0.14, 0.14);
  arm.translate(2.0, h - 0.2, 0);
  parts.push(colorize(arm, 0x2f353b));
  const box = new THREE.BoxGeometry(0.42, 1.15, 0.34);
  box.translate(3.6, h - 0.85, 0);
  parts.push(colorize(box, 0x21262b));
  return { pole: mergeGeometries(parts), lampY: h - 1.2, lampX: 3.6 };
}

function signGeometry(rng, kind = 'warn') {
  const parts = [];
  const h = rand(rng, 2.0, 2.6);
  const post = new THREE.CylinderGeometry(0.05, 0.05, h, 6);
  post.translate(0, h / 2, 0);
  parts.push(colorize(post, 0x8b9096));

  if (kind === 'warn') {
    // Diamond warning board.
    const panel = new THREE.BoxGeometry(0.95, 0.95, 0.06);
    panel.rotateZ(Math.PI / 4);
    panel.translate(0, h + 0.3, 0);
    parts.push(colorize(panel, 0xe8b830));
  } else if (kind === 'chevron') {
    const panel = new THREE.BoxGeometry(0.55, 0.8, 0.06);
    panel.translate(0, h + 0.2, 0);
    parts.push(colorize(panel, 0xe8b830));
  } else {
    const panel = new THREE.BoxGeometry(1.6, 1.0, 0.07);
    panel.translate(0, h + 0.4, 0);
    parts.push(colorize(panel, 0x2f6b3c));
  }
  return mergeGeometries(parts);
}

function billboardGeometry(rng) {
  const parts = [];
  const w = rand(rng, 7, 10);
  const h = w * 0.42;
  const legH = rand(rng, 4, 6.5);
  for (const x of [-w * 0.28, w * 0.28]) {
    const leg = new THREE.CylinderGeometry(0.16, 0.18, legH, 6);
    leg.translate(x, legH / 2, 0);
    parts.push(colorize(leg, 0x555b60));
  }
  const panel = new THREE.BoxGeometry(w, h, 0.28);
  panel.translate(0, legH + h / 2, 0);
  parts.push(colorize(panel, new THREE.Color().setHSL(rng(), 0.42, 0.62)));
  const frame = new THREE.BoxGeometry(w + 0.3, 0.18, 0.34);
  frame.translate(0, legH + h + 0.1, 0);
  parts.push(colorize(frame, 0x3d4348));
  return mergeGeometries(parts);
}

/** Concrete barrier / jersey block used to close off side streets. */
function barrierGeometry() {
  const geo = roundedBox(2.0, 0.85, 0.5, 0.06, 1);
  geo.translate(0, 0.42, 0);
  return colorize(geo, 0x9c9e9b);
}

/* ==================================================================
   Building blocks
   ================================================================== */

/**
 * Box with UVs scaled so windows stay roughly square at this size.
 * Top face is dark (roof), sides carry the facade.
 */
function buildingBox(w, h, d, floorHeight = 3.4, windowWidth = 3.6) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv;
  const rows = Math.max(1, Math.round(h / (floorHeight * 14)));
  const colsW = Math.max(1, Math.round(w / (windowWidth * 6)));
  const colsD = Math.max(1, Math.round(d / (windowWidth * 6)));

  // BoxGeometry face order: +X, -X, +Y, -Y, +Z, -Z, four verts each.
  const scales = [
    [colsD, rows], [colsD, rows],
    [1, 1], [1, 1],
    [colsW, rows], [colsW, rows],
  ];
  for (let face = 0; face < 6; face++) {
    const [su, sv] = scales[face];
    for (let i = 0; i < 4; i++) {
      const idx = face * 4 + i;
      uv.setXY(idx, uv.getX(idx) * su, uv.getY(idx) * sv);
    }
  }
  uv.needsUpdate = true;
  geo.translate(0, h / 2, 0);
  return geo;
}

/* ==================================================================
   Placement
   ================================================================== */

export class Scenery {
  constructor(track, settings, sky) {
    this.track = track;
    this.settings = settings;
    this.sky = sky;
    this.group = new THREE.Group();
    this.group.name = 'scenery';
    this.disposables = [];
    this.lampLights = [];
    this.rng = makeRng(track.preset.seed + 8080);
  }

  build() {
    this._materials();
    this._buildPropVariants();

    const regions = Math.ceil(this.track.length / REGION);
    for (let r = 0; r < regions; r++) {
      const s0 = r * REGION;
      const s1 = Math.min(this.track.length, s0 + REGION);
      this._placeRegion(s0, s1);
    }
    return this.group;
  }

  _materials() {
    const wet = this.sky.preset.wet;

    this.propMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0.02,
      envMapIntensity: wet ? 0.5 : 0.3,
    });

    this.lampMat = new THREE.MeshStandardMaterial({
      color: 0xfff1c8,
      emissive: 0xffd28a,
      emissiveIntensity: this.sky.preset.wet ? 5.5 : 0.2,
      roughness: 0.3,
      toneMapped: true,
    });

    this.glowMat = new THREE.MeshBasicMaterial({
      map: glowTexture(0.05),
      color: 0xffc98a,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: true,
    });

    this.haloMat = new THREE.MeshBasicMaterial({
      map: glowTexture(0.0),
      color: 0xffd9a0,
      transparent: true,
      opacity: 0.42,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    });

    this.disposables.push(this.propMat, this.lampMat, this.glowMat, this.haloMat);
  }

  /** Pre-build a handful of randomised variants of each prop type. */
  _buildPropVariants() {
    const rng = this.rng;
    const scenery = this.track.preset.scenery;

    this.variants = {};
    const add = (key, count, fn) => {
      this.variants[key] = Array.from({ length: count }, () => fn(rng));
      this.variants[key].forEach((g) => this.disposables.push(g));
    };

    if (scenery === 'rural') {
      add('pine', 4, pineGeometry);
      add('broadleaf', 3, broadleafGeometry);
      add('bush', 3, (r) => bushGeometry(r, false));
      add('rock', 2, (r) => rockGeometry(r, rand(r, 0.6, 1.4)));
      add('pole', 2, powerPoleGeometry);
      add('sign', 2, (r) => signGeometry(r, 'warn'));
      add('billboard', 2, billboardGeometry);
      this.variants.fence = [fenceGeometry()];
      this.disposables.push(this.variants.fence[0]);
    } else if (scenery === 'canyon') {
      add('rock', 4, (r) => rockGeometry(r, rand(r, 1.0, 3.0)));
      add('boulder', 3, (r) => rockGeometry(r, rand(r, 3.5, 6.5)));
      add('bush', 3, (r) => bushGeometry(r, true));
      add('pine', 2, pineGeometry);
      add('sign', 2, (r) => signGeometry(r, 'chevron'));
    } else {
      add('palm', 3, palmGeometry);
      add('bush', 2, (r) => bushGeometry(r, false));
      add('billboard', 2, billboardGeometry);
      this.variants.barrier = [barrierGeometry()];
      this.disposables.push(this.variants.barrier[0]);

      // Building shells at a few fixed footprints so UVs stay square-ish.
      this.buildingGeos = [];
      // Four footprints, not six. Each extra shape is another InstancedMesh
      // per region, and per-instance height variation already does most of the
      // work of making a skyline look varied.
      const sizes = [
        [14, 34, 16], [18, 58, 18], [12, 22, 14], [22, 78, 20],
      ];
      for (const [w, h, d] of sizes) {
        const g = buildingBox(w, h, d);
        this.buildingGeos.push(g);
        this.disposables.push(g);
      }
      this.buildingMats = [];
      for (let v = 0; v < 4; v++) {
        const { map, emissive } = buildingTextures(v, true);
        const mat = new THREE.MeshStandardMaterial({
          map,
          emissiveMap: emissive,
          emissive: 0xffffff,
          emissiveIntensity: 1.35,
          roughness: 0.62,
          metalness: 0.12,
          envMapIntensity: 0.5,
        });
        this.buildingMats.push(mat);
        this.disposables.push(mat);
      }
    }

    // Street lamps exist on every course; only the night one lights up.
    const lamp = streetLampGeometry();
    this.lampGeo = lamp.pole;
    this.lampLensGeo = lamp.lens;
    this.lampReach = lamp.reach;
    this.lampHeight = lamp.height;
    this.disposables.push(this.lampGeo, this.lampLensGeo);

    const tl = trafficLightGeometry();
    this.trafficLightGeo = tl.pole;
    this.disposables.push(this.trafficLightGeo);
  }

  /* ----------------------------------------------------------------
     Region placement
     ---------------------------------------------------------------- */

  _placeRegion(s0, s1) {
    const scenery = this.track.preset.scenery;
    const buckets = new Map();

    const push = (key, placement) => {
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(placement);
    };

    if (scenery === 'rural') this._placeRural(s0, s1, push);
    else if (scenery === 'canyon') this._placeCanyon(s0, s1, push);
    else this._placeCity(s0, s1, push);

    // Emit one InstancedMesh per (region, variant).
    for (const [key, placements] of buckets) {
      const [type, index] = key.split(':');
      const geo = this._geoFor(type, Number(index));
      const mat = this._matFor(type, Number(index));
      if (!geo || !mat) continue;
      // Only props at roughly rider scale cast shadows. A tower block inside
      // the 46 m shadow volume would eat most of the map for a result the
      // player never looks at.
      const casts = SHADOW_CASTERS.has(type);
      const mesh = instanceFrom(geo, mat, placements, {
        castShadow: this.settings.shadows && casts,
      });
      if (mesh) {
        if (type === 'glow' || type === 'halo') mesh.renderOrder = 5;
        this.group.add(mesh);
      }
    }
  }

  _geoFor(type, index) {
    if (type === 'lamp') return this.lampGeo;
    if (type === 'lens') return this.lampLensGeo;
    if (type === 'trafficlight') return this.trafficLightGeo;
    if (type === 'building') return this.buildingGeos?.[index];
    if (type === 'glow') return this._glowGeo();
    if (type === 'halo') return this._haloGeo();
    return this.variants[type]?.[index];
  }

  _matFor(type, index) {
    if (type === 'lens') return this.lampMat;
    if (type === 'building') return this.buildingMats?.[index % this.buildingMats.length];
    if (type === 'glow') return this.glowMat;
    if (type === 'halo') return this.haloMat;
    return this.propMat;
  }

  _glowGeo() {
    if (!this._glowGeoCache) {
      const g = new THREE.PlaneGeometry(1, 1);
      g.rotateX(-Math.PI / 2);
      this._glowGeoCache = g;
      this.disposables.push(g);
    }
    return this._glowGeoCache;
  }

  _haloGeo() {
    if (!this._haloGeoCache) {
      this._haloGeoCache = new THREE.PlaneGeometry(1, 1);
      this.disposables.push(this._haloGeoCache);
    }
    return this._haloGeoCache;
  }

  /** Convert a track-space placement into a world placement object. */
  _at(s, lateral, extra = {}) {
    const track = this.track;
    const c = track.sample(s, this._c || (this._c = {}));
    const cosH = Math.cos(c.heading);
    const sinH = Math.sin(c.heading);
    // Props stand on the terrain, which drops away from the road edge.
    const groundDrop = extra.onRoad ? 0 : this._groundDrop(lateral);
    return {
      x: c.x + cosH * lateral,
      y: c.y + Math.sin(c.camber) * lateral + groundDrop + (extra.dy || 0),
      z: c.z - sinH * lateral,
      // Track heading is three.js's Y rotation directly, so a prop modelled
      // facing +Z / reaching +X lines up with the road with no correction.
      rotationY: c.heading + (extra.turn || 0),
      scale: extra.scale ?? 1,
      scaleX: extra.scaleX,
      scaleY: extra.scaleY,
      scaleZ: extra.scaleZ,
      tiltX: extra.tiltX,
      tiltZ: extra.tiltZ,
    };
  }

  /**
   * Approximate the terrain skirt height used by the road builder, so props
   * sit on the ground instead of floating over it.
   */
  _groundDrop(lateral) {
    const track = this.track;
    const outer = track.halfWidth + track.shoulder;
    const dist = Math.abs(lateral) - outer;
    if (dist <= 0) return track.preset.guardrail === 'kerb' ? 0.16 : -0.06;
    const p = track.preset;
    const amp = p.scenery === 'canyon' ? 3.2 : p.scenery === 'city' ? 0.5 : 1.5;
    const blend = clamp(dist / 15, 0, 1);
    const bank = -0.9 + Math.pow(clamp(dist / 60, 0, 1), 0.75) * amp * 7;
    const base = p.guardrail === 'kerb' ? 0.16 : -0.06;
    // Ignore the noise term: props would need the exact same sample to match,
    // and being a few centimetres out is invisible next to a tree trunk.
    return lerp(base, bank, blend);
  }

  /* ---------------- rural ---------------- */

  _placeRural(s0, s1, push) {
    const rng = this.rng;
    const density = this.settings.treeDensity;
    const outer = this.track.halfWidth + this.track.shoulder;

    // Trees in a band beside the road, thinning with distance.
    const treeCount = Math.floor((s1 - s0) * 0.5 * density);
    for (let i = 0; i < treeCount; i++) {
      const s = rand(rng, s0, s1);
      const side = rng() > 0.5 ? 1 : -1;
      const lat = side * (outer + rand(rng, 8, 95) * Math.pow(rng(), 0.55));
      const isPine = rng() < 0.68;
      const type = isPine ? 'pine' : 'broadleaf';
      const index = Math.floor(rng() * this.variants[type].length);
      push(`${type}:${index}`, this._at(s, lat, {
        scale: rand(rng, 0.72, 1.32),
        turn: rng() * TAU,
        tiltZ: rand(rng, -0.04, 0.04),
      }));
    }

    // Undergrowth close to the shoulder.
    const bushCount = Math.floor((s1 - s0) * 0.22 * density);
    for (let i = 0; i < bushCount; i++) {
      const s = rand(rng, s0, s1);
      const side = rng() > 0.5 ? 1 : -1;
      push(`bush:${Math.floor(rng() * this.variants.bush.length)}`,
        this._at(s, side * (outer + rand(rng, 2, 22)), { scale: rand(rng, 0.7, 1.4), turn: rng() * TAU }));
    }

    for (let i = 0; i < Math.floor((s1 - s0) * 0.03); i++) {
      const s = rand(rng, s0, s1);
      const side = rng() > 0.5 ? 1 : -1;
      push(`rock:${Math.floor(rng() * this.variants.rock.length)}`,
        this._at(s, side * (outer + rand(rng, 3, 40)), { scale: rand(rng, 0.6, 1.8), turn: rng() * TAU }));
    }

    // Utility poles march down the left-hand side at a fixed interval.
    const poleSpacing = 48;
    for (let s = Math.ceil(s0 / poleSpacing) * poleSpacing; s < s1; s += poleSpacing) {
      push(`pole:${Math.floor(rng() * this.variants.pole.length)}`,
        this._at(s, -(outer + 6.5), { scale: rand(rng, 0.94, 1.06) }));
    }

    // Ranch fence hugging the right-hand shoulder in stretches.
    const fenceSpacing = 3;
    let fenceOn = rng() > 0.4;
    for (let s = Math.ceil(s0 / fenceSpacing) * fenceSpacing; s < s1; s += fenceSpacing) {
      if (Math.abs(s % 260) < fenceSpacing) fenceOn = rng() > 0.35;
      if (!fenceOn) continue;
      push('fence:0', this._at(s, outer + 2.4, {}));
    }

    // Occasional signage and a billboard or two.
    for (let s = s0; s < s1; s += 130) {
      if (rng() < 0.55) {
        const side = rng() > 0.5 ? 1 : -1;
        push(`sign:${Math.floor(rng() * this.variants.sign.length)}`,
          this._at(s + rand(rng, 0, 90), side * (outer + rand(rng, 1.2, 2.6)), { turn: Math.PI }));
      }
    }
    if (rng() < 0.6) {
      const side = rng() > 0.5 ? 1 : -1;
      push(`billboard:${Math.floor(rng() * this.variants.billboard.length)}`,
        this._at(rand(rng, s0, s1), side * (outer + rand(rng, 16, 34)), { turn: Math.PI }));
    }
  }

  /* ---------------- canyon ---------------- */

  _placeCanyon(s0, s1, push) {
    const rng = this.rng;
    const density = this.settings.treeDensity;
    const outer = this.track.halfWidth + this.track.shoulder;

    // Cliff walls: boulders packed along both sides, set back far enough that
    // they frame the road rather than lean over it, and sunk so they read as
    // the foot of a rock face instead of debris someone left on the racing line.
    const wallStep = 8;
    for (let s = s0; s < s1; s += wallStep) {
      for (const side of [-1, 1]) {
        if (rng() < 0.22) continue;
        const lat = side * (outer + rand(rng, 5, 16));
        push(`boulder:${Math.floor(rng() * this.variants.boulder.length)}`,
          this._at(s + rand(rng, -3, 3), lat, {
            scale: rand(rng, 0.7, 1.25),
            turn: rng() * TAU,
            dy: rand(rng, -3.5, -1.0),
          }));
      }
    }

    for (let i = 0; i < Math.floor((s1 - s0) * 0.35 * density); i++) {
      const s = rand(rng, s0, s1);
      const side = rng() > 0.5 ? 1 : -1;
      push(`rock:${Math.floor(rng() * this.variants.rock.length)}`,
        this._at(s, side * (outer + rand(rng, 2.5, 45)), { scale: rand(rng, 0.5, 1.3), turn: rng() * TAU }));
    }
    for (let i = 0; i < Math.floor((s1 - s0) * 0.25 * density); i++) {
      const s = rand(rng, s0, s1);
      const side = rng() > 0.5 ? 1 : -1;
      push(`bush:${Math.floor(rng() * this.variants.bush.length)}`,
        this._at(s, side * (outer + rand(rng, 1, 30)), { scale: rand(rng, 0.6, 1.3), turn: rng() * TAU }));
    }
    for (let i = 0; i < Math.floor((s1 - s0) * 0.05 * density); i++) {
      const s = rand(rng, s0, s1);
      const side = rng() > 0.5 ? 1 : -1;
      push(`pine:${Math.floor(rng() * this.variants.pine.length)}`,
        this._at(s, side * (outer + rand(rng, 6, 50)), { scale: rand(rng, 0.6, 1.0), turn: rng() * TAU }));
    }

    // Chevron markers on the outside of the tighter corners.
    const c = {};
    for (let s = s0; s < s1; s += 12) {
      this.track.sample(s, c);
      if (Math.abs(c.curvature) < 0.004) continue;
      const side = c.curvature > 0 ? -1 : 1;
      push(`sign:${Math.floor(rng() * this.variants.sign.length)}`,
        this._at(s, side * (outer - 0.6), { turn: Math.PI, scale: 0.9 }));
    }
  }

  /* ---------------- city ---------------- */

  _placeCity(s0, s1, push) {
    const rng = this.rng;
    const outer = this.track.halfWidth + this.track.shoulder;

    // Two rows of buildings per side: a near row at the sidewalk edge and a
    // taller back row that fills the skyline.
    for (const side of [-1, 1]) {
      let s = s0;
      while (s < s1) {
        const gap = rand(rng, 3, 14);           // side street or alley
        const isBlock = rng() > 0.16;
        if (isBlock) {
          const index = Math.floor(rng() * this.buildingGeos.length);
          const geo = this.buildingGeos[index];
          const params = geo.parameters || {};
          const depth = params.depth ?? 16;
          const width = params.width ?? 14;
          const lat = side * (outer + 2.5 + depth / 2);
          push(`building:${index}`, this._at(s + width / 2, lat, {
            scaleY: rand(rng, 0.7, 1.5),
            turn: 0,
          }));

          // Back row, taller and further out.
          if (rng() < 0.75) {
            const bIndex = Math.floor(rng() * this.buildingGeos.length);
            const bGeo = this.buildingGeos[bIndex];
            const bDepth = bGeo.parameters?.depth ?? 16;
            push(`building:${bIndex}`, this._at(
              s + rand(rng, -8, 12),
              side * (outer + 6 + depth + bDepth / 2 + rand(rng, 4, 26)),
              { scaleY: rand(rng, 1.0, 2.4), turn: rand(rng, -0.1, 0.1) },
            ));
          }
          s += width + gap;
        } else {
          // Empty lot: fence it off with concrete blocks.
          for (let b = 0; b < 4; b++) {
            push('barrier:0', this._at(s + b * 2.2, side * (outer + 1.6), {}));
          }
          s += 10 + gap;
        }
      }
    }

    // Street lamps alternate sides every 26 m, arms reaching over the road.
    const spacing = 26;
    for (let s = Math.ceil(s0 / spacing) * spacing; s < s1; s += spacing) {
      const side = (Math.round(s / spacing) % 2 === 0) ? 1 : -1;
      // The arm is modelled reaching toward +X, so a left-hand lamp is flipped.
      push('lamp:0', this._at(s, side * (outer - 0.8), { turn: side > 0 ? Math.PI : 0 }));
      push('lens:0', this._at(s, side * (outer - 0.8), { turn: side > 0 ? Math.PI : 0 }));

      if (this.settings.lightPools) {
        // Pool of light on the tarmac beneath the lamp head.
        const lampLat = side * (outer - 0.8 - this.lampReach);
        push('glow:0', this._at(s, lampLat, {
          onRoad: true,
          dy: 0.045,
          scaleX: 15,
          scaleZ: 22,
          scaleY: 1,
        }));
        // Vertical halo around the lamp itself.
        push('halo:0', this._at(s, lampLat, {
          onRoad: true,
          dy: this.lampHeight,
          scaleX: 6,
          scaleY: 6,
          scaleZ: 1,
        }));
      }
    }

    // Palms along the sidewalk between lamps.
    for (let s = s0 + 13; s < s1; s += 26) {
      const side = (Math.round(s / 26) % 2 === 0) ? -1 : 1;
      push(`palm:${Math.floor(rng() * this.variants.palm.length)}`,
        this._at(s, side * (outer - 1.0), { scale: rand(rng, 0.8, 1.2), turn: rng() * TAU }));
    }

    // Signalised junctions every few hundred metres.
    for (let s = Math.ceil(s0 / 340) * 340; s < s1; s += 340) {
      push('trafficlight:0', this._at(s, -(outer - 0.6), { turn: 0 }));
    }

    if (rng() < 0.5) {
      const side = rng() > 0.5 ? 1 : -1;
      push(`billboard:${Math.floor(rng() * this.variants.billboard.length)}`,
        this._at(rand(rng, s0, s1), side * (outer + rand(rng, 3, 10)), {
          turn: Math.PI,
          dy: rand(rng, 4, 16),
        }));
    }
  }

  dispose() {
    for (const d of this.disposables) d.dispose?.();
    this.disposables.length = 0;
    this.group.clear();
  }
}
