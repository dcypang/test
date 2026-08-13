// Collider audit. Builds both scenes on the CPU and proves, geometrically,
// that the world is closed: every building's perimeter is covered by colliders
// with no gap the car could fit through, and no collider is left standing on a
// road.
//
// This is deliberately not a driving test. Driving at a wall proves the wall is
// solid where you happened to hit it; walking the whole perimeter of every
// building proves there is nowhere it is not.
//   node scripts/solid.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, 'src');

const FILES = ['math.js', 'gl.js', 'mesh.js', 'physics.js', 'car_model.js',
  'world.js', 'props.js', 'scenes.js', 'ai.js'];

const glStub = new Proxy({}, {
  get(target, prop) {
    if (prop === Symbol.toPrimitive) return () => 'glstub';
    return (...args) => ({ stub: String(prop) });
  },
});

const ctx = vm.createContext({
  console, performance, Math, Date,
  Float32Array, Uint16Array, Uint32Array, Uint8Array, Int32Array, Map, Set,
  isFinite, parseFloat, parseInt, NaN, Infinity,
});
for (const f of FILES) {
  vm.runInContext(readFileSync(join(src, f), 'utf8'), ctx, { filename: f });
}
const run = (code) => vm.runInContext(code, ctx);

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push(ok);
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
};

// The car's collision shell, straight from the game, so the audit measures the
// gap the real car has to fit through and not an invented one.
const CAR_SHELL = Number(readFileSync(join(src, 'game.js'), 'utf8')
  .match(/CAR_SHELL\s*=\s*([\d.]+)/)[1]);
const CAR_WIDTH = CAR_SHELL * 2;
console.log(`car shell ${CAR_SHELL} m, so any gap wider than ${CAR_WIDTH.toFixed(2)} m is a way in\n`);

ctx.__glStub = glStub;
run(`
  var circuit = buildCircuit(__glStub);
  var home = buildHomeRoute(__glStub);
`);

