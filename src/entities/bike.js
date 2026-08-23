/**
 * The motorcycle and its rider.
 *
 * Built from primitives and merged by material, so the whole hero object costs
 * about a dozen draw calls. The hierarchy matters as much as the shapes:
 *
 *   root             position + heading
 *     lean           roll into corners
 *       pitch        wheelie / stoppie, pivoting on the rear contact patch
 *         body       shifts the model back off that pivot
 *           chassis  merged static body
 *           steer    forks, bars, front wheel
 *           rider    torso pivot for tuck and counter-lean
 *
 * The pitch pivot sits at the rear tyre's contact patch rather than at the
 * bike's origin, so a wheelie rotates around the point it actually rotates
 * around and the rear wheel stays planted without any height fudging.
 */

import * as THREE from 'three';
import { mergeGeometries, colorize, roundedBox } from '../engine/geometry.js';
import { blobShadowTexture, glowTexture } from '../engine/textures.js';
import { clamp, lerp, damp, TAU } from '../engine/util.js';

/** Material buckets. Parts are merged per bucket and drawn with one material. */
const BUCKETS = ['paint', 'metal', 'matte', 'glow', 'skin'];

/** Rear axle / contact patch position along the bike's own Z axis. */
const REAR_AXLE_Z = -0.70;

class PartSet {
  constructor() {
    this.buckets = new Map(BUCKETS.map((b) => [b, []]));
  }

  add(geo, color, bucket = 'matte') {
    this.buckets.get(bucket).push(colorize(geo, color));
    return geo;
  }

  /** Merge each bucket and return { bucket: geometry } for non-empty buckets. */
  finish() {
    const out = {};
    for (const [name, list] of this.buckets) {
      if (list.length) out[name] = mergeGeometries(list);
    }
    return out;
  }
}

export class Bike {
  constructor(scene, settings, sky, options = {}) {
    this.scene = scene;
    this.settings = settings;
    this.sky = sky;
    this.night = !!sky.preset.wet;

    this.paintColor = options.paintColor ?? 0xd6202a;
    this.jacketColor = options.jacketColor ?? 0x8a7a5e;

    this.root = new THREE.Group();
    this.root.name = 'bike';
    this.leanGroup = new THREE.Group();
    this.pitchGroup = new THREE.Group();
    this.body = new THREE.Group();
    this.steerGroup = new THREE.Group();
    this.riderGroup = new THREE.Group();
    this.riderTorso = new THREE.Group();

    // Pitch pivots on the rear contact patch, so the body is offset forward
    // by the same amount to keep the model's own origin where it was built.
    this.pitchGroup.position.set(0, 0, REAR_AXLE_Z);
    this.body.position.set(0, 0, -REAR_AXLE_Z);

    this.root.add(this.leanGroup);
    this.leanGroup.add(this.pitchGroup);
    this.pitchGroup.add(this.body);
    this.body.add(this.steerGroup);
    this.body.add(this.riderGroup);
    this.riderGroup.add(this.riderTorso);

    this.materials = this._materials();
    this._buildChassis();
    this._buildFront();
    this._buildWheels();
    this._buildRider();
    this._buildShadow();
    this._buildLights();

    scene.add(this.root);

    this.wheelSpin = 0;
    this._worldPos = new THREE.Vector3();
  }

  /* ----------------------------------------------------------------
     Materials
     ---------------------------------------------------------------- */

