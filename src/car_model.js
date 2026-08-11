// ---------------------------------------------------------------------------
// car_model.js - procedural GT race car.
//
// Local space: +X right, +Y up, +Z forward. The origin sits on the ground at
// the centre of the wheelbase, which is also the physics reference point.
//
// The body is a lofted surface driven by a station table (the same way a real
// body is drawn in section), the greenhouse is a second loft whose quads are
// sorted into "frame" and "glass" so the car gets real pillars and windows,
// and everything else is bolted on as separate parts.
// ---------------------------------------------------------------------------

const CAR_SPEC = {
  wheelbase: 2.84,
  trackFront: 1.66,
  trackRear: 1.68,
  wheelRadiusFront: 0.345,
  wheelRadiusRear: 0.358,
  wheelWidthFront: 0.30,
  wheelWidthRear: 0.345,
  bodyHalfWidth: 1.00,
  frontAxleZ: 1.42,
  rearAxleZ: -1.42,
  cgHeight: 0.42,
  mass: 1245,
};

const MAT = {
  paint: { color: [0.72, 0.07, 0.09], rough: 0.30, metal: 0.22, emissive: 0, flag: FLAG_PAINT },
  carbon: { color: [0.055, 0.055, 0.065], rough: 0.34, metal: 0.30, emissive: 0, flag: FLAG_DEFAULT },
  matte: { color: [0.035, 0.035, 0.040], rough: 0.62, metal: 0.05, emissive: 0, flag: FLAG_DEFAULT },
  mesh: { color: [0.02, 0.02, 0.024], rough: 0.75, metal: 0.10, emissive: 0, flag: FLAG_DEFAULT },
  chrome: { color: [0.86, 0.87, 0.90], rough: 0.10, metal: 1.0, emissive: 0, flag: FLAG_DEFAULT },
  steel: { color: [0.45, 0.46, 0.48], rough: 0.35, metal: 0.90, emissive: 0, flag: FLAG_DEFAULT },
  glass: { color: [0.035, 0.045, 0.055], rough: 0.05, metal: 0.0, emissive: 0, flag: FLAG_GLASS },
  tire: { color: [0.070, 0.070, 0.076], rough: 0.88, metal: 0.0, emissive: 0, flag: FLAG_DEFAULT },
  tireWall: { color: [0.095, 0.095, 0.102], rough: 0.74, metal: 0.0, emissive: 0, flag: FLAG_DEFAULT },
  rim: { color: [0.155, 0.160, 0.175], rough: 0.42, metal: 0.65, emissive: 0, flag: FLAG_DEFAULT },
  disc: { color: [0.26, 0.25, 0.25], rough: 0.34, metal: 0.80, emissive: 0, flag: FLAG_DEFAULT },
  caliper: { color: [0.78, 0.10, 0.04], rough: 0.35, metal: 0.30, emissive: 0, flag: FLAG_DEFAULT },
  headlight: { color: [0.88, 0.90, 0.98], rough: 0.06, metal: 0.0, emissive: 0.0, flag: FLAG_GLASS },
  tailLens: { color: [0.62, 0.03, 0.03], rough: 0.12, metal: 0.0, emissive: 0.35, flag: FLAG_UNLIT },
  reverseLens: { color: [0.85, 0.85, 0.80], rough: 0.12, metal: 0.0, emissive: 0.05, flag: FLAG_UNLIT },
  interior: { color: [0.085, 0.085, 0.092], rough: 0.88, metal: 0.0, emissive: 0, flag: FLAG_DEFAULT },
  seat: { color: [0.08, 0.08, 0.09], rough: 0.80, metal: 0.0, emissive: 0, flag: FLAG_DEFAULT },
  cage: { color: [0.72, 0.12, 0.10], rough: 0.40, metal: 0.30, emissive: 0, flag: FLAG_DEFAULT },
  suit: { color: [0.13, 0.14, 0.18], rough: 0.85, metal: 0.0, emissive: 0, flag: FLAG_DEFAULT },
  helmet: { color: [0.90, 0.90, 0.92], rough: 0.14, metal: 0.05, emissive: 0, flag: FLAG_PAINT },
  visor: { color: [0.05, 0.04, 0.02], rough: 0.06, metal: 0.6, emissive: 0, flag: FLAG_DEFAULT },
};

function useMat(mb, m) { mb.mat(m.color, m.rough, m.metal, m.emissive, m.flag); return mb; }

// --- body sections ----------------------------------------------------------

// [z, halfWidth, floorY, deckY]
const BODY_STATIONS = [
  [2.42, 0.34, 0.30, 0.46],
  [2.36, 0.58, 0.19, 0.51],
  [2.22, 0.76, 0.13, 0.565],
  [2.02, 0.88, 0.105, 0.620],
  [1.75, 0.945, 0.095, 0.665],
  [1.45, 0.975, 0.090, 0.695],
  [1.15, 0.985, 0.095, 0.725],
  [0.85, 0.990, 0.100, 0.755],
  [0.45, 1.000, 0.105, 0.775],
  [0.00, 1.000, 0.110, 0.788],
  [-0.45, 1.000, 0.110, 0.793],
  [-0.90, 1.000, 0.113, 0.800],
  [-1.30, 0.985, 0.118, 0.810],
  [-1.70, 0.945, 0.140, 0.812],
  [-2.02, 0.885, 0.180, 0.800],
  [-2.24, 0.780, 0.265, 0.760],
  [-2.34, 0.620, 0.370, 0.680],
];

// How far the underside lifts at each station to clear the wheels. The amount
// is derived from the tyre it has to clear rather than picked by eye: the arch
// has to reach just over the top of the tyre and no further, because lifting it
// past the deck line turns the section inside out.
const FRONT_TYRE_TOP = CAR_SPEC.wheelRadiusFront * 2;
const REAR_TYRE_TOP = CAR_SPEC.wheelRadiusRear * 2;

function archLift(z) {
  let lift = 0;
  for (const [c, reach, amount] of [
    [CAR_SPEC.frontAxleZ, 0.62, FRONT_TYRE_TOP - 0.092 - 0.055 + 0.012],
    [CAR_SPEC.rearAxleZ, 0.66, REAR_TYRE_TOP - 0.113 - 0.055 + 0.012],
  ]) {
    const t = clamp(1 - Math.abs(z - c) / reach, 0, 1);
    lift = Math.max(lift, Math.sin(t * Math.PI * 0.5) * amount);
  }
  return lift;
}

// The deck crowns over each axle so there is bodywork above the tyre for the
// arch to be cut out of.
function fenderCrown(z) {
  let crown = 0;
  for (const [c, reach, amount] of [[CAR_SPEC.frontAxleZ, 0.78, 0.125], [CAR_SPEC.rearAxleZ, 0.86, 0.135]]) {
    const t = clamp(1 - Math.abs(z - c) / reach, 0, 1);
    crown = Math.max(crown, Math.sin(t * Math.PI * 0.5) * amount);
  }
  return crown;
}

// Extra width over the wheels so the arches stand proud of the doors.
function fenderFlare(z) {
  let f = 0;
  for (const [c, reach, amount] of [[CAR_SPEC.frontAxleZ, 0.70, 0.045], [CAR_SPEC.rearAxleZ, 0.78, 0.062]]) {
    const t = clamp(1 - Math.abs(z - c) / reach, 0, 1);
    f = Math.max(f, Math.sin(t * Math.PI * 0.5) * amount);
  }
  return f;
}

