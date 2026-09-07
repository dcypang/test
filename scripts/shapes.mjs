// Turns real US boundary data into the state outlines the game draws.
//
//   node scripts/shapes.mjs        # rewrites src/state_shapes.js
//
// The silhouettes used to be drawn by hand, eight or nine points each, and it
// showed: Kansas was a rectangle, Michigan had no Upper Peninsula and Hawaii
// was a blob. These come from public boundary data instead, simplified down to
// something that reads at a glance from a moving car.
//
// Three things are preserved that a hand drawing got wrong:
//
//   Aspect ratio. Every shape used to be stretched to fill its cell, so
//   Tennessee came out square and Vermont came out fat. Each state is now
//   fitted to its cell with its own proportions intact.
//
//   Islands. A state is a list of rings, not one loop, so Michigan keeps its
//   Upper Peninsula, Hawaii is a chain and Massachusetts keeps the Cape.
//
//   Relative size. Not true to scale - Rhode Island at its true size next to
//   Texas would be smaller than one town block, and every state has to hold a
//   town. Size follows area through a fourth root, which keeps the order right
//   and the extremes livable.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SOURCE = 'https://raw.githubusercontent.com/PublicaMundi/MappingAPI/'
  + 'master/data/geojson/us-states.json';
const root = dirname(dirname(fileURLToPath(import.meta.url)));

const NAME_TO_ABBR = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA',
  Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', Florida: 'FL',
  Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN',
  Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME',
  Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN',
  Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE',
  Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM',
  'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH',
  Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI',
  'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX',
  Utah: 'UT', Vermont: 'VT', Virginia: 'VA', Washington: 'WA',
  'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY',
  'District of Columbia': 'DC', 'Puerto Rico': 'PR',
};

// The four the dataset does not carry. Drawn by hand from their real outlines:
// all four are small islands, so a handful of points each is the whole shape
// rather than a simplification of one. Longitude east, latitude north, the
// same as the GeoJSON, so they go through exactly the same pipeline.
const HAND_DRAWN = {
  // Guam: a long peanut, wide in the north, pinched at Apra Harbour.
  GU: [[[144.62, 13.65], [144.70, 13.65], [144.72, 13.58], [144.79, 13.53],
        [144.78, 13.44], [144.72, 13.39], [144.66, 13.44], [144.66, 13.52],
        [144.62, 13.56]]],
  // American Samoa: Tutuila alone. The Manu'a islands are real and are part of
  // the territory, but they sit 130 km east of an island 30 km long, so drawing
  // the group to scale gives a cell of empty ocean with two slivers in it and
  // nowhere to put a town. The main island is the shape anyone recognises.
  AS: [[[-170.85, -14.25], [-170.70, -14.25], [-170.56, -14.27], [-170.55, -14.32],
        [-170.66, -14.34], [-170.82, -14.32]]],
  // Northern Marianas: Saipan and Tinian, which sit eight kilometres apart and
  // read as one place. Rota is another hundred kilometres south, and including
  // it shrinks Saipan - the island with the town on it - to a speck.
  MP: [[[145.68, 15.29], [145.82, 15.27], [145.83, 15.16], [145.72, 15.11],
        [145.68, 15.18]],
       [[145.60, 15.08], [145.68, 15.06], [145.66, 14.92], [145.58, 14.95]]],
  // US Virgin Islands: St Croix, the largest and the one Christiansted is on.
  // St Thomas and St John are 65 km north across open water, and drawing all
  // three to scale leaves no island big enough to stand a town on.
  VI: [[[-64.90, 17.75], [-64.88, 17.78], [-64.78, 17.79], [-64.70, 17.76],
        [-64.64, 17.78], [-64.56, 17.77], [-64.59, 17.73], [-64.68, 17.71],
        [-64.78, 17.70], [-64.88, 17.71]]],
};

// Cells are 1725 x 1500 m, so a shape fitted to its own proportions can use
// this much of one before it touches the neighbouring state.
const CELL_ASPECT = 1725 / 1500;
const MARGIN = 0.94;          // of the cell, at the largest state
const MIN_FILL = 0.50;        // ...and at the smallest, so a town still fits
const AREA_EXP = 0.42;        // square-ish root: keeps the order, tames the range
// Alaska is more than twice Texas and nine times the median, so measuring every
// other state against it pushes the whole country down to the floor and the
// forty-eight come out the same size. Texas sets the scale; Alaska is simply
// the biggest thing on the map.
const SCALE_REF = 'TX';

