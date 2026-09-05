// ---------------------------------------------------------------------------
// audio.js - everything is synthesised with the Web Audio API; there are no
// sample files to load. The engine is built from stacked oscillators at the
// firing orders plus filtered noise, so it tracks rpm and load continuously.
// ---------------------------------------------------------------------------

class GameAudio {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.masterVolume = 0.7;
    this.started = false;
  }

  // Must be called from a user gesture.
  start() {
    if (this.started) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.started = true;
    this.enabled = true;

    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.masterVolume;
    this.master.connect(ctx.destination);

    // Gentle limiter so the mix never clips when everything fires at once.
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -8;
    this.limiter.knee.value = 12;
    this.limiter.ratio.value = 8;
    this.limiter.attack.value = 0.004;
    this.limiter.release.value = 0.14;
    this.limiter.connect(this.master);

    this.noiseBuffer = this.makeNoiseBuffer(2.0);
    this.buildEngine();
    this.buildTyres();
    this.buildWind();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setVolume(v) {
    this.masterVolume = v;
    if (this.master) this.master.gain.value = v;
  }

  makeNoiseBuffer(seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;   // slight brown tilt
      d[i] = white * 0.7 + last * 3.0;
    }
    return buf;
  }

  loopNoise(gainValue) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = gainValue;
    src.connect(gain);
    src.start();
    return { src, gain };
  }

  buildEngine() {
    const ctx = this.ctx;
    this.engine = { osc: [], gains: [] };

    this.engineBus = ctx.createGain();
    this.engineBus.gain.value = 0.0;

    // Body resonance: a mild peak that gives the engine some chest.
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 1800;
    this.engineFilter.Q.value = 0.8;

    this.enginePeak = ctx.createBiquadFilter();
    this.enginePeak.type = 'peaking';
    this.enginePeak.frequency.value = 320;
    this.enginePeak.gain.value = 7;
    this.enginePeak.Q.value = 1.1;

    this.engineBus.connect(this.engineFilter);
    this.engineFilter.connect(this.enginePeak);
    this.enginePeak.connect(this.limiter);

    // Harmonic stack: half order (lumpy V8 beat), main firing order, and
    // the upper orders that give the top end its edge.
    const harmonics = [
      { mult: 0.5, gain: 0.32, type: 'sawtooth' },
      { mult: 1.0, gain: 0.55, type: 'sawtooth' },
      { mult: 1.5, gain: 0.18, type: 'square' },
      { mult: 2.0, gain: 0.26, type: 'sawtooth' },
      { mult: 3.0, gain: 0.12, type: 'sawtooth' },
      { mult: 4.0, gain: 0.07, type: 'square' },
    ];
    for (const h of harmonics) {
      const osc = ctx.createOscillator();
      osc.type = h.type;
      const g = ctx.createGain();
      g.gain.value = h.gain;
      osc.connect(g);
      g.connect(this.engineBus);
      osc.start();
      this.engine.osc.push({ osc, mult: h.mult, base: h.gain, gain: g });
    }

    // Induction / exhaust noise.
    const n = this.loopNoise(0.0);
    this.engineNoiseGain = n.gain;
    this.engineNoiseFilter = ctx.createBiquadFilter();
    this.engineNoiseFilter.type = 'bandpass';
    this.engineNoiseFilter.frequency.value = 700;
    this.engineNoiseFilter.Q.value = 0.7;
    n.gain.connect(this.engineNoiseFilter);
    this.engineNoiseFilter.connect(this.engineBus);
  }

  buildTyres() {
    const ctx = this.ctx;
    const n = this.loopNoise(0);
    this.tyreGain = n.gain;
    this.tyreFilter = ctx.createBiquadFilter();
    this.tyreFilter.type = 'bandpass';
    this.tyreFilter.frequency.value = 1400;
    this.tyreFilter.Q.value = 6.5;
    const shaper = ctx.createBiquadFilter();
    shaper.type = 'peaking';
    shaper.frequency.value = 2600;
    shaper.gain.value = 9;
    n.gain.connect(this.tyreFilter);
    this.tyreFilter.connect(shaper);
    shaper.connect(this.limiter);

    // Rolling / surface rumble.
    const r = this.loopNoise(0);
    this.rollGain = r.gain;
    this.rollFilter = ctx.createBiquadFilter();
    this.rollFilter.type = 'lowpass';
    this.rollFilter.frequency.value = 260;
    r.gain.connect(this.rollFilter);
    this.rollFilter.connect(this.limiter);
  }

  buildWind() {
    const ctx = this.ctx;
    const n = this.loopNoise(0);
    this.windGain = n.gain;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 900;
    n.gain.connect(f);
    f.connect(this.limiter);
  }

  // Called every frame with the player's state.
  update(state, dt) {
    if (!this.enabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    const smooth = (param, value, time = 0.05) => {
      param.setTargetAtTime(value, now, time);
    };

    const rpm = clamp(state.rpm, 700, 8300);
    // V8: four firing events per revolution.
    const fundamental = (rpm / 60) * 4;
    for (const h of this.engine.osc) {
      smooth(h.osc.frequency, fundamental * h.mult, 0.02);
    }

    const load = clamp(state.throttle, 0, 1);
    const rpmNorm = clamp((rpm - 900) / 7200, 0, 1);
    const engineVol = (state.inside ? 0.42 : 0.30) * (0.30 + rpmNorm * 0.8) * (0.55 + load * 0.65);
    smooth(this.engineBus.gain, state.muted ? 0 : engineVol, 0.04);
    smooth(this.engineFilter.frequency, 700 + rpmNorm * 4200 + load * 2200, 0.05);
    smooth(this.enginePeak.frequency, 180 + rpmNorm * 260, 0.08);
    smooth(this.engineNoiseGain.gain, state.muted ? 0 : (0.05 + rpmNorm * 0.22) * (0.35 + load * 0.9), 0.05);
    smooth(this.engineNoiseFilter.frequency, 400 + rpmNorm * 2600, 0.06);

    // Tyre scrub: pitch and volume follow how hard the tyres are sliding.
    const slip = clamp(state.slip, 0, 1);
    smooth(this.tyreGain.gain, state.muted ? 0 : slip * 0.42, 0.05);
    smooth(this.tyreFilter.frequency, 900 + slip * 1500 + clamp(state.speed, 0, 80) * 6, 0.06);

    const speedNorm = clamp(state.speed / 75, 0, 1.4);
    smooth(this.rollGain.gain, state.muted ? 0 : (0.05 + speedNorm * 0.22) * (state.onGround ? 1 : 0.1) * (1 + state.roughness * 2.5), 0.06);
    smooth(this.rollFilter.frequency, 110 + speedNorm * 380 + state.roughness * 200, 0.08);
    smooth(this.windGain.gain, state.muted ? 0 : Math.pow(speedNorm, 2.1) * (state.inside ? 0.055 : 0.10), 0.08);
  }

  // --- one shots --------------------------------------------------------------

  blip(freq, duration, type = 'square', volume = 0.25) {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.connect(g);
    g.connect(this.limiter);
    osc.start();
    osc.stop(ctx.currentTime + duration + 0.05);
  }

  shift() {
    if (!this.enabled) return;
    this.burst(0.05, 2400, 0.10, 'highpass');
    this.blip(180, 0.06, 'square', 0.10);
  }

  burst(duration, filterFreq, volume, filterType = 'bandpass') {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = filterFreq;
    f.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(volume, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    src.connect(f); f.connect(g); g.connect(this.limiter);
    src.start(ctx.currentTime, Math.random() * 1.0, duration + 0.05);
  }

  impact(strength) {
    if (!this.enabled) return;
    const s = clamp(strength, 0, 1);
    this.burst(0.18 + s * 0.25, 160 + s * 500, 0.22 + s * 0.5, 'lowpass');
    this.blip(70 + s * 60, 0.18, 'square', 0.10 + s * 0.2);
  }

  kerb() {
    if (!this.enabled) return;
    this.burst(0.05, 420, 0.10, 'bandpass');
  }

  horn(on) {
    if (!this.enabled) return;
    if (on && !this.hornNodes) {
      const ctx = this.ctx;
      const a = ctx.createOscillator(), b = ctx.createOscillator();
      const g = ctx.createGain();
      a.type = 'sawtooth'; b.type = 'sawtooth';
      a.frequency.value = 440; b.frequency.value = 554;
      g.gain.value = 0.0;
      g.gain.setTargetAtTime(0.16, ctx.currentTime, 0.01);
      a.connect(g); b.connect(g); g.connect(this.limiter);
      a.start(); b.start();
      this.hornNodes = { a, b, g };
    } else if (!on && this.hornNodes) {
      const { a, b, g } = this.hornNodes;
      g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.02);
      a.stop(this.ctx.currentTime + 0.2);
      b.stop(this.ctx.currentTime + 0.2);
      this.hornNodes = null;
    }
  }

  indicator() { this.blip(1150, 0.045, 'square', 0.07); }
  countdownBeep(final) { this.blip(final ? 1320 : 660, final ? 0.5 : 0.22, 'square', 0.20); }
  chime() {
    this.blip(880, 0.30, 'sine', 0.18);
    setTimeout(() => this.blip(1320, 0.45, 'sine', 0.16), 130);
  }
}
