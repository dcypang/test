// ---------------------------------------------------------------------------
// props.js - everything that decorates the world: barriers, grandstands,
// buildings, houses, street furniture, trees and traffic cars.
// All of it is emitted into shared MeshBuilders and uploaded as a few big
// static meshes, so scenery costs almost nothing at draw time.
// ---------------------------------------------------------------------------

const PROP_MAT = {
  concrete: { color: [0.52, 0.52, 0.50], rough: 0.88, metal: 0.0, flag: FLAG_DEFAULT },
  concreteDark: { color: [0.34, 0.34, 0.33], rough: 0.90, metal: 0.0, flag: FLAG_DEFAULT },
  steel: { color: [0.60, 0.62, 0.64], rough: 0.35, metal: 0.85, flag: FLAG_DEFAULT },
  steelDark: { color: [0.26, 0.27, 0.29], rough: 0.50, metal: 0.70, flag: FLAG_DEFAULT },
  rubber: { color: [0.055, 0.055, 0.058], rough: 0.92, metal: 0.0, flag: FLAG_DEFAULT },
  white: { color: [0.86, 0.86, 0.84], rough: 0.60, metal: 0.0, flag: FLAG_DEFAULT },
  red: { color: [0.62, 0.09, 0.08], rough: 0.60, metal: 0.0, flag: FLAG_DEFAULT },
  green: { color: [0.10, 0.42, 0.16], rough: 0.70, metal: 0.0, flag: FLAG_DEFAULT },
  wood: { color: [0.34, 0.24, 0.15], rough: 0.85, metal: 0.0, flag: FLAG_DEFAULT },
  bark: { color: [0.22, 0.17, 0.12], rough: 0.92, metal: 0.0, flag: FLAG_DEFAULT },
  leaf: { color: [0.14, 0.30, 0.10], rough: 0.85, metal: 0.0, flag: FLAG_FOLIAGE },
  glassDark: { color: [0.05, 0.07, 0.09], rough: 0.10, metal: 0.0, flag: FLAG_GLASS },
  brick: { color: [0.44, 0.26, 0.20], rough: 0.90, metal: 0.0, flag: FLAG_DEFAULT },
  render: { color: [0.72, 0.69, 0.62], rough: 0.88, metal: 0.0, flag: FLAG_DEFAULT },
  roofTile: { color: [0.30, 0.16, 0.13], rough: 0.85, metal: 0.0, flag: FLAG_DEFAULT },
  roofSlate: { color: [0.18, 0.19, 0.21], rough: 0.72, metal: 0.05, flag: FLAG_DEFAULT },
  asphaltProp: { color: [0.10, 0.10, 0.11], rough: 0.80, metal: 0.0, flag: FLAG_ROAD },
};

function pm(mb, m, colorOverride) {
  mb.mat(colorOverride || m.color, m.rough, m.metal, 0, m.flag);
  return mb;
}

// --- vegetation -------------------------------------------------------------

function buildTree(mb, rng, style = 0) {
  const h = rnd2(rng, 5.5, 11.0);
  const trunkR = h * rnd2(rng, 0.028, 0.045);
  pm(mb, PROP_MAT.bark, [0.20 + rng() * 0.08, 0.15 + rng() * 0.06, 0.10 + rng() * 0.05]);
  mb.push();
  mb.translate(0, h * 0.28, 0);
  mb.cylinder(trunkR * 0.7, trunkR, h * 0.56, 8);
  mb.pop();

  const leafTint = [0.09 + rng() * 0.09, 0.22 + rng() * 0.16, 0.07 + rng() * 0.07];
  pm(mb, PROP_MAT.leaf, leafTint);
  if (style === 0) {
    // Broadleaf: a cluster of squashed spheres.
    const blobs = 3 + Math.floor(rng() * 3);
    for (let i = 0; i < blobs; i++) {
      const r = h * rnd2(rng, 0.20, 0.30);
      mb.push();
      mb.translate(rnd2(rng, -0.5, 0.5) * h * 0.22, h * rnd2(rng, 0.58, 0.86), rnd2(rng, -0.5, 0.5) * h * 0.22);
      mb.sphere(r, 10, 7, rnd2(rng, 0.7, 0.95));
      mb.pop();
    }
  } else if (style === 1) {
    // Conifer: stacked cones.
    const tiers = 4;
    for (let i = 0; i < tiers; i++) {
      const t = i / tiers;
      mb.push();
      mb.translate(0, h * (0.34 + t * 0.52), 0);
      mb.cylinder(h * 0.02, h * (0.26 - t * 0.16), h * 0.26, 11, false, true);
      mb.pop();
    }
  } else {
    // Poplar: tall and narrow.
    mb.push();
    mb.translate(0, h * 0.66, 0);
    mb.sphere(h * 0.17, 10, 9, 2.6);
    mb.pop();
  }
}

function rnd2(rng, a, b) { return a + rng() * (b - a); }

// A clipped hedge: one continuous lofted mass with a slightly uneven top,
// rather than a row of separate boxes with daylight between them.
function buildHedge(mb, length, height = 1.2, depth = 0.8, rng) {
  pm(mb, PROP_MAT.leaf, [0.09, 0.20, 0.08]);
  const cols = Math.max(6, Math.round(length / 0.55));
  const profile = [];
  const M = 9;
  for (let k = 0; k < M; k++) {
    const u = k / (M - 1);
    const th = u * Math.PI;
    const n = 3.6;
    profile.push([
      Math.sign(Math.cos(th)) * Math.pow(Math.abs(Math.cos(th)), 2 / n),
      Math.pow(Math.abs(Math.sin(th)), 2 / n),
    ]);
  }
  const rings = [];
  for (let i = 0; i <= cols; i++) {
    const t = i / cols;
    const x = (t - 0.5) * length;
    // Ends taper in; the top wobbles a little so it does not look extruded.
    const taper = Math.min(1, Math.sin(Math.min(t, 1 - t) * Math.PI * 2.2) * 1.6 + 0.35);
    const wob = rng ? 1 + (rng() - 0.5) * 0.10 : 1;
    const h = height * wob * taper;
    const d = depth * 0.5 * taper;
    rings.push(profile.map(([pz, py]) => [x, py * h, pz * d]));
  }
  mb.loft(rings, false, false, false);
}

// --- circuit furniture ------------------------------------------------------

