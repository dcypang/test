/* ============================================================
   Game loop.

   Round = two parts:
     1. a landmark photo + four candidate cities
     2. find that landmark on the map before the clock runs out
        (the clock and the accepted radius both come from the level)
   ============================================================ */
(function (window) {
  'use strict';

  var $ = U.$;

  var profile = Store.load();
  var session = null;
  var round = null;          // state for the round in progress
  var mapAdapter = null;
  var mapPending = null;
  var timer = null;

  /* ---------------------------------------------------------- helpers */

  function level() { return Levels.levelForXp(profile.xp); }
  function levelCfg() { return Levels.config(level()); }

  function buzz(pattern) { if (profile.settings.haptics) U.buzz(pattern); }

  function saveProfile() { Store.save(profile); }

  /** Pick a landmark suited to the level, avoiding ones already seen this run. */
  function pickLandmark() {
    var cfg = levelCfg();
    var unused = LANDMARKS.filter(function (l) { return session.usedIds.indexOf(l.id) === -1; });
    if (!unused.length) {
      session.usedIds = [];
      unused = LANDMARKS.slice();
    }
    var tier = U.pick(cfg.tiers);
    var inTier = unused.filter(function (l) { return l.tier === tier; });
    var chosen = U.pick(inTier.length ? inTier : unused);
    session.usedIds.push(chosen.id);
    return chosen;
  }

  /** The correct city plus three plausible decoys, shuffled. */
  function buildOptions(answer) {
    var pool = U.shuffle(LANDMARKS.filter(function (l) {
      return l.city !== answer.city;
    }));

    var picked = [];
    var seenCity = {};
    var countryCount = {};
    countryCount[answer.country] = 1;

    // Prefer decoys of similar fame, then relax to anything left.
    [1, 2].forEach(function (pass) {
      pool.forEach(function (l) {
        if (picked.length >= 3) return;
        if (seenCity[l.city]) return;
        if (pass === 1 && Math.abs(l.tier - answer.tier) > 1) return;
        if (pass === 1 && (countryCount[l.country] || 0) >= 2) return;
        seenCity[l.city] = true;
        countryCount[l.country] = (countryCount[l.country] || 0) + 1;
        picked.push({ city: l.city, country: l.country });
      });
    });

    picked.push({ city: answer.city, country: answer.country });
    return U.shuffle(picked);
  }

  /** Warm the next photo so the following round starts instantly. */
  function prefetchNext() {
    var unused = LANDMARKS.filter(function (l) { return session.usedIds.indexOf(l.id) === -1; });
    if (unused.length) Photos.prefetch(U.pick(unused));
  }

  /* ---------------------------------------------------------- run / round */

  function startRun() {
    session = {
      round: 0, score: 0, streak: 0, bestStreak: 0,
      cityHits: 0, pinHits: 0, usedIds: []
    };
    nextRound();
  }

  function nextRound() {
    var landmark = pickLandmark();
    session.round += 1;

    round = {
      landmark: landmark,
      cfg: levelCfg(),
      cityCorrect: false,
      photo: null,
      guess: null,
      answered: false
    };

    UI.setQuizHeader(level(), session.round, session.score);
    UI.photoLoading();
    UI.renderOptions(buildOptions(landmark), onCityPicked);
    UI.show('screen-quiz');

    Photos.get(landmark).then(function (photo) {
      if (!round || round.landmark.id !== landmark.id) return;   // round moved on
      round.photo = photo;
      UI.photoReady(photo.src);
    }).catch(function () {
      if (!round || round.landmark.id !== landmark.id) return;
      UI.photoFallback(landmark.clue);
    });

    prefetchNext();
  }

  function onCityPicked(choice, btn) {
    if (!round || round.answered) return;
    round.answered = true;
    round.cityCorrect = choice.city === round.landmark.city;

    UI.lockOptions(btn, round.landmark.city);

    if (round.cityCorrect) {
      session.streak += 1;
      session.bestStreak = Math.max(session.bestStreak, session.streak);
      session.cityHits += 1;
      buzz(20);
    } else {
      session.streak = 0;
      buzz([30, 60, 30]);
    }

    round.cityXp = Levels.cityScore(round.cityCorrect, session.streak - 1);
    session.score += round.cityXp;
    UI.setQuizHeader(level(), session.round, session.score);

    setTimeout(startMapPhase, round.cityCorrect ? 750 : 1400);
  }

  /* ---------------------------------------------------------- map phase */

  function ensureMap() {
    if (mapAdapter) return Promise.resolve(mapAdapter);
    if (mapPending) return mapPending;

    if (profile.settings.mapProvider !== 'google' && typeof window.L === 'undefined') {
      return Promise.reject(new Error('map library unavailable'));
    }

    mapPending = GameMap.create($('map'), {
      provider: profile.settings.mapProvider,
      googleKey: profile.settings.googleKey,
      onFallback: function () {
        UI.toast('Google Maps key rejected — using OpenStreetMap', 3600);
      }
    }).then(function (adapter) {
      mapAdapter = adapter;
      mapAdapter.onPick(onPinDropped);
      mapPending = null;
      return adapter;
    }).catch(function (err) {
      mapPending = null;
      throw err;
    });

    return mapPending;
  }

  function startMapPhase() {
    if (!round) return;
    var cfg = round.cfg;

    UI.setMapTarget(round.landmark.city + ' — find the landmark');
    UI.setMapHint('Tap the map to drop your pin.');
    UI.setGuessButton('Drop a pin first', false);
    UI.setTimer(cfg.seconds, 1);
    UI.show('screen-map');

    ensureMap().then(function (adapter) {
      adapter.reset();
      adapter.invalidate();
      startTimer(cfg.seconds);
    }).catch(function () {
      // No map available (offline, blocked CDN): score the city half and move on.
      UI.toast('Map unavailable — scoring the photo round only', 3600);
      finishRound(null, false, true);
    });
  }

  function onPinDropped(latlng) {
    if (!round || round.finished) return;
    round.guess = latlng;
    UI.setGuessButton('Guess here', true);
    UI.setMapHint('Zoom in for a closer pin — or lock it in.');
    buzz(12);
  }

  function startTimer(seconds) {
    stopTimer();
    var limitMs = seconds * 1000;
    var startedAt = Date.now();
    round.limit = seconds;
    round.finished = false;

    function tick() {
      if (!round || round.finished) return;
      var left = (limitMs - (Date.now() - startedAt)) / 1000;
      if (left <= 0) {
        UI.setTimer(0, 0);
        buzz([60, 40, 60]);
        finishRound(round.guess, true, false);
        return;
      }
      UI.setTimer(left, left / seconds);
      round.timeLeft = left;
      timer.raf = window.requestAnimationFrame(tick);
    }

    timer = {
      raf: window.requestAnimationFrame(tick),
      // Backstop: rAF is throttled or paused when the tab is in the background.
      interval: window.setInterval(function () {
        if (!round || round.finished) return;
        if (Date.now() - startedAt >= limitMs) {
          finishRound(round.guess, true, false);
        }
      }, 500)
    };
  }

  function stopTimer() {
    if (!timer) return;
    window.cancelAnimationFrame(timer.raf);
    window.clearInterval(timer.interval);
    timer = null;
  }

  function confirmGuess() {
    if (!round || round.finished || !round.guess) return;
    finishRound(round.guess, false, false);
  }

  /* ---------------------------------------------------------- scoring */

  function finishRound(guess, timedOut, mapUnavailable) {
    if (!round || round.finished) return;
    round.finished = true;
    stopTimer();

    var cfg = round.cfg;
    var answer = { lat: round.landmark.lat, lng: round.landmark.lng };
    var timeLeft = timedOut ? 0 : (round.timeLeft != null ? round.timeLeft : cfg.seconds);
    var distanceKm = guess ? U.haversineKm(guess, answer) : Infinity;
    var found = !mapUnavailable && !timedOut && !!guess && distanceKm <= cfg.radiusKm;

    var mapXp = mapUnavailable ? 0
      : Levels.mapScore(found, distanceKm, timeLeft, cfg.seconds, cfg.radiusKm, round.cityCorrect);

    session.score += mapXp;
    if (found) { session.pinHits += 1; buzz([15, 50, 15]); }

    var levelBefore = level();
    profile.xp += round.cityXp + mapXp;
    profile.roundsPlayed += 1;
    if (round.cityCorrect) profile.citiesCorrect += 1;
    if (found) profile.pinsFound += 1;
    profile.bestStreak = Math.max(profile.bestStreak, session.bestStreak);
    profile.bestScore = Math.max(profile.bestScore, session.score);
    saveProfile();
    var levelAfter = level();

    var result = {
      landmark: round.landmark,
      creditUrl: round.photo ? round.photo.creditUrl : '',
      cityCorrect: round.cityCorrect,
      cityXp: round.cityXp,
      mapXp: mapXp,
      found: found,
      timedOut: timedOut,
      distanceKm: guess ? distanceKm : 0,
      radiusKm: cfg.radiusKm,
      timeUsed: cfg.seconds - timeLeft,
      leveledUpTo: levelAfter > levelBefore ? levelAfter : null,
      subtitle: buildSubtitle(found, timedOut, mapUnavailable, guess, distanceKm, cfg)
    };

    if (mapUnavailable) {
      showResult(result);
      return;
    }

    // Let the reveal sit on the map for a beat before the scorecard.
    mapAdapter.showAnswer(guess, answer, cfg.radiusKm);
    UI.setMapHint(found ? 'Nice pin.' : 'The landmark was here.');
    UI.setGuessButton('See result', true);
    round.awaitingResult = result;
    setTimeout(function () {
      if (round && round.awaitingResult === result) showResult(result);
    }, 1900);
  }

  function buildSubtitle(found, timedOut, mapUnavailable, guess, distanceKm, cfg) {
    if (mapUnavailable) return 'The map could not load, so only the photo round counted this time.';
    if (!guess) return 'No pin dropped — the clock beat you to it.';
    if (found) return 'Your pin landed ' + U.formatDistance(distanceKm) + ' from the landmark.';
    if (timedOut) return 'Time ran out ' + U.formatDistance(distanceKm) + ' from the landmark.';
    return 'You needed to be within ' + cfg.radiusKm + ' km — you were ' + U.formatDistance(distanceKm) + ' away.';
  }

  function showResult(result) {
    if (round) round.awaitingResult = null;
    UI.renderResult(result, {
      next: function () { nextRound(); },
      end: function () { endRun(); }
    });
    UI.show('screen-result');
  }

  function endRun() {
    var snapshot = session;
    UI.renderRunOver(snapshot, profile, {
      again: function () { startRun(); },
      home: function () { goHome(); }
    });
    UI.show('screen-result');
  }

  function goHome() {
    stopTimer();
    round = null;
    UI.renderHome(profile);
    UI.show('screen-home');
  }

  /* ---------------------------------------------------------- sheets */

  function showHowTo() {
    var cfg = Levels.config(1);
    UI.sheet('How to play',
      '<ol>' +
        '<li><b>Name the city.</b> A landmark photo appears with four candidate cities. Pick the right one.</li>' +
        '<li><b>Find it on the map.</b> Pan and zoom to the landmark, tap to drop your pin, then lock it in — ' +
          'at level 1 you get <b>' + cfg.seconds + ' seconds</b> and the pin has to land within <b>' + cfg.radiusKm + ' km</b>.</li>' +
        '<li><b>Level up.</b> XP builds slowly across rounds. Every level cuts the clock and tightens the radius, ' +
          'down to <b>' + Levels.config(Levels.max).seconds + ' seconds</b> within <b>' + Levels.config(Levels.max).radiusKm + ' km</b> at level ' + Levels.max + '.</li>' +
      '</ol>' +
      '<p>Missing the city does not end the round — you still get to hunt for the landmark, for half the pin XP.</p>');
  }

  function showSettings() {
    var s = profile.settings;
    UI.sheet('Settings',
      '<div class="field">' +
        '<span class="field__label">Map</span>' +
        '<div class="seg" id="seg-provider">' +
          '<button type="button" data-provider="osm" class="' + (s.mapProvider === 'osm' ? 'is-on' : '') + '">OpenStreetMap</button>' +
          '<button type="button" data-provider="google" class="' + (s.mapProvider === 'google' ? 'is-on' : '') + '">Google Maps</button>' +
        '</div>' +
        '<span class="field__hint">OpenStreetMap needs no key and works straight away. Google Maps needs your own Maps JavaScript API key.</span>' +
      '</div>' +
      '<div class="field">' +
        '<span class="field__label">Google Maps API key</span>' +
        '<input type="text" id="inp-gkey" placeholder="AIza…" autocomplete="off" autocapitalize="off" spellcheck="false" value="' + U.esc(s.googleKey) + '">' +
        '<span class="field__hint">Stored only in this browser and used only to load the Google Maps script.</span>' +
      '</div>' +
      '<div class="switch">' +
        '<span class="switch__label">Vibration feedback</span>' +
        '<div class="seg" id="seg-haptics" style="width:150px">' +
          '<button type="button" data-haptics="on" class="' + (s.haptics ? 'is-on' : '') + '">On</button>' +
          '<button type="button" data-haptics="off" class="' + (!s.haptics ? 'is-on' : '') + '">Off</button>' +
        '</div>' +
      '</div>' +
      '<button class="btn" id="btn-reset" style="border-color:rgba(255,107,107,.5);color:#ff9b9b">Reset progress</button>',
      function (body) {
        body.querySelectorAll('#seg-provider button').forEach(function (b) {
          b.addEventListener('click', function () {
            setProvider(b.getAttribute('data-provider'));
            body.querySelectorAll('#seg-provider button').forEach(function (o) { o.classList.remove('is-on'); });
            b.classList.add('is-on');
          });
        });
        body.querySelectorAll('#seg-haptics button').forEach(function (b) {
          b.addEventListener('click', function () {
            profile.settings.haptics = b.getAttribute('data-haptics') === 'on';
            saveProfile();
            body.querySelectorAll('#seg-haptics button').forEach(function (o) { o.classList.remove('is-on'); });
            b.classList.add('is-on');
          });
        });
        body.querySelector('#inp-gkey').addEventListener('change', function (e) {
          profile.settings.googleKey = e.target.value.trim();
          saveProfile();
          dropMap();
        });
        body.querySelector('#btn-reset').addEventListener('click', function () {
          if (!window.confirm('Reset your level, XP and stats?')) return;
          profile = Store.reset();
          UI.renderHome(profile);
          UI.closeSheet();
          UI.toast('Progress reset');
        });
      });
  }

  function setProvider(provider) {
    if (profile.settings.mapProvider === provider) return;
    profile.settings.mapProvider = provider;
    saveProfile();
    dropMap();
    if (provider === 'google' && !profile.settings.googleKey) {
      UI.toast('Add a Google Maps API key below', 3200);
    }
  }

  /** Force the next map phase to rebuild with the current settings. */
  function dropMap() {
    mapAdapter = null;
    mapPending = null;
    $('map').innerHTML = '';
  }

  /* ---------------------------------------------------------- wiring */

  function init() {
    UI.renderHome(profile);
    UI.show('screen-home');

    $('btn-play').addEventListener('click', startRun);
    $('btn-how').addEventListener('click', showHowTo);
    $('btn-settings').addEventListener('click', showSettings);
    $('btn-quit-quiz').addEventListener('click', goHome);
    $('btn-guess').addEventListener('click', function () {
      if (round && round.awaitingResult) showResult(round.awaitingResult);
      else confirmGuess();
    });

    document.querySelectorAll('[data-close-sheet]').forEach(function (el) {
      el.addEventListener('click', UI.closeSheet);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') UI.closeSheet();
    });

    // Warm one photo so the first round has something to show immediately.
    Photos.prefetch(U.pick(LANDMARKS.filter(function (l) { return l.tier === 1; })));

    window.addEventListener('resize', function () {
      if (mapAdapter) mapAdapter.invalidate();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