const TOP_POINTS = 17;   // across the deck, right to left
const SIDE_POINTS = 5;   // down each flank

// Build one closed body section. Returns { points, kinds } where kind 0 = deck,
// 1 = flank, 2 = underside, so the loft can switch material.
function bodySection(z, halfWidth, floorY, deckY) {
  const w = halfWidth + fenderFlare(z);
  const lift = archLift(z);
  const haunch = fenderCrown(z);
  // Over the arches the shoulder is squared off, so the fender lip stays proud
  // of the tyre instead of rolling away to nothing.
  const shoulder = 0.085 - 0.055 * (haunch / 0.135);
  const crown = 0.030;
  const sillTuck = 0.055;

  const topY = (x) => {
    const t = Math.abs(x) / w;
    // The haunch is a bulge over the wheel, so it only applies to the outer
    // part of the deck. Raising the whole deck instead pushes it up through
    // the cabin roof, and the two surfaces then fight for the same pixels.
    const haunchHere = haunch * smoothstep(0.34, 0.86, t);
    return deckY + haunchHere + crown * (1 - t * t) - shoulder * Math.pow(t, 6);
  };
  const botY = (x) => {
    const t = Math.abs(x) / w;
    const raw = floorY + lift * smoothstep(0.58, 0.97, t) + sillTuck * Math.pow(t, 6);
    // Hard guarantee: the underside can never climb through the deck. If it
    // does the cross-section turns inside out and the lofted surface folds
    // back over itself, which reads as z-fighting all over the bodywork.
    return Math.min(raw, topY(x) - 0.025);
  };

  const points = [], kinds = [];
  // Deck, +X to -X, cosine spaced so the shoulders get extra resolution.
  for (let k = 0; k < TOP_POINTS; k++) {
    const x = Math.cos((k / (TOP_POINTS - 1)) * Math.PI) * w;
    points.push([x, topY(x), z]); kinds.push(0);
  }
  // Left flank, top to bottom.
  for (let k = 1; k <= SIDE_POINTS; k++) {
    const t = k / (SIDE_POINTS + 1);
    points.push([-w, lerp(topY(-w), botY(-w), t), z]); kinds.push(1);
  }
  // Underside, -X to +X.
  for (let k = 0; k < TOP_POINTS; k++) {
    const x = -Math.cos((k / (TOP_POINTS - 1)) * Math.PI) * w;
    points.push([x, botY(x), z]); kinds.push(2);
  }
  // Right flank, bottom to top.
  for (let k = 1; k <= SIDE_POINTS; k++) {
    const t = k / (SIDE_POINTS + 1);
    points.push([w, lerp(botY(w), topY(w), t), z]); kinds.push(1);
  }
  return { points, kinds };
}

function sampleStations(count) {
  const out = [];
  const zFront = BODY_STATIONS[0][0];
  const zRear = BODY_STATIONS[BODY_STATIONS.length - 1][0];
  for (let i = 0; i < count; i++) {
    const z = lerp(zFront, zRear, i / (count - 1));
    // Find the bracketing table rows (table is ordered front to rear).
    let a = 0;
    while (a < BODY_STATIONS.length - 2 && BODY_STATIONS[a + 1][0] > z) a++;
    const s0 = BODY_STATIONS[a], s1 = BODY_STATIONS[a + 1];
    const t = clamp((s0[0] - z) / (s0[0] - s1[0] || 1), 0, 1);
    // Smooth the interpolation so the surface has no visible station creases.
    const ts = t * t * (3 - 2 * t);
    out.push([z, lerp(s0[1], s1[1], ts), lerp(s0[2], s1[2], ts), lerp(s0[3], s1[3], ts)]);
  }
  return out;
}

function buildBodyShell(mb) {
  const stations = sampleStations(50);
  const rings = [], kinds = [];
  for (const [z, w, fy, dy] of stations) {
    const s = bodySection(z, w, fy, dy);
    rings.push(s.points);
    if (!kinds.length) kinds.push(...s.kinds);
  }
  mb.loft(rings, true, true, true, (i, j) => {
    useMat(mb, kinds[j] === 2 ? MAT.carbon : MAT.paint);
  });
}

// --- greenhouse -------------------------------------------------------------

// [z, halfWidth, roofY, waistY]
const CABIN_STATIONS = [
  [1.06, 0.848, 0.840, 0.730],
  [0.88, 0.844, 1.020, 0.735],
  [0.66, 0.830, 1.190, 0.740],
  [0.44, 0.812, 1.265, 0.745],
  [0.22, 0.798, 1.292, 0.750],
  [0.00, 0.790, 1.292, 0.754],
  [-0.30, 0.786, 1.308, 0.758],
  [-0.62, 0.780, 1.302, 0.762],
  [-0.90, 0.770, 1.262, 0.767],
  [-1.14, 0.748, 1.165, 0.775],
  [-1.38, 0.718, 1.020, 0.786],
  [-1.62, 0.682, 0.885, 0.796],
  [-1.80, 0.644, 0.810, 0.802],
];

const CABIN_ARC = 25;

// Cross section of the cabin as an open arc: u = 0 at the right waist,
// u = 0.5 over the roof, u = 1 at the left waist.
function cabinSection(z, w, roofY, waistY) {
  const pts = [];
  const height = roofY - waistY;
  for (let k = 0; k < CABIN_ARC; k++) {
    const u = k / (CABIN_ARC - 1);
    const th = u * Math.PI;              // 0 -> right, PI/2 -> up, PI -> left
    const n = 3.4;                        // superellipse: flat roof, round corners
    const ct = Math.cos(th), st = Math.sin(th);
    const x = Math.sign(ct) * Math.pow(Math.abs(ct), 2 / n) * w;
    const y = waistY + Math.pow(Math.abs(st), 2 / n) * height;
    pts.push([x, y, z]);
  }
  return pts;
}

// Decide whether a cabin quad is bodywork or window.
function cabinIsGlass(z, u) {
  if (u < 0.045 || u > 0.955) return false;          // waist rail
  if (z > 1.00) return false;                         // cowl
  if (z > 0.34) return u > 0.135 && u < 0.865;        // windscreen between A pillars
  if (z > 0.20) return false;                         // header rail
  if (z > -0.86) {
    if (z < -0.34 && z > -0.48) return false;         // B pillar
    return (u > 0.052 && u < 0.205) || (u > 0.795 && u < 0.948); // side glass
  }
  if (z > -0.98) return false;                        // rear roof rail
  if (z > -1.62) return u > 0.235 && u < 0.765;       // rear screen between C pillars
  return false;
}

