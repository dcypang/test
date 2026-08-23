/**
 * Unified input: on-screen thumb controls, keyboard, gamepad and device tilt
 * all reduce to the same four analogue axes.
 *
 * Touch handling uses pointer capture on each control so a thumb that slides
 * off the button keeps driving it — sliding off mid-corner and losing steering
 * is the single most frustrating thing a mobile racer can do.
 */

import { clamp, approach } from '../engine/util.js';

export class Input {
  constructor() {
    this.state = {
      throttle: 0,     // 0..1
      brake: 0,        // 0..1
      steer: 0,        // -1 (left) .. 1 (right)
      wheelie: false,
    };

    // Raw digital intents, smoothed into `state` each frame.
    this.raw = { left: false, right: false, throttle: false, brake: false, wheelie: false };
    this.gamepadAxis = 0;
    this.gamepadThrottle = 0;
    this.gamepadBrake = 0;

    this.tiltEnabled = false;
    this.tiltZero = null;
    this.tiltValue = 0;

    this.listeners = new Map();
    this._bound = [];
    this._bindKeyboard();
    this._bindTilt();
  }

  /** Subscribe to a named one-shot action (pause, restart, camera…). */
  on(action, fn) {
    if (!this.listeners.has(action)) this.listeners.set(action, []);
    this.listeners.get(action).push(fn);
  }

  emit(action) {
    const fns = this.listeners.get(action);
    if (fns) for (const fn of fns) fn();
  }

  /* ----------------------------------------------------------------
     On-screen controls
     ---------------------------------------------------------------- */

  /**
   * Wire a DOM element as a hold-to-activate control.
   * `key` is a field on `this.raw`; `onDown`/`onUp` fire for one-shot buttons.
   */
  bindHold(el, key) {
    if (!el) return;
    const down = (e) => {
      e.preventDefault();
      if (e.pointerId !== undefined && el.setPointerCapture) {
        try { el.setPointerCapture(e.pointerId); } catch { /* capture is best-effort */ }
      }
      this.raw[key] = true;
      el.classList.add('is-down');
    };
    const up = (e) => {
      if (e) e.preventDefault();
      this.raw[key] = false;
      el.classList.remove('is-down');
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
    // Releasing outside the element still has to stop the input.
    el.addEventListener('pointerleave', (e) => {
      if (!el.hasPointerCapture?.(e.pointerId)) up(e);
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    this._bound.push(() => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    });
  }

  /** Wire a DOM element as a one-shot action button. */
  bindTap(el, action) {
    if (!el) return;
    const fn = (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.emit(action);
    };
    el.addEventListener('click', fn);
    this._bound.push(() => el.removeEventListener('click', fn));
  }

  /* ----------------------------------------------------------------
     Keyboard
     ---------------------------------------------------------------- */

  _bindKeyboard() {
    const map = {
      ArrowUp: 'throttle', KeyW: 'throttle',
      ArrowDown: 'brake', KeyS: 'brake',
      ArrowLeft: 'left', KeyA: 'left',
      ArrowRight: 'right', KeyD: 'right',
      ShiftLeft: 'wheelie', ShiftRight: 'wheelie', Space: 'wheelie',
    };
    const actions = { Escape: 'pause', KeyP: 'pause', KeyR: 'restart', KeyC: 'camera', KeyF: 'flip' };

    const onDown = (e) => {
      if (e.repeat) return;
      if (map[e.code]) { this.raw[map[e.code]] = true; e.preventDefault(); }
      else if (actions[e.code]) { this.emit(actions[e.code]); e.preventDefault(); }
    };
    const onUp = (e) => {
      if (map[e.code]) { this.raw[map[e.code]] = false; e.preventDefault(); }
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    // A lost window means every held key is stuck down otherwise.
    const clear = () => { for (const k of Object.keys(this.raw)) this.raw[k] = false; };
    window.addEventListener('blur', clear);

    this._bound.push(() => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', clear);
    });
  }

  /* ----------------------------------------------------------------
     Device tilt
     ---------------------------------------------------------------- */

  _bindTilt() {
    this._onOrientation = (e) => {
      if (!this.tiltEnabled) return;
      // In landscape the useful axis is beta (front-back), because the device
      // is rotated 90°. gamma covers the portrait case.
      const landscape = Math.abs(window.orientation || 0) === 90 ||
        (screen.orientation && screen.orientation.type.startsWith('landscape'));
      let angle = landscape ? (e.beta || 0) : (e.gamma || 0);
      if (landscape && (window.orientation === -90 || screen.orientation?.angle === 270)) {
        angle = -angle;
      }
      if (this.tiltZero === null) this.tiltZero = angle;
      // ±22° of lean covers full lock, which is comfortable held in two hands.
      this.tiltValue = clamp((angle - this.tiltZero) / 22, -1, 1);
    };
    window.addEventListener('deviceorientation', this._onOrientation);
    this._bound.push(() => window.removeEventListener('deviceorientation', this._onOrientation));
  }

  /** iOS 13+ requires an explicit permission prompt from a user gesture. */
  async enableTilt() {
    const DOE = window.DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === 'function') {
      try {
        const res = await DOE.requestPermission();
        if (res !== 'granted') return false;
      } catch {
        return false;
      }
    }
    this.tiltEnabled = true;
    this.tiltZero = null;   // re-centre on whatever the current pose is
    return true;
  }

  disableTilt() {
    this.tiltEnabled = false;
    this.tiltValue = 0;
  }

  recentreTilt() {
    this.tiltZero = null;
  }

  /* ----------------------------------------------------------------
     Gamepad
     ---------------------------------------------------------------- */

  _pollGamepad() {
    if (!navigator.getGamepads) return;
    const pads = navigator.getGamepads();
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      const dead = (v) => (Math.abs(v) < 0.14 ? 0 : v);
      this.gamepadAxis = dead(pad.axes[0] || 0);
      this.gamepadThrottle = Math.max(pad.buttons[7]?.value || 0, pad.buttons[0]?.value || 0);
      this.gamepadBrake = Math.max(pad.buttons[6]?.value || 0, pad.buttons[1]?.value || 0);
      return;
    }
    this.gamepadAxis = 0;
    this.gamepadThrottle = 0;
    this.gamepadBrake = 0;
  }

