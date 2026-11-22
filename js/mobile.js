// Phone layout (iPhone 17 Pro and similar): full-screen map, a bottom tool bar with tabs in
// thumb reach, a slide-up info sheet, and room for the Dynamic Island and home indicator.
'use strict';

SG.Mobile = {
  TABS: [
    { id: 'inspect', icon: '🔍', label: 'Inspect', tool: 'inspect' },
    { id: 'Roads', icon: '🛣️', label: 'Roads' },
    { id: 'Zoning', icon: '▦', label: 'Zones' },
    { id: 'Private', icon: '🏠', label: 'Homes' },
    { id: 'City', icon: '🏛️', label: 'City' },
    { id: 'bulldoze', icon: '🚜', label: 'Demolish', tool: 'bulldoze' },
  ],
  init(game) {
    const ui = game.ui, $ = id => document.getElementById(id);
    const app = $('app'), tabs = $('tooltabs'), tb = $('toolbar');
    const mq = matchMedia('(max-width: 900px)');
    tabs.innerHTML = this.TABS.map(t => `<button data-tab="${t.id}"><span>${t.icon}</span>${t.label}</button>`).join('');
    const showTab = id => {
      tb.dataset.tab = id;
      tabs.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.tab === id));
    };
    tabs.querySelectorAll('button').forEach(b => b.onclick = () => {
      const t = this.TABS.find(x => x.id === b.dataset.tab);
      if (t.tool) { ui.setTool(t.tool); showTab(t.id); app.classList.remove('tools-open'); }
      else if (tb.dataset.tab === t.id && app.classList.contains('tools-open')) app.classList.remove('tools-open');
      else { showTab(t.id); app.classList.add('tools-open'); }
      relayout();
    });
    ui.onToolChange = id => {
      const btn = tb.querySelector(`[data-tool="${CSS.escape(id)}"]`);
      const g = btn ? btn.dataset.group : null;
      if (id === 'inspect' || id === 'bulldoze') showTab(id);
      else if (g && g !== 'Tools') showTab(g);
    };
    showTab('inspect');
    // info sheet
    const sheet = open => { app.classList.toggle('sheet-open', open); relayout(); };
    $('sheet-btn').onclick = () => sheet(!app.classList.contains('sheet-open'));
    $('sheet-close').onclick = () => sheet(false);
    let y0 = null;
    $('sheet-grip').addEventListener('pointerdown', e => { y0 = e.clientY; });
    window.addEventListener('pointerup', e => { if (y0 != null && e.clientY - y0 > 40) sheet(false); y0 = null; });
    const select = ui.select.bind(ui);
    ui.select = obj => { select(obj); if (obj && mq.matches && ui.tool === 'inspect') sheet(true); };
    // badge: projects waiting for a decision
    const renderApps = ui.renderApps.bind(ui);
    ui.renderApps = () => { renderApps(); const n = game.sim.apps.length; $('sheet-badge').textContent = n ? n : ''; };
    const relayout = () => requestAnimationFrame(() => { game.r2d.resize(); if (game.r3d) game.r3d.resize(); });
    const apply = () => { app.classList.toggle('mobile', mq.matches); if (!mq.matches) app.classList.remove('sheet-open', 'tools-open'); relayout(); };
    mq.addEventListener ? mq.addEventListener('change', apply) : mq.addListener(apply);
    apply();
    // iOS: no rubber-band scrolling or text selection while playing
    document.addEventListener('gesturestart', e => e.preventDefault());
  },
};
