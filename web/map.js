/* Stylised park map, drawn from the attractions' real coordinates.
 *
 * No tile server and no map library: the whole thing is one SVG projected
 * from lat/lon, so it renders offline and prints cleanly.
 *
 * The two parks sit about a kilometre apart, so projecting both into one
 * frame wastes most of the canvas on the empty esplanade between them and
 * squashes each park into an unreadable clump. Each park therefore gets its
 * own panel and its own projection, sized to how much is in it. Routes are
 * drawn within a panel; a hop between parks is shown as a labelled marker
 * rather than a line across dead space. */

const SVG_NS = "http://www.w3.org/2000/svg";

const LAND_COLORS = {
  "Main Street U.S.A.":   "#8a6f4a",
  "Frontierland":         "#a9603c",
  "Adventureland":        "#3f7d55",
  "Fantasyland":          "#5f5aa8",
  "Discoveryland":        "#2f6f8f",
  "Production Courtyard": "#7a4a63",
  "Worlds of Pixar":      "#4a6f9e",
  "Avengers Campus":      "#8c4340",
  "Toon Studio":          "#7e6b3a",
};

const PARK_NAMES = {
  DLP: "Disneyland Park",
  DAW: "Walt Disney Studios",
};

const WIDTH = 980, PAD = 46, HEADER = 26, GAP = 14;
const MIN_PANEL_H = 320, MAX_PANEL_H = 700;

export function el(tag, attrs = {}, text) {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text !== undefined) n.textContent = text;
  return n;
}

/* ---- projection -------------------------------------------------------- */

/* Fit a set of points into a rect, preserving aspect ratio and keeping
 * north up. Longitude degrees shrink with latitude, so scale them by
 * cos(lat) or the park comes out stretched east-west. */
function bounds(points) {
  const lats = points.map(p => p.lat), lons = points.map(p => p.lon);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const kx = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);
  // A park whose attractions sit on one line would divide by zero.
  const w = Math.max(1e-6, (maxLon - minLon) * kx);
  const h = Math.max(1e-6, maxLat - minLat);
  return { minLat, maxLat, minLon, maxLon, kx, w, h, aspect: w / h };
}

function projectInto(b, rect) {
  const scale = Math.min((rect.w - 2 * PAD) / b.w, (rect.h - 2 * PAD) / b.h);
  const offX = rect.x + (rect.w - b.w * scale) / 2;
  const offY = rect.y + (rect.h - b.h * scale) / 2;
  return (lat, lon) => [
    offX + (lon - b.minLon) * b.kx * scale,
    offY + (b.maxLat - lat) * scale,    // SVG y grows downward
  ];
}

/* ---- geometry ---------------------------------------------------------- */