// Steel armco: posts every few metres with a double rail.
function buildArmco(mb, world, samples) {
  pm(mb, PROP_MAT.steelDark);
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i], b = samples[i + 1];
    const dx = b[0] - a[0], dz = b[2] - a[2];
    const len = Math.hypot(dx, dz);
    if (len < 0.01) continue;
    const yaw = Math.atan2(dx, dz);
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 0.62, (a[2] + b[2]) / 2];
    pm(mb, PROP_MAT.steel);
    for (const dy of [0, 0.34]) {
      mb.push();
      mb.translate(mid[0], mid[1] + dy, mid[2]);
      mb.rotateY(yaw);
      mb.box(0.05, 0.24, len * 1.02);
      mb.pop();
    }
    if (i % 3 === 0) {
      pm(mb, PROP_MAT.steelDark);
      mb.push();
      mb.translate(a[0], a[1] + 0.42, a[2]);
      mb.box(0.10, 0.86, 0.10);
      mb.pop();
    }
  }
}

// Debris fence above the barrier: posts plus a few horizontal wires.
function buildCatchFence(mb, samples, height = 3.6) {
  pm(mb, PROP_MAT.steelDark);
  for (let i = 0; i < samples.length; i += 3) {
    const a = samples[i];
    mb.push();
    mb.translate(a[0], a[1] + height / 2 + 0.9, a[2]);
    mb.box(0.09, height, 0.09);
    mb.pop();
  }
  pm(mb, PROP_MAT.steel, [0.42, 0.44, 0.46]);
  for (let level = 0; level < 5; level++) {
    const y = 1.1 + (level / 4) * height;
    for (let i = 0; i < samples.length - 1; i++) {
      const a = samples[i], b = samples[i + 1];
      const dx = b[0] - a[0], dz = b[2] - a[2];
      const len = Math.hypot(dx, dz);
      if (len < 0.01) continue;
      mb.push();
      mb.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + y, (a[2] + b[2]) / 2);
      mb.rotateY(Math.atan2(dx, dz));
      mb.box(0.03, 0.03, len * 1.02);
      mb.pop();
    }
  }
}

function buildTyreWall(mb, samples, rows = 2) {
  for (let i = 0; i < samples.length; i += 1) {
    const p = samples[i];
    for (let r = 0; r < rows; r++) {
      for (let level = 0; level < 3; level++) {
        pm(mb, PROP_MAT.rubber, level === 2 && r === rows - 1 ? [0.55, 0.52, 0.14] : PROP_MAT.rubber.color);
        mb.push();
        mb.translate(p[0], p[1] + 0.19 + level * 0.34, p[2]);
        mb.translate(0, 0, 0);
        mb.rotateX(Math.PI / 2);
        mb.cylinder(0.34, 0.34, 0.22, 10, true, false);
        mb.pop();
      }
    }
  }
}

// Advertising hoardings that sit against the barrier.
function buildHoardings(mb, samples, rng) {
  const palette = [
    [0.82, 0.16, 0.12], [0.10, 0.32, 0.68], [0.94, 0.72, 0.10],
    [0.10, 0.52, 0.30], [0.88, 0.88, 0.86], [0.20, 0.20, 0.24],
  ];
  for (let i = 0; i < samples.length - 1; i += 2) {
    const a = samples[i], b = samples[Math.min(i + 2, samples.length - 1)];
    const dx = b[0] - a[0], dz = b[2] - a[2];
    const len = Math.hypot(dx, dz);
    if (len < 0.5) continue;
    const col = palette[Math.floor(rng() * palette.length)];
    mb.mat(col, 0.62, 0.0, 0.0, FLAG_DEFAULT);
    mb.push();
    mb.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 0.60, (a[2] + b[2]) / 2);
    mb.rotateY(Math.atan2(dx, dz));
    mb.box(0.06, 1.05, len * 1.02);
    mb.pop();
  }
}

function buildGrandstand(mb, width, depth, rows, rng) {
  const rowH = 0.42, rowD = depth / rows;
  pm(mb, PROP_MAT.concrete);
  mb.push(); mb.translate(0, 0.25, 0); mb.box(width + 1.2, 0.5, depth + 1.0); mb.pop();
  for (let r = 0; r < rows; r++) {
    const y = 0.5 + r * rowH;
    const z = depth / 2 - r * rowD - rowD / 2;
    pm(mb, PROP_MAT.concreteDark);
    mb.push(); mb.translate(0, y + rowH / 2, z); mb.box(width, rowH, rowD); mb.pop();
    // Seats.
    const seats = Math.floor(width / 0.62);
    for (let s = 0; s < seats; s++) {
      const x = (s - (seats - 1) / 2) * 0.62;
      mb.mat(rng() < 0.5 ? [0.14, 0.22, 0.52] : [0.16, 0.26, 0.60], 0.75, 0, 0, FLAG_DEFAULT);
      mb.push(); mb.translate(x, y + rowH + 0.10, z - rowD * 0.18); mb.box(0.46, 0.20, 0.34); mb.pop();
      // Sparse crowd.
      if (rng() < 0.42) {
        const shirt = [rng() * 0.8 + 0.1, rng() * 0.8 + 0.1, rng() * 0.8 + 0.1];
        mb.mat(shirt, 0.85, 0, 0, FLAG_DEFAULT);
        mb.push(); mb.translate(x, y + rowH + 0.42, z - rowD * 0.20); mb.box(0.34, 0.44, 0.24); mb.pop();
        mb.mat([0.72, 0.56, 0.44], 0.85, 0, 0, FLAG_DEFAULT);
        mb.push(); mb.translate(x, y + rowH + 0.74, z - rowD * 0.20); mb.sphere(0.11, 7, 5); mb.pop();
      }
    }
  }
  // Roof on columns.
  const topY = 0.5 + rows * rowH;
  pm(mb, PROP_MAT.steelDark);
  for (const sx of [-1, 1]) {
    mb.push(); mb.translate(sx * width * 0.46, topY * 0.75, -depth / 2 + 0.4); mb.box(0.22, topY * 1.5, 0.22); mb.pop();
    mb.push(); mb.translate(sx * width * 0.46, topY * 1.05, depth / 2 - 0.4); mb.box(0.22, topY * 2.1, 0.22); mb.pop();
  }
  pm(mb, PROP_MAT.steel, [0.48, 0.50, 0.52]);
  mb.push(); mb.translate(0, topY * 2.1 + 0.2, 0); mb.rotateX(-0.10); mb.box(width + 1.4, 0.16, depth + 1.6); mb.pop();
}

