/* Screens, sheets, toasts and the bits of DOM rendering the game drives. */
(function (window) {
  'use strict';

  var $ = U.$;
  var toastTimer = null;

  /**
   * Photo credit for the result card. CC licences require naming the author
   * and the licence, so say both when Commons tells us, and always link back
   * to the file page. Shown only after the answer, since a file name would
   * give the landmark away.
   */
  function buildCredit(photo) {
    if (!photo || !photo.creditUrl) return '';
    var who = photo.author ? U.esc(photo.author) : 'Wikimedia Commons';
    var lic = photo.license
      ? (photo.licenseUrl
          ? ' · <a href="' + U.esc(photo.licenseUrl) + '" target="_blank" rel="noopener noreferrer">' + U.esc(photo.license) + '</a>'
          : ' · ' + U.esc(photo.license))
      : '';
    return '<p class="card__credit">Photo: ' +
      '<a href="' + U.esc(photo.creditUrl) + '" target="_blank" rel="noopener noreferrer">' + who + '</a>' +
      lic + '</p>';
  }

  var UI = {
    show: function (id) {
      var screens = document.querySelectorAll('.screen');
      for (var i = 0; i < screens.length; i++) screens[i].classList.remove('is-active');
      var el = $(id);
      if (el) el.classList.add('is-active');
    },

    toast: function (msg, ms) {
      var t = $('toast');
      t.textContent = msg;
      t.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { t.hidden = true; }, ms || 2600);
    },

    sheet: function (title, html, onOpen) {
      $('sheet-title').textContent = title;
      $('sheet-body').innerHTML = html;
      $('sheet').hidden = false;
      if (onOpen) onOpen($('sheet-body'));
    },

    closeSheet: function () { $('sheet').hidden = true; },

    /* ---------------- home ---------------- */
    renderHome: function (profile) {
      var lv = Levels.levelForXp(profile.xp);
      var cfg = Levels.config(lv);
      var prog = Levels.progress(profile.xp);
      var accuracy = profile.roundsPlayed
        ? Math.round((profile.citiesCorrect / profile.roundsPlayed) * 100) : 0;

      $('home-stats').innerHTML =
        '<div class="stat levelbar">' +
          '<div class="levelbar__top">' +
            '<span class="levelbar__name">Level ' + lv + ' · ' + U.esc(cfg.name) + '</span>' +
            '<span>' + (prog.isMax ? 'Max level' : prog.have + ' / ' + prog.need + ' XP') + '</span>' +
          '</div>' +
          '<div class="progress"><div class="progress__fill" style="width:' + prog.pct.toFixed(1) + '%"></div></div>' +
          '<div class="levelbar__rules">' +
            '<span><b>' + cfg.seconds + 's</b> to pin it</span>' +
            '<span>within <b>' + cfg.radiusKm + ' km</b></span>' +
          '</div>' +
        '</div>' +
        '<div class="stat"><span class="stat__num">' + profile.bestScore + '</span><span class="stat__lbl">Best run</span></div>' +
        '<div class="stat"><span class="stat__num">' + accuracy + '%</span><span class="stat__lbl">Cities right</span></div>' +
        '<div class="stat"><span class="stat__num">' + profile.pinsFound + '</span><span class="stat__lbl">Pins found</span></div>';

      $('home-note').textContent = profile.roundsPlayed
        ? profile.roundsPlayed + ' rounds played · best streak ' + profile.bestStreak
        : 'Photos load from Wikipedia — no account, no API key needed.';
    },

    /* ---------------- quiz ---------------- */
    photoLoading: function () {
      var p = $('photo');
      p.classList.remove('is-ready');
      $('photo-fallback').hidden = true;
      $('photo-img').removeAttribute('src');
      $('photo-img').style.display = '';
      $('photo-skeleton').style.display = '';
    },

    photoReady: function (src) {
      $('photo-img').src = src;
      $('photo-fallback').hidden = true;
      $('photo').classList.add('is-ready');
    },

    photoFallback: function (clue) {
      $('photo-img').style.display = 'none';
      $('photo-skeleton').style.display = 'none';
      $('photo-clue').textContent = clue;
      $('photo-fallback').hidden = false;
      $('photo').classList.add('is-ready');
    },

    renderOptions: function (cities, onPick) {
      var box = $('options');
      box.className = 'options';
      box.innerHTML = '';
      cities.forEach(function (c) {
        var b = document.createElement('button');
        b.className = 'opt';
        b.type = 'button';
        b.innerHTML = '<span>' + U.esc(c.city) + '</span>' +
                      '<span class="opt__country">' + U.esc(c.country) + '</span>';
        b.addEventListener('click', function () { onPick(c, b); });
        box.appendChild(b);
      });
    },

    lockOptions: function (chosenBtn, correctCity) {
      var box = $('options');
      box.classList.add('is-locked');
      var btns = box.querySelectorAll('.opt');
      for (var i = 0; i < btns.length; i++) {
        var b = btns[i];
        var label = b.firstChild.textContent;
        if (label === correctCity) b.classList.add('is-correct');
        else if (b === chosenBtn) b.classList.add('is-wrong');
        else b.classList.add('is-muted');
      }
    },

    setQuizHeader: function (level, round, score) {
      $('quiz-level').textContent = 'Lv ' + level;
      $('quiz-round').textContent = 'Round ' + round;
      $('quiz-score').textContent = score;
    },

    /* ---------------- map ---------------- */
    setTimer: function (secondsLeft, ratio) {
      $('timer-secs').textContent = Math.ceil(secondsLeft);
      $('timer-fill').style.width = (ratio * 100).toFixed(2) + '%';
      $('timer').classList.toggle('is-urgent', secondsLeft <= 10);
    },

    setMapTarget: function (text) { $('timer-target').textContent = text; },
    setMapHint: function (text) { $('map-hint').textContent = text; },

    setGuessButton: function (label, enabled) {
      var b = $('btn-guess');
      b.textContent = label;
      b.disabled = !enabled;
    },

    /* ---------------- result ---------------- */
    renderResult: function (r, handlers) {
      var good = r.found;
      var creditHtml = buildCredit(r.photo);

      var brk = '';
      brk += row('City', r.cityCorrect ? 'Named it' : 'Missed', r.cityXp);
      brk += row('Pin', r.found
        ? 'Found in ' + Math.round(r.timeUsed) + 's — ' + U.formatDistance(r.distanceKm) + ' off'
        : (r.timedOut ? 'Out of time' : U.formatDistance(r.distanceKm) + ' off, needed ' + r.radiusKm + ' km'),
        r.mapXp);

      var levelUp = r.leveledUpTo
        ? '<div class="levelup"><h3>Level ' + r.leveledUpTo + ' — ' + U.esc(Levels.config(r.leveledUpTo).name) + '</h3>' +
          '<p>Now ' + Levels.config(r.leveledUpTo).seconds + ' seconds to drop the pin, and it has to land within ' +
          Levels.config(r.leveledUpTo).radiusKm + ' km.</p></div>'
        : '';

      $('result-card').innerHTML =
        '<div class="verdict ' + (good ? 'verdict--good' : 'verdict--bad') + '">' +
          '<div class="verdict__icon">' + (good ? '🎯' : (r.timedOut ? '⏱️' : '📍')) + '</div>' +
          '<h2 class="verdict__title">' + (good ? 'Pinned it' : (r.timedOut ? 'Time up' : 'Not close enough')) + '</h2>' +
          '<p class="verdict__sub">' + U.esc(r.subtitle) + '</p>' +
        '</div>' +
        '<div class="card">' +
          '<h3 class="card__title">' + U.esc(r.landmark.name) + '</h3>' +
          '<p class="card__meta">' + U.esc(r.landmark.city) + ', ' + U.esc(r.landmark.country) + '</p>' +
          '<p class="card__fact">' + U.esc(r.landmark.fact) + '</p>' +
          creditHtml +
        '</div>' +
        '<div class="breakdown">' + brk +
          '<div class="brk brk--plus"><span class="brk__label">Round total</span><span class="brk__val">+' + (r.cityXp + r.mapXp) + ' XP</span></div>' +
        '</div>' +
        levelUp +
        '<div class="result__actions">' +
          '<button class="btn btn--primary btn--xl" id="btn-next">Next landmark</button>' +
          '<button class="btn btn--ghost" id="btn-end">End run</button>' +
        '</div>';

      $('btn-next').addEventListener('click', handlers.next);
      $('btn-end').addEventListener('click', handlers.end);

      function row(label, detail, xp) {
        return '<div class="brk ' + (xp > 0 ? 'brk--plus' : 'brk--zero') + '">' +
          '<span class="brk__label">' + label + '</span>' +
          '<span>' + U.esc(detail) + '</span>' +
          '<span class="brk__val">' + (xp > 0 ? '+' + xp : '0') + '</span>' +
        '</div>';
      }
    },

    renderRunOver: function (session, profile, handlers) {
      $('result-card').innerHTML =
        '<div class="verdict">' +
          '<div class="verdict__icon">🌍</div>' +
          '<h2 class="verdict__title">Run over</h2>' +
          '<p class="verdict__sub">' + session.round + ' rounds · ' + session.score + ' XP earned' +
            (session.score >= profile.bestScore && session.score > 0 ? ' · new best!' : '') + '</p>' +
        '</div>' +
        '<div class="breakdown">' +
          '<div class="brk"><span class="brk__label">Cities named</span><span class="brk__val">' + session.cityHits + '/' + session.round + '</span></div>' +
          '<div class="brk"><span class="brk__label">Pins found</span><span class="brk__val">' + session.pinHits + '/' + session.round + '</span></div>' +
          '<div class="brk"><span class="brk__label">Best streak</span><span class="brk__val">' + session.bestStreak + '</span></div>' +
          '<div class="brk"><span class="brk__label">Level</span><span class="brk__val">' + Levels.levelForXp(profile.xp) + '</span></div>' +
        '</div>' +
        '<div class="result__actions">' +
          '<button class="btn btn--primary btn--xl" id="btn-again">Play again</button>' +
          '<button class="btn btn--ghost" id="btn-home">Home</button>' +
        '</div>';

      $('btn-again').addEventListener('click', handlers.again);
      $('btn-home').addEventListener('click', handlers.home);
    }
  };

  window.UI = UI;
})(window);
