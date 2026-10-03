/* History, English and social-studies visuals.
   The word-work renderers return styled HTML rather than SVG: English
   questions are about text, and text wants real type, not plotted glyphs. */
(function (global) {
  'use strict';
  var K = global.ARTKIT, svg = K.svg, txt = K.txt, poly = K.poly, T = K.T;

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ---------- English: words and sentences ---------- */

  /* a specimen card: one word or phrase, held up to be looked at */
  function card(label, big, sub) {
    return '<div class="wcard">' +
      (label ? '<span class="wcard-label">' + esc(label) + '</span>' : '') +
      '<span class="wcard-big">' + esc(big) + '</span>' +
      (sub ? '<span class="wcard-sub">' + esc(sub) + '</span>' : '') +
      '</div>';
  }

  /* a sentence with one word picked out */
  function sentence(text, hi, label) {
    var out = esc(text);
    if (hi) out = out.replace(new RegExp('(^|[\\s(])(' + esc(hi).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')([\\s,.;:!?)]|$)'),
      function (m, a, w, z) { return a + '<b>' + w + '</b>' + z; });
    return '<div class="wcard sent">' +
      (label ? '<span class="wcard-label">' + esc(label) + '</span>' : '') +
      '<p>' + out + '</p></div>';
  }

  /* a short passage to read before answering */
  function passage(lines, label) {
    return '<div class="wcard passage">' +
      (label ? '<span class="wcard-label">' + esc(label) + '</span>' : '') +
      lines.map(function (l) { return '<p>' + esc(l) + '</p>'; }).join('') +
      '</div>';
  }

  /* a word taken apart: prefix + root + suffix */
  function wordbuild(parts, label) {
    return '<div class="wcard build">' +
      (label ? '<span class="wcard-label">' + esc(label) + '</span>' : '') +
      '<div class="chips">' + parts.map(function (p, i) {
        return (i ? '<span class="plus">+</span>' : '') +
          '<span class="chip' + (p[1] ? ' chip-' + p[1] : '') + '">' + esc(p[0]) +
          (p[2] ? '<em>' + esc(p[2]) + '</em>' : '') + '</span>';
      }).join('') + '</div></div>';
  }

  /* ---------- History ---------- */

  /* a timeline with the dates marked */
  function timeline(events, hi) {
    var w = 460, h = 170, pad = 34, y = 86, iw = w - pad * 2, b = '';
    b += '<path d="M' + pad + ' ' + y + ' H' + (w - pad) + '" stroke="' + T.ink + '" stroke-width="3"/>';
    b += '<path d="M' + (w - pad) + ' ' + y + ' l-10 -6 v12 Z" fill="' + T.ink + '"/>';
    events.forEach(function (e, i) {
      var x = pad + 14 + (i / Math.max(1, events.length - 1)) * (iw - 28);
      var up = i % 2 === 0, ly = up ? y - 20 : y + 20;
      var on = hi === i;
      b += '<path d="M' + x.toFixed(1) + ' ' + (y - 9) + ' V' + (y + 9) + '" stroke="' + (on ? T.red : T.soft) + '" stroke-width="3"/>';
      b += '<circle cx="' + x.toFixed(1) + '" cy="' + y + '" r="' + (on ? 8 : 5) + '" fill="' + (on ? T.red : T.sea) + '"/>';
      b += txt(x, ly + (up ? 0 : 6), e.y, { size: 15, mono: true, weight: 700, fill: on ? T.red : T.ink });
      b += txt(x, ly + (up ? -18 : 24), e.t, { size: 12, weight: 500, fill: T.soft });
    });
    return svg(w, h, b);
  }

  /* things people made, from the ages the questions cover */
  var THINGS = {
    column: function () {
      var b = '<rect x="78" y="34" width="84" height="12" rx="3" fill="#D9CDB4" stroke="#B2A181" stroke-width="2"/>';
      b += '<rect x="90" y="46" width="60" height="112" fill="#EFE7D6" stroke="#B2A181" stroke-width="2"/>';
      for (var i = 0; i < 5; i++) b += '<path d="M' + (99 + i * 11) + ' 48 V156" stroke="#C9BBA0" stroke-width="2.5"/>';
      b += '<rect x="74" y="158" width="92" height="16" rx="3" fill="#D9CDB4" stroke="#B2A181" stroke-width="2"/>';
      b += '<circle cx="86" cy="40" r="8" fill="#EFE7D6" stroke="#B2A181" stroke-width="2"/><circle cx="154" cy="40" r="8" fill="#EFE7D6" stroke="#B2A181" stroke-width="2"/>';
      return b;
    },
    castle: function () {
      var b = '<rect x="48" y="86" width="144" height="88" fill="#C3B49A" stroke="#90836C" stroke-width="2"/>';
      b += '<rect x="34" y="60" width="38" height="114" fill="#D2C4AB" stroke="#90836C" stroke-width="2"/>';
      b += '<rect x="168" y="60" width="38" height="114" fill="#D2C4AB" stroke="#90836C" stroke-width="2"/>';
      for (var i = 0; i < 3; i++) {
        b += '<rect x="' + (34 + i * 14) + '" y="52" width="9" height="10" fill="#90836C"/>';
        b += '<rect x="' + (168 + i * 14) + '" y="52" width="9" height="10" fill="#90836C"/>';
      }
      for (var k = 0; k < 5; k++) b += '<rect x="' + (56 + k * 28) + '" y="78" width="14" height="10" fill="#90836C"/>';
      b += '<path d="M104 174 v-42 a16 16 0 0 1 32 0 v42 Z" fill="#7A6A52"/>';
      b += '<rect x="48" y="104" width="12" height="18" fill="#7A6A52"/><rect x="180" y="104" width="12" height="18" fill="#7A6A52"/>';
      return b;
    },
    ship: function () {
      var b = '<path d="M28 150 q92 34 184 0 l-18 -26 H46 Z" fill="#8A6B4A" stroke="#5F4A32" stroke-width="2"/>';
      b += '<path d="M118 124 V34" stroke="#5F4A32" stroke-width="6"/>';
      b += '<path d="M60 44 H176 V96 H60 Z" fill="#D9684F"/>';
      b += '<path d="M78 44 V96 M118 44 V96 M158 44 V96" stroke="#F4EFE2" stroke-width="7"/>';
      b += '<path d="M28 150 q92 34 184 0" fill="none" stroke="#5F4A32" stroke-width="3"/>';
      b += '<path d="M46 124 l-14 -18" stroke="#5F4A32" stroke-width="5" stroke-linecap="round"/>';
      for (var i = 0; i < 5; i++) b += '<circle cx="' + (62 + i * 24) + '" cy="134" r="7" fill="#C9A227" stroke="#5F4A32" stroke-width="2"/>';
      return b;
    },
    scroll: function () {
      var b = '<rect x="48" y="44" width="144" height="124" rx="4" fill="#F4EBD4" stroke="#C4B288" stroke-width="2"/>';
      for (var i = 0; i < 6; i++) b += '<path d="M66 ' + (66 + i * 18) + ' H' + (174 - (i % 2) * 24) + '" stroke="#C4B288" stroke-width="3" stroke-linecap="round"/>';
      b += '<rect x="36" y="34" width="168" height="16" rx="8" fill="#B08A4E"/>';
      b += '<rect x="36" y="162" width="168" height="16" rx="8" fill="#B08A4E"/>';
      return b;
    },
    shield: function () {
      var b = '<path d="M120 28 L198 54 V112 q0 54 -78 80 q-78 -26 -78 -80 V54 Z" fill="#B23A32" stroke="#7E2822" stroke-width="3"/>';
      b += '<path d="M120 28 L198 54 V112 q0 54 -78 80 Z" fill="#8E2C26"/>';
      b += '<path d="M120 60 l12 28 h30 l-24 20 9 30 -27 -18 -27 18 9 -30 -24 -20 h30 Z" fill="#E8C76A"/>';
      return b;
    },
    train: function () {
      var b = '<rect x="36" y="96" width="120" height="52" rx="6" fill="#2F4858"/>';
      b += '<rect x="150" y="70" width="62" height="78" rx="6" fill="#4A6274"/>';
      b += '<rect x="162" y="84" width="38" height="28" rx="3" fill="#CDE6F0"/>';
      b += '<rect x="56" y="58" width="26" height="40" rx="4" fill="#2F4858"/>';
      b += '<path d="M60 58 q10 -30 28 -24 q-14 10 -8 24 Z" fill="#CFCFCF"/>';
      b += '<rect x="24" y="148" width="200" height="10" rx="4" fill="#6E6257"/>';
      [66, 112, 176].forEach(function (x) {
        b += '<circle cx="' + x + '" cy="158" r="18" fill="#3B3B3B" stroke="#C9A227" stroke-width="3"/>';
      });
      return b;
    },
    rocket: function () {
      var b = '<path d="M120 22 q28 36 28 86 v30 h-56 v-30 q0 -50 28 -86 Z" fill="#F0EBE0" stroke="#A7A094" stroke-width="2"/>';
      b += '<circle cx="120" cy="80" r="15" fill="#3E7FA8" stroke="#A7A094" stroke-width="2"/>';
      b += '<path d="M92 112 l-26 42 h26 Z" fill="#C8453A"/><path d="M148 112 l26 42 h-26 Z" fill="#C8453A"/>';
      b += '<path d="M106 138 h28 v16 h-28 Z" fill="#8A8378"/>';
      b += '<path d="M120 154 q-16 24 0 42 q16 -18 0 -42 Z" fill="#F2A33C"/>';
      return b;
    },
    crown: function () {
      var b = '<path d="M44 148 L36 62 l32 28 L120 42 l52 48 32 -28 -8 86 Z" fill="#E3B23C" stroke="#A9801E" stroke-width="3" stroke-linejoin="round"/>';
      b += '<rect x="44" y="148" width="152" height="18" rx="5" fill="#C99A28" stroke="#A9801E" stroke-width="2"/>';
      b += '<circle cx="120" cy="104" r="11" fill="#B23A32"/><circle cx="76" cy="118" r="8" fill="#2E6E8E"/><circle cx="164" cy="118" r="8" fill="#2E6E8E"/>';
      return b;
    },
    amphora: function () {
      var b = '<path d="M120 36 q-40 22 -40 70 q0 52 40 68 q40 -16 40 -68 q0 -48 -40 -70 Z" fill="#D4A06A" stroke="#9A6E42" stroke-width="2"/>';
      b += '<rect x="104" y="24" width="32" height="18" rx="5" fill="#C08A4E" stroke="#9A6E42" stroke-width="2"/>';
      b += '<path d="M82 62 q-22 10 -8 34 M158 62 q22 10 8 34" stroke="#9A6E42" stroke-width="7" fill="none" stroke-linecap="round"/>';
      b += '<path d="M84 104 H156 M86 122 H154" stroke="#4A3828" stroke-width="5"/>';
      b += '<circle cx="120" cy="140" r="12" fill="#4A3828"/>';
      return b;
    },
    cave: function () {
      var b = '<rect x="30" y="30" width="180" height="150" rx="10" fill="#C4A98A"/>';
      b += '<path d="M70 120 q10 -26 30 -26 q18 0 24 22 l20 -4 q10 20 -4 28 q-30 12 -58 2 q-16 -8 -12 -22 Z" fill="#8A4030"/>';
      b += '<path d="M94 140 l-8 24 M124 142 l6 24 M144 134 l14 18 M74 112 l-16 -14" stroke="#8A4030" stroke-width="5" stroke-linecap="round"/>';
      b += '<path d="M150 70 l22 -14 m-22 14 l24 6" stroke="#5E3A28" stroke-width="4" stroke-linecap="round"/>';
      return b;
    }
  };
  function artifact(name) {
    var inner = (THINGS[name] || THINGS.scroll)();
    var id = 'ar' + K.nextId();
    return svg(240, 210,
      '<defs><clipPath id="' + id + '"><rect x="4" y="4" width="232" height="202" rx="11"/></clipPath></defs>' +
      '<rect x="0" y="0" width="240" height="210" rx="15" fill="#FFFDF7" stroke="#CDBE9B" stroke-width="2"/>' +
      '<g clip-path="url(#' + id + ')"><rect x="4" y="4" width="232" height="202" fill="#EFE6D2"/>' + inner + '</g>');
  }

  /* ---------- structures: hierarchies, flows, charts ---------- */

  /* a pyramid of layers, widest at the bottom */
  function hierarchy(levels) {
    var w = 380, h = 44 * levels.length + 22, top = 70, b = '';
    var n = levels.length;
    levels.forEach(function (l, i) {
      var y = 10 + i * 44, half = (top + (i * (w - 60 - top)) / (n - 1)) / 2 + 30;
      var x1 = w / 2 - half, x2 = w / 2 + half;
      var nhalf = (top + ((i + 1) * (w - 60 - top)) / (n - 1)) / 2 + 30;
      b += poly([[x1, y], [x2, y], [w / 2 + nhalf, y + 40], [w / 2 - nhalf, y + 40]],
        [T.gold, T.red, T.sea, T.moss, T.soft][i % 5], T.card, 2);
      b += txt(w / 2, y + 26, l, { size: 14, weight: 600, fill: T.card });
    });
    return svg(w, h, b);
  }

  /* boxes and arrows: how something gets done, step by step */
  function flow(steps) {
    var bw = 100, bh = 54, gapX = 28, perRow = 4;
    var rows = Math.ceil(steps.length / perRow);
    var w = perRow * bw + (perRow - 1) * gapX + 16, h = rows * (bh + 40) + 6, b = '';
    steps.forEach(function (s, i) {
      var r = Math.floor(i / perRow), c = i % perRow;
      var x = 8 + c * (bw + gapX), y = 6 + r * (bh + 40);
      b += '<rect x="' + x + '" y="' + y + '" width="' + bw + '" height="' + bh + '" rx="10" fill="' + T.card + '" stroke="' + (s === '?' ? T.red : T.sea) + '" stroke-width="2.5"/>';
      b += txt(x + bw / 2, y + bh / 2 + 6, s, { size: 14, weight: 500, fill: s === '?' ? T.red : T.ink });
      if (i < steps.length - 1) {
        if (c < perRow - 1) {
          b += '<path d="M' + (x + bw + 6) + ' ' + (y + bh / 2) + ' H' + (x + bw + gapX - 10) + '" stroke="' + T.soft + '" stroke-width="3"/>';
          b += poly([[x + bw + gapX - 4, y + bh / 2], [x + bw + gapX - 14, y + bh / 2 - 6], [x + bw + gapX - 14, y + bh / 2 + 6]], T.soft);
        } else {
          b += '<path d="M' + (x + bw / 2) + ' ' + (y + bh + 6) + ' V' + (y + bh + 28) + '" stroke="' + T.soft + '" stroke-width="3"/>';
          b += poly([[x + bw / 2, y + bh + 34], [x + bw / 2 - 6, y + bh + 24], [x + bw / 2 + 6, y + bh + 24]], T.soft);
        }
      }
    });
    return svg(w, h, b);
  }

  /* what a price does when supply and demand cross */
  function supplydemand() {
    var w = 330, h = 240, L = 50, B = 190, b = '';
    b += '<path d="M' + L + ' 30 V' + B + ' H' + (w - 20) + '" stroke="' + T.ink + '" stroke-width="2.5" fill="none"/>';
    b += '<path d="M' + (L + 10) + ' ' + (B - 10) + ' L' + (w - 40) + ' 50" stroke="' + T.sea + '" stroke-width="4"/>';
    b += '<path d="M' + (L + 10) + ' 50 L' + (w - 40) + ' ' + (B - 10) + '" stroke="' + T.red + '" stroke-width="4"/>';
    b += '<circle cx="' + ((L + 10 + w - 40) / 2) + '" cy="' + ((B - 10 + 50) / 2) + '" r="7" fill="' + T.gold + '" stroke="' + T.ink + '" stroke-width="2"/>';
    b += txt(w - 36, 44, 'supply', { anchor: 'end', size: 14, fill: T.sea });
    b += txt(w - 36, B - 2, 'demand', { anchor: 'end', size: 14, fill: T.red });
    b += txt(L - 8, 30, 'price', { anchor: 'end', size: 12, mono: true, weight: 400, fill: T.soft });
    b += txt(w - 20, B + 20, 'quantity', { anchor: 'end', size: 12, mono: true, weight: 400, fill: T.soft });
    return svg(w, h, b);
  }

  /* a ballot going into the box */
  function ballot() {
    var w = 280, h = 210, b = '';
    b += '<path d="M50 96 h180 l-14 96 h-152 Z" fill="' + T.sea + '" opacity=".25"/>';
    b += '<path d="M50 96 h180 l-14 96 h-152 Z" fill="none" stroke="' + T.sea + '" stroke-width="3"/>';
    b += '<rect x="104" y="88" width="72" height="12" rx="4" fill="' + T.ink + '"/>';
    b += '<rect x="112" y="24" width="60" height="68" rx="4" fill="' + T.card + '" stroke="' + T.ink + '" stroke-width="2.5" transform="rotate(-8 142 58)"/>';
    b += '<path d="M120 46 h36 M120 60 h36" stroke="' + T.soft + '" stroke-width="3" transform="rotate(-8 142 58)"/>';
    b += '<path d="M124 72 l8 9 16 -19" stroke="' + T.red + '" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round" transform="rotate(-8 142 58)"/>';
    return svg(w, h, b);
  }

  Object.assign(global.ART, {
    card: card, sentence: sentence, passage: passage, wordbuild: wordbuild,
    timeline: timeline, artifact: artifact, hierarchy: hierarchy, flow: flow,
    supplydemand: supplydemand, ballot: ballot
  });
})(window);