// --- geometry ---------------------------------------------------------------

const ringArea = (r) => {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
  }
  return Math.abs(a / 2);
};

// Douglas-Peucker. Perpendicular distance, so it drops points along a straight
// border (the whole of Colorado) and keeps them round a coastline.
function simplifyOpen(points, tol) {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b - a < 2) continue;
    const [ax, ay] = points[a], [bx, by] = points[b];
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1e-9;
    let worst = -1, worstD = tol;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      const d = Math.abs((px - ax) * dy - (py - ay) * dx) / len;
      if (d > worstD) { worstD = d; worst = i; }
    }
    if (worst > 0) { keep[worst] = 1; stack.push([a, worst], [worst, b]); }
  }
  return points.filter((_, i) => keep[i]);
}

// The same on a closed ring, which needs care: run it straight and the first
// and last points are the same point, every perpendicular distance to that
// zero-length baseline is zero, and the whole state collapses to two vertices.
// California really did come out as a two-point sliver. Anchoring the two
// halves on the pair of points furthest apart gives it a baseline with a
// direction, and the state keeps its coastline.
function simplifyRing(ring, tol) {
  const pts = ring.slice();
  const first = pts[0], last = pts[pts.length - 1];
  if (pts.length > 1 && first[0] === last[0] && first[1] === last[1]) pts.pop();
  if (pts.length < 4) return pts;
  let far = 0, farD = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > farD) { farD = d; far = i; }
  }
  const a = simplifyOpen(pts.slice(0, far + 1), tol);
  const b = simplifyOpen(pts.slice(far).concat([pts[0]]), tol);
  return a.concat(b.slice(1, -1));
}

// Simplify to a vertex budget by bisecting on the tolerance. Choosing a
// tolerance by hand gives Alaska two hundred points and Delaware four.
function simplifyTo(ring, budget) {
  const bare = simplifyRing(ring, 0);
  if (bare.length <= budget) return bare;
  let lo = 0, hi = 20, best = bare;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const out = simplifyRing(ring, mid);
    if (out.length > budget) lo = mid; else { hi = mid; best = out; }
  }
  return best;
}

// --- main -------------------------------------------------------------------

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`${SOURCE}: HTTP ${res.status}`);
const geo = await res.json();

const byAbbr = new Map();
for (const f of geo.features) {
  const abbr = NAME_TO_ABBR[f.properties.name];
  if (!abbr) continue;
  const g = f.geometry;
  // A GeoJSON polygon's first ring is its outside and the rest are holes; the
  // game has no use for holes, so only the outer ring of each part is kept.
  const rings = g.type === 'MultiPolygon'
    ? g.coordinates.map((poly) => poly[0])
    : [g.coordinates[0]];
  byAbbr.set(abbr, rings);
}
for (const [abbr, rings] of Object.entries(HAND_DRAWN)) byAbbr.set(abbr, rings);

// Every state, projected and measured before anything is scaled, because the
// size of one depends on the size of the largest.
const built = new Map();
for (const [abbr, rawRings] of byAbbr) {
  // Equirectangular about the state's own middle latitude. Over one state the
  // error is far below the resolution these are drawn at, and it keeps the
  // shape from leaning the way a whole-country projection would.
  let latSum = 0, latN = 0;
  for (const r of rawRings) for (const [, lat] of r) { latSum += lat; latN++; }
  const k = Math.cos((latSum / latN) * Math.PI / 180);
  // x east, y south - the game's z axis grows toward the bottom of the map.
  const projected = rawRings.map((r) => r.map(([lon, lat]) => [lon * k, -lat]));

  // Keep the mainland and any island big enough to be worth drawing, largest
  // first, so Michigan keeps the Upper Peninsula and Hawaii keeps its chain.
  const sized = projected.map((r) => ({ r, a: ringArea(r) })).sort((p, q) => q.a - p.a);
  const biggest = sized[0].a;
  const kept = sized.filter((s, i) => i === 0 || s.a > biggest * 0.012).slice(0, 8);

  // Budget by share of the state, so the mainland gets the detail.
  const total = kept.reduce((s, x) => s + x.a, 0);
  const rings = kept.map(({ r, a }) => simplifyTo(r,
    Math.max(6, Math.round(10 + 44 * (a / total)))));

  const area = kept.reduce((s, x) => s + x.a, 0);
  built.set(abbr, { rings, area });
}