// Loft the cabin, routing each quad to the body builder or the glass builder.
// `innerMB`, when given, receives an inward-facing copy of the frame quads: the
// bodywork is a single-sided shell, so without a headliner the cockpit camera
// looks straight out through the roof and the pillars.
function buildCabin(bodyMB, glassMB, innerMB) {
  const rows = 40;
  const rings = [];
  for (let i = 0; i < rows; i++) {
    const t = i / (rows - 1);
    const z = lerp(CABIN_STATIONS[0][0], CABIN_STATIONS[CABIN_STATIONS.length - 1][0], t);
    let a = 0;
    while (a < CABIN_STATIONS.length - 2 && CABIN_STATIONS[a + 1][0] > z) a++;
    const s0 = CABIN_STATIONS[a], s1 = CABIN_STATIONS[a + 1];
    const k = clamp((s0[0] - z) / (s0[0] - s1[0] || 1), 0, 1);
    const ks = k * k * (3 - 2 * k);
    rings.push(cabinSection(z, lerp(s0[1], s1[1], ks), lerp(s0[2], s1[2], ks), lerp(s0[3], s1[3], ks)));
  }

  const normalAt = (i, j) => {
    const iP = Math.max(0, i - 1), iN = Math.min(rows - 1, i + 1);
    const jP = Math.max(0, j - 1), jN = Math.min(CABIN_ARC - 1, j + 1);
    const du = v3.sub([0, 0, 0], rings[i][jN], rings[i][jP]);
    const dv = v3.sub([0, 0, 0], rings[iN][j], rings[iP][j]);
    const n = v3.cross([0, 0, 0], dv, du);
    return v3.len(n) < 1e-9 ? [0, 1, 0] : v3.norm(n, n);
  };

  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < CABIN_ARC - 1; j++) {
      const zMid = (rings[i][j][2] + rings[i + 1][j][2]) * 0.5;
      const uMid = (j + 0.5) / (CABIN_ARC - 1);
      const glass = cabinIsGlass(zMid, uMid);
      const mb = glass ? glassMB : bodyMB;
      useMat(mb, glass ? MAT.glass : MAT.paint);
      // Glass sits a few millimetres inside the frame so pillars read as raised.
      const inset = glass ? -0.012 : 0;
      const emit = (ii, jj) => {
        const n = normalAt(ii, jj);
        const p = rings[ii][jj];
        return mb.vertex([p[0] + n[0] * inset, p[1] + n[1] * inset, p[2] + n[2] * inset], n);
      };
      const a = emit(i, j), b = emit(i + 1, j), c = emit(i + 1, j + 1), d = emit(i, j + 1);
      mb.quadIdx(a, b, c, d);

      if (!glass && innerMB) {
        // Headliner: same quad, pushed inside and wound the other way.
        useMat(innerMB, MAT.interior);
        const emitIn = (ii, jj) => {
          const n = normalAt(ii, jj);
          const p = rings[ii][jj];
          return innerMB.vertex(
            [p[0] - n[0] * 0.035, p[1] - n[1] * 0.035, p[2] - n[2] * 0.035],
            [-n[0], -n[1], -n[2]]);
        };
        const ia = emitIn(i, j), ib = emitIn(i + 1, j);
        const ic = emitIn(i + 1, j + 1), id = emitIn(i, j + 1);
        innerMB.quadIdx(ia, id, ic, ib);
      }
    }
  }
}

// --- bolt-on parts ----------------------------------------------------------

// NACA-ish symmetric aerofoil, used for the rear wing and the wing supports.
function aerofoilProfile(chord, thickness, camber, points = 16) {
  const pts = [];
  for (let i = 0; i < points; i++) {
    const t = i / (points - 1);
    const x = t * chord;
    const c = x / chord;
    const half = thickness * (1.4845 * Math.sqrt(c) - 0.63 * c - 1.758 * c * c + 1.4215 * c * c * c - 0.5075 * Math.pow(c, 4));
    const mid = camber * Math.sin(Math.PI * c);
    pts.push([x, mid + half]);
  }
  for (let i = points - 1; i >= 0; i--) {
    const t = i / (points - 1);
    const x = t * chord;
    const c = x / chord;
    const half = thickness * (1.4845 * Math.sqrt(c) - 0.63 * c - 1.758 * c * c + 1.4215 * c * c * c - 0.5075 * Math.pow(c, 4));
    const mid = camber * Math.sin(Math.PI * c);
    pts.push([x, mid - half]);
  }
  return pts;
}

// Extrude a 2D profile (in the local ZY plane) along X.
function extrudeAlongX(mb, profile, x0, x1, tilt = 0, offset = [0, 0, 0]) {
  const ring = (x) => profile.map(([pz, py]) => {
    const cz = Math.cos(tilt) * pz - Math.sin(tilt) * py;
    const cy = Math.sin(tilt) * pz + Math.cos(tilt) * py;
    return [x + offset[0], cy + offset[1], cz + offset[2]];
  });
  mb.loft([ring(x0), ring(x1)], true, true, true);
}

function buildRearWing(mb) {
  const span = 0.86;
  useMat(mb, MAT.carbon);
  // Main plane, mounted high on swan necks.
  const profile = aerofoilProfile(0.36, 0.075, 0.035, 14).map(([x, y]) => [x - 0.18, y]);
  extrudeAlongX(mb, profile, -span, span, -0.22, [0, 1.155, -2.02]);
  // Gurney flap.
  mb.push(); mb.translate(0, 1.225, -2.19); mb.rotateX(-0.22); mb.box(span * 2, 0.035, 0.012); mb.pop();
  // End plates.
  for (const s of [-1, 1]) {
    mb.push();
    mb.translate(s * (span + 0.015), 1.14, -2.03);
    mb.rotateY(Math.PI / 2);
    mb.box(0.46, 0.30, 0.016);
    mb.pop();
  }
  // Swan neck supports rising from the deck.
  for (const s of [-1, 1]) {
    mb.push();
    mb.translate(s * 0.44, 1.00, -1.90);
    mb.rotateX(0.18);
    mb.box(0.045, 0.42, 0.13);
    mb.pop();
  }
}