function buildPitBuilding(mb, bays, rng) {
  const bayW = 8.0, depth = 12.0, h = 6.2;
  const width = bays * bayW;
  pm(mb, PROP_MAT.concrete);
  mb.push(); mb.translate(0, h / 2, 0); mb.box(width, h, depth); mb.pop();
  // Garage doors facing +Z (toward the pit lane).
  for (let i = 0; i < bays; i++) {
    const x = (i - (bays - 1) / 2) * bayW;
    pm(mb, PROP_MAT.steelDark);
    mb.push(); mb.translate(x, 2.1, depth / 2 + 0.06); mb.box(bayW * 0.72, 4.0, 0.14); mb.pop();
    mb.mat([0.86, 0.86, 0.88], 0.55, 0, 0, FLAG_DEFAULT);
    mb.push(); mb.translate(x, 4.35, depth / 2 + 0.10); mb.box(bayW * 0.72, 0.24, 0.10); mb.pop();
    // Bay number plate.
    mb.mat([0.10, 0.10, 0.12], 0.6, 0, 0, FLAG_DEFAULT);
    mb.push(); mb.translate(x, 4.85, depth / 2 + 0.10); mb.box(0.7, 0.5, 0.08); mb.pop();
  }
  // Glazed upper level with a viewing terrace.
  pm(mb, PROP_MAT.glassDark);
  mb.push(); mb.translate(0, h + 1.6, depth / 2 - 0.4); mb.box(width * 0.98, 2.6, 0.2); mb.pop();
  pm(mb, PROP_MAT.concrete);
  mb.push(); mb.translate(0, h + 0.2, 0); mb.box(width + 0.8, 0.4, depth + 2.2); mb.pop();
  mb.push(); mb.translate(0, h + 3.2, 0); mb.box(width, 0.4, depth); mb.pop();
  pm(mb, PROP_MAT.steel);
  mb.push(); mb.translate(0, h + 0.9, depth / 2 + 1.0); mb.box(width, 0.06, 0.06); mb.pop();
}

// Start / finish gantry with the five red lights.
function buildGantry(mb, span, height = 7.4) {
  pm(mb, PROP_MAT.steelDark);
  for (const s of [-1, 1]) {
    mb.push(); mb.translate(s * span / 2, height / 2, 0); mb.box(0.55, height, 0.55); mb.pop();
    mb.push(); mb.translate(s * span / 2, height * 0.55, 0); mb.rotateZ(s * 0.5); mb.box(0.20, height * 0.5, 0.20); mb.pop();
  }
  mb.push(); mb.translate(0, height, 0); mb.box(span, 0.8, 1.0); mb.pop();
  pm(mb, PROP_MAT.white);
  mb.push(); mb.translate(0, height + 0.75, 0); mb.box(span * 0.6, 0.7, 0.3); mb.pop();
  // Light housings; the lamps themselves are drawn as glowing sprites.
  pm(mb, PROP_MAT.steelDark, [0.08, 0.08, 0.09]);
  for (let i = 0; i < 5; i++) {
    mb.push();
    mb.translate((i - 2) * 1.5, height - 0.9, 0.35);
    mb.box(1.15, 1.15, 0.35);
    mb.pop();
  }
}

function buildMarshalPost(mb, rng) {
  pm(mb, PROP_MAT.concrete);
  mb.push(); mb.translate(0, 1.2, 0); mb.box(2.6, 2.4, 2.0); mb.pop();
  pm(mb, PROP_MAT.steelDark);
  mb.push(); mb.translate(0, 2.55, 0); mb.box(3.0, 0.2, 2.4); mb.pop();
  mb.mat([0.90, 0.72, 0.05], 0.7, 0, 0, FLAG_DEFAULT);
  mb.push(); mb.translate(0.9, 1.9, 1.05); mb.box(0.7, 0.9, 0.06); mb.pop();
}

// --- town buildings ---------------------------------------------------------

function buildWindowGrid(mb, width, height, cols, rows, depth, lit, rng) {
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = (c - (cols - 1) / 2) * (width / cols);
      const y = (r + 0.6) * (height / (rows + 0.4));
      const isLit = lit && rng() < 0.35;
      if (isLit) mb.mat([0.98, 0.86, 0.58], 0.3, 0, 0.85, FLAG_UNLIT);
      else pm(mb, PROP_MAT.glassDark);
      mb.push();
      mb.translate(x, y, depth);
      mb.box(width / cols * 0.55, height / (rows + 0.4) * 0.52, 0.08);
      mb.pop();
    }
  }
}

function buildTownBuilding(mb, rng, opts = {}) {
  const w = opts.width || rnd2(rng, 9, 16);
  const d = opts.depth || rnd2(rng, 9, 14);
  const floors = opts.floors || (2 + Math.floor(rng() * 2));
  const floorH = 3.2;
  const h = floors * floorH;
  const wallTints = [[0.70, 0.66, 0.60], [0.60, 0.48, 0.42], [0.76, 0.74, 0.70], [0.48, 0.40, 0.36], [0.66, 0.60, 0.52]];
  const wall = wallTints[Math.floor(rng() * wallTints.length)];
  mb.mat(wall, 0.90, 0, 0, FLAG_DEFAULT);
  mb.push(); mb.translate(0, h / 2, 0); mb.chamferBox(w, h, d, 0.16); mb.pop();

  // Shopfront on the ground floor facing +Z.
  pm(mb, PROP_MAT.glassDark);
  mb.push(); mb.translate(0, 1.5, d / 2 + 0.05); mb.box(w * 0.78, 2.4, 0.12); mb.pop();
  mb.mat([0.20 + rng() * 0.5, 0.18 + rng() * 0.4, 0.20 + rng() * 0.4], 0.7, 0, 0.10, FLAG_DEFAULT);
  mb.push(); mb.translate(0, 3.1, d / 2 + 0.12); mb.box(w * 0.86, 0.55, 0.16); mb.pop();
  // Awning.
  if (rng() < 0.5) {
    mb.mat([0.55, 0.14, 0.12], 0.8, 0, 0, FLAG_DEFAULT);
    mb.push(); mb.translate(0, 2.9, d / 2 + 0.75); mb.rotateX(0.22); mb.box(w * 0.8, 0.08, 1.5); mb.pop();
  }
  // Upper windows.
  for (let f = 1; f < floors; f++) {
    mb.push();
    mb.translate(0, f * floorH, 0);
    buildWindowGrid(mb, w * 0.82, floorH, Math.max(2, Math.round(w / 3.4)), 1, d / 2 + 0.06, true, rng);
    mb.pop();
  }
  // Parapet and roof clutter.
  mb.mat(v3.scale([0, 0, 0], wall, 0.82), 0.9, 0, 0, FLAG_DEFAULT);
  mb.push(); mb.translate(0, h + 0.25, 0); mb.box(w + 0.4, 0.5, d + 0.4); mb.pop();
  pm(mb, PROP_MAT.steelDark);
  for (let i = 0; i < 2; i++) {
    mb.push();
    mb.translate(rnd2(rng, -w * 0.3, w * 0.3), h + 0.9, rnd2(rng, -d * 0.3, d * 0.3));
    mb.box(1.4, 1.0, 1.2);
    mb.pop();
  }
}

