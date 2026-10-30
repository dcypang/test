/* Small DOM helpers and the icon set shared by the app and exercises. */
window.TimbreUI = (function () {
  const svg = (paths) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

  const icons = {
    today: svg('<path d="M3 12h3l3-8 4 16 3-8h5"/>'),
    course: svg('<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/><path d="M9 7h6"/>'),
    lab: svg('<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><path d="M12 17v4"/><path d="M8 21h8"/>'),
    progress: svg('<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>'),
    user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
    close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
    back: svg('<path d="M15 18l-6-6 6-6"/>'),
    chevron: svg('<path d="M9 18l6-6-6-6"/>'),
    check: svg('<path d="M5 12l5 5L20 7"/>'),
    flame: svg('<path d="M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-6 0 2 1 3 2 3 0-3-1-6 1-9z"/>'),
    star: svg('<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>'),
    mic: svg('<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><path d="M12 17v4"/>'),
    play: svg('<path d="M7 4l13 8-13 8z" fill="currentColor"/>'),
    stop: svg('<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>'),
    wind: svg('<path d="M3 8h11a3 3 0 1 0-3-3"/><path d="M3 12h16a3 3 0 1 1-3 3"/><path d="M3 16h7"/>'),
    sliders: svg('<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3"/><path d="M1 14h6M9 8h6M17 16h6"/>'),
    wave: svg('<path d="M2 12h2M6 8v8M10 5v14M14 8v8M18 10v4M22 12h0"/>'),
    gauge: svg('<path d="M12 14l4-4"/><path d="M3.3 19a10 10 0 1 1 17.4 0"/>'),
    upload: svg('<path d="M12 16V4"/><path d="M7 9l5-5 5 5"/><path d="M4 20h16"/>'),
    quiz: svg('<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h0"/>'),
    timer: svg('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M9 2h6"/>'),
    volume: svg('<path d="M11 5L6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/>'),
    lips: svg('<path d="M2 12c3-5 6-5 10-3 4-2 7-2 10 3-3 5-7 7-10 7s-7-2-10-7z"/><path d="M2 12h20"/>'),
    heart: svg('<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z"/>'),
    lightbulb: svg('<path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/>'),
    medal: svg('<circle cx="12" cy="15" r="6"/><path d="M8.5 10L5 2h4l3 6 3-6h4l-3.5 8"/>'),
  };

  // Each module gets an icon that matches its subject.
  const moduleIcons = {
    breath: 'wind', warmup: 'heart', resonance: 'wave', pitch: 'sliders',
    melody: 'today', diction: 'lips', pace: 'timer', projection: 'volume', presence: 'star',
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function el(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function toast(msg) {
    document.querySelectorAll('.toast').forEach((n) => n.remove());
    const n = el(`<div class="toast" role="status">${esc(msg)}</div>`);
    document.body.appendChild(n);
    setTimeout(() => n.remove(), 2600);
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function fmtTime(secs) {
    const s = Math.max(0, Math.round(secs));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  return { icons, moduleIcons, esc, el, toast, cssVar, fmtTime, shuffle };
})();