function buildAeroAndTrim(mb) {
  // Front splitter.
  useMat(mb, MAT.carbon);
  mb.push(); mb.translate(0, 0.062, 2.18);
  mb.chamferBox(1.98, 0.026, 0.62, 0.10);
  mb.pop();
  // Splitter end plates / dive planes.
  for (const s of [-1, 1]) {
    mb.push(); mb.translate(s * 0.90, 0.135, 2.02); mb.rotateZ(s * 0.12); mb.box(0.030, 0.16, 0.44); mb.pop();
    mb.push(); mb.translate(s * 0.895, 0.30, 1.98); mb.rotateZ(s * 0.20); mb.box(0.20, 0.016, 0.30); mb.pop();
    mb.push(); mb.translate(s * 0.885, 0.42, 1.92); mb.rotateZ(s * 0.20); mb.box(0.17, 0.016, 0.26); mb.pop();
  }
  // Side skirts.
  for (const s of [-1, 1]) {
    mb.push(); mb.translate(s * 1.00, 0.115, 0.0); mb.rotateZ(s * -0.10); mb.box(0.10, 0.05, 2.30); mb.pop();
  }
  // Rear diffuser with vertical strakes.
  mb.push(); mb.translate(0, 0.20, -2.16); mb.rotateX(0.30); mb.box(1.68, 0.05, 0.55); mb.pop();
  for (let i = -2; i <= 2; i++) {
    mb.push(); mb.translate(i * 0.34, 0.235, -2.16); mb.rotateX(0.30); mb.box(0.022, 0.17, 0.55); mb.pop();
  }
  // Bonnet louvres and roof scoop.
  useMat(mb, MAT.mesh);
  for (let i = 0; i < 3; i++) {
    for (const s of [-1, 1]) {
      mb.push(); mb.translate(s * 0.46, 0.660 + i * 0.008, 1.52 - i * 0.17); mb.rotateX(0.18);
      mb.box(0.36, 0.05, 0.075); mb.pop();
    }
  }
  // Front intakes.
  mb.push(); mb.translate(0, 0.32, 2.275); mb.box(1.12, 0.24, 0.07); mb.pop();
  for (const s of [-1, 1]) {
    mb.push(); mb.translate(s * 0.70, 0.40, 2.20); mb.rotateY(s * 0.22); mb.box(0.30, 0.20, 0.06); mb.pop();
  }
  // Side radiator intakes ahead of the rear wheels.
  for (const s of [-1, 1]) {
    mb.push(); mb.translate(s * 0.945, 0.44, -0.72); mb.rotateY(Math.PI / 2); mb.box(0.62, 0.24, 0.06); mb.pop();
  }
  // Roof intake.
  useMat(mb, MAT.paint);
  mb.push(); mb.translate(0, 1.330, 0.28); mb.rotateX(-0.06); mb.chamferBox(0.30, 0.075, 0.72, 0.05); mb.pop();
  useMat(mb, MAT.mesh);
  mb.push(); mb.translate(0, 1.330, 0.635); mb.box(0.24, 0.055, 0.02); mb.pop();

  // Mirrors on stalks.
  for (const s of [-1, 1]) {
    useMat(mb, MAT.carbon);
    mb.push(); mb.translate(s * 1.02, 0.845, 0.72); mb.rotateZ(s * 0.55); mb.cylinder(0.018, 0.018, 0.16, 8); mb.pop();
    mb.push(); mb.translate(s * 1.11, 0.905, 0.70); mb.rotateY(s * 0.22); mb.chamferBox(0.10, 0.085, 0.20, 0.035); mb.pop();
    useMat(mb, MAT.chrome);
    mb.push(); mb.translate(s * 1.135, 0.905, 0.615); mb.rotateY(s * 0.22); mb.box(0.075, 0.062, 0.012); mb.pop();
  }

  // Exhausts.
  useMat(mb, MAT.chrome);
  for (const s of [-1, 1]) {
    mb.push(); mb.translate(s * 0.30, 0.30, -2.33); mb.rotateX(Math.PI / 2); mb.cylinder(0.058, 0.058, 0.16, 12, false, true); mb.pop();
  }
  useMat(mb, MAT.matte);
  for (const s of [-1, 1]) {
    mb.push(); mb.translate(s * 0.30, 0.30, -2.30); mb.rotateX(Math.PI / 2); mb.cylinder(0.045, 0.045, 0.18, 12, true, false); mb.pop();
  }

  // Tow hook and bonnet pins - small, but they sell the race car read.
  useMat(mb, MAT.caliper);
  mb.push(); mb.translate(0.62, 0.30, 2.34); mb.rotateX(Math.PI / 2); mb.cylinder(0.035, 0.035, 0.05, 10); mb.pop();
  useMat(mb, MAT.steel);
  for (const s of [-1, 1]) {
    mb.push(); mb.translate(s * 0.70, 0.665, 1.92); mb.cylinder(0.022, 0.022, 0.016, 8); mb.pop();
  }
}

function buildLights(mb) {
  // Headlight clusters: lens plus a pair of LED bars.
  for (const s of [-1, 1]) {
    useMat(mb, MAT.matte);
    mb.push(); mb.translate(s * 0.63, 0.545, 2.135); mb.rotateY(s * 0.16); mb.chamferBox(0.44, 0.185, 0.10, 0.045); mb.pop();
    useMat(mb, MAT.headlight);
    mb.push(); mb.translate(s * 0.63, 0.548, 2.175); mb.rotateY(s * 0.16); mb.chamferBox(0.40, 0.150, 0.055, 0.04); mb.pop();
    useMat(mb, MAT.reverseLens);
    mb.push(); mb.translate(s * 0.63, 0.590, 2.192); mb.rotateY(s * 0.16); mb.box(0.34, 0.028, 0.02); mb.pop();
    mb.push(); mb.translate(s * 0.63, 0.508, 2.192); mb.rotateY(s * 0.16); mb.box(0.30, 0.022, 0.02); mb.pop();
  }
  // Tail lights.
  for (const s of [-1, 1]) {
    useMat(mb, MAT.matte);
    mb.push(); mb.translate(s * 0.62, 0.640, -2.285); mb.rotateY(s * -0.10); mb.chamferBox(0.46, 0.135, 0.07, 0.04); mb.pop();
    useMat(mb, MAT.tailLens);
    mb.push(); mb.translate(s * 0.62, 0.640, -2.318); mb.rotateY(s * -0.10); mb.chamferBox(0.42, 0.100, 0.03, 0.03); mb.pop();
  }
  // Central rain light, as required by the regulations it is pretending to obey.
  useMat(mb, MAT.tailLens);
  mb.push(); mb.translate(0, 0.735, -2.30); mb.box(0.11, 0.06, 0.03); mb.pop();
}

// --- wheels -----------------------------------------------------------------

function buildTire(mb, radius, width, rimRadius) {
  const hw = width / 2;
  // Profile from the inner bead out to the tread and back, revolved about X.
  const profile = [
    [-hw, rimRadius],
    [-hw * 1.02, rimRadius + (radius - rimRadius) * 0.45],
    [-hw * 1.00, radius * 0.985],
    [-hw * 0.80, radius],
    [0, radius * 1.004],
    [hw * 0.80, radius],
    [hw * 1.00, radius * 0.985],
    [hw * 1.02, rimRadius + (radius - rimRadius) * 0.45],
    [hw, rimRadius],
  ];
  const segments = 36;
  const rings = profile.map(([x, r]) => {
    const ring = [];
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * TAU;
      ring.push([x, Math.cos(a) * r, Math.sin(a) * r]);
    }
    return ring;
  });
  useMat(mb, MAT.tire);
  mb.loft(rings, true, false, false, (i) => {
    useMat(mb, (i <= 1 || i >= profile.length - 2) ? MAT.tireWall : MAT.tire);
  });

  // Tread blocks: shallow ribs that catch the light as the wheel turns.
  useMat(mb, MAT.matte);
  const blocks = 26;
  for (let i = 0; i < blocks; i++) {
    const a = (i / blocks) * TAU;
    mb.push();
    mb.translate(0, Math.cos(a) * radius * 0.995, Math.sin(a) * radius * 0.995);
    mb.rotateX(-a);
    mb.box(width * 0.72, 0.012, radius * 0.10);
    mb.pop();
  }
  // Sidewall lettering ring.
  useMat(mb, MAT.tireWall);
  for (const s of [-1, 1]) {
    mb.push();
    mb.translate(s * hw * 1.015, 0, 0);
    mb.rotateZ(Math.PI / 2);
    mb.cylinder(radius * 0.80, radius * 0.80, 0.004, 24, false, false);
    mb.pop();
  }
}

function buildRim(mb, rimRadius, width) {
  const hw = width / 2;
  const faceX = hw * 0.42;
  useMat(mb, MAT.rim);
  // Barrel.
  mb.push(); mb.rotateZ(Math.PI / 2); mb.cylinder(rimRadius, rimRadius, width * 0.98, 26, false, false); mb.pop();
  // Outer lip.
  mb.push(); mb.translate(hw * 0.96, 0, 0); mb.rotateZ(Math.PI / 2); mb.cylinder(rimRadius, rimRadius * 0.94, 0.05, 26, false, false); mb.pop();
  // Hub.
  mb.push(); mb.translate(faceX - 0.02, 0, 0); mb.rotateZ(Math.PI / 2); mb.cylinder(0.085, 0.085, 0.09, 20); mb.pop();
  // Ten twisted spokes.
  const spokes = 10;
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * TAU;
    mb.push();
    mb.rotateX(a);
    mb.translate(faceX - 0.01, (rimRadius + 0.085) * 0.5, 0);
    mb.rotateX(0.10);
    mb.box(0.055, rimRadius - 0.075, 0.036);
    mb.pop();
  }
  // Centre lock nut.
  useMat(mb, MAT.caliper);
  mb.push(); mb.translate(faceX + 0.035, 0, 0); mb.rotateZ(Math.PI / 2); mb.cylinder(0.045, 0.052, 0.05, 6); mb.pop();
  // Brake disc, which turns with the wheel.
  useMat(mb, MAT.disc);
  mb.push(); mb.rotateZ(Math.PI / 2); mb.cylinder(rimRadius * 0.78, rimRadius * 0.78, 0.030, 24); mb.pop();
  useMat(mb, MAT.steel);
  mb.push(); mb.rotateZ(Math.PI / 2); mb.cylinder(rimRadius * 0.40, rimRadius * 0.40, 0.048, 20); mb.pop();
}

