/* Science diagrams. Working diagrams follow the page theme; scenes that
   need their own world (space, the water cycle) sit on a fixed panel. */
(function (global) {
  'use strict';
  var K = global.ARTKIT, svg = K.svg, txt = K.txt, poly = K.poly, T = K.T;

  function panel(w, h, bg, body) {
    var id = 'sp' + K.nextId();
    return svg(w, h,
      '<defs><clipPath id="' + id + '"><rect x="4" y="4" width="' + (w - 8) + '" height="' + (h - 8) + '" rx="11"/></clipPath></defs>' +
      '<rect x="0" y="0" width="' + w + '" height="' + h + '" rx="15" fill="#FFFDF7" stroke="#CDBE9B" stroke-width="2"/>' +
      '<g clip-path="url(#' + id + ')"><rect x="4" y="4" width="' + (w - 8) + '" height="' + (h - 8) + '" fill="' + bg + '"/>' + body + '</g>');
  }
  function arrow(x1, y1, x2, y2, col, sw) {
    var a = Math.atan2(y2 - y1, x2 - x1), hl = 11;
    return '<path d="M' + x1 + ' ' + y1 + ' L' + x2 + ' ' + y2 + '" stroke="' + col + '" stroke-width="' + (sw || 3) + '" stroke-linecap="round"/>' +
      poly([[x2, y2], [x2 - hl * Math.cos(a - .4), y2 - hl * Math.sin(a - .4)], [x2 - hl * Math.cos(a + .4), y2 - hl * Math.sin(a + .4)]], col);
  }

  /* the planets in order, sizes roughly ranked */
  var PLANETS = [
    { r: 7, c: '#B5A397' }, { r: 11, c: '#E0A95F' }, { r: 12, c: '#4C8FD6' }, { r: 9, c: '#C1583C' },
    { r: 26, c: '#D9A96A' }, { r: 22, c: '#E3C98A' }, { r: 15, c: '#8FD3DE' }, { r: 14, c: '#4C6CD6' }
  ];
  function solar(hi) {
    var w = 460, h = 150, b = '', x = 34, i;
    for (i = 0; i < 40; i++) {
      b += '<circle cx="' + (12 + (i * 97) % 440) + '" cy="' + (10 + (i * 53) % 130) + '" r="' + (i % 3 ? 1 : 1.6) + '" fill="#ffffff" opacity=".5"/>';
    }
    b += '<circle cx="10" cy="75" r="44" fill="#F7C542"/><circle cx="10" cy="75" r="54" fill="#F7C542" opacity=".2"/>';
    for (i = 0; i < 8; i++) {
      x += PLANETS[i].r + 20;
      b += '<circle cx="' + x + '" cy="75" r="' + PLANETS[i].r + '" fill="' + PLANETS[i].c + '"/>';
      if (i === 5) b += '<ellipse cx="' + x + '" cy="75" rx="' + (PLANETS[i].r + 12) + '" ry="5" fill="none" stroke="#E3C98A" stroke-width="3"/>';
      if (hi === i + 1) {
        b += '<circle cx="' + x + '" cy="75" r="' + (PLANETS[i].r + 9) + '" fill="none" stroke="#FF7A5C" stroke-width="3" stroke-dasharray="5 5"/>';
        b += '<text x="' + x + '" y="' + (75 - PLANETS[i].r - 18) + '" text-anchor="middle" font-family="Courier Prime, monospace" font-size="13" fill="#FF7A5C">?</text>';
      }
      x += PLANETS[i].r + 4;
    }
    return panel(w, h, '#101A33', b);
  }

  /* where water goes, with the steps lettered */
  function watercycle(letters) {
    var b = '<circle cx="396" cy="40" r="26" fill="#F7C542"/>';
    b += '<path d="M4 148 H436 V196 H4 Z" fill="#7FBCD6"/>';
    b += '<path d="M4 148 q40 10 90 0 t90 0 t90 0 t90 0" stroke="#5F9CB8" stroke-width="3" fill="none"/>';
    b += poly([[250, 148], [330, 56], [410, 148]], '#A8B99A');
    b += poly([[330, 56], [410, 148], [330, 148]], '#90A383');
    b += '<g fill="#FFFFFF"><ellipse cx="150" cy="54" rx="42" ry="22"/><ellipse cx="186" cy="60" rx="30" ry="17"/><ellipse cx="116" cy="62" rx="28" ry="15"/></g>';
    b += arrow(70, 140, 70, 78, '#2F7D96', 4);
    b += arrow(118, 40, 160, 34, '#2F7D96', 4);
    b += arrow(182, 86, 206, 140, '#2F7D96', 4);
    b += arrow(300, 120, 250, 146, '#2F7D96', 4);
    var L = letters || ['A', 'B', 'C', 'D'];
    var put = function (x, y, s) { return '<circle cx="' + x + '" cy="' + y + '" r="13" fill="#FFFDF7" stroke="#2F7D96" stroke-width="2"/><text x="' + x + '" y="' + (y + 6) + '" text-anchor="middle" font-family="Fredoka, sans-serif" font-size="16" font-weight="600" fill="#1E4F60">' + s + '</text>'; };
    b += put(48, 108, L[0]) + put(140, 24, L[1]) + put(210, 110, L[2]) + put(292, 96, L[3]);
    return panel(440, 200, '#CDE6F0', b);
  }

  /* simple circuits: one cell, bulbs, a switch */
  function circuit(kind) {
    var w = 360, h = 210, b = '';
    var L = 50, R = 310, TOP = 50, BOT = 160;
    var bulb = function (x, y, lit) {
      var s = '<circle cx="' + x + '" cy="' + y + '" r="20" fill="' + (lit ? T.gold : T.card2) + '" stroke="' + T.ink + '" stroke-width="3"/>';
      s += '<path d="M' + (x - 14) + ' ' + (y - 14) + ' L' + (x + 14) + ' ' + (y + 14) + ' M' + (x + 14) + ' ' + (y - 14) + ' L' + (x - 14) + ' ' + (y + 14) + '" stroke="' + T.ink + '" stroke-width="2.5"/>';
      return s;
    };
    var cell = function (x, y) {
      return '<path d="M' + (x - 16) + ' ' + (y - 16) + ' V' + (y + 16) + '" stroke="' + T.ink + '" stroke-width="5"/>' +
        '<path d="M' + (x + 2) + ' ' + (y - 9) + ' V' + (y + 9) + '" stroke="' + T.ink + '" stroke-width="5"/>' +
        '<path d="M' + (x + 18) + ' ' + (y - 16) + ' V' + (y + 16) + '" stroke="' + T.ink + '" stroke-width="5"/>' +
        '<path d="M' + (x + 36) + ' ' + (y - 9) + ' V' + (y + 9) + '" stroke="' + T.ink + '" stroke-width="5"/>';
    };
    var wire = 'stroke="' + T.ink + '" stroke-width="3.5" fill="none" stroke-linejoin="round"';
    if (kind === 'parallel') {
      b += '<path d="M' + L + ' ' + BOT + ' H' + R + ' V' + TOP + ' H' + L + ' Z" ' + wire + '/>';
      b += '<path d="M150 ' + TOP + ' V' + BOT + ' M240 ' + TOP + ' V' + BOT + '" ' + wire + '/>';
      b += '<rect x="130" y="85" width="40" height="40" fill="' + T.card + '"/><rect x="220" y="85" width="40" height="40" fill="' + T.card + '"/>';
      b += bulb(150, 105, true) + bulb(240, 105, true);
      b += '<rect x="56" y="' + (TOP - 10) + '" width="60" height="20" fill="' + T.card + '"/>' + cell(68, TOP);
    } else {
      b += '<path d="M' + L + ' ' + BOT + ' H' + R + ' V' + TOP + ' H' + L + ' Z" ' + wire + '/>';
      b += '<rect x="' + (L - 2) + '" y="86" width="4" height="40" fill="' + T.card + '"/>';
      b += cell(L - 18, 106);
      if (kind === 'series2') {
        b += '<rect x="130" y="' + (TOP - 3) + '" width="40" height="6" fill="' + T.card + '"/>';
        b += '<rect x="220" y="' + (TOP - 3) + '" width="40" height="6" fill="' + T.card + '"/>';
        b += bulb(150, TOP, true) + bulb(240, TOP, true);
      } else {
        b += '<rect x="160" y="' + (TOP - 3) + '" width="44" height="6" fill="' + T.card + '"/>' + bulb(182, TOP, kind !== 'open');
      }
      if (kind === 'open') {
        b += '<rect x="150" y="' + (BOT - 4) + '" width="70" height="8" fill="' + T.card + '"/>';
        b += '<circle cx="155" cy="' + BOT + '" r="4" fill="' + T.ink + '"/><circle cx="215" cy="' + BOT + '" r="4" fill="' + T.ink + '"/>';
        b += '<path d="M155 ' + BOT + ' L205 ' + (BOT - 26) + '" stroke="' + T.red + '" stroke-width="4" stroke-linecap="round"/>';
      }
    }
    return svg(w, h, b);
  }

  /* who eats whom */
  function foodchain(items) {
    var bw = 104, gap = 42, h = 110;
    var w = items.length * bw + (items.length - 1) * gap + 20, b = '';
    items.forEach(function (it, i) {
      var x = 10 + i * (bw + gap);
      b += '<rect x="' + x + '" y="30" width="' + bw + '" height="52" rx="10" fill="' + [T.moss, T.gold, T.sea, T.red][i % 4] + '" opacity=".22"/>';
      b += '<rect x="' + x + '" y="30" width="' + bw + '" height="52" rx="10" fill="none" stroke="' + [T.moss, T.gold, T.sea, T.red][i % 4] + '" stroke-width="2.5"/>';
      b += txt(x + bw / 2, 61, it, { size: 15, weight: 500, fill: T.ink });
      if (i < items.length - 1) b += arrow(x + bw + 8, 56, x + bw + gap - 8, 56, T.soft, 3);
    });
    return svg(w, h, b);
  }

  /* particles in a solid, a liquid and a gas */
  function states(labels) {
    var bw = 118, gap = 20, w = bw * 3 + gap * 2 + 16, h = 158, b = '';
    var sets = [
      [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [2, 2]],
      [[0, .3], [1.1, 0], [2, .5], [.3, 1.2], [1.5, 1.1], [2.3, 1.5], [.6, 2.1], [1.8, 2.2]],
      [[0, 0], [2.2, .4], [1, 1.6], [2.6, 2.2], [.2, 2.4]]
    ];
    sets.forEach(function (st, i) {
      var x = 8 + i * (bw + gap);
      b += '<rect x="' + x + '" y="14" width="' + bw + '" height="' + bw + '" rx="8" fill="' + T.card + '" stroke="' + T.ink + '" stroke-width="2.5"/>';
      st.forEach(function (p) {
        b += '<circle cx="' + (x + 24 + p[0] * 34) + '" cy="' + (38 + p[1] * 34) + '" r="12" fill="' + [T.sea, T.gold, T.red][i] + '"/>';
      });
      b += txt(x + bw / 2, bw + 46, (labels || ['A', 'B', 'C'])[i], { size: 18, fill: T.ink });
    });
    return svg(w, h, b);
  }

  /* arrows pushing and pulling on one object */
  function forces(spec) {
    var w = 360, h = 220, cx = 180, cy = 110, b = '';
    b += '<rect x="130" y="76" width="100" height="68" rx="8" fill="' + T.sea + '" opacity=".28"/>';
    b += '<rect x="130" y="76" width="100" height="68" rx="8" fill="none" stroke="' + T.sea + '" stroke-width="3"/>';
    var dirs = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
    Object.keys(spec).forEach(function (d) {
      var v = dirs[d], len = 72;
      var sx = cx + v[0] * 54, sy = cy + v[1] * 36;
      var ex = cx + v[0] * (54 + len), ey = cy + v[1] * (36 + len);
      b += arrow(sx, sy, ex, ey, T.red, 4.5);
      b += txt(ex + v[0] * 6 + (v[1] ? 26 : 0), ey + (v[1] > 0 ? 20 : v[1] < 0 ? -10 : 5), spec[d], { size: 15, mono: true, weight: 700, fill: T.red });
    });
    return svg(w, h, b);
  }

  /* a cell with one part picked out */
  function cell(kind, hi) {
    var w = 330, h = 220, b = '';
    var plant = kind === 'plant';
    if (plant) {
      b += '<rect x="24" y="26" width="282" height="168" rx="10" fill="' + (hi === 'wall' ? T.gold : T.moss) + '" opacity="' + (hi === 'wall' ? '.9' : '.35') + '"/>';
      b += '<rect x="36" y="38" width="258" height="144" rx="8" fill="' + T.card2 + '" stroke="' + T.moss + '" stroke-width="2.5"/>';
      b += '<rect x="96" y="66" width="150" height="88" rx="12" fill="' + (hi === 'vacuole' ? T.gold : T.sea) + '" opacity="' + (hi === 'vacuole' ? '.9' : '.25') + '"/>';
      [[70, 150], [250, 70], [262, 150], [66, 62]].forEach(function (p) {
        b += '<ellipse cx="' + p[0] + '" cy="' + p[1] + '" rx="15" ry="9" fill="' + (hi === 'chloro' ? T.gold : T.moss) + '" transform="rotate(-20 ' + p[0] + ' ' + p[1] + ')"/>';
      });
      b += '<circle cx="168" cy="110" r="30" fill="' + (hi === 'nucleus' ? T.gold : T.red) + '" opacity="' + (hi === 'nucleus' ? '.95' : '.6') + '"/>';
    } else {
      b += '<ellipse cx="165" cy="110" rx="140" ry="86" fill="' + T.card2 + '" stroke="' + (hi === 'membrane' ? T.gold : T.sea) + '" stroke-width="' + (hi === 'membrane' ? 8 : 3) + '"/>';
      b += '<circle cx="165" cy="110" r="34" fill="' + (hi === 'nucleus' ? T.gold : T.red) + '" opacity="' + (hi === 'nucleus' ? '.95' : '.6') + '"/>';
      b += '<circle cx="165" cy="110" r="12" fill="' + T.ink + '" opacity=".35"/>';
      [[86, 78], [250, 80], [96, 148], [238, 146]].forEach(function (p) {
        b += '<ellipse cx="' + p[0] + '" cy="' + p[1] + '" rx="18" ry="9" fill="' + (hi === 'mito' ? T.gold : T.sea) + '" opacity="' + (hi === 'mito' ? '.95' : '.45') + '" transform="rotate(25 ' + p[0] + ' ' + p[1] + ')"/>';
      });
    }
    if (hi) b += txt(165, 210, 'which part is highlighted?', { size: 12, mono: true, weight: 400, fill: T.soft });
    return svg(w, h, b);
  }

  /* a body outline with one organ picked out */
  function organs(hi) {
    var w = 240, h = 250, b = '';
    b += '<path d="M120 20 a26 26 0 1 1 -.1 0 Z" fill="' + (hi === 'brain' ? T.gold : T.card2) + '" stroke="' + T.ink + '" stroke-width="2.5"/>';
    b += '<path d="M78 74 h84 q18 0 18 20 v96 q0 20 -20 20 h-80 q-20 0 -20 -20 v-96 q0 -20 18 -20 Z" fill="' + T.card2 + '" stroke="' + T.ink + '" stroke-width="2.5"/>';
    b += '<path d="M112 92 q-26 4 -26 34 q0 26 20 30 q8 -30 8 -64 Z" fill="' + (hi === 'lungs' ? T.gold : T.sea) + '" opacity="' + (hi === 'lungs' ? '.95' : '.45') + '"/>';
    b += '<path d="M128 92 q26 4 26 34 q0 26 -20 30 q-8 -30 -8 -64 Z" fill="' + (hi === 'lungs' ? T.gold : T.sea) + '" opacity="' + (hi === 'lungs' ? '.95' : '.45') + '"/>';
    b += '<path d="M120 100 q14 -14 24 0 q10 14 -24 38 q-34 -24 -24 -38 q10 -14 24 0 Z" fill="' + (hi === 'heart' ? T.gold : T.red) + '" opacity="' + (hi === 'heart' ? '.95' : '.8') + '"/>';
    b += '<path d="M96 162 q24 -12 44 2 q14 10 2 26 q-20 14 -40 -2 q-12 -12 -6 -26 Z" fill="' + (hi === 'stomach' ? T.gold : T.moss) + '" opacity="' + (hi === 'stomach' ? '.95' : '.6') + '"/>';
    b += txt(120, 240, 'which organ is highlighted?', { size: 12, mono: true, weight: 400, fill: T.soft });
    return svg(w, h, b);
  }

  /* light bouncing, bending or blocked */
  function lightray(kind) {
    var w = 360, h = 210, b = '';
    if (kind === 'mirror') {
      b += '<rect x="60" y="150" width="240" height="14" fill="' + T.sea + '"/>';
      for (var i = 0; i < 12; i++) b += '<path d="M' + (64 + i * 20) + ' 164 l-10 14" stroke="' + T.soft + '" stroke-width="2"/>';
      b += arrow(80, 40, 180, 150, T.gold, 4);
      b += arrow(180, 150, 280, 40, T.red, 4);
      b += '<path d="M180 150 V60" stroke="' + T.soft + '" stroke-width="2" stroke-dasharray="6 5"/>';
      b += txt(150, 96, 'i', { size: 15, fill: T.gold }) + txt(214, 96, 'r', { size: 15, fill: T.red });
    } else if (kind === 'prism') {
      b += poly([[150, 158], [210, 54], [270, 158]], T.sea, T.ink, 3);
      b += '<path d="M30 118 H158" stroke="' + T.ink + '" stroke-width="4"/>';
      ['#D94C33', '#E29A0C', '#C9C020', '#3C8B4E', '#2E7FA8', '#5A4E9B'].forEach(function (c, k) {
        b += '<path d="M228 126 L336 ' + (96 + k * 16) + '" stroke="' + c + '" stroke-width="4" stroke-linecap="round"/>';
      });
    } else {
      b += '<circle cx="48" cy="100" r="22" fill="' + T.gold + '"/>';
      b += '<rect x="150" y="50" width="26" height="100" rx="4" fill="' + T.ink + '"/>';
      b += '<path d="M176 50 L330 20 L330 180 L176 150 Z" fill="' + T.soft + '" opacity=".4"/>';
      b += arrow(72, 100, 144, 100, T.gold, 3);
      b += txt(252, 108, 'shadow', { size: 14, fill: T.card });
    }
    return svg(w, h, b);
  }

  /* the moon through a month */
  function moonphase(hi) {
    var w = 430, h = 120, b = '', i;
    for (i = 0; i < 8; i++) {
      var cx = 34 + i * 54, lit = i / 8;
      b += '<circle cx="' + cx + '" cy="56" r="22" fill="#2A3550"/>';
      if (i === 0) { /* new moon */ }
      else if (i === 4) b += '<circle cx="' + cx + '" cy="56" r="22" fill="#F4EFE2"/>';
      else {
        var waxing = i < 4, k = waxing ? i / 4 : (8 - i) / 4;
        var rx = Math.abs(22 * (1 - 2 * k)) || 0.5;
        b += '<path d="M' + cx + ' 34 A22 22 0 0 ' + (waxing ? 1 : 0) + ' ' + cx + ' 78 A' + rx + ' 22 0 0 ' + (k < .5 ? (waxing ? 1 : 0) : (waxing ? 0 : 1)) + ' ' + cx + ' 34 Z" fill="#F4EFE2"/>';
      }
      b += '<circle cx="' + cx + '" cy="56" r="22" fill="none" stroke="#5B6B8A" stroke-width="1.5"/>';
      if (hi === i + 1) b += '<circle cx="' + cx + '" cy="56" r="30" fill="none" stroke="#FF7A5C" stroke-width="3" stroke-dasharray="5 5"/>';
      b += '<text x="' + cx + '" y="104" text-anchor="middle" font-family="Courier Prime, monospace" font-size="12" fill="#9FB0C9">' + (i + 1) + '</text>';
    }
    return panel(w, h, '#141E38', b);
  }

  /* a thermometer reading */
  function thermo(c, lo, hi) {
    var w = 190, h = 240, x = 78, top = 24, bot = 180, b = '';
    var frac = (c - lo) / (hi - lo);
    b += '<rect x="' + x + '" y="' + top + '" width="26" height="' + (bot - top) + '" rx="13" fill="' + T.card + '" stroke="' + T.ink + '" stroke-width="3"/>';
    b += '<circle cx="' + (x + 13) + '" cy="' + (bot + 18) + '" r="22" fill="' + T.red + '" stroke="' + T.ink + '" stroke-width="3"/>';
    b += '<rect x="' + (x + 6) + '" y="' + (bot - frac * (bot - top)) + '" width="14" height="' + (frac * (bot - top) + 10) + '" rx="7" fill="' + T.red + '"/>';
    for (var i = 0; i <= 5; i++) {
      var y = bot - (i / 5) * (bot - top);
      b += '<path d="M' + (x - 10) + ' ' + y + ' H' + x + '" stroke="' + T.soft + '" stroke-width="2"/>';
      b += txt(x - 14, y + 5, Math.round(lo + (hi - lo) * i / 5) + '°', { anchor: 'end', size: 12, mono: true, weight: 400, fill: T.soft });
    }
    return svg(w, h, b);
  }

  /* a life cycle going round */
  function lifecycle(stages) {
    var w = 340, h = 250, cx = 170, cy = 120, r = 86, b = '';
    stages.forEach(function (s, i) {
      var a = (i / stages.length) * Math.PI * 2 - Math.PI / 2;
      var x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
      b += '<rect x="' + (x - 54) + '" y="' + (y - 19) + '" width="108" height="38" rx="9" fill="' + T.card + '" stroke="' + [T.moss, T.sea, T.gold, T.red][i % 4] + '" stroke-width="2.5"/>';
      b += txt(x, y + 6, s, { size: 14, weight: 500, fill: T.ink });
      var a2 = ((i + .34) / stages.length) * Math.PI * 2 - Math.PI / 2;
      var a3 = ((i + .66) / stages.length) * Math.PI * 2 - Math.PI / 2, rr = r - 46;
      b += arrow(cx + rr * Math.cos(a2), cy + rr * Math.sin(a2), cx + rr * Math.cos(a3), cy + rr * Math.sin(a3), T.ink, 4);
    });
    return svg(w, h, b);
  }

  /* two magnets, facing each other */
  function magnet(kind) {
    var w = 360, h = 150, b = '';
    var bar = function (x, flip) {
      var left = flip ? 'S' : 'N', right = flip ? 'N' : 'S';
      var s = '<rect x="' + x + '" y="50" width="70" height="44" fill="' + T.red + '"/>';
      s += '<rect x="' + (x + 70) + '" y="50" width="70" height="44" fill="' + T.sea + '"/>';
      s += '<rect x="' + x + '" y="50" width="140" height="44" fill="none" stroke="' + T.ink + '" stroke-width="2.5"/>';
      s += txt(x + 35, 80, left, { size: 20, fill: T.card }) + txt(x + 105, 80, right, { size: 20, fill: T.card });
      return s;
    };
    b += bar(14, false) + bar(206, kind === 'repel');
    b += '<path d="M160 72 H196" stroke="' + T.lineSoft + '" stroke-width="2" stroke-dasharray="5 5"/>';
    return svg(w, h, b);
  }

  /* a lever: load, effort and the point it turns on */
  function lever(loadAt, effortAt) {
    var w = 380, h = 180, y = 104, b = '';
    b += '<path d="M30 ' + y + ' H350" stroke="' + T.ink + '" stroke-width="10" stroke-linecap="round"/>';
    b += poly([[190, y + 6], [160, 160], [220, 160]], T.soft);
    b += '<rect x="' + (loadAt - 26) + '" y="' + (y - 48) + '" width="52" height="40" rx="6" fill="' + T.sea + '"/>';
    b += txt(loadAt, y - 22, 'load', { size: 13, fill: T.card });
    b += arrow(effortAt, y - 54, effortAt, y - 12, T.red, 4.5);
    b += txt(effortAt, y - 62, 'effort', { size: 13, fill: T.red });
    return svg(w, h, b);
  }

  Object.assign(global.ART, {
    solar: solar, watercycle: watercycle, circuit: circuit, foodchain: foodchain, states: states,
    forces: forces, cell: cell, organs: organs, lightray: lightray, moonphase: moonphase,
    thermo: thermo, lifecycle: lifecycle, magnet: magnet, lever: lever
  });
})(window);
