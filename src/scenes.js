// ---------------------------------------------------------------------------
// scenes.js - the two places the game happens.
//
// buildCircuit()  : a 1.9 km road course with pits, grandstands and barriers.
// buildHomeRoute(): the drive home - circuit gate, country road, village with
//                   traffic lights, suburb, and your own driveway.
// ---------------------------------------------------------------------------

// --- shared helpers ---------------------------------------------------------

function xz(list) { return list.map(([x, z]) => [x, 0, z]); }

// Sample points offset from a path, used for barriers, fences and prop lines.
function offsetSamples(path, side, distance, step = 4, from = 0, to = null) {
  const sp = path.spline;
  const count = sp.count;
  const end = to === null ? (path.closed ? count : count - 1) : to;
  const out = [];
  for (let k = from; k <= end; k += step) {
    const i = ((k % count) + count) % count;
    const p = sp.points[i], n = sp.normals[i];
    const d = typeof distance === 'function' ? distance(i, k) : distance;
    out.push([p[0] + n[0] * d * side, p[1], p[2] + n[2] * d * side]);
  }
  if (path.closed && out.length) out.push(out[0]);
  return out;
}

// Never leave a collider on a surface someone is meant to drive on. Scenery is
// laid out relative to one road at a time, so a fence beside the main route or
// a wall behind a house happily crosses a side street - and a wall across a
// side street is a wall across a road.
function addSolidClearOfRoads(world, x, z, r, hard, margin = 0.5) {
  const hit = world.query(x, z);
  if (hit && Math.abs(hit.lateral) < hit.path.halfWidth + r + margin) return false;
  world.addSolid(x, z, r, hard);
  return true;
}

// `solid`, when given, is the radius of the collider left behind at this spot -
// a tree trunk, a pole, a wall - so the world has something to hit.
function placeProp(target, world, builder, x, z, yaw = 0, yOffset = 0, scale = 1, solid = 0, hard = 1) {
  const y = world.groundHeight(x, z) + yOffset;
  const m = m4.compose(m4.create(), [x, y, z], yaw, 0, 0, scale, scale, scale);
  target.append(builder, m);
  // Street furniture is deliberately placed close to the kerb, so it gets a
  // much tighter margin - hitting a lamp post is the point. The check still
  // catches the handful that would otherwise stand in a side street.
  if (solid > 0) addSolidClearOfRoads(world, x, z, solid * scale, hard, 0.15);
}

// A line of colliders, for things that are long rather than round: hedges,
// fences, a garden wall.
function placeSolidRun(world, x, z, yaw, length, r, hard = 1) {
  const steps = Math.max(1, Math.round(length / (r * 1.4)));
  const dx = Math.sin(yaw), dz = Math.cos(yaw);
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps - 0.5) * length;
    addSolidClearOfRoads(world, x + dx * t, z + dz * t, r, hard);
  }
}

// Would this building stand on a road? Testing the centre point is not enough
// and never was: `world.query` returns the nearest road only, so a building set
// back properly from its own street happily reports "clear" while a cross
// street runs through its far end. Junctions are where that happens, and a
// building in a junction is a building you cannot drive past.
//
// So the whole rectangle is sampled - corners, edges and a coarse interior -
// against every road near each sample. Roads are at least seven metres wide, so
// a 1.5 m lattice cannot miss one.
function footprintClearOfRoads(world, x, z, yaw, halfW, halfD, margin = 1.2) {
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  const nw = Math.max(2, Math.ceil((halfW * 2) / 1.5));
  const nd = Math.max(2, Math.ceil((halfD * 2) / 1.5));
  for (let i = 0; i <= nw; i++) {
    const lx = -halfW + (i / nw) * halfW * 2;
    for (let j = 0; j <= nd; j++) {
      const lz = -halfD + (j / nd) * halfD * 2;
      const wx = x + lx * cs + lz * sn, wz = z - lx * sn + lz * cs;
      const hit = world.query(wx, wz);
      if (hit && Math.abs(hit.lateral) < hit.path.halfWidth + margin) return false;
    }
  }
  return true;
}

// Place a building only if it clears every road, mesh and colliders together.
// Returns whether it went down, so callers can try somewhere else.
function tryPlaceBuilding(target, world, builder, x, z, yaw, r = 1.6, margin = 1.2) {
  const { min, max } = builder.bounds();
  const halfW = Math.max(1, (max[0] - min[0]) / 2);
  const halfD = Math.max(1, (max[2] - min[2]) / 2);
  if (!footprintClearOfRoads(world, x, z, yaw, halfW, halfD, margin)) return false;
  placeProp(target, world, builder, x, z, yaw);
  placeBuildingSolids(world, builder, x, z, yaw, r);
  return true;
}

// A building is a box, not a wall. Ringing only the frontage leaves the sides
// and the back open, so you can drive round and straight in through the
// kitchen - which is exactly what happened. The footprint is measured from the
// mesh rather than passed in, so it is right for every building whatever built
// it and whatever size it came out.
function placeBuildingSolids(world, builder, x, z, yaw, r = 1.5) {
  const { min, max } = builder.bounds();
  const halfW = Math.max(1, (max[0] - min[0]) / 2);
  const halfD = Math.max(1, (max[2] - min[2]) / 2);
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  // Recorded so the collider audit can walk the perimeter of every building
  // and prove there is no gap in it wide enough to drive through.
  world.footprints.push({ x, z, yaw, halfW, halfD });
  // Local (lx, lz) -> world, matching m4.compose's yaw.
  //
  // Unconditional, unlike street furniture: a wall is where the wall is. The
  // road-clearance check used to apply here too, which meant any building
  // whose frontage came close to a kerb quietly lost the colliders down that
  // side and could be driven into from the street. If a wall really does
  // stand on a road, that is a placement bug for the audit to catch, not
  // something to fix by deleting the wall.
  const put = (lx, lz) => world.addSolid(
    x + lx * cs + lz * sn, z - lx * sn + lz * cs, r, 1);
  const along = (half) => Math.max(1, Math.round((half * 2) / (r * 1.5)));
  const nw = along(halfW), nd = along(halfD);
  for (let i = 0; i <= nw; i++) {
    const lx = -halfW + (i / nw) * halfW * 2;
    put(lx, -halfD);
    put(lx, halfD);
  }
  for (let i = 1; i < nd; i++) {
    const lz = -halfD + (i / nd) * halfD * 2;
    put(-halfW, lz);
    put(halfW, lz);
  }
}

// Build a small library of prop meshes once, then stamp them around the world.
// The circuit gate. It stands at the end of the paddock exit road and again at
// the start of the road home, because those are the same gate: the two halves
// of the journey are separate worlds, and the handover happens as you pass
// under it. Matching geometry either side, plus the trees the callers plant
// alongside, means there is nothing to see at the join.
function buildCircuitGate(mb) {
  const pierH = 4.2, pierW = 1.15, span = 11.0;
  for (const side of [-1, 1]) {
    mb.mat([0.40, 0.38, 0.35], 0.90, 0.0, 0, FLAG_DEFAULT);
    mb.push(); mb.translate(side * span / 2, pierH / 2, 0);
    mb.box(pierW, pierH, pierW); mb.pop();
    mb.mat([0.30, 0.29, 0.27], 0.85, 0.0, 0, FLAG_DEFAULT);
    mb.push(); mb.translate(side * span / 2, pierH + 0.10, 0);
    mb.box(pierW + 0.30, 0.22, pierW + 0.30); mb.pop();
  }
  // Beam across the top, with a board hung under it.
  mb.mat([0.16, 0.17, 0.19], 0.55, 0.35, 0, FLAG_DEFAULT);
  mb.push(); mb.translate(0, pierH + 0.42, 0); mb.box(span + 0.9, 0.42, 0.34); mb.pop();
  mb.mat([0.06, 0.07, 0.09], 0.70, 0.05, 0, FLAG_DEFAULT);
  mb.push(); mb.translate(0, pierH - 0.05, 0.02); mb.box(4.6, 0.80, 0.10); mb.pop();
  mb.mat([0.85, 0.86, 0.88], 0.6, 0.0, 0.12, FLAG_UNLIT);
  mb.push(); mb.translate(0, pierH - 0.05, -0.05); mb.box(3.9, 0.16, 0.03); mb.pop();
  // A lamp on each pier, so the gate reads at dusk from either side.
  mb.mat([1.0, 0.88, 0.62], 0.3, 0.0, 0.9, FLAG_UNLIT);
  for (const side of [-1, 1]) {
    mb.push(); mb.translate(side * span / 2, pierH + 0.42, 0);
    mb.box(0.26, 0.26, 0.26); mb.pop();
  }
}