// The caliper is fixed to the upright, so it lives in its own mesh that steers
// with the wheel but never spins.
function buildCaliper(mb, rimRadius, width) {
  useMat(mb, MAT.caliper);
  mb.push();
  mb.translate(0, rimRadius * 0.62, -0.06);
  mb.chamferBox(width * 0.42, 0.20, 0.13, 0.03);
  mb.pop();
  useMat(mb, MAT.steel);
  mb.push();
  mb.translate(0, rimRadius * 0.62, -0.06);
  mb.box(width * 0.20, 0.12, 0.10);
  mb.pop();
}

// --- interior ---------------------------------------------------------------

// Where the driver sits, and where the wheel is mounted on the column. Every
// cockpit part is placed relative to these, so moving the seat moves the lot.
const SEAT_X = -0.36;
const WHEEL_POS = [SEAT_X, 0.925, 0.28];
const WHEEL_TILT = 0.42;            // radians the rim leans away from the driver
const WHEEL_RADIUS = 0.150;
// The eye sits behind and above the rim. Used by the cockpit camera and by the
// helmet, which has to be somewhere the camera is not.
const EYE_POS = [SEAT_X, 1.10, -0.40];

function buildInterior(mb) {
  useMat(mb, MAT.interior);
  // Floor and firewall.
  mb.push(); mb.translate(0, 0.44, -0.15); mb.box(1.60, 0.04, 2.10); mb.pop();
  mb.push(); mb.translate(0, 0.62, -1.05); mb.box(1.55, 0.42, 0.05); mb.pop();

  // --- dashboard ------------------------------------------------------------
  // Top pad, sloping away from the driver, with a raised lip at the screen end
  // so it reads as a moulding rather than a slab.
  mb.push(); mb.translate(0, 0.83, 0.66); mb.rotateX(-0.26); mb.chamferBox(1.52, 0.13, 0.52, 0.05); mb.pop();
  mb.push(); mb.translate(0, 0.775, 0.40); mb.chamferBox(1.50, 0.20, 0.16, 0.04); mb.pop();
  // Binnacle hood over the driver's instruments: the overhang is what stops the
  // dash reading as a flat wall from the seat.
  mb.push(); mb.translate(SEAT_X, 0.995, 0.50); mb.rotateX(-0.34); mb.chamferBox(0.44, 0.035, 0.20, 0.014); mb.pop();
  for (const s of [-1, 1]) {
    mb.push(); mb.translate(SEAT_X + s * 0.215, 0.945, 0.50); mb.rotateX(-0.34);
    mb.chamferBox(0.028, 0.10, 0.19, 0.010); mb.pop();
  }
  // Steering column shroud, dash to hub.
  useMat(mb, MAT.matte);
  mb.push(); mb.translate(WHEEL_POS[0], WHEEL_POS[1] + 0.045, WHEEL_POS[2] + 0.16);
  mb.rotateX(Math.PI / 2 - WHEEL_TILT); mb.cylinder(0.048, 0.062, 0.30, 12); mb.pop();

  // Auxiliary screen behind the rim. The readout the driver actually uses is on
  // the wheel, so this one stays small and dim - a lit panel this close to the
  // eye blows out through the tone mapping and washes the whole cockpit.
  mb.mat([0.016, 0.024, 0.024], 0.20, 0.0, 0.05, FLAG_UNLIT);
  mb.push(); mb.translate(SEAT_X, 0.952, 0.478); mb.rotateX(-0.34); mb.box(0.300, 0.088, 0.008); mb.pop();
  mb.mat([0.07, 0.34, 0.15], 0.2, 0.0, 0.30, FLAG_UNLIT);
  mb.push(); mb.translate(SEAT_X, 0.976, 0.470); mb.rotateX(-0.34); mb.box(0.262, 0.012, 0.004); mb.pop();
  mb.mat([0.10, 0.16, 0.26], 0.2, 0.0, 0.28, FLAG_UNLIT);
  for (const s of [-1, 1]) {
    mb.push(); mb.translate(SEAT_X + s * 0.092, 0.944, 0.474); mb.rotateX(-0.34);
    mb.box(0.078, 0.030, 0.004); mb.pop();
  }

  // Air vents across the dash face.
  mb.mat([0.030, 0.030, 0.034], 0.85, 0.0, 0, FLAG_DEFAULT);
  for (const vx of [-0.66, -0.02, 0.62]) {
    mb.push(); mb.translate(vx, 0.782, 0.322); mb.box(0.19, 0.062, 0.02); mb.pop();
    for (const f of [-0.018, 0.0, 0.018]) {
      mb.push(); mb.translate(vx, 0.782 + f, 0.312); mb.box(0.185, 0.006, 0.012); mb.pop();
    }
  }

  // --- centre stack ---------------------------------------------------------
  useMat(mb, MAT.interior);
  mb.push(); mb.translate(0, 0.60, 0.20); mb.box(0.26, 0.26, 0.70); mb.pop();
  useMat(mb, MAT.carbon);
  mb.push(); mb.translate(0.05, 0.775, 0.30); mb.rotateY(-0.34); mb.rotateX(-0.18);
  mb.chamferBox(0.20, 0.17, 0.016, 0.008); mb.pop();
  // Toggle switches under flip guards, and the master cut-off.
  for (let i = 0; i < 4; i++) {
    const sx = 0.05 + (i - 1.5) * 0.043;
    mb.mat([0.55, 0.56, 0.60], 0.30, 0.85, 0, FLAG_DEFAULT);
    mb.push(); mb.translate(sx * 1.0, 0.800, 0.276 + sx * 0.10); mb.rotateY(-0.34);
    mb.rotateX(0.6); mb.cylinder(0.004, 0.005, 0.026, 6); mb.pop();
    mb.mat(i === 3 ? [0.75, 0.10, 0.06] : [0.10, 0.10, 0.12], 0.5, 0.1, 0, FLAG_DEFAULT);
    mb.push(); mb.translate(sx * 1.0, 0.780, 0.272 + sx * 0.10); mb.rotateY(-0.34);
    mb.box(0.030, 0.014, 0.012); mb.pop();
  }
  mb.mat([0.80, 0.09, 0.05], 0.45, 0.05, 0.05, FLAG_DEFAULT);
  mb.push(); mb.translate(0.05, 0.735, 0.262); mb.rotateY(-0.34); mb.rotateX(-Math.PI / 2);
  mb.cylinder(0.021, 0.024, 0.020, 12); mb.pop();

  // --- mirrors --------------------------------------------------------------
  useMat(mb, MAT.matte);
  mb.push(); mb.translate(0.0, 1.185, 0.34); mb.chamferBox(0.30, 0.055, 0.035, 0.012); mb.pop();
  mb.push(); mb.translate(0.0, 1.225, 0.36); mb.box(0.03, 0.05, 0.03); mb.pop();
  mb.mat([0.10, 0.11, 0.13], 0.06, 0.9, 0, FLAG_DEFAULT);
  mb.push(); mb.translate(0.0, 1.185, 0.318); mb.box(0.276, 0.044, 0.004); mb.pop();

  // --- doors ----------------------------------------------------------------
  useMat(mb, MAT.interior);
  for (const s of [-1, 1]) {
    mb.push(); mb.translate(s * 0.80, 0.62, 0.05); mb.box(0.06, 0.40, 1.50); mb.pop();
    // Pull strap where a road car would have a handle.
    mb.mat([0.55, 0.16, 0.07], 0.85, 0, 0, FLAG_DEFAULT);
    mb.push(); mb.translate(s * 0.765, 0.74, 0.06); mb.box(0.012, 0.11, 0.16); mb.pop();
    useMat(mb, MAT.interior);
  }
  // Window net on the driver's side, the way a race car is scrutineered.
  mb.mat([0.05, 0.05, 0.06], 0.90, 0.0, 0, FLAG_DEFAULT);
  for (let i = 0; i < 5; i++) {
    const y = 0.90 + i * 0.055;
    mb.push(); mb.translate(-0.755, y, -0.14); mb.rotateY(Math.PI / 2); mb.box(0.72, 0.012, 0.006); mb.pop();
  }
  for (let i = 0; i < 6; i++) {
    const z = -0.44 + i * 0.118;
    mb.push(); mb.translate(-0.755, 1.01, z); mb.box(0.006, 0.235, 0.012); mb.pop();
  }

  // --- seats and harnesses --------------------------------------------------
  for (const s of [-1, 1]) {
    useMat(mb, MAT.seat);
    mb.push(); mb.translate(s * 0.36, 0.56, -0.30); mb.box(0.50, 0.12, 0.52); mb.pop();
    mb.push(); mb.translate(s * 0.36, 0.86, -0.58); mb.rotateX(0.16); mb.chamferBox(0.50, 0.62, 0.14, 0.05); mb.pop();
    mb.push(); mb.translate(s * 0.36, 1.18, -0.62); mb.box(0.44, 0.16, 0.14); mb.pop();
    // Side bolsters: a bucket seat is mostly its bolsters seen from inside.
    for (const b of [-1, 1]) {
      mb.push(); mb.translate(s * 0.36 + b * 0.245, 0.66, -0.32); mb.rotateZ(-b * 0.22);
      mb.chamferBox(0.075, 0.19, 0.46, 0.035); mb.pop();
      mb.push(); mb.translate(s * 0.36 + b * 0.215, 0.92, -0.545); mb.rotateX(0.16); mb.rotateY(-b * 0.30);
      mb.chamferBox(0.070, 0.54, 0.16, 0.032); mb.pop();
    }
    // Six-point harness.
    mb.mat([0.78, 0.30, 0.05], 0.85, 0, 0, FLAG_DEFAULT);
    for (const h of [-0.13, 0.13]) {
      mb.push(); mb.translate(s * 0.36 + h, 0.90, -0.495); mb.rotateX(0.16); mb.box(0.062, 0.54, 0.014); mb.pop();
    }
    for (const h of [-1, 1]) {
      mb.push(); mb.translate(s * 0.36 + h * 0.17, 0.625, -0.34); mb.rotateZ(h * 0.5);
      mb.box(0.055, 0.15, 0.014); mb.pop();
    }
    mb.mat([0.20, 0.21, 0.24], 0.35, 0.7, 0, FLAG_DEFAULT);
    mb.push(); mb.translate(s * 0.36, 0.635, -0.40); mb.box(0.085, 0.075, 0.026); mb.pop();
  }

  // Extinguisher bottle strapped behind the passenger seat.
  mb.mat([0.72, 0.10, 0.07], 0.35, 0.15, 0, FLAG_DEFAULT);
  mb.push(); mb.translate(0.36, 0.60, -0.86); mb.rotateZ(Math.PI / 2); mb.cylinder(0.058, 0.058, 0.30, 12); mb.pop();
  // Roll cage.
  useMat(mb, MAT.cage);
  const tube = (from, to, r = 0.028) => {
    const d = v3.sub([0, 0, 0], to, from);
    const len = v3.len(d);
    const mid = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2];
    const yaw = Math.atan2(d[0], d[2]);
    const pitch = Math.asin(clamp(d[1] / (len || 1), -1, 1));
    mb.push();
    mb.translate(mid[0], mid[1], mid[2]);
    mb.rotateY(yaw);
    mb.rotateX(Math.PI / 2 - pitch);
    mb.cylinder(r, r, len, 10);
    mb.pop();
  };
  // Main hoop.
  tube([-0.66, 0.46, -0.72], [-0.68, 1.22, -0.80]);
  tube([0.66, 0.46, -0.72], [0.68, 1.22, -0.80]);
  tube([-0.68, 1.22, -0.80], [0.68, 1.22, -0.80]);
  // A pillar bars and roof rails.
  tube([-0.68, 1.22, -0.80], [-0.62, 1.17, 0.28]);
  tube([0.68, 1.22, -0.80], [0.62, 1.17, 0.28]);
  tube([-0.62, 1.17, 0.28], [-0.58, 0.82, 0.88]);
  tube([0.62, 1.17, 0.28], [0.58, 0.82, 0.88]);
  tube([-0.62, 1.17, 0.28], [0.62, 1.17, 0.28]);
  // Rear stays and door bars.
  tube([-0.66, 1.18, -0.84], [-0.60, 0.50, -1.60]);
  tube([0.66, 1.18, -0.84], [0.60, 0.50, -1.60]);
  tube([-0.70, 0.60, -0.70], [-0.66, 0.72, 0.40], 0.024);
  tube([0.70, 0.60, -0.70], [0.66, 0.72, 0.40], 0.024);
  // Pedal box: clutch, brake, throttle, plus a dead pedal for the left foot.
  useMat(mb, MAT.steel);
  for (const px of [-0.44, -0.30, -0.16]) {
    mb.push(); mb.translate(px, 0.55, 0.90); mb.rotateX(0.35); mb.box(0.07, 0.16, 0.02); mb.pop();
    mb.push(); mb.translate(px, 0.475, 0.905); mb.box(0.018, 0.075, 0.018); mb.pop();
  }
  mb.push(); mb.translate(-0.585, 0.545, 0.86); mb.rotateX(0.30); mb.rotateZ(-0.16);
  mb.box(0.085, 0.24, 0.018); mb.pop();
}