run(`
// Walk a building's outline and find the longest stretch with no collider over
// it. Points are 0.2 m apart, which is fine detail next to a car two metres
// wide.
function widestGap(world, fp) {
  var cs = Math.cos(fp.yaw), sn = Math.sin(fp.yaw);
  var toWorld = function (lx, lz) {
    return [fp.x + lx * cs + lz * sn, fp.z - lx * sn + lz * cs];
  };
  var pts = [];
  var stepAlong = function (ax, az, bx, bz) {
    var len = Math.hypot(bx - ax, bz - az);
    var n = Math.max(1, Math.ceil(len / 0.2));
    for (var i = 0; i < n; i++) {
      pts.push(toWorld(ax + (bx - ax) * (i / n), az + (bz - az) * (i / n)));
    }
  };
  var w = fp.halfW, d = fp.halfD;
  stepAlong(-w, -d, w, -d);
  stepAlong(w, -d, w, d);
  stepAlong(w, d, -w, d);
  stepAlong(-w, d, -w, -d);

  var hits = [];
  var covered = pts.map(function (p) {
    world.querySolids(p[0], p[1], 0.05, hits);
    for (var i = 0; i < hits.length; i++) {
      var s = hits[i];
      if (Math.hypot(p[0] - s.x, p[1] - s.z) < s.r) return true;
    }
    return false;
  });

  // The outline is a loop, so a run of uncovered points can straddle the start.
  var n = covered.length;
  var start = 0;
  while (start < n && !covered[start]) start++;
  if (start === n) return { gap: Infinity, at: pts[0] };   // nothing covered
  var worst = 0, worstAt = null, run = 0, runStart = 0;
  for (var k = 0; k < n; k++) {
    var i = (start + k) % n;
    if (covered[i]) {
      run = 0;
    } else {
      if (run === 0) runStart = i;
      run++;
      // Straight-line distance across the hole, not the distance walked: a gap
      // that turns a corner is narrower than the path around it.
      var a = pts[runStart], b = pts[i];
      var chord = Math.hypot(a[0] - b[0], a[1] - b[1]) + 0.2;
      if (chord > worst) { worst = chord; worstAt = a; }
    }
  }
  return { gap: worst, at: worstAt };
}

function auditScene(scene) {
  var world = scene.world;
  var worst = { gap: -1, at: null };
  for (var i = 0; i < world.footprints.length; i++) {
    var r = widestGap(world, world.footprints[i]);
    if (r.gap > worst.gap) { worst = r; worst.fp = world.footprints[i]; }
  }
  // The other half of the question. Solid scenery is only a fault if it stops
  // you getting down a road, so rather than asking whether anything sits on
  // the tarmac, walk every road and ask whether the car can still get through:
  // is there any lateral position across the width where nothing touches it?
  //
  // The last stations of an open path are skipped. A dead end is allowed to
  // have something at the end of it - the garage at the top of the drive is
  // the end of the drive, and the drive home finishes by stopping in front of
  // it.
  var blocked = 0, blockedAt = null, stations = 0;
  var narrowest = { width: Infinity, at: null, road: null };
  var hits = [];
  for (var pi = 0; pi < world.paths.length; pi++) {
    var path = world.paths[pi];
    var sp = path.spline;
    var last = path.closed ? sp.count : sp.count - 3;
    for (var i = path.closed ? 0 : 2; i < last; i++) {
      var c = sp.points[i], nrm = sp.normals[i];
      var lim = path.halfWidth - 0.15;
      // Widest run of lateral positions where the car's centre can sit clear.
      // "Something got through" is not the standard - a road half filled with
      // wall is still a road you cannot drive down at speed.
      var best = 0, run = 0;
      for (var lat = -lim; lat <= lim; lat += 0.25) {
        var qx = c[0] + nrm[0] * lat, qz = c[2] + nrm[2] * lat;
        world.querySolids(qx, qz, ${CAR_SHELL}, hits);
        var free = true;
        for (var h = 0; h < hits.length; h++) {
          var s2 = hits[h];
          if (Math.hypot(qx - s2.x, qz - s2.z) < s2.r + ${CAR_SHELL}) { free = false; break; }
        }
        if (free) { run += 0.25; if (run > best) best = run; } else { run = 0; }
      }
      stations++;
      if (best < narrowest.width) {
        narrowest = { width: Math.round(best * 100) / 100,
          at: [Math.round(c[0]), Math.round(c[2])], road: path.name || 'road' };
      }
      if (best <= 0) {
        blocked++;
        if (!blockedAt) blockedAt = [Math.round(c[0]), Math.round(c[2]), path.name || 'road'];
      }
    }
  }
  return {
    buildings: world.footprints.length,
    solids: world.solids.length,
    worstGap: Math.round(worst.gap * 100) / 100,
    worstAt: worst.at ? [Math.round(worst.at[0]), Math.round(worst.at[1])] : null,
    blocked: blocked, blockedAt: blockedAt, stations: stations,
    narrowest: narrowest,
  };
}
`);

for (const name of ['circuit', 'home']) {
  const r = run(`JSON.stringify(auditScene(${name}))`);
  const a = JSON.parse(r);
  console.log(`--- ${name} ---`);
  console.log(`    ${a.buildings} buildings, ${a.solids} colliders`);
  check(`${name}: every building is closed all the way round`,
    a.worstGap < CAR_WIDTH,
    `widest gap ${a.worstGap} m${a.worstAt ? ` at ${a.worstAt}` : ''}`);
  check(`${name}: every road can still be driven down`,
    a.blocked === 0,
    a.blocked ? `${a.blocked} of ${a.stations} stations blocked, e.g. ${JSON.stringify(a.blockedAt)}`
      : `${a.stations} stations clear`);
  // Passable is not the same as usable. A lane needs room for the car plus
  // enough either side to steer in, or the drive home turns into a squeeze.
  check(`${name}: no road is pinched to less than a lane`,
    a.narrowest.width >= 2.6,
    `narrowest ${a.narrowest.width} m on ${a.narrowest.road} at ${JSON.stringify(a.narrowest.at)}`);
}