  /* ----------------------------------------------------------------
     Per-frame integration
     ---------------------------------------------------------------- */

  update(dt) {
    this._pollGamepad();
    const s = this.state;

    // Throttle ramps in fast and falls off faster, so feathering works.
    const throttleTarget = Math.max(this.raw.throttle ? 1 : 0, this.gamepadThrottle);
    s.throttle = approach(s.throttle, throttleTarget, dt * (throttleTarget > s.throttle ? 4.5 : 6.5));

    const brakeTarget = Math.max(this.raw.brake ? 1 : 0, this.gamepadBrake);
    s.brake = approach(s.brake, brakeTarget, dt * 7);

    let steerTarget = 0;
    if (this.tiltEnabled) {
      steerTarget = this.tiltValue;
    } else {
      steerTarget = (this.raw.right ? 1 : 0) - (this.raw.left ? 1 : 0);
    }
    if (this.gamepadAxis !== 0) steerTarget = this.gamepadAxis;

    // Returning to centre is quicker than reaching full lock: the bike should
    // settle the moment you let go.
    const rate = Math.abs(steerTarget) > Math.abs(s.steer) ? 3.4 : 6.0;
    s.steer = approach(s.steer, clamp(steerTarget, -1, 1), dt * rate);

    s.wheelie = this.raw.wheelie;
    return s;
  }

  reset() {
    for (const k of Object.keys(this.raw)) this.raw[k] = false;
    this.state.throttle = 0;
    this.state.brake = 0;
    this.state.steer = 0;
    this.state.wheelie = false;
    document.querySelectorAll('.is-down').forEach((el) => el.classList.remove('is-down'));
  }

  dispose() {
    this._bound.forEach((fn) => fn());
    this._bound.length = 0;
    this.listeners.clear();
  }
}