function buildHouse(mb, rng, opts = {}) {
  const w = opts.width || rnd2(rng, 8.5, 12.5);
  const d = opts.depth || rnd2(rng, 8.0, 11.0);
  const wallH = opts.wallHeight || rnd2(rng, 4.6, 6.2);
  const brick = rng() < 0.45;
  const wall = brick
    ? [0.42 + rng() * 0.14, 0.24 + rng() * 0.08, 0.19 + rng() * 0.06]
    : [0.62 + rng() * 0.22, 0.60 + rng() * 0.20, 0.55 + rng() * 0.18];
  mb.mat(wall, 0.90, 0, 0, FLAG_DEFAULT);
  mb.push(); mb.translate(0, wallH / 2, 0); mb.box(w, wallH, d); mb.pop();

  // Gabled roof: two sloped slabs plus the triangular gable ends.
  const ridge = wallH + rnd2(rng, 1.9, 2.9);
  const overhang = 0.45;
  const roofCol = rng() < 0.5 ? PROP_MAT.roofTile.color : PROP_MAT.roofSlate.color;
  mb.mat(roofCol, 0.82, 0.02, 0, FLAG_DEFAULT);
  const halfW = w / 2 + overhang;
  const slopeLen = Math.hypot(halfW, ridge - wallH);
  for (const s of [-1, 1]) {
    const angle = Math.atan2(ridge - wallH, halfW);
    mb.push();
    mb.translate(s * halfW / 2, (wallH + ridge) / 2, 0);
    mb.rotateZ(-s * angle);
    mb.box(slopeLen, 0.14, d + overhang * 2);
    mb.pop();
  }
  // Gable ends: two real triangles, not a staircase of boxes.
  mb.mat(wall, 0.9, 0, 0, FLAG_DEFAULT);
  for (const s of [-1, 1]) {
    const zf = s * d / 2, zb = s * (d / 2 - 0.14);
    const apex = [0, ridge, zf], left = [-w / 2, wallH, zf], right = [w / 2, wallH, zf];
    const nrm = [0, 0, s];
    const a = mb.vertex(left, nrm), b = mb.vertex(right, nrm), c = mb.vertex(apex, nrm);
    if (s > 0) mb.tri(a, b, c); else mb.tri(a, c, b);
    const apex2 = [0, ridge, zb], left2 = [-w / 2, wallH, zb], right2 = [w / 2, wallH, zb];
    const nrm2 = [0, 0, -s];
    const a2 = mb.vertex(left2, nrm2), b2 = mb.vertex(right2, nrm2), c2 = mb.vertex(apex2, nrm2);
    if (s > 0) mb.tri(a2, c2, b2); else mb.tri(a2, b2, c2);
  }
  // Chimney.
  if (rng() < 0.6) {
    mb.mat([0.40, 0.24, 0.20], 0.92, 0, 0, FLAG_DEFAULT);
    mb.push(); mb.translate(rnd2(rng, -w * 0.28, w * 0.28), ridge + 0.4, rnd2(rng, -d * 0.2, d * 0.2)); mb.box(0.8, 1.9, 0.8); mb.pop();
  }
  // Front door and windows facing +Z.
  pm(mb, PROP_MAT.wood, [0.18 + rng() * 0.2, 0.10 + rng() * 0.1, 0.08]);
  mb.push(); mb.translate(-w * 0.22, 1.05, d / 2 + 0.06); mb.box(1.0, 2.1, 0.12); mb.pop();
  pm(mb, PROP_MAT.white);
  mb.push(); mb.translate(-w * 0.22, 2.22, d / 2 + 0.30); mb.box(1.5, 0.10, 0.9); mb.pop();
  const lit = rng() < 0.5;
  for (const [wx, wy] of [[w * 0.22, 1.35], [-w * 0.24, wallH - 1.3], [w * 0.22, wallH - 1.3]]) {
    if (lit && rng() < 0.5) mb.mat([0.98, 0.84, 0.55], 0.3, 0, 0.8, FLAG_UNLIT);
    else pm(mb, PROP_MAT.glassDark);
    mb.push(); mb.translate(wx, wy, d / 2 + 0.07); mb.box(1.5, 1.25, 0.10); mb.pop();
    pm(mb, PROP_MAT.white);
    mb.push(); mb.translate(wx, wy, d / 2 + 0.09); mb.box(1.62, 0.09, 0.06); mb.pop();
    mb.push(); mb.translate(wx, wy, d / 2 + 0.09); mb.box(0.09, 1.35, 0.06); mb.pop();
  }
}

// A petrol station: canopy on four columns, a pump island under it, and a
// kiosk behind. Built as one prop so the whole thing can be stamped anywhere.
function buildPetrolStation(mb, rng) {
  const w = 15, d = 11, colH = 5.0;
  // Forecourt.
  mb.mat([0.30, 0.30, 0.32], 0.85, 0, 0, FLAG_DEFAULT);
  mb.push(); mb.translate(0, 0.04, 0); mb.box(w + 6, 0.08, d + 8); mb.pop();
  // Canopy.
  mb.mat([0.90, 0.90, 0.92], 0.55, 0.05, 0, FLAG_DEFAULT);
  mb.push(); mb.translate(0, colH, 0); mb.chamferBox(w, 0.75, d, 0.18); mb.pop();
  mb.mat([0.06, 0.42, 0.24], 0.5, 0.0, 0.35, FLAG_UNLIT);
  mb.push(); mb.translate(0, colH - 0.05, -d / 2 - 0.06); mb.box(w - 1.5, 0.42, 0.10); mb.pop();
  mb.push(); mb.translate(0, colH - 0.05, d / 2 + 0.06); mb.box(w - 1.5, 0.42, 0.10); mb.pop();
  mb.mat([0.78, 0.78, 0.80], 0.45, 0.35, 0, FLAG_DEFAULT);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      mb.push(); mb.translate(sx * (w / 2 - 1.2), colH / 2, sz * (d / 2 - 1.2));
      mb.box(0.44, colH, 0.44); mb.pop();
    }
  }
  // Two pump islands.
  for (const sz of [-1, 1]) {
    mb.mat([0.55, 0.55, 0.57], 0.8, 0, 0, FLAG_DEFAULT);
    mb.push(); mb.translate(0, 0.18, sz * 3.0); mb.box(5.0, 0.3, 1.4); mb.pop();
    for (const sx of [-1.4, 1.4]) {
      mb.mat([0.86, 0.20, 0.10], 0.45, 0.1, 0, FLAG_DEFAULT);
      mb.push(); mb.translate(sx, 0.95, sz * 3.0); mb.chamferBox(0.75, 1.35, 0.62, 0.08); mb.pop();
      mb.mat([0.05, 0.06, 0.08], 0.3, 0, 0.25, FLAG_UNLIT);
      mb.push(); mb.translate(sx, 1.30, sz * 3.0 - 0.33); mb.box(0.5, 0.34, 0.03); mb.pop();
    }
  }
  // Kiosk behind the forecourt.
  mb.mat([0.72, 0.71, 0.68], 0.88, 0, 0, FLAG_DEFAULT);
  mb.push(); mb.translate(0, 1.7, -d / 2 - 5.5); mb.box(10, 3.4, 6); mb.pop();
  mb.mat([0.10, 0.16, 0.20], 0.12, 0.1, 0.05, FLAG_GLASS);
  mb.push(); mb.translate(0, 1.85, -d / 2 - 2.46); mb.box(8.4, 2.1, 0.08); mb.pop();
  // Price totem at the kerb.
  mb.mat([0.90, 0.90, 0.92], 0.5, 0.1, 0, FLAG_DEFAULT);
  mb.push(); mb.translate(-w / 2 - 2.4, 3.0, d / 2 + 2.4); mb.box(0.35, 6.0, 0.35); mb.pop();
  mb.mat([0.06, 0.42, 0.24], 0.4, 0, 0.55, FLAG_UNLIT);
  mb.push(); mb.translate(-w / 2 - 2.4, 5.4, d / 2 + 2.4); mb.box(2.2, 1.6, 0.16); mb.pop();
}

