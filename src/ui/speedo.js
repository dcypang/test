/**
 * Analogue speedometer, drawn on a 2D canvas each frame.
 *
 * Canvas beats SVG/DOM here: the needle moves every frame, and re-rasterising
 * one small canvas is cheaper than making the compositor re-do a transform on
 * a stack of blurred, backdrop-filtered layers.
 */

import { clamp, lerp, TAU, damp } from '../engine/util.js';

/** Gauge sweep: start at lower-left, run clockwise through the top. */
const START_ANGLE = Math.PI * 0.78;
const SWEEP = Math.PI * 1.44;

export class Speedometer {
  constructor(canvas, { max = 200, unit = 'MPH', greenFrom = 0.55, redFrom = 0.78 } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.max = max;
    this.unit = unit;
    this.greenFrom = greenFrom;
    this.redFrom = redFrom;

    this.value = 0;
    this.displayed = 0;
    this.rpm = 0;
    this.displayedRpm = 0;
    this.size = 0;
    this._dirty = true;
    this.resize();
  }

  setMax(max) {
    if (this.max === max) return;
    this.max = max;
    this._dirty = true;
  }

  resize() {
    const dpr = clamp(window.devicePixelRatio || 1, 1, 3);
    const css = this.canvas.clientWidth || 200;
    const px = Math.round(css * dpr);
    if (px === this.canvas.width) return;
    this.canvas.width = px;
    this.canvas.height = px;
    this.size = px;
    this._dirty = true;
  }

  /**
   * @param value  speed in display units
   * @param rpm    0..1, drives the redline ring
   */
  update(value, rpm, dt) {
    this.value = value;
    this.rpm = rpm;
    // The needle lags slightly, the way a real one does.
    this.displayed = damp(this.displayed, value, 0.0004, dt);
    this.displayedRpm = damp(this.displayedRpm, rpm, 0.0006, dt);
    this.draw();
  }

  draw() {
    const ctx = this.ctx;
    const S = this.size;
    if (!S) return;
    const cx = S / 2;
    const cy = S / 2;
    const R = S * 0.46;

    ctx.clearRect(0, 0, S, S);

    // ---- dial face ------------------------------------------------
    const faceGrad = ctx.createRadialGradient(cx, cy * 0.8, R * 0.1, cx, cy, R);
    faceGrad.addColorStop(0, 'rgba(16, 22, 28, 0.42)');
    faceGrad.addColorStop(1, 'rgba(6, 10, 14, 0.66)');
    ctx.fillStyle = faceGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.fill();

    // ---- outer bezel ----------------------------------------------
    ctx.lineWidth = S * 0.016;
    ctx.strokeStyle = 'rgba(255,255,255,0.72)';
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.stroke();

    // ---- speed zones, drawn once dim and again bright up to the needle --
    // One ring, not two. An earlier version added a separate rev arc inside
    // this one; at HUD scale the two bands merged and the dial looked
    // permanently redlined. Filling this ring to the current speed says the
    // same thing, reinforces the needle, and leaves the face uncluttered.
    const zoneR = R * 0.915;
    const fill = clamp(this.displayed / this.max, 0, 1);
    ctx.lineCap = 'butt';

    ctx.lineWidth = S * 0.024;
    this._arc(cx, cy, zoneR, 0, this.greenFrom, 'rgba(255,255,255,0.22)');
    this._arc(cx, cy, zoneR, this.greenFrom, this.redFrom, 'rgba(107, 240, 173, 0.38)');
    this._arc(cx, cy, zoneR, this.redFrom, 1, 'rgba(255, 86, 74, 0.40)');

    ctx.lineWidth = S * 0.030;
    if (fill > 0.001) {
      this._arc(cx, cy, zoneR, 0, Math.min(fill, this.greenFrom), 'rgba(238,244,248,0.85)');
      if (fill > this.greenFrom) {
        this._arc(cx, cy, zoneR, this.greenFrom, Math.min(fill, this.redFrom),
          'rgba(107, 240, 173, 0.95)');
      }
      if (fill > this.redFrom) {
        this._arc(cx, cy, zoneR, this.redFrom, fill, 'rgba(255, 86, 74, 0.98)');
      }
    }

    // ---- ticks and numerals ----------------------------------------
    // Only every other major tick carries a numeral. The dial sweeps 259° over
    // eleven 20-unit steps, which leaves about 26° per label — not enough for
    // three legible digits at HUD size, so labels go on the 40s.
    const major = this.max > 220 ? 40 : 20;
    const labelled = major * 2;
    const minor = major / 2;

    ctx.lineCap = 'round';
    ctx.font = `700 ${Math.round(S * 0.062)}px ui-monospace, "SF Mono", Menlo, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let v = 0; v <= this.max + 0.001; v += minor) {
      const t = v / this.max;
      const a = START_ANGLE + t * SWEEP;
      const isMajor = Math.abs(v % major) < 0.001;
      const isLabelled = Math.abs(v % labelled) < 0.001;
      const inner = isMajor ? R * 0.70 : R * 0.735;
      const outer = R * 0.785;
      ctx.lineWidth = isMajor ? S * 0.011 : S * 0.006;
      ctx.strokeStyle = isMajor ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.42)';
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      ctx.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
      ctx.stroke();

      if (isLabelled) {
        // Outboard of the readout, which occupies the lower centre of the dial.
        const lr = R * 0.575;
        ctx.fillStyle = t >= this.redFrom
          ? 'rgba(255, 128, 118, 0.95)'
          : t >= this.greenFrom
            ? 'rgba(129, 245, 189, 0.95)'
            : 'rgba(255,255,255,0.80)';
        ctx.fillText(String(Math.round(v)), cx + Math.cos(a) * lr, cy + Math.sin(a) * lr);
      }
    }

    // ---- needle -----------------------------------------------------
    const t = clamp(this.displayed / this.max, 0, 1.02);
    const a = START_ANGLE + t * SWEEP;
    const tipR = R * 0.70;
    const tailR = R * 0.10;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(-tailR, 0);
    ctx.lineTo(0, -S * 0.012);
    ctx.lineTo(tipR, 0);
    ctx.lineTo(0, S * 0.012);
    ctx.closePath();
    ctx.fillStyle = t >= this.redFrom ? '#ff6a5e' : '#ffffff';
    ctx.shadowColor = t >= this.redFrom ? 'rgba(255,86,74,0.9)' : 'rgba(107,240,173,0.6)';
    ctx.shadowBlur = S * 0.05;
    ctx.fill();
    ctx.restore();

    // ---- hub --------------------------------------------------------
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(cx, cy, S * 0.052, 0, TAU);
    ctx.fillStyle = 'rgba(12,18,22,0.95)';
    ctx.fill();
    ctx.lineWidth = S * 0.010;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, S * 0.026, 0, TAU);
    ctx.strokeStyle = 'rgba(107,240,173,0.9)';
    ctx.lineWidth = S * 0.007;
    ctx.stroke();
  }

  _arc(cx, cy, r, t0, t1, color) {
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, r, START_ANGLE + t0 * SWEEP, START_ANGLE + t1 * SWEEP);
    ctx.stroke();
  }
}
