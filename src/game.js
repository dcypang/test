/* Bay Gridlock – map renderer, input and HUD. Needs window.BAY_MAP and window.BaySim. */
(function () {
  'use strict';
  var MAP = window.BAY_MAP, Sim = window.BaySim, CLS = Sim.CLS;
  var $ = function (id) { return document.getElementById(id); };
  var canvas = $('map'), ctx = canvas.getContext('2d');
  var SAVE_KEY = 'bay-gridlock-v1', BEST_KEY = 'bay-gridlock-best';
  var SPEEDS = [0, 1, 3, 8];
  var KM_MI = 0.621371;

  var sim = null, speed = 0, acc = 0, last = 0;
  var cam = { x: MAP.w / 2, y: MAP.h / 2, s: 4 }, view = { w: 0, h: 0, dpr: 1 }, fitS = 4, camSet = false;
  var sel = null, mode = 'inspect', build = { a: -1, b: -1, cls: 'fwy', q: null };
  var col = {}, landPath = null, shields = [], toastTimer = 0, saveTimer = 0, hudTick = 0, newGameArmed = false;

  // ---- helpers ---------------------------------------------------------------
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function money(m) {
    var a = Math.abs(m), sgn = m < 0 ? '-' : '';
    return a >= 999.5 ? sgn + '$' + (a / 1000).toFixed(2) + 'B' : sgn + '$' + Math.round(a) + 'M';
  }
  function miles(km) { var m = km * KM_MI; return (m < 10 ? m.toFixed(1) : Math.round(m)) + ' mi'; }
  function clock(t) {
    var h = Math.floor(t / 60) % 24, m = Math.floor(t % 60);
    return ((h + 11) % 12 + 1) + ':' + (m < 10 ? '0' : '') + m + (h < 12 ? ' AM' : ' PM');
  }
  function sx(x) { return (x - cam.x) * cam.s + view.w / 2; }
  function sy(y) { return (y - cam.y) * cam.s + view.h / 2; }
  function laneW() { var w = 0.55 + cam.s * 0.045; return w < 0.8 ? 0.8 : w > 4.5 ? 4.5 : w; }

  var NS = { '101': 1, '280': 1, '880': 1, '680': 1, '238': 1, '85': 1, '87': 1, '17': 1, '13': 1, '1': 1, '29': 1, '35': 1, '82': 1,
    '9': 1, '242': 1, '160': 1, '121': 1, '185': 1, '61': 1, '260': 1, '5': 1, '505': 1 };
  function routeName(e) { return e.ref ? (e.pre === 'I' ? 'I-' : e.pre === 'US' ? 'US-' : 'CA-') + e.ref : ''; }
  function nearZone(e) {
    var p = pointAt(e, e.len / 2), best = null, bd = 15;
    for (var i = 0; i < sim.zones.length; i++) {
      var z = sim.zones[i]; if (z.gw) continue;
      var n = sim.nodes[z.node], d = Math.hypot(n.x - p.x, n.y - p.y);
      if (d < bd) { bd = d; best = z; }
    }
    return best;
  }
  function edgeTitle(e) {
    if (e.name) return e.name;
    var z = nearZone(e), r = routeName(e) || 'Local road';
    return z ? r + ' near ' + z.name : r;
  }
  function edgeKind(e) {
    var k = e.cls === 'br' ? 'Bridge' : e.bridge ? CLS[e.cls].label + ' crossing' : CLS[e.cls].label;
    return (e.name && e.ref ? routeName(e) + ', ' : '') + k + ', ' + miles(e.len);
  }
  function dirName(e, d) {
    var A = sim.nodes[e.a], B = sim.nodes[e.b], dx = B.x - A.x, dy = B.y - A.y;
    var ns = e.ref ? !!NS[e.ref] : Math.abs(dy) > Math.abs(dx);
    if (ns && Math.abs(dy) < 0.2 * Math.abs(dx)) ns = false;
    if (!ns && Math.abs(dx) < 0.2 * Math.abs(dy)) ns = true;
    var fwd = ns ? dy > 0 : dx > 0; if (d) fwd = !fwd;
    return ns ? (fwd ? 'Southbound' : 'Northbound') : (fwd ? 'Eastbound' : 'Westbound');
  }
  function jamLevel(L) {
    if (L.cars.length < 3) return 0;
    var r = L.ff / sim.linkCost(L);
    return r > 0.7 ? 0 : r > 0.45 ? 1 : r > 0.25 ? 2 : 3;
  }

  // ---- geometry --------------------------------------------------------------
  function geom(e) {
    if (e.g) return e.g;
    var p = e.pts, n = p.length / 2, snx = [], sny = [], i;
    for (i = 0; i < n - 1; i++) {
      var dx = p[2 * i + 2] - p[2 * i], dy = p[2 * i + 3] - p[2 * i + 1], l = Math.hypot(dx, dy) || 1;
      snx.push(-dy / l); sny.push(dx / l);       // right-hand side of a→b (y points down)
    }
    var nx = new Float32Array(n), ny = new Float32Array(n), x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (i = 0; i < n; i++) {
      var a = Math.max(0, i - 1), b = Math.min(n - 2, i);
      var mx = snx[a] + snx[b], my = sny[a] + sny[b], ml = Math.hypot(mx, my) || 1;
      mx /= ml; my /= ml;
      var c = mx * snx[b] + my * sny[b], k = 1 / Math.max(c, 0.5);
      nx[i] = mx * k; ny[i] = my * k;
      x0 = Math.min(x0, p[2 * i]); x1 = Math.max(x1, p[2 * i]); y0 = Math.min(y0, p[2 * i + 1]); y1 = Math.max(y1, p[2 * i + 1]);
    }
    return (e.g = { n: n, nx: nx, ny: ny, snx: snx, sny: sny, x0: x0, y0: y0, x1: x1, y1: y1 });
  }
  function pointAt(e, s) {
    var cum = e.cum, p = e.pts, n = cum.length, i = 1;
    while (i < n - 1 && cum[i] < s) i++;
    var a = cum[i - 1], t = (s - a) / ((cum[i] - a) || 1);
    return { x: p[2 * i - 2] + (p[2 * i] - p[2 * i - 2]) * t, y: p[2 * i - 1] + (p[2 * i + 1] - p[2 * i - 1]) * t, i: i - 1 };
  }
  function visible(g, pad) {
    var hw = view.w / 2 / cam.s + pad, hh = view.h / 2 / cam.s + pad;
    return !(g.x1 < cam.x - hw || g.x0 > cam.x + hw || g.y1 < cam.y - hh || g.y0 > cam.y + hh);
  }
  function tracePath(e, off) {
    var g = geom(e), p = e.pts;
    for (var i = 0; i < g.n; i++) {
      var X = sx(p[2 * i] + g.nx[i] * off), Y = sy(p[2 * i + 1] + g.ny[i] * off);
      if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y);
    }
  }
  function distToEdge(e, X, Y) {     // screen px
    var p = e.pts, best = 1e9;
    for (var i = 0; i < p.length - 2; i += 2) {
      var ax = sx(p[i]), ay = sy(p[i + 1]), bx = sx(p[i + 2]), by = sy(p[i + 3]);
      var dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
      var t = l2 ? Math.max(0, Math.min(1, ((X - ax) * dx + (Y - ay) * dy) / l2)) : 0;
      var d = Math.hypot(X - ax - dx * t, Y - ay - dy * t);
      if (d < best) best = d;
    }
    return best;
  }

  function buildStatic() {
    landPath = new Path2D();
    MAP.land.forEach(function (f) {
      landPath.moveTo(f[0], f[1]);
      for (var i = 2; i < f.length; i += 2) landPath.lineTo(f[i], f[i + 1]);
      landPath.closePath();
    });
  }
  function placeShields() {
    shields = [];
    var es = sim.edges.filter(function (e) { return e.ref && e.cls !== 'sec'; }).sort(function (a, b) { return b.len - a.len; });
    es.forEach(function (e) {
      var p = pointAt(e, e.len / 2);
      for (var i = 0; i < shields.length; i++) {
        var s = shields[i], d = Math.hypot(s.x - p.x, s.y - p.y);
        if (d < (s.ref === e.ref ? 17 : 2.5)) return;
      }
      shields.push({ x: p.x, y: p.y, ref: e.ref, pre: e.pre });
    });
  }

  function readColors() {
    var cs = getComputedStyle(document.documentElement);
    ['water', 'shore', 'land', 'road', 'road-minor', 'built', 'casing', 'ink', 'ink-soft', 'water-ink', 'car', 'jam1', 'jam2', 'jam3',
      'sign', 'warn', 'us', 'interstate', 'interstate-red', 'state'].forEach(function (k) { col[k] = cs.getPropertyValue('--' + k).trim() || '#888'; });
  }

  // ---- drawing ---------------------------------------------------------------
  var WATER_LABELS = [['San Francisco Bay', 36.5, 76], ['San Pablo Bay', 30, 30], ['Pacific Ocean', 4, 96], ['Suisun Bay', 62, 33], ['Monterey Bay', 52, 156]];
  var boxes = [];
  function freeBox(x, y, w, h) {
    for (var i = 0; i < boxes.length; i++) { var b = boxes[i]; if (x < b[0] + b[2] && x + w > b[0] && y < b[1] + b[3] && y + h > b[1]) return false; }
    return true;
  }
  function rr(x, y, w, h, r) { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); }

  function draw() {
    var w = view.w, h = view.h, dpr = view.dpr, s = cam.s, i, e, g;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = col.water; ctx.fillRect(0, 0, w, h);

    // land, with a pale shallow-water halo along the shore
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (w / 2 - cam.x * s), dpr * (h / 2 - cam.y * s));
    ctx.lineJoin = 'round';
    ctx.strokeStyle = col.shore; ctx.lineWidth = 9 / s; ctx.stroke(landPath);
    ctx.fillStyle = col.land; ctx.fill(landPath);
    ctx.strokeStyle = col.land; ctx.lineWidth = 1.2 / s; ctx.stroke(landPath);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = col['water-ink'];
    ctx.font = 'italic 500 ' + (s < 6 ? 11 : 13) + 'px Overpass, Georgia, serif';
    for (i = 0; i < WATER_LABELS.length; i++) ctx.fillText(WATER_LABELS[i][0], sx(WATER_LABELS[i][1]), sy(WATER_LABELS[i][2]));

    var lw = laneW(), med = Math.max(0.6, lw * 0.4), edges = sim.edges, vis = [];
    for (i = 0; i < edges.length; i++) if (visible(geom(edges[i]), 2)) vis.push(edges[i]);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    if (sel) { ctx.beginPath(); tracePath(sel, 0); ctx.strokeStyle = col.warn; ctx.lineWidth = sel.lanes * 2 * lw + med + 12; ctx.stroke(); }
    ctx.strokeStyle = col.casing;
    for (i = 0; i < vis.length; i++) { e = vis[i]; ctx.beginPath(); tracePath(e, 0); ctx.lineWidth = e.lanes * 2 * lw + med + 2.4; ctx.stroke(); }
    ctx.lineCap = 'butt';
    var JAM = [null, col.jam1, col.jam2, col.jam3];
    for (i = 0; i < vis.length; i++) {
      e = vis[i];
      var base = e.built ? col.built : e.cls === 'sec' ? col['road-minor'] : col.road, half = e.lanes * lw;
      var l0 = jamLevel(e.links[0]), l1 = jamLevel(e.links[1]);
      if (!l0 && !l1 && lw < 1.5) {       // zoomed out and flowing: one stroke does both directions
        ctx.beginPath(); tracePath(e, 0); ctx.strokeStyle = base; ctx.lineWidth = half * 2 + med; ctx.stroke();
        continue;
      }
      for (var d = 0; d < 2; d++) {
        var lvl = d ? l1 : l0;
        ctx.beginPath(); tracePath(e, (d ? -1 : 1) * (med / 2 + half / 2) / s);
        ctx.strokeStyle = lvl ? JAM[lvl] : base; ctx.lineWidth = half; ctx.stroke();
      }
    }

    // cars: one dash each, all in a single path
    var cw = Math.max(1.5, lw * 0.82), cl = Math.max(cw, Math.min(cw * 2.4, s * 0.09)) / 2;
    ctx.beginPath();
    for (i = 0; i < vis.length; i++) {
      e = vis[i]; g = geom(e);
      for (var dd = 0; dd < 2; dd++) {
        var cars = e.links[dd].cars, side = dd ? -1 : 1;
        for (var k = 0; k < cars.length; k++) {
          var c = cars[k], pt = pointAt(e, dd ? e.len - c.pos : c.pos);
          var off = side * (med / 2 + (c.lane + 0.5) * lw) / s, ux = g.sny[pt.i], uy = -g.snx[pt.i];
          var X = sx(pt.x + g.snx[pt.i] * off), Y = sy(pt.y + g.sny[pt.i] * off);
          ctx.moveTo(X - ux * cl, Y - uy * cl); ctx.lineTo(X + ux * cl, Y + uy * cl);
        }
      }
    }
    ctx.strokeStyle = col.car; ctx.lineWidth = cw; ctx.stroke();

    if (mode === 'build') drawBuild();
    drawLabels();
  }

  function drawBuild() {
    var nodes = sim.nodes, i, n;
    ctx.fillStyle = col.ink; ctx.strokeStyle = col.casing; ctx.lineWidth = 1.5;
    for (i = 0; i < nodes.length; i++) {
      n = nodes[i]; var X = sx(n.x), Y = sy(n.y);
      if (X < -10 || Y < -10 || X > view.w + 10 || Y > view.h + 10) continue;
      ctx.beginPath(); ctx.arc(X, Y, cam.s < 6 ? 2.6 : 4, 0, 6.2832); ctx.fill(); ctx.stroke();
    }
    if (build.a >= 0) {
      var A = nodes[build.a];
      if (build.b >= 0) {
        var B = nodes[build.b];
        ctx.beginPath(); ctx.moveTo(sx(A.x), sy(A.y)); ctx.lineTo(sx(B.x), sy(B.y));
        ctx.strokeStyle = col.casing; ctx.lineWidth = 8; ctx.lineCap = 'round'; ctx.stroke();
        ctx.setLineDash([9, 7]); ctx.strokeStyle = build.q && build.q.ok ? col.built : col.jam2; ctx.lineWidth = 4.5; ctx.stroke(); ctx.setLineDash([]);
        ring(B);
      }
      ring(A);
    }
    function ring(N) {
      ctx.beginPath(); ctx.arc(sx(N.x), sy(N.y), 9, 0, 6.2832);
      ctx.fillStyle = col.warn; ctx.fill(); ctx.strokeStyle = col.ink; ctx.lineWidth = 2; ctx.stroke();
    }
  }

  function drawLabels() {
    var s = cam.s, zones = sim.zones, i, z, n, X, Y;
    boxes.length = 0;
    var order = zones.slice().sort(function (a, b) { return (b.pop + b.jobs) * (b.gw ? 0.3 : 1) - (a.pop + a.jobs) * (a.gw ? 0.3 : 1); });
    var fs = s < 7 ? 11 : 12.5, limit = s < 4.6 ? 15 : s < 8 ? 30 : 99;
    ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    for (i = 0; i < order.length; i++) {
      z = order[i]; n = sim.nodes[z.node]; X = sx(n.x); Y = sy(n.y);
      if (X < -60 || Y < -20 || X > view.w + 60 || Y > view.h + 20) continue;
      var r = z.gw ? 4 : 2.6 + Math.sqrt(z.pop + z.jobs) / 9, wait = z.queue.length - z.qh;
      if (wait > 6) {          // drivers stuck waiting to get on the road
        ctx.beginPath(); ctx.arc(X, Y, r + 3 + Math.min(7, wait / 12), 0, 6.2832); ctx.fillStyle = col.jam2; ctx.globalAlpha = 0.55; ctx.fill(); ctx.globalAlpha = 1;
      }
      ctx.beginPath();
      if (z.gw) { ctx.moveTo(X, Y - r - 1); ctx.lineTo(X + r + 1, Y); ctx.lineTo(X, Y + r + 1); ctx.lineTo(X - r - 1, Y); ctx.closePath(); ctx.fillStyle = col.sign; }
      else { ctx.arc(X, Y, r, 0, 6.2832); ctx.fillStyle = col.ink; }
      ctx.fill(); ctx.strokeStyle = col.casing; ctx.lineWidth = 1.5; ctx.stroke();
      if (i >= limit) continue;
      var text = z.gw ? 'to ' + z.name : z.name;
      ctx.font = (z.gw ? 'italic 500 ' : '700 ') + fs + 'px Overpass, Helvetica, Arial, sans-serif';
      var tw = ctx.measureText(text).width, th = fs + 3;
      var spots = [[X + r + 4, Y - th / 2], [X - r - 4 - tw, Y - th / 2], [X - tw / 2, Y - r - 3 - th], [X - tw / 2, Y + r + 3]];
      for (var k = 0; k < 4; k++) {
        var bx = spots[k][0], by = spots[k][1];
        if (bx < 2 || bx + tw > view.w - 2 || !freeBox(bx - 2, by - 1, tw + 4, th + 2)) continue;
        boxes.push([bx - 2, by - 1, tw + 4, th + 2]);
        ctx.textAlign = 'left'; ctx.strokeStyle = col.land; ctx.lineWidth = 3.5; ctx.strokeText(text, bx, by + th / 2);
        ctx.fillStyle = z.gw ? col['ink-soft'] : col.ink; ctx.fillText(text, bx, by + th / 2);
        break;
      }
    }
    // route shields
    ctx.textAlign = 'center'; ctx.font = '800 9.5px Overpass, Helvetica, Arial, sans-serif';
    for (i = 0; i < shields.length; i++) {
      var sh = shields[i]; X = sx(sh.x); Y = sy(sh.y);
      if (X < 0 || Y < 0 || X > view.w || Y > view.h) continue;
      var w = sh.ref.length > 2 ? 22 : sh.ref.length > 1 ? 18 : 15, hh = 14;
      if (!freeBox(X - w / 2 - 2, Y - hh / 2 - 2, w + 4, hh + 4)) continue;
      boxes.push([X - w / 2 - 2, Y - hh / 2 - 2, w + 4, hh + 4]);
      if (sh.pre === 'I') {
        rr(X - w / 2, Y - hh / 2, w, hh, [3, 3, 7, 7]); ctx.fillStyle = col.interstate; ctx.fill();
        rr(X - w / 2, Y - hh / 2, w, 4, [3, 3, 0, 0]); ctx.fillStyle = col['interstate-red']; ctx.fill();
        ctx.fillStyle = '#fff'; ctx.fillText(sh.ref, X, Y + 2.3);
      } else if (sh.pre === 'US') {
        rr(X - w / 2, Y - hh / 2, w, hh, [3, 3, 7, 7]); ctx.fillStyle = col.us; ctx.fill(); ctx.strokeStyle = '#111'; ctx.lineWidth = 1.2; ctx.stroke();
        ctx.fillStyle = '#111'; ctx.fillText(sh.ref, X, Y + 0.8);
      } else {
        rr(X - w / 2, Y - hh / 2, w, hh, [7, 7, 3, 3]); ctx.fillStyle = col.state; ctx.fill();
        ctx.fillStyle = '#fff'; ctx.fillText(sh.ref, X, Y + 1);
      }
    }
  }

  // ---- camera + input --------------------------------------------------------
  function resize() {
    var r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    view.w = r.width; view.h = r.height; view.dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(view.w * view.dpr); canvas.height = Math.round(view.h * view.dpr);
    // phones: map sits between the two sign rows. wide screens: signs dock left over the Pacific.
    var wide = view.w >= 900, usable = Math.max(200, view.h - (wide ? 30 : 150));
    fitS = Math.min((view.w - (wide ? 500 : 0)) / (MAP.w + 4), usable / (MAP.h + 4));
    if (!camSet) { cam.s = fitS; cam.x = MAP.w / 2 - (wide ? 250 / cam.s : 0); cam.y = MAP.h / 2 + (wide ? 0 : 4 / cam.s); camSet = true; }
    clampCam();
  }
  function clampCam() {
    cam.s = Math.max(fitS * 0.85, Math.min(48, cam.s));
    cam.x = Math.max(-60, Math.min(MAP.w + 5, cam.x)); cam.y = Math.max(-5, Math.min(MAP.h + 5, cam.y));
  }
  function zoomAt(X, Y, f) {
    var wx = cam.x + (X - view.w / 2) / cam.s, wy = cam.y + (Y - view.h / 2) / cam.s;
    cam.s *= f; clampCam();
    cam.x = wx - (X - view.w / 2) / cam.s; cam.y = wy - (Y - view.h / 2) / cam.s; clampCam();
  }
  function focusOn(e) {
    var p = pointAt(e, e.len / 2); cam.x = p.x; cam.y = p.y + 40 / cam.s;
    if (cam.s < 9) cam.s = 9; clampCam();
  }

  var ptrs = {}, nPtr = 0, tap = null, pinch = 0;
  function local(ev) { var r = canvas.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; }
  canvas.addEventListener('pointerdown', function (ev) {
    var p = local(ev); ptrs[ev.pointerId] = p; nPtr = Object.keys(ptrs).length;
    try { canvas.setPointerCapture(ev.pointerId); } catch (err) {}
    tap = nPtr === 1 ? { x: p.x, y: p.y, t: Date.now(), moved: false } : null; pinch = 0;
  });
  canvas.addEventListener('pointermove', function (ev) {
    var o = ptrs[ev.pointerId]; if (!o) return;
    var p = local(ev), ids = Object.keys(ptrs);
    if (ids.length === 1) {
      cam.x -= (p.x - o.x) / cam.s; cam.y -= (p.y - o.y) / cam.s; clampCam();
      if (tap && Math.hypot(p.x - tap.x, p.y - tap.y) > 8) tap.moved = true;
    } else if (ids.length === 2) {
      ptrs[ev.pointerId] = p;
      var a = ptrs[ids[0]], b = ptrs[ids[1]], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinch);
      pinch = d;
    }
    ptrs[ev.pointerId] = p;
  });
  function up(ev) {
    if (!ptrs[ev.pointerId]) return;
    delete ptrs[ev.pointerId]; nPtr = Object.keys(ptrs).length; pinch = 0;
    if (tap && !tap.moved && Date.now() - tap.t < 500 && ev.type === 'pointerup') onTap(tap.x, tap.y);
    tap = null;
  }
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', function (ev) {
    ev.preventDefault(); var p = local(ev);
    zoomAt(p.x, p.y, Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0018)));
  }, { passive: false });

  function onTap(X, Y) {
    var i, best = null, bd;
    if (mode === 'build') {
      bd = 28;
      for (i = 0; i < sim.nodes.length; i++) { var n = sim.nodes[i], d = Math.hypot(sx(n.x) - X, sy(n.y) - Y); if (d < bd) { bd = d; best = n; } }
      if (!best) return;
      if (build.a < 0 || best.id === build.a) { build.a = best.id; build.b = -1; build.q = null; }
      else { build.b = best.id; build.q = sim.quote(build.a, build.b, build.cls); }
      renderCard(); return;
    }
    bd = 20;
    for (i = 0; i < sim.edges.length; i++) {
      var e = sim.edges[i]; if (!visible(geom(e), 2)) continue;
      var de = distToEdge(e, X, Y) - e.lanes * laneW(); if (de < bd) { bd = de; best = e; }
    }
    sel = best; renderCard();
  }

  // ---- HUD + cards -----------------------------------------------------------
  function toast(html, ms) {
    var t = $('toast'); t.innerHTML = html; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, ms || 3200);
  }
  $('toast').addEventListener('click', function () { $('toast').hidden = true; });

  function setSpeed(i) {
    speed = i;
    for (var k = 0; k < 4; k++) $('sp' + k).setAttribute('aria-pressed', k === i ? 'true' : 'false');
  }
  function setMode(m) {
    mode = m; build.a = build.b = -1; build.q = null;
    if (m === 'build') sel = null;
    $('buildBtn').setAttribute('aria-pressed', m === 'build' ? 'true' : 'false');
    $('buildBtn').textContent = m === 'build' ? 'Cancel build' : 'Build road';
    canvas.classList.toggle('build', m === 'build');
    renderCard();
  }

  function shieldHTML(e) {
    if (!e.ref) return '<span class="shield new">' + (e.built ? 'NEW' : '·') + '</span>';
    return '<span class="shield ' + (e.pre === 'I' ? 'i' : e.pre === 'US' ? '' : 'ca') + '">' + esc(e.ref) + '</span>';
  }
  function renderCard() {
    var c = $('card'), h = '';
    if (mode === 'build') {
      var q = build.q;
      h += '<header><span class="shield new">NEW</span><div><h2>' + (q ? 'New road, ' + miles(q.len) : 'Build a road') + '</h2><p>';
      if (build.a < 0) h += 'Tap the junction where it starts.';
      else if (!q) h += 'Now tap the junction where it ends.';
      else h += (q.water > 0.3 ? miles(q.water) + ' over water at bridge prices. ' : 'All on dry land. ') + 'It joins the network only at its two ends.';
      h += '</p></div><button class="x" type="button" data-act="cancel" aria-label="Cancel">&times;</button></header>';
      if (q) {
        h += '<div class="toll"><span>Type</span><div class="seg" role="group" aria-label="Road type">' +
          '<button type="button" data-cls="fwy" aria-pressed="' + (build.cls === 'fwy') + '">Freeway 65</button>' +
          '<button type="button" data-cls="pri" aria-pressed="' + (build.cls === 'pri') + '">Highway 45</button></div></div>';
        if (!q.ok) h += '<p class="hint"><b>' + esc(q.why) + '</b></p>';
        h += '<div class="acts"><button class="act" type="button" data-act="build" id="actBuild"><span>Build it, 2 lanes each way</span><b>' + money(q.cost) + '</b></button></div>';
      }
    } else if (sel) {
      var e = sel, wc = sim.widenCost(e), uc = sim.upgradeCost(e);
      h += '<header>' + shieldHTML(e) + '<div><h2>' + esc(edgeTitle(e)) + '</h2><p>' + esc(edgeKind(e)) + '</p></div>' +
        '<button class="x" type="button" data-act="close" aria-label="Close">&times;</button></header>';
      h += '<div class="stats"><div class="limit"><small>SPEED<br>LIMIT</small><b>' + CLS[e.cls].mph + '</b></div><div class="dirs">';
      for (var d = 0; d < 2; d++) h += '<div class="dir"><span>' + dirName(e, d) + '</span><span class="mph" id="mph' + d + '"></span><span class="load"><i id="load' + d + '"></i></span></div>';
      h += '</div><div class="lanes"><b>' + e.lanes + '</b><small>lanes<br>each way</small></div></div>';
      h += '<p class="hint" id="hint" hidden></p><div class="acts">';
      if (wc !== null) h += '<button class="act" type="button" data-act="widen" id="actWiden"><span>Add a lane each way</span><b>' + money(wc) + '</b></button>';
      else h += '<button class="act" type="button" disabled><span>As wide as it gets</span><b>' + e.lanes + ' lanes</b></button>';
      if (uc !== null) h += '<button class="act" type="button" data-act="upgrade" id="actUpgrade"><span>Rebuild as freeway</span><b>' + money(uc) + '</b></button>';
      h += '</div>';
      if (sim.canToll(e)) {
        h += '<div class="toll"><span>Toll</span><div class="seg" role="group" aria-label="Toll">';
        for (var t = 0; t < 3; t++) h += '<button type="button" data-toll="' + t + '" aria-pressed="' + (e.toll === t) + '">' + Sim.TOLL_LABEL[t] + '</button>';
        h += '</div></div>';
      }
    }
    c.innerHTML = h; c.hidden = !h;
    liveCard();
  }
  function liveCard() {
    var b;
    if (mode === 'build') { b = $('actBuild'); if (b) b.disabled = !build.q.ok || build.q.cost > sim.money; return; }
    if (!sel) return;
    var e = sel, jam = 0, full = false;
    for (var d = 0; d < 2; d++) {
      var L = e.links[d], lvl = jamLevel(L), r = L.cars.length ? Math.min(1, L.ff / sim.linkCost(L)) : 1;
      var m = $('mph' + d), l = $('load' + d); if (!m) return;
      m.textContent = Math.max(L.cars.length ? 2 : 0, Math.round(CLS[e.cls].mph * r)) + ' mph';
      l.style.width = Math.min(100, Math.round(100 * L.cars.length / L.capN)) + '%'; l.className = lvl ? 'l' + lvl : '';
      if (lvl > jam) { jam = lvl; full = L.full; }
    }
    var hint = $('hint');
    if (jam >= 2) {
      hint.hidden = false;
      hint.innerHTML = full ? '<b>Backed up from the road ahead.</b> Fix the jam downstream first.' : '<b>Over capacity.</b> More lanes here will move more cars.';
    } else hint.hidden = true;
    b = $('actWiden'); if (b) b.disabled = sim.widenCost(e) > sim.money;
    b = $('actUpgrade'); if (b) b.disabled = sim.upgradeCost(e) > sim.money;
  }
  $('card').addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b) return;
    var act = b.getAttribute('data-act'), e = sel;
    if (b.hasAttribute('data-toll')) { sim.setToll(e, +b.getAttribute('data-toll')); renderCard(); queueSave(); return; }
    if (b.hasAttribute('data-cls')) { build.cls = b.getAttribute('data-cls'); build.q = sim.quote(build.a, build.b, build.cls); renderCard(); return; }
    if (act === 'close') { sel = null; renderCard(); }
    else if (act === 'cancel') setMode('inspect');
    else if (act === 'widen') { if (sim.widen(e)) { toast('Lane added: <b>' + esc(edgeTitle(e)) + '</b> is now ' + e.lanes + ' each way.'); renderCard(); queueSave(); } }
    else if (act === 'upgrade') { if (sim.upgrade(e)) { toast('<b>' + esc(edgeTitle(e)) + '</b> rebuilt as a freeway.'); renderCard(); queueSave(); } }
    else if (act === 'build') {
      var ne = sim.build(build.q);
      if (ne) { setMode('inspect'); sel = ne; renderCard(); toast('<b>' + esc(ne.name) + '</b> is open to traffic.'); queueSave(); }
    }
  });

  var MOODS = [[75, 'Cruising'], [50, 'Grumbling'], [25, 'Honking'], [0, 'Furious']];
  function hud() {
    $('dayLbl').textContent = 'Day ' + sim.day;
    $('clock').textContent = clock(sim.t);
    $('money').textContent = money(sim.money);
    var m = sim.mood, bar = $('moodBar');
    bar.style.width = Math.max(2, m) + '%'; bar.className = m >= 50 ? '' : m >= 25 ? 'mid' : 'low';
    for (var i = 0; i < MOODS.length; i++) if (m >= MOODS[i][0]) { $('moodWord').textContent = MOODS[i][1]; break; }
    var pct = Math.round((sim.delay - 1) * 100);
    $('delay').textContent = pct < 4 ? 'Trips on time' : 'Trips run ' + pct + '% slow';
    var a = $('alert'), wst = sim.worst;
    if (wst && !sim.over) { a.hidden = false; a.textContent = 'Bottleneck: ' + edgeTitle(wst.edge) + ', ' + dirName(wst.edge, wst.dir).toLowerCase(); }
    else a.hidden = true;
    liveCard();
  }
  $('alert').addEventListener('click', function () {
    if (!sim.worst) return;
    if (mode === 'build') setMode('inspect');
    sel = sim.worst.edge; focusOn(sel); renderCard();
  });

  // ---- overlays --------------------------------------------------------------
  var ARROW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5v3.5h8.5L4 18l2.5 2.5L16 11v8.5h3.5V5z"/></svg>';
  function showIntro(resume) {
    newGameArmed = false;
    var fresh = !resume;
    $('overlay').innerHTML = '<div class="sign bigsign"><div class="body">' +
      '<p class="kicker">San Francisco Bay Area · real freeway map</p><h1>Bay Gridlock</h1>' +
      '<p class="lede">You run the roads. Every dot is a commuter with somewhere to be, and there are more of them every day.</p>' +
      '<ul><li><b>Tap a road</b><span>Add lanes, rebuild it as a freeway, or set a bridge toll.</span></li>' +
      '<li><b>Build road</b><span>Join any two junctions. Crossing the bay costs bridge money.</span></li>' +
      '<li><b>Red roads</b><span>Jams. Long delays sour commuters. If their mood hits zero, you are recalled.</span></li></ul>' +
      '<p class="credit">' + (function (b) { return b ? 'Your best run: ' + days(b.days) + '. ' : ''; })(loadBest()) + esc(MAP.src) + '</p></div>' +
      '<button class="exit" type="button" id="goBtn"><span>' + (fresh ? 'Start the commute' : 'Back to day ' + sim.day) + '</span>' + ARROW + '</button>' +
      (fresh ? '' : '<button class="exit alt" type="button" id="newBtn"><span>Start a new game</span></button>') + '</div>';
    $('overlay').hidden = false;
    $('goBtn').addEventListener('click', function () { $('overlay').hidden = true; if (speed === 0) setSpeed(1); });
    var nb = $('newBtn');
    if (nb) nb.addEventListener('click', function () {
      if (!newGameArmed) { newGameArmed = true; nb.firstChild.textContent = 'Erase this game and restart?'; return; }
      newGame(); $('overlay').hidden = true; setSpeed(1);
    });
  }
  function days(n) { return n + ' day' + (n === 1 ? '' : 's'); }
  function loadBest() { try { return JSON.parse(localStorage.getItem(BEST_KEY) || 'null'); } catch (err) { return null; } }
  function showOver() {
    setSpeed(0);
    var run = { days: sim.day - 1, trips: sim.totalTrips }, best = loadBest(), record = '';
    if (!best || run.days > best.days || (run.days === best.days && run.trips > best.trips)) {
      if (best) record = '<li><b>Record</b><span>Beats your old best of ' + days(best.days) + '.</span></li>';
      try { localStorage.setItem(BEST_KEY, JSON.stringify(run)); } catch (err) {}
    } else record = '<li><b>Best</b><span>' + days(best.days) + ', ' + best.trips.toLocaleString('en-US') + ' trips.</span></li>';
    $('overlay').innerHTML = '<div class="sign bigsign stop"><div class="body">' +
      '<p class="kicker">Commuter mood hit zero</p><h1>Recalled</h1>' +
      '<p class="lede">You kept the Bay moving for <b>' + days(run.days) + '</b> and delivered <b>' +
      run.trips.toLocaleString('en-US') + ' trips</b> before the voters had enough.</p>' +
      (record ? '<ul>' + record + '</ul>' : '') + '</div>' +
      '<button class="exit" type="button" id="againBtn"><span>Try again</span>' + ARROW + '</button></div>';
    $('overlay').hidden = false;
    $('againBtn').addEventListener('click', function () { newGame(); $('overlay').hidden = true; setSpeed(1); });
    save();
  }

  // ---- lifecycle -------------------------------------------------------------
  function attach() {
    sim.onDay = function (d) {
      var pct = Math.round((d.avg - 1) * 100);
      toast('<b>Day ' + d.day + ' done.</b> ' + d.trips.toLocaleString('en-US') + ' trips, ' + (pct < 4 ? 'on time' : pct + '% slow') +
        '. Fares and tolls ' + money(d.fares + d.tolls) + ', upkeep ' + money(d.upkeep) + '. Traffic grows 5% tomorrow.', 9000);
      save();
    };
    sim.onOver = showOver;
    sel = null; build.a = build.b = -1; build.q = null;
    for (var i = 0; i < sim.edges.length; i++) sim.edges[i].g = null;
    placeShields();
  }
  function newGame() {
    sim = new Sim(MAP);
    for (var i = 0; i < 1100; i++) sim.step();      // warm up to 6:50 AM so the roads are already busy
    attach(); setMode('inspect'); save();
  }
  function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(sim.serialize())); } catch (err) {} }
  function queueSave() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 800); }
  function load() { try { return JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (err) { return null; } }

  function frame(ts) {
    var dt = Math.min(100, ts - last || 16); last = ts;
    if (speed && !sim.over && $('overlay').hidden) {
      var night = (sim.t < 285 || sim.t > 1320) && sim.nCars < 80 ? 5 : 1;
      acc += dt / 16.667 * SPEEDS[speed] * night;
      var n = Math.min(48, acc | 0); acc -= n; if (acc > 4) acc = 4;
      while (n-- > 0) sim.step();
    }
    draw();
    if (ts - hudTick > 220) { hudTick = ts; hud(); }
    requestAnimationFrame(frame);
  }

  function start(data) {
    var saved = (data && data.save) || load(), resumed = false;
    if (saved && !saved.over) { try { sim = new Sim(MAP, saved); resumed = sim.day === saved.day; } catch (err) { resumed = false; } }
    if (resumed) { attach(); setMode('inspect'); } else newGame();
    buildStatic(); readColors(); resize(); hud();
    if (data && data.cam) { cam.x = data.cam.x; cam.y = data.cam.y; cam.s = data.cam.s; clampCam(); }
    if (data && data.save) setSpeed(data.speed || 0); else showIntro(resumed);
    requestAnimationFrame(frame);
  }

  for (var k = 0; k < 4; k++) (function (k) { $('sp' + k).addEventListener('click', function () { setSpeed(k); }); })(k);
  $('buildBtn').addEventListener('click', function () { setMode(mode === 'build' ? 'inspect' : 'build'); });
  $('helpBtn').addEventListener('click', function () { showIntro(true); });
  window.addEventListener('keydown', function (ev) {
    if (ev.target && /INPUT|TEXTAREA/.test(ev.target.tagName)) return;
    if (ev.key === ' ') { ev.preventDefault(); setSpeed(speed ? 0 : 1); }
    else if (ev.key >= '1' && ev.key <= '3') setSpeed(+ev.key);
    else if (ev.key === 'b' || ev.key === 'B') setMode(mode === 'build' ? 'inspect' : 'build');
    else if (ev.key === 'Escape') { if (mode === 'build') setMode('inspect'); else { sel = null; renderCard(); } }
    else if (ev.key === '+' || ev.key === '=') zoomAt(view.w / 2, view.h / 2, 1.3);
    else if (ev.key === '-') zoomAt(view.w / 2, view.h / 2, 1 / 1.3);
  });
  window.addEventListener('resize', resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
  document.addEventListener('visibilitychange', function () { if (document.hidden && sim) save(); });
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) mq.addEventListener('change', readColors);
  }
  if (window.MutationObserver) new MutationObserver(readColors).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(readColors);

  // keep the game across live page updates
  var hot = window.claude && window.claude.hot;
  if (hot && hot.snapshot) hot.snapshot(function () { return { save: sim.serialize(), cam: { x: cam.x, y: cam.y, s: cam.s }, speed: speed }; });
  if (hot && hot.ready) hot.ready(start); else start((hot && hot.data) || {});

  window.__bay = { get sim() { return sim; }, cam: cam, setSpeed: setSpeed };
})();