function buildGarage(mb, rng, opts = {}) {
  const w = opts.width || 6.2, d = opts.depth || 6.6, h = opts.height || 3.4;
  const wall = opts.wallColor || [0.68, 0.66, 0.60];
  mb.mat(wall, 0.90, 0, 0, FLAG_DEFAULT);
  // Three walls and a roof - the front is left open so the car can drive in.
  mb.push(); mb.translate(0, h / 2, -d / 2 + 0.15); mb.box(w, h, 0.3); mb.pop();
  for (const s of [-1, 1]) {
    mb.push(); mb.translate(s * (w / 2 - 0.15), h / 2, 0); mb.box(0.3, h, d); mb.pop();
  }
  mb.mat(PROP_MAT.roofSlate.color, 0.8, 0.02, 0, FLAG_DEFAULT);
  mb.push(); mb.translate(0, h + 0.12, 0); mb.box(w + 0.6, 0.24, d + 0.6); mb.pop();
  // Interior floor and a strip light so the garage reads as "home".
  mb.mat([0.34, 0.34, 0.35], 0.85, 0, 0, FLAG_DEFAULT);
  mb.push(); mb.translate(0, 0.03, 0); mb.box(w - 0.4, 0.06, d - 0.3); mb.pop();
  mb.mat([1.0, 0.94, 0.78], 0.3, 0, 1.6, FLAG_UNLIT);
  mb.push(); mb.translate(0, h - 0.22, 0); mb.box(2.2, 0.10, 0.24); mb.pop();
  // Clutter on the back wall.
  pm(mb, PROP_MAT.wood);
  mb.push(); mb.translate(0, 1.35, -d / 2 + 0.45); mb.box(w - 0.9, 0.10, 0.5); mb.pop();
  for (let i = 0; i < 4; i++) {
    mb.mat([rng() * 0.6 + 0.2, rng() * 0.6 + 0.2, rng() * 0.6 + 0.2], 0.8, 0, 0, FLAG_DEFAULT);
    mb.push(); mb.translate(rnd2(rng, -w * 0.3, w * 0.3), 1.6, -d / 2 + 0.45); mb.box(0.4, 0.4, 0.35); mb.pop();
  }
}

// --- street furniture -------------------------------------------------------

function buildStreetLight(mb, side = 1, height = 8.0) {
  pm(mb, PROP_MAT.steelDark, [0.30, 0.31, 0.33]);
  mb.push(); mb.translate(0, height / 2, 0); mb.cylinder(0.085, 0.13, height, 8); mb.pop();
  mb.push(); mb.translate(side * 0.9, height - 0.35, 0); mb.rotateZ(side * 1.35); mb.cylinder(0.075, 0.075, 2.0, 8); mb.pop();
  pm(mb, PROP_MAT.steel);
  mb.push(); mb.translate(side * 1.75, height - 0.05, 0); mb.chamferBox(0.75, 0.16, 0.34, 0.06); mb.pop();
  mb.mat([1.0, 0.92, 0.74], 0.25, 0, 1.0, FLAG_UNLIT);
  mb.push(); mb.translate(side * 1.75, height - 0.15, 0); mb.box(0.62, 0.06, 0.26); mb.pop();
}

function buildTrafficLightPole(mb, arm = 3.2) {
  pm(mb, PROP_MAT.steelDark, [0.22, 0.23, 0.24]);
  mb.push(); mb.translate(0, 3.0, 0); mb.cylinder(0.09, 0.12, 6.0, 8); mb.pop();
  mb.push(); mb.translate(arm / 2, 5.85, 0); mb.rotateZ(Math.PI / 2); mb.cylinder(0.07, 0.07, arm, 8); mb.pop();
  // Overhead head.
  mb.push(); mb.translate(arm, 5.35, 0); mb.chamferBox(0.42, 1.15, 0.36, 0.06); mb.pop();
  // Pole-mounted head at driver height.
  mb.push(); mb.translate(0.30, 2.9, 0); mb.chamferBox(0.34, 0.95, 0.30, 0.05); mb.pop();
  // Hoods over each lamp.
  pm(mb, PROP_MAT.steelDark, [0.14, 0.15, 0.16]);
  for (let i = 0; i < 3; i++) {
    mb.push(); mb.translate(arm, 5.72 - i * 0.36, 0.22); mb.rotateX(0.35); mb.cylinder(0.14, 0.16, 0.16, 10, false, false); mb.pop();
  }
}

