/**
 * HUD controller: owns every DOM node in the overlay and pushes game state
 * into it. Text is only written when it actually changes — on a phone, a
 * per-frame `textContent` write on a dozen nodes is real layout work.
 */

import { Speedometer } from './speedo.js';
import { Minimap } from './minimap.js';
import { formatTime, clamp, MPS_TO_MPH, MPS_TO_KMH } from '../engine/util.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.root = $('hud');
    this.el = {
      clock: $('clock-value'),
      speed: $('speedo-value'),
      speedUnit: $('speedo-unit'),
      gear: $('gear-badge'),
      best: $('best-value'),
      dist: $('dist-value'),
      combo: $('combo-value'),
      banner: $('banner'),
      bannerText: $('banner-text'),
      toast: $('toast'),
    };

    this.speedo = new Speedometer($('speedo-canvas'), { max: 200, unit: 'MPH' });
    this.minimap = null;

    this.unit = 'mph';
    this._last = {};
    this._toastTimer = 0;

    this._onResize = () => {
      this.speedo.resize();
      this.minimap?.resize();
    };
    window.addEventListener('resize', this._onResize);
    window.addEventListener('orientationchange', this._onResize);
  }

  attachTrack(track) {
    this.minimap = new Minimap($('minimap-canvas'), track);
  }

  setUnit(unit) {
    this.unit = unit;
    this.el.speedUnit.textContent = unit === 'kmh' ? 'KM/H' : 'MPH';
    this.speedo.setMax(unit === 'kmh' ? 320 : 200);
    this._last.speed = null;
  }

  show() { this.root.classList.add('is-live'); }
  hide() { this.root.classList.remove('is-live'); }

  /** Short status line under the objective banner. */
  toast(message, { warn = false, duration = 2.4 } = {}) {
    const el = this.el.toast;
    el.textContent = message;
    el.classList.toggle('is-warn', warn);
    el.hidden = false;
    // Restart the entry animation even if a toast is already showing.
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
    this._toastTimer = duration;
  }

  setObjective(text, broken = false) {
    if (this._last.objective !== text) {
      this.el.bannerText.textContent = text;
      this._last.objective = text;
    }
    this.el.banner.classList.toggle('is-broken', broken);
  }

  /**
   * @param state race state from game/state.js
   * @param player BikePhysics
   * @param traffic Traffic
   */
  update(state, player, traffic, dt) {
    const speedDisplay = player.speed * (this.unit === 'kmh' ? MPS_TO_KMH : MPS_TO_MPH);
    this.speedo.update(speedDisplay, player.rpmFraction, dt);

    const rounded = Math.round(speedDisplay);
    if (rounded !== this._last.speed) {
      this.el.speed.textContent = String(rounded);
      this._last.speed = rounded;
    }

    const gearLabel = player.speed < 0.6 ? 'N' : String(player.gear + 1);
    if (gearLabel !== this._last.gear) {
      this.el.gear.textContent = gearLabel;
      this._last.gear = gearLabel;
    }

    const clock = formatTime(state.elapsed);
    if (clock !== this._last.clock) {
      this.el.clock.textContent = clock;
      this._last.clock = clock;
    }

    const km = (player.progress / 1000).toFixed(2);
    if (km !== this._last.km) {
      this.el.dist.textContent = km;
      this._last.km = km;
    }

    const best = state.bestTime ? formatTime(state.bestTime) : '--:--.--';
    if (best !== this._last.best) {
      this.el.best.textContent = best;
      this._last.best = best;
    }

    const combo = `x${state.multiplier.toFixed(1)}`;
    if (combo !== this._last.combo) {
      this.el.combo.textContent = combo;
      this._last.combo = combo;
    }

    this.minimap?.update(player, traffic);

    if (this._toastTimer > 0) {
      this._toastTimer -= dt;
      if (this._toastTimer <= 0) this.el.toast.hidden = true;
    }
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('orientationchange', this._onResize);
  }
}

/**
 * Overlay panels. Kept separate from the live HUD because they are shown and
 * hidden as whole screens rather than updated per frame.
 */
export class Overlays {
  constructor() {
    this.loading = $('overlay-loading');
    this.menu = $('overlay-menu');
    this.pause = $('overlay-pause');
    this.finish = $('overlay-finish');
    this.rotate = $('overlay-rotate');
    this.error = $('overlay-error');
    this.loaderBar = $('loader-bar');
    this.loaderLabel = $('loader-label');
  }

  progress(fraction, label) {
    this.loaderBar.style.width = `${clamp(fraction, 0, 1) * 100}%`;
    if (label) this.loaderLabel.textContent = label;
  }

  show(name) {
    for (const key of ['loading', 'menu', 'pause', 'finish', 'error']) {
      this[key].hidden = key !== name;
    }
  }

  hideAll() {
    for (const key of ['loading', 'menu', 'pause', 'finish', 'error']) {
      this[key].hidden = true;
    }
  }

  setRotatePrompt(visible) {
    this.rotate.hidden = !visible;
  }

  showError(message) {
    $('error-text').textContent = message;
    this.show('error');
  }

  fillPause(player, state) {
    $('pause-dist').textContent = `${(player.progress / 1000).toFixed(2)} km`;
    $('pause-top').textContent = `${Math.round(state.topSpeed * MPS_TO_MPH)} mph`;
    $('pause-clean').textContent = state.crashes === 0 ? 'yes' : `no (${state.crashes})`;
  }

  fillFinish(state, result) {
    $('finish-title').textContent = result.title;
    $('finish-time').textContent = formatTime(result.time);
    $('finish-dist').textContent = `${(result.distance / 1000).toFixed(2)} km`;
    $('finish-top').textContent = `${Math.round(result.topSpeed * MPS_TO_MPH)} mph`;
    $('finish-crashes').textContent = String(result.crashes);
    $('finish-bonus').textContent = result.bonus > 0 ? `+${result.bonus}` : '—';
    $('finish-bonus-row').style.opacity = result.bonus > 0 ? '1' : '0.45';
    $('finish-score').textContent = result.score.toLocaleString();
    void state;
  }
}
