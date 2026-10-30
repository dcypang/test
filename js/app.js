/* Timbre app: state, daily plan, tab views, and the lesson / quiz / tool sheets. */
(function () {
  const C = window.TIMBRE_CONTENT;
  const X = window.TimbreExercises;
  const { icons, moduleIcons, esc, el, toast, shuffle } = window.TimbreUI;

  const STORE_KEY = 'timbre.v1';
  const LESSON_XP = 20;
  const allLessons = C.modules.flatMap((m, mi) => m.lessons.map((l, li) => ({ ...l, module: m, mi, li })));
  const lessonById = Object.fromEntries(allLessons.map((l) => [l.id, l]));
  const moduleById = Object.fromEntries(C.modules.map((m) => [m.id, m]));

  /* ---------- state ---------- */

  const blank = () => ({
    onboarded: false, name: '', voiceType: 'mid', dailyGoal: 2,
    xp: 0, lessons: {}, quizzes: {}, checks: [], days: {}, badges: {}, store: {}, warmups: {},
  });
  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return Object.assign(blank(), JSON.parse(raw));
    } catch (e) { /* storage unavailable: run in memory */ }
    return blank();
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  const dayKey = (d) => {
    d = d || new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const today = () => dayKey();

  function logActivity() {
    state.days[today()] = (state.days[today()] || 0) + 1;
  }

  function streak() {
    const d = new Date();
    if (!state.days[dayKey(d)]) d.setDate(d.getDate() - 1);
    let n = 0;
    while (state.days[dayKey(d)]) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }

  const level = () => Math.floor(state.xp / 100) + 1;
  const doneCount = () => allLessons.filter((l) => state.lessons[l.id]).length;
  const moduleDone = (m) => m.lessons.filter((l) => state.lessons[l.id]).length;

  function award(id) {
    if (state.badges[id]) return;
    state.badges[id] = Date.now();
    const b = C.badges.find((x) => x.id === id);
    if (b) setTimeout(() => toast(`Badge earned: ${b.title}`), 900);
  }

  function checkBadges() {
    const done = doneCount();
    if (done >= 1) award('first-lesson');
    if (state.checks.length) award('first-check');
    if (streak() >= 3) award('streak-3');
    if (streak() >= 7) award('streak-7');
    if (Object.values(state.quizzes).some((q) => q.best === 100)) award('quiz-perfect');
    if (C.modules.some((m) => moduleDone(m) === m.lessons.length)) award('module-done');
    if (done >= Math.ceil(allLessons.length / 2)) award('half-way');
    if (done === allLessons.length) award('graduate');
  }

  function completeLesson(id) {
    if (state.lessons[id]) return 0;
    state.lessons[id] = Date.now();
    state.xp += LESSON_XP;
    logActivity();
    checkBadges();
    save();
    return LESSON_XP;
  }

  function recordQuiz(key, correct, total) {
    const pct = Math.round((correct / total) * 100);
    const prev = state.quizzes[key] || { best: 0, bestCorrect: 0, attempts: 0 };
    let xp = Math.max(0, correct - (prev.bestCorrect || 0)) * 2;
    if (pct >= 80 && prev.best < 80) xp += 10;
    state.quizzes[key] = { best: Math.max(prev.best, pct), bestCorrect: Math.max(prev.bestCorrect || 0, correct), attempts: prev.attempts + 1, last: pct };
    state.xp += xp;
    logActivity();
    checkBadges();
    save();
    return { pct, xp, best: state.quizzes[key].best };
  }

  function saveCheck(result) {
    state.checks.push(result);
    state.xp += 15;
    logActivity();
    checkBadges();
    save();
  }

  /* Suggest modules from a voice check result. */
  function recommend(r) {
    const recs = [];
    if (r.variation < 1.8) recs.push(['melody', 'Your delivery is on the flat side. Intonation & Expression will add melody.']);
    if (r.wpm > 170) recs.push(['pace', 'You read quickly. Pace & Pauses will help listeners keep up.']);
    if (r.wpm < 115) recs.push(['pace', 'You read slowly. Pace & Pauses will help you keep energy moving.']);
    if (r.pauses < 4) recs.push(['pace', 'You paused very little. Pauses make ideas land.']);
    if (r.range < 6) recs.push(['pitch', 'Your pitch range was narrow. Pitch exercises will free it up.']);
    const seen = new Set();
    const list = recs.filter(([m]) => !seen.has(m) && seen.add(m));
    if (!list.length) list.push(['presence', 'Solid all round. Confidence & Presence will polish your delivery.']);
    return `<div class="stack"><span class="eyebrow">Recommended focus</span>${list
      .map(([m, why]) => `<a class="plan-item" href="#lesson-${moduleById[m].lessons[0].id}"><span class="plan-icon">${icons[moduleIcons[m]]}</span><span><span class="title">${esc(moduleById[m].title)}</span><br><span class="sub">${esc(why)}</span></span>${icons.chevron.replace('<svg', '<svg class="chev"')}</a>`)
      .join('')}</div>`;
  }

  function exCtx(onDone) {
    return {
      done: onDone || (() => {}),
      voiceType: state.voiceType,
      store: {
        get: (k) => state.store[k],
        set: (k, v) => { state.store[k] = v; save(); },
      },
      saveCheck,
      lastCheck: () => state.checks[state.checks.length - 1] || null,
      recommend,
    };
  }

  /* ---------- daily plan ---------- */

  function plan() {
    const items = [];
    const t = today();
    items.push({
      href: '#tool-warmup', icon: 'heart', warm: true, title: 'Quick warm-up', sub: '3 minutes of hums and trills',
      done: !!state.warmups[t],
    });
    const doneToday = allLessons.filter((l) => state.lessons[l.id] && dayKey(new Date(state.lessons[l.id])) === t);
    doneToday.forEach((l) => items.push(lessonItem(l, true)));
    const remaining = Math.max(0, state.dailyGoal - doneToday.length);
    allLessons.filter((l) => !state.lessons[l.id]).slice(0, remaining).forEach((l) => items.push(lessonItem(l, false)));
    const quizDue = C.modules.find((m) => moduleDone(m) === m.lessons.length && (!state.quizzes[m.id] || state.quizzes[m.id].best < 80));
    if (quizDue) items.push({ href: `#quiz-${quizDue.id}`, icon: 'quiz', warm: true, title: `${quizDue.title} quiz`, sub: `${quizDue.quiz.length} questions`, done: false });
    const last = state.checks[state.checks.length - 1];
    if (!last || Date.now() - last.at > 7 * 864e5) items.push({ href: '#check', icon: 'mic', title: last ? 'Weekly voice check' : 'Your first voice check', sub: 'Read a short passage and get your scores', done: false });
    return items;
  }

  function lessonItem(l, done) {
    return { href: `#lesson-${l.id}`, icon: moduleIcons[l.module.id], title: l.title, sub: `${l.module.title} · ${l.minutes} min`, done };
  }

  function planItemHtml(it) {
    return `<a class="plan-item ${it.done ? 'done' : ''}" href="${it.href}">
      <span class="plan-icon ${it.warm ? 'warm' : ''}">${it.done ? icons.check : icons[it.icon]}</span>
      <span style="min-width:0"><span class="title">${esc(it.title)}</span><br><span class="sub">${it.done ? 'Done today' : esc(it.sub)}</span></span>
      ${icons.chevron.replace('<svg', '<svg class="chev"')}
    </a>`;
  }

  const allTips = allLessons.flatMap((l) => l.cards.flatMap((c) => (c.tips || []).map((tip) => ({ tip, lesson: l }))));

  /* ---------- tab views ---------- */

  function greeting() {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  }

  function viewToday() {
    const items = plan();
    const doneN = items.filter((i) => i.done).length;
    const last = state.checks[state.checks.length - 1];
    const dayIndex = Math.floor(Date.now() / 864e5);
    const tip = allTips[dayIndex % allTips.length];
    const xpIn = state.xp % 100;
    return `<section class="view">
      <header class="view-head">
        <div class="stack" style="gap:4px;min-width:0"><span class="eyebrow">${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</span>
        <h1>${greeting()}${state.name ? ', ' + esc(state.name) : ''}</h1></div>
        <a class="icon-btn" href="#profile" aria-label="Profile">${icons.user}</a>
      </header>
      <div class="hero-stats">
        <div class="stat warm"><b class="mono">${streak()}</b><span>day streak</span></div>
        <div class="stat"><b class="mono">${level()}</b><span>level</span><div class="bar warm" style="height:5px;margin-top:6px" title="${xpIn}/100 XP to next level"><i style="width:${xpIn}%"></i></div></div>
        <div class="stat"><b class="mono">${doneCount()}<small class="muted" style="font-size:.9rem">/${allLessons.length}</small></b><span>lessons</span></div>
      </div>
      <div class="section">
        <div class="section-head"><h2>Today's plan</h2><span class="pill ${doneN === items.length ? 'good' : 'accent'}">${doneN} of ${items.length} done</span></div>
        <div class="bar"><i style="width:${(doneN / items.length) * 100}%"></i></div>
        <div class="stack" style="gap:10px">${items.map(planItemHtml).join('')}</div>
      </div>
      <div class="check-card">
        <span class="eyebrow">Voice check</span>
        ${last ? `<div class="row" style="flex-wrap:wrap;gap:22px">
            <div><div class="mono" style="font-size:1.5rem">${last.median} Hz</div><small>speaking pitch</small></div>
            <div><div class="mono" style="font-size:1.5rem">${last.variation.toFixed(1)} st</div><small>melody</small></div>
            <div><div class="mono" style="font-size:1.5rem">${last.wpm}</div><small>words / min</small></div>
          </div><p style="font-size:.9rem;opacity:.8">Last checked ${new Date(last.at).toLocaleDateString()}. Check weekly to track your progress.</p>`
          : `<h2>How does your voice sound today?</h2><p style="opacity:.85">Read a 30-second passage. Timbre measures your pitch, melody, pace and pauses, then suggests where to start.</p>`}
        ${waveSvg()}
        <a class="btn" href="#check">${icons.mic}<span>${last ? 'Check again' : 'Start voice check'}</span></a>
      </div>
      ${tip ? `<div class="card stack" style="gap:8px"><span class="eyebrow">Tip of the day</span><p>${esc(tip.tip)}</p><a class="btn ghost small" style="align-self:flex-start;padding:0" href="#lesson-${tip.lesson.id}">From "${esc(tip.lesson.title)}"</a></div>` : ''}
    </section>`;
  }

  function waveSvg() {
    // A decorative pitch contour drawn as a rising-then-falling sentence melody.
    const pts = [];
    for (let i = 0; i <= 60; i++) {
      const x = (i / 60) * 300;
      const y = 22 - Math.sin(i / 9) * 8 - Math.sin(i / 3.1) * 3 + (i > 45 ? (i - 45) * 0.7 : 0);
      pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
    return `<svg class="wave" viewBox="0 0 300 44" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts.join(' ')}" style="fill:none;stroke:var(--bg);stroke-width:2.5;opacity:.55;stroke-linecap:round"/></svg>`;
  }

  let openModule = null;
  function viewCourse() {
    if (!openModule) {
      const firstOpen = C.modules.find((m) => moduleDone(m) < m.lessons.length || !state.quizzes[m.id]);
      openModule = (firstOpen || C.modules[0]).id;
    }
    return `<section class="view">
      <header class="view-head"><div class="stack" style="gap:4px"><span class="eyebrow">${C.modules.length} modules · ${allLessons.length} lessons</span><h1>Course</h1></div></header>
      <div class="stack">${C.modules.map((m, i) => {
        const d = moduleDone(m);
        const complete = d === m.lessons.length;
        const q = state.quizzes[m.id];
        const open = openModule === m.id;
        return `<article class="module ${complete ? 'complete' : ''}">
          <button class="module-head" data-module="${m.id}" aria-expanded="${open}">
            <span class="module-num">${complete ? icons.check : i + 1}</span>
            <span style="min-width:0"><h3>${esc(m.title)}</h3><p>${esc(m.blurb)}</p><div class="bar"><i style="width:${(d / m.lessons.length) * 100}%"></i></div></span>
            <span class="mono muted" style="font-size:.85rem">${d}/${m.lessons.length}</span>
          </button>
          <div class="module-body" ${open ? '' : 'hidden'}>
            ${m.lessons.map((l) => `<a class="lesson-row ${state.lessons[l.id] ? 'done' : ''}" href="#lesson-${l.id}"><span class="dot">${state.lessons[l.id] ? icons.check : ''}</span><span>${esc(l.title)}<br><small>${l.minutes} min · ${exerciseKind(l.exercise)}</small></span>${icons.chevron.replace('<svg', '<svg class="chev"')}</a>`).join('')}
            <a class="lesson-row quiz ${q && q.best >= 80 ? 'done' : ''}" href="#quiz-${m.id}"><span class="dot">${q && q.best >= 80 ? icons.check : icons.star}</span><span>Module quiz<br><small>${m.quiz.length} questions${q ? ` · best ${q.best}%` : ''}</small></span>${icons.chevron.replace('<svg', '<svg class="chev"')}</a>
          </div>
        </article>`;
      }).join('')}</div>
      <a class="plan-item" href="#quiz-final"><span class="plan-icon warm">${icons.medal}</span><span><span class="title">Final exam</span><br><span class="sub">12 questions from every module${state.quizzes.final ? ` · best ${state.quizzes.final.best}%` : ''}</span></span>${icons.chevron.replace('<svg', '<svg class="chev"')}</a>
    </section>`;
  }

  function exerciseKind(ex) {
    return { breath: 'Breathing', steps: 'Guided routine', sustain: 'Mic: breath timer', pitch: 'Mic: pitch tracker', record: 'Record & listen', pace: 'Mic: pace check', volume: 'Mic: level meter', tally: 'Timed talk', checklist: 'Checklist', voicecheck: 'Mic: voice check' }[ex.type] || '';
  }

  const TOOLS = {
    check: { title: 'Voice check', icon: 'mic', desc: 'Full assessment: pitch, melody, pace and pauses.', ex: { type: 'voicecheck', title: 'Voice check', intro: 'Tap Start, read the passage aloud in your normal voice, then tap "I\'m done".' } },
    pitch: { title: 'Pitch tracker', icon: 'sliders', desc: 'Watch your pitch live as you talk, hum or sing.', ex: { type: 'pitch', title: 'Pitch tracker', intro: 'Speak, hum or slide. Stop to see your median pitch, range and variation.', goal: 'free' } },
    level: { title: 'Level meter', icon: 'volume', desc: 'Practise projection against your own baseline.', ex: { type: 'volume', title: 'Level meter', intro: 'Set a baseline, then step your volume up and down.', levels: [{ label: 'Softer', db: -6 }, { label: 'Baseline', db: 0 }, { label: 'Projected', db: 6 }, { label: 'Big room', db: 10 }] } },
    recorder: { title: 'Recorder', icon: 'wave', desc: 'Record yourself, play it back, and analyze it.', ex: { type: 'record', title: 'Recorder', intro: 'Record any take, play it back, then tap Analyze for pitch and pause stats.', prompts: ['Free practice: say anything you like.', 'Introduce yourself in 30 seconds.', 'Explain what you do, as if to a new colleague.'], analyze: true } },
    pace: { title: 'Pace check', icon: 'timer', desc: 'Measure your words per minute.', ex: { type: 'pace', title: 'Pace check', intro: 'Tap Start, read at your natural pace, and tap Stop when you finish.', text: C.PACE_PASSAGE, target: [130, 160] } },
    sustain: { title: 'Breath timer', icon: 'wind', desc: 'How long can you hold an even "sss"?', ex: lessonById['breath-3'].exercise },
    breathe: { title: 'Breathing pacer', icon: 'heart', desc: 'Slow, low breathing to settle nerves.', ex: lessonById['breath-1'].exercise },
    fillers: { title: 'Filler counter', icon: 'quiz', desc: '60-second talks to cut "um" and "like".', ex: lessonById['pace-3'].exercise },
    warmup: { title: 'Quick warm-up', icon: 'lips', desc: 'Three minutes of hums and trills.', ex: lessonById['warmup-1'].exercise },
  };

  function viewLab() {
    const order = ['check', 'pitch', 'level', 'recorder', 'pace', 'sustain', 'breathe', 'fillers', 'warmup'];
    return `<section class="view">
      <header class="view-head"><div class="stack" style="gap:4px"><span class="eyebrow">Practice tools</span><h1>Voice lab</h1></div></header>
      <div class="grid-2">${order.map((k) => {
        const t = TOOLS[k];
        return `<a class="tool" href="#tool-${k}"><span class="plan-icon ${k === 'check' ? 'warm' : ''}">${icons[t.icon]}</span><h3>${esc(t.title)}</h3><p>${esc(t.desc)}</p></a>`;
      }).join('')}
        <a class="tool" href="#quiz-final"><span class="plan-icon warm">${icons.medal}</span><h3>Final exam</h3><p>Mixed questions from the whole course.</p></a>
      </div>
      <p class="muted" style="font-size:.85rem">Pitch, pace and level work best in a quiet room with your phone or laptop about an arm's length away. Readings are guides for practice, not clinical measurements.</p>
    </section>`;
  }

  function viewProgress() {
    const quizVals = C.modules.map((m) => state.quizzes[m.id]).filter(Boolean);
    const avg = quizVals.length ? Math.round(quizVals.reduce((a, q) => a + q.best, 0) / quizVals.length) : null;
    const days = [];
    const d = new Date();
    d.setDate(d.getDate() - 27);
    for (let i = 0; i < 28; i++) {
      const n = state.days[dayKey(d)] || 0;
      days.push(`<i class="${n >= 4 ? 'l3' : n >= 2 ? 'l2' : n ? 'l1' : ''} ${i === 27 ? 'today' : ''}" title="${dayKey(d)}: ${n} activities"></i>`);
      d.setDate(d.getDate() + 1);
    }
    const checks = state.checks;
    return `<section class="view">
      <header class="view-head"><div class="stack" style="gap:4px"><span class="eyebrow">Level ${level()} · ${state.xp} XP</span><h1>Progress</h1></div></header>
      <div class="grid-2">
        <div class="stat warm"><b class="mono">${streak()}</b><span>day streak</span></div>
        <div class="stat"><b class="mono">${doneCount()}/${allLessons.length}</b><span>lessons complete</span></div>
        <div class="stat"><b class="mono">${avg == null ? '–' : avg + '%'}</b><span>average quiz best</span></div>
        <div class="stat"><b class="mono">${checks.length}</b><span>voice checks</span></div>
      </div>
      <div class="card stack"><div class="section-head"><h3>Last 4 weeks</h3><span class="muted" style="font-size:.8rem">darker = more practice</span></div><div class="heatmap">${days.join('')}</div></div>
      <div class="card stack">
        <h3>Voice check trends</h3>
        ${checks.length >= 2 ? `
          ${trendChart(checks.map((c) => c.variation), 'Melody (semitones)', [1.8, 3.5], 1)}
          ${trendChart(checks.map((c) => c.wpm), 'Pace (words per minute)', [130, 165], 0)}
          ${trendChart(checks.map((c) => c.median), 'Speaking pitch (Hz)', null, 0)}`
          : `<p class="muted">${checks.length ? 'Do another voice check to see your trend lines.' : 'Your voice check results will appear here.'}</p><a class="btn small" style="align-self:flex-start" href="#check">${icons.mic}<span>Voice check</span></a>`}
        ${checks.length ? `<div>${checks.slice().reverse().slice(0, 6).map((c) => `<div class="history-row"><span>${new Date(c.at).toLocaleDateString()}</span><span class="mono">${c.median} Hz</span><span class="mono">${c.variation.toFixed(1)} st</span><span class="mono">${c.wpm} wpm</span></div>`).join('')}</div>` : ''}
      </div>
      <div class="card stack"><h3>Modules</h3>${C.modules.map((m) => `<div class="stack" style="gap:6px"><div class="row" style="justify-content:space-between"><span>${esc(m.title)}</span><span class="mono muted" style="font-size:.85rem">${moduleDone(m)}/${m.lessons.length}${state.quizzes[m.id] ? ` · quiz ${state.quizzes[m.id].best}%` : ''}</span></div><div class="bar"><i style="width:${(moduleDone(m) / m.lessons.length) * 100}%"></i></div></div>`).join('')}</div>
      <div class="card stack"><h3>Badges</h3><div class="badges">${C.badges.map((b) => `<div class="badge ${state.badges[b.id] ? 'earned' : ''}" title="${esc(b.desc)}"><span class="medal">${icons.medal}</span><span>${esc(b.title)}</span></div>`).join('')}</div></div>
    </section>`;
  }

  function trendChart(vals, label, band, digits) {
    const W = 300, H = 110, P = 26;
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (band) { lo = Math.min(lo, band[0]); hi = Math.max(hi, band[1]); }
    const pad = (hi - lo) * 0.15 || 1;
    lo -= pad; hi += pad;
    const x = (i) => P + (i / (vals.length - 1)) * (W - P - 8);
    const y = (v) => 8 + (1 - (v - lo) / (hi - lo)) * (H - 24);
    const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const lastI = vals.length - 1;
    return `<div class="stack" style="gap:4px"><div class="row" style="justify-content:space-between"><span class="eyebrow">${esc(label)}</span><span class="mono">${vals[lastI].toFixed(digits)}</span></div>
      <svg class="trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)} trend">
        ${band ? `<rect x="${P}" y="${y(band[1])}" width="${W - P - 8}" height="${y(band[0]) - y(band[1])}" style="fill:var(--accent-soft)"/>` : ''}
        <line x1="${P}" y1="${H - 16}" x2="${W - 8}" y2="${H - 16}" style="stroke:var(--line)"/>
        <text x="0" y="${y(hi - pad) + 4}" style="fill:var(--muted);font:10px var(--font-mono)">${(hi - pad).toFixed(digits)}</text>
        <text x="0" y="${y(lo + pad) + 4}" style="fill:var(--muted);font:10px var(--font-mono)">${(lo + pad).toFixed(digits)}</text>
        <polyline points="${pts}" style="fill:none;stroke:var(--accent);stroke-width:2.5;stroke-linejoin:round"/>
        ${vals.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="${i === lastI ? 5 : 3}" style="fill:${i === lastI ? 'var(--warm)' : 'var(--accent)'}"/>`).join('')}
        <text x="${P}" y="${H - 2}" style="fill:var(--muted);font:10px var(--font-body)">First</text>
        <text x="${W - 8}" y="${H - 2}" text-anchor="end" style="fill:var(--muted);font:10px var(--font-body)">Latest</text>
      </svg></div>`;
  }

  const VOICE_TYPES = [
    ['low', 'Lower', '85–155 Hz'],
    ['mid', 'In between', 'not sure'],
    ['high', 'Higher', '165–255 Hz'],
  ];

  function segmented(name, options, value) {
    return `<div class="segmented" role="group" data-seg="${name}">${options.map(([v, label, small]) => `<button type="button" data-v="${v}" aria-pressed="${String(v) === String(value)}">${esc(label)}${small ? `<small>${esc(small)}</small>` : ''}</button>`).join('')}</div>`;
  }

  function viewProfile() {
    return `<section class="view">
      <header class="view-head"><div class="row"><a class="icon-btn" href="#today" aria-label="Back">${icons.back}</a><h1>Profile</h1></div></header>
      <div class="card stack">
        <div class="field"><label for="p-name">Your name</label><input class="input" id="p-name" value="${esc(state.name)}" maxlength="30" autocomplete="given-name"></div>
        <div class="field"><label>Voice type</label>${segmented('voiceType', VOICE_TYPES, state.voiceType)}<p class="muted" style="font-size:.82rem">Sets the scale on the pitch tracker and the typical range it compares you to.</p></div>
        <div class="field"><label>Daily lesson goal</label>${segmented('dailyGoal', [[1, '1 lesson'], [2, '2 lessons'], [3, '3 lessons']], state.dailyGoal)}</div>
      </div>
      <div class="card stack">
        <h3>Install on your phone</h3>
        <p class="muted">On iPhone, open this page in Safari, tap Share, then "Add to Home Screen". Timbre opens full-screen like an app and keeps your progress on this device.</p>
      </div>
      <div class="card stack">
        <h3>About</h3>
        <p class="muted">Timbre is a voice-training course: ${C.modules.length} modules, ${allLessons.length} lessons and ${C.modules.reduce((a, m) => a + m.quiz.length, 0)} quiz questions. Audio is analyzed on your device and never uploaded. It is a practice tool, not medical advice: for persistent hoarseness or pain, see a doctor or speech-language pathologist.</p>
      </div>
      <div class="card stack" data-reset>
        <h3>Reset progress</h3>
        <p class="muted">Clears lessons, quizzes, voice checks, streaks and badges on this device.</p>
        <button class="btn danger small" style="align-self:flex-start" data-reset-ask>Reset progress</button>
        <div class="row" data-reset-confirm hidden><span>Are you sure?</span><button class="btn danger small" data-reset-yes>Yes, reset</button><button class="btn secondary small" data-reset-no>Cancel</button></div>
      </div>
    </section>`;
  }

  function bindProfile(root) {
    root.querySelector('#p-name').addEventListener('input', (e) => { state.name = e.target.value.trim(); save(); });
    bindSegmented(root);
    root.querySelector('[data-reset-ask]').addEventListener('click', () => { root.querySelector('[data-reset-confirm]').hidden = false; });
    root.querySelector('[data-reset-no]').addEventListener('click', () => { root.querySelector('[data-reset-confirm]').hidden = true; });
    root.querySelector('[data-reset-yes]').addEventListener('click', () => {
      state = Object.assign(blank(), { onboarded: true, name: state.name, voiceType: state.voiceType, dailyGoal: state.dailyGoal });
      save();
      toast('Progress reset');
      location.hash = 'today';
    });
  }

  function bindSegmented(root) {
    root.querySelectorAll('[data-seg]').forEach((g) => {
      g.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-v]');
        if (!b) return;
        const key = g.dataset.seg;
        state[key] = key === 'dailyGoal' ? Number(b.dataset.v) : b.dataset.v;
        save();
        g.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      });
    });
  }

  function viewOnboard() {
    return `<section class="onboard">
      <div class="stack" style="gap:10px"><span class="eyebrow">Voice coach</span><h1>Train the voice people remember.</h1>
      <p class="muted" style="font-size:1.08rem">Short daily lessons on breath, resonance, pitch, pace and presence, with live pitch and pace feedback from your microphone.</p></div>
      ${waveSvg().replace('stroke:var(--bg)', 'stroke:var(--accent)')}
      <div class="stack" style="gap:18px">
        <div class="field"><label for="o-name">What should we call you?</label><input class="input" id="o-name" placeholder="First name" maxlength="30" autocomplete="given-name"></div>
        <div class="field"><label>Your voice is usually…</label>${segmented('voiceType', VOICE_TYPES, state.voiceType)}</div>
        <div class="field"><label>Daily goal</label>${segmented('dailyGoal', [[1, 'Casual', '1 lesson'], [2, 'Regular', '2 lessons'], [3, 'Serious', '3 lessons']], state.dailyGoal)}</div>
      </div>
      <button class="btn block" data-start>Start training</button>
    </section>`;
  }

  /* ---------- sheets: lesson, quiz, tool ---------- */

  let sheetCleanup = null;

  function closeSheet() {
    if (sheetCleanup) { try { sheetCleanup(); } catch (e) { /* ignore */ } sheetCleanup = null; }
    const s = document.getElementById('sheet');
    s.hidden = true;
    s.innerHTML = '';
    document.body.style.overflow = '';
  }

  function openSheet(html) {
    const s = document.getElementById('sheet');
    s.innerHTML = `<div class="sheet"><div class="sheet-inner">${html}</div></div>`;
    s.hidden = false;
    document.body.style.overflow = 'hidden';
    return s.querySelector('.sheet-inner');
  }

  function sheetLesson(id) {
    const l = lessonById[id];
    if (!l) return false;
    const steps = [...l.cards.map((c) => ({ kind: 'card', c })), { kind: 'exercise' }, { kind: 'finish' }];
    let i = 0;
    let exDone = false;
    let cleanup = null;
    const root = openSheet(`
      <div class="sheet-top"><a class="icon-btn" href="#${lastTab}" aria-label="Close lesson">${icons.close}</a><div class="segments">${steps.map(() => '<i></i>').join('')}</div></div>
      <div class="sheet-body" data-body></div>
      <div class="sheet-foot"><button class="btn secondary" data-back>Back</button><button class="btn" data-next>Next</button></div>`);
    const body = root.querySelector('[data-body]');
    const back = root.querySelector('[data-back]');
    const next = root.querySelector('[data-next]');
    const segs = root.querySelectorAll('.segments i');

    function show() {
      if (cleanup) { cleanup(); cleanup = null; }
      segs.forEach((s, j) => s.classList.toggle('on', j <= i));
      const st = steps[i];
      back.hidden = i === 0 || st.kind === 'finish';
      root.closest('.sheet').scrollTop = 0;
      if (st.kind === 'card') {
        body.innerHTML = `<div class="lesson-card">
          <span class="eyebrow">${esc(l.module.title)} · Lesson ${l.li + 1} of ${l.module.lessons.length}</span>
          ${i === 0 ? `<h1 style="font-size:1.25rem;color:var(--muted)">${esc(l.title)}</h1>` : ''}
          <h2>${esc(st.c.title)}</h2>
          <p class="body">${esc(st.c.body)}</p>
          ${st.c.tips ? `<ul class="tips">${st.c.tips.map((t) => `<li>${icons.lightbulb}<span>${esc(t)}</span></li>`).join('')}</ul>` : ''}
        </div>`;
        next.textContent = 'Next';
      } else if (st.kind === 'exercise') {
        next.textContent = exDone ? 'Finish lesson' : 'Skip exercise';
        cleanup = X.mount(body, l.exercise, exCtx(() => { exDone = true; next.textContent = 'Finish lesson'; }));
      } else {
        const gained = completeLesson(l.id);
        const nextLesson = allLessons[allLessons.indexOf(l) + 1];
        const modComplete = moduleDone(l.module) === l.module.lessons.length;
        body.innerHTML = `<div class="stack" style="align-items:center;text-align:center;gap:16px;padding-top:30px">
          <span class="plan-icon" style="width:84px;height:84px;border-radius:50%">${icons.check}</span>
          <h1>Lesson complete</h1>
          <p class="muted">${esc(l.title)}</p>
          ${gained ? `<span class="pill warm">${icons.star}+${gained} XP</span>` : '<span class="pill">Reviewed</span>'}
          <span class="pill accent">${icons.flame}${streak()} day streak</span>
          ${modComplete ? `<div class="card stack" style="width:100%;text-align:left"><b>You've finished every lesson in ${esc(l.module.title)}.</b><p class="muted">Take the module quiz to lock it in.</p><a class="btn small" style="align-self:flex-start" href="#quiz-${l.module.id}">Take the quiz</a></div>` : ''}
        </div>`;
        next.textContent = nextLesson && !modComplete ? `Next: ${nextLesson.title}` : 'Done';
        next.dataset.href = nextLesson && !modComplete ? `#lesson-${nextLesson.id}` : `#${lastTab}`;
      }
    }

    back.addEventListener('click', () => { if (i > 0) { i--; show(); } });
    next.addEventListener('click', () => {
      if (steps[i].kind === 'finish') { location.hash = next.dataset.href.slice(1); return; }
      i++;
      show();
    });
    show();
    sheetCleanup = () => { if (cleanup) cleanup(); };
    return true;
  }

  function sheetQuiz(key) {
    let questions;
    let title;
    if (key === 'final') {
      title = 'Final exam';
      questions = shuffle(C.modules.flatMap((m) => m.quiz)).slice(0, 12);
    } else {
      const m = moduleById[key];
      if (!m) return false;
      title = `${m.title} quiz`;
      questions = shuffle(m.quiz);
    }
    let qi = 0;
    let correct = 0;
    const root = openSheet(`
      <div class="sheet-top"><a class="icon-btn" href="#${lastTab}" aria-label="Close quiz">${icons.close}</a><div class="segments">${questions.map(() => '<i></i>').join('')}</div></div>
      <div class="sheet-body" data-body></div>
      <div class="sheet-foot" data-foot hidden><button class="btn" data-next>Continue</button></div>`);
    const body = root.querySelector('[data-body]');
    const foot = root.querySelector('[data-foot]');
    const next = root.querySelector('[data-next]');
    const segs = root.querySelectorAll('.segments i');

    function showQ() {
      const q = questions[qi];
      segs.forEach((s, j) => s.classList.toggle('on', j <= qi));
      foot.hidden = true;
      body.innerHTML = `<span class="eyebrow">${esc(title)} · ${qi + 1} of ${questions.length}</span>
        <h2 style="font-size:1.5rem">${esc(q.q)}</h2>
        <div class="options">${q.options.map((o, j) => `<button class="option" data-j="${j}"><span class="key">${'ABCD'[j]}</span><span>${esc(o)}</span></button>`).join('')}</div>
        <div data-feedback></div>`;
      body.querySelectorAll('.option').forEach((b) => b.addEventListener('click', () => pick(Number(b.dataset.j))));
    }

    function pick(j) {
      const q = questions[qi];
      const ok = j === q.answer;
      if (ok) correct++;
      body.querySelectorAll('.option').forEach((b, k) => {
        b.disabled = true;
        if (k === q.answer) b.classList.add('correct');
        else if (k === j) b.classList.add('wrong');
      });
      body.querySelector('[data-feedback]').innerHTML = `<div class="feedback ${ok ? 'good' : 'bad'}"><b>${ok ? 'Correct' : 'Not quite'}</b>${esc(q.explain)}</div>`;
      foot.hidden = false;
      next.textContent = qi === questions.length - 1 ? 'See results' : 'Continue';
      next.focus();
    }

    function results() {
      foot.hidden = true;
      const r = recordQuiz(key, correct, questions.length);
      const circ = 2 * Math.PI * 64;
      const pass = r.pct >= 80;
      body.innerHTML = `<div class="stack" style="align-items:center;text-align:center;gap:16px;padding-top:10px">
        <svg class="score-ring" viewBox="0 0 160 160" role="img" aria-label="Score ${r.pct}%">
          <circle cx="80" cy="80" r="64" style="fill:none;stroke:var(--surface-2);stroke-width:14"/>
          <circle cx="80" cy="80" r="64" transform="rotate(-90 80 80)" style="fill:none;stroke:${pass ? 'var(--accent)' : 'var(--warm)'};stroke-width:14;stroke-linecap:round;stroke-dasharray:${circ};stroke-dashoffset:${circ * (1 - r.pct / 100)}"/>
          <text x="80" y="90" text-anchor="middle" style="fill:var(--ink);font:600 34px var(--font-mono)">${r.pct}%</text>
        </svg>
        <h1>${pass ? (r.pct === 100 ? 'Perfect score' : 'Nicely done') : 'Keep practising'}</h1>
        <p class="muted">${correct} of ${questions.length} correct · best ${r.best}%</p>
        ${r.xp ? `<span class="pill warm">${icons.star}+${r.xp} XP</span>` : ''}
        ${pass ? '' : '<p class="muted">Score 80% or more to pass. Review the lessons, then try again.</p>'}
        <div class="row" style="flex-wrap:wrap;justify-content:center"><button class="btn secondary" data-retry>Retake</button><a class="btn" href="#${lastTab}">Done</a></div>
      </div>`;
      body.querySelector('[data-retry]').addEventListener('click', () => { sheetQuiz(key); });
    }

    next.addEventListener('click', () => {
      if (qi < questions.length - 1) { qi++; showQ(); } else results();
    });
    showQ();
    sheetCleanup = null;
    return true;
  }

  function sheetTool(name) {
    const t = TOOLS[name];
    if (!t) return false;
    const root = openSheet(`
      <div class="sheet-top"><a class="icon-btn" href="#${lastTab}" aria-label="Close">${icons.close}</a><span class="eyebrow">Voice lab</span></div>
      <div class="sheet-body" data-body></div>`);
    const cleanup = X.mount(root.querySelector('[data-body]'), t.ex, exCtx(() => {
      if (name === 'warmup' && !state.warmups[today()]) {
        state.warmups[today()] = true;
        logActivity();
        checkBadges();
        save();
      }
    }));
    sheetCleanup = cleanup;
    return true;
  }

  /* ---------- router ---------- */

  const TABS = ['today', 'course', 'lab', 'progress'];
  let lastTab = 'today';

  function render() {
    closeSheet();
    const app = document.getElementById('app');
    const tabbar = document.getElementById('tabbar');
    if (!state.onboarded) {
      tabbar.hidden = true;
      app.innerHTML = viewOnboard();
      bindSegmented(app);
      app.querySelector('[data-start]').addEventListener('click', () => {
        state.name = app.querySelector('#o-name').value.trim();
        state.onboarded = true;
        save();
        location.hash = 'today';
        render();
      });
      return;
    }
    tabbar.hidden = false;
    const hash = location.hash.replace(/^#/, '') || 'today';
    let base = hash;
    let sheet = null;
    if (/^(lesson|quiz|tool)-/.test(hash) || hash === 'check') {
      base = lastTab;
      sheet = hash === 'check' ? 'tool-check' : hash;
    } else if (TABS.includes(hash) || hash === 'profile') {
      lastTab = hash === 'profile' ? 'today' : hash;
    } else {
      base = 'today';
    }
    const views = { today: viewToday, course: viewCourse, lab: viewLab, progress: viewProgress, profile: viewProfile };
    app.innerHTML = views[base]();
    if (base === 'profile') bindProfile(app);
    if (base === 'course') {
      app.querySelectorAll('[data-module]').forEach((b) => b.addEventListener('click', () => {
        openModule = openModule === b.dataset.module ? '' : b.dataset.module;
        const scroll = window.scrollY;
        render();
        window.scrollTo(0, scroll);
      }));
    }
    tabbar.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-current', t.dataset.tab === (base === 'profile' ? 'today' : base) ? 'page' : 'false'));
    if (sheet) {
      const [kind, ...rest] = sheet.split('-');
      const arg = rest.join('-');
      const ok = kind === 'lesson' ? sheetLesson(arg) : kind === 'quiz' ? sheetQuiz(arg) : sheetTool(arg);
      if (!ok) location.hash = lastTab;
    } else {
      window.scrollTo(0, 0);
    }
  }

  function boot() {
    document.getElementById('tabbar').innerHTML = `<nav aria-label="Main">${[
      ['today', 'Today', icons.today], ['course', 'Course', icons.course], ['lab', 'Lab', icons.lab], ['progress', 'Progress', icons.progress],
    ].map(([k, label, ic]) => `<a class="tab" href="#${k}" data-tab="${k}">${ic}<span>${label}</span></a>`).join('')}</nav>`;
    window.addEventListener('hashchange', render);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !document.getElementById('sheet').hidden) location.hash = lastTab;
    });
    render();
  }

  boot();
})();
