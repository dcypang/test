/* Exercise renderers. Each takes (root, exercise, ctx) and returns a cleanup
 * function. ctx = { done(), voiceType, store: { get(k), set(k, v) },
 *                   saveCheck(result), recommend(result) } */
window.TimbreExercises = (function () {
  const A = window.TimbreAudio;
  const { icons, esc, el, fmtTime, shuffle, cssVar } = window.TimbreUI;

  const RANGES = {
    low: { min: 60, max: 330, typical: [85, 155] },
    mid: { min: 75, max: 440, typical: [120, 200] },
    high: { min: 100, max: 580, typical: [165, 255] },
  };

  /* ---------- shared pieces ---------- */

  function head(ex) {
    return `<div class="exercise-head"><span class="eyebrow">Exercise</span><h2>${esc(ex.title)}</h2>${ex.intro ? `<p class="muted">${esc(ex.intro)}</p>` : ''}</div>`;
  }

  function micMessage(err) {
    if (window.self !== window.top) return 'The microphone isn\'t available in this embedded view. Open Timbre on its own page to use live feedback, or upload a recording.';
    if (err && err.message === 'unsupported') return 'This browser can\'t use the microphone here. Open Timbre in Safari or Chrome over https (or localhost).';
    if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) return 'Microphone access was blocked. Allow the microphone for this site in your browser settings, then try again.';
    if (err && err.name === 'NotFoundError') return 'No microphone was found. Connect one and try again.';
    return 'The microphone couldn\'t start. Check that no other app is using it, then try again.';
  }

  function notice(root, msg, withUpload, onBlob) {
    root.querySelectorAll('.notice').forEach((n) => n.remove());
    const n = el(`<div class="notice" role="alert"><span>${esc(msg)}</span></div>`);
    if (withUpload) n.appendChild(uploadButton('Analyze a recording instead', onBlob));
    root.appendChild(n);
    return n;
  }

  function uploadButton(label, onBlob) {
    const id = 'up-' + Math.random().toString(36).slice(2, 8);
    const wrap = el(`<label class="btn secondary small" for="${id}">${icons.upload}<span>${esc(label)}</span><input id="${id}" type="file" accept="audio/*,video/*" hidden></label>`);
    wrap.querySelector('input').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) onBlob(f);
      e.target.value = '';
    });
    return wrap;
  }

  // Convert an offline analysis into the same frame list the live mic produces.
  function framesFromAnalysis(an) {
    const thr = an.speech ? an.speech.threshold : -60;
    return an.levels.map((db, i) => ({ t: i * an.frameSecs * 1000, db, hz: an.pitches[i] || 0, active: db > thr }));
  }

  function summarize(frames) {
    if (frames.length < 2) return { pitch: null, speech: null };
    const frameSecs = (frames[frames.length - 1].t - frames[0].t) / 1000 / (frames.length - 1);
    return {
      pitch: A.pitchStats(frames.map((f) => f.hz)),
      speech: A.speechStats(frames.map((f) => f.db), frameSecs),
    };
  }

  function variationLabel(v) {
    if (v < 1.8) return { text: 'Flat', cls: 'bad' };
    if (v <= 3.5) return { text: 'Natural', cls: 'good' };
    return { text: 'Lively', cls: 'accent' };
  }

  function paceLabel(wpm) {
    if (wpm < 110) return { text: 'Slow', cls: 'warm' };
    if (wpm < 130) return { text: 'Unhurried', cls: 'accent' };
    if (wpm <= 165) return { text: 'Ideal', cls: 'good' };
    if (wpm <= 185) return { text: 'Brisk', cls: 'warm' };
    return { text: 'Rushed', cls: 'bad' };
  }

  function countWords(text) {
    return text.replace(/\/+/g, ' ').split(/\s+/).filter((w) => /[a-z0-9]/i.test(w)).length;
  }

  function passageHtml(text) {
    return esc(text).replace(/\/{1,3}/g, (m) => `<span class="mark">${m}</span>`);
  }

  /* ---------- pitch plot ---------- */

  function PitchPlot(canvas, voiceType, opts) {
    opts = opts || {};
    const range = RANGES[voiceType] || RANGES.mid;
    const ctx2d = canvas.getContext('2d');
    const windowMs = 8000;
    let points = [];
    let staticMode = false;
    let staticDur = 1;

    function size() {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth || 300;
      const h = canvas.clientHeight || 220;
      if (canvas.width !== Math.round(w * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { w, h };
    }
    const yFor = (hz, h) => {
      const lo = Math.log2(range.min);
      const hi = Math.log2(range.max);
      return h - ((Math.log2(hz) - lo) / (hi - lo)) * (h - 16) - 8;
    };

    function draw(now) {
      const { w, h } = size();
      const ink = cssVar('--muted');
      const line = cssVar('--line');
      const accent = cssVar('--accent');
      ctx2d.clearRect(0, 0, w, h);
      if (opts.band) {
        const [a, b] = opts.band;
        ctx2d.fillStyle = cssVar('--accent-soft');
        ctx2d.fillRect(0, yFor(b, h), w, yFor(a, h) - yFor(b, h));
      }
      // Grid on every C and G within range.
      ctx2d.font = '10px ' + cssVar('--font-mono');
      ctx2d.textBaseline = 'bottom';
      for (let midi = 24; midi < 96; midi++) {
        const n = midi % 12;
        if (n !== 0 && n !== 7) continue;
        const hz = 440 * Math.pow(2, (midi - 69) / 12);
        if (hz < range.min || hz > range.max) continue;
        const y = Math.round(yFor(hz, h)) + 0.5;
        ctx2d.strokeStyle = line;
        ctx2d.lineWidth = n === 0 ? 1 : 0.5;
        ctx2d.beginPath();
        ctx2d.moveTo(0, y);
        ctx2d.lineTo(w, y);
        ctx2d.stroke();
        if (n === 0) {
          ctx2d.fillStyle = ink;
          ctx2d.fillText(`${A.noteName(hz)} ${Math.round(hz)}Hz`, 6, y - 2);
        }
      }
      // Trace.
      ctx2d.strokeStyle = accent;
      ctx2d.lineWidth = 3;
      ctx2d.lineCap = 'round';
      ctx2d.lineJoin = 'round';
      ctx2d.beginPath();
      let prev = null;
      for (const p of points) {
        const x = staticMode ? (p.t / staticDur) * w : w - ((now - p.t) / windowMs) * w;
        if (x < -4) continue;
        if (!p.hz) { prev = null; continue; }
        const y = yFor(Math.min(Math.max(p.hz, range.min), range.max), h);
        if (prev && p.t - prev.t < 120) ctx2d.lineTo(x, y);
        else ctx2d.moveTo(x, y);
        prev = p;
      }
      ctx2d.stroke();
    }

    return {
      push(frame) {
        points.push(frame);
        const cut = frame.t - windowMs - 200;
        while (points.length && points[0].t < cut) points.shift();
        draw(frame.t);
      },
      showStatic(frames) {
        staticMode = true;
        points = frames;
        staticDur = Math.max(1, frames.length ? frames[frames.length - 1].t : 1);
        draw(0);
      },
      reset() { staticMode = false; points = []; draw(performance.now()); },
      draw: () => draw(performance.now()),
    };
  }

  /* Split a take into phrases and check whether each one ends lower. */
  function phraseFalls(frames) {
    const phrases = [];
    let cur = [];
    let lastVoiced = -1e9;
    for (const f of frames) {
      if (f.hz > 0) {
        if (f.t - lastVoiced > 350 && cur.length) { phrases.push(cur); cur = []; }
        cur.push(f.hz);
        lastVoiced = f.t;
      }
    }
    if (cur.length) phrases.push(cur);
    const usable = phrases.filter((p) => p.length >= 15);
    let falls = 0;
    for (const p of usable) {
      const cut = Math.floor(p.length * 0.7);
      const start = A.median(p.slice(0, cut));
      const end = A.median(p.slice(cut));
      if (12 * Math.log2(end / start) <= -0.8) falls++;
    }
    return { phrases: usable.length, falls };
  }

  /* ---------- pitch tracker ---------- */

  function pitch(root, ex, ctx) {
    const range = RANGES[ctx.voiceType] || RANGES.mid;
    root.innerHTML = `<div class="exercise">
      ${head(ex)}
      ${ex.prompt ? `<div class="prompt-box">${esc(ex.prompt)}</div>` : ''}
      <div class="readout" aria-live="polite"><span class="big" data-hz>–</span><span class="unit">Hz</span><span class="unit" data-note></span></div>
      <div class="canvas-wrap"><canvas aria-label="Pitch trace"></canvas></div>
      <div class="row" style="justify-content:center;flex-wrap:wrap">
        <button class="btn" data-go>${icons.mic}<span>Start</span></button>
      </div>
      <div data-results class="stack"></div>
    </div>`;
    const ex$ = root.querySelector('.exercise');
    const plot = PitchPlot(root.querySelector('canvas'), ctx.voiceType, { band: ex.goal === 'median' ? range.typical : null });
    plot.draw();
    const hzEl = root.querySelector('[data-hz]');
    const noteEl = root.querySelector('[data-note]');
    const go = root.querySelector('[data-go]');
    const results = root.querySelector('[data-results]');
    const controls = go.parentElement;
    controls.appendChild(uploadButton('Use a recording', analyzeFile));
    let frames = [];
    let unsub = null;
    let t0 = 0;
    let running = false;
    let autoStop = 0;

    async function startTake() {
      try {
        await A.start();
      } catch (err) {
        notice(ex$, micMessage(err), false);
        return;
      }
      results.innerHTML = '';
      frames = [];
      plot.reset();
      t0 = performance.now();
      running = true;
      go.innerHTML = `${icons.stop}<span>Stop</span>`;
      unsub = A.subscribe((f) => {
        const fr = { t: f.t - t0, hz: f.hz, db: f.db, active: f.active };
        frames.push(fr);
        plot.push({ t: f.t, hz: f.hz });
        hzEl.textContent = f.hz ? Math.round(f.hz) : '–';
        noteEl.textContent = f.hz ? A.noteName(f.hz) : '';
      });
      autoStop = setTimeout(stopTake, 45000);
    }

    function stopTake() {
      clearTimeout(autoStop);
      if (!running) return;
      running = false;
      if (unsub) unsub();
      unsub = null;
      A.stop();
      go.innerHTML = `${icons.mic}<span>Try again</span>`;
      evaluate(frames);
    }

    async function analyzeFile(file) {
      results.innerHTML = '<p class="muted">Analyzing…</p>';
      try {
        const an = await A.analyzeBlob(file);
        const fr = framesFromAnalysis(an);
        plot.showStatic(fr);
        evaluate(fr);
      } catch (e) {
        results.innerHTML = '<div class="notice">That file couldn\'t be read. Try an .m4a, .mp3 or .wav voice recording.</div>';
      }
    }

    function evaluate(fr) {
      const { pitch: st } = summarize(fr);
      if (!st) {
        results.innerHTML = '<div class="notice">Not enough voiced sound was detected. Get a little closer to the microphone and speak or hum for a few seconds.</div>';
        return;
      }
      let verdict = '';
      let passed = true;
      if (ex.goal === 'range') {
        passed = st.rangeSemis >= ex.target;
        verdict = passed ? `You covered ${st.rangeSemis.toFixed(1)} semitones. Great range work.` : `You covered ${st.rangeSemis.toFixed(1)} semitones. Aim for ${ex.target}: slide a little lower and a little higher.`;
      } else if (ex.goal === 'steady') {
        passed = st.variation <= ex.target;
        verdict = passed ? 'Nice and steady. That\'s a well-supported tone.' : 'The pitch wobbled. Take a fuller breath and keep the hum even.';
      } else if (ex.goal === 'variation') {
        passed = st.variation >= ex.target;
        verdict = passed ? 'Lovely melody. That is an engaging, expressive read.' : `Variation was ${st.variation.toFixed(1)} semitones. Exaggerate more: go higher on exciting words and lower on calm ones.`;
      } else if (ex.goal === 'fall') {
        const pf = phraseFalls(fr);
        passed = pf.phrases > 0 && pf.falls >= Math.ceil(pf.phrases / 2);
        verdict = pf.phrases === 0 ? 'Say each sentence clearly with a short pause between them.' : passed ? `${pf.falls} of ${pf.phrases} phrases landed with a falling pitch. Confident endings.` : `${pf.falls} of ${pf.phrases} phrases fell at the end. Let the last word drop lower.`;
      } else if (ex.goal === 'median') {
        const [a, b] = range.typical;
        const where = st.median < a ? 'below' : st.median > b ? 'above' : 'within';
        verdict = `Your speaking pitch is about ${Math.round(st.median)} Hz (${A.noteName(st.median)}), ${where} the typical ${a}–${b} Hz band for your voice type. Any healthy, comfortable pitch is fine.`;
        ctx.store.set('speakingPitch', Math.round(st.median));
      }
      const vl = variationLabel(st.variation);
      results.innerHTML = `
        <div class="results">
          <div class="result"><span>Median pitch</span><b>${Math.round(st.median)} Hz</b><em>${A.noteName(st.median)}</em></div>
          <div class="result"><span>Range</span><b>${st.rangeSemis.toFixed(1)} st</b><em>${Math.round(st.low)}–${Math.round(st.high)} Hz</em></div>
          <div class="result"><span>Variation</span><b>${st.variation.toFixed(1)} st</b><em class="pill ${vl.cls}">${vl.text}</em></div>
        </div>
        ${verdict ? `<div class="verdict ${passed ? 'good' : 'meh'}">${esc(verdict)}</div>` : ''}`;
      ctx.done();
    }

    go.addEventListener('click', () => (running ? stopTake() : startTake()));
    return () => { clearTimeout(autoStop); if (unsub) unsub(); A.stop(); };
  }

  /* ---------- sustained sound ---------- */

  function sustain(root, ex, ctx) {
    const best = () => ctx.store.get('sustainBest') || 0;
    root.innerHTML = `<div class="exercise">
      ${head(ex)}
      <div class="card stack" style="align-items:center;text-align:center">
        <span class="eyebrow" data-state>Ready</span>
        <div class="readout"><span class="big" data-secs>0.0</span><span class="unit">sec</span></div>
        <div class="bar" style="width:100%"><i data-bar style="width:0"></i></div>
        <p class="muted" style="font-size:.9rem">Goal <b class="mono">${ex.goal}s</b> · Best <b class="mono" data-best>${best().toFixed(1)}s</b></p>
      </div>
      <div class="row" style="justify-content:center;flex-wrap:wrap">
        <button class="btn" data-go>${icons.mic}<span>Start</span></button>
        <button class="btn secondary" data-manual>Time it by hand</button>
      </div>
      <div data-results></div>
    </div>`;
    const $ = (s) => root.querySelector(s);
    const ex$ = $('.exercise');
    let unsub = null;
    let phase = 'idle';
    let ambient = [];
    let thresh = -50;
    let startT = 0;
    let lastActive = 0;
    let calibStart = 0;
    let manualStart = 0;
    let manualTimer = 0;

    function show(secs) {
      $('[data-secs]').textContent = secs.toFixed(1);
      $('[data-bar]').style.width = Math.min(100, (secs / ex.goal) * 100) + '%';
    }

    function finish(secs) {
      phase = 'idle';
      if (unsub) unsub();
      unsub = null;
      A.stop();
      $('[data-go]').innerHTML = `${icons.mic}<span>Go again</span>`;
      $('[data-state]').textContent = 'Done';
      const prevBest = best();
      if (secs > prevBest) ctx.store.set('sustainBest', secs);
      $('[data-best]').textContent = Math.max(prevBest, secs).toFixed(1) + 's';
      const hit = secs >= ex.goal;
      $('[data-results]').innerHTML = `<div class="verdict ${hit ? 'good' : 'meh'}">${hit ? `${secs.toFixed(1)} seconds. You hit the goal.` : `${secs.toFixed(1)} seconds. Keep the hiss quieter and more even to stretch it out.`}${secs > prevBest && prevBest ? ' New personal best!' : ''}</div>`;
      if (secs >= 5) ctx.done();
    }

    async function start() {
      if (phase !== 'idle') {
        if (phase === 'holding') finish((lastActive - startT) / 1000);
        else { phase = 'idle'; if (unsub) unsub(); A.stop(); $('[data-go]').innerHTML = `${icons.mic}<span>Start</span>`; $('[data-state]').textContent = 'Ready'; }
        return;
      }
      try { await A.start(); } catch (err) { notice(ex$, micMessage(err) + ' You can still use "Time it by hand".'); return; }
      phase = 'calibrating';
      ambient = [];
      calibStart = performance.now();
      show(0);
      $('[data-results]').innerHTML = '';
      $('[data-state]').textContent = 'Stay quiet… breathe in low';
      $('[data-go]').innerHTML = `${icons.stop}<span>Stop</span>`;
      unsub = A.subscribe((f) => {
        if (phase === 'calibrating') {
          ambient.push(f.db);
          if (f.t - calibStart > 1200) {
            // Quietest readings + 8 dB, capped so a hiss that started early still counts.
            thresh = Math.min(Math.max(ambient.slice().sort((a, b) => a - b)[Math.floor(ambient.length * 0.1)] + 8, -70), -38);
            phase = 'waiting';
            $('[data-state]').textContent = `Now: "${ex.sound}"…`;
          }
        } else if (phase === 'waiting') {
          if (f.db > thresh) { phase = 'holding'; startT = f.t; lastActive = f.t; $('[data-state]').textContent = 'Keep it even…'; }
        } else if (phase === 'holding') {
          if (f.db > thresh) lastActive = f.t;
          show((f.t - startT) / 1000);
          if (f.t - lastActive > 700) finish((lastActive - startT) / 1000);
        }
      });
    }

    $('[data-go]').addEventListener('click', start);
    $('[data-manual]').addEventListener('click', () => {
      const btn = $('[data-manual]');
      if (!manualStart) {
        manualStart = performance.now();
        btn.textContent = 'Stop timer';
        $('[data-state]').textContent = 'Timing by hand';
        manualTimer = setInterval(() => show((performance.now() - manualStart) / 1000), 100);
      } else {
        clearInterval(manualTimer);
        const secs = (performance.now() - manualStart) / 1000;
        manualStart = 0;
        btn.textContent = 'Time it by hand';
        show(secs);
        finish(secs);
      }
    });
    return () => { clearInterval(manualTimer); if (unsub) unsub(); A.stop(); };
  }

  /* ---------- volume / projection ---------- */

  function volume(root, ex, ctx) {
    const levels = ex.levels;
    const SPAN = 18;
    root.innerHTML = `<div class="exercise">
      ${head(ex)}
      <div class="card stack">
        <div class="row" style="justify-content:space-between"><span class="eyebrow" data-state>Step 1 · Set your baseline</span><span class="mono" data-rel>–</span></div>
        <div class="meter" aria-hidden="true"><div class="fill"></div><div class="peak" style="left:0"></div>
          ${levels.map((l) => `<div class="tick" style="left:${((l.db + SPAN) / (2 * SPAN)) * 100}%"><span>${l.db > 0 ? '+' : ''}${l.db}</span></div>`).join('')}
        </div>
        <p class="muted" style="font-size:.88rem" data-help>Tap Start and speak a sentence in your normal voice for 3 seconds, like "Hi, this is my everyday voice."</p>
      </div>
      <div class="row" style="justify-content:center"><button class="btn" data-go>${icons.mic}<span>Start</span></button></div>
      <div class="levels">${levels.map((l, i) => `<button class="level" data-level="${i}" disabled><span class="dot">${icons.check}</span><span>${esc(l.label)}</span><span class="mono muted">${l.db > 0 ? '+' : ''}${l.db} dB</span></button>`).join('')}</div>
    </div>`;
    const $ = (s) => root.querySelector(s);
    const ex$ = $('.exercise');
    const fill = $('.fill');
    const peakEl = $('.peak');
    const btns = Array.from(root.querySelectorAll('[data-level]'));
    let unsub = null;
    let baseline = null;
    let calib = [];
    let calibT = 0;
    let smooth = -SPAN;
    let peak = -SPAN;
    let peakT = 0;
    let target = 0;
    let holdSince = 0;
    const hit = new Set();

    function selectTarget(i) {
      target = i;
      btns.forEach((b, j) => b.classList.toggle('target', j === i));
      $('[data-help]').textContent = `Target: ${levels[i].label}. Hold the level near the ${levels[i].db > 0 ? '+' : ''}${levels[i].db} dB mark for a moment.`;
    }

    async function start() {
      if (unsub) { unsub(); unsub = null; A.stop(); $('[data-go]').innerHTML = `${icons.mic}<span>Start</span>`; return; }
      try { await A.start(); } catch (err) { notice(ex$, micMessage(err)); return; }
      $('[data-go]').innerHTML = `${icons.stop}<span>Stop</span>`;
      if (baseline === null) { calib = []; calibT = performance.now(); $('[data-state]').textContent = 'Listening… speak normally'; }
      unsub = A.subscribe((f) => {
        if (baseline === null) {
          if (f.active) calib.push(f.db);
          if (f.t - calibT > 3500) {
            if (calib.length < 20) { calibT = f.t; calib = []; $('[data-help]').textContent = 'I didn\'t hear enough. Keep talking in your normal voice.'; return; }
            baseline = A.median(calib);
            $('[data-state]').textContent = 'Step 2 · Hit each level';
            btns.forEach((b) => (b.disabled = false));
            selectTarget(0);
          }
          return;
        }
        const rel = f.active ? f.db - baseline : -SPAN;
        smooth = smooth + (rel - smooth) * (rel > smooth ? 0.5 : 0.12);
        const clamped = Math.max(-SPAN, Math.min(SPAN, smooth));
        fill.style.width = ((clamped + SPAN) / (2 * SPAN)) * 100 + '%';
        if (clamped > peak || f.t - peakT > 1500) { peak = clamped; peakT = f.t; }
        peakEl.style.left = ((peak + SPAN) / (2 * SPAN)) * 100 + '%';
        $('[data-rel]').textContent = f.active ? `${clamped >= 0 ? '+' : ''}${clamped.toFixed(1)} dB` : '–';
        if (f.active && Math.abs(smooth - levels[target].db) <= 2) {
          if (!holdSince) holdSince = f.t;
          if (f.t - holdSince > 600 && !hit.has(target)) {
            hit.add(target);
            btns[target].classList.add('hit');
            if (hit.size >= Math.min(3, levels.length)) ctx.done();
            const next = levels.findIndex((_, i) => !hit.has(i));
            if (next >= 0) selectTarget(next);
            else $('[data-help]').textContent = 'Every level hit. Notice how breath, not throat, carried the louder ones.';
          }
        } else holdSince = 0;
      });
    }

    btns.forEach((b, i) => b.addEventListener('click', () => selectTarget(i)));
    $('[data-go]').addEventListener('click', start);
    return () => { if (unsub) unsub(); A.stop(); };
  }

  /* ---------- record and play back ---------- */

  function record(root, ex, ctx) {
    const prompts = ex.prompts || ['Say anything you like.'];
    const takes = prompts.map(() => []);
    let idx = 0;
    let recording = false;
    let micReady = false;
    const urls = [];
    root.innerHTML = `<div class="exercise">
      ${head(ex)}
      <div class="prompt-nav">
        <button class="icon-btn" data-prev aria-label="Previous line">${icons.back}</button>
        <span class="eyebrow mono" data-count></span>
        <button class="icon-btn" data-next aria-label="Next line">${icons.chevron}</button>
      </div>
      <div class="prompt-box" data-prompt></div>
      <div class="rec-controls"><button class="rec-btn" data-rec aria-label="Record">${icons.mic}</button></div>
      <p class="muted" style="text-align:center;font-size:.85rem" data-rec-state>Tap to record this line</p>
      <div class="takes" data-takes></div>
      ${ex.checklist ? `<div class="stack"><span class="eyebrow">Listen back and check</span><div class="checks" data-checks></div></div>` : ''}
    </div>`;
    const $ = (s) => root.querySelector(s);
    const ex$ = $('.exercise');

    function renderPrompt() {
      $('[data-prompt]').textContent = prompts[idx];
      $('[data-count]').textContent = `${idx + 1} / ${prompts.length}`;
      $('[data-prev]').disabled = idx === 0;
      $('[data-next]').disabled = idx === prompts.length - 1;
      const list = $('[data-takes]');
      list.innerHTML = '';
      takes[idx].forEach((t, n) => {
        const row = el(`<div class="take"><span class="mono muted">Take ${n + 1}</span><audio controls preload="metadata" src="${t.url}"></audio></div>`);
        if (ex.analyze) {
          const b = el(`<button class="btn small secondary">Analyze</button>`);
          b.addEventListener('click', () => analyzeTake(t.blob, row));
          row.appendChild(b);
        }
        list.appendChild(row);
      });
    }

    async function analyzeTake(blob, row) {
      const out = el('<div class="stack"><p class="muted">Analyzing…</p></div>');
      row.after(out);
      try {
        const an = await A.analyzeBlob(blob);
        out.innerHTML = analysisHtml(an);
      } catch (e) {
        out.innerHTML = '<div class="notice">This recording couldn\'t be analyzed in this browser.</div>';
      }
    }

    async function toggle() {
      if (!recording) {
        if (!micReady) {
          try { await A.start(); micReady = true; } catch (err) { notice(ex$, micMessage(err) + ' Practise each line aloud instead, then tick the checklist.'); return; }
        }
        if (!A.startRecording()) { notice(ex$, 'Recording isn\'t supported in this browser. Practise each line aloud, then tick the checklist.'); return; }
        recording = true;
        $('[data-rec]').classList.add('on');
        $('[data-rec]').innerHTML = icons.stop;
        $('[data-rec-state]').textContent = 'Recording… tap to stop';
      } else {
        recording = false;
        const blob = await A.stopRecording();
        $('[data-rec]').classList.remove('on');
        $('[data-rec]').innerHTML = icons.mic;
        $('[data-rec-state]').textContent = 'Tap to record another take';
        if (blob && blob.size) {
          const url = URL.createObjectURL(blob);
          urls.push(url);
          takes[idx].push({ url, blob });
          renderPrompt();
          ctx.done();
        }
      }
    }

    $('[data-prev]').addEventListener('click', () => { if (!recording && idx > 0) { idx--; renderPrompt(); } });
    $('[data-next]').addEventListener('click', () => { if (!recording && idx < prompts.length - 1) { idx++; renderPrompt(); } });
    $('[data-rec]').addEventListener('click', toggle);
    if (ex.checklist) checklistInto($('[data-checks]'), ex.checklist, 'rc:' + ex.title, ctx);
    if (ex.analyze) $('.rec-controls').after(el('<div class="row" style="justify-content:center"></div>'));
    if (ex.analyze) ex$.querySelector('.rec-controls + .row').appendChild(uploadButton('Analyze a file', async (f) => {
      const out = $('[data-takes]');
      out.innerHTML = '<p class="muted">Analyzing…</p>';
      try { out.innerHTML = analysisHtml(await A.analyzeBlob(f)); } catch (e) { out.innerHTML = '<div class="notice">That file couldn\'t be read. Try an .m4a, .mp3 or .wav voice recording.</div>'; }
    }));
    renderPrompt();
    return () => { if (recording) A.stopRecording(); A.stop(); urls.forEach((u) => URL.revokeObjectURL(u)); };
  }

  function analysisHtml(an) {
    const st = an.pitch;
    const sp = an.speech;
    if (!st) return '<div class="notice">Not enough voiced speech was found in this recording.</div>';
    const vl = variationLabel(st.variation);
    return `<div class="results">
      <div class="result"><span>Median pitch</span><b>${Math.round(st.median)} Hz</b><em>${A.noteName(st.median)}</em></div>
      <div class="result"><span>Variation</span><b>${st.variation.toFixed(1)} st</b><em class="pill ${vl.cls}">${vl.text}</em></div>
      <div class="result"><span>Range</span><b>${st.rangeSemis.toFixed(1)} st</b><em>${Math.round(st.low)}–${Math.round(st.high)} Hz</em></div>
      <div class="result"><span>Speaking time</span><b>${fmtTime(sp.speechSecs)}</b><em>${sp.pauses} pauses · ${sp.longPauses} long</em></div>
    </div>`;
  }

  /* ---------- pace ---------- */

  function pace(root, ex, ctx) {
    const words = countWords(ex.text);
    root.innerHTML = `<div class="exercise">
      ${head(ex)}
      <div class="prompt-box passage">${passageHtml(ex.text)}</div>
      <div class="card row" style="justify-content:space-between">
        <div><span class="eyebrow">Time</span><div class="mono" style="font-size:1.6rem" data-time>0:00</div></div>
        <div style="text-align:right"><span class="eyebrow">Words</span><div class="mono" style="font-size:1.6rem">${words}</div></div>
      </div>
      <div class="row" style="justify-content:center"><button class="btn" data-go>${icons.play}<span>Start reading</span></button></div>
      <div data-results class="stack"></div>
    </div>`;
    const $ = (s) => root.querySelector(s);
    const ex$ = $('.exercise');
    let running = false;
    let t0 = 0;
    let timer = 0;
    let unsub = null;
    let frames = [];
    let micOk = false;

    async function start() {
      $('[data-results]').innerHTML = '';
      frames = [];
      micOk = false;
      try { await A.start(); micOk = true; } catch (err) { notice(ex$, micMessage(err) + ' The timer still works: tap Stop the moment you finish.'); }
      running = true;
      t0 = performance.now();
      $('[data-go]').innerHTML = `${icons.stop}<span>Stop</span>`;
      timer = setInterval(() => ($('[data-time]').textContent = fmtTime((performance.now() - t0) / 1000)), 250);
      if (micOk) unsub = A.subscribe((f) => frames.push({ t: f.t - t0, db: f.db, hz: f.hz, active: f.active }));
    }

    function stop() {
      running = false;
      clearInterval(timer);
      if (unsub) unsub();
      unsub = null;
      A.stop();
      $('[data-go]').innerHTML = `${icons.play}<span>Read again</span>`;
      const elapsed = (performance.now() - t0) / 1000;
      const { speech } = micOk ? summarize(frames) : { speech: null };
      const secs = speech && speech.speechSecs > elapsed * 0.4 ? speech.speechSecs : elapsed;
      if (secs < 5) { $('[data-results]').innerHTML = '<div class="notice">That was very short. Read the whole passage, then tap Stop.</div>'; return; }
      const wpm = Math.round(words / (secs / 60));
      const pl = paceLabel(wpm);
      const [lo, hi] = ex.target;
      const inRange = wpm >= lo && wpm <= hi;
      $('[data-results]').innerHTML = `
        <div class="results">
          <div class="result"><span>Pace</span><b>${wpm} wpm</b><em class="pill ${pl.cls}">${pl.text}</em></div>
          <div class="result"><span>Reading time</span><b>${fmtTime(secs)}</b><em>target ${lo}–${hi} wpm</em></div>
          ${speech ? `<div class="result"><span>Pauses</span><b>${speech.pauses}</b><em>${speech.longPauses} over 1 second</em></div>` : ''}
        </div>
        <div class="verdict ${inRange ? 'good' : 'meh'}">${inRange ? 'Right in the target zone. Easy to follow.' : wpm > hi ? 'A bit fast. Slow down and let the pauses breathe.' : 'A little slow. Keep the energy moving between pauses.'}</div>`;
      ctx.store.set('lastWpm', wpm);
      ctx.done();
    }

    $('[data-go]').addEventListener('click', () => (running ? stop() : start()));
    return () => { clearInterval(timer); if (unsub) unsub(); A.stop(); };
  }

  /* ---------- voice check (assessment) ---------- */

  function voicecheck(root, ex, ctx) {
    const text = ex.text || window.TIMBRE_CONTENT.VOICE_CHECK_PASSAGE;
    const words = countWords(text);
    root.innerHTML = `<div class="exercise">
      ${head(ex)}
      <div class="prompt-box passage">${esc(text)}</div>
      <div class="canvas-wrap"><canvas aria-label="Pitch trace"></canvas></div>
      <div class="row" style="justify-content:center;flex-wrap:wrap">
        <button class="btn" data-go>${icons.mic}<span>Start reading</span></button>
        <span class="mono muted" data-time>0:00</span>
      </div>
      <div data-results class="stack"></div>
    </div>`;
    const $ = (s) => root.querySelector(s);
    const ex$ = $('.exercise');
    const plot = PitchPlot($('canvas'), ctx.voiceType);
    plot.draw();
    $('[data-go]').parentElement.appendChild(uploadButton('Upload a recording', analyzeFile));
    let running = false;
    let unsub = null;
    let frames = [];
    let t0 = 0;
    let timer = 0;

    async function start() {
      try { await A.start(); } catch (err) { notice(ex$, micMessage(err) + ' You can upload a voice memo of yourself reading the passage instead.', false); return; }
      frames = [];
      plot.reset();
      $('[data-results]').innerHTML = '';
      running = true;
      t0 = performance.now();
      $('[data-go]').innerHTML = `${icons.stop}<span>I\'m done</span>`;
      timer = setInterval(() => ($('[data-time]').textContent = fmtTime((performance.now() - t0) / 1000)), 250);
      unsub = A.subscribe((f) => {
        frames.push({ t: f.t - t0, db: f.db, hz: f.hz, active: f.active });
        plot.push({ t: f.t, hz: f.hz });
      });
    }

    function stop() {
      running = false;
      clearInterval(timer);
      if (unsub) unsub();
      unsub = null;
      A.stop();
      $('[data-go]').innerHTML = `${icons.mic}<span>Read again</span>`;
      score(frames, summarize(frames));
    }

    async function analyzeFile(file) {
      $('[data-results]').innerHTML = '<p class="muted">Analyzing…</p>';
      try {
        const an = await A.analyzeBlob(file);
        const fr = framesFromAnalysis(an);
        plot.showStatic(fr);
        score(fr, { pitch: an.pitch, speech: an.speech });
      } catch (e) {
        $('[data-results]').innerHTML = '<div class="notice">That file couldn\'t be read. Try an .m4a, .mp3 or .wav voice recording.</div>';
      }
    }

    function score(fr, { pitch: st, speech: sp }) {
      if (!st || !sp || sp.speechSecs < 8) {
        $('[data-results]').innerHTML = '<div class="notice">I couldn\'t hear enough of the passage. Read the whole thing, close to the microphone, then tap "I\'m done".</div>';
        return;
      }
      const wpm = Math.round(words / (sp.speechSecs / 60));
      const result = {
        at: Date.now(),
        median: Math.round(st.median),
        variation: +st.variation.toFixed(2),
        range: +st.rangeSemis.toFixed(1),
        wpm,
        pauses: sp.pauses,
        longPauses: sp.longPauses,
        secs: Math.round(sp.speechSecs),
      };
      const prev = ctx.lastCheck ? ctx.lastCheck() : null;
      ctx.saveCheck(result);
      const vl = variationLabel(result.variation);
      const pl = paceLabel(wpm);
      const delta = (k, d, unit) => (prev && prev[k] != null ? `<em class="muted">${result[k] - prev[k] >= 0 ? '+' : ''}${(result[k] - prev[k]).toFixed(d)}${unit} vs last</em>` : '');
      $('[data-results]').innerHTML = `
        <div class="results">
          <div class="result"><span>Speaking pitch</span><b>${result.median} Hz</b><em>${A.noteName(result.median)}</em></div>
          <div class="result"><span>Melody</span><b>${result.variation.toFixed(1)} st</b><em class="pill ${vl.cls}">${vl.text}</em>${delta('variation', 1, ' st')}</div>
          <div class="result"><span>Pace</span><b>${wpm} wpm</b><em class="pill ${pl.cls}">${pl.text}</em>${delta('wpm', 0, '')}</div>
          <div class="result"><span>Pauses</span><b>${result.pauses}</b><em>${result.longPauses} over 1 second</em></div>
          <div class="result"><span>Range</span><b>${result.range.toFixed(1)} st</b>${delta('range', 1, ' st')}</div>
        </div>
        ${ctx.recommend ? ctx.recommend(result) : ''}`;
      ctx.done();
    }

    $('[data-go]').addEventListener('click', () => (running ? stop() : start()));
    return () => { clearInterval(timer); if (unsub) unsub(); A.stop(); };
  }

  /* ---------- filler tally ---------- */

  function tally(root, ex, ctx) {
    let topics = shuffle(ex.topics);
    let count = 0;
    let left = ex.secs;
    let timer = 0;
    let running = false;
    let recUrl = null;
    let recOn = false;
    root.innerHTML = `<div class="exercise">
      ${head(ex)}
      <div class="prompt-box row" style="justify-content:space-between"><b data-topic></b><button class="btn ghost small" data-new>New topic</button></div>
      <div class="readout"><span class="big" data-left>${fmtTime(left)}</span></div>
      <button class="tally-btn" data-tap disabled aria-label="Count a filler word"><b data-count>0</b><span>fillers · tap</span></button>
      <label class="check"><input type="checkbox" id="tally-rec"><span>Record myself so I can listen back</span></label>
      <div class="row" style="justify-content:center"><button class="btn" data-go>${icons.play}<span>Start talking</span></button></div>
      <div data-results class="stack"></div>
    </div>`;
    const $ = (s) => root.querySelector(s);
    const ex$ = $('.exercise');
    const setTopic = () => ($('[data-topic]').textContent = topics[0]);
    setTopic();
    $('[data-new]').addEventListener('click', () => { topics.push(topics.shift()); setTopic(); });
    $('[data-tap]').addEventListener('click', () => { count++; $('[data-count]').textContent = count; });

    async function start() {
      count = 0; left = ex.secs;
      $('[data-count]').textContent = '0';
      $('[data-results]').innerHTML = '';
      if ($('#tally-rec').checked) {
        try { await A.start(); recOn = A.startRecording(); } catch (err) { notice(ex$, micMessage(err) + ' The counter still works without recording.'); }
      }
      running = true;
      $('[data-tap]').disabled = false;
      $('[data-go]').innerHTML = `${icons.stop}<span>Finish early</span>`;
      timer = setInterval(() => {
        left--;
        $('[data-left]').textContent = fmtTime(left);
        if (left <= 0) finish();
      }, 1000);
    }

    async function finish() {
      clearInterval(timer);
      running = false;
      $('[data-tap]').disabled = true;
      $('[data-go]').innerHTML = `${icons.play}<span>Go again</span>`;
      const spoke = ex.secs - left;
      let audio = '';
      if (recOn) {
        const blob = await A.stopRecording();
        recOn = false;
        if (blob) { if (recUrl) URL.revokeObjectURL(recUrl); recUrl = URL.createObjectURL(blob); audio = `<div class="take"><span class="mono muted">Your talk</span><audio controls src="${recUrl}"></audio></div>`; }
      }
      A.stop();
      const perMin = spoke > 0 ? (count / spoke) * 60 : 0;
      const prevBest = ctx.store.get('fillerBest');
      if (spoke >= 30 && (prevBest == null || perMin < prevBest)) ctx.store.set('fillerBest', +perMin.toFixed(1));
      $('[data-results]').innerHTML = `
        <div class="results">
          <div class="result"><span>Fillers</span><b>${count}</b><em>in ${fmtTime(spoke)}</em></div>
          <div class="result"><span>Per minute</span><b>${perMin.toFixed(1)}</b><em>${prevBest != null ? `best ${prevBest}` : 'first try'}</em></div>
        </div>
        <div class="verdict ${perMin <= 3 ? 'good' : 'meh'}">${perMin <= 3 ? 'Very clean. Your pauses are doing the work.' : 'Next round, when you feel a filler coming, close your mouth and pause.'}</div>
        ${audio}`;
      if (spoke >= 20) ctx.done();
    }

    $('[data-go]').addEventListener('click', () => (running ? finish() : start()));
    return () => { clearInterval(timer); if (recOn) A.stopRecording(); A.stop(); if (recUrl) URL.revokeObjectURL(recUrl); };
  }

  /* ---------- checklist ---------- */

  function checklistInto(container, items, key, ctx) {
    const saved = ctx.store.get(key) || [];
    container.innerHTML = items.map((t, i) => `<label class="check"><input type="checkbox" data-i="${i}" ${saved[i] ? 'checked' : ''}><span>${esc(t)}</span></label>`).join('');
    container.addEventListener('change', () => {
      const vals = Array.from(container.querySelectorAll('input')).map((c) => c.checked);
      ctx.store.set(key, vals);
      if (vals.some(Boolean)) ctx.done();
    });
    if (saved.some(Boolean)) ctx.done();
  }

  function checklist(root, ex, ctx) {
    root.innerHTML = `<div class="exercise">${head(ex)}<div class="checks"></div></div>`;
    checklistInto(root.querySelector('.checks'), ex.items, 'cl:' + ex.title, ctx);
    return () => {};
  }

  /* ---------- breathing pacer ---------- */

  function breath(root, ex, ctx) {
    const names = ex.labels || ['Breathe in', 'Hold', 'Breathe out', 'Hold'];
    const phases = ex.pattern.map((secs, i) => ({ secs, label: names[i] || '', i })).filter((p) => p.secs > 0);
    root.innerHTML = `<div class="exercise">
      ${head(ex)}
      <div class="breath-stage">
        <div class="breath-ring"><div class="ball"></div><div class="label" data-label>Ready</div><div class="count" data-count></div></div>
        <span class="eyebrow mono" data-round style="margin-top:28px">Round 0 / ${ex.rounds}</span>
      </div>
      <div class="row" style="justify-content:center"><button class="btn" data-go>${icons.play}<span>Begin</span></button></div>
    </div>`;
    const $ = (s) => root.querySelector(s);
    const ball = $('.ball');
    let timer = 0;
    let running = false;

    function run() {
      let round = 1;
      let pi = 0;
      let left = phases[0].secs;
      const apply = () => {
        const p = phases[pi];
        $('[data-label]').textContent = p.label;
        $('[data-round]').textContent = `Round ${round} / ${ex.rounds}`;
        ball.style.transitionDuration = p.secs + 's';
        if (p.i === 0) ball.style.transform = 'scale(1)';
        if (p.i === 2) ball.style.transform = 'scale(0.55)';
      };
      apply();
      $('[data-count]').textContent = left;
      timer = setInterval(() => {
        left--;
        if (left <= 0) {
          pi++;
          if (pi >= phases.length) { pi = 0; round++; }
          if (round > ex.rounds) {
            stop();
            $('[data-label]').textContent = 'Well done';
            $('[data-round]').textContent = `${ex.rounds} rounds complete`;
            ctx.done();
            return;
          }
          left = phases[pi].secs;
          apply();
        }
        $('[data-count]').textContent = left;
      }, 1000);
    }

    function stop() {
      clearInterval(timer);
      running = false;
      ball.style.transitionDuration = '0.6s';
      ball.style.transform = 'scale(0.55)';
      $('[data-count]').textContent = '';
      $('[data-go]').innerHTML = `${icons.play}<span>Begin again</span>`;
    }

    $('[data-go]').addEventListener('click', () => {
      if (running) { stop(); $('[data-label]').textContent = 'Paused'; return; }
      running = true;
      $('[data-go]').innerHTML = `${icons.stop}<span>Stop</span>`;
      run();
    });
    return () => clearInterval(timer);
  }

  /* ---------- guided steps ---------- */

  function steps(root, ex, ctx) {
    root.innerHTML = `<div class="exercise">
      ${head(ex)}
      <ol class="steps-list">${ex.steps.map((s, i) => `<li data-i="${i}"><span class="n">${i + 1}</span><div><span>${esc(s.text)}</span><div class="bar" hidden><i style="width:0"></i></div></div></li>`).join('')}</ol>
      <div class="row" style="justify-content:center;flex-wrap:wrap">
        <button class="btn" data-go>${icons.play}<span>Start</span></button>
        <button class="btn secondary" data-skip hidden>Next step</button>
      </div>
    </div>`;
    const $ = (s) => root.querySelector(s);
    const items = Array.from(root.querySelectorAll('.steps-list li'));
    let cur = -1;
    let left = 0;
    let timer = 0;
    let paused = false;

    function goto(i) {
      cur = i;
      items.forEach((li, j) => {
        li.classList.toggle('current', j === i);
        li.classList.toggle('past', j < i);
        li.querySelector('.bar').hidden = j !== i;
      });
      if (i >= ex.steps.length) {
        clearInterval(timer);
        $('[data-go]').innerHTML = `${icons.play}<span>Do it again</span>`;
        $('[data-skip]').hidden = true;
        cur = -1;
        ctx.done();
        return;
      }
      left = ex.steps[i].secs;
      items[i].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      paint();
    }
    function paint() {
      if (cur < 0) return;
      const total = ex.steps[cur].secs;
      items[cur].querySelector('.bar i').style.width = ((total - left) / total) * 100 + '%';
    }

    $('[data-go]').addEventListener('click', () => {
      if (cur < 0) {
        paused = false;
        $('[data-skip]').hidden = false;
        $('[data-go]').innerHTML = `${icons.stop}<span>Pause</span>`;
        goto(0);
        clearInterval(timer);
        timer = setInterval(() => {
          if (paused) return;
          left -= 0.25;
          paint();
          if (left <= 0) goto(cur + 1);
        }, 250);
      } else {
        paused = !paused;
        $('[data-go]').innerHTML = paused ? `${icons.play}<span>Resume</span>` : `${icons.stop}<span>Pause</span>`;
      }
    });
    $('[data-skip]').addEventListener('click', () => { if (cur >= 0) goto(cur + 1); });
    return () => clearInterval(timer);
  }

  const renderers = { pitch, sustain, volume, record, pace, voicecheck, tally, checklist, breath, steps };

  function mount(root, ex, ctx) {
    const fn = renderers[ex.type];
    if (!fn) { root.textContent = 'Unknown exercise'; return () => {}; }
    return fn(root, ex, ctx);
  }

  return { mount, RANGES, variationLabel, paceLabel };
})();