function buildRoadSign(mb, kind, text) {
  pm(mb, PROP_MAT.steelDark, [0.35, 0.36, 0.38]);
  mb.push(); mb.translate(0, 1.35, 0); mb.cylinder(0.045, 0.055, 2.7, 8); mb.pop();
  if (kind === 'speed') {
    pm(mb, PROP_MAT.white);
    mb.push(); mb.translate(0, 2.55, 0.04); mb.rotateX(Math.PI / 2); mb.cylinder(0.42, 0.42, 0.06, 20); mb.pop();
    mb.mat([0.72, 0.08, 0.06], 0.6, 0, 0, FLAG_DEFAULT);
    mb.push(); mb.translate(0, 2.55, 0.075); mb.rotateX(Math.PI / 2); mb.cylinder(0.42, 0.42, 0.02, 20); mb.pop();
    pm(mb, PROP_MAT.white);
    mb.push(); mb.translate(0, 2.55, 0.09); mb.rotateX(Math.PI / 2); mb.cylinder(0.33, 0.33, 0.02, 20); mb.pop();
    // Digits as dark bars; readable enough at driving speed.
    mb.mat([0.06, 0.06, 0.07], 0.7, 0, 0, FLAG_DEFAULT);
    const digits = String(text || '50').split('');
    digits.forEach((ch, i) => {
      const x = (i - (digits.length - 1) / 2) * 0.20;
      const segs = SEVEN_SEGMENT[ch] || [];
      for (const [sx, sy, sw, sh] of segs) {
        mb.push(); mb.translate(x + sx * 0.16, 2.55 + sy * 0.24, 0.105); mb.box(sw * 0.16, sh * 0.24, 0.02); mb.pop();
      }
    });
  } else if (kind === 'give-way') {
    mb.mat([0.86, 0.86, 0.84], 0.6, 0, 0, FLAG_DEFAULT);
    mb.push(); mb.translate(0, 2.5, 0.04); mb.rotateZ(Math.PI); mb.rotateX(Math.PI / 2); mb.cylinder(0.0, 0.52, 0.06, 3); mb.pop();
  } else {
    mb.mat([0.10, 0.28, 0.52], 0.6, 0, 0, FLAG_DEFAULT);
    mb.push(); mb.translate(0, 2.5, 0.04); mb.box(1.5, 0.7, 0.07); mb.pop();
  }
}

// Bars for a seven segment digit: [x, y, w, h] in normalised units.
const SEVEN_SEGMENT = {
  '0': [[0, 1, 1, 0.18], [0.42, 0.5, 0.18, 1], [-0.42, 0.5, 0.18, 1], [0.42, -0.5, 0.18, 1], [-0.42, -0.5, 0.18, 1], [0, -1, 1, 0.18]],
  '1': [[0.42, 0.5, 0.18, 1], [0.42, -0.5, 0.18, 1]],
  '2': [[0, 1, 1, 0.18], [0.42, 0.5, 0.18, 1], [0, 0, 1, 0.18], [-0.42, -0.5, 0.18, 1], [0, -1, 1, 0.18]],
  '3': [[0, 1, 1, 0.18], [0.42, 0.5, 0.18, 1], [0, 0, 1, 0.18], [0.42, -0.5, 0.18, 1], [0, -1, 1, 0.18]],
  '4': [[-0.42, 0.5, 0.18, 1], [0.42, 0.5, 0.18, 1], [0, 0, 1, 0.18], [0.42, -0.5, 0.18, 1]],
  '5': [[0, 1, 1, 0.18], [-0.42, 0.5, 0.18, 1], [0, 0, 1, 0.18], [0.42, -0.5, 0.18, 1], [0, -1, 1, 0.18]],
  '6': [[0, 1, 1, 0.18], [-0.42, 0.5, 0.18, 1], [0, 0, 1, 0.18], [0.42, -0.5, 0.18, 1], [-0.42, -0.5, 0.18, 1], [0, -1, 1, 0.18]],
  '7': [[0, 1, 1, 0.18], [0.42, 0.5, 0.18, 1], [0.42, -0.5, 0.18, 1]],
  '8': [[0, 1, 1, 0.18], [0.42, 0.5, 0.18, 1], [-0.42, 0.5, 0.18, 1], [0, 0, 1, 0.18], [0.42, -0.5, 0.18, 1], [-0.42, -0.5, 0.18, 1], [0, -1, 1, 0.18]],
  '9': [[0, 1, 1, 0.18], [0.42, 0.5, 0.18, 1], [-0.42, 0.5, 0.18, 1], [0, 0, 1, 0.18], [0.42, -0.5, 0.18, 1], [0, -1, 1, 0.18]],
};

function buildFence(mb, length, rng) {
  pm(mb, PROP_MAT.wood, [0.36, 0.27, 0.18]);
  const posts = Math.max(2, Math.round(length / 2.2));
  for (let i = 0; i <= posts; i++) {
    const x = (i / posts - 0.5) * length;
    mb.push(); mb.translate(x, 0.62, 0); mb.box(0.12, 1.24, 0.12); mb.pop();
  }
  for (const y of [0.45, 0.95]) {
    mb.push(); mb.translate(0, y, 0); mb.box(length, 0.10, 0.06); mb.pop();
  }
}

function buildMailbox(mb) {
  pm(mb, PROP_MAT.wood, [0.30, 0.22, 0.15]);
  mb.push(); mb.translate(0, 0.55, 0); mb.box(0.09, 1.1, 0.09); mb.pop();
  pm(mb, PROP_MAT.steel, [0.35, 0.36, 0.40]);
  mb.push(); mb.translate(0, 1.20, 0); mb.chamferBox(0.24, 0.24, 0.42, 0.10); mb.pop();
}

function buildBin(mb, color) {
  mb.mat(color || [0.16, 0.30, 0.16], 0.85, 0, 0, FLAG_DEFAULT);
  mb.push(); mb.translate(0, 0.55, 0); mb.cylinder(0.32, 0.28, 1.1, 10); mb.pop();
  mb.mat([0.10, 0.10, 0.11], 0.8, 0, 0, FLAG_DEFAULT);
  mb.push(); mb.translate(0, 1.14, 0); mb.cylinder(0.34, 0.34, 0.08, 10); mb.pop();
}

function buildCone(mb) {
  mb.mat([0.85, 0.32, 0.05], 0.75, 0, 0, FLAG_DEFAULT);
  mb.push(); mb.translate(0, 0.02, 0); mb.box(0.42, 0.04, 0.42); mb.pop();
  mb.push(); mb.translate(0, 0.36, 0); mb.cylinder(0.04, 0.17, 0.68, 10); mb.pop();
  mb.mat([0.88, 0.88, 0.86], 0.7, 0, 0, FLAG_DEFAULT);
  mb.push(); mb.translate(0, 0.42, 0); mb.cylinder(0.105, 0.125, 0.12, 10, false, false); mb.pop();
}

// --- traffic car ------------------------------------------------------------

