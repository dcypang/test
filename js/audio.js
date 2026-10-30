/* Timbre audio engine: microphone input, pitch (YIN), loudness, recording,
 * and offline analysis of a recording or uploaded audio file. */
window.TimbreAudio = (function () {
  const MIN_HZ = 60;
  const MAX_HZ = 600;
  const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

  /* ---------- DSP helpers ---------- */

  // YIN pitch estimate over buf[0 .. 2W). Returns Hz or 0 when unvoiced.
  function yin(buf, sampleRate, threshold) {
    threshold = threshold || 0.15;
    const W = Math.floor(buf.length / 2);
    const tauMin = Math.max(2, Math.floor(sampleRate / MAX_HZ));
    const tauMax = Math.min(W - 1, Math.floor(sampleRate / MIN_HZ));
    const d = new Float32Array(tauMax + 1);
    for (let tau = 1; tau <= tauMax; tau++) {
      let sum = 0;
      for (let i = 0; i < W; i++) {
        const diff = buf[i] - buf[i + tau];
        sum += diff * diff;
      }
      d[tau] = sum;
    }
    // Cumulative mean normalised difference.
    let running = 0;
    d[0] = 1;
    for (let tau = 1; tau <= tauMax; tau++) {
      running += d[tau];
      d[tau] = running ? (d[tau] * tau) / running : 1;
    }
    let tau = -1;
    for (let t = tauMin; t <= tauMax; t++) {
      if (d[t] < threshold) {
        while (t + 1 <= tauMax && d[t + 1] < d[t]) t++;
        tau = t;
        break;
      }
    }
    if (tau < 0) return 0;
    // Parabolic interpolation around the minimum.
    const x0 = tau > 1 ? d[tau - 1] : d[tau];
    const x2 = tau < tauMax ? d[tau + 1] : d[tau];
    const denom = 2 * (2 * d[tau] - x2 - x0);
    const better = denom ? tau + (x2 - x0) / denom : tau;
    const hz = sampleRate / better;
    return hz >= MIN_HZ && hz <= MAX_HZ ? hz : 0;
  }

  function rmsDb(buf, start, len) {
    start = start || 0;
    len = len || buf.length;
    let sum = 0;
    for (let i = start; i < start + len; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / len);
    return rms > 0 ? 20 * Math.log10(rms) : -100;
  }

  function hzToMidi(hz) { return 69 + 12 * Math.log2(hz / 440); }
  function noteName(hz) {
    if (!hz) return '–';
    const m = Math.round(hzToMidi(hz));
    return NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
  }
  function median(arr) {
    if (!arr.length) return 0;
    const s = arr.slice().sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }
  function percentile(arr, p) {
    if (!arr.length) return 0;
    const s = arr.slice().sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))))];
  }

  /* Summarise a pitch track (Hz, 0 = unvoiced) into speaking statistics.
   * Octave jumps and stray frames are filtered against the median. */
  function pitchStats(track) {
    const voiced = track.filter((h) => h > 0);
    if (voiced.length < 5) return null;
    const med = median(voiced);
    const clean = voiced.filter((h) => h > med / 1.8 && h < med * 1.8);
    if (clean.length < 5) return null;
    const semis = clean.map((h) => 12 * Math.log2(h / med));
    const mean = semis.reduce((a, b) => a + b, 0) / semis.length;
    const sd = Math.sqrt(semis.reduce((a, b) => a + (b - mean) * (b - mean), 0) / semis.length);
    const lo = percentile(clean, 5);
    const hi = percentile(clean, 95);
    return {
      median: med,
      low: lo,
      high: hi,
      rangeSemis: 12 * Math.log2(hi / lo),
      variation: sd,
      voicedFrames: clean.length,
    };
  }

  /* Find speech segments and pauses from a loudness track (dB per frame). */
  function speechStats(levels, frameSecs) {
    if (!levels.length) return null;
    const floor = percentile(levels, 10);
    const peak = percentile(levels, 95);
    const thresh = Math.max(floor + 10, peak - 30, -65);
    const speaking = levels.map((l) => l > thresh);
    let first = speaking.indexOf(true);
    let last = speaking.lastIndexOf(true);
    if (first < 0) return { speechSecs: 0, pauses: 0, longPauses: 0, meanDb: -100, threshold: thresh };
    let pauses = 0;
    let longPauses = 0;
    let gap = 0;
    const speechLevels = [];
    for (let i = first; i <= last; i++) {
      if (speaking[i]) {
        if (gap * frameSecs >= 0.3) pauses++;
        if (gap * frameSecs >= 1.0) longPauses++;
        gap = 0;
        speechLevels.push(levels[i]);
      } else gap++;
    }
    return {
      speechSecs: (last - first + 1) * frameSecs,
      pauses,
      longPauses,
      meanDb: speechLevels.reduce((a, b) => a + b, 0) / speechLevels.length,
      threshold: thresh,
    };
  }

  /* Offline analysis of an AudioBuffer: pitch + loudness tracks and summaries. */
  function analyzeBuffer(audioBuffer) {
    // Mix to mono and decimate to ~16-24 kHz to keep YIN fast.
    const src = audioBuffer.getChannelData(0);
    const ch2 = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : null;
    const factor = Math.max(1, Math.floor(audioBuffer.sampleRate / 16000));
    const sr = audioBuffer.sampleRate / factor;
    const n = Math.floor(src.length / factor);
    const mono = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let k = 0; k < factor; k++) {
        const j = i * factor + k;
        s += ch2 ? (src[j] + ch2[j]) / 2 : src[j];
      }
      mono[i] = s / factor;
    }
    const win = 1024;
    const hop = Math.round(sr * 0.025); // 40 frames per second
    const levels = [];
    const pitches = [];
    for (let start = 0; start + win <= n; start += hop) {
      const db = rmsDb(mono, start, win);
      levels.push(db);
      pitches.push(null);
    }
    const sp = speechStats(levels, hop / sr);
    for (let f = 0; f < levels.length; f++) {
      if (sp && levels[f] > sp.threshold) {
        pitches[f] = yin(mono.subarray(f * hop, f * hop + win), sr);
      } else pitches[f] = 0;
    }
    return {
      duration: audioBuffer.duration,
      frameSecs: hop / sr,
      levels,
      pitches,
      pitch: pitchStats(pitches),
      speech: sp,
    };
  }

  async function analyzeBlob(blob) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    try {
      const arr = await blob.arrayBuffer();
      const buf = await new Promise((resolve, reject) => {
        const p = ctx.decodeAudioData(arr, resolve, reject);
        if (p && p.then) p.then(resolve, reject);
      });
      return analyzeBuffer(buf);
    } finally {
      if (ctx.close) ctx.close().catch(() => {});
    }
  }

  /* ---------- Live microphone ---------- */

  const live = {
    ctx: null,
    stream: null,
    analyser: null,
    buf: null,
    raf: 0,
    listeners: new Set(),
    floor: -60,
    recorder: null,
    chunks: [],
  };

  function micSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && (window.AudioContext || window.webkitAudioContext));
  }

  async function start() {
    if (live.stream) return;
    if (!micSupported()) throw new Error('unsupported');
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    if (ctx.state === 'suspended') await ctx.resume();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    Object.assign(live, { ctx, stream, analyser, buf: new Float32Array(analyser.fftSize), floor: -60 });
    tick();
  }

  function tick() {
    if (!live.analyser) return;
    live.analyser.getFloatTimeDomainData(live.buf);
    const db = rmsDb(live.buf);
    // Slowly rising noise floor that snaps down to quieter readings.
    live.floor = db < live.floor ? db : Math.min(live.floor + 0.01, -20);
    const active = db > Math.max(live.floor + 10, -62);
    const hz = active ? yin(live.buf, live.ctx.sampleRate) : 0;
    const frame = { t: performance.now(), db, hz, active, floor: live.floor };
    live.listeners.forEach((fn) => fn(frame));
    live.raf = requestAnimationFrame(tick);
  }

  function stop() {
    cancelAnimationFrame(live.raf);
    if (live.recorder && live.recorder.state !== 'inactive') live.recorder.stop();
    if (live.stream) live.stream.getTracks().forEach((t) => t.stop());
    if (live.ctx && live.ctx.close) live.ctx.close().catch(() => {});
    Object.assign(live, { ctx: null, stream: null, analyser: null, buf: null, recorder: null });
  }

  function subscribe(fn) {
    live.listeners.add(fn);
    return () => {
      live.listeners.delete(fn);
    };
  }

  function canRecord() { return typeof window.MediaRecorder !== 'undefined'; }

  function startRecording() {
    if (!live.stream || !canRecord()) return false;
    live.chunks = [];
    live.recorder = new MediaRecorder(live.stream);
    live.recorder.ondataavailable = (e) => { if (e.data && e.data.size) live.chunks.push(e.data); };
    live.recorder.start();
    return true;
  }

  function stopRecording() {
    return new Promise((resolve) => {
      const rec = live.recorder;
      if (!rec || rec.state === 'inactive') return resolve(null);
      rec.onstop = () => resolve(new Blob(live.chunks, { type: rec.mimeType || 'audio/webm' }));
      rec.stop();
    });
  }

  return {
    micSupported,
    start,
    stop,
    subscribe,
    isLive: () => !!live.stream,
    canRecord,
    startRecording,
    stopRecording,
    analyzeBlob,
    pitchStats,
    speechStats,
    noteName,
    hzToMidi,
    median,
  };
})();
