/**
 * Synthesised audio.
 *
 * Everything is generated with Web Audio primitives — no sample files, so the
 * repository stays asset-free and the engine note tracks rpm continuously
 * instead of crossfading between loops.
 *
 * The graph, once:
 *
 *   [saw x3] -> shaper -> lowpass -\
 *   [noise]  -> bandpass ----------->-- engineGain --\
 *   [noise]  -> wind lowpass ------> windGain -------->-- master -> out
 *   [noise]  -> skid bandpass -----> skidGain --------/
 *
 * All of it is created lazily on the first user gesture, because every mobile
 * browser refuses to start an AudioContext before one.
 */

import { clamp, lerp } from '../engine/util.js';

export class Audio {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this._nodes = {};
  }

  /** Must be called from inside a user-gesture handler. */
  async start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return this.ready;
    }
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return false;

    try {
      this.ctx = new Ctor({ latencyHint: 'interactive' });
      this._build();
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      this.ready = true;
    } catch {
      this.ctx = null;
      this.ready = false;
    }
    return this.ready;
  }

  _noiseBuffer(seconds = 2) {
    const rate = this.ctx.sampleRate;
    const buffer = this.ctx.createBuffer(1, rate * seconds, rate);
    const data = buffer.getChannelData(0);
    // Slightly brown-ish noise: a running average removes the harshest highs,
    // which suits both wind and tyre roar better than pure white.
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.2;
    }
    return buffer;
  }

  _build() {
    const ctx = this.ctx;
    const n = this._nodes;

    n.master = ctx.createGain();
    n.master.gain.value = 0.0;
    n.master.connect(ctx.destination);

    // ---- engine -----------------------------------------------------
    n.engineGain = ctx.createGain();
    n.engineGain.gain.value = 0;
    n.engineGain.connect(n.master);

    n.engineFilter = ctx.createBiquadFilter();
    n.engineFilter.type = 'lowpass';
    n.engineFilter.frequency.value = 900;
    n.engineFilter.Q.value = 1.2;
    n.engineFilter.connect(n.engineGain);

    n.shaper = ctx.createWaveShaper();
    n.shaper.curve = makeDriveCurve(2.4);
    n.shaper.oversample = '2x';
    n.shaper.connect(n.engineFilter);

    n.oscs = [];
    const partials = [
      { type: 'sawtooth', ratio: 0.5, gain: 0.42, detune: -6 },
      { type: 'sawtooth', ratio: 1.0, gain: 0.55, detune: 5 },
      { type: 'square', ratio: 2.0, gain: 0.16, detune: 11 },
    ];
    for (const p of partials) {
      const osc = ctx.createOscillator();
      osc.type = p.type;
      osc.frequency.value = 60;
      osc.detune.value = p.detune;
      const g = ctx.createGain();
      g.gain.value = p.gain;
      osc.connect(g).connect(n.shaper);
      osc.start();
      n.oscs.push({ osc, ratio: p.ratio });
    }

    // Induction roar: noise band that opens with the throttle.
    const noiseBuf = this._noiseBuffer();
    n.induction = ctx.createBufferSource();
    n.induction.buffer = noiseBuf;
    n.induction.loop = true;
    n.inductionFilter = ctx.createBiquadFilter();
    n.inductionFilter.type = 'bandpass';
    n.inductionFilter.frequency.value = 500;
    n.inductionFilter.Q.value = 0.8;
    n.inductionGain = ctx.createGain();
    n.inductionGain.gain.value = 0;
    n.induction.connect(n.inductionFilter).connect(n.inductionGain).connect(n.engineGain);
    n.induction.start();

    // ---- wind -------------------------------------------------------
    n.wind = ctx.createBufferSource();
    n.wind.buffer = noiseBuf;
    n.wind.loop = true;
    n.windFilter = ctx.createBiquadFilter();
    n.windFilter.type = 'lowpass';
    n.windFilter.frequency.value = 1400;
    n.windGain = ctx.createGain();
    n.windGain.gain.value = 0;
    n.wind.connect(n.windFilter).connect(n.windGain).connect(n.master);
    n.wind.start();

    // ---- tyre / skid -------------------------------------------------
    n.skid = ctx.createBufferSource();
    n.skid.buffer = noiseBuf;
    n.skid.loop = true;
    n.skidFilter = ctx.createBiquadFilter();
    n.skidFilter.type = 'bandpass';
    n.skidFilter.frequency.value = 2200;
    n.skidFilter.Q.value = 5;
    n.skidGain = ctx.createGain();
    n.skidGain.gain.value = 0;
    n.skid.connect(n.skidFilter).connect(n.skidGain).connect(n.master);
    n.skid.start();
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.ready) {
      this._nodes.master.gain.setTargetAtTime(muted ? 0 : 0.7, this.ctx.currentTime, 0.05);
    }
  }

  /** Fade the whole mix — used when a menu or pause screen comes up. */
  setActive(active) {
    if (!this.ready) return;
    const target = this.muted ? 0 : active ? 0.7 : 0.08;
    this._nodes.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.12);
  }

  /**
   * @param player BikePhysics
   * @param throttle 0..1
   */
  update(player, throttle) {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const n = this._nodes;

    // Firing frequency of a four: two power strokes per revolution.
    const rpm = clamp(player.rpm, 900, 14200);
    const fundamental = (rpm / 60) * 2;

    for (const { osc, ratio } of n.oscs) {
      osc.frequency.setTargetAtTime(fundamental * ratio, t, 0.03);
    }

    const load = clamp(throttle, 0, 1);
    const revFrac = player.rpmFraction;

    // On-throttle is louder and brighter; off-throttle drops to an overrun.
    const engineLevel = lerp(0.10, 0.34, load) * lerp(0.55, 1, revFrac);
    n.engineGain.gain.setTargetAtTime(player.crashed ? 0.04 : engineLevel, t, 0.06);
    n.engineFilter.frequency.setTargetAtTime(420 + revFrac * 3600 + load * 2200, t, 0.05);

    n.inductionGain.gain.setTargetAtTime(load * revFrac * 0.16, t, 0.08);
    n.inductionFilter.frequency.setTargetAtTime(300 + revFrac * 1800, t, 0.08);

    // Wind rises with the square of speed, as the real thing does.
    const v = player.speed;
    const windLevel = clamp((v / 70) ** 2, 0, 1) * 0.26;
    n.windGain.gain.setTargetAtTime(windLevel, t, 0.15);
    n.windFilter.frequency.setTargetAtTime(600 + v * 22, t, 0.15);

    // Skid: wheelspin, hard braking, or running off the tarmac.
    const skid = Math.max(
      player.slip,
      player.braking > 0.7 && v > 8 ? (player.braking - 0.7) * 2 : 0,
      player.offRoad && v > 6 ? 0.5 : 0,
    );
    n.skidGain.gain.setTargetAtTime(clamp(skid, 0, 1) * 0.14, t, 0.08);
    n.skidFilter.frequency.setTargetAtTime(player.offRoad ? 900 : 2400, t, 0.1);
  }

  /** One-shot impact: a filtered noise burst over a low thump. */
  crash(intensity = 1) {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const amp = clamp(intensity, 0.2, 1);

    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(0.6);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(2600, t);
    filter.frequency.exponentialRampToValueAtTime(320, t + 0.45);
    filter.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(amp * 0.6, t);
    gain.gain.exponentialRampToValueAtTime(0.0008, t + 0.7);
    src.connect(filter).connect(gain).connect(this._nodes.master);
    src.start(t);
    src.stop(t + 0.75);

    const thump = ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(120, t);
    thump.frequency.exponentialRampToValueAtTime(38, t + 0.3);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(amp * 0.5, t);
    tg.gain.exponentialRampToValueAtTime(0.0008, t + 0.42);
    thump.connect(tg).connect(this._nodes.master);
    thump.start(t);
    thump.stop(t + 0.45);
  }

  /** Short blip: countdown ticks, the start, near misses. */
  beep(frequency = 660, duration = 0.12, level = 0.22) {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = frequency;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0008, t + duration);
    osc.connect(g).connect(this._nodes.master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  dispose() {
    if (!this.ctx) return;
    try {
      this._nodes.oscs?.forEach(({ osc }) => osc.stop());
      this._nodes.wind?.stop();
      this._nodes.skid?.stop();
      this._nodes.induction?.stop();
      this.ctx.close();
    } catch {
      /* already torn down */
    }
    this.ctx = null;
    this.ready = false;
  }
}

/** Soft-clipping curve for the engine's waveshaper. */
function makeDriveCurve(amount) {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  return curve;
}