// A compact road car for traffic and parked cars. Same lofted approach as the
// race car but much cheaper, and the paint is per-vertex so one mesh can be
// re-tinted per instance through the paint uniform.
const CIVIC_STATIONS = [
  [2.10, 0.30, 0.28, 0.52],
  [2.02, 0.56, 0.22, 0.60],
  [1.86, 0.72, 0.18, 0.68],
  [1.55, 0.82, 0.16, 0.76],
  [1.10, 0.86, 0.16, 0.82],
  [0.55, 0.88, 0.17, 0.85],
  [0.00, 0.88, 0.17, 0.86],
  [-0.60, 0.88, 0.17, 0.86],
  [-1.15, 0.86, 0.18, 0.85],
  [-1.60, 0.82, 0.20, 0.82],
  [-1.92, 0.72, 0.24, 0.76],
  [-2.08, 0.54, 0.32, 0.66],
  [-2.15, 0.32, 0.40, 0.56],
];

const CIVIC_CABIN = [
  [0.95, 0.74, 0.86, 0.84],
  [0.72, 0.74, 1.02, 0.84],
  [0.40, 0.73, 1.20, 0.85],
  [0.00, 0.72, 1.30, 0.86],
  [-0.50, 0.71, 1.32, 0.86],
  [-0.95, 0.69, 1.26, 0.85],
  [-1.30, 0.65, 1.08, 0.84],
  [-1.55, 0.58, 0.90, 0.83],
];

function buildCivilianCar(mb, glassMB, rng) {
  const wheelR = 0.32;
  // Body.
  const rings = [];
  const rows = 26;
  for (let i = 0; i < rows; i++) {
    const t = i / (rows - 1);
    const z = lerp(CIVIC_STATIONS[0][0], CIVIC_STATIONS[CIVIC_STATIONS.length - 1][0], t);
    let a = 0;
    while (a < CIVIC_STATIONS.length - 2 && CIVIC_STATIONS[a + 1][0] > z) a++;
    const s0 = CIVIC_STATIONS[a], s1 = CIVIC_STATIONS[a + 1];
    const k = clamp((s0[0] - z) / (s0[0] - s1[0] || 1), 0, 1);
    const ks = k * k * (3 - 2 * k);
    const w = lerp(s0[1], s1[1], ks);
    const fy = lerp(s0[2], s1[2], ks);
    const dy = lerp(s0[3], s1[3], ks);
    // Wheel arch lift.
    let lift = 0;
    for (const c of [1.30, -1.30]) {
      const tt = clamp(1 - Math.abs(z - c) / 0.62, 0, 1);
      lift = Math.max(lift, Math.sin(tt * Math.PI * 0.5) * 0.46);
    }
    const pts = [], kinds = [];
    const N = 11;
    for (let kk = 0; kk < N; kk++) {
      const x = Math.cos((kk / (N - 1)) * Math.PI) * w;
      const tt = Math.abs(x) / w;
      pts.push([x, dy + 0.02 * (1 - tt * tt) - 0.07 * Math.pow(tt, 6), z]); kinds.push(0);
    }
    for (let kk = 1; kk <= 2; kk++) {
      pts.push([-w, lerp(dy - 0.07, fy + lift, kk / 3), z]); kinds.push(1);
    }
    for (let kk = 0; kk < N; kk++) {
      const x = -Math.cos((kk / (N - 1)) * Math.PI) * w;
      const tt = Math.abs(x) / w;
      const top = dy + 0.02 * (1 - tt * tt) - 0.07 * Math.pow(tt, 6);
      const bottom = fy + lift * smoothstep(0.52, 0.96, tt) + 0.05 * Math.pow(tt, 6);
      // Never let the underside climb above the deck - that inverts the
      // section and folds the lofted surface over itself.
      pts.push([x, Math.min(bottom, top - 0.02), z]); kinds.push(2);
    }
    for (let kk = 1; kk <= 2; kk++) {
      pts.push([w, lerp(fy + lift, dy - 0.07, kk / 3), z]); kinds.push(1);
    }
    rings.push(pts);
    if (i === 0) mb._civicKinds = kinds;
  }
  const kinds = mb._civicKinds;
  mb.loft(rings, true, true, true, (i, j) => {
    if (kinds[j] === 2) mb.mat([0.07, 0.07, 0.08], 0.8, 0.0, 0, FLAG_DEFAULT);
    else mb.mat([0.55, 0.55, 0.58], 0.32, 0.25, 0, FLAG_PAINT);
  });

  // Cabin: solid pillars with tinted glass panels, same trick as the race car.
  const cabinRows = 20;
  const cabinRings = [];
  for (let i = 0; i < cabinRows; i++) {
    const t = i / (cabinRows - 1);
    const z = lerp(CIVIC_CABIN[0][0], CIVIC_CABIN[CIVIC_CABIN.length - 1][0], t);
    let a = 0;
    while (a < CIVIC_CABIN.length - 2 && CIVIC_CABIN[a + 1][0] > z) a++;
    const s0 = CIVIC_CABIN[a], s1 = CIVIC_CABIN[a + 1];
    const k = clamp((s0[0] - z) / (s0[0] - s1[0] || 1), 0, 1);
    const ks = k * k * (3 - 2 * k);
    const w = lerp(s0[1], s1[1], ks), roofY = lerp(s0[2], s1[2], ks), waistY = lerp(s0[3], s1[3], ks);
    const arc = [];
    const M = 15;
    for (let kk = 0; kk < M; kk++) {
      const u = kk / (M - 1);
      const th = u * Math.PI;
      const n = 3.2;
      const x = Math.sign(Math.cos(th)) * Math.pow(Math.abs(Math.cos(th)), 2 / n) * w;
      const y = waistY + Math.pow(Math.abs(Math.sin(th)), 2 / n) * (roofY - waistY);
      arc.push([x, y, z]);
    }
    cabinRings.push(arc);
  }
  const M = 15;
  const isGlass = (z, u) => {
    if (u < 0.05 || u > 0.95) return false;
    if (z > 0.78) return false;
    if (z > 0.30) return u > 0.15 && u < 0.85;      // windscreen
    if (z > 0.18) return false;                      // header
    if (z > -1.02) {
      if (z < -0.42 && z > -0.54) return false;      // B pillar
      return (u > 0.06 && u < 0.22) || (u > 0.78 && u < 0.94);
    }
    if (z > -1.14) return false;
    if (z > -1.48) return u > 0.24 && u < 0.76;      // rear screen
    return false;
  };
  for (let i = 0; i < cabinRows - 1; i++) {
    for (let j = 0; j < M - 1; j++) {
      const zMid = (cabinRings[i][j][2] + cabinRings[i + 1][j][2]) * 0.5;
      const uMid = (j + 0.5) / (M - 1);
      const glass = isGlass(zMid, uMid);
      const target = glass ? glassMB : mb;
      if (glass) target.mat([0.04, 0.05, 0.06], 0.06, 0, 0, FLAG_GLASS);
      else target.mat([0.55, 0.55, 0.58], 0.32, 0.25, 0, FLAG_PAINT);
      const nAt = (ii, jj) => {
        const iP = Math.max(0, ii - 1), iN = Math.min(cabinRows - 1, ii + 1);
        const jP = Math.max(0, jj - 1), jN = Math.min(M - 1, jj + 1);
        const du = v3.sub([0, 0, 0], cabinRings[ii][jN], cabinRings[ii][jP]);
        const dv = v3.sub([0, 0, 0], cabinRings[iN][jj], cabinRings[iP][jj]);
        const nn = v3.cross([0, 0, 0], dv, du);
        return v3.len(nn) < 1e-9 ? [0, 1, 0] : v3.norm(nn, nn);
      };
      const emit = (ii, jj) => {
        const n = nAt(ii, jj);
        const p = cabinRings[ii][jj];
        const ins = glass ? -0.012 : 0;
        return target.vertex([p[0] + n[0] * ins, p[1] + n[1] * ins, p[2] + n[2] * ins], n);
      };
      const a = emit(i, j), b = emit(i + 1, j), c = emit(i + 1, j + 1), d = emit(i, j + 1);
      target.quadIdx(a, b, c, d);
    }
  }

  // Bumpers, lights, mirrors, plates.
  mb.mat([0.10, 0.10, 0.11], 0.7, 0, 0, FLAG_DEFAULT);
  mb.push(); mb.translate(0, 0.34, 2.06); mb.chamferBox(1.66, 0.34, 0.20, 0.08); mb.pop();
  mb.push(); mb.translate(0, 0.36, -2.10); mb.chamferBox(1.62, 0.36, 0.20, 0.08); mb.pop();
  mb.mat([0.88, 0.90, 0.96], 0.08, 0.0, 0.0, FLAG_GLASS);
  for (const s of [-1, 1]) {
    mb.push(); mb.translate(s * 0.58, 0.63, 2.04); mb.rotateY(s * 0.2); mb.chamferBox(0.42, 0.18, 0.14, 0.05); mb.pop();
  }
  mb.mat([0.58, 0.04, 0.04], 0.15, 0, 0.30, FLAG_UNLIT);
  for (const s of [-1, 1]) {
    mb.push(); mb.translate(s * 0.62, 0.70, -2.12); mb.rotateY(s * -0.12); mb.chamferBox(0.34, 0.24, 0.12, 0.05); mb.pop();
  }
  mb.mat([0.88, 0.88, 0.84], 0.5, 0, 0, FLAG_DEFAULT);
  mb.push(); mb.translate(0, 0.40, 2.14); mb.box(0.52, 0.12, 0.03); mb.pop();
  mb.push(); mb.translate(0, 0.42, -2.19); mb.box(0.52, 0.12, 0.03); mb.pop();
  mb.mat([0.14, 0.14, 0.15], 0.5, 0.2, 0, FLAG_DEFAULT);
  for (const s of [-1, 1]) {
    mb.push(); mb.translate(s * 0.94, 0.96, 0.62); mb.rotateY(s * 0.2); mb.chamferBox(0.16, 0.09, 0.22, 0.04); mb.pop();
  }
  // Exhaust.
  mb.mat([0.4, 0.4, 0.42], 0.3, 0.8, 0, FLAG_DEFAULT);
  mb.push(); mb.translate(-0.55, 0.28, -2.16); mb.rotateX(Math.PI / 2); mb.cylinder(0.045, 0.045, 0.12, 8); mb.pop();
}

