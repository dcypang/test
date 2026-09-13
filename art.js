/* ---------------------------------------------------------------
   Illustration kit for Explorer's Passport.

   Two families, deliberately different:
   - DIAGRAMS (counters, tracks, bar models) are drawn in theme
     tokens, because they are part of the page.
   - POSTCARDS (places, flags, animals) are drawn on a fixed light
     panel with their own colours, like a photo stuck in a passport.
     That keeps a camel sand-coloured in both light and dark mode.
   --------------------------------------------------------------- */
(function (global) {
  'use strict';

  var uid = 0;
  var T = {
    sea: 'var(--sea)', gold: 'var(--marigold)', red: 'var(--tomato)', moss: 'var(--moss)',
    ink: 'var(--ink)', soft: 'var(--ink-soft)', line: 'var(--line)', lineSoft: 'var(--line-soft)',
    card: 'var(--card)', card2: 'var(--card-2)', land: 'var(--land)', landLine: 'var(--land-line)',
    onGold: '#17323E'
  };

  function svg(w, h, body) {
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" role="img">' + body + '</svg>';
  }
  function txt(x, y, s, o) {
    o = o || {};
    return '<text x="' + x + '" y="' + y + '" text-anchor="' + (o.anchor || 'middle') +
      '" font-family="' + (o.mono ? 'Courier Prime, monospace' : 'Fredoka, sans-serif') +
      '" font-size="' + (o.size || 16) + '" font-weight="' + (o.weight || 600) +
      '" letter-spacing="' + (o.track || 0) + '" fill="' + (o.fill || T.ink) + '">' + s + '</text>';
  }
  /* a counter with a little highlight, so it reads as an object to move around */
  function pebble(x, y, r, fill) {
    return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + fill + '"/>' +
      '<ellipse cx="' + (x - r * 0.3) + '" cy="' + (y - r * 0.34) + '" rx="' + (r * 0.34) + '" ry="' + (r * 0.24) + '" fill="#ffffff" opacity=".34"/>';
  }
  function poly(pts, fill, stroke, sw) {
    return '<path d="M' + pts.map(function (p) { return p[0] + ' ' + p[1]; }).join(' L') + ' Z" fill="' + (fill || 'none') +
      '" stroke="' + (stroke || 'none') + '" stroke-width="' + (sw || 0) + '" stroke-linejoin="round"/>';
  }

  /* =============== diagrams =============== */

  var DOT = 28, R = 11;

  function bagOf(n) {
    var cols = Math.min(n, 5), rows = Math.ceil(n / 5);
    return { w: cols * DOT + 16, h: rows * DOT + 16, cols: cols, rows: rows };
  }
  function fillBag(n, ox, oy, color) {
    var s = '';
    for (var i = 0; i < n; i++) {
      s += pebble(ox + 22 + (i % 5) * DOT, oy + 22 + Math.floor(i / 5) * DOT, R, color);
    }
    return s;
  }

  /* counters in bags, joined by + : 7 + 5, or 5 + 5 + 5 */
  function groups(counts) {
    var boxes = counts.map(bagOf), gap = 42, pad = 6;
    var h = Math.max.apply(null, boxes.map(function (b) { return b.h; })) + pad * 2;
    var w = boxes.reduce(function (a, b) { return a + b.w; }, 0) + gap * (counts.length - 1) + pad * 2;
    var x = pad, body = '';
    counts.forEach(function (n, i) {
      var b = boxes[i], y = (h - b.h) / 2;
      body += '<rect x="' + x + '" y="' + y + '" width="' + b.w + '" height="' + b.h + '" rx="13" fill="none" stroke="' + T.line + '" stroke-width="2" stroke-dasharray="7 6"/>';
      body += fillBag(n, x, y, i % 2 ? T.gold : T.sea);
      x += b.w;
      if (i < counts.length - 1) {
        body += txt(x + gap / 2, h / 2 + 10, '+', { size: 28, fill: T.soft });
        x += gap;
      }
    });
    return svg(w, h, body);
  }

  /* ten-frames - the counting tool they already use at school */
  function frame(n) {
    var cell = 34, frames = Math.max(1, Math.ceil(n / 10)), pad = 10, gapY = 14;
    var fw = cell * 5, fh = cell * 2;
    var w = fw + pad * 2, h = frames * fh + (frames - 1) * gapY + pad * 2, body = '';
    for (var f = 0; f < frames; f++) {
      var oy = pad + f * (fh + gapY);
      body += '<rect x="' + pad + '" y="' + oy + '" width="' + fw + '" height="' + fh + '" rx="6" fill="' + T.card + '" stroke="' + T.sea + '" stroke-width="2.5"/>';
      for (var c = 1; c < 5; c++) body += '<path d="M' + (pad + c * cell) + ' ' + oy + ' V' + (oy + fh) + '" stroke="' + T.lineSoft + '" stroke-width="1.5"/>';
      body += '<path d="M' + pad + ' ' + (oy + cell) + ' H' + (pad + fw) + '" stroke="' + T.lineSoft + '" stroke-width="1.5"/>';
      for (var i = 0; i < 10; i++) {
        if (f * 10 + i >= n) break;
        body += pebble(pad + cell / 2 + (i % 5) * cell, oy + cell / 2 + Math.floor(i / 5) * cell, 12, f % 2 ? T.gold : T.sea);
      }
    }
    return svg(w, h, body);
  }

  /* a rectangular array - rows of equal groups */
  function array(rows, cols) {
    var pad = 16, w = cols * DOT + pad * 2, h = rows * DOT + pad * 2, body = '';
    body += '<rect x="' + (pad - 6) + '" y="' + (pad - 6) + '" width="' + (cols * DOT + 12) + '" height="' + (rows * DOT + 12) + '" rx="12" fill="none" stroke="' + T.line + '" stroke-width="2" stroke-dasharray="7 6"/>';
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) body += pebble(pad + DOT / 2 + c * DOT, pad + DOT / 2 + r * DOT, R, r % 2 ? T.gold : T.sea);
    }
    return svg(w, h, body);
  }

  /* counters with some crossed off */
  function takeaway(total, gone) {
    var b = bagOf(total), pad = 6, w = b.w + pad * 2, h = b.h + pad * 2;
    var body = fillBag(total, pad, pad, T.sea);
    for (var i = total - gone; i < total; i++) {
      var cx = pad + 22 + (i % 5) * DOT, cy = pad + 22 + Math.floor(i / 5) * DOT, k = 8;
      body += '<circle cx="' + cx + '" cy="' + cy + '" r="' + R + '" fill="' + T.card2 + '" stroke="' + T.red + '" stroke-width="2"/>';
      body += '<path d="M' + (cx - k) + ' ' + (cy - k) + ' L' + (cx + k) + ' ' + (cy + k) + ' M' + (cx + k) + ' ' + (cy - k) + ' L' + (cx - k) + ' ' + (cy + k) + '" stroke="' + T.red + '" stroke-width="3" stroke-linecap="round"/>';
    }
    return svg(w, h, body);
  }

  /* one pile shared into equal rows */
  function share(total, parts) {
    var per = total / parts, pad = 10, rowGap = 16;
    var w = per * DOT + pad * 2, h = parts * DOT + (parts - 1) * rowGap + pad * 2, body = '';
    for (var r = 0; r < parts; r++) {
      var y = pad + DOT / 2 + r * (DOT + rowGap);
      body += '<rect x="' + (pad - 5) + '" y="' + (y - DOT / 2 - 4) + '" width="' + (per * DOT + 10) + '" height="' + (DOT + 8) + '" rx="11" fill="' + T.card + '" stroke="' + T.line + '" stroke-width="2"/>';
      for (var c = 0; c < per; c++) body += pebble(pad + DOT / 2 + c * DOT, y, R, r % 2 ? T.gold : T.sea);
    }
    return svg(w, h, body);
  }

  /* a number track; each jump carries its own label */
  function track(values, steps) {
    var n = values.length, step = n > 5 ? 64 : 74, r = n > 5 ? 18 : 20;
    var pad = 22, w = n * step, h = 96, y = 46, span = (w - pad * 2) / (n - 1);
    var body = '<path d="M' + pad + ' ' + y + ' H' + (w - pad) + '" stroke="' + T.line + '" stroke-width="3" stroke-linecap="round"/>';
    values.forEach(function (v, i) {
      var x = pad + i * span, q = v === '?';
      body += '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + (q ? T.gold : T.card) + '" stroke="' + (q ? T.gold : T.sea) + '" stroke-width="3"/>';
      body += txt(x, y + 7, v, { size: n > 5 ? 17 : 19, fill: q ? T.onGold : T.ink });
      if (i < n - 1) {
        var mid = x + span / 2;
        body += txt(mid, y - 30, steps[i], { size: 13, mono: true, weight: 400, fill: T.soft });
        body += '<path d="M' + (x + r + 4) + ' ' + (y - 18) + ' Q' + mid + ' ' + (y - 42) + ' ' + (x + span - r - 4) + ' ' + (y - 18) + '" fill="none" stroke="' + T.line + '" stroke-width="2"/>';
      }
    });
    return svg(w, h, body);
  }

  /* a pizza cut into equal slices, some eaten */
  function slices(parts, eaten) {
    var w = 210, h = 196, cx = 105, cy = 98, r = 80;
    var body = '<circle cx="' + cx + '" cy="' + cy + '" r="' + (r + 5) + '" fill="none" stroke="' + T.lineSoft + '" stroke-width="2" stroke-dasharray="6 7"/>';
    for (var i = 0; i < parts; i++) {
      var a1 = (i / parts) * Math.PI * 2 - Math.PI / 2, a2 = ((i + 1) / parts) * Math.PI * 2 - Math.PI / 2;
      var x1 = (cx + r * Math.cos(a1)).toFixed(1), y1 = (cy + r * Math.sin(a1)).toFixed(1);
      var x2 = (cx + r * Math.cos(a2)).toFixed(1), y2 = (cy + r * Math.sin(a2)).toFixed(1);
      var on = i < parts - eaten;
      body += '<path d="M' + cx + ' ' + cy + ' L' + x1 + ' ' + y1 + ' A' + r + ' ' + r + ' 0 0 1 ' + x2 + ' ' + y2 + ' Z" fill="' + (on ? T.gold : 'none') +
        '" stroke="' + (on ? T.red : T.line) + '" stroke-width="3" stroke-linejoin="round"' + (on ? '' : ' stroke-dasharray="8 7"') + '/>';
      if (on) {
        var am = (a1 + a2) / 2;
        body += '<circle cx="' + (cx + r * 0.55 * Math.cos(am)).toFixed(1) + '" cy="' + (cy + r * 0.55 * Math.sin(am)).toFixed(1) + '" r="7" fill="' + T.red + '"/>';
      }
    }
    return svg(w, h, body);
  }

  /* named flat shapes, drawn to the same size so sides are what differs */
  function shapePath(name, cx, cy, r) {
    var pts = [], i;
    if (name === 'circle') return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + T.sea + '" stroke="' + T.ink + '" stroke-width="3"/>';
    if (name === 'oval') return '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + r * 1.25 + '" ry="' + r * 0.78 + '" fill="' + T.sea + '" stroke="' + T.ink + '" stroke-width="3"/>';
    if (name === 'rectangle') return '<rect x="' + (cx - r * 1.3) + '" y="' + (cy - r * 0.72) + '" width="' + r * 2.6 + '" height="' + r * 1.44 + '" rx="4" fill="' + T.sea + '" stroke="' + T.ink + '" stroke-width="3"/>';
    if (name === 'square') return '<rect x="' + (cx - r * 0.92) + '" y="' + (cy - r * 0.92) + '" width="' + r * 1.84 + '" height="' + r * 1.84 + '" rx="4" fill="' + T.sea + '" stroke="' + T.ink + '" stroke-width="3"/>';
    var sides = { triangle: 3, pentagon: 5, hexagon: 6, octagon: 8 }[name] || 5;
    for (i = 0; i < sides; i++) {
      var a = (i / sides) * Math.PI * 2 - Math.PI / 2;
      pts.push([(cx + r * Math.cos(a)).toFixed(1), (cy + r * Math.sin(a)).toFixed(1)]);
    }
    return poly(pts, T.sea, T.ink, 3);
  }
  function shapes(names) {
    var r = 42, gap = 26, w = names.length * (r * 2.7) + gap, h = r * 2.6, body = '';
    var stepX = w / names.length;
    names.forEach(function (n, i) { body += shapePath(n, stepX * (i + 0.5), h / 2, r); });
    return svg(w, h, body);
  }

  /* an analogue clock */
  function clock(hh, mm) {
    var w = 190, h = 190, cx = 95, cy = 95, r = 78, body = '';
    body += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (r + 6) + '" fill="' + T.card2 + '" stroke="' + T.line + '" stroke-width="3"/>';
    body += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + T.card + '" stroke="' + T.sea + '" stroke-width="3"/>';
    for (var i = 0; i < 12; i++) {
      var a = (i / 12) * Math.PI * 2 - Math.PI / 2;
      var big = i % 3 === 0;
      body += '<circle cx="' + (cx + (r - 12) * Math.cos(a)).toFixed(1) + '" cy="' + (cy + (r - 12) * Math.sin(a)).toFixed(1) + '" r="' + (big ? 4 : 2.5) + '" fill="' + (big ? T.sea : T.line) + '"/>';
      if (big) {
        body += txt(cx + (r - 30) * Math.cos(a), cy + (r - 30) * Math.sin(a) + 6, [12, 3, 6, 9][i / 3], { size: 17, fill: T.ink });
      }
    }
    var ma = (mm / 60) * Math.PI * 2 - Math.PI / 2, ha = (((hh % 12) + mm / 60) / 12) * Math.PI * 2 - Math.PI / 2;
    body += '<path d="M' + cx + ' ' + cy + ' L' + (cx + 40 * Math.cos(ha)).toFixed(1) + ' ' + (cy + 40 * Math.sin(ha)).toFixed(1) + '" stroke="' + T.ink + '" stroke-width="7" stroke-linecap="round"/>';
    body += '<path d="M' + cx + ' ' + cy + ' L' + (cx + 58 * Math.cos(ma)).toFixed(1) + ' ' + (cy + 58 * Math.sin(ma)).toFixed(1) + '" stroke="' + T.red + '" stroke-width="5" stroke-linecap="round"/>';
    body += '<circle cx="' + cx + '" cy="' + cy + '" r="6" fill="' + T.ink + '"/>';
    return svg(w, h, body);
  }

  /* coins, each stamped with what it is worth */
  function coins(values) {
    var r = 28, gap = 12, w = values.length * (r * 2 + gap) + gap, h = r * 2 + 30, body = '';
    values.forEach(function (v, i) {
      var cx = gap + r + i * (r * 2 + gap), cy = r + 12;
      body += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + T.gold + '"/>';
      body += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (r - 5) + '" fill="none" stroke="' + T.onGold + '" stroke-width="2" opacity=".45"/>';
      body += txt(cx, cy + 8, v, { size: 22, fill: T.onGold });
    });
    return svg(w, h, body);
  }

  /* a repeating pattern with the next one missing */
  function pattern(seq) {
    var cell = 58, w = seq.length * cell, h = 78, body = '';
    seq.forEach(function (name, i) {
      var cx = cell / 2 + i * cell, cy = 39;
      if (name === '?') {
        body += '<rect x="' + (cx - 24) + '" y="' + (cy - 24) + '" width="48" height="48" rx="10" fill="' + T.gold + '"/>';
        body += txt(cx, cy + 9, '?', { size: 26, fill: T.onGold });
      } else {
        body += shapePath(name, cx, cy, 22);
      }
    });
    return svg(w, h, body);
  }

  /* a pictogram - one icon per thing counted */
  function picto(rows) {
    var lw = 74, cell = 30, w = lw + Math.max.apply(null, rows.map(function (r) { return r.n; })) * cell + 16;
    var h = rows.length * 42 + 12, body = '';
    rows.forEach(function (row, i) {
      var y = 32 + i * 42;
      body += txt(lw - 12, y + 6, row.label, { anchor: 'end', size: 15, fill: T.soft, weight: 500 });
      for (var k = 0; k < row.n; k++) {
        body += pebble(lw + cell / 2 + k * cell, y, 12, [T.sea, T.gold, T.red, T.moss][i % 4]);
      }
    });
    return svg(w, h, body);
  }

  /* dice, for totals and doubles */
  function dice(values) {
    var s = 76, gap = 22, w = values.length * s + (values.length - 1) * gap + 16, h = s + 16, body = '';
    var spots = { 1: [[.5, .5]], 2: [[.27, .27], [.73, .73]], 3: [[.27, .27], [.5, .5], [.73, .73]],
      4: [[.27, .27], [.73, .27], [.27, .73], [.73, .73]],
      5: [[.27, .27], [.73, .27], [.5, .5], [.27, .73], [.73, .73]],
      6: [[.27, .25], [.73, .25], [.27, .5], [.73, .5], [.27, .75], [.73, .75]] };
    values.forEach(function (v, i) {
      var x = 8 + i * (s + gap), y = 8;
      body += '<rect x="' + x + '" y="' + y + '" width="' + s + '" height="' + s + '" rx="14" fill="' + T.card + '" stroke="' + T.sea + '" stroke-width="3"/>';
      if (v === '?') {
        body += txt(x + s / 2, y + s / 2 + 12, '?', { size: 36, fill: T.gold });
      } else {
        (spots[v] || []).forEach(function (p) {
          body += '<circle cx="' + (x + p[0] * s) + '" cy="' + (y + p[1] * s) + '" r="7" fill="' + T.red + '"/>';
        });
      }
    });
    return svg(w, h, body);
  }

  /* a ruler with something laid along it */
  function ruler(len, upto) {
    var unit = 28, pad = 18, w = len * unit + pad * 2, h = 116;
    var y = 60, body = '';
    body += '<rect x="' + pad + '" y="' + y + '" width="' + (len * unit) + '" height="40" rx="5" fill="' + T.card2 + '" stroke="' + T.line + '" stroke-width="2"/>';
    for (var i = 0; i <= len; i++) {
      var x = pad + i * unit;
      body += '<path d="M' + x + ' ' + y + ' V' + (y + (i % 5 === 0 ? 16 : 10)) + '" stroke="' + T.soft + '" stroke-width="2"/>';
      if (i % 5 === 0) body += txt(x, y + 33, i, { size: 13, mono: true, weight: 400, fill: T.soft });
    }
    body += '<rect x="' + pad + '" y="' + (y - 34) + '" width="' + (upto * unit) + '" height="22" rx="11" fill="' + T.moss + '"/>';
    body += '<path d="M' + (pad + upto * unit) + ' ' + (y - 23) + ' l-14 -11 v22 Z" fill="' + T.gold + '"/>';
    return svg(w, h, body);
  }

  /* bar model: one bar longer than the other by a known amount */
  function bars(diff, total) {
    var w = 330, h = 132, x = 26, bar = 26, short = 130;
    var body = '<rect x="' + x + '" y="30" width="' + short + '" height="' + bar + '" rx="6" fill="' + T.sea + '"/>';
    body += '<rect x="' + x + '" y="74" width="' + short + '" height="' + bar + '" rx="6" fill="' + T.sea + '"/>';
    body += '<rect x="' + (x + short + 4) + '" y="74" width="60" height="' + bar + '" rx="6" fill="' + T.gold + '"/>';
    body += txt(x + short + 34, 92, diff, { size: 16, fill: T.onGold });
    var bx = x + short + 78;
    body += '<path d="M' + bx + ' 30 H' + (bx + 10) + ' V' + (74 + bar) + ' H' + bx + '" fill="none" stroke="' + T.line + '" stroke-width="2"/>';
    body += txt(bx + 16, 74, 'both = ' + total, { anchor: 'start', size: 13, mono: true, weight: 400, fill: T.soft });
    return svg(w, h, body);
  }

  /* a balance scale that is level */
  function scale(big, small) {
    var w = 320, h = 182, beamY = 116, body = '';
    for (var i = 0; i < big; i++) {
      var cx = 62 + i * 46;
      body += '<circle cx="' + cx + '" cy="' + (beamY - 24) + '" r="19" fill="' + T.red + '"/>';
      body += '<ellipse cx="' + (cx - 6) + '" cy="' + (beamY - 31) + '" rx="6" ry="4" fill="#ffffff" opacity=".33"/>';
      body += '<path d="M' + cx + ' ' + (beamY - 42) + ' q6 -10 14 -12" fill="none" stroke="' + T.moss + '" stroke-width="3.5" stroke-linecap="round"/>';
    }
    for (var j = 0; j < small; j++) {
      body += pebble(205 + (j % 3) * 40, beamY - 44 + Math.floor(j / 3) * 34, 13, T.sea);
    }
    body += '<path d="M20 ' + beamY + ' H300" stroke="' + T.soft + '" stroke-width="7" stroke-linecap="round"/>';
    body += poly([[160, beamY], [134, 172], [186, 172]], T.soft);
    body += '<path d="M104 172 H216" stroke="' + T.soft + '" stroke-width="5" stroke-linecap="round"/>';
    return svg(w, h, body);
  }

  /* a plain grid - the counting is the puzzle */
  function grid(n) {
    var cell = 60, pad = 12, side = n * cell, w = side + pad * 2, h = side + pad * 2;
    var body = '<rect x="' + pad + '" y="' + pad + '" width="' + side + '" height="' + side + '" rx="4" fill="' + T.card + '" stroke="' + T.sea + '" stroke-width="3"/>';
    for (var i = 1; i < n; i++) {
      body += '<path d="M' + (pad + i * cell) + ' ' + pad + ' V' + (pad + side) + '" stroke="' + T.sea + '" stroke-width="3"/>';
      body += '<path d="M' + pad + ' ' + (pad + i * cell) + ' H' + (pad + side) + '" stroke="' + T.sea + '" stroke-width="3"/>';
    }
    return svg(w, h, body);
  }

  /* one uncut rope and the goal written underneath */
  function rope(pieces) {
    var w = 320, h = 126, y = 48, x1 = 24, x2 = 296;
    var body = '<path d="M' + x1 + ' ' + y + ' H' + x2 + '" stroke="' + T.sea + '" stroke-width="15" stroke-linecap="round"/>';
    for (var i = 1; i < 12; i++) {
      body += '<path d="M' + (x1 + i * 22) + ' ' + (y - 7) + ' l8 14" stroke="' + T.card2 + '" stroke-width="2.5" opacity=".55"/>';
    }
    body += '<path d="M' + x1 + ' ' + (y + 24) + ' V' + (y + 32) + ' H' + x2 + ' V' + (y + 24) + '" fill="none" stroke="' + T.line + '" stroke-width="2"/>';
    body += '<path d="M' + ((x1 + x2) / 2) + ' ' + (y + 32) + ' V' + (y + 42) + '" stroke="' + T.line + '" stroke-width="2"/>';
    body += txt((x1 + x2) / 2, y + 60, 'into ' + pieces + ' pieces', { size: 13, mono: true, weight: 400, fill: T.soft });
    return svg(w, h, body);
  }

  /* a ring of friends, with one example link drawn */
  function friends(n) {
    var w = 270, h = 190, cx = 135, cy = 92, rad = 62, pts = [], body = '';
    for (var i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2 - Math.PI / 2;
      pts.push([cx + rad * Math.cos(a), cy + rad * Math.sin(a) * 0.86]);
    }
    body += '<path d="M' + pts[0][0].toFixed(1) + ' ' + pts[0][1].toFixed(1) + ' L' + pts[1][0].toFixed(1) + ' ' + pts[1][1].toFixed(1) + '" stroke="' + T.gold + '" stroke-width="3" stroke-dasharray="7 6"/>';
    pts.forEach(function (p, i) {
      var c = [T.sea, T.gold, T.red, T.moss, T.sea][i % 5];
      body += '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="23" fill="' + c + '"/>';
      body += '<circle cx="' + (p[0] - 7).toFixed(1) + '" cy="' + (p[1] - 4).toFixed(1) + '" r="3" fill="' + T.card + '"/>';
      body += '<circle cx="' + (p[0] + 7).toFixed(1) + '" cy="' + (p[1] - 4).toFixed(1) + '" r="3" fill="' + T.card + '"/>';
      body += '<path d="M' + (p[0] - 8).toFixed(1) + ' ' + (p[1] + 7).toFixed(1) + ' q8 8 16 0" fill="none" stroke="' + T.card + '" stroke-width="2.5" stroke-linecap="round"/>';
    });
    body += txt(cx, cy - rad * 0.86 - 30, 'one handshake', { size: 12, mono: true, weight: 400, fill: T.gold });
    return svg(w, h, body);
  }

  global.DIAGRAMS = {
    groups: groups, frame: frame, array: array, takeaway: takeaway, share: share, track: track,
    slices: slices, shapes: shapes, clock: clock, coins: coins, pattern: pattern, picto: picto,
    dice: dice, ruler: ruler, bars: bars, scale: scale, grid: grid, rope: rope, friends: friends
  };
  global.ARTKIT = { svg: svg, txt: txt, pebble: pebble, poly: poly, T: T, nextId: function () { return ++uid; } };
})(window);