// --- steering wheel ---------------------------------------------------------
//
// Local frame: the rim lies in XY with +Y up and the wheel's own origin at the
// hub. The driver is on the -Z side, so everything meant to be read or pressed
// faces -Z and the paddles hide behind at +Z. The mesh is separate from the
// interior so the input can rotate it.

// How far round the rim the hands sit, measured from 3 o'clock. Quarter to
// three, the way you are taught, is a small lift above the horizontal.
const GRIP_ANGLE = 0.16;

// A smooth window that peaks at 9 and 3 o'clock: where the rim is thickest and
// where the suede goes.
function rimGrip(a) {
  const s = clamp((Math.abs(Math.cos(a)) - 0.52) / 0.42, 0, 1);
  return s * s * (3 - 2 * s);
}

function buildSteeringWheel(mb) {
  const R = WHEEL_RADIUS;
  const FLAT = -0.60 * R;             // flat bottom, the way a race wheel is cut
  const seg = 56, tubeSeg = 12;

  // Centreline first, then a tube swept along it. Sweeping off the centreline
  // rather than off the circle is what lets the bottom go flat without the
  // section shearing where the curve straightens out.
  const centre = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * TAU;
    centre.push([Math.cos(a) * R, Math.max(Math.sin(a) * R, FLAT)]);
  }
  const rings = [], grips = [];
  for (let i = 0; i <= seg; i++) {
    const k = i % seg;
    const p = centre[k];
    const pPrev = centre[(k - 1 + seg) % seg], pNext = centre[(k + 1) % seg];
    let tx = pNext[0] - pPrev[0], ty = pNext[1] - pPrev[1];
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl; ty /= tl;
    const ux = ty, uy = -tx;          // outward normal; the curve runs anticlockwise
    const g = rimGrip(Math.atan2(p[1], p[0]));
    grips.push(g);
    // D-section: deeper front-to-back than it is thick, and fatter in the grips.
    const rr = 0.0155 + 0.0080 * g;
    const rz = 0.0205 + 0.0090 * g;
    const ring = [];
    for (let j = 0; j < tubeSeg; j++) {
      const b = (j / tubeSeg) * TAU;
      const cb = Math.cos(b), sb = Math.sin(b);
      ring.push([p[0] + ux * rr * cb, p[1] + uy * rr * cb, sb * rz]);
    }
    rings.push(ring);
  }
  mb.loft(rings, true, false, false, (i, j, b) => {
    if (grips[i] > 0.5) b.mat([0.052, 0.048, 0.052], 0.96, 0.0, 0, FLAG_DEFAULT);
    else b.mat([0.028, 0.028, 0.032], 0.52, 0.08, 0, FLAG_DEFAULT);
  });

  // Spokes: two horizontal, one down to the flat bottom.
  useMat(mb, MAT.carbon);
  for (const a of [0, Math.PI]) {
    mb.push(); mb.rotateZ(a);
    mb.translate(R * 0.56, 0, 0.004);
    mb.chamferBox(R * 0.78, 0.050, 0.018, 0.007);
    mb.pop();
  }
  mb.push(); mb.translate(0, -0.048, 0.004); mb.chamferBox(0.038, 0.080, 0.016, 0.006); mb.pop();

  // Hub, quick release collar, and the flat plate the controls sit on.
  mb.push(); mb.translate(0, 0, 0.014); mb.rotateX(Math.PI / 2); mb.cylinder(0.058, 0.050, 0.056, 16); mb.pop();
  useMat(mb, MAT.matte);
  mb.push(); mb.translate(0, 0, 0.040); mb.rotateX(Math.PI / 2); mb.cylinder(0.036, 0.044, 0.030, 14); mb.pop();
  useMat(mb, MAT.carbon);
  mb.push(); mb.translate(0, 0.002, -0.016); mb.chamferBox(0.142, 0.094, 0.012, 0.006); mb.pop();

  // Screen, with a lit strip that stands in for the readout.
  mb.mat([0.012, 0.016, 0.019], 0.18, 0.0, 0.04, FLAG_UNLIT);
  mb.push(); mb.translate(0, -0.006, -0.0235); mb.box(0.112, 0.046, 0.005); mb.pop();
  // The gear block, then a speed field beside it. Dim: this sits 60 cm from the
  // eye, and anything brighter reads as a torch rather than an LCD.
  mb.mat([0.10, 0.42, 0.20], 0.2, 0.0, 0.42, FLAG_UNLIT);
  mb.push(); mb.translate(-0.024, -0.006, -0.0265); mb.box(0.030, 0.026, 0.002); mb.pop();
  mb.mat([0.16, 0.24, 0.34], 0.2, 0.0, 0.34, FLAG_UNLIT);
  mb.push(); mb.translate(0.028, -0.010, -0.0265); mb.box(0.046, 0.012, 0.002); mb.pop();

  // Thumb buttons and two rotaries, all facing the driver.
  const button = (x, y, col) => {
    mb.mat(col, 0.42, 0.05, 0.10, FLAG_DEFAULT);
    mb.push(); mb.translate(x, y, -0.0255); mb.rotateX(-Math.PI / 2);
    mb.cylinder(0.0080, 0.0092, 0.008, 10); mb.pop();
  };
  button(-0.043, -0.036, [0.70, 0.09, 0.06]);
  button(-0.015, -0.036, [0.85, 0.62, 0.05]);
  button(0.015, -0.036, [0.10, 0.34, 0.80]);
  button(0.043, -0.036, [0.80, 0.81, 0.84]);
  button(-0.052, 0.030, [0.14, 0.15, 0.17]);
  button(0.052, 0.030, [0.14, 0.15, 0.17]);
  mb.mat([0.17, 0.18, 0.20], 0.32, 0.75, 0, FLAG_DEFAULT);
  for (const s of [-1, 1]) {
    mb.push(); mb.translate(s * 0.094, 0.004, -0.012); mb.rotateX(-Math.PI / 2);
    mb.cylinder(0.016, 0.019, 0.018, 12); mb.pop();
  }

  // Shift paddles, tucked behind the rim where the fingers reach.
  useMat(mb, MAT.carbon);
  for (const s of [-1, 1]) {
    mb.push();
    mb.translate(s * 0.070, 0.050, 0.052);
    mb.rotateY(s * 0.28);
    mb.rotateZ(-s * 0.52);
    mb.chamferBox(0.028, 0.090, 0.009, 0.004);
    mb.pop();
  }
}

