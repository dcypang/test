'use strict';
// ---------------------------------------------------------------------------
// Boot, menus and the main loop
// ---------------------------------------------------------------------------
const App = (() => {
  const $ = id => document.getElementById(id);
  const app = { paused: true, started: false, diff: 'normal', color: 0, speed: 1, errors: [] };
  let ctx, last = 0, acc = 0, ended = false;

  function start(opts) {
    opts = opts || {};
    const enemyColor = app.color === 1 ? 0 : 1;
    newGame(Object.assign({ diff: app.diff, color: app.color, enemyColor }, opts));
    Render.reset(); UI.reset();
    const b = G.map.bases[0];
    View.zoom = Math.min(1, Math.max(0.7, View.W / 1100));
    centerOn(b.x + 1, b.y - 1);
    app.started = true; app.paused = false; ended = false; acc = 0;
    $('menu').hidden = true; $('endscreen').hidden = true; $('paused').hidden = true;
    $('resumebtn').hidden = false; $('startbtn').textContent = 'Restart skirmish';
    Sfx.init(); Sfx.startMusic();
    notify('Raise a Windmill, then a Mint', 'info');
  }

  function togglePause() {
    if (!app.started || (G && G.over)) return;
    app.paused = !app.paused;
    $('menu').hidden = !app.paused;
  }
  function toggleMusic() { Sfx.setMusic(!Sfx.musicOn); $('musicbtn').textContent = 'Music: ' + (Sfx.musicOn ? 'on' : 'off'); }

  function showEnd() {
    ended = true;
    const win = G.over.winner === G.human, demo = G.opts.demo;
    $('endtitle').textContent = demo ? G.players[G.over.winner].col.name + ' wins' : win ? 'Victory' : 'Defeat';
    $('endsub').textContent = (demo ? 'The battle is over' : win ? 'The enemy’s holdings lie in ruin.' : 'Your last building has fallen.') + ' Time ' + fmtTime(G.over.time) + '.';
    const a = G.players[0], b = G.players[1], row = (l, k) => `<tr><td>${l}</td><td>${Math.round(a.stats[k])}</td><td>${Math.round(b.stats[k])}</td></tr>`;
    $('endstats').innerHTML = `<tr><th></th><th>${demo ? a.col.name : 'You'}</th><th>${demo ? b.col.name : 'Enemy'}</th></tr>` +
      row('Coin earned', 'earned') + row('Buildings raised', 'built') + row('Troops trained', 'trained') + row('Enemies slain', 'kills') + row('Buildings razed', 'razed') + row('Losses', 'lost');
    $('endscreen').hidden = false;
    Sfx.play(win || demo ? 'age' : 'siren');
  }

  function frame(ts) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (ts - last) / 1000 || 0);
    last = ts;
    if (!G) return;
    try {
      if (!app.paused && !G.over) {
        acc += dt * app.speed;
        let n = 0;
        while (acc >= STEP && n < 40) { stepGame(STEP); acc -= STEP; n++; }
        if (n >= 40) acc = 0;
      }
      UI.update(dt);
      Render.draw(ctx, UI.ui);
      if (G.over && !ended) showEnd();
    } catch (e) {
      if (app.errors.length < 20) { app.errors.push(String(e && e.stack || e)); console.error(e); }
    }
  }

  function init() {
    UI.init();
    ctx = UI.view.getContext('2d');
    // menu wiring
    for (const b of $('diffrow').querySelectorAll('button')) b.onclick = () => { app.diff = b.dataset.diff; for (const o of $('diffrow').querySelectorAll('button')) o.classList.toggle('on', o === b); };
    TEAM_COLORS.forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'sw' + (i === 0 ? ' on' : ''); b.style.background = c.main; b.title = c.name; b.setAttribute('aria-label', c.name);
      b.onclick = () => { app.color = i; for (const o of $('colrow').querySelectorAll('.sw')) o.classList.toggle('on', o === b); };
      $('colrow').appendChild(b);
    });
    $('startbtn').onclick = () => start();
    $('resumebtn').onclick = () => togglePause();
    $('againbtn').onclick = () => { $('endscreen').hidden = true; $('menu').hidden = false; app.paused = true; };
    $('demobtn').onclick = () => start({ demo: true, reveal: true });
    $('musicbtn').onclick = () => { Sfx.init(); toggleMusic(); };
    $('sfxbtn').onclick = () => { Sfx.init(); Sfx.setSfx(!Sfx.sfxOn); $('sfxbtn').textContent = 'Sound: ' + (Sfx.sfxOn ? 'on' : 'off'); };
    document.addEventListener('visibilitychange', () => { last = performance.now(); });
    // a quiet battle behind the title screen
    newGame({ diff: 'normal', color: 0, enemyColor: 1, demo: true, reveal: true });
    centerOn(G.map.bases[0].x + 4, G.map.bases[0].y - 4);
    app.paused = false; app.speed = 1;
    // URL switches used for testing: ?auto=1&demo=1&reveal=1&speed=8&seed=42&diff=hard
    const q = new URLSearchParams(location.search);
    if (q.get('speed')) app.speed = Math.max(0.25, +q.get('speed') || 1);
    if (q.get('diff') && DIFFS[q.get('diff')]) app.diff = q.get('diff');
    if (q.get('auto')) start({ demo: !!q.get('demo'), reveal: !!q.get('reveal'), seed: q.get('seed') ? +q.get('seed') : undefined });
    requestAnimationFrame(frame);
  }

  app.start = start; app.togglePause = togglePause; app.toggleMusic = toggleMusic;
  window.addEventListener('DOMContentLoaded', init);
  return app;
})();