  _materials() {
    const env = this.night ? 1.4 : 0.9;
    const mats = {
      paint: new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.22, metalness: 0.45, envMapIntensity: env,
      }),
      metal: new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.3, metalness: 0.9, envMapIntensity: env * 1.2,
      }),
      matte: new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.82, metalness: 0.05, envMapIntensity: env * 0.4,
      }),
      skin: new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.7, metalness: 0.0, envMapIntensity: env * 0.3,
      }),
      glow: new THREE.MeshStandardMaterial({
        vertexColors: true,
        emissive: 0xffffff,
        emissiveIntensity: this.night ? 2.6 : 0.9,
        roughness: 0.3,
        metalness: 0.0,
      }),
    };
    // Emissive tint comes from the vertex colour, so drive it from that.
    mats.glow.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance *= vColor.rgb;',
      );
    };
    return mats;
  }

  _emit(parts, target) {
    const geos = parts.finish();
    for (const [bucket, geo] of Object.entries(geos)) {
      const mesh = new THREE.Mesh(geo, this.materials[bucket]);
      mesh.castShadow = this.settings.shadows;
      mesh.receiveShadow = false;
      target.add(mesh);
    }
  }

  /* ----------------------------------------------------------------
     Chassis
     ---------------------------------------------------------------- */

  _buildChassis() {
    const p = new PartSet();
    const paint = this.paintColor;
    const dark = 0x1a1c20;

    // Engine + gearbox mass, low and central.
    const engine = roundedBox(0.36, 0.34, 0.44, 0.05, 1);
    engine.translate(0, 0.50, 0.02);
    p.add(engine, 0x2b2e33, 'metal');

    // Cylinder bank, canted forward.
    const bank = new THREE.BoxGeometry(0.32, 0.22, 0.24);
    bank.rotateX(-0.35);
    bank.translate(0, 0.70, 0.14);
    p.add(bank, 0x3a3e44, 'metal');

    // Twin beam frame rails sweeping from the headstock to the swingarm pivot.
    for (const side of [-1, 1]) {
      const rail = new THREE.BoxGeometry(0.07, 0.16, 0.86);
      rail.rotateX(0.06);
      rail.translate(side * 0.185, 0.79, 0.06);
      p.add(rail, 0x9aa1a8, 'metal');
    }

    // Fuel tank: a rounded wedge that narrows toward the seat.
    const tank = roundedBox(0.44, 0.30, 0.62, 0.12, 2);
    tank.scale(1, 1, 1);
    tank.translate(0, 0.95, 0.12);
    p.add(tank, paint, 'paint');

    const tankNose = roundedBox(0.30, 0.22, 0.26, 0.09, 2);
    tankNose.translate(0, 0.98, 0.44);
    p.add(tankNose, paint, 'paint');

    // Filler cap.
    const cap = new THREE.CylinderGeometry(0.055, 0.055, 0.03, 10);
    cap.translate(0, 1.11, 0.16);
    p.add(cap, 0x6e757c, 'metal');

    // Seat and pillion pad.
    const seat = roundedBox(0.26, 0.10, 0.40, 0.05, 1);
    seat.rotateX(-0.06);
    seat.translate(0, 0.94, -0.30);
    p.add(seat, 0x141518, 'matte');

    // Tail unit rising behind the seat.
    const tail = new THREE.CylinderGeometry(0.13, 0.055, 0.46, 8);
    tail.rotateX(Math.PI / 2 - 0.34);
    tail.translate(0, 1.02, -0.62);
    p.add(tail, paint, 'paint');

    const tailTop = roundedBox(0.20, 0.09, 0.34, 0.04, 1);
    tailTop.rotateX(-0.26);
    tailTop.translate(0, 1.10, -0.60);
    p.add(tailTop, 0x141518, 'matte');

    // Tail light and indicators — the rider's most-seen surface.
    const brake = roundedBox(0.19, 0.055, 0.05, 0.02, 1);
    brake.rotateX(-0.2);
    brake.translate(0, 1.03, -0.83);
    p.add(brake, 0xff1a12, 'glow');
    this.brakeLightGeoIndex = true;

    for (const side of [-1, 1]) {
      const ind = new THREE.SphereGeometry(0.028, 8, 6);
      ind.translate(side * 0.14, 0.99, -0.80);
      p.add(ind, 0xff8a1a, 'glow');
    }

    // Rear hugger, plate and light bracket.
    const fender = new THREE.CylinderGeometry(0.36, 0.36, 0.16, 12, 1, true, Math.PI * 0.95, Math.PI * 0.55);
    fender.rotateZ(Math.PI / 2);
    fender.translate(0, 0.34, -0.70);
    p.add(fender, dark, 'matte');

    const plateArm = new THREE.BoxGeometry(0.04, 0.22, 0.04);
    plateArm.rotateX(0.5);
    plateArm.translate(0, 0.80, -0.88);
    p.add(plateArm, dark, 'matte');

    const plate = new THREE.BoxGeometry(0.20, 0.11, 0.015);
    plate.rotateX(0.32);
    plate.translate(0, 0.71, -0.94);
    p.add(plate, 0xf0eadc, 'matte');

    // Swingarm.
    for (const side of [-1, 1]) {
      const arm = new THREE.BoxGeometry(0.07, 0.11, 0.62);
      arm.rotateX(-0.05);
      arm.translate(side * 0.175, 0.40, -0.42);
      p.add(arm, 0x9aa1a8, 'metal');
    }
    const shock = new THREE.CylinderGeometry(0.045, 0.045, 0.30, 8);
    shock.rotateX(0.35);
    shock.translate(0, 0.63, -0.24);
    p.add(shock, 0xd8b02a, 'metal');

    // Exhaust: header tucked under the engine into a right-hand can.
    const header = new THREE.CylinderGeometry(0.045, 0.045, 0.55, 8);
    header.rotateX(Math.PI / 2 - 0.25);
    header.translate(0.06, 0.34, -0.10);
    p.add(header, 0x7e858c, 'metal');

    const can = new THREE.CylinderGeometry(0.085, 0.075, 0.44, 12);
    can.rotateX(Math.PI / 2 - 0.14);
    can.translate(0.17, 0.50, -0.56);
    p.add(can, 0x54595f, 'metal');

    const tip = new THREE.CylinderGeometry(0.078, 0.078, 0.05, 12);
    tip.rotateX(Math.PI / 2 - 0.14);
    tip.translate(0.20, 0.53, -0.77);
    p.add(tip, 0x1a1c1e, 'matte');

    // Lower fairing / belly pan.
    for (const side of [-1, 1]) {
      const fair = roundedBox(0.09, 0.34, 0.70, 0.06, 2);
      fair.rotateY(side * 0.06);
      fair.rotateX(0.05);
      fair.translate(side * 0.20, 0.62, 0.22);
      p.add(fair, paint, 'paint');
    }
    const belly = roundedBox(0.34, 0.14, 0.52, 0.06, 1);
    belly.translate(0, 0.36, 0.24);
    p.add(belly, paint, 'paint');

    // Footpegs.
    for (const side of [-1, 1]) {
      const peg = new THREE.CylinderGeometry(0.018, 0.018, 0.12, 6);
      peg.rotateZ(Math.PI / 2);
      peg.translate(side * 0.24, 0.44, -0.28);
      p.add(peg, 0x8f969c, 'metal');
    }

    this._emit(p, this.body);
  }

  /* ----------------------------------------------------------------
     Front end (steers)
     ---------------------------------------------------------------- */

  _buildFront() {
    const p = new PartSet();
    const paint = this.paintColor;
    const RAKE = 0.42;              // radians from vertical
    const AXLE_Z = 0.70;
    const AXLE_Y = 0.33;

    // The steering group pivots about the steering head, so build in a space
    // whose origin is that pivot and offset the whole group afterwards.
    const headY = 0.98;
    const headZ = 0.52;

    for (const side of [-1, 1]) {
      const tube = new THREE.CylinderGeometry(0.032, 0.032, 0.62, 8);
      tube.rotateX(RAKE);
      tube.translate(side * 0.12, AXLE_Y + 0.30 - headY, AXLE_Z + 0.14 - headZ);
      p.add(tube, 0xd8dce0, 'metal');

      const slider = new THREE.CylinderGeometry(0.045, 0.045, 0.34, 8);
      slider.rotateX(RAKE);
      slider.translate(side * 0.12, AXLE_Y + 0.02 - headY, AXLE_Z + 0.02 - headZ);
      p.add(slider, 0x2b2e33, 'matte');
    }

    // Triple clamps.
    for (const dy of [0.02, 0.16]) {
      const clamp0 = new THREE.BoxGeometry(0.30, 0.05, 0.10);
      clamp0.rotateX(RAKE);
      clamp0.translate(0, dy, dy * 0.42);
      p.add(clamp0, 0x8f969c, 'metal');
    }

    // Clip-on bars with grips and levers.
    for (const side of [-1, 1]) {
      const bar = new THREE.CylinderGeometry(0.017, 0.017, 0.22, 6);
      bar.rotateZ(Math.PI / 2);
      bar.rotateY(side * 0.22);
      bar.translate(side * 0.20, 0.05, -0.02);
      p.add(bar, 0x6e757c, 'metal');

      const grip = new THREE.CylinderGeometry(0.023, 0.023, 0.11, 8);
      grip.rotateZ(Math.PI / 2);
      grip.rotateY(side * 0.22);
      grip.translate(side * 0.30, 0.05, -0.04);
      p.add(grip, 0x131417, 'matte');

      const lever = new THREE.BoxGeometry(0.10, 0.012, 0.02);
      lever.rotateY(side * 0.3);
      lever.translate(side * 0.28, 0.03, 0.05);
      p.add(lever, 0xb9bfc4, 'metal');

      // Mirror stalk and glass.
      const stalk = new THREE.CylinderGeometry(0.011, 0.011, 0.13, 5);
      stalk.rotateZ(side * 0.5);
      stalk.rotateX(-0.25);
      stalk.translate(side * 0.22, 0.16, 0.06);
      p.add(stalk, 0x1c1e22, 'matte');
      const glass = new THREE.BoxGeometry(0.11, 0.055, 0.014);
      glass.rotateY(side * 0.45);
      glass.rotateZ(side * 0.1);
      glass.translate(side * 0.29, 0.22, 0.05);
      p.add(glass, 0x2a2e33, 'matte');
    }

    // Upper fairing, screen and headlight cluster.
    const nose = roundedBox(0.30, 0.26, 0.30, 0.10, 2);
    nose.rotateX(-0.18);
    nose.translate(0, 0.06, 0.16);
    p.add(nose, paint, 'paint');

    for (const side of [-1, 1]) {
      const cheek = roundedBox(0.08, 0.28, 0.34, 0.06, 2);
      cheek.rotateY(side * 0.18);
      cheek.rotateX(-0.1);
      cheek.translate(side * 0.15, -0.04, 0.10);
      p.add(cheek, paint, 'paint');
    }

    const light = roundedBox(0.20, 0.11, 0.05, 0.03, 1);
    light.rotateX(-0.3);
    light.translate(0, 0.05, 0.30);
    p.add(light, this.night ? 0xfff4d8 : 0x9aa4ac, this.night ? 'glow' : 'matte');

    const screen = new THREE.BoxGeometry(0.20, 0.16, 0.012);
    screen.rotateX(-0.72);
    screen.translate(0, 0.22, 0.10);
    p.add(screen, 0x20262e, 'matte');

    // Front brake discs and calipers sit with the front wheel, not here, so the
    // fork legs stay a clean single merge.
    this._emit(p, this.steerGroup);
    this.steerGroup.position.set(0, headY, headZ);

    this.frontAxleLocal = new THREE.Vector3(0, AXLE_Y - headY, AXLE_Z - headZ);
  }

  /* ----------------------------------------------------------------
     Wheels
     ---------------------------------------------------------------- */

  _wheelGeometry(radius, width, front) {
    const p = new PartSet();

    const tyre = new THREE.TorusGeometry(radius - width * 0.34, width * 0.34, 8, 20);
    tyre.rotateY(Math.PI / 2);
    p.add(tyre, 0x121316, 'matte');

    // Shoulder blocks give the tyre a visible profile when leaned over.
    const shoulder = new THREE.TorusGeometry(radius - width * 0.42, width * 0.30, 6, 18);
    shoulder.rotateY(Math.PI / 2);
    shoulder.scale(1.0, 1.0, 1.0);
    p.add(shoulder, 0x191b1f, 'matte');

    const rim = new THREE.CylinderGeometry(radius * 0.60, radius * 0.60, width * 0.62, 14, 1, true);
    rim.rotateZ(Math.PI / 2);
    p.add(rim, 0x3c4147, 'metal');

    const hub = new THREE.CylinderGeometry(radius * 0.16, radius * 0.16, width * 0.9, 10);
    hub.rotateZ(Math.PI / 2);
    p.add(hub, 0x62696f, 'metal');

    // Three-spoke wheel, as on most sports bikes.
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU;
      const spoke = new THREE.BoxGeometry(width * 0.5, radius * 1.16, width * 0.34);
      spoke.rotateX(a);
      p.add(spoke, 0x565d64, 'metal');
    }

    const disc = new THREE.CylinderGeometry(radius * 0.68, radius * 0.68, 0.012, 16);
    disc.rotateZ(Math.PI / 2);
    disc.translate(front ? -width * 0.5 : width * 0.52, 0, 0);
    p.add(disc, 0xb0b6bb, 'metal');

    if (front) {
      const disc2 = new THREE.CylinderGeometry(radius * 0.68, radius * 0.68, 0.012, 16);
      disc2.rotateZ(Math.PI / 2);
      disc2.translate(width * 0.5, 0, 0);
      p.add(disc2, 0xb0b6bb, 'metal');
    } else {
      const sprocket = new THREE.CylinderGeometry(radius * 0.42, radius * 0.42, 0.02, 20);
      sprocket.rotateZ(Math.PI / 2);
      sprocket.translate(-width * 0.52, 0, 0);
      p.add(sprocket, 0x8c9298, 'metal');
    }

    return p.finish();
  }

  _buildWheels() {
    // Rear: fatter and slightly larger, as on a litre bike.
    this.rearWheel = new THREE.Group();
    for (const [bucket, geo] of Object.entries(this._wheelGeometry(0.325, 0.20, false))) {
      const mesh = new THREE.Mesh(geo, this.materials[bucket]);
      mesh.castShadow = this.settings.shadows;
      this.rearWheel.add(mesh);
    }
    this.rearWheel.position.set(0, 0.325, REAR_AXLE_Z);
    this.body.add(this.rearWheel);

    this.frontWheel = new THREE.Group();
    for (const [bucket, geo] of Object.entries(this._wheelGeometry(0.315, 0.14, true))) {
      const mesh = new THREE.Mesh(geo, this.materials[bucket]);
      mesh.castShadow = this.settings.shadows;
      this.frontWheel.add(mesh);
    }
    this.frontWheel.position.copy(this.frontAxleLocal);
    this.steerGroup.add(this.frontWheel);
  }

  /* ----------------------------------------------------------------
     Rider
     ---------------------------------------------------------------- */

  _buildRider() {
    const jacket = this.jacketColor;
    const denim = 0x44506a;
    const skin = 0xb9865f;
    const boot = 0x24262a;

    // --- lower body stays with the bike ---
    const lower = new PartSet();
    const hips = roundedBox(0.30, 0.20, 0.26, 0.08, 1);
    hips.translate(0, 1.03, -0.30);
    lower.add(hips, denim, 'matte');

    for (const side of [-1, 1]) {
      // Thigh: hip forward and down toward the knee, which sits outside the tank.
      const thigh = new THREE.CylinderGeometry(0.085, 0.075, 0.42, 8);
      thigh.rotateX(Math.PI / 2);
      thigh.rotateY(side * 0.22);
      thigh.rotateZ(side * -0.18);
      thigh.translate(side * 0.16, 0.94, -0.12);
      lower.add(thigh, denim, 'matte');

      // Shin folds back and down to the peg.
      const shin = new THREE.CylinderGeometry(0.065, 0.055, 0.40, 8);
      shin.rotateX(-0.85);
      shin.translate(side * 0.235, 0.68, -0.16);
      lower.add(shin, denim, 'matte');

      const bootGeo = roundedBox(0.11, 0.11, 0.26, 0.04, 1);
      bootGeo.rotateX(-0.2);
      bootGeo.translate(side * 0.245, 0.47, -0.24);
      lower.add(bootGeo, boot, 'matte');

      const knee = new THREE.SphereGeometry(0.085, 8, 6);
      knee.translate(side * 0.20, 0.83, 0.02);
      lower.add(knee, denim, 'matte');
    }
    this._emit(lower, this.riderGroup);

    // --- torso pivots so the rider can tuck and counter-lean ---
    const upper = new PartSet();
    const PIVOT_Y = 1.10;
    const PIVOT_Z = -0.26;
    const rel = (geo) => geo.translate(0, -PIVOT_Y, -PIVOT_Z);

    const torso = roundedBox(0.36, 0.46, 0.28, 0.11, 2);
    torso.rotateX(0.62);
    torso.translate(0, 1.28, -0.13);
    upper.add(rel(torso), jacket, 'matte');

    const shoulders = roundedBox(0.42, 0.18, 0.24, 0.08, 1);
    shoulders.rotateX(0.5);
    shoulders.translate(0, 1.44, 0.03);
    upper.add(rel(shoulders), jacket, 'matte');

    // Backpack-ish bulge so the back reads as a body, not a slab.
    const spine = new THREE.SphereGeometry(0.15, 10, 8);
    spine.scale(1.0, 1.15, 0.7);
    spine.translate(0, 1.34, -0.22);
    upper.add(rel(spine), jacket, 'matte');

    for (const side of [-1, 1]) {
      const upperArm = new THREE.CylinderGeometry(0.062, 0.055, 0.30, 7);
      upperArm.rotateX(Math.PI / 2 - 0.25);
      upperArm.rotateZ(side * 0.30);
      upperArm.translate(side * 0.20, 1.40, 0.16);
      upper.add(rel(upperArm), jacket, 'matte');

      const forearm = new THREE.CylinderGeometry(0.05, 0.045, 0.32, 7);
      forearm.rotateX(Math.PI / 2 - 0.10);
      forearm.rotateZ(side * 0.22);
      forearm.translate(side * 0.27, 1.28, 0.44);
      upper.add(rel(forearm), jacket, 'matte');

      const glove = new THREE.SphereGeometry(0.055, 8, 6);
      glove.translate(side * 0.31, 1.21, 0.58);
      upper.add(rel(glove), 0x1c1e22, 'matte');
    }

    // Neck, helmet shell, visor.
    const neck = new THREE.CylinderGeometry(0.055, 0.06, 0.09, 8);
    neck.translate(0, 1.52, 0.06);
    upper.add(rel(neck), skin, 'skin');

    const helmet = new THREE.SphereGeometry(0.135, 14, 12);
    helmet.scale(1.0, 1.05, 1.12);
    helmet.translate(0, 1.60, 0.10);
    upper.add(rel(helmet), 0xf0f2f4, 'paint');

    const visor = new THREE.SphereGeometry(0.128, 12, 10, Math.PI * 0.15, Math.PI * 0.7, Math.PI * 0.34, Math.PI * 0.34);
    visor.scale(1.0, 1.05, 1.16);
    visor.rotateY(Math.PI / 2);
    visor.translate(0, 1.60, 0.10);
    upper.add(rel(visor), 0x15181c, 'paint');

    const chin = roundedBox(0.16, 0.10, 0.10, 0.04, 1);
    chin.translate(0, 1.52, 0.20);
    upper.add(rel(chin), 0xf0f2f4, 'paint');

    this._emit(upper, this.riderTorso);
    this.riderTorso.position.set(0, PIVOT_Y, PIVOT_Z);
  }

  /* ----------------------------------------------------------------
     Contact shadow + light emitters
     ---------------------------------------------------------------- */

  _buildShadow() {
    // A soft blob under the bike. On tiers with real shadows it still helps:
    // the shadow map alone leaves the contact point looking floaty at speed.
    const geo = new THREE.PlaneGeometry(1.5, 2.6);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      map: blobShadowTexture(),
      transparent: true,
      opacity: this.night ? 0.45 : 0.55,
      depthWrite: false,
      color: 0x000000,
      fog: true,
    });
    this.shadowMat = mat;
    this.blobShadow = new THREE.Mesh(geo, mat);
    this.blobShadow.renderOrder = 2;
    this.blobShadow.frustumCulled = false;
    this.scene.add(this.blobShadow);
  }

  _buildLights() {
    this.headlight = null;
    if (!this.night) return;

    // One spot light is affordable and completely changes how the night track
    // reads — without it the rider outruns their own visibility.
    const spot = new THREE.SpotLight(0xfff0d0, 26, 90, 0.52, 0.55, 1.4);
    spot.castShadow = false;
    spot.position.set(0, 1.0, 0.7);
    this.body.add(spot);
    this.body.add(spot.target);
    spot.target.position.set(0, 0.2, 24);
    this.headlight = spot;

    // Glare sprite so the headlight is visible in the mirror-shot camera modes.
    const glare = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 1.6),
      new THREE.MeshBasicMaterial({
        map: glowTexture(0),
        color: 0xffe9bd,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: true,
      }),
    );
    glare.position.set(0, 1.03, 0.84);
    glare.renderOrder = 6;
    this.body.add(glare);
    this.headlightGlare = glare;
  }

  /* ----------------------------------------------------------------
     Per-frame update
     ---------------------------------------------------------------- */

  /**
   * @param state physics output: position, heading, lean, pitch, steer,
   *              speed, groundY, groundNormal, braking, crashed, crashRoll
   */
  update(state, dt) {
    this.root.position.copy(state.position);
    this.root.rotation.set(0, state.heading, 0);

    this.leanGroup.rotation.z = -state.lean;
    this.pitchGroup.rotation.x = -state.pitch;

    if (state.crashed) {
      this.leanGroup.rotation.z = -state.crashRoll;
      this.pitchGroup.rotation.x = -state.crashPitch;
      this.root.rotation.y = state.heading + state.crashYaw;
    }

    // Front wheel steers, and the bars turn with it.
    this.steerGroup.rotation.y = state.steerAngle;

    // Wheel rotation. Wheels are children of groups rotated about X already,
    // so spinning about local X is exactly right.
    this.wheelSpin -= (state.speed / 0.325) * dt;
    if (this.wheelSpin < -TAU * 1000) this.wheelSpin += TAU * 1000;
    this.rearWheel.rotation.x = this.wheelSpin;
    this.frontWheel.rotation.x = this.wheelSpin * (0.325 / 0.315);

    // Rider tucks at speed and counter-leans slightly into the turn.
    const tuck = clamp(state.speed / 70, 0, 1);
    this.riderTorso.rotation.x = damp(this.riderTorso.rotation.x, tuck * 0.30, 0.02, dt);
    this.riderTorso.rotation.z = damp(this.riderTorso.rotation.z, state.lean * 0.22, 0.02, dt);
    this.riderTorso.position.z = -0.26 - tuck * 0.04;

    // Brake light brightens under braking.
    this.materials.glow.emissiveIntensity = lerp(
      this.night ? 2.6 : 0.9,
      this.night ? 4.6 : 2.6,
      state.braking,
    );

    // Blob shadow follows the contact patch and fades as the bike leaves it.
    this.root.getWorldPosition(this._worldPos);
    const air = clamp((this._worldPos.y - state.groundY) / 1.2, 0, 1);
    this.blobShadow.position.set(this._worldPos.x, state.groundY + 0.03, this._worldPos.z);
    this.blobShadow.rotation.y = state.heading;
    this.shadowMat.opacity = (this.night ? 0.45 : 0.55) * (1 - air * 0.75);
    const spread = 1 + air * 0.6;
    this.blobShadow.scale.set(spread, 1, spread);
  }

  setPaint(color) {
    this.paintColor = color;
  }

  dispose() {
    this.scene.remove(this.root);
    this.scene.remove(this.blobShadow);
    this.root.traverse((o) => {
      if (o.isMesh) o.geometry.dispose();
    });
    this.blobShadow.geometry.dispose();
    this.shadowMat.dispose();
    for (const m of Object.values(this.materials)) m.dispose();
    if (this.headlightGlare) this.headlightGlare.material.dispose();
  }
}