// The shift lights are their own meshes, one per colour band, because the
// renderer can tint an unlit mesh per draw call - that is what lets them come
// up in sequence with the revs instead of being painted on.
const SHIFT_LIGHT_BANDS = [[0, 3], [3, 6], [6, 8]];

function buildShiftLights(mb, from, to) {
  for (let i = from; i < to; i++) {
    const t = (i - 3.5) / 3.5;
    const col = i < 3 ? [0.12, 1.00, 0.24] : (i < 6 ? [1.00, 0.52, 0.03] : [1.00, 0.10, 0.05]);
    mb.mat(col, 0.25, 0.0, 1.4, FLAG_UNLIT);
    mb.push();
    mb.translate(t * 0.047, 0.032, -0.0245);
    mb.box(0.0105, 0.0095, 0.004);
    mb.pop();
  }
}

// --- driver -----------------------------------------------------------------

// The arms are not part of the driver mesh: they are two bones per side, aimed
// each frame from a fixed shoulder to a hand that rides round with the rim. A
// baked-in pose can only ever be right at one steering angle.

// One glove, gripping a rim that runs along local +Y, with the wheel's centre
// towards -X and the driver towards -Z. The wrist enters from -Z, because that
// is where the arm comes from at every point around the rim. `side` is -1 for
// the left hand.
function buildGlove(mb, side) {
  mb.mat([0.56, 0.10, 0.08], 0.74, 0.0, 0, FLAG_DEFAULT);
  // Palm and back of the hand, closed around the rim.
  mb.push(); mb.translate(side * 0.003, 0.002, -0.004); mb.chamferBox(0.054, 0.104, 0.082, 0.022); mb.pop();
  // Fingers curling round to the inside of the rim.
  for (let i = 0; i < 4; i++) {
    const y = 0.036 - i * 0.025;
    mb.push();
    mb.translate(-side * 0.026, y, 0.002);
    mb.rotateY(side * 0.10);
    mb.chamferBox(0.030, 0.020, 0.070, 0.009);
    mb.pop();
  }
  // Thumb, hooked up over the driver's face of the rim.
  mb.push();
  mb.translate(-side * 0.006, 0.050, -0.032);
  mb.rotateZ(side * 0.42);
  mb.chamferBox(0.024, 0.058, 0.026, 0.010);
  mb.pop();
  // A narrow cuff band, then straight into the sleeve. Anything chunkier here
  // reads as a boxing glove from the driver's seat.
  mb.mat([0.86, 0.87, 0.90], 0.80, 0.0, 0, FLAG_DEFAULT);
  mb.push(); mb.translate(0, -0.002, -0.048); mb.chamferBox(0.050, 0.062, 0.014, 0.006); mb.pop();
  useMat(mb, MAT.suit);
  mb.push(); mb.translate(0, -0.004, -0.070); mb.chamferBox(0.046, 0.058, 0.034, 0.014); mb.pop();
}