/* ---------------------------------------------------------------
   Postcards: places, flags, animals. Drawn on a fixed light panel
   with their own palette, so a camel stays sand-coloured whatever
   theme the page is in.
   --------------------------------------------------------------- */
(function (global) {
  'use strict';
  var K = global.ARTKIT, svg = K.svg, txt = K.txt, poly = K.poly;

  var P = {
    sky: '#CDE6F0', skyWarm: '#F7E1B9', skyDusk: '#F1D3B0', skyLeaf: '#DEEBD8',
    grass: '#AFCF8E', sand: '#E6CD98', snow: '#EFF7FA', water: '#8FC8DD',
    stone: '#E3D9C6', dark: '#33505E', white: '#FFFFFF', gold: '#E9A82C',
    red: '#CE4B3C', green: '#4E8B5B', brown: '#A9714A', camel: '#C08A4E',
    frame: '#CDBE9B', paper: '#FFFDF7'
  };

  function scene(body, o) {
    o = o || {};
    var w = o.w || 300, h = o.h || 200, id = 'sc' + K.nextId();
    var s = '<defs><clipPath id="' + id + '"><rect x="4" y="4" width="' + (w - 8) + '" height="' + (h - 8) + '" rx="11"/></clipPath></defs>';
    s += '<rect x="0" y="0" width="' + w + '" height="' + h + '" rx="15" fill="' + P.paper + '" stroke="' + P.frame + '" stroke-width="2"/>';
    s += '<g clip-path="url(#' + id + ')">';
    s += '<rect x="4" y="4" width="' + (w - 8) + '" height="' + (h - 8) + '" fill="' + (o.sky || P.sky) + '"/>';
    if (o.ground) s += '<rect x="4" y="' + (h - 4 - (o.gh || 40)) + '" width="' + (w - 8) + '" height="' + (o.gh || 40) + '" fill="' + o.ground + '"/>';
    s += body + '</g>';
    return svg(w, h, s);
  }
  function cloud(x, y, s) {
    return '<g opacity=".85"><ellipse cx="' + x + '" cy="' + y + '" rx="' + 22 * s + '" ry="' + 12 * s + '" fill="#fff"/>' +
      '<ellipse cx="' + (x + 16 * s) + '" cy="' + (y + 3 * s) + '" rx="' + 15 * s + '" ry="' + 9 * s + '" fill="#fff"/>' +
      '<ellipse cx="' + (x - 15 * s) + '" cy="' + (y + 4 * s) + '" rx="' + 13 * s + '" ry="' + 8 * s + '" fill="#fff"/></g>';
  }
  function sun(x, y, r) {
    return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="#F4C64E"/>' +
      '<circle cx="' + x + '" cy="' + y + '" r="' + (r + 8) + '" fill="#F4C64E" opacity=".22"/>';
  }

  /* ---------- famous places ---------- */
  var PLACES = {
    eiffel: function () {
      var b = cloud(58, 42, .9) + cloud(246, 32, .7);
      b += '<path d="M150 26 V12" stroke="#6E5B4B" stroke-width="3"/>';
      b += '<path d="M116 163 L131 96 L139 62 L146 36 L150 26 L154 36 L161 62 L169 96 L184 163 L170 163 L159 118 L141 118 L130 163 Z" fill="#7A6552"/>';
      b += '<rect x="126" y="112" width="48" height="8" rx="2" fill="#6E5B4B"/>';
      b += '<rect x="133" y="86" width="34" height="7" rx="2" fill="#6E5B4B"/>';
      b += '<path d="M133 163 q17 -30 34 0 Z" fill="' + P.grass + '"/>';
      b += '<path d="M30 163 q20 -14 40 0" stroke="' + P.green + '" stroke-width="3" fill="none"/>';
      return scene(b, { sky: P.sky, ground: P.grass, gh: 37 });
    },
    pyramids: function () {
      var b = sun(248, 44, 20);
      b += poly([[46, 155], [112, 54], [178, 155]], '#D9B36C');
      b += poly([[112, 54], [178, 155], [112, 155]], '#C29A55');
      b += poly([[160, 155], [204, 88], [248, 155]], '#D9B36C');
      b += poly([[204, 88], [248, 155], [204, 155]], '#C29A55');
      b += '<path d="M20 172 q26 -8 52 0 M110 182 q26 -8 52 0 M200 170 q26 -8 52 0" stroke="#D6BC86" stroke-width="3" fill="none" stroke-linecap="round"/>';
      return scene(b, { sky: P.skyWarm, ground: P.sand, gh: 45 });
    },
    bigben: function () {
      var b = cloud(60, 38, .8);
      b += poly([[124, 56], [150, 14], [176, 56]], '#8C6E4E');
      b += '<rect x="126" y="56" width="48" height="110" fill="#C9A87C"/>';
      b += '<rect x="126" y="56" width="48" height="110" fill="none" stroke="#A98A62" stroke-width="2"/>';
      b += '<circle cx="150" cy="86" r="19" fill="#FBF6E7" stroke="#8C6E4E" stroke-width="3"/>';
      b += '<path d="M150 86 V74 M150 86 L159 92" stroke="#33505E" stroke-width="3" stroke-linecap="round"/>';
      b += '<rect x="134" y="116" width="10" height="18" rx="5" fill="#A98A62"/><rect x="156" y="116" width="10" height="18" rx="5" fill="#A98A62"/>';
      b += '<rect x="134" y="140" width="10" height="18" rx="5" fill="#A98A62"/><rect x="156" y="140" width="10" height="18" rx="5" fill="#A98A62"/>';
      b += '<rect x="20" y="150" width="60" height="16" rx="4" fill="#B9A98A"/><rect x="220" y="144" width="62" height="22" rx="4" fill="#B9A98A"/>';
      return scene(b, { sky: P.sky, ground: '#9FB394', gh: 34 });
    },
    taj: function () {
      var b = cloud(56, 36, .7);
      b += '<rect x="64" y="104" width="14" height="62" rx="4" fill="#F2EDE1" stroke="#DCD3C0" stroke-width="1.5"/>';
      b += '<rect x="222" y="104" width="14" height="62" rx="4" fill="#F2EDE1" stroke="#DCD3C0" stroke-width="1.5"/>';
      b += '<circle cx="71" cy="100" r="9" fill="#F2EDE1"/><circle cx="229" cy="100" r="9" fill="#F2EDE1"/>';
      b += '<rect x="92" y="118" width="116" height="48" rx="4" fill="#F7F3E9" stroke="#DCD3C0" stroke-width="2"/>';
      b += '<path d="M108 120 a42 42 0 0 1 84 0 Z" fill="#F7F3E9" stroke="#DCD3C0" stroke-width="2"/>';
      b += '<path d="M150 78 V64" stroke="#D9C89F" stroke-width="3"/><circle cx="150" cy="61" r="4" fill="#D9C89F"/>';
      b += '<path d="M136 166 v-24 a14 14 0 0 1 28 0 v24 Z" fill="#DCD3C0"/>';
      b += '<rect x="4" y="170" width="292" height="26" fill="#BBD9E4"/>';
      return scene(b, { sky: '#DCE9F3', ground: '#E6E0D2', gh: 34 });
    },
    opera: function () {
      var b = cloud(240, 34, .8);
      var sh = function (x, s, f) { return '<path d="M' + (x - 46 * s) + ' 152 Q' + (x - 10 * s) + ' ' + (152 - 100 * s) + ' ' + (x + 30 * s) + ' 152 Z" fill="' + f + '" stroke="#D9D2C2" stroke-width="2"/>'; };
      b += sh(96, .72, '#F4F1E8') + sh(134, .92, '#FBF8F0') + sh(184, 1.05, '#F4F1E8') + sh(226, .66, '#FBF8F0');
      b += '<rect x="44" y="150" width="220" height="12" rx="4" fill="#E0D9C7"/>';
      b += '<path d="M4 176 q40 -8 80 0 t80 0 t80 0 t60 0" stroke="#79B7CF" stroke-width="3" fill="none"/>';
      return scene(b, { sky: P.sky, ground: P.water, gh: 38 });
    },
    colosseum: function () {
      var b = sun(46, 40, 16), i;
      b += '<path d="M74 166 v-74 a76 40 0 0 1 152 0 v74 Z" fill="#E2D2AC" stroke="#C2AD80" stroke-width="2"/>';
      for (i = 0; i < 5; i++) {
        b += '<path d="M' + (88 + i * 28) + ' 120 v-18 a9 9 0 0 1 18 0 v18 Z" fill="#B99B6E"/>';
        b += '<path d="M' + (88 + i * 28) + ' 160 v-18 a9 9 0 0 1 18 0 v18 Z" fill="#B99B6E"/>';
      }
      b += '<path d="M74 130 H226" stroke="#C2AD80" stroke-width="2"/>';
      return scene(b, { sky: P.skyDusk, ground: '#D8CBA8', gh: 36 });
    },
    liberty: function () {
      var b = cloud(52, 34, .7), i;
      b += '<rect x="110" y="162" width="80" height="34" rx="4" fill="#B8A98C"/>';
      b += '<rect x="110" y="162" width="80" height="7" rx="3" fill="#A2947A"/>';
      b += '<path d="M126 164 L142 80 L160 80 L176 164 Z" fill="#8CC3B2"/>';
      b += '<path d="M138 110 L124 120 L128 138 L136 130 Z" fill="#7AB3A2"/>';
      b += '<path d="M152 94 L190 50" stroke="#8CC3B2" stroke-width="11" stroke-linecap="round"/>';
      b += '<rect x="184" y="30" width="13" height="17" rx="3" fill="#B8A98C"/>';
      b += '<circle cx="190" cy="24" r="10" fill="#F4C64E"/><circle cx="190" cy="20" r="5" fill="#FBE7A6"/>';
      b += '<rect x="144" y="72" width="14" height="10" fill="#8CC3B2"/>';
      b += '<circle cx="151" cy="62" r="14" fill="#8CC3B2"/>';
      for (i = 0; i < 7; i++) {
        var a = -1.25 + i * 0.42;
        b += poly([[151 + 26 * Math.sin(a), 62 - 26 * Math.cos(a)], [151 + 13 * Math.sin(a - .17), 62 - 13 * Math.cos(a - .17)], [151 + 13 * Math.sin(a + .17), 62 - 13 * Math.cos(a + .17)]], '#8CC3B2');
      }
      b += '<circle cx="146" cy="60" r="2.4" fill="#43705F"/><circle cx="156" cy="60" r="2.4" fill="#43705F"/>';
      return scene(b, { w: 300, h: 200, sky: P.sky, ground: P.water, gh: 30 });
    },
    wall: function () {
      var b = '<path d="M4 150 q60 -40 120 -10 t100 -20 t72 -6 V196 H4 Z" fill="#9BB77E"/>';
      b += '<path d="M10 140 q56 -34 112 -8 t96 -22 t72 -8" stroke="#D6CBB0" stroke-width="15" fill="none" stroke-linecap="round"/>';
      b += '<path d="M10 140 q56 -34 112 -8 t96 -22 t72 -8" stroke="#B9AC8C" stroke-width="3" fill="none"/>';
      b += '<rect x="88" y="96" width="22" height="30" rx="3" fill="#D6CBB0" stroke="#B9AC8C" stroke-width="2"/>';
      b += '<rect x="206" y="72" width="22" height="30" rx="3" fill="#D6CBB0" stroke="#B9AC8C" stroke-width="2"/>';
      return scene(b, { sky: '#D7E9EE' });
    }
  };
  function landmark(name) { return (PLACES[name] || PLACES.eiffel)(); }

  /* ---------- animals ---------- */
  var BEASTS = {
    penguin: function () {
      var b = '<ellipse cx="60" cy="150" rx="54" ry="14" fill="#DCEDF2"/>';
      b += '<ellipse cx="86" cy="104" rx="15" ry="32" fill="#2F4A58" transform="rotate(14 86 104)"/>';
      b += '<ellipse cx="154" cy="104" rx="15" ry="32" fill="#2F4A58" transform="rotate(-14 154 104)"/>';
      b += '<ellipse cx="120" cy="150" rx="13" ry="7" fill="#E9A82C"/><ellipse cx="146" cy="150" rx="13" ry="7" fill="#E9A82C"/>';
      b += '<ellipse cx="120" cy="98" rx="44" ry="54" fill="#33505E"/>';
      b += '<ellipse cx="120" cy="108" rx="30" ry="42" fill="#FBF7EC"/>';
      b += '<circle cx="120" cy="48" r="30" fill="#33505E"/>';
      b += '<circle cx="110" cy="44" r="6" fill="#fff"/><circle cx="132" cy="44" r="6" fill="#fff"/>';
      b += '<circle cx="111" cy="45" r="3" fill="#22333D"/><circle cx="131" cy="45" r="3" fill="#22333D"/>';
      b += poly([[120, 52], [134, 60], [120, 66]], '#E9A82C');
      return scene(b, { w: 240, h: 180, sky: P.sky, ground: P.snow, gh: 44 });
    },
    camel: function () {
      var b = sun(46, 40, 17);
      b += '<rect x="86" y="112" width="12" height="42" rx="5" fill="#A9714A"/><rect x="110" y="112" width="12" height="42" rx="5" fill="#A9714A"/>';
      b += '<rect x="146" y="112" width="12" height="42" rx="5" fill="#B77E52"/><rect x="170" y="112" width="12" height="42" rx="5" fill="#B77E52"/>';
      b += '<ellipse cx="126" cy="108" rx="56" ry="26" fill="' + P.camel + '"/>';
      b += '<path d="M88 96 q18 -36 38 -4 Z" fill="' + P.camel + '"/>';
      b += '<path d="M128 92 q18 -34 36 2 Z" fill="' + P.camel + '"/>';
      b += '<path d="M170 102 Q196 96 202 60" stroke="' + P.camel + '" stroke-width="17" fill="none" stroke-linecap="round"/>';
      b += '<ellipse cx="208" cy="50" rx="19" ry="12" fill="' + P.camel + '" transform="rotate(-16 208 50)"/>';
      b += '<path d="M198 40 q-3 -11 6 -11" stroke="' + P.camel + '" stroke-width="6" fill="none" stroke-linecap="round"/>';
      b += '<circle cx="206" cy="44" r="3" fill="#5E4128"/>';
      b += '<path d="M222 54 q4 4 2 8" stroke="#8E5330" stroke-width="3" fill="none" stroke-linecap="round"/>';
      b += '<path d="M72 108 q-14 6 -18 22" stroke="#A9714A" stroke-width="5" fill="none" stroke-linecap="round"/>';
      return scene(b, { w: 240, h: 180, sky: P.skyWarm, ground: P.sand, gh: 40 });
    },
    panda: function () {
      var b = '<rect x="16" y="60" width="12" height="100" rx="6" fill="#7FA968"/><rect x="212" y="48" width="12" height="112" rx="6" fill="#7FA968"/>';
      b += '<path d="M28 82 q22 -12 30 4 M212 70 q-22 -12 -30 4" stroke="#7FA968" stroke-width="7" fill="none" stroke-linecap="round"/>';
      b += '<ellipse cx="86" cy="140" rx="18" ry="13" fill="#3A3A3A"/><ellipse cx="154" cy="140" rx="18" ry="13" fill="#3A3A3A"/>';
      b += '<circle cx="120" cy="108" r="43" fill="#FBF7EC"/>';
      b += '<ellipse cx="80" cy="100" rx="13" ry="22" fill="#3A3A3A" transform="rotate(18 80 100)"/>';
      b += '<ellipse cx="160" cy="100" rx="13" ry="22" fill="#3A3A3A" transform="rotate(-18 160 100)"/>';
      b += '<circle cx="98" cy="42" r="12" fill="#3A3A3A"/><circle cx="142" cy="42" r="12" fill="#3A3A3A"/>';
      b += '<circle cx="120" cy="60" r="32" fill="#FBF7EC"/>';
      b += '<ellipse cx="108" cy="56" rx="9" ry="11" fill="#3A3A3A" transform="rotate(-16 108 56)"/>';
      b += '<ellipse cx="132" cy="56" rx="9" ry="11" fill="#3A3A3A" transform="rotate(16 132 56)"/>';
      b += '<circle cx="109" cy="56" r="3.4" fill="#fff"/><circle cx="131" cy="56" r="3.4" fill="#fff"/>';
      b += '<ellipse cx="120" cy="70" rx="6" ry="4.5" fill="#3A3A3A"/>';
      b += '<path d="M120 75 q-7 7 -13 2 M120 75 q7 7 13 2" stroke="#3A3A3A" stroke-width="2.5" fill="none" stroke-linecap="round"/>';
      return scene(b, { w: 240, h: 180, sky: P.skyLeaf, ground: '#B6CE97', gh: 36 });
    },
    kangaroo: function () {
      var b = sun(44, 40, 15);
      b += '<path d="M100 126 Q56 128 30 150" stroke="#A9633A" stroke-width="15" fill="none" stroke-linecap="round"/>';
      b += '<ellipse cx="122" cy="134" rx="36" ry="16" fill="#A9633A"/>';
      b += '<ellipse cx="120" cy="104" rx="34" ry="30" fill="#B4713E"/>';
      b += '<ellipse cx="150" cy="74" rx="15" ry="24" fill="#B4713E" transform="rotate(24 150 74)"/>';
      b += '<ellipse cx="168" cy="52" rx="20" ry="13" fill="#B4713E" transform="rotate(-14 168 52)"/>';
      b += '<ellipse cx="158" cy="32" rx="6" ry="12" fill="#B4713E" transform="rotate(-16 158 32)"/>';
      b += '<ellipse cx="172" cy="30" rx="6" ry="12" fill="#B4713E" transform="rotate(-4 172 30)"/>';
      b += '<circle cx="176" cy="48" r="3.2" fill="#4A2C15"/>';
      b += '<path d="M140 118 q10 10 4 22" stroke="#A9633A" stroke-width="7" fill="none" stroke-linecap="round"/>';
      b += '<path d="M104 148 q22 8 42 -2" stroke="#8E5330" stroke-width="4" fill="none" stroke-linecap="round"/>';
      return scene(b, { w: 240, h: 180, sky: '#F3D9B8', ground: '#D9A06B', gh: 38 });
    },
    polarbear: function () {
      var b = '<ellipse cx="120" cy="152" rx="70" ry="14" fill="#DCEDF2"/>';
      b += '<rect x="78" y="120" width="20" height="30" rx="9" fill="#F2E6D2"/><rect x="140" y="120" width="20" height="30" rx="9" fill="#F2E6D2"/>';
      b += '<ellipse cx="114" cy="108" rx="56" ry="34" fill="#FBF3E4"/>';
      b += '<circle cx="176" cy="86" r="25" fill="#FBF3E4"/>';
      b += '<circle cx="164" cy="62" r="8" fill="#F2E6D2"/><circle cx="190" cy="62" r="8" fill="#F2E6D2"/>';
      b += '<ellipse cx="192" cy="94" rx="14" ry="11" fill="#F2E6D2"/>';
      b += '<ellipse cx="199" cy="92" rx="5" ry="4" fill="#4A4038"/>';
      b += '<circle cx="172" cy="82" r="3.2" fill="#4A4038"/><circle cx="188" cy="80" r="3.2" fill="#4A4038"/>';
      return scene(b, { w: 240, h: 180, sky: P.sky, ground: P.snow, gh: 46 });
    },
    elephant: function () {
      var b = '<rect x="80" y="120" width="22" height="34" rx="8" fill="#8A949D"/><rect x="112" y="120" width="22" height="34" rx="8" fill="#8A949D"/>';
      b += '<rect x="146" y="122" width="20" height="32" rx="8" fill="#7E8892"/>';
      b += '<ellipse cx="112" cy="104" rx="54" ry="36" fill="#9AA4AD"/>';
      b += '<path d="M58 92 q-16 8 -10 26" stroke="#8A949D" stroke-width="6" fill="none" stroke-linecap="round"/>';
      b += '<circle cx="172" cy="92" r="31" fill="#9AA4AD"/>';
      b += '<ellipse cx="160" cy="90" rx="22" ry="27" fill="#8A949D"/>';
      b += '<path d="M188 104 q14 20 4 44" stroke="#9AA4AD" stroke-width="15" fill="none" stroke-linecap="round"/>';
      b += '<path d="M182 112 q6 12 0 20 M198 110 q8 10 4 20" stroke="#FBF7EC" stroke-width="5" fill="none" stroke-linecap="round"/>';
      b += '<circle cx="182" cy="84" r="3.4" fill="#4A4F55"/>';
      return scene(b, { w: 240, h: 180, sky: '#E9E7D2', ground: '#C4CE95', gh: 38 });
    }
  };
  function animal(name) { return (BEASTS[name] || BEASTS.penguin)(); }

  /* ---------- flags, from a small spec ---------- */
  function flag(spec) {
    var w = 210, h = 142, fw = 190, fh = 122, x = 10, y = 10, i;
    var id = 'fl' + K.nextId();
    var b = '<defs><clipPath id="' + id + '"><rect x="' + x + '" y="' + y + '" width="' + fw + '" height="' + fh + '" rx="5"/></clipPath></defs>';
    b += '<g clip-path="url(#' + id + ')">';
    b += '<rect x="' + x + '" y="' + y + '" width="' + fw + '" height="' + fh + '" fill="' + (spec.bg || '#fff') + '"/>';
    if (spec.v) {
      var vw = spec.w || spec.v.map(function () { return 1 / spec.v.length; });
      var vx = x;
      for (i = 0; i < spec.v.length; i++) { b += '<rect x="' + vx + '" y="' + y + '" width="' + (fw * vw[i] + 1) + '" height="' + fh + '" fill="' + spec.v[i] + '"/>'; vx += fw * vw[i]; }
    }
    if (spec.h) {
      var hh = spec.w || spec.h.map(function () { return 1 / spec.h.length; }), hy = y;
      for (i = 0; i < spec.h.length; i++) { b += '<rect x="' + x + '" y="' + hy + '" width="' + fw + '" height="' + (fh * hh[i] + 1) + '" fill="' + spec.h[i] + '"/>'; hy += fh * hh[i]; }
    }
    if (spec.cross) {
      var t = fh * (spec.cross.t || .18);
      b += '<rect x="' + (x + fw / 2 - t / 2) + '" y="' + (y + fh * .16) + '" width="' + t + '" height="' + fh * .68 + '" fill="' + spec.cross.fill + '"/>';
      b += '<rect x="' + (x + fw / 2 - fw * .22) + '" y="' + (y + fh / 2 - t / 2) + '" width="' + fw * .44 + '" height="' + t + '" fill="' + spec.cross.fill + '"/>';
    }
    if (spec.nordic) {
      var nt = fh * (spec.nordic.t || .17);
      b += '<rect x="' + (x + fw * .28) + '" y="' + y + '" width="' + nt + '" height="' + fh + '" fill="' + spec.nordic.fill + '"/>';
      b += '<rect x="' + x + '" y="' + (y + fh / 2 - nt / 2) + '" width="' + fw + '" height="' + nt + '" fill="' + spec.nordic.fill + '"/>';
    }
    if (spec.diamond) b += poly([[x + fw / 2, y + 12], [x + fw - 16, y + fh / 2], [x + fw / 2, y + fh - 12], [x + 16, y + fh / 2]], spec.diamond);
    if (spec.disc) b += '<circle cx="' + (x + fw / 2) + '" cy="' + (y + fh / 2) + '" r="' + (fh * (spec.disc.r || .28)) + '" fill="' + spec.disc.fill + '"/>';
    if (spec.rays) {
      for (i = 0; i < 12; i++) {
        var a = i * Math.PI / 6, rr = fh * .3;
        b += '<path d="M' + (x + fw / 2 + rr * Math.cos(a)) + ' ' + (y + fh / 2 + rr * Math.sin(a)) + ' l' + (9 * Math.cos(a)) + ' ' + (9 * Math.sin(a)) + '" stroke="' + spec.rays + '" stroke-width="3" stroke-linecap="round"/>';
      }
    }
    if (spec.wheel) {
      b += '<circle cx="' + (x + fw / 2) + '" cy="' + (y + fh / 2) + '" r="' + (fh * .17) + '" fill="none" stroke="' + spec.wheel + '" stroke-width="3"/>';
      for (i = 0; i < 12; i++) {
        var wa = i * Math.PI / 6, wr = fh * .17;
        b += '<path d="M' + (x + fw / 2) + ' ' + (y + fh / 2) + ' l' + (wr * Math.cos(wa)) + ' ' + (wr * Math.sin(wa)) + '" stroke="' + spec.wheel + '" stroke-width="1.6"/>';
      }
    }
    if (spec.leaf) {
      var lcx = x + fw / 2, lcy = y + fh / 2 + 6, ls = fh / 150;
      var half = 'M0 -46 L5 -26 L17 -30 L13 -12 L29 -17 L24 -4 L42 -8 L32 6 L45 13 L28 19 L32 29 L14 25 L12 34 L3 28 L0 46 Z';
      b += '<g transform="translate(' + lcx + ' ' + lcy + ') scale(' + ls + ')" fill="' + spec.leaf + '">';
      b += '<path d="' + half + '"/><path d="' + half + '" transform="scale(-1 1)"/>';
      b += '<rect x="-3.5" y="24" width="7" height="30" rx="2"/></g>';
    }
    b += '</g>';
    b += '<rect x="' + x + '" y="' + y + '" width="' + fw + '" height="' + fh + '" rx="5" fill="none" stroke="#33505E" stroke-width="2.5"/>';
    return svg(w, h, b);
  }

  /* ---------- world map ---------- */
  var LAND = [
    [[-9,43],[-4,48],[0,51],[4,52],[8,55],[12,55],[18,59],[25,60],[30,65],[40,68],[55,70],[70,72],[80,75],[105,78],[130,73],[160,70],[179,66],[170,60],[163,58],[155,52],[140,46],[130,43],[122,39],[120,32],[110,21],[100,13],[105,10],[100,5],[95,17],[90,21],[80,8],[72,20],[60,25],[50,29],[57,25],[52,13],[43,13],[38,22],[34,29],[35,36],[31,36],[26,38],[23,36],[19,41],[13,45],[16,41],[16,38],[11,42],[9,44],[5,43],[3,42],[-5,36],[-9,37]],
    [[-6,36],[11,37],[20,33],[32,31],[36,22],[43,12],[51,11],[41,-2],[40,-16],[32,-26],[20,-35],[15,-23],[12,-6],[9,4],[3,6],[-8,4],[-17,15],[-16,22],[-10,30]],
    [[-168,66],[-160,71],[-140,70],[-125,70],[-95,68],[-85,70],[-78,73],[-65,60],[-55,52],[-65,44],[-74,40],[-81,32],[-80,25],[-90,29],[-97,26],[-95,18],[-92,15],[-84,10],[-79,9],[-87,13],[-95,16],[-105,20],[-113,27],[-117,32],[-122,37],[-124,46],[-131,55],[-150,59],[-163,55]],
    [[-77,8],[-72,12],[-60,8],[-50,0],[-44,-3],[-35,-7],[-39,-16],[-48,-25],[-58,-35],[-62,-40],[-65,-47],[-68,-55],[-75,-50],[-73,-40],[-71,-30],[-70,-18],[-77,-12],[-81,-5],[-80,2]],
    [[114,-22],[113,-26],[115,-34],[129,-32],[138,-35],[145,-38],[150,-37],[153,-28],[146,-19],[143,-11],[136,-12],[129,-15],[122,-17]],
    [[-180,-72],[-150,-75],[-120,-73],[-90,-72],[-60,-66],[-45,-72],[0,-70],[45,-67],[90,-66],[135,-66],[180,-72],[180,-89],[-180,-89]],
    [[-45,60],[-20,70],[-20,82],[-45,83],[-58,82],[-55,68]],
    [[43,-12],[50,-16],[47,-25],[44,-20]],
    [[-5,50],[1,51],[-1,58],[-6,58]],
    [[130,31],[136,34],[141,41],[145,44],[140,38],[132,34]],
    [[173,-35],[178,-38],[174,-41],[170,-46],[166,-45],[171,-39]]
  ];
  var T = K.T;

  function map(lat, lon, hi) {
    var w = 380, h = 210, pad = 16, iw = w - pad * 2, ih = h - pad * 2, id = 'mp' + K.nextId();
    var px = function (l) { return pad + ((l + 180) / 360) * iw; };
    var py = function (l) { return pad + ((90 - l) / 180) * ih; };
    var b = '<defs><clipPath id="' + id + '"><rect x="' + pad + '" y="' + pad + '" width="' + iw + '" height="' + ih + '" rx="8"/></clipPath></defs>';
    b += '<rect x="' + pad + '" y="' + pad + '" width="' + iw + '" height="' + ih + '" rx="8" fill="' + T.card + '" stroke="' + T.line + '" stroke-width="2"/>';
    b += '<g clip-path="url(#' + id + ')">';
    LAND.forEach(function (pg, i) {
      var d = pg.map(function (p, k) { return (k ? 'L' : 'M') + px(p[0]).toFixed(1) + ' ' + py(p[1]).toFixed(1); }).join(' ') + ' Z';
      var on = hi != null && hi === i;
      b += '<path d="' + d + '" fill="' + (on ? T.gold : T.land) + '" stroke="' + (on ? T.red : T.landLine) + '" stroke-width="' + (on ? 2.5 : 1.5) + '" stroke-linejoin="round"/>';
    });
    var d;
    for (d = -150; d <= 150; d += 30) b += '<path d="M' + px(d).toFixed(1) + ' ' + pad + ' V' + (pad + ih) + '" stroke="' + T.lineSoft + '" stroke-width="1" opacity=".7"/>';
    for (d = -60; d <= 60; d += 30) b += '<path d="M' + pad + ' ' + py(d).toFixed(1) + ' H' + (pad + iw) + '" stroke="' + (d === 0 ? T.sea : T.lineSoft) + '" stroke-width="' + (d === 0 ? 2 : 1) + '" opacity="' + (d === 0 ? 1 : .7) + '"/>';
    /* keep the label clear of the X, whichever side of the map it lands on */
    var labRight = lat == null || lon < 0;
    b += txt(labRight ? pad + iw - 6 : pad + 6, py(0) - 6, 'EQUATOR',
      { anchor: labRight ? 'end' : 'start', size: 10, mono: true, weight: 400, track: 1.5, fill: T.sea });
    if (lat != null) {
      var x = px(lon), y = py(lat), k = 13;
      b += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="21" fill="none" stroke="' + T.red + '" stroke-width="2.5" stroke-dasharray="5 6"/>';
      b += '<path d="M' + (x - k) + ' ' + (y - k) + ' L' + (x + k) + ' ' + (y + k) + ' M' + (x + k) + ' ' + (y - k) + ' L' + (x - k) + ' ' + (y + k) + '" stroke="' + T.red + '" stroke-width="5" stroke-linecap="round"/>';
    }
    b += '</g>';
    return svg(w, h, b);
  }

  /* ---------- compass rose ---------- */
  function compass(dir) {
    var w = 210, h = 210, cx = 105, cy = 105, r = 76, b = '', i;
    var names = ['N', 'E', 'S', 'W'];
    b += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + T.card + '" stroke="' + T.line + '" stroke-width="3"/>';
    b += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (r - 12) + '" fill="none" stroke="' + T.lineSoft + '" stroke-width="1.5"/>';
    for (i = 0; i < 4; i++) {
      var a = i * Math.PI / 2 - Math.PI / 2, a2 = a + Math.PI / 4;
      b += poly([[cx + (r - 16) * Math.cos(a), cy + (r - 16) * Math.sin(a)],
        [cx + 16 * Math.cos(a + Math.PI / 2), cy + 16 * Math.sin(a + Math.PI / 2)],
        [cx + 16 * Math.cos(a - Math.PI / 2), cy + 16 * Math.sin(a - Math.PI / 2)]], i % 2 ? T.sea : T.lineSoft);
      b += poly([[cx + (r - 30) * Math.cos(a2), cy + (r - 30) * Math.sin(a2)],
        [cx + 10 * Math.cos(a2 + Math.PI / 2), cy + 10 * Math.sin(a2 + Math.PI / 2)],
        [cx + 10 * Math.cos(a2 - Math.PI / 2), cy + 10 * Math.sin(a2 - Math.PI / 2)]], T.lineSoft);
      var lx = cx + (r + 14) * Math.cos(a), ly = cy + (r + 14) * Math.sin(a) + 6;
      b += txt(lx, ly, names[i], { size: 17, fill: names[i] === dir ? T.red : T.soft });
    }
    var di = names.indexOf(dir), da = (di < 0 ? 0 : di) * Math.PI / 2 - Math.PI / 2;
    b += '<path d="M' + cx + ' ' + cy + ' L' + (cx + (r - 20) * Math.cos(da)).toFixed(1) + ' ' + (cy + (r - 20) * Math.sin(da)).toFixed(1) + '" stroke="' + T.red + '" stroke-width="6" stroke-linecap="round"/>';
    b += '<circle cx="' + cx + '" cy="' + cy + '" r="8" fill="' + T.ink + '"/>';
    return svg(w, h, b);
  }

  global.PICTURES = { landmark: landmark, animal: animal, flag: flag, map: map, compass: compass };
  global.ART = Object.assign({}, global.DIAGRAMS, global.PICTURES);
  global.renderArt = function (spec) {
    var fn = global.ART[spec[0]];
    return fn ? fn.apply(null, spec.slice(1)) : '';
  };
})(window);