function makePropLibrary(rng) {
  const lib = {};
  const make = (fn) => { const mb = new MeshBuilder(); fn(mb); return mb; };
  lib.trees = [];
  for (let i = 0; i < 8; i++) {
    const style = i < 4 ? 0 : (i < 6 ? 1 : 2);
    lib.trees.push(make((mb) => buildTree(mb, rng, style)));
  }
  lib.streetLightL = make((mb) => buildStreetLight(mb, -1));
  lib.streetLightR = make((mb) => buildStreetLight(mb, 1));
  lib.trafficLight = make((mb) => buildTrafficLightPole(mb));
  lib.signs = {
    s30: make((mb) => buildRoadSign(mb, 'speed', '30')),
    s50: make((mb) => buildRoadSign(mb, 'speed', '50')),
    s80: make((mb) => buildRoadSign(mb, 'speed', '80')),
  };
  lib.mailbox = make((mb) => buildMailbox(mb));
  lib.bin = make((mb) => buildBin(mb));
  lib.cone = make((mb) => buildCone(mb));
  lib.marshal = make((mb) => buildMarshalPost(mb, rng));
  lib.houses = [];
  for (let i = 0; i < 7; i++) lib.houses.push(make((mb) => buildHouse(mb, rng)));
  lib.garages = [];
  for (let i = 0; i < 3; i++) lib.garages.push(make((mb) => buildGarage(mb, rng)));
  lib.shops = [];
  for (let i = 0; i < 7; i++) lib.shops.push(make((mb) => buildTownBuilding(mb, rng)));
  lib.hedge = make((mb) => buildHedge(mb, 8, 1.2, 0.8, rng));
  lib.fence = make((mb) => buildFence(mb, 8, rng));
  return lib;
}

// ---------------------------------------------------------------------------
// The circuit
// ---------------------------------------------------------------------------

// The circuit is generated rather than hand-plotted: a radius function made of
// a few harmonics plus two localised "dents" that pull the road inward into
// slow corners. Because the shape is continuous and closes on itself there is
// no kink where the lap joins up, and the corner radii are known to be sane
// (51 m at the hairpin up to 220 m through the sweepers).
const CIRCUIT_SHAPE = {
  radius: 355,
  scaleX: 1.18,
  scaleZ: 0.97,
  harmonics: [[1, 0.09, 0.2], [2, 0.15, 1.0], [3, 0.10, -1.3], [4, 0.05, 0.6]],
  dents: [[3.55, 0.22, -0.34], [0.75, 0.30, -0.20]],
  samples: 112,
};

function circuitControlPoints(shape = CIRCUIT_SHAPE) {
  const pts = [];
  for (let i = 0; i < shape.samples; i++) {
    const th = (i / shape.samples) * TAU;
    let r = 1;
    for (const [k, amp, phase] of shape.harmonics) r += amp * Math.sin(k * th + phase);
    for (const [center, width, amp] of shape.dents) {
      r += amp * Math.exp(-Math.pow(wrapAngle(th - center), 2) / (2 * width * width));
    }
    pts.push([
      shape.radius * r * Math.cos(th) * shape.scaleX,
      shape.radius * r * Math.sin(th) * shape.scaleZ,
    ]);
  }
  return pts;
}

// Put the start line in the middle of the longest straight.
function findStartIndex(spline) {
  const n = spline.count;
  const straight = new Array(n);
  for (let i = 0; i < n; i++) straight[i] = Math.abs(splineCurvature(spline, i)) < 1 / 260;
  let bestStart = 0, bestLen = 0, runStart = -1, runLen = 0;
  for (let k = 0; k < n * 2; k++) {
    const i = k % n;
    if (straight[i]) {
      if (runStart < 0) runStart = i;
      runLen++;
      if (runLen > bestLen) { bestLen = runLen; bestStart = runStart; }
    } else { runStart = -1; runLen = 0; }
  }
  if (bestLen === 0) return 0;
  // Two thirds along, so there is room for the grid behind the line.
  return (bestStart + Math.floor(bestLen * 0.66)) % n;
}