const refArea = built.get(SCALE_REF).area;

const out = new Map();
for (const [abbr, { rings, area }] of built) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const r of rings) for (const [x, y] of r) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const w = maxX - minX, h = maxY - minY;

  // How much of the cell this state gets, by area. Texas and anything above it
  // get the whole margin.
  const fill = MIN_FILL + (MARGIN - MIN_FILL)
    * Math.min(1, Math.pow(area / refArea, AREA_EXP));

  // Fit preserving proportions. Cell space is 0..1 on both axes but the cell
  // is wider than it is deep, so a shape's width in cell units has to be
  // divided by the cell's aspect to keep it from being stretched sideways.
  const s = Math.min(fill / (w / h > CELL_ASPECT ? w : h * CELL_ASPECT),
    fill / (w / h > CELL_ASPECT ? w / CELL_ASPECT : h));
  const su = s / CELL_ASPECT, sv = s;
  const cu = 0.5 - ((minX + maxX) / 2) * su, cv = 0.5 - ((minY + maxY) / 2) * sv;
  out.set(abbr, rings.map((r) => r.map(([x, y]) => [
    +(x * su + cu).toFixed(4), +(y * sv + cv).toFixed(4),
  ])));
}

// Idaho is the exception: it holds Ashcombe, the circuit road and the house,
// which fill the cell corner to corner. A real Idaho would leave half of the
// city standing on the ground between states.
out.set('ID', [[[0, 0], [1, 0], [1, 1], [0, 1]]]);

const order = [...out.keys()].sort();
const lines = order.map((abbr) => {
  const rings = out.get(abbr).map((r) =>
    '[' + r.map(([u, v]) => `[${u},${v}]`).join(',') + ']');
  return `  ${abbr}: [\n    ${rings.join(',\n    ')},\n  ],`;
});

const vertices = order.reduce((s, a) =>
  s + out.get(a).reduce((t, r) => t + r.length, 0), 0);

writeFileSync(join(root, 'src/state_shapes.js'), `// ---------------------------------------------------------------------------
// state_shapes.js - the outline of every state, in its cell.
//
// GENERATED by scripts/shapes.mjs from public boundary data. Do not edit by
// hand; re-run the script instead.
//
// Each state is a list of rings so islands survive: Michigan's Upper Peninsula,
// Hawaii's chain, the Florida Keys. A ring is a closed loop of [u, v] in cell
// space, where (0, 0) is the cell's north-west corner and (1, 1) its south-east.
//
// Shapes keep their real proportions and are sized by area, so Texas is big and
// Delaware is not - but not to true scale, which would put Rhode Island inside a
// single town block.
//
// ${order.length} states, ${vertices} vertices.
// ---------------------------------------------------------------------------

const STATE_SHAPES = {
${lines.join('\n')}
};
`);

console.log(`${order.length} states, ${vertices} vertices`);
const wide = order.map((a) => {
  const rs = out.get(a);
  let x0 = 1, x1 = 0, y0 = 1, y1 = 0;
  for (const r of rs) for (const [u, v] of r) {
    x0 = Math.min(x0, u); x1 = Math.max(x1, u);
    y0 = Math.min(y0, v); y1 = Math.max(y1, v);
  }
  return { a, w: x1 - x0, h: y1 - y0, rings: rs.length,
    n: rs.reduce((s, r) => s + r.length, 0) };
});
for (const s of wide) {
  console.log(`  ${s.a}  ${s.rings} ring(s)  ${String(s.n).padStart(3)} pts  `
    + `${(s.w * 100).toFixed(0)}% x ${(s.h * 100).toFixed(0)}% of cell`);
}
