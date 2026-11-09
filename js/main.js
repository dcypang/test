// Boot and main loop.
'use strict';

SG.Game = class Game {
  constructor() {
    if (!window.SARATOGA_MAP) {
      document.getElementById('loading').textContent = 'Map data missing: run python3 tools/fetch_osm.py';
      throw new Error('no map');
    }
    this.speed = 0; this.lastSpeed = 1;
    this.world = new SG.World(window.SARATOGA_MAP);
    this.sim = new SG.Sim(this.world);
    this.r2d = new SG.Renderer(document.getElementById('map'), this.world, this.sim);
    this.r3d = null;
    if (SG.Renderer3D.supported()) {
      try { this.r3d = new SG.Renderer3D(document.getElementById('gl'), document.getElementById('map'), this.world, this.sim); }
      catch (e) { console.warn('3D view unavailable', e); }
    }
    this.renderer = this.r3d || this.r2d;
    this.setViewClass();
    this.ui = new SG.UI(this);
    this.hook();
    window.addEventListener('resize', () => { this.r2d.resize(); if (this.r3d) this.r3d.resize(); });
    document.getElementById('loading').style.display = 'none';
    this.acc = 0; this.last = performance.now();
    requestAnimationFrame(t => this.frame(t));
    this.refreshPanels();
    if (this.hasSave()) { this.load(true); this.setSpeed(0); this.ui.ticker('Welcome back. Your saved city was loaded. Press ▶ to continue.'); }
    else this.ui.intro();
  }
  hook() {
    this.sim.onNews = (m, imp) => this.ui.ticker(m, imp);
    this.sim.onChange = () => { this.renderer.dirty = true; };
    this.sim.onCrisis = () => { if (!this._crisis) { this._crisis = true; this.ui.ticker('Saratoga is broke! Cut spending or ask voters for a parcel tax.', true); } };
    this.sim.autoApprove = document.getElementById('auto-approve').checked;
  }
  setViewClass() {
    document.getElementById('viewport').classList.toggle('flat', this.renderer === this.r2d);
    const b = document.getElementById('view-btn');
    if (b) { b.textContent = this.renderer === this.r2d ? '3D' : '2D'; b.style.display = this.r3d ? '' : 'none'; }
  }
  toggleView() {
    if (!this.r3d) return;
    const from = this.renderer, to = from === this.r2d ? this.r3d : this.r2d;
    const s = from.scale;
    to.cx = from.cx; to.cy = from.cy;
    to.scale = Math.max(to.minScale || 0, s);
    to.overlay = from.overlay; to.selected = from.selected; to.ghost = null;
    to.dirty = to.zoneDirty = true; to._miniDirty = true;
    if (to === this.r2d) { const c = this.r2d.ctx; c.setTransform(1, 0, 0, 1, 0, 0); }
    this.renderer = to;
    this.setViewClass();
    if (to === this.r3d) to.resize(); else to.resize();
  }
  setSpeed(s) {
    this.speed = s; if (s) this.lastSpeed = s;
    document.querySelectorAll('.speed button[data-speed]').forEach(b => b.classList.toggle('on', +b.dataset.speed === s));
  }
  frame(t) {
    const dt = Math.min(1000, t - this.last); this.last = t;
    if (this.speed) {
      this.acc += dt;
      const period = [0, 4000, 1500, 450][this.speed];
      if (this.acc >= period) {
        this.acc = 0;
        this.sim.step();
        if (this.sim.month === 0) this.save(true);
        this.renderer.dirty = true;
        if (this.renderer.overlay === 'vacant' || this.renderer.overlay === 'fire') this.renderer.zoneDirty = true;
        this.refreshPanels();
      }
    }
    this.renderer.draw();
    this.renderer.drawMinimap(document.getElementById('minimap'));
    requestAnimationFrame(t2 => this.frame(t2));
  }
  refreshPanels() {
    this.ui.renderStats(); this.ui.renderApps(); this.ui.renderBudget();
    if (this.ui.selected) this.ui.renderInspector();
  }
  onWorldChange() {
    this.sim.recount();
    this.sim.budget = this.sim.computeBudget();
    for (const r of [this.r2d, this.r3d]) if (r) { r.dirty = true; r.zoneDirty = true; r._miniDirty = true; }
    this.refreshPanels();
  }

  // ---------- persistence ----------
  hasSave() { try { return !!localStorage.getItem('simsaratoga.save'); } catch (e) { return false; } }
  save(quiet) {
    try {
      localStorage.setItem('simsaratoga.save', JSON.stringify(this.sim.toJSON()));
      if (!quiet) this.ui.ticker('City saved.');
    } catch (e) { if (!quiet) this.ui.ticker('Could not save in this browser.'); }
  }
  load(quiet) {
    let s;
    try { s = JSON.parse(localStorage.getItem('simsaratoga.save')); } catch (e) { s = null; }
    if (!s) return;
    this.world = new SG.World(window.SARATOGA_MAP);
    this.sim = SG.Sim.fromJSON(this.world, s);
    this.rebind();
    if (!quiet) this.ui.ticker('Saved city loaded.');
  }
  newGame() {
    try { localStorage.removeItem('simsaratoga.save'); } catch (e) { /* ignore */ }
    this.world = new SG.World(window.SARATOGA_MAP);
    this.sim = new SG.Sim(this.world);
    this.rebind();
    this.setSpeed(1);
  }
  rebind() {
    for (const r of [this.r2d, this.r3d]) if (r) { r.w = this.world; r.setSim(this.sim); r._miniDirty = true; r.selected = null; }
    this.hook();
    this.ui.select(null);
    this.refreshPanels();
  }
};

window.addEventListener('load', () => {
  try { window.game = new SG.Game(); } catch (e) { console.error(e); }
});
