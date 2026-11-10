'use strict';
// ---------------------------------------------------------------------------
// Input (mouse, touch, keyboard), selection, orders, and the command sidebar
// ---------------------------------------------------------------------------
const UI = (() => {
  const $ = id => document.getElementById(id);
  const ui = {
    sel: [], selSet: new Set(), mode: null, tab: 'build', markers: [], box: null, hoverId: 0,
    mouse: { x: 0, y: 0, inside: false }, groups: {}, boxMode: false, keys: {},
  };
  let view, mm, P = null, pinch = null, gridSig = '', items = {}, msgSig = '', selSig = '', timerSig = '', lastClick = { t: 0, id: 0 }, frameN = 0, tipLock = 0;
  const touches = new Map();
  const me = () => G.players[G.human];
  const PROD = { barracks: 1, stable: 1, siegeworks: 1 };

  function setSel(ids) { ui.sel = ids; ui.selSet = new Set(ids); selSig = ''; }
  function setMode(m) {
    ui.mode = m;
    $('sellbtn').classList.toggle('on', !!m && m.t === 'sell');
    $('repairbtn').classList.toggle('on', !!m && m.t === 'repair');
    view.style.cursor = m ? (m.t === 'place' ? 'cell' : 'crosshair') : 'default';
    document.querySelector('#touchbar [data-act=amove]').classList.toggle('on', !!m && m.t === 'amove');
  }
  function mark(x, y, col) { ui.markers.push({ x, y, col, t: performance.now() }); if (ui.markers.length > 12) ui.markers.shift(); }
  function tip(html, lock) { $('tip').innerHTML = html; if (lock) tipLock = performance.now() + 2200; }
  function err(why) { tip('<span class="w">' + why + '</span>', true); Sfx.play('error'); }

  function resize() {
    const r = view.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    View.W = Math.max(50, r.width); View.H = Math.max(50, r.height); View.dpr = dpr;
    view.width = Math.round(View.W * dpr); view.height = Math.round(View.H * dpr);
  }

  // ---- picking & selection -----------------------------------------------
  function pick(sx, sy) {
    const n = G.map.n, z = View.zoom;
    let best = null, bd = 1e9;
    for (const u of G.units) {
      if (u.owner !== G.human && !G.vis[clamp(Math.floor(u.y), 0, n - 1) * n + clamp(Math.floor(u.x), 0, n - 1)]) continue;
      const q = w2s(u.x, u.y), big = u.def.armor !== 'foot';
      const dx = sx - q[0], dy = sy - (q[1] - (big ? 12 : 9) * z), r = (big ? 16 : 12) * z;
      const d2 = dx * dx + dy * dy;
      if (d2 < r * r && d2 < bd) { bd = d2; best = u; }
    }
    if (best) return best;
    let bb = null, dep = -1;
    for (const b of G.blds) {
      if (b.owner !== G.human && !G.explored[clamp(Math.floor(b.y), 0, n - 1) * n + clamp(Math.floor(b.x), 0, n - 1)]) continue;
      const q = w2s(b.x, b.y), half = (b.w + b.h) * 16 * z;
      if (sx < q[0] - half || sx > q[0] + half) continue;
      const fx = Math.abs(sx - q[0]) / half;
      const top = q[1] - half / 2 - b.def.tall * z * 0.85 + fx * half * 0.5, bot = q[1] + half / 2 - fx * half * 0.5;
      if (sy < top || sy > bot) continue;
      if (b.x + b.y > dep) { dep = b.x + b.y; bb = b; }
    }
    return bb;
  }
  function ownSel() { return ui.sel.map(id => G.byId.get(id)).filter(e => e && !e.dead && e.owner === G.human); }

  function boxSelect(b, add) {
    const ids = add ? ui.sel.slice() : [];
    for (const u of G.units) {
      if (u.owner !== G.human) continue;
      const q = w2s(u.x, u.y);
      if (q[0] >= b.x0 && q[0] <= b.x1 && q[1] - 8 >= b.y0 && q[1] - 8 <= b.y1 && !ids.includes(u.id)) ids.push(u.id);
    }
    if (ids.length) {
      // prefer soldiers over carts when both are boxed
      const army = ids.filter(id => { const u = G.byId.get(id); return u && u.kind === 'u' && !u.def.cart; });
      setSel(army.length ? army : ids); Sfx.play('select');
    } else if (!add) setSel([]);
  }
  function selectArmy() {
    const ids = G.units.filter(u => u.owner === G.human && (u.def.weapon || u.def.heal)).map(u => u.id);
    setSel(ids); if (ids.length) Sfx.play('select');
  }

  // ---- orders -------------------------------------------------------------
  function formation(units, x, y, fn) {
    const n = units.length, cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols), sp = 0.8;
    units.forEach((u, k) => fn(u, x + (k % cols - (cols - 1) / 2) * sp, y + (Math.floor(k / cols) - (rows - 1) / 2) * sp));
  }
  function command(w, e) {
    const own = ownSel(), units = own.filter(o => o.kind === 'u'), blds = own.filter(o => o.kind === 'b');
    const m = G.map, n = m.n;
    if (!units.length) {
      const pr = blds.filter(b => PROD[b.type]);
      if (!pr.length) return false;
      for (const b of pr) { b.rally = { x: w.x, y: w.y }; me().primary[b.type] = b.id; }
      mark(w.x, w.y, '#ffe27a'); Sfx.play('order'); return true;
    }
    if (e && e.owner !== G.human) {
      for (const u of units) {
        if (u.def.capture && e.kind === 'b') orderCapture(u, e);
        else if (u.def.weapon) orderAttack(u, e);
        else if (!u.def.cart) orderMove(u, e.x, e.y);
      }
      mark(e.x, e.y, '#ff5a46');
    } else if (e && e.kind === 'b') {
      for (const u of units) {
        if (u.def.capture && e.hp < e.maxHp) orderCapture(u, e);
        else if (u.def.cart && e.type === 'mint' && e.built >= 1) { orderReturn(u); u.order.mint = e.id; }
        else orderMove(u, w.x, w.y);
      }
      mark(e.x, e.y, '#8fe3a4');
    } else {
      const tx = Math.floor(w.x), ty = Math.floor(w.y), gi = m.inb(tx, ty) ? ty * n + tx : -1;
      const onGold = gi >= 0 && m.gold[gi] > 0;
      const movers = [];
      for (const u of units) { if (u.def.cart && onGold) orderHarvest(u, gi); else movers.push(u); }
      formation(movers, w.x, w.y, (u, x, y) => orderMove(u, x, y));
      mark(w.x, w.y, onGold && movers.length < units.length ? '#f0c33c' : '#8fe3a4');
    }
    Sfx.play('order');
    return true;
  }
  function attackMove(w) {
    const units = ownSel().filter(o => o.kind === 'u');
    formation(units, w.x, w.y, (u, x, y) => orderAMove(u, x, y));
    mark(w.x, w.y, '#ff5a46'); if (units.length) Sfx.play('order');
  }
  function stopSel() { for (const u of ownSel()) if (u.kind === 'u') setIdle(u); }
  function deploySel() {
    for (const u of ownSel()) {
      if (u.kind === 'u' && u.def.deploy) { if (deployWagon(u)) { setSel([]); return; } err('No room to unpack the wagon here'); return; }
    }
  }

  function placeAt(sx, sy, again) {
    const mode = ui.mode, d = BUILDINGS[mode.type], w = s2w(sx, sy);
    mode.tx = Math.round(w.x - d.w / 2); mode.ty = Math.round(w.y - d.h / 2);
    const p = me();
    if (p.queues[mode.cat].ready !== mode.type) { setMode(null); return; }
    const b = placeReady(p, mode.cat, mode.tx, mode.ty);
    if (!b) { err('Cannot build there — keep it close to your buildings and off gold, water and trees'); return; }
    const type = mode.type;
    setMode(null);
    if (again && queueItem(p, type).ok) tip('Queued another ' + d.name, true);
  }

  function handleClick(sx, sy, o) {
    const w = s2w(sx, sy), mode = ui.mode;
    if (mode) {
      const e = pick(sx, sy);
      switch (mode.t) {
        case 'place': placeAt(sx, sy, o.shift); return;
        case 'sell': if (e && e.kind === 'b' && e.owner === G.human) { if (!sellBuilding(e)) err('Not finished yet'); } else setMode(null); return;
        case 'repair': if (e && e.kind === 'b' && e.owner === G.human) { if (e.hp < e.maxHp) { e.repairing = !e.repairing; Sfx.play('click'); } else err('No damage to mend'); } else setMode(null); return;
        case 'amove': attackMove(w); setMode(null); return;
        case 'super': {
          const p = me(), b = G.blds.find(x => x.owner === p.id && x.type === 'skyfire' && x.charge >= SKY_T);
          if (b && launchSkyfire(p, b, w.x, w.y)) mark(w.x, w.y, '#ff5a46'); else err('Skyfire is not ready');
          setMode(null); return;
        }
        case 'hawk': if (useHawk(me(), w.x, w.y)) { Sfx.play('order'); mark(w.x, w.y, '#ffe27a'); } else err('Hawk’s Eye is not ready'); setMode(null); return;
      }
    }
    const e = pick(sx, sy);
    if (e && e.owner === G.human) {
      const now = performance.now();
      if (lastClick.id === e.id && now - lastClick.t < 380 && e.kind === 'u') {
        const ids = G.units.filter(u => { if (u.owner !== G.human || u.type !== e.type) return false; const q = w2s(u.x, u.y); return q[0] > -20 && q[0] < View.W + 20 && q[1] > -20 && q[1] < View.H + 20; }).map(u => u.id);
        setSel(ids);
      } else if (o.shift) {
        const ids = ui.sel.slice(), i = ids.indexOf(e.id);
        if (i >= 0) ids.splice(i, 1); else ids.push(e.id);
        setSel(ids);
      } else {
        // touch: tapping an own building with units selected is an order (repair / unload), otherwise select
        if (o.touch && e.kind === 'b' && ownSel().some(u => u.kind === 'u' && (u.def.capture || u.def.cart))) { command(w, e); lastClick = { t: now, id: e.id }; return; }
        setSel([e.id]);
        if (e.kind === 'b' && PROD[e.type]) me().primary[e.type] = e.id;
      }
      lastClick = { t: now, id: e.id };
      Sfx.play('select');
      return;
    }
    if (o.touch && ownSel().length) { if (command(w, e)) return; }
    if (e) { setSel([e.id]); return; }
    if (!o.shift) setSel([]);
  }

  function rightClick(sx, sy) {
    if (ui.mode) { setMode(null); return; }
    const w = s2w(sx, sy);
    command(w, pick(sx, sy));
  }

  // ---- pointer input ------------------------------------------------------
  function pos(e) { const r = view.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function zoomAt(sx, sy, z) {
    const w = s2w(sx, sy);
    View.zoom = clamp(z, 0.5, 1.7);
    View.x = (w.x - w.y) * HW - (sx - View.W / 2) / View.zoom;
    View.y = (w.x + w.y) * HH - (sy - View.H / 2) / View.zoom;
    clampView();
  }
  function bindView() {
    view.addEventListener('contextmenu', e => e.preventDefault());
    view.addEventListener('pointerdown', e => {
      Sfx.init();
      const m = pos(e), touch = e.pointerType === 'touch';
      if (touch) { document.body.classList.add('touch'); touches.set(e.pointerId, m); }
      try { view.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
      ui.mouse.x = m.x; ui.mouse.y = m.y; ui.mouse.inside = true;
      if (touch && touches.size === 2) {
        const [a, b] = [...touches.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: View.zoom }; P = null; ui.box = null; return;
      }
      P = { id: e.pointerId, sx: m.x, sy: m.y, btn: e.button, touch, moved: false, cx: View.x, cy: View.y, shift: e.shiftKey };
      if (e.button === 1) e.preventDefault();
    });
    view.addEventListener('pointermove', e => {
      const m = pos(e);
      if (e.pointerType === 'touch') {
        if (touches.has(e.pointerId)) touches.set(e.pointerId, m);
        if (pinch && touches.size >= 2) {
          const [a, b] = [...touches.values()];
          zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, pinch.z * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d);
          return;
        }
      }
      if (m.x !== ui.mouse.x || m.y !== ui.mouse.y) ui.mouse.moved = true;
      ui.mouse.x = m.x; ui.mouse.y = m.y; ui.mouse.inside = true; ui.mouse.touch = e.pointerType === 'touch';
      if (ui.mode && ui.mode.t === 'place') {
        const d = BUILDINGS[ui.mode.type], w = s2w(m.x, m.y);
        ui.mode.tx = Math.round(w.x - d.w / 2); ui.mode.ty = Math.round(w.y - d.h / 2);
      }
      if (!P || P.id !== e.pointerId) return;
      const dx = m.x - P.sx, dy = m.y - P.sy;
      if (!P.moved && Math.hypot(dx, dy) > (P.touch ? 10 : 5)) P.moved = true;
      if (!P.moved) return;
      const panning = P.btn === 1 || (P.touch && !ui.boxMode) || (P.btn === 2);
      if (panning) { View.x = P.cx - dx / View.zoom; View.y = P.cy - dy / View.zoom; clampView(); }
      else if (P.btn === 0 && !ui.mode) ui.box = { x0: Math.min(P.sx, m.x), y0: Math.min(P.sy, m.y), x1: Math.max(P.sx, m.x), y1: Math.max(P.sy, m.y) };
    });
    const up = e => {
      const m = pos(e);
      if (e.pointerType === 'touch') { touches.delete(e.pointerId); if (touches.size < 2) pinch = null; }
      if (!P || P.id !== e.pointerId) return;
      const p = P; P = null;
      if (e.type === 'pointercancel') { ui.box = null; return; }
      if (ui.box) { boxSelect(ui.box, p.shift); ui.box = null; if (p.touch) { ui.boxMode = false; document.querySelector('#touchbar [data-act=box]').classList.remove('on'); } return; }
      if (p.moved) return;
      if (p.btn === 0) handleClick(m.x, m.y, { shift: e.shiftKey, touch: p.touch });
      else if (p.btn === 2) rightClick(m.x, m.y);
    };
    view.addEventListener('pointerup', up);
    view.addEventListener('pointercancel', up);
    view.addEventListener('pointerleave', () => { ui.mouse.inside = false; });
    view.addEventListener('wheel', e => { e.preventDefault(); const m = pos(e); zoomAt(m.x, m.y, View.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)); }, { passive: false });

    // minimap
    const mmGo = (e, order) => {
      const p = me();
      if (!(p.has.beacon && !p.lowGrain) && !G.opts.reveal) return;
      const r = mm.getBoundingClientRect();
      const w = Render.mmInv(mm, (e.clientX - r.left) / r.width * mm.width, (e.clientY - r.top) / r.height * mm.height);
      if (order) { command(w, null); } else centerOn(w.x, w.y);
    };
    let mmDown = false;
    mm.addEventListener('contextmenu', e => { e.preventDefault(); mmGo(e, true); });
    mm.addEventListener('pointerdown', e => { if (e.button === 0) { mmDown = true; try { mm.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ } mmGo(e); } });
    mm.addEventListener('pointermove', e => { if (mmDown) mmGo(e); });
    mm.addEventListener('pointerup', () => { mmDown = false; });
    mm.addEventListener('pointercancel', () => { mmDown = false; });
  }

  // ---- keyboard -----------------------------------------------------------
  function bindKeys() {
    window.addEventListener('keydown', e => {
      if (!G || e.target.tagName === 'INPUT') return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      ui.keys[k] = true;
      if (k.startsWith('Arrow') || k === ' ') e.preventDefault();
      if (k === 'p') { App.togglePause(); return; }
      if (k === 'Escape') { if (ui.mode) setMode(null); else if (ui.sel.length) setSel([]); else App.togglePause(); return; }
      if (App.paused || G.over) return;
      if (k >= '1' && k <= '9') {
        if (e.ctrlKey || e.metaKey) { ui.groups[k] = ownSel().map(o => o.id); e.preventDefault(); }
        else if (ui.groups[k]) {
          const ids = ui.groups[k].filter(id => { const o = G.byId.get(id); return o && !o.dead; });
          if (ids.length) { if (ui.sel.join() === ids.join()) { const o = G.byId.get(ids[0]); centerOn(o.x, o.y); } setSel(ids); }
        }
        return;
      }
      if (e.ctrlKey || e.metaKey) { if (k === 'a') { selectArmy(); e.preventDefault(); } return; }
      switch (k) {
        case 'q': setTab('build'); break; case 'w': setTab('defense'); break; case 'e': setTab('foot'); break; case 'r': setTab('mount'); break;
        case 'a': if (ownSel().some(o => o.kind === 'u')) setMode({ t: 'amove' }); break;
        case 's': stopSel(); break;
        case 'd': deploySel(); break;
        case 'k': setMode(ui.mode && ui.mode.t === 'repair' ? null : { t: 'repair' }); break;
        case 'z': setMode(ui.mode && ui.mode.t === 'sell' ? null : { t: 'sell' }); break;
        case 'h': { const b = G.blds.find(x => x.owner === G.human && x.type === 'keep') || G.blds.find(x => x.owner === G.human); if (b) centerOn(b.x, b.y); break; }
        case ' ': if (G.lastEvent) centerOn(G.lastEvent.x, G.lastEvent.y); break;
        case 'm': App.toggleMusic(); break;
      }
    });
    window.addEventListener('keyup', e => { ui.keys[e.key.length === 1 ? e.key.toLowerCase() : e.key] = false; });
    window.addEventListener('blur', () => { ui.keys = {}; });
  }

  // ---- sidebar ------------------------------------------------------------
  function setTab(t) {
    ui.tab = t; gridSig = '';
    for (const b of $('tabs').children) b.classList.toggle('on', b.dataset.tab === t);
  }
  function itemTip(type) {
    const d = defOf(type), p = me(), a = availability(p, type);
    let s = `<b>${d.name}</b> <span class="c">${d.cost}</span>`;
    if (d.grain) s += ` &middot; grain ${d.grain > 0 ? '+' + d.grain : d.grain}`;
    if (d.weapon) s += ` &middot; range ${d.weapon.range}`;
    s += `<br>${d.desc}`;
    if (!a.ok) s += `<br><span class="w">${a.why}</span>`;
    return s;
  }
  function onItem(type, shift) {
    const p = me(), cat = catOf(type), q = p.queues[cat];
    if ((cat === 'build' || cat === 'defense') && q.ready === type) { setMode({ t: 'place', type, cat, tx: -9, ty: -9 }); Sfx.play('click'); tip('Click the map to place the ' + defOf(type).name + '. Right-click or Esc to back out.', true); return; }
    const n = shift && defOf(type).kind === 'u' ? 5 : 1;
    for (let i = 0; i < n; i++) { const r = queueItem(p, type); if (!r.ok) { if (i === 0) err(r.why); return; } }
    Sfx.play('click');
  }
  function onCancel(type) { if (cancelItem(me(), type)) { Sfx.play('click'); if (ui.mode && ui.mode.t === 'place' && ui.mode.type === type) setMode(null); } }

  function rebuildGrid() {
    const p = me(), grid = $('grid');
    grid.innerHTML = ''; items = {};
    const all = Object.values(BUILDINGS).concat(Object.values(UNITS)).filter(d => d.tab === ui.tab && d.age <= p.age + 1);
    for (const d of all) {
      const a = availability(p, d.id);
      const el = document.createElement('div');
      el.className = 'item' + (a.ok ? '' : ' locked'); el.dataset.type = d.id;
      const ic = Art.icon(d.id, p.col), cv = document.createElement('canvas');
      cv.width = ic.width; cv.height = ic.height; cv.getContext('2d').drawImage(ic, 0, 0);
      el.appendChild(cv);
      el.insertAdjacentHTML('beforeend', `<i class="prog"></i><span class="tag"></span><span class="cnt"></span><span class="nm">${d.name}</span><span class="ct">${d.cost}</span>`);
      grid.appendChild(el);
      items[d.id] = { el, tag: el.querySelector('.tag'), cnt: el.querySelector('.cnt'), ok: a.ok, st: '' };
    }
  }
  function bindSidebar() {
    const tabs = $('tabs');
    for (const t of TABS) { const b = document.createElement('button'); b.dataset.tab = t.id; b.innerHTML = `${t.label}<span class="k">${t.key}</span>`; b.onclick = () => { setTab(t.id); Sfx.play('click'); }; tabs.appendChild(b); }
    setTab('build');
    const grid = $('grid');
    let lp = null, lpFired = false;
    const itemOf = e => { const el = e.target.closest('.item'); return el ? el.dataset.type : null; };
    grid.addEventListener('click', e => { const t = itemOf(e); if (!t) return; if (lpFired) { lpFired = false; return; } Sfx.init(); tip(itemTip(t)); onItem(t, e.shiftKey); });
    grid.addEventListener('contextmenu', e => { e.preventDefault(); const t = itemOf(e); if (t && !lpFired) onCancel(t); });
    grid.addEventListener('pointerdown', e => { const t = itemOf(e); lpFired = false; clearTimeout(lp); if (t && e.pointerType === 'touch') lp = setTimeout(() => { lpFired = true; onCancel(t); tip('Cancelled ' + defOf(t).name, true); }, 550); });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) grid.addEventListener(ev, () => clearTimeout(lp));
    grid.addEventListener('pointerover', e => { const t = itemOf(e); if (t && performance.now() > tipLock) tip(itemTip(t)); });

    $('sellbtn').onclick = () => { setMode(ui.mode && ui.mode.t === 'sell' ? null : { t: 'sell' }); Sfx.play('click'); };
    $('repairbtn').onclick = () => { setMode(ui.mode && ui.mode.t === 'repair' ? null : { t: 'repair' }); Sfx.play('click'); };
    $('menubtn').onclick = () => App.togglePause();
    $('agebtn').onclick = () => { const r = startAgeUp(me()); if (!r.ok) err(r.why); else { Sfx.play('click'); tip('Advancing to the ' + AGES[me().age + 1].name + '…', true); } };
    $('agebtn').addEventListener('pointerover', () => {
      const p = me(), s = ageUpStatus(p);
      if (s.done) tip('<b>' + AGES[p.age].name + '</b><br>The final age.');
      else { const a = AGES[p.age + 1]; tip(`<b>Advance to the ${a.name}</b> <span class="c">${a.cost}</span><br>Unlocks new buildings, troops and engines.` + (s.ok || s.busy ? '' : `<br><span class="w">${s.why}</span>`)); }
    });
    $('hawkbtn').onclick = () => { const p = me(); if (p.hawkCd > 0 || p.lowGrain) err('Hawk’s Eye is not ready'); else { setMode({ t: 'hawk' }); tip('Pick a spot for the hawk to scout.', true); } };
    $('hawkbtn').addEventListener('pointerover', () => tip('<b>Hawk’s Eye</b><br>Reveals a wide area anywhere on the map for a short while.'));
    $('skybtn').onclick = () => { const p = me(); if (G.blds.some(b => b.owner === p.id && b.type === 'skyfire' && b.charge >= SKY_T) && !p.lowGrain) { setMode({ t: 'super' }); tip('Pick a target for the Skyfire barrage.', true); } else err('Skyfire is not ready'); };
    $('skybtn').addEventListener('pointerover', () => tip('<b>Skyfire barrage</b><br>Fourteen rockets rain on the chosen ground. Needs a charged Skyfire Battery and grain.'));

    $('touchbar').addEventListener('click', e => {
      const a = e.target.dataset.act; if (!a) return;
      Sfx.init(); Sfx.play('click');
      if (a === 'box') { ui.boxMode = !ui.boxMode; e.target.classList.toggle('on', ui.boxMode); }
      else if (a === 'army') selectArmy();
      else if (a === 'amove') { if (ownSel().some(o => o.kind === 'u')) setMode(ui.mode && ui.mode.t === 'amove' ? null : { t: 'amove' }); }
      else if (a === 'stop') stopSel();
      else if (a === 'none') { setSel([]); setMode(null); }
    });
    $('selinfo').addEventListener('click', e => {
      const a = e.target.dataset.act; if (!a) return;
      Sfx.play('click');
      const own = ownSel();
      if (a === 'stop') stopSel();
      else if (a === 'amove') setMode({ t: 'amove' });
      else if (a === 'deploy') deploySel();
      else if (a === 'sell') { for (const b of own) if (b.kind === 'b') sellBuilding(b); setSel([]); }
      else if (a === 'repair') { for (const b of own) if (b.kind === 'b' && b.hp < b.maxHp) b.repairing = !b.repairing; selSig = ''; }
    });
  }

  function updateSidebar() {
    const p = me();
    $('coin').textContent = Math.floor(p.shown).toLocaleString('en-US');
    const gr = $('grainrow');
    gr.classList.toggle('low', p.lowGrain);
    $('grainuse').style.width = clamp(p.grainUse / Math.max(p.grainMake, 1) * 100, 0, 100) + '%';
    $('graintxt').textContent = p.grainUse + '/' + p.grainMake;

    const online = !!(G.opts.reveal || (p.has.beacon && !p.lowGrain));
    $('mmoff').hidden = online;
    if (!online) $('mmoff').innerHTML = p.has.beacon ? 'Minimap dark<br><small>Not enough grain</small>' : 'Minimap dark<br><small>Raise a Beacon Tower</small>';
    if (frameN % 4 === 0) Render.minimap(mm, online);

    // age / powers
    const ab = $('agebtn'), s = ageUpStatus(p);
    ab.querySelector('.pl').textContent = AGES[p.age].name;
    ab.querySelector('.pv').textContent = s.done ? 'Final age' : s.busy ? Math.floor(p.ageUp.progress * 100) + '%' : 'Advance · ' + AGES[p.age + 1].cost;
    ab.querySelector('.pp').style.width = (s.busy ? p.ageUp.progress * 100 : 0) + '%';
    ab.classList.toggle('off', !s.ok && !s.busy);
    const hb = $('hawkbtn'); hb.hidden = !p.has.beacon;
    if (p.has.beacon) { const rdy = p.hawkCd <= 0 && !p.lowGrain; hb.querySelector('.pv').textContent = rdy ? 'Ready' : p.lowGrain ? 'No grain' : fmtTime(p.hawkCd); hb.classList.toggle('off', !rdy); hb.querySelector('.pp').style.width = (1 - clamp(p.hawkCd / HAWK_T, 0, 1)) * 100 + '%'; }
    const sb = $('skybtn'); sb.hidden = !p.has.skyfire;
    let tm = '';
    let bestOwn = -1;
    for (const b of G.blds) {
      if (b.type !== 'skyfire' || b.built < 1) continue;
      const mine = b.owner === G.human, rdy = b.charge >= SKY_T;
      if (mine) bestOwn = Math.max(bestOwn, b.charge);
      tm += `<div class="${mine ? '' : 'foe'}${rdy ? ' rdy' : ''}">${mine ? 'Skyfire' : 'Enemy Skyfire'} ${rdy ? 'READY' : fmtTime(SKY_T - b.charge)}</div>`;
    }
    if (tm !== timerSig) { timerSig = tm; $('timers').innerHTML = tm; }
    if (p.has.skyfire) { const rdy = bestOwn >= SKY_T && !p.lowGrain; sb.querySelector('.pv').textContent = rdy ? 'Ready' : p.lowGrain ? 'No grain' : fmtTime(SKY_T - bestOwn); sb.classList.toggle('go', rdy); sb.querySelector('.pp').style.width = clamp(bestOwn / SKY_T, 0, 1) * 100 + '%'; }

    // build grid
    const sig = ui.tab + '|' + p.age + '|' + Object.keys(p.has).sort().join(',') + '|' + p.col.main;
    if (sig !== gridSig) { gridSig = sig; rebuildGrid(); }
    const q = p.queues[ui.tab], isB = ui.tab === 'build' || ui.tab === 'defense';
    const counts = {};
    for (const it of q.items) counts[it.type] = (counts[it.type] || 0) + 1;
    for (const type in items) {
      const it = items[type], first = q.items[0];
      let st = '', tag = '', cnt = '';
      if (isB) {
        if (q.ready === type) { st = 'ready'; tag = 'READY'; }
        else if (first && first.type === type) { st = 'active'; tag = first.stalled ? 'NO COIN' : ''; it.el.style.setProperty('--p', (first.progress * 100).toFixed(1)); }
        else if (q.ready || first) st = 'busy';
      } else {
        if (counts[type]) cnt = String(counts[type]);
        if (first && first.type === type) { st = 'active'; tag = first.stalled ? 'NO COIN' : ''; it.el.style.setProperty('--p', (first.progress * 100).toFixed(1)); }
      }
      const key = st + tag + cnt;
      if (key !== it.st) {
        it.st = key;
        it.el.className = 'item' + (it.ok ? '' : ' locked') + (st ? ' ' + st : '');
        it.tag.textContent = tag; it.cnt.textContent = cnt;
      }
    }
    for (const b of $('tabs').children) { const tq = p.queues[b.dataset.tab]; b.classList.toggle('ping', !!tq.ready); }

    // messages
    const live = G.msgs.filter(m => G.time - m.t < 6).slice(-4);
    const ms = live.map(m => m.t + m.text).join('|');
    if (ms !== msgSig) { msgSig = ms; $('msgs').innerHTML = live.map(m => `<div class="${m.kind}">${m.text}</div>`).join(''); }

    // selection panel
    const sel = ui.sel.map(id => G.byId.get(id)).filter(e => e && !e.dead);
    if (sel.length !== ui.sel.length) setSel(sel.map(e => e.id));
    const si = $('selinfo');
    let ss = sel.map(e => e.id).join(',');
    if (sel.length === 1) ss += ':' + Math.ceil(sel[0].hp) + ':' + sel[0].vet + ':' + sel[0].repairing + ':' + sel[0].owner + ':' + Math.floor((sel[0].cargo || 0) / 25);
    if (ss !== selSig) {
      selSig = ss;
      if (!sel.length) si.hidden = true;
      else {
        si.hidden = false;
        let h = '';
        if (sel.length === 1) {
          const e = sel[0], d = e.def, mine = e.owner === G.human;
          h = `<b>${mine ? '' : 'Enemy '}${d.name}</b>${e.vet ? (e.vet === 2 ? ' ★ Elite' : ' ☆ Veteran') : ''} <span class="hp">${Math.ceil(e.hp)}/${e.maxHp}</span>`;
          if (d.cart) h += ` <span class="d">&middot; load ${Math.round(e.cargo)}/${CART_CAP}</span>`;
          h += `<div class="d">${d.desc}</div>`;
          if (mine && e.kind === 'u') h += '<button data-act="stop">Stop (S)</button>' + (d.weapon ? '<button data-act="amove">Attack-move (A)</button>' : '') + (d.deploy ? '<button data-act="deploy">Unpack (D)</button>' : '');
          if (mine && e.kind === 'b') h += (PROD[e.type] ? '<div class="d">Right-click the map to set its rally point.</div>' : '') + `<button data-act="repair">${e.repairing ? 'Stop repair' : 'Repair'}</button><button data-act="sell">Sell</button>`;
        } else {
          const c = {};
          for (const e of sel) c[e.def.name] = (c[e.def.name] || 0) + 1;
          h = `<b>${sel.length} selected</b><div class="d">${Object.entries(c).map(([k, v]) => v + ' ' + k).join(' &middot; ')}</div><button data-act="stop">Stop (S)</button><button data-act="amove">Attack-move (A)</button>`;
        }
        si.innerHTML = h;
      }
    }
  }

  // called every frame with real elapsed seconds
  function update(dt) {
    frameN++;
    if (!App.paused && !G.over) {
      const k = ui.keys, sp = 950 * dt / View.zoom;
      let dx = 0, dy = 0;
      if (k.ArrowLeft) dx -= 1; if (k.ArrowRight) dx += 1; if (k.ArrowUp) dy -= 1; if (k.ArrowDown) dy += 1;
      const m = ui.mouse;
      if (m.inside && m.moved && !m.touch && !P && document.hasFocus()) {
        const E = 10;
        if (m.x < E) dx -= 1; else if (m.x > View.W - E) dx += 1;
        if (m.y < E) dy -= 1; else if (m.y > View.H - E) dy += 1;
      }
      if (dx || dy) { View.x += dx * sp; View.y += dy * sp; clampView(); }
      if (m.inside && !m.touch) { const e = pick(m.x, m.y); ui.hoverId = e ? e.id : 0; } else ui.hoverId = 0;
      if (ui.mode && ui.mode.t === 'place' && me().queues[ui.mode.cat].ready !== ui.mode.type) setMode(null);
    }
    updateSidebar();
  }

  function init() {
    view = $('view'); mm = $('minimap');
    bindView(); bindKeys(); bindSidebar();
    window.addEventListener('resize', resize);
    resize();
    Sfx.setListener(() => { const c = s2w(View.W / 2, View.H / 2); return { x: c.x, y: c.y, r: Math.max(8, View.W / View.zoom / 64) }; });
  }
  function reset() {
    setSel([]); setMode(null); ui.mouse.moved = false; ui.groups = {}; ui.markers.length = 0; ui.box = null; gridSig = ''; msgSig = ''; selSig = ''; timerSig = '';
    setTab('build'); tip('Hover an icon for details. Start with a <b>Windmill</b>, then a <b>Mint</b>.');
  }

  return { ui, init, reset, resize, update, setSel, setMode, get view() { return view; } };
})();