function buildCircuit(gl) {
  const rng = makeRng(20260808);
  const world = new World({ seed: 7717, terrainScale: 0.70 });

  const track = world.addPath(new Path(xz(circuitControlPoints()), {
    closed: true, halfWidth: 6.4, surface: SURFACES.asphalt, kerbs: true,
    kerbWidth: 1.15, type: 'track', markings: true, spacing: 5.0, name: 'Circuit',
  }));

  const startIndex = findStartIndex(track.spline);

  // Pit lane running alongside the main straight, outside the track.
  const pitControl = [];
  for (let k = startIndex - 34; k <= startIndex + 26; k++) {
    const i = ((k % track.spline.count) + track.spline.count) % track.spline.count;
    const p = track.spline.points[i], n = track.spline.normals[i];
    const taper = clamp(Math.min(k - (startIndex - 34), (startIndex + 26) - k) / 6, 0, 1);
    const off = -(12 + 6 * taper);
    pitControl.push([p[0] + n[0] * off, 0, p[2] + n[2] * off]);
  }
  const pitLane = world.addPath(new Path(pitControl, {
    closed: false, halfWidth: 5.0, surface: SURFACES.asphalt, kerbs: false,
    type: 'road', markings: false, spacing: 5.0, name: 'Pit lane',
  }));

  // The way out. Rather than rejoining the track, the pit exit carries straight
  // on, swings away from the circuit and runs out to the gate on the public
  // road - so the drive home starts by actually driving off the racetrack.
  // Plotted from the pit lane rather than hard coded, so it still lines up if
  // the circuit shape is regenerated.
  const exitRoute = (() => {
    const psp = pitLane.spline;
    const last = psp.count - 1;
    const p0 = psp.points[last], t0 = psp.tangents[last], n0 = psp.normals[last];
    // The pit lane sits at -12 along the track normal, so the circuit is in the
    // +normal direction and away from it is -normal.
    const fwd = [t0[0], 0, t0[2]], out = [-n0[0], 0, -n0[2]];
    const ctl = [];
    for (const [f, a] of [[-14, 0], [10, 1], [34, 6], [56, 18], [70, 38],
      [80, 66], [86, 102], [90, 150], [93, 205], [95, 262], [96, 318]]) {
      ctl.push([p0[0] + fwd[0] * f + out[0] * a, p0[2] + fwd[2] * f + out[2] * a]);
    }
    return world.addPath(new Path(xz(ctl), {
      closed: false, halfWidth: 4.4, surface: SURFACES.asphalt, kerbs: false,
      type: 'road', markings: true, spacing: 5.0, name: 'Paddock exit',
    }));
  })();

  world.index();
  world.conformPathsToTerrain(60);

  // Racing line and per-corner target speeds for the AI.
  const racingLine = computeRacingLine(track, track.halfWidth - 2.1);

  // --- geometry -------------------------------------------------------------
  const terrainMB = buildTerrainMesh(world, {
    minX: -640, maxX: 1000, minZ: -720, maxZ: 760, cell: 12.8,
  });
  const roadMB = new MeshBuilder();
  buildPathMesh(world, track, roadMB);
  buildPathMesh(world, pitLane, roadMB);
  buildPathMesh(world, exitRoute, roadMB);

  // Start / finish line and the painted grid boxes.
  {
    const sp = track.spline;
    const i = startIndex;
    const p = sp.points[i], n = sp.normals[i], t = sp.tangents[i];
    roadMB.mat([0.88, 0.88, 0.86], 0.5, 0, 0, FLAG_DEFAULT);
    for (let c = 0; c < 16; c++) {
      for (let r = 0; r < 2; r++) {
        if ((c + r) % 2) continue;
        const lat = -track.halfWidth + (c + 0.5) * (track.halfWidth * 2 / 16);
        const lon = (r - 0.5) * 0.42;
        const cx = p[0] + n[0] * lat + t[0] * lon;
        const cz = p[2] + n[2] * lat + t[2] * lon;
        roadMB.push();
        roadMB.translate(cx, p[1] + 0.032, cz);
        roadMB.rotateY(Math.atan2(t[0], t[2]));
        roadMB.box(track.halfWidth * 2 / 16, 0.01, 0.42);
        roadMB.pop();
      }
    }
    // Grid boxes.
    for (let g = 0; g < 12; g++) {
      const side = g % 2 === 0 ? -1 : 1;
      const back = 9 + Math.floor(g / 2) * 8.6;
      const idx = ((startIndex - Math.round(back / 5)) % sp.count + sp.count) % sp.count;
      const gp = sp.points[idx], gn = sp.normals[idx], gt = sp.tangents[idx];
      const lat = side * 2.6;
      roadMB.mat([0.80, 0.80, 0.78], 0.55, 0, 0, FLAG_DEFAULT);
      for (const [ox, oz, sx, sz] of [[0, 2.4, 2.6, 0.14], [-1.3, 0, 0.14, 4.8], [1.3, 0, 0.14, 4.8]]) {
        const cx = gp[0] + gn[0] * (lat + ox) + gt[0] * oz;
        const cz = gp[2] + gn[2] * (lat + ox) + gt[2] * oz;
        roadMB.push();
        roadMB.translate(cx, gp[1] + 0.031, cz);
        roadMB.rotateY(Math.atan2(gt[0], gt[2]));
        roadMB.box(sx, 0.01, sz);
        roadMB.pop();
      }
    }
  }

  // --- barriers -------------------------------------------------------------
  const propMB = new MeshBuilder();
  const barrierOffset = (i) => {
    const curv = Math.abs(splineCurvature(track.spline, i));
    return track.halfWidth + 8.5 + clamp(curv * 900, 0, 7);
  };
  for (const side of [-1, 1]) {
    const samples = offsetSamples(track, side, barrierOffset, 3);
    for (const s of samples) s[1] = world.groundHeight(s[0], s[2]);
    buildArmco(propMB, world, samples);
    buildCatchFence(propMB, samples, 3.4);
    buildHoardings(propMB, samples, rng);
  }

  // Tyre stacks on the outside of the three tightest corners.
  {
    const sp = track.spline;
    const worst = [];
    for (let i = 0; i < sp.count; i++) worst.push([Math.abs(splineCurvature(sp, i)), i]);
    worst.sort((a, b) => b[0] - a[0]);
    const used = [];
    for (const [, i] of worst) {
      if (used.some((u) => Math.abs(u - i) < 30)) continue;
      used.push(i);
      if (used.length >= 4) break;
    }
    for (const i of used) {
      const curv = splineCurvature(sp, i);
      const side = curv > 0 ? 1 : -1;
      const pts = [];
      for (let k = -6; k <= 6; k++) {
        const idx = ((i + k) % sp.count + sp.count) % sp.count;
        const p = sp.points[idx], n = sp.normals[idx];
        const d = barrierOffset(idx) - 0.9;
        const x = p[0] + n[0] * d * side, z = p[2] + n[2] * d * side;
        pts.push([x, world.groundHeight(x, z), z]);
      }
      buildTyreWall(propMB, pts, 2);
    }
  }

  // --- pits, grandstands, gantry -------------------------------------------
  {
    const sp = track.spline;
    const i = startIndex;
    const p = sp.points[i], n = sp.normals[i], t = sp.tangents[i];
    const yaw = Math.atan2(t[0], t[2]);

    // Gantry across the start line.
    const gMB = new MeshBuilder();
    buildGantry(gMB, track.halfWidth * 2 + 6, 7.4);
    placeProp(propMB, world, gMB, p[0], p[2], yaw);

    // Pit building behind the pit lane.
    const pitMB = new MeshBuilder();
    buildPitBuilding(pitMB, 6, rng);
    const pIdx = Math.floor(pitLane.spline.count / 2);
    const pp = pitLane.spline.points[pIdx], pn = pitLane.spline.normals[pIdx], pt = pitLane.spline.tangents[pIdx];
    // Garages face back across the pit lane toward the track.
    placeProp(propMB, world, pitMB, pp[0] - pn[0] * 12, pp[2] - pn[2] * 12, Math.atan2(pn[0], pn[2]));
    placeBuildingSolids(world, pitMB, pp[0] - pn[0] * 12, pp[2] - pn[2] * 12, Math.atan2(pn[0], pn[2]), 1.8);

    // Grandstands opposite the pits and at two corners.
    const standMB = new MeshBuilder();
    buildGrandstand(standMB, 46, 15, 12, rng);
    const stands = [
      [startIndex + 5, 1, 22],
      [startIndex + Math.round(sp.count * 0.22), 1, 26],
      [startIndex + Math.round(sp.count * 0.58), -1, 28],
    ];
    for (const [idx, side, dist] of stands) {
      const gi = ((idx % sp.count) + sp.count) % sp.count;
      const gp = sp.points[gi], gn = sp.normals[gi];
      const x = gp[0] + gn[0] * dist * side, z = gp[2] + gn[2] * dist * side;
      // The stand's local +Z is the direction the seats look, so aim it back
      // across the track rather than along it.
      placeProp(propMB, world, standMB, x, z, Math.atan2(-side * gn[0], -side * gn[2]));
    }
  }

  // --- scenery --------------------------------------------------------------
  const lib = makePropLibrary(rng);
  {
    // Marshal posts every so often.
    const sp = track.spline;
    for (let i = 20; i < sp.count; i += 42) {
      const p = sp.points[i], n = sp.normals[i], t = sp.tangents[i];
      const side = rng() < 0.5 ? -1 : 1;
      const d = barrierOffset(i) + 3.4;
      placeProp(propMB, world, lib.marshal, p[0] + n[0] * d * side, p[2] + n[2] * d * side,
        Math.atan2(t[0], t[2]) + (side > 0 ? Math.PI : 0));
    }
    // Trees outside the circuit, kept clear of the track corridor.
    for (let i = 0; i < 1500; i++) {
      const x = rnd2(rng, -600, 950);
      const z = rnd2(rng, -680, 720);
      const hit = world.query(x, z);
      const clear = !hit || Math.abs(hit.lateral) > barrierOffset(hit.index) + 8;
      if (!clear) continue;
      // Denser clumps away from the circuit.
      const distFactor = hit ? clamp((Math.abs(hit.lateral) - 20) / 120, 0, 1) : 1;
      if (rng() > 0.28 + distFactor * 0.55) continue;
      const tree = lib.trees[Math.floor(rng() * lib.trees.length)];
      placeProp(propMB, world, tree, x, z, rng() * TAU, 0, rnd2(rng, 0.8, 1.35), 0.34);
    }
  }

  // --- the gate out ---------------------------------------------------------
  {
    const esp = exitRoute.spline;
    const last = esp.count - 1;
    const gp = esp.points[last], gt = esp.tangents[last], gn = esp.normals[last];
    const gateYaw = Math.atan2(gt[0], gt[2]);
    const gateMB = new MeshBuilder();
    buildCircuitGate(gateMB);
    placeProp(propMB, world, gateMB, gp[0], gp[2], gateYaw);
    for (const side of [-1, 1]) {
      world.addSolid(gp[0] + gn[0] * 5.5 * side, gp[2] + gn[2] * 5.5 * side, 0.75);
    }

    // An avenue of trees for the last stretch up to the gate. This is what
    // closes the view in: you cannot see the landscape change if there is no
    // landscape in shot when it does.
    for (let k = 1; k <= 9; k++) {
      const i = clamp(last - k * 2, 0, last);
      const p = esp.points[i], n = esp.normals[i];
      for (const side of [-1, 1]) {
        const d = exitRoute.halfWidth + 3.2;
        placeProp(propMB, world, lib.trees[k % lib.trees.length],
          p[0] + n[0] * d * side, p[2] + n[2] * d * side, rng() * TAU, 0, 1.25, 0.34);
      }
    }
    // Fences running up to the piers so the gate reads as the boundary.
    for (const side of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const fx = gp[0] + gn[0] * (6.2 + k * 7.9) * side - gt[0] * 0.2;
        const fz = gp[2] + gn[2] * (6.2 + k * 7.9) * side - gt[2] * 0.2;
        placeProp(propMB, world, lib.fence, fx, fz, gateYaw + Math.PI / 2);
        // The fence has to be as solid as the piers, or the gate is just two
        // posts you steer around.
        placeSolidRun(world, fx, fz, gateYaw + Math.PI / 2, 8, 0.5, 1);
      }
    }
  }

  // --- start grid -----------------------------------------------------------
  const grid = [];
  {
    const sp = track.spline;
    for (let g = 0; g < 12; g++) {
      const side = g % 2 === 0 ? -1 : 1;
      const back = 9 + Math.floor(g / 2) * 8.6;
      const idxF = startIndex - back / 5;
      const idx = ((Math.round(idxF) % sp.count) + sp.count) % sp.count;
      const p = sp.points[idx], n = sp.normals[idx], t = sp.tangents[idx];
      const lat = side * 2.6;
      grid.push({
        x: p[0] + n[0] * lat,
        z: p[2] + n[2] * lat,
        yaw: Math.atan2(t[0], t[2]),
      });
    }
  }

  // Everything solid has been placed by now, so it can be bucketed for lookup.
  world.indexSolids();

  // Chunked so the renderer can cull: a whole world in three draw calls means
  // every building behind you is transformed before the depth test finds out.
  const meshes = {
    terrain: chunkedMesh(gl, terrainMB, 180),
    road: chunkedMesh(gl, roadMB, 180),
    props: chunkedMesh(gl, propMB, 110),
  };

  const startPoint = track.spline.points[startIndex];
  const startTangent = track.spline.tangents[startIndex];

  return {
    kind: 'circuit',
    world,
    track,
    pitLane,
    exitRoute,
    // Where the drive home begins: the pit lane entry, so you roll off the
    // circuit, down the pit lane and out through the gate.
    exitStart: (() => {
      const psp = pitLane.spline;
      const p = psp.points[2], t = psp.tangents[2];
      return { x: p[0], z: p[2], yaw: Math.atan2(t[0], t[2]) };
    })(),
    racingLine,
    grid,
    meshes,
    startIndex,
    lapLength: track.spline.length,
    barrierOffset,
    startLine: {
      x: startPoint[0], z: startPoint[2],
      dirX: startTangent[0], dirZ: startTangent[2],
    },
    lights: (() => {
      const sp = track.spline;
      const p = sp.points[startIndex], t = sp.tangents[startIndex];
      const yaw = Math.atan2(t[0], t[2]);
      const right = [Math.cos(yaw), 0, -Math.sin(yaw)];
      const out = [];
      for (let i = 0; i < 5; i++) {
        const off = (i - 2) * 1.5;
        out.push([
          p[0] + right[0] * off,
          world.groundHeight(p[0], p[2]) + 6.5,
          p[2] + right[2] * off,
        ]);
      }
      return out;
    })(),
    ambience: {
      sunAngle: 0.62, sunAzimuth: 2.1,
      sky: { zenith: [0.20, 0.36, 0.72], horizon: [0.62, 0.72, 0.86], cloud: 0.55 },
      fogDensity: 0.00085,
      night: 0,
    },
  };
}

