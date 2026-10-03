/* Diagrams for the olympiad maths and data-handling questions. */
(function (global) {
  'use strict';
  var K = global.ARTKIT, svg = K.svg, txt = K.txt, poly = K.poly, T = K.T;

  /* a number line, for negatives, decimals and fractions */
  function numline(from, to, step, marks) {
    var w = 440, h = 108, pad = 30, y = 62, iw = w - pad * 2;
    var X = function (v) { return pad + ((v - from) / (to - from)) * iw; };
    var b = '<path d="M' + (pad - 10) + ' ' + y + ' H' + (w - pad + 10) + '" stroke="' + T.ink + '" stroke-width="2.5"/>';
    b += '<path d="M' + (w - pad + 10) + ' ' + y + ' l-9 -5 v10 Z" fill="' + T.ink + '"/>';
    b += '<path d="M' + (pad - 10) + ' ' + y + ' l9 -5 v10 Z" fill="' + T.ink + '"/>';
    for (var v = from; v <= to + 1e-9; v += step) {
      var x = X(v), major = Math.abs(v / step) % 1 === 0;
      b += '<path d="M' + x.toFixed(1) + ' ' + (y - 6) + ' V' + (y + 6) + '" stroke="' + T.soft + '" stroke-width="2"/>';
      b += txt(x, y + 24, (Math.round(v * 100) / 100), { size: 13, mono: true, weight: 400, fill: T.soft });
    }
    (marks || []).forEach(function (m, i) {
      var mx = X(m[0]), c = [T.red, T.sea, T.moss][i % 3];
      b += '<path d="M' + mx.toFixed(1) + ' ' + (y - 9) + ' l-8 -13 h16 Z" fill="' + c + '"/>';
      b += txt(mx, y - 28, m[1], { size: 17, fill: c });
    });
    return svg(w, h, b);
  }

  /* fraction bars, for comparing and ordering */
  function fracbar(rows) {
    var lw = 62, bw = 300, bh = 34, gap = 14;
    var w = lw + bw + 16, h = rows.length * (bh + gap) + 8, b = '';
    rows.forEach(function (r, i) {
      var y = 6 + i * (bh + gap), cw = bw / r.p;
      b += txt(lw - 12, y + bh / 2 + 6, r.label, { anchor: 'end', size: 17, fill: T.ink });
      for (var k = 0; k < r.p; k++) {
        b += '<rect x="' + (lw + k * cw) + '" y="' + y + '" width="' + cw + '" height="' + bh + '" fill="' +
          (k < r.s ? [T.sea, T.gold, T.moss][i % 3] : T.card) + '" stroke="' + T.ink + '" stroke-width="2"/>';
      }
    });
    return svg(w, h, b);
  }

  /* shapes with their measurements written on, for area and perimeter */
  function figure(kind, o) {
    o = o || {};
    var w = 360, h = 220, b = '', u = o.unit || 'cm';
    var lab = function (x, y, s) { return txt(x, y, s, { size: 15, mono: true, weight: 700, fill: T.ink }); };
    if (kind === 'rect') {
      var rw = 220, rh = 120, x = 70, y = 50;
      b += '<rect x="' + x + '" y="' + y + '" width="' + rw + '" height="' + rh + '" fill="' + T.sea + '" opacity=".22"/>';
      b += '<rect x="' + x + '" y="' + y + '" width="' + rw + '" height="' + rh + '" fill="none" stroke="' + T.sea + '" stroke-width="3"/>';
      b += lab(x + rw / 2, y - 14, o.w + ' ' + u);
      b += lab(x - 14, y + rh / 2 + 5, o.h + ' ' + u);
      b += '<path d="M' + (x + 4) + ' ' + (y + 20) + ' v-16 h16" fill="none" stroke="' + T.soft + '" stroke-width="2"/>';
    } else if (kind === 'tri') {
      var bx = 70, by = 176, bw2 = 220, hh = 120;
      b += poly([[bx, by], [bx + bw2, by], [bx + 60, by - hh]], T.gold, T.ink, 3);
      b += '<path d="M' + (bx + 60) + ' ' + by + ' V' + (by - hh) + '" stroke="' + T.soft + '" stroke-width="2" stroke-dasharray="6 5"/>';
      b += '<path d="M' + (bx + 60) + ' ' + (by - 16) + ' h16 v16" fill="none" stroke="' + T.soft + '" stroke-width="2"/>';
      b += lab(bx + bw2 / 2, by + 22, o.b + ' ' + u);
      b += lab(bx + 34, by - hh / 2 - 10, o.h + ' ' + u);
    } else if (kind === 'lshape') {
      var X0 = 70, Y0 = 40, A = o.a, B = o.b, C = o.c, D = o.d, s = 14;
      b += poly([[X0, Y0], [X0 + A * s, Y0], [X0 + A * s, Y0 + D * s], [X0 + C * s, Y0 + D * s], [X0 + C * s, Y0 + B * s], [X0, Y0 + B * s]], T.moss, T.ink, 3);
      b += lab(X0 + A * s / 2, Y0 - 12, A + ' ' + u);
      b += lab(X0 - 14, Y0 + B * s / 2, B + ' ' + u);
      b += lab(X0 + C * s / 2, Y0 + B * s + 20, C + ' ' + u);
      b += lab(X0 + A * s + 20, Y0 + D * s / 2, D + ' ' + u);
    } else if (kind === 'circle') {
      b += '<circle cx="180" cy="110" r="80" fill="' + T.sea + '" opacity=".22"/>';
      b += '<circle cx="180" cy="110" r="80" fill="none" stroke="' + T.sea + '" stroke-width="3"/>';
      b += '<path d="M180 110 H260" stroke="' + T.red + '" stroke-width="3"/><circle cx="180" cy="110" r="4" fill="' + T.ink + '"/>';
      b += lab(220, 102, o.r + ' ' + u);
    }
    return svg(w, h, b);
  }

  /* an angle to name or measure */
  function angles(deg, showArc) {
    var w = 300, h = 200, vx = 60, vy = 160, r = 120, b = '';
    var rad = deg * Math.PI / 180;
    b += '<path d="M' + vx + ' ' + vy + ' H' + (vx + r + 20) + '" stroke="' + T.ink + '" stroke-width="4" stroke-linecap="round"/>';
    b += '<path d="M' + vx + ' ' + vy + ' L' + (vx + (r + 20) * Math.cos(-rad)).toFixed(1) + ' ' + (vy + (r + 20) * Math.sin(-rad)).toFixed(1) + '" stroke="' + T.ink + '" stroke-width="4" stroke-linecap="round"/>';
    var ar = 46;
    b += '<path d="M' + (vx + ar) + ' ' + vy + ' A' + ar + ' ' + ar + ' 0 0 0 ' + (vx + ar * Math.cos(-rad)).toFixed(1) + ' ' + (vy + ar * Math.sin(-rad)).toFixed(1) + '" fill="none" stroke="' + T.red + '" stroke-width="3"/>';
    if (showArc) b += txt(vx + 74, vy - 22, deg + '°', { size: 18, fill: T.red });
    else b += txt(vx + 70, vy - 20, '?', { size: 22, fill: T.red });
    b += '<circle cx="' + vx + '" cy="' + vy + '" r="5" fill="' + T.ink + '"/>';
    return svg(w, h, b);
  }

  /* two overlapping sets */
  function venn(la, lb, a, both, bb) {
    var w = 360, h = 220, b = '';
    b += '<circle cx="140" cy="118" r="78" fill="' + T.sea + '" opacity=".3"/>';
    b += '<circle cx="220" cy="118" r="78" fill="' + T.gold + '" opacity=".35"/>';
    b += '<circle cx="140" cy="118" r="78" fill="none" stroke="' + T.sea + '" stroke-width="2.5"/>';
    b += '<circle cx="220" cy="118" r="78" fill="none" stroke="' + T.gold + '" stroke-width="2.5"/>';
    b += txt(100, 126, a, { size: 24, fill: T.ink });
    b += txt(180, 126, both, { size: 24, fill: T.ink });
    b += txt(260, 126, bb, { size: 24, fill: T.ink });
    b += txt(96, 28, la, { size: 15, fill: T.sea });
    b += txt(266, 28, lb, { size: 15, fill: T.gold });
    return svg(w, h, b);
  }

  /* a small data table */
  function table(headers, rows) {
    var cw = Math.max(92, 360 / headers.length), rh = 36;
    var w = cw * headers.length + 4, h = (rows.length + 1) * rh + 6, b = '';
    b += '<rect x="2" y="2" width="' + (w - 4) + '" height="' + rh + '" fill="' + T.sea + '"/>';
    headers.forEach(function (hd, i) {
      b += txt(2 + cw * i + cw / 2, 26, hd, { size: 14, fill: T.card });
    });
    rows.forEach(function (r, ri) {
      var y = 2 + rh * (ri + 1);
      b += '<rect x="2" y="' + y + '" width="' + (w - 4) + '" height="' + rh + '" fill="' + (ri % 2 ? T.card2 : T.card) + '"/>';
      r.forEach(function (c, ci) { b += txt(2 + cw * ci + cw / 2, y + 24, c, { size: 15, mono: ci > 0, weight: ci ? 700 : 600, fill: T.ink }); });
    });
    b += '<rect x="2" y="2" width="' + (w - 4) + '" height="' + (h - 6) + '" fill="none" stroke="' + T.line + '" stroke-width="2"/>';
    for (var i = 1; i < headers.length; i++) b += '<path d="M' + (2 + cw * i) + ' 2 V' + (h - 4) + '" stroke="' + T.line + '" stroke-width="1.5"/>';
    return svg(w, h, b);
  }

  /* a folded-out cube */
  function net(mark) {
    var s = 48, ox = 70, oy = 20, b = '';
    var cells = [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2], [1, 3]];
    cells.forEach(function (c, i) {
      var x = ox + c[0] * s, y = oy + c[1] * s;
      b += '<rect x="' + x + '" y="' + y + '" width="' + s + '" height="' + s + '" fill="' + (mark && mark[i] ? T.gold : T.card2) + '" stroke="' + T.ink + '" stroke-width="2.5"/>';
      if (mark && mark[i]) b += txt(x + s / 2, y + s / 2 + 7, mark[i], { size: 19, fill: T.ink });
    });
    return svg(ox * 2 + s * 3, oy * 2 + s * 4, b);
  }

  /* a pattern that grows: matchstick squares */
  function growpattern(upto) {
    var s = 40, pad = 14, gap = 26, b = '', x = pad;
    var w = 0, i, k;
    for (i = 1; i <= upto; i++) w += i * s + gap;
    w += pad * 2;
    for (i = 1; i <= upto; i++) {
      for (k = 0; k < i; k++) {
        var cx = x + k * s;
        b += '<rect x="' + cx + '" y="34" width="' + s + '" height="' + s + '" fill="none" stroke="' + T.sea + '" stroke-width="4" stroke-linejoin="round"/>';
      }
      b += txt(x + (i * s) / 2, 102, 'Stage ' + i, { size: 13, mono: true, weight: 400, fill: T.soft });
      x += i * s + gap;
    }
    return svg(w, 118, b);
  }

  /* a pie chart with labels around it */
  function pie(slices) {
    var w = 360, h = 230, cx = 150, cy = 115, r = 92, start = -Math.PI / 2, b = '';
    var total = slices.reduce(function (a, s) { return a + s.v; }, 0);
    var cols = [T.sea, T.gold, T.red, T.moss, T.soft];
    slices.forEach(function (s, i) {
      var a1 = start, a2 = start + (s.v / total) * Math.PI * 2;
      var large = (a2 - a1) > Math.PI ? 1 : 0;
      b += '<path d="M' + cx + ' ' + cy + ' L' + (cx + r * Math.cos(a1)).toFixed(1) + ' ' + (cy + r * Math.sin(a1)).toFixed(1) +
        ' A' + r + ' ' + r + ' 0 ' + large + ' 1 ' + (cx + r * Math.cos(a2)).toFixed(1) + ' ' + (cy + r * Math.sin(a2)).toFixed(1) +
        ' Z" fill="' + cols[i % 5] + '" stroke="' + T.card + '" stroke-width="2.5"/>';
      b += '<rect x="262" y="' + (28 + i * 32) + '" width="18" height="18" rx="4" fill="' + cols[i % 5] + '"/>';
      b += txt(288, 43 + i * 32, s.label, { anchor: 'start', size: 15, weight: 500, fill: T.ink });
      start = a2;
    });
    return svg(w, h, b);
  }

  /* a bar chart to read values off */
  function barchart(data, unit) {
    var w = 380, h = 240, left = 46, base = 190, bw = 44, gap = 22;
    var max = Math.max.apply(null, data.map(function (d) { return d.v; }));
    var scale = 140 / max, b = '', i;
    for (i = 0; i <= 4; i++) {
      var gy = base - (max * scale * i / 4);
      b += '<path d="M' + left + ' ' + gy.toFixed(1) + ' H' + (w - 14) + '" stroke="' + T.lineSoft + '" stroke-width="1.5"/>';
      b += txt(left - 10, gy + 5, Math.round(max * i / 4), { anchor: 'end', size: 12, mono: true, weight: 400, fill: T.soft });
    }
    data.forEach(function (d, k) {
      var x = left + 16 + k * (bw + gap), bh = d.v * scale;
      b += '<rect x="' + x + '" y="' + (base - bh) + '" width="' + bw + '" height="' + bh + '" rx="3" fill="' + [T.sea, T.gold, T.moss, T.red][k % 4] + '"/>';
      b += txt(x + bw / 2, base + 20, d.label, { size: 13, weight: 500, fill: T.ink });
    });
    b += '<path d="M' + left + ' ' + base + ' H' + (w - 14) + '" stroke="' + T.ink + '" stroke-width="2.5"/>';
    b += '<path d="M' + left + ' 36 V' + base + '" stroke="' + T.ink + '" stroke-width="2.5"/>';
    if (unit) b += txt(left - 10, 30, unit, { anchor: 'end', size: 11, mono: true, weight: 400, fill: T.soft });
    return svg(w, h, b);
  }

  /* digits sitting in their place-value columns */
  function placevalue(digits, heads) {
    var cw = 74, w = cw * heads.length + 4, h = 110, b = '';
    heads.forEach(function (hd, i) {
      var x = 2 + i * cw;
      b += '<rect x="' + x + '" y="2" width="' + cw + '" height="30" fill="' + T.sea + '"/>';
      b += txt(x + cw / 2, 23, hd, { size: 13, fill: T.card });
      b += '<rect x="' + x + '" y="32" width="' + cw + '" height="60" fill="' + (i % 2 ? T.card2 : T.card) + '" stroke="' + T.line + '" stroke-width="2"/>';
      b += txt(x + cw / 2, 76, digits[i] == null ? '?' : digits[i], { size: 34, fill: digits[i] == null ? T.red : T.ink });
    });
    return svg(w, h, b);
  }

  Object.assign(global.ART, {
    numline: numline, fracbar: fracbar, figure: figure, angles: angles, venn: venn,
    table: table, net: net, growpattern: growpattern, pie: pie, barchart: barchart, placevalue: placevalue
  });
})(window);