function buildSimpleWheel(mb, radius, width) {
  const hw = width / 2;
  mb.mat([0.05, 0.05, 0.055], 0.9, 0, 0, FLAG_DEFAULT);
  mb.push(); mb.rotateZ(Math.PI / 2); mb.cylinder(radius, radius, width, 18, false, false); mb.pop();
  for (const s of [-1, 1]) {
    mb.push(); mb.translate(s * hw, 0, 0); mb.rotateZ(Math.PI / 2); mb.cylinder(radius, radius * 0.97, 0.02, 18, s > 0, s < 0); mb.pop();
  }
  mb.mat([0.58, 0.59, 0.62], 0.28, 0.9, 0, FLAG_DEFAULT);
  for (const s of [-1, 1]) {
    mb.push(); mb.translate(s * hw * 0.92, 0, 0); mb.rotateZ(Math.PI / 2); mb.cylinder(radius * 0.62, radius * 0.62, 0.05, 16); mb.pop();
  }
  mb.mat([0.12, 0.12, 0.13], 0.5, 0.4, 0, FLAG_DEFAULT);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU;
    mb.push();
    mb.rotateX(a);
    mb.translate(hw * 0.96, radius * 0.34, 0);
    mb.box(0.03, radius * 0.44, 0.07);
    mb.pop();
  }
}

// A state line sign: the big green board on gantry legs that tells you which
// state you have just driven into. The name itself is drawn on the HUD and the
// map rather than in geometry - a legible word in triangles costs more than the
// rest of the sign put together - so the board carries the state's own colour
// and a route shield, which is what you actually read at speed.
function buildStateSign(mb, tint) {
  pm(mb, PROP_MAT.steelDark, [0.34, 0.35, 0.37]);
  for (const side of [-1, 1]) {
    mb.push(); mb.translate(side * 1.9, 1.7, 0); mb.cylinder(0.075, 0.09, 3.4, 8); mb.pop();
  }
  // Board.
  mb.mat([0.06, 0.30, 0.16], 0.62, 0.04, 0, FLAG_DEFAULT);
  mb.push(); mb.translate(0, 3.9, 0); mb.box(4.6, 2.0, 0.10); mb.pop();
  // White border, inset slightly so it reads as a frame rather than a slab.
  pm(mb, PROP_MAT.white);
  for (const [dy, h] of [[0.88, 0.09], [-0.88, 0.09]]) {
    mb.push(); mb.translate(0, 3.9 + dy, 0.055); mb.box(4.3, h, 0.02); mb.pop();
  }
  for (const dx of [-2.06, 2.06]) {
    mb.push(); mb.translate(dx, 3.9, 0.055); mb.box(0.09, 1.85, 0.02); mb.pop();
  }
  // A panel in the state's own colour, so the ground you are about to drive on
  // and the sign announcing it agree.
  mb.mat([clamp(tint[0] * 0.62, 0, 1), clamp(tint[1] * 0.62, 0, 1),
    clamp(tint[2] * 0.62, 0, 1)], 0.7, 0.02, 0, FLAG_DEFAULT);
  mb.push(); mb.translate(0, 3.9, 0.07); mb.box(1.5, 1.1, 0.02); mb.pop();
}