// A bone running from the origin along +Z with unit length, so the render code
// can scale it to whatever the shoulder-to-hand distance happens to be.
function buildArmBone(mb, rootR, tipR) {
  useMat(mb, MAT.suit);
  mb.push();
  mb.rotateX(Math.PI / 2);
  mb.translate(0, 0.5, 0);
  mb.cylinder(tipR, rootR, 1.0, 10);
  mb.pop();
}

// `withHead` is false for the cockpit view, which is sitting inside the helmet.
function buildDriver(mb, withHead) {
  useMat(mb, MAT.suit);
  // Torso and shoulders. The arms are added at render time.
  mb.push(); mb.translate(SEAT_X, 0.86, -0.42); mb.rotateX(0.20); mb.chamferBox(0.40, 0.44, 0.26, 0.09); mb.pop();
  for (const s of [-1, 1]) {
    mb.push(); mb.translate(SEAT_X + s * 0.205, 0.965, -0.40); mb.sphere(0.078, 8, 6); mb.pop();
  }
  // Legs, angled in towards the pedal box.
  for (const s of [-1, 1]) {
    mb.push(); mb.translate(SEAT_X + s * 0.115, 0.615, 0.16); mb.rotateX(1.36); mb.rotateZ(-s * 0.10);
    mb.cylinder(0.062, 0.078, 0.60, 8); mb.pop();
    mb.push(); mb.translate(SEAT_X + s * 0.135, 0.545, 0.64); mb.rotateX(1.10);
    mb.cylinder(0.052, 0.060, 0.42, 8); mb.pop();
    mb.mat([0.06, 0.06, 0.07], 0.65, 0.0, 0, FLAG_DEFAULT);
    mb.push(); mb.translate(SEAT_X + s * 0.140, 0.500, 0.845); mb.rotateX(0.30);
    mb.chamferBox(0.078, 0.070, 0.185, 0.028); mb.pop();
    useMat(mb, MAT.suit);
  }
  // HANS device sits on the shoulders whether or not the head is drawn.
  useMat(mb, MAT.carbon);
  mb.push(); mb.translate(SEAT_X, 1.03, -0.50); mb.box(0.34, 0.06, 0.16); mb.pop();
  if (!withHead) return;
  useMat(mb, MAT.helmet);
  mb.push(); mb.translate(SEAT_X, 1.19, -0.46); mb.sphere(0.135, 14, 10, 1.06); mb.pop();
  useMat(mb, MAT.visor);
  mb.push(); mb.translate(SEAT_X, 1.20, -0.36); mb.rotateX(0.05); mb.chamferBox(0.20, 0.085, 0.10, 0.04); mb.pop();
}

// --- assembly ---------------------------------------------------------------

function buildCarMeshes(gl) {
  const body = new MeshBuilder();
  const glass = new MeshBuilder();
  const interior = new MeshBuilder();
  buildBodyShell(body);
  buildCabin(body, glass, interior);
  buildAeroAndTrim(body);
  buildRearWing(body);
  buildLights(body);

  buildInterior(interior);

  // The driver is separate so the cockpit camera can hide the helmet it is
  // sitting inside, and the arms are separate again so they can be posed.
  const driver = new MeshBuilder();
  buildDriver(driver, true);
  const driverNoHead = new MeshBuilder();
  buildDriver(driverNoHead, false);

  const gloveLeft = new MeshBuilder();
  buildGlove(gloveLeft, -1);
  const gloveRight = new MeshBuilder();
  buildGlove(gloveRight, 1);
  const upperArm = new MeshBuilder();
  buildArmBone(upperArm, 0.070, 0.052);
  const forearm = new MeshBuilder();
  buildArmBone(forearm, 0.050, 0.038);

  const steering = new MeshBuilder();
  buildSteeringWheel(steering);

  // Everything above lives under the roof. Flagging it as cabin trim is what
  // keeps the dashboard from being lit as though it were parked in the open;
  // the helmet, the dash screens and the shift lights keep their own flags.
  for (const b of [interior, driver, driverNoHead, gloveLeft, gloveRight, upperArm, forearm, steering]) {
    b.markCabin();
  }

  const shiftLights = SHIFT_LIGHT_BANDS.map(([from, to]) => {
    const b = new MeshBuilder();
    buildShiftLights(b, from, to);
    return b;
  });

  const wheelFront = new MeshBuilder();
  buildTire(wheelFront, CAR_SPEC.wheelRadiusFront, CAR_SPEC.wheelWidthFront, CAR_SPEC.wheelRadiusFront * 0.60);
  buildRim(wheelFront, CAR_SPEC.wheelRadiusFront * 0.60, CAR_SPEC.wheelWidthFront);

  const wheelRear = new MeshBuilder();
  buildTire(wheelRear, CAR_SPEC.wheelRadiusRear, CAR_SPEC.wheelWidthRear, CAR_SPEC.wheelRadiusRear * 0.60);
  buildRim(wheelRear, CAR_SPEC.wheelRadiusRear * 0.60, CAR_SPEC.wheelWidthRear);

  const caliperFront = new MeshBuilder();
  buildCaliper(caliperFront, CAR_SPEC.wheelRadiusFront * 0.60, CAR_SPEC.wheelWidthFront);
  const caliperRear = new MeshBuilder();
  buildCaliper(caliperRear, CAR_SPEC.wheelRadiusRear * 0.60, CAR_SPEC.wheelWidthRear);

  return {
    body: meshFromBuilder(gl, body),
    glass: meshFromBuilder(gl, glass),
    interior: meshFromBuilder(gl, interior),
    driver: meshFromBuilder(gl, driver),
    driverNoHead: meshFromBuilder(gl, driverNoHead),
    gloveLeft: meshFromBuilder(gl, gloveLeft),
    gloveRight: meshFromBuilder(gl, gloveRight),
    upperArm: meshFromBuilder(gl, upperArm),
    forearm: meshFromBuilder(gl, forearm),
    steering: meshFromBuilder(gl, steering),
    shiftLights: shiftLights.map((b) => meshFromBuilder(gl, b)),
    wheelFront: meshFromBuilder(gl, wheelFront),
    wheelRear: meshFromBuilder(gl, wheelRear),
    caliperFront: meshFromBuilder(gl, caliperFront),
    caliperRear: meshFromBuilder(gl, caliperRear),
  };
}
