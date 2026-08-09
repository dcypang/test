// ---------------------------------------------------------------------------
// touch.js - on-screen driving controls for phones and tablets.
//
// The controls are DOM elements rather than shapes drawn on the HUD canvas:
// pointer events give reliable multi-touch hit testing for free, and CSS keeps
// them crisp on high-density screens.
//
// Steering is a drag pad rather than a pair of arrows. This car has
// speed-sensitive steering and needs small, precise inputs at racing speed -
// buttons can only ask for full lock, which just makes the front tyres slide.
// ---------------------------------------------------------------------------

function isTouchDevice() {
  return (typeof window !== 'undefined')
    && (('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0);
}

const TOUCH_SVG = {
  camera: '<path d="M4 8h3l1.5-2h7L17 8h3v10H4z" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="13" r="3.2" fill="none" stroke="currentColor" stroke-width="1.7"/>',
  pause: '<rect x="7" y="5" width="3.4" height="14" rx="1" fill="currentColor"/><rect x="13.6" y="5" width="3.4" height="14" rx="1" fill="currentColor"/>',
  reset: '<path d="M20 12a8 8 0 1 1-2.6-5.9" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M20 4v5h-5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
  horn: '<path d="M4 10v4h3l5 4V6L7 10z" fill="currentColor"/><path d="M16 9a4 4 0 0 1 0 6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M18.5 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  lights: '<path d="M5 7h5c4 0 7 2.2 7 5s-3 5-7 5H5z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M19 8.5h3M19 12h3.6M19 15.5h3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  left: '<path d="M14 6 8 12l6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  right: '<path d="m10 6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
};

class TouchControls {
  constructor(game) {
    this.game = game;
    this.enabled = false;
    this.steerMode = 'pad';        // 'pad' | 'tilt'
    this.state = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
    this.taps = new Set();          // one-shot presses, drained per frame
    this.held = new Set();
    this.steerPointer = null;
    this.steerOrigin = 0;
    this.tilt = { active: false, zero: null, value: 0 };
    this.root = null;
  }

  // Build the overlay. Safe to call once; `setVisible` does the rest.
  mount() {
    if (this.root) return;
    const root = document.createElement('div');
    root.id = 'touchControls';
    root.className = 'touch hidden';
    root.setAttribute('aria-hidden', 'true');

    const icon = (name) =>
      `<svg viewBox="0 0 24 24" aria-hidden="true">${TOUCH_SVG[name]}</svg>`;

    root.innerHTML = `
      <div class="touch-steer" data-role="steer">
        <div class="touch-steer-track"><div class="touch-steer-thumb"></div></div>
        <span class="touch-steer-label">Slide to steer</span>
      </div>
      <div class="touch-pedals">
        <button class="touch-pedal brake" data-hold="brake" type="button">
          <span>BRAKE</span>
        </button>
        <button class="touch-pedal gas" data-hold="throttle" type="button">
          <span>GO</span>
        </button>
      </div>
      <div class="touch-aux">
        <button class="touch-btn" data-tap="camera" type="button" title="Camera">${icon('camera')}</button>
        <button class="touch-btn" data-tap="reset" type="button" title="Back to the road">${icon('reset')}</button>
        <button class="touch-btn" data-tap="pause" type="button" title="Pause">${icon('pause')}</button>
      </div>
      <div class="touch-road">
        <button class="touch-btn" data-tap="indicateLeft" type="button" title="Indicate left">${icon('left')}</button>
        <button class="touch-btn" data-tap="indicateRight" type="button" title="Indicate right">${icon('right')}</button>
        <button class="touch-btn" data-hold="horn" type="button" title="Horn">${icon('horn')}</button>
        <button class="touch-btn" data-tap="lights" type="button" title="Headlights">${icon('lights')}</button>
      </div>`;

    document.body.appendChild(root);
    this.root = root;
    this.thumb = root.querySelector('.touch-steer-thumb');
    this.steerZone = root.querySelector('[data-role="steer"]');
    this.roadRow = root.querySelector('.touch-road');

    this.bindSteer();
    for (const el of root.querySelectorAll('[data-hold]')) this.bindHold(el);
    for (const el of root.querySelectorAll('[data-tap]')) this.bindTap(el);
  }

  // --- steering -------------------------------------------------------------

  bindSteer() {
    const zone = this.steerZone;
    // Full lock at a comfortable thumb sweep, never more than a sixth of the
    // screen so it stays reachable on a small phone.
    const travel = () => Math.min(96, Math.max(52, window.innerWidth * 0.13));

    const down = (e) => {
      if (this.steerPointer !== null) return;
      this.steerPointer = e.pointerId;
      this.steerOrigin = e.clientX;
      try { zone.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
      zone.classList.add('active');
      e.preventDefault();
    };
    const move = (e) => {
      if (e.pointerId !== this.steerPointer) return;
      const dx = e.clientX - this.steerOrigin;
      const t = clamp(dx / travel(), -1, 1);
      // A small dead zone stops the car twitching while the thumb rests.
      this.state.steer = Math.abs(t) < 0.06 ? 0 : t;
      this.thumb.style.transform = `translateX(${this.state.steer * 46}px)`;
      e.preventDefault();
    };
    const up = (e) => {
      if (e.pointerId !== this.steerPointer) return;
      this.steerPointer = null;
      this.state.steer = 0;
      this.thumb.style.transform = 'translateX(0px)';
      zone.classList.remove('active');
    };
    zone.addEventListener('pointerdown', down);
    zone.addEventListener('pointermove', move);
    zone.addEventListener('pointerup', up);
    zone.addEventListener('pointercancel', up);
  }

  bindHold(el) {
    const key = el.dataset.hold;
    const on = (e) => {
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
      el.classList.add('active');
      this.held.add(key);
      if (key === 'throttle' || key === 'brake') this.state[key] = 1;
      e.preventDefault();
    };
    const off = () => {
      el.classList.remove('active');
      this.held.delete(key);
      if (key === 'throttle' || key === 'brake') this.state[key] = 0;
    };
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
    el.addEventListener('pointerleave', off);
  }

  bindTap(el) {
    el.addEventListener('pointerdown', (e) => {
      el.classList.add('active');
      this.taps.add(el.dataset.tap);
      e.preventDefault();
    });
    const off = () => el.classList.remove('active');
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
  }

  // --- tilt steering ----------------------------------------------------------

  async enableTilt() {
    const DOE = window.DeviceOrientationEvent;
    if (!DOE) return false;
    // iOS needs explicit permission, and only from a user gesture.
    if (typeof DOE.requestPermission === 'function') {
      try {
        const res = await DOE.requestPermission();
        if (res !== 'granted') return false;
      } catch (err) { return false; }
    }
    if (!this.tiltHandler) {
      this.tiltHandler = (e) => {
        if (e.beta === null && e.gamma === null) return;
        // Which axis points across the car depends on how the phone is held.
        const angle = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
        let raw;
        if (angle === 90) raw = e.beta;
        else if (angle === 270 || angle === -90) raw = -e.beta;
        else raw = e.gamma;
        if (raw === null || raw === undefined) return;
        if (this.tilt.zero === null) this.tilt.zero = raw;
        const delta = raw - this.tilt.zero;
        this.tilt.value = clamp(delta / 26, -1, 1);
        this.tilt.active = true;
      };
      window.addEventListener('deviceorientation', this.tiltHandler);
    }
    this.tilt.zero = null;          // recalibrate to however it is being held
    this.steerMode = 'tilt';
    if (this.root) this.root.classList.add('tilt');
    return true;
  }

  disableTilt() {
    this.steerMode = 'pad';
    this.tilt.active = false;
    this.tilt.value = 0;
    if (this.root) this.root.classList.remove('tilt');
  }

  recalibrateTilt() { this.tilt.zero = null; }

  // --- frame interface --------------------------------------------------------

  setVisible(on, mode) {
    if (!this.root) return;
    this.enabled = on;
    this.root.classList.toggle('hidden', !on);
    this.root.setAttribute('aria-hidden', on ? 'false' : 'true');
    // Indicators, horn and lights only mean anything on public roads.
    if (this.roadRow) this.roadRow.classList.toggle('hidden', mode !== 'drive');
    if (!on) {
      this.state.throttle = this.state.brake = this.state.steer = 0;
      this.held.clear();
      this.taps.clear();
    }
  }

  // Merged into the keyboard/gamepad inputs each frame.
  driving(out) {
    if (!this.enabled) return out;
    out.throttle = Math.max(out.throttle, this.state.throttle);
    out.brake = Math.max(out.brake, this.state.brake);
    const steer = this.steerMode === 'tilt' && this.tilt.active
      ? this.tilt.value
      : this.state.steer;
    if (Math.abs(steer) > Math.abs(out.steer)) out.steer = steer;
    return out;
  }

  hornHeld() { return this.held.has('horn'); }

  // One-shot presses; drained so each press fires exactly once.
  drainTaps() {
    if (this.taps.size === 0) return null;
    const list = Array.from(this.taps);
    this.taps.clear();
    return list;
  }
}