// The broad-phase has to return what it is asked for. This is the bug that
// made the swept test useless: the grid capped every query at a few metres, so
// a long step found nothing to sweep against.
console.log('\n--- broad phase ---');
const reach = JSON.parse(run(`(function () {
  var w = home.world;
  var hits = [];
  // Take a real collider and ask from progressively further away.
  var s = w.solids[Math.floor(w.solids.length / 2)];
  var out = [];
  [2, 6, 12, 24, 40].forEach(function (dist) {
    w.querySolids(s.x + dist, s.z, dist + 0.5, hits);
    var found = false;
    for (var i = 0; i < hits.length; i++) if (hits[i] === s) found = true;
    out.push([dist, found]);
  });
  // And a query must not return the world.
  w.querySolids(s.x, s.z, 3, hits);
  return JSON.stringify({ reach: out, near: hits.length });
})()`));
for (const [dist, found] of reach.reach) {
  check(`a query reaching ${dist} m finds a collider ${dist} m away`, found);
}
check('a small query stays small', reach.near < 60, `${reach.near} candidates within 3 m`);

const dupes = JSON.parse(run(`(function () {
  var w = home.world, seen = new Map(), dup = 0;
  for (var i = 0; i < w.solids.length; i++) {
    var s = w.solids[i];
    var k = Math.round(s.x * 4) + ':' + Math.round(s.z * 4);
    if (seen.has(k)) dup++; else seen.set(k, 1);
  }
  return JSON.stringify({ dup: dup, total: w.solids.length });
})()`));
// The drive home ends by parking on the driveway, so that specific spot has to
// be reachable. The road check above skips the last stations of a dead end -
// the garage is allowed to be at the end of the drive - and that blind spot is
// exactly where a house once quietly walled off the last few metres. So the
// arrival point gets its own check, against the same shell the car has.
console.log('\n--- getting home ---');
const park = JSON.parse(run(`(function () {
  var w = home.world, d = home.destination;
  var dw = home.driveway.spline;
  var hits = [];
  var fits = function (x, z, yaw) {
    for (var o = -1.05; o <= 1.06; o += 2.1) {
      var cx = x + Math.sin(yaw) * o, cz = z + Math.cos(yaw) * o;
      w.querySolids(cx, cz, ${CAR_SHELL}, hits);
      for (var i = 0; i < hits.length; i++) {
        var s = hits[i];
        if (Math.hypot(cx - s.x, cz - s.z) < s.r + ${CAR_SHELL}) return false;
      }
    }
    return true;
  };
  // Walk up the drive and find the closest the car can legally park to the
  // destination, facing along the drive.
  var a = dw.points[0], b = dw.points[dw.count - 1];
  var yaw = Math.atan2(b[0] - a[0], b[2] - a[2]);
  var best = Infinity, bestAt = null;
  for (var t = 0; t <= 1.35; t += 0.01) {
    var x = a[0] + (b[0] - a[0]) * t, z = a[2] + (b[2] - a[2]) * t;
    if (!fits(x, z, yaw)) continue;
    var dist = Math.hypot(x - d.x, z - d.z);
    if (dist < best) { best = dist; bestAt = [Math.round(x), Math.round(z)]; }
  }
  return JSON.stringify({ closest: Math.round(best * 100) / 100,
    radius: d.radius, at: bestAt });
})()`));
check('the car can park within the arrival radius of home',
  park.closest <= park.radius,
  `closest parkable spot ${park.closest} m from the destination, radius ${park.radius} m`);

console.log('\n--- duplicate colliders ---');
check('colliders are not stacked on each other wholesale',
  dupes.dup / dupes.total < 0.25,
  `${dupes.dup} of ${dupes.total} share a spot`);

const failed = checks.filter((c) => !c).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