function hull(pts) {
  if (pts.length < 3) return pts.slice();
  const s = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0]);
  const lower = [];
  for (const p of s) {
    while (lower.length >= 2 && cross(lower[lower.length-2], lower[lower.length-1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = s.length - 1; i >= 0; i--) {
    const p = s[i];
    while (upper.length >= 2 && cross(upper[upper.length-2], upper[upper.length-1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

function grow(pts, by) {
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return pts.map(([x, y]) => {
    const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy) || 1;
    return [x + dx / d * by, y + dy / d * by];
  });
}

/* Closed Catmull-Rom through the points, so land borders read as organic
 * blobs rather than the jagged polygon a raw hull gives you. */
function smoothClosed(pts) {
  if (pts.length < 3) return "";
  const n = pts.length;
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i],
          p2 = pts[(i + 1) % n],     p3 = pts[(i + 2) % n];
    const c1 = [p1[0] + (p2[0]-p0[0]) / 6, p1[1] + (p2[1]-p0[1]) / 6];
    const c2 = [p2[0] - (p3[0]-p1[0]) / 6, p2[1] - (p3[1]-p1[1]) / 6];
    d += ` C ${c1[0].toFixed(1)} ${c1[1].toFixed(1)}, ${c2[0].toFixed(1)} ${c2[1].toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d + " Z";
}

/* Nudge labels apart vertically. Cheap and good enough: sort by y, and push
 * anything that lands on top of its neighbour further down. */
function deoverlap(labels, minGap = 9) {
  const cols = new Map();
  for (const l of labels) {
    const key = Math.round(l.x / 70);
    if (!cols.has(key)) cols.set(key, []);
    cols.get(key).push(l);
  }
  for (const group of cols.values()) {
    group.sort((a, b) => a.y - b.y);
    for (let i = 1; i < group.length; i++) {
      if (group[i].y - group[i - 1].y < minGap) group[i].y = group[i - 1].y + minGap;
    }
  }
  return labels;
}

/* ---- wait colouring ---------------------------------------------------- */

export function waitColor(wait) {
  if (wait === null || wait === undefined) return "#5b6480";   // closed / unknown
  if (wait <= 15) return "#4ade80";
  if (wait <= 30) return "#a3e635";
  if (wait <= 45) return "#facc15";
  if (wait <= 70) return "#fb923c";
  return "#f87171";
}

function pinRadius(wait) {
  if (wait === null || wait === undefined) return 3.5;
  return 3.5 + Math.min(7, wait / 13);
}

/* ---- rendering --------------------------------------------------------- */

export function renderMap(svg, { attractions, waits, plan, onHover, onLeave }) {
  svg.innerHTML = "";

  // Split by park, and give each panel width in proportion to how much it
  // has to show, so Fantasyland is not crushed to fit a half-empty Studios.
  const parks = [...new Set(attractions.map(a => a.park))]
    .sort((a, b) => (a === "DLP" ? -1 : b === "DLP" ? 1 : 0));
  const inPark = Object.fromEntries(
    parks.map(p => [p, attractions.filter(a => a.park === p)]));
  const bnds = Object.fromEntries(parks.map(p => [p, bounds(inPark[p])]));
  const totalCount = attractions.length || 1;

  const rects = {};
  const shares = parks.map(p => Math.max(0.36, inPark[p].length / totalCount));
  const shareSum = shares.reduce((s, v) => s + v, 0);
  let cursor = 0;
  parks.forEach((p, i) => {
    const w = (WIDTH - GAP * (parks.length - 1)) * (shares[i] / shareSum);
    rects[p] = { x: cursor, y: HEADER, w, h: 0 };
    cursor += w + GAP;
  });

  // Height follows the content. Fitting a wide, shallow park into a tall
  // panel leaves half the canvas empty, so let the tallest panel set the
  // canvas height and give every panel that height.
  const needed = parks.map(p =>
    (rects[p].w - 2 * PAD) / bnds[p].aspect + 2 * PAD);
  const panelH = Math.max(MIN_PANEL_H, Math.min(MAX_PANEL_H, Math.max(...needed)));
  for (const p of parks) rects[p].h = panelH;
  const HEIGHT = HEADER + panelH;
  svg.setAttribute("viewBox", `0 0 ${WIDTH} ${HEIGHT}`);

  const xy = {};
  for (const p of parks) {
    const project = projectInto(bnds[p], rects[p]);
    for (const a of inPark[p]) xy[a.id] = project(a.lat, a.lon);
  }

  const gPanels = el("g"), gLands = el("g"), gPaths = el("g"),
        gPins = el("g"), gLabels = el("g");
  svg.append(gPanels, gLands, gPaths, gPins, gLabels);

  // -- panel frames and titles
  for (const p of parks) {
    const r = rects[p];
    gPanels.append(el("rect", {
      x: r.x, y: r.y, width: r.w, height: r.h, rx: 10,
      fill: "#0d1424", stroke: "#222c45", "stroke-width": 1,
    }));
    gPanels.append(el("text", {
      x: r.x + 12, y: HEADER - 9, class: "land-label",
      style: "font-size:10px;letter-spacing:0.12em;fill:#8e9ab6",
    }, PARK_NAMES[p] || p));
  }

  // -- land blobs
  const byLand = {};
  for (const a of attractions) {
    const key = `${a.park}|${a.land}`;
    (byLand[key] ||= { land: a.land, park: a.park, pts: [] }).pts.push(xy[a.id]);
  }
  for (const { land, park, pts } of Object.values(byLand)) {
    const color = LAND_COLORS[land] || "#4a5570";
    // A narrow panel packs its lands tightly, so shrink the margin around
    // each blob or they merge into one shapeless mass.
    const margin = Math.max(12, Math.min(26, rects[park].w / 16));
    const cx = pts.reduce((s, q) => s + q[0], 0) / pts.length;
    const cy = pts.reduce((s, q) => s + q[1], 0) / pts.length;
    let d;
    if (pts.length >= 3) {
      d = smoothClosed(grow(hull(pts), margin));
    } else {
      const rx = pts.length === 1 ? margin + 8 : Math.max(margin + 8, Math.hypot(
        pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]) / 2 + margin);
      const ry = margin + 4;
      d = `M ${cx - rx} ${cy} a ${rx} ${ry} 0 1 0 ${rx * 2} 0 a ${rx} ${ry} 0 1 0 ${-rx * 2} 0`;
    }
    gLands.append(el("path", { d, fill: color, stroke: color,
                               "stroke-width": 1, class: "land-shape" }));
    gLabels.append(el("text", { x: cx, y: cy - margin - 12, class: "land-label",
                                "text-anchor": "middle" }, land));
  }

  // -- routes, one per track, in visit order, broken at park boundaries
  const rides = (plan?.items || [])
    .filter(i => i.ride_id && xy[i.ride_id])
    .sort((a, b) => a.start - b.start);

  const stops = { 0: [], 1: [] };
  for (const i of rides) {
    const prev = stops[i.track][stops[i.track].length - 1];
    if (!prev || prev.ride_id !== i.ride_id) stops[i.track].push(i);
  }

  for (const track of [1, 0]) {
    // Split the route wherever the party crosses between parks.
    let run = [];
    const runs = [];
    for (const i of stops[track]) {
      if (run.length && run[run.length - 1].park !== i.park) {
        runs.push(run); run = [];
      }
      run.push(i);
    }
    if (run.length) runs.push(run);

    for (const seg of runs) {
      if (seg.length < 2) continue;
      const d = seg.map((i, k) => {
        const [x, y] = xy[i.ride_id];
        return `${k ? "L" : "M"} ${x.toFixed(1)} ${y.toFixed(1)}`;
      }).join(" ");
      gPaths.append(el("path", {
        d, class: "path-line",
        stroke: track === 0 ? "var(--track0)" : "var(--track1)",
        "stroke-width": track === 0 ? 2.4 : 1.8,
        "stroke-dasharray": track === 0 ? "none" : "6 5",
        opacity: 0.8,
      }));
    }
  }

  // -- attraction pins, sized and coloured by current wait
  for (const a of attractions) {
    const [x, y] = xy[a.id];
    const raw = waits ? waits[a.id] : undefined;
    const wait = raw === undefined ? null : raw;
    const g = el("g", { class: "pin" });
    g.append(el("circle", { cx: x, cy: y, r: pinRadius(wait) + 7,
                            fill: waitColor(wait), opacity: 0, class: "halo" }));
    g.append(el("circle", { cx: x, cy: y, r: pinRadius(wait),
                            fill: waitColor(wait), stroke: "#0b1120",
                            "stroke-width": 1.4 }));
    g.addEventListener("mousemove", e => onHover && onHover(e, a, wait));
    g.addEventListener("mouseleave", () => onLeave && onLeave());
    gPins.append(g);
  }

  // -- numbered stop markers, offset per track so they never sit on top of
  //    each other when both tracks visit the same attraction
  for (const track of [0, 1]) {
    stops[track].forEach((item, k) => {
      const [x, y] = xy[item.ride_id];
      const dx = track === 0 ? -11 : 11;
      const g = el("g", { class: "pin" });
      g.append(el("circle", {
        cx: x + dx, cy: y - 10, r: 7,
        fill: track === 0 ? "var(--track0)" : "var(--track1)",
        stroke: "#0b1120", "stroke-width": 1.3,
      }));
      g.append(el("text", { x: x + dx, y: y - 10, class: "seq" }, String(k + 1)));
      g.addEventListener("mousemove", e => onHover && onHover(e, item, null, true));
      g.addEventListener("mouseleave", () => onLeave && onLeave());
      gPins.append(g);
    });
  }

  // -- names, only for the family track's stops, de-overlapped
  const named = new Set(stops[0].map(i => i.ride_id));
  const labels = attractions
    .filter(a => named.has(a.id))
    .map(a => ({ x: xy[a.id][0], y: xy[a.id][1] + 15,
                 text: a.name.length > 24 ? a.name.slice(0, 23) + "…" : a.name }));
  for (const l of deoverlap(labels)) {
    gLabels.append(el("text", {
      x: l.x, y: l.y, class: "pin-label", "text-anchor": "middle",
    }, l.text));
  }
}