// ---------------------------------------------------------------------------
// The drive home
// ---------------------------------------------------------------------------

const HOME_ROUTE = [
  [0, -60], [0, 30], [-8, 130], [-52, 224], [-70, 330], [-28, 420],
  [56, 476], [150, 496], [244, 486], [322, 452], [400, 432], [470, 424],
  [556, 418], [648, 424], [722, 452], [792, 512], [830, 592], [832, 680],
  [802, 762], [742, 822], [660, 852], [572, 862], [502, 858],
];

// Segments of the route tagged with a speed limit and a name for the HUD.
const HOME_ZONES = [
  { until: 0.10, limit: 40, label: 'Circuit access road' },
  { until: 0.42, limit: 80, label: 'Country road' },
  { until: 0.72, limit: 50, label: 'Ashcombe village' },
  { until: 1.01, limit: 30, label: 'Millbrook Rise' },
];

function buildHomeRoute(gl) {
  const rng = makeRng(4242);
  const world = new World({ seed: 3313, terrainScale: 0.7 });

  const route = world.addPath(new Path(xz(HOME_ROUTE), {
    closed: false, halfWidth: 4.4, surface: SURFACES.asphalt, kerbs: false,
    type: 'road', markings: true, spacing: 5.0, name: 'Route home',
  }));

  // A handful of side streets: they give the town depth and somewhere for the
  // traffic to come from.
  const sideStreets = [];
  const addSide = (pts, opts) => {
    const p = world.addPath(new Path(xz(pts), Object.assign({
      closed: false, halfWidth: 3.6, surface: SURFACES.asphalt, kerbs: false,
      type: 'street', markings: false, spacing: 5.0,
    }, opts)));
    sideStreets.push(p);
    return p;
  };
  addSide([[832, 640], [900, 636], [968, 640]]);
  addSide([[660, 852], [656, 920], [660, 980]]);

  // --- Ashcombe, the city ---------------------------------------------------
  //
  // A real street grid rather than a strip with a couple of stubs, so there is
  // somewhere to go that is not the way home. The route home runs through it
  // and every street connects, so you can leave the route anywhere, wander,
  // and rejoin wherever you like.
  //
  // The grid is deliberately not square: streets bow by a few metres and the
  // spacing varies block to block. A perfect lattice reads as a spreadsheet
  // from inside the car, and every junction looks like the last one.
  const CITY = {
    x0: 130, z0: 250,           // south-west corner
    cols: 8, rows: 7,
    colGap: 96, rowGap: 84,
  };
  const cityStreets = [];
  {
    const jitter = makeRng(60607);
    const colX = [], rowZ = [];
    for (let c = 0; c <= CITY.cols; c++) colX.push(CITY.x0 + c * CITY.colGap + rnd2(jitter, -9, 9));
    for (let r = 0; r <= CITY.rows; r++) rowZ.push(CITY.z0 + r * CITY.rowGap + rnd2(jitter, -8, 8));

    // Two of the streets each way are avenues: wider, marked, and the ones
    // traffic actually uses.
    const avenueCol = new Set([2, 5]);
    const avenueRow = new Set([1, 4]);

    for (let c = 0; c <= CITY.cols; c++) {
      const pts = rowZ.map((z, r) => [colX[c] + Math.sin(r * 0.9 + c) * 3.5, z]);
      const avenue = avenueCol.has(c);
      cityStreets.push(addSide(pts, {
        halfWidth: avenue ? 5.4 : 3.9, markings: avenue,
        name: avenue ? 'Avenue' : 'Street',
      }));
    }
    for (let r = 0; r <= CITY.rows; r++) {
      const pts = colX.map((x, c) => [x, rowZ[r] + Math.sin(c * 0.8 + r * 1.7) * 3.0]);
      const avenue = avenueRow.has(r);
      cityStreets.push(addSide(pts, {
        halfWidth: avenue ? 5.4 : 3.9, markings: avenue,
        name: avenue ? 'Avenue' : 'Street',
      }));
    }
    // Two connectors out to the route home, so the grid is not an island.
    addSide([[colX[2], rowZ[CITY.rows]], [colX[2] - 12, rowZ[CITY.rows] + 60], [244, 486]]);
    addSide([[colX[5], rowZ[CITY.rows]], [colX[5] + 18, rowZ[CITY.rows] + 55], [470, 424]]);
    addSide([[470, 424], [468, 330], [472, 250]]);
  }

  // The driveway at the end of the road.
  const driveway = world.addPath(new Path(xz([[502, 858], [500, 878], [499, 892]]), {
    closed: false, halfWidth: 2.6, surface: SURFACES.concrete, kerbs: false,
    type: 'drive', markings: false, spacing: 3.0, name: 'Home',
  }));

  world.index();
  world.conformPathsToTerrain(40);

  const terrainMB = buildTerrainMesh(world, {
    minX: -320, maxX: 1180, minZ: -220, maxZ: 1120, cell: 12.8,
  });
  const roadMB = new MeshBuilder();
  for (const p of world.paths) buildPathMesh(world, p, roadMB);

  const propMB = new MeshBuilder();
  const lib = makePropLibrary(rng);
  const sp = route.spline;
  const count = sp.count;
  const total = sp.length;

  const zoneAt = (frac) => {
    for (const z of HOME_ZONES) if (frac <= z.until) return z;
    return HOME_ZONES[HOME_ZONES.length - 1];
  };

  // --- pavements through the built-up sections ------------------------------
  {
    const kerbCol = [0.58, 0.58, 0.56];
    const pavement = [0.50, 0.49, 0.47];
    for (let i = 0; i < count - 1; i++) {
      const frac = sp.cumulative[i] / total;
      const zone = zoneAt(frac);
      if (zone.limit > 50) continue;
      const p0 = sp.points[i], p1 = sp.points[i + 1];
      const n0 = sp.normals[i], n1 = sp.normals[i + 1];
      for (const side of [-1, 1]) {
        const a0 = route.halfWidth * side, a1 = (route.halfWidth + 2.4) * side;
        const quad = (lat0, lat1, dy, col) => {
          roadMB.mat(col, 0.88, 0, 0, FLAG_DEFAULT);
          roadMB.quad(
            [p0[0] + n0[0] * lat0, p0[1] + dy, p0[2] + n0[2] * lat0],
            [p1[0] + n1[0] * lat0, p1[1] + dy, p1[2] + n1[2] * lat0],
            [p1[0] + n1[0] * lat1, p1[1] + dy, p1[2] + n1[2] * lat1],
            [p0[0] + n0[0] * lat1, p0[1] + dy, p0[2] + n0[2] * lat1],
            [0, 1, 0]);
        };
        quad(a0, a0 + 0.22 * side, 0.075, kerbCol);
        quad(a0 + 0.22 * side, a1, 0.13, pavement);
      }
    }
  }

  // --- buildings and street furniture --------------------------------------
  let lastBuildingS = -1e9;
  let lastLightS = -1e9;
  let lastTreeS = -1e9;
  const homeIndex = count - 1;

  for (let i = 2; i < count - 2; i++) {
    const s = sp.cumulative[i];
    const frac = s / total;
    const zone = zoneAt(frac);
    const p = sp.points[i], n = sp.normals[i], t = sp.tangents[i];
    const yaw = Math.atan2(t[0], t[2]);

    // Street lights.
    const lightGap = zone.limit <= 50 ? 34 : 0;
    if (lightGap && s - lastLightS > lightGap) {
      lastLightS = s;
      const side = Math.round(s / lightGap) % 2 === 0 ? -1 : 1;
      const d = route.halfWidth + 2.0;
      placeProp(propMB, world, side < 0 ? lib.streetLightR : lib.streetLightL,
        p[0] + n[0] * d * side, p[2] + n[2] * d * side, yaw, 0, 1, 0.20);
    }

    if (zone.label === 'Ashcombe village' && s - lastBuildingS > 17) {
      lastBuildingS = s;
      for (const side of [-1, 1]) {
        if (rng() < 0.12) continue;
        const d = route.halfWidth + 3.2 + rnd2(rng, 5.5, 7.5);
        const bx = p[0] + n[0] * d * side, bz = p[2] + n[2] * d * side;
        const shop = lib.shops[Math.floor(rng() * lib.shops.length)];
        const facing = Math.atan2(-side * n[0], -side * n[2]);
        tryPlaceBuilding(propMB, world, shop, bx, bz, facing);
      }
    } else if (zone.label === 'Millbrook Rise' && s - lastBuildingS > 23) {
      lastBuildingS = s;
      for (const side of [-1, 1]) {
        if (rng() < 0.18) continue;
        const near = i > homeIndex - 8 && side > 0;
        if (near) continue;                       // keep the home plot clear
        const d = route.halfWidth + 12 + rnd2(rng, 2, 5);
        const bx = p[0] + n[0] * d * side, bz = p[2] + n[2] * d * side;
        const facing = Math.atan2(-side * n[0], -side * n[2]);
        const house = lib.houses[Math.floor(rng() * lib.houses.length)];
        if (!tryPlaceBuilding(propMB, world, house, bx, bz, facing)) continue;
        // Driveway apron and a hedge along the boundary.
        const dx = p[0] + n[0] * (route.halfWidth + 3) * side;
        const dz = p[2] + n[2] * (route.halfWidth + 3) * side;
        roadMB.mat([0.34, 0.33, 0.32], 0.88, 0, 0, FLAG_DEFAULT);
        roadMB.push();
        roadMB.translate((dx + bx) / 2, world.groundHeight((dx + bx) / 2, (dz + bz) / 2) + 0.03, (dz + bz) / 2);
        roadMB.rotateY(facing);
        roadMB.box(3.0, 0.02, 12);
        roadMB.pop();
        placeProp(propMB, world, lib.hedge,
          p[0] + n[0] * (route.halfWidth + 4.2) * side + t[0] * 6,
          p[2] + n[2] * (route.halfWidth + 4.2) * side + t[2] * 6, yaw);
        placeSolidRun(world,
          p[0] + n[0] * (route.halfWidth + 4.2) * side + t[0] * 6,
          p[2] + n[2] * (route.halfWidth + 4.2) * side + t[2] * 6, yaw, 8, 0.55, 0.35);
        if (rng() < 0.5) {
          placeProp(propMB, world, lib.mailbox,
            p[0] + n[0] * (route.halfWidth + 1.6) * side,
            p[2] + n[2] * (route.halfWidth + 1.6) * side, facing);
        }
      }
    } else if (zone.limit > 50 && s - lastTreeS > 12) {
      lastTreeS = s;
      for (const side of [-1, 1]) {
        if (rng() < 0.45) continue;
        const d = route.halfWidth + rnd2(rng, 6, 16);
        placeProp(propMB, world, lib.trees[Math.floor(rng() * lib.trees.length)],
          p[0] + n[0] * d * side, p[2] + n[2] * d * side, rng() * TAU, 0, rnd2(rng, 0.85, 1.3));
      }
      if (rng() < 0.35) {
        const side = rng() < 0.5 ? -1 : 1;
        const d = route.halfWidth + 5.5;
        placeProp(propMB, world, lib.fence,
          p[0] + n[0] * d * side, p[2] + n[2] * d * side, yaw);
        placeSolidRun(world, p[0] + n[0] * d * side, p[2] + n[2] * d * side, yaw, 8, 0.45, 1);
      }
    }
  }

  // --- the village shop -----------------------------------------------------
  // Somewhere to stop on the way home. A layby, a shopfront and a lit sign,
  // halfway through the village on the near side of the road so you can pull
  // straight in. Stopping is optional and costs you nothing but time.
  const shopStop = (() => {
    // Middle of the village zone, which is where the buildings already are.
    const i = clamp(Math.round(count * 0.57), 6, count - 8);
    const p = sp.points[i], n = sp.normals[i], t = sp.tangents[i];
    const yaw = Math.atan2(t[0], t[2]);
    const side = 1;                       // the side you are already driving on
    const bayD = route.halfWidth + 3.1;
    const bx = p[0] + n[0] * bayD * side, bz = p[2] + n[2] * bayD * side;

    // The layby itself: an apron of tarmac let into the verge.
    roadMB.mat([0.20, 0.20, 0.22], 0.80, 0, 0, FLAG_DEFAULT);
    roadMB.push();
    roadMB.translate(bx, world.groundHeight(bx, bz) + 0.025, bz);
    roadMB.rotateY(yaw);
    roadMB.box(6.4, 0.02, 22);
    roadMB.pop();
    // Bay markings.
    roadMB.mat([0.86, 0.86, 0.82], 0.55, 0, 0, FLAG_DEFAULT);
    for (const off of [-5.5, 0, 5.5]) {
      roadMB.push();
      roadMB.translate(bx + t[0] * off, world.groundHeight(bx, bz) + 0.032, bz + t[2] * off);
      roadMB.rotateY(yaw);
      roadMB.box(6.0, 0.02, 0.14);
      roadMB.pop();
    }

    const shopMB = new MeshBuilder();
    buildTownBuilding(shopMB, makeRng(4771), { width: 14, depth: 10, floors: 2 });
    const sx = p[0] + n[0] * (bayD + 8.4) * side, sz = p[2] + n[2] * (bayD + 8.4) * side;
    const facing = Math.atan2(-side * n[0], -side * n[2]);
    tryPlaceBuilding(propMB, world, shopMB, sx, sz, facing);

    // A lit sign over the door, so it reads as somewhere open at dusk.
    const signMB = new MeshBuilder();
    signMB.mat([0.10, 0.10, 0.12], 0.7, 0.1, 0, FLAG_DEFAULT);
    signMB.push(); signMB.translate(0, 4.3, -5.3); signMB.box(5.2, 0.9, 0.22); signMB.pop();
    signMB.mat([1.0, 0.80, 0.35], 0.3, 0.0, 0.85, FLAG_UNLIT);
    signMB.push(); signMB.translate(0, 4.3, -5.45); signMB.box(4.4, 0.44, 0.05); signMB.pop();
    placeProp(propMB, world, signMB, sx, sz, facing);

    return {
      x: bx, z: bz, radius: 7.0, index: i, side,
      along: sp.cumulative[i], name: 'Ashcombe village stores',
    };
  })();

  // --- places you can actually go -------------------------------------------
  // Everything here is a real building with a real footprint, registered as a
  // destination so the map can show it and the satnav can be pointed at it.
  const places = [];
  const addPlace = (kind, name, x, z, yaw, builder, radius = 9) => {
    placeProp(propMB, world, builder, x, z, yaw);
    placeBuildingSolids(world, builder, x, z, yaw, 1.6);
    places.push({ kind, name, x, z, radius });
  };

  {
    const prng = makeRng(9091);

    // Destinations have to be spread out, and not by hand: two pins a street
    // apart are one pin at map scale, and a map where half the names sit on
    // top of each other is no better than no map. So each destination is
    // chosen by scanning candidate frontages in a fixed order and taking the
    // first that clears everything already placed.
    // Home and the village shop are fixtures - they are where the route home
    // put them - but they still go on the map, so the picker has to keep clear
    // of them as well as of its own placements.
    const dwEnd = driveway.spline.points[driveway.spline.count - 1];
    const reserved = [{ x: shopStop.x, z: shopStop.z }, { x: dwEnd[0], z: dwEnd[2] }];
    const farEnough = (x, z, minD) => {
      for (const p of places.concat(reserved)) {
        if (Math.hypot(p.x - x, p.z - z) < minD) return false;
      }
      return true;
    };
    // Candidate frontages: every street, sampled along its length, both sides.
    // Walked in a strided order so consecutive picks start far apart instead of
    // marching along one road.
    const frontages = [];
    for (let s = 0; s < cityStreets.length; s++) {
      const street = cityStreets[s];
      const sp = street.spline;
      for (let f = 0; f < 5; f++) {
        const i = clamp(Math.round(sp.count * (0.15 + f * 0.175)), 4, sp.count - 5);
        for (const side of [1, -1]) {
          frontages.push({ street, i, side });
        }
      }
    }
    const stride = 37; // coprime with the list length, so the walk covers it all
    let cursor = 0;
    // `builder` is passed so the spot can be rejected if that particular
    // building would overhang a street from there - a destination standing in
    // a junction is worse than any other building standing in one, because the
    // map sends you to it.
    const nextSpot = (setback, minD, builder) => {
      const b = builder.bounds();
      const halfW = Math.max(1, (b.max[0] - b.min[0]) / 2);
      const halfD = Math.max(1, (b.max[2] - b.min[2]) / 2);
      for (let n = 0; n < frontages.length; n++) {
        const c = frontages[(cursor + n * stride) % frontages.length];
        const sp = c.street.spline;
        const p = sp.points[c.i], nrm = sp.normals[c.i];
        const x = p[0] + nrm[0] * (c.street.halfWidth + setback) * c.side;
        const z = p[2] + nrm[2] * (c.street.halfWidth + setback) * c.side;
        if (!farEnough(x, z, minD)) continue;
        const yaw = Math.atan2(-c.side * nrm[0], -c.side * nrm[2]);
        if (!footprintClearOfRoads(world, x, z, yaw, halfW, halfD)) continue;
        cursor = (cursor + (n + 1) * stride) % frontages.length;
        return { x, z, yaw };
      }
      return null;
    };

    // Two petrol stations, well apart, so there is always one on your side of
    // the city.
    const station = (() => { const mb = new MeshBuilder(); buildPetrolStation(mb, prng); return mb; })();
    for (const name of ['Ashcombe Services', 'Millbrook Fuel']) {
      const spot = nextSpot(15, 260, station);
      if (spot) addPlace('fuel', name, spot.x, spot.z, spot.yaw + Math.PI, station, 11);
    }

    // Named shops, one per district rather than five in a row.
    const shopNames = ['Corner Stores', 'Ashcombe Bakery', 'The Hardware Shop',
      'Riverside Cafe', 'Market Grocer'];
    for (const name of shopNames) {
      const mb = new MeshBuilder();
      buildTownBuilding(mb, prng, { width: rnd2(prng, 12, 16), depth: 11, floors: 2 });
      const spot = nextSpot(11.5, 150, mb);
      if (!spot) continue;
      addPlace('shop', name, spot.x, spot.z, spot.yaw, mb, 9);
    }

    // The other house, on a quiet street away from the shops.
    {
      const mb = new MeshBuilder();
      buildHouse(mb, makeRng(707), { width: 13, depth: 11, wallHeight: 5.8 });
      const spot = nextSpot(14, 200, mb);
      if (spot) addPlace('house', 'The other house', spot.x, spot.z, spot.yaw, mb, 9);
    }
  }
  // The village shop and home itself are places too - they already exist, so
  // they are registered rather than rebuilt. Home goes on at the end, once the
  // driveway has been laid out.
  places.push({ kind: 'shop', name: shopStop.name, x: shopStop.x, z: shopStop.z, radius: 7 });

  // --- the gate in ----------------------------------------------------------
  // The other face of the circuit gate. Driving out of the paddock hands over
  // to this world right here, so this end has to match the other one: same
  // gate, same avenue of trees closing the view in, same fences.
  {
    const gp = sp.points[0], gt = sp.tangents[0], gn = sp.normals[0];
    const gateYaw = Math.atan2(gt[0], gt[2]);
    const gateMB = new MeshBuilder();
    buildCircuitGate(gateMB);
    placeProp(propMB, world, gateMB, gp[0], gp[2], gateYaw);
    for (const side of [-1, 1]) {
      world.addSolid(gp[0] + gn[0] * 5.5 * side, gp[2] + gn[2] * 5.5 * side, 0.75);
    }
    for (let k = 0; k <= 9; k++) {
      const i = clamp(k * 2, 0, count - 1);
      const p = sp.points[i], n = sp.normals[i];
      for (const side of [-1, 1]) {
        const d = route.halfWidth + 3.2;
        placeProp(propMB, world, lib.trees[k % lib.trees.length],
          p[0] + n[0] * d * side, p[2] + n[2] * d * side, rng() * TAU, 0, 1.25, 0.34);
      }
    }
    for (const side of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const fx = gp[0] + gn[0] * (6.2 + k * 7.9) * side + gt[0] * 0.2;
        const fz = gp[2] + gn[2] * (6.2 + k * 7.9) * side + gt[2] * 0.2;
        placeProp(propMB, world, lib.fence, fx, fz, gateYaw + Math.PI / 2);
        placeSolidRun(world, fx, fz, gateYaw + Math.PI / 2, 8, 0.5, 1);
      }
    }
  }

  // --- filling the city blocks ----------------------------------------------
  // Buildings are placed along each block's frontage rather than scattered:
  // the thing that makes a street read as a street from inside a car is a
  // continuous wall of façades at a consistent setback, with the gaps in the
  // right places.
  {
    const rng2 = makeRng(31337);
    const bigShops = [];
    for (let i = 0; i < 9; i++) {
      bigShops.push((() => {
        const mb = new MeshBuilder();
        buildTownBuilding(mb, rng2, {
          width: rnd2(rng2, 11, 19),
          depth: rnd2(rng2, 10, 15),
          floors: 2 + Math.floor(rng2() * 4),
        });
        return mb;
      })());
    }

    for (const street of cityStreets) {
      const ssp = street.spline;
      const setback = street.halfWidth + 11.5;
      // Step along the frontage, leaving junctions clear.
      for (let i = 6; i < ssp.count - 6; i += 5) {
        const p = ssp.points[i], nn = ssp.normals[i], tt = ssp.tangents[i];
        for (const side of [-1, 1]) {
          if (rng2() < 0.22) continue;                 // gaps, yards, car parks
          const bx = p[0] + nn[0] * setback * side;
          const bz = p[2] + nn[2] * setback * side;
          // Not on top of another road, and not on top of the route home.
          const hit = world.query(bx, bz);
          if (hit && Math.abs(hit.lateral) < hit.path.halfWidth + 8.0) continue;
          const facing = Math.atan2(-side * nn[0], -side * nn[2]);
          const shop = bigShops[Math.floor(rng2() * bigShops.length)];
          if (!tryPlaceBuilding(propMB, world, shop, bx, bz, facing)) continue;
          // Pavement in front of the façade.
          roadMB.mat([0.40, 0.40, 0.41], 0.86, 0, 0, FLAG_DEFAULT);
          roadMB.push();
          const px = p[0] + nn[0] * (street.halfWidth + 1.5) * side;
          const pz = p[2] + nn[2] * (street.halfWidth + 1.5) * side;
          roadMB.translate(px, world.groundHeight(px, pz) + 0.055, pz);
          roadMB.rotateY(Math.atan2(tt[0], tt[2]));
          roadMB.box(2.6, 0.05, 25);
          roadMB.pop();
        }
        // Street lights down the avenues.
        if (street.markings && i % 15 === 6) {
          const side = (i % 30 === 6) ? -1 : 1;
          const d = street.halfWidth + 1.8;
          placeProp(propMB, world, side < 0 ? lib.streetLightR : lib.streetLightL,
            p[0] + nn[0] * d * side, p[2] + nn[2] * d * side,
            Math.atan2(tt[0], tt[2]), 0, 1, 0.20);
        }
      }
    }
  }

  // Trees and hedgerows filling the open country.
  for (let i = 0; i < 2200; i++) {
    const x = rnd2(rng, -300, 1160);
    const z = rnd2(rng, -200, 1100);
    const hit = world.query(x, z);
    if (hit && Math.abs(hit.lateral) < hit.path.halfWidth + 14) continue;
    if (rng() > 0.35) continue;
    placeProp(propMB, world, lib.trees[Math.floor(rng() * lib.trees.length)], x, z, rng() * TAU, 0, rnd2(rng, 0.75, 1.4), 0.34);
  }

  // --- speed limit signs at each zone change --------------------------------
  const signIndices = [];
  {
    let prev = null;
    for (let i = 3; i < count - 3; i++) {
      const zone = zoneAt(sp.cumulative[i] / total);
      if (prev && zone.limit !== prev.limit) signIndices.push([i, zone.limit]);
      prev = zone;
    }
  }
  for (const [i, limit] of signIndices) {
    const p = sp.points[i], n = sp.normals[i], t = sp.tangents[i];
    const yaw = Math.atan2(t[0], t[2]);
    const sign = limit <= 30 ? lib.signs.s30 : (limit <= 50 ? lib.signs.s50 : lib.signs.s80);
    const d = route.halfWidth + 1.9;
    placeProp(propMB, world, sign, p[0] + n[0] * d, p[2] + n[2] * d, yaw + Math.PI, 0, 1, 0.14);
  }

  // --- traffic lights -------------------------------------------------------
  const trafficLights = [];
  const addLight = (junctionIndex, phaseOffset) => {
    const i = clamp(junctionIndex, 2, count - 3);
    const p = sp.points[i], n = sp.normals[i], t = sp.tangents[i];
    const yaw = Math.atan2(t[0], t[2]);
    const d = route.halfWidth + 1.6;
    // Stop line a few metres before the junction.
    const stopIdx = Math.max(0, i - 3);
    const sPt = sp.points[stopIdx], sN = sp.normals[stopIdx];
    roadMB.mat([0.86, 0.86, 0.82], 0.55, 0, 0, FLAG_DEFAULT);
    roadMB.quad(
      [sPt[0], sPt[1] + 0.031, sPt[2]],
      [sPt[0] + sN[0] * route.halfWidth, sPt[1] + 0.031, sPt[2] + sN[2] * route.halfWidth],
      [sPt[0] + sN[0] * route.halfWidth + Math.sin(yaw) * 0.4, sPt[1] + 0.031, sPt[2] + sN[2] * route.halfWidth + Math.cos(yaw) * 0.4],
      [sPt[0] + Math.sin(yaw) * 0.4, sPt[1] + 0.031, sPt[2] + Math.cos(yaw) * 0.4],
      [0, 1, 0]);

    const px = p[0] + n[0] * d, pz = p[2] + n[2] * d;
    placeProp(propMB, world, lib.trafficLight, px, pz, yaw + Math.PI, 0, 1, 0.22);
    const baseY = world.groundHeight(px, pz);
    // Lamp world positions for the overhead head (arm points across the road).
    const armDir = [-n[0], 0, -n[2]];
    const lamps = [];
    for (let k = 0; k < 3; k++) {
      lamps.push([px + armDir[0] * 3.2, baseY + 5.72 - k * 0.36, pz + armDir[2] * 3.2]);
    }
    lamps.push([px - n[0] * 0.30, baseY + 3.22, pz - n[2] * 0.30]);
    lamps.push([px - n[0] * 0.30, baseY + 2.90, pz - n[2] * 0.30]);
    lamps.push([px - n[0] * 0.30, baseY + 2.58, pz - n[2] * 0.30]);

    trafficLights.push({
      index: i,
      stopIndex: stopIdx,
      along: sp.cumulative[stopIdx],
      pos: [p[0], baseY, p[2]],
      lamps,
      phase: phaseOffset,
      state: 'green',
      timer: 0,
    });
  };

  // Junctions where the side streets meet the route.
  addLight(Math.round(indexAtPoint(sp, 470, 424)), 0);
  addLight(Math.round(indexAtPoint(sp, 832, 640)), 7.5);

  // --- home -----------------------------------------------------------------
  const homePoint = sp.points[homeIndex];
  const homeNormal = sp.normals[homeIndex];
  const homeTangent = sp.tangents[homeIndex];
  const homeYaw = Math.atan2(homeTangent[0], homeTangent[2]);

  const drivewayEnd = driveway.spline.points[driveway.spline.count - 1];
  const garageYaw = Math.atan2(
    drivewayEnd[0] - driveway.spline.points[0][0],
    drivewayEnd[2] - driveway.spline.points[0][2]);

  // Your house, set back with the garage at the top of the drive.
  {
    const houseMB = new MeshBuilder();
    buildHouse(houseMB, makeRng(88), { width: 12.5, depth: 10.5, wallHeight: 5.6 });
    // Far enough off the drive to leave it drivable. At 9.5 m the roof
    // overhang put the house's collider ring 0.7 m from the centreline of a
    // drive the car needs a metre of, so the last few metres home were walled
    // off - invisibly, because the mesh does not reach as far as its bounds do.
    const hx = drivewayEnd[0] - 13.0, hz = drivewayEnd[2] + 2.0;
    placeProp(propMB, world, houseMB, hx, hz, garageYaw + Math.PI);
    placeBuildingSolids(world, houseMB, hx, hz, garageYaw + Math.PI, 1.6);

    // Set back far enough to leave an apron in front of the doors. The garage
    // used to sit right on the end of the drive, which only worked because its
    // front wall had no colliders - once it became solid there was nowhere left
    // to stop, and the drive home could not be finished. You park in front of a
    // garage, not inside it.
    const garageMB = new MeshBuilder();
    buildGarage(garageMB, makeRng(91), { width: 6.4, depth: 7.0, height: 3.5 });
    const gz = drivewayEnd[2] + 7.2;
    placeProp(propMB, world, garageMB, drivewayEnd[0], gz, garageYaw + Math.PI);
    placeBuildingSolids(world, garageMB, drivewayEnd[0], gz, garageYaw + Math.PI, 1.4);

    // Hedges either side of the drive, a mailbox at the kerb, a bin out front.
    for (const side of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        placeProp(propMB, world, lib.hedge,
          drivewayEnd[0] + side * 5.0, drivewayEnd[2] - 4 - k * 8, garageYaw);
        placeSolidRun(world, drivewayEnd[0] + side * 5.0, drivewayEnd[2] - 4 - k * 8,
          garageYaw, 8, 0.55, 0.35);
      }
    }
    placeProp(propMB, world, lib.mailbox, homePoint[0] + homeNormal[0] * 6.2, homePoint[2] + homeNormal[2] * 6.2, homeYaw);
    placeProp(propMB, world, lib.bin, homePoint[0] + homeNormal[0] * 7.4, homePoint[2] + homeNormal[2] * 7.4 + 2.5, homeYaw);

    // Lit gate posts at the mouth of the drive. The turn off the road is the
    // one the satnav cannot infer from the shape of the route, so it needs
    // something you can actually see coming - especially at this hour.
    const dsp = driveway.spline;
    const mouth = dsp.points[1], mouthN = dsp.normals[1];
    for (const side of [-1, 1]) {
      const gx = mouth[0] + mouthN[0] * 3.4 * side;
      const gz = mouth[2] + mouthN[2] * 3.4 * side;
      const postMB = new MeshBuilder();
      postMB.mat([0.34, 0.31, 0.28], 0.85, 0.0, 0, FLAG_DEFAULT);
      postMB.push(); postMB.translate(0, 0.62, 0); postMB.box(0.42, 1.24, 0.42); postMB.pop();
      postMB.push(); postMB.translate(0, 1.30, 0); postMB.box(0.52, 0.12, 0.52); postMB.pop();
      postMB.mat([1.0, 0.86, 0.58], 0.3, 0.0, 0.9, FLAG_UNLIT);
      postMB.push(); postMB.translate(0, 1.46, 0); postMB.box(0.22, 0.20, 0.22); postMB.pop();
      placeProp(propMB, world, postMB, gx, gz, garageYaw, 0, 1, 0.34);
    }
  }

  places.push({ kind: 'home', name: 'Home', x: drivewayEnd[0], z: drivewayEnd[2] + 1.4, radius: 6 });

  // Everything solid has been placed by now, so it can be bucketed for lookup.
  world.indexSolids();

  // Chunked so the renderer can cull: a whole world in three draw calls means
  // every building behind you is transformed before the depth test finds out.
  const meshes = {
    terrain: chunkedMesh(gl, terrainMB, 180),
    road: chunkedMesh(gl, roadMB, 180),
    props: chunkedMesh(gl, propMB, 110),
  };

  return {
    kind: 'home',
    world,
    route,
    sideStreets,
    driveway,
    meshes,
    zones: HOME_ZONES,
    zoneAt,
    trafficLights,
    routeLength: total,
    // The satnav needs both of these: the drive is the last 35 m of the journey
    // but it is not part of the route spline, and which way you turn into it is
    // the one instruction the shape of the road cannot supply.
    shopStop,
    places,
    // Every drivable spline, for the minimap: free roam is unusable if the map
    // only shows the one road you were told to take.
    roadSplines: world.paths.map((p) => p.spline),
    drivewayLength: driveway.spline.length,
    drivewaySide: Math.sign(
      (drivewayEnd[0] - sp.points[count - 1][0]) * sp.normals[count - 1][0]
      + (drivewayEnd[2] - sp.points[count - 1][2]) * sp.normals[count - 1][2]) || 1,
    start: {
      x: sp.points[1][0], z: sp.points[1][2],
      yaw: Math.atan2(sp.tangents[1][0], sp.tangents[1][2]),
    },
    destination: {
      x: drivewayEnd[0],
      z: drivewayEnd[2] + 1.4,
      radius: 3.0,
      yaw: garageYaw,
    },
    ambience: {
      sunAngle: 0.26, sunAzimuth: -1.25,
      sky: { zenith: [0.11, 0.20, 0.46], horizon: [0.86, 0.52, 0.32], cloud: 0.55 },
      fogDensity: 0.00065,
      night: 0.35,
    },
  };
}

// Closest spline index to a world position - handy for anchoring junctions.
function indexAtPoint(sp, x, z) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < sp.count; i++) {
    const p = sp.points[i];
    const d = (p[0] - x) * (p[0] - x) + (p[2] - z) * (p[2] - z);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}
