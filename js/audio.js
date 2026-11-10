'use strict';
// ---------------------------------------------------------------------------
// Synthesised sound effects and a small generative lute loop (Web Audio).
// No audio files are used.
// ---------------------------------------------------------------------------
const Sfx = (() => {
  let ac = null, master = null, musicGain = null, noiseBuf = null;
  let sfxOn = true, musicOn = true, musicTimer = null, nextNote = 0, step = 0;
  const last = {};
  let listener = null; // function returning {x,y,r} in tile coords

  function init() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      ac = new AC();
      master = ac.createGain(); master.gain.value = 0.5; master.connect(ac.destination);
      musicGain = ac.createGain(); musicGain.gain.value = 0.12; musicGain.connect(ac.destination);
      noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { ac = null; }
  }

  function tone(f, dur, type, vol, slide, when, dest) {
    const t = (when || ac.currentTime), o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || master); o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, vol, freq, type, q, when) {
    const t = (when || ac.currentTime), s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noiseBuf; s.loop = true;
    f.type = type || 'lowpass'; f.frequency.setValueAtTime(freq, t); f.Q.value = q || 0.7;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(master); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }

  const DEFS = {
    click: v => tone(660, 0.05, 'square', 0.05 * v),
    select: v => { tone(520, 0.06, 'triangle', 0.12 * v); },
    order: v => { tone(392, 0.06, 'triangle', 0.12 * v); tone(523, 0.08, 'triangle', 0.1 * v, 0, ac.currentTime + 0.05); },
    error: v => tone(140, 0.16, 'sawtooth', 0.09 * v, 100),
    place: v => { noise(0.22, 0.4 * v, 300, 'lowpass'); tone(90, 0.2, 'sine', 0.3 * v, 50); },
    ready: v => { tone(523, 0.12, 'triangle', 0.16 * v); tone(659, 0.12, 'triangle', 0.16 * v, 0, ac.currentTime + 0.1); tone(784, 0.22, 'triangle', 0.16 * v, 0, ac.currentTime + 0.2); },
    unit: v => { tone(440, 0.08, 'triangle', 0.14 * v); tone(587, 0.14, 'triangle', 0.14 * v, 0, ac.currentTime + 0.08); },
    age: v => { [392, 494, 587, 784, 988].forEach((f, i) => tone(f, 0.5, 'triangle', 0.14 * v, 0, ac.currentTime + i * 0.13)); },
    alert: v => { for (let i = 0; i < 3; i++) tone(i % 2 ? 620 : 830, 0.14, 'square', 0.07 * v, 0, ac.currentTime + i * 0.15); },
    siren: v => { for (let i = 0; i < 4; i++) tone(300, 0.4, 'sawtooth', 0.08 * v, 620, ac.currentTime + i * 0.42); },
    sword: v => { noise(0.07, 0.22 * v, 4200, 'bandpass', 4); tone(1700 + Math.random() * 600, 0.05, 'square', 0.03 * v); },
    arrow: v => noise(0.1, 0.12 * v, 2400 + Math.random() * 800, 'bandpass', 2.5),
    bolt: v => { noise(0.09, 0.16 * v, 1500, 'bandpass', 3); tone(180, 0.06, 'triangle', 0.1 * v, 90); },
    gun: v => { noise(0.16, 0.5 * v, 1800, 'lowpass'); tone(160, 0.1, 'square', 0.12 * v, 60); },
    cannon: v => { noise(0.5, 0.7 * v, 500, 'lowpass'); tone(80, 0.4, 'sine', 0.5 * v, 35); },
    thunk: v => { noise(0.14, 0.3 * v, 600, 'lowpass'); tone(120, 0.18, 'triangle', 0.2 * v, 60); },
    thud: v => { noise(0.2, 0.45 * v, 260, 'lowpass'); tone(70, 0.2, 'sine', 0.4 * v, 40); },
    boom: v => { noise(0.6, 0.7 * v, 700, 'lowpass'); tone(60, 0.5, 'sine', 0.5 * v, 30); },
    crash: v => { noise(0.9, 0.6 * v, 900, 'lowpass'); noise(0.3, 0.3 * v, 3000, 'highpass'); tone(50, 0.7, 'sine', 0.5 * v, 28); },
    rocket: v => { noise(0.8, 0.25 * v, 1200, 'bandpass', 1.2); tone(300, 0.8, 'sawtooth', 0.04 * v, 900); },
    coin: v => { tone(1320, 0.05, 'triangle', 0.07 * v); tone(1760, 0.09, 'triangle', 0.07 * v, 0, ac.currentTime + 0.05); },
    heal: v => tone(880, 0.25, 'sine', 0.05 * v, 1320),
    die: v => tone(220 + Math.random() * 60, 0.18, 'sawtooth', 0.05 * v, 110),
    promote: v => { tone(660, 0.1, 'triangle', 0.12 * v); tone(990, 0.2, 'triangle', 0.12 * v, 0, ac.currentTime + 0.1); },
    capture: v => { tone(330, 0.12, 'square', 0.08 * v); tone(494, 0.12, 'square', 0.08 * v, 0, ac.currentTime + 0.12); tone(659, 0.25, 'square', 0.08 * v, 0, ac.currentTime + 0.24); },
  };

  function play(name, vol) {
    if (!ac || !sfxOn || !DEFS[name]) return;
    const now = ac.currentTime;
    if (last[name] && now - last[name] < 0.05) return;
    last[name] = now;
    try { DEFS[name](vol === undefined ? 1 : vol); } catch (e) { /* ignore */ }
  }
  // positional: attenuated by distance from the centre of the view
  function at(name, x, y) {
    if (!ac || !sfxOn) return;
    let v = 1;
    if (listener) {
      const l = listener(), d = Math.hypot(x - l.x, y - l.y);
      if (d > l.r * 1.6) return;
      v = clamp(1.15 - d / (l.r * 1.6), 0.08, 1);
    }
    play(name, v);
  }

  // --- music: plucked arpeggios over a slow four-chord ground ---------------
  const CHORDS = [[146.83, 174.61, 220.0, 293.66], [130.81, 164.81, 196.0, 261.63], [116.54, 146.83, 174.61, 233.08], [110.0, 138.59, 164.81, 220.0]];
  const PATTERN = [0, 2, 1, 3, 2, 1, 3, 2];
  function pluck(f, t, vol) {
    const o = ac.createOscillator(), o2 = ac.createOscillator(), g = ac.createGain();
    o.type = 'triangle'; o2.type = 'sine'; o.frequency.value = f; o2.frequency.value = f * 2.001;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    o.connect(g); o2.connect(g); g.connect(musicGain); o.start(t); o2.start(t); o.stop(t + 1.2); o2.stop(t + 1.2);
  }
  function schedule() {
    if (!ac || !musicOn) return;
    const beat = 0.34;
    while (nextNote < ac.currentTime + 0.4) {
      const bar = Math.floor(step / 8) % CHORDS.length, ch = CHORDS[bar], i = step % 8;
      pluck(ch[PATTERN[i]] * (step % 32 >= 24 && i % 2 ? 2 : 1), nextNote, 0.5);
      if (i === 0) { pluck(ch[0] / 2, nextNote, 0.7); }
      if (i === 4 && (Math.floor(step / 8) % 2)) pluck(ch[3] * 1.5, nextNote + beat / 2, 0.25);
      nextNote += beat; step++;
    }
  }
  function startMusic() {
    if (!ac || musicTimer) return;
    nextNote = ac.currentTime + 0.2;
    musicTimer = setInterval(schedule, 120);
  }
  function setMusic(on) { musicOn = on; if (musicGain) musicGain.gain.value = on ? 0.12 : 0; }
  function setSfx(on) { sfxOn = on; }

  return { init, play, at, startMusic, setMusic, setSfx, setListener: f => { listener = f; }, get musicOn() { return musicOn; }, get sfxOn() { return sfxOn; } };
})();
