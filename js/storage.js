/* Persisted profile + settings. Falls back to memory when storage is blocked
   (private browsing on iOS, for example). */
(function (window) {
  'use strict';

  var KEY = 'landmark-rush:v1';

  var DEFAULTS = {
    xp: 0,
    bestScore: 0,
    roundsPlayed: 0,
    citiesCorrect: 0,
    pinsFound: 0,
    bestStreak: 0,
    settings: {
      mapProvider: 'osm',      // 'osm' (open tiles) | 'google'
      mapStyle: 'osm',         // which open tile style — see js/tiles.js
      googleKey: '',
      haptics: true
    }
  };

  var memory = null;

  function read() {
    try {
      var raw = window.localStorage.getItem(KEY);
      if (!raw) return clone(DEFAULTS);
      var parsed = JSON.parse(raw);
      var out = clone(DEFAULTS);
      Object.keys(DEFAULTS).forEach(function (k) {
        if (k === 'settings') return;
        if (typeof parsed[k] === typeof DEFAULTS[k]) out[k] = parsed[k];
      });
      if (parsed.settings) {
        Object.keys(DEFAULTS.settings).forEach(function (k) {
          if (typeof parsed.settings[k] === typeof DEFAULTS.settings[k]) {
            out.settings[k] = parsed.settings[k];
          }
        });
      }
      return out;
    } catch (e) {
      return memory ? clone(memory) : clone(DEFAULTS);
    }
  }

  function write(state) {
    memory = clone(state);
    try {
      window.localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) { /* storage unavailable — keep the in-memory copy */ }
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  window.Store = {
    load: function () { return memory ? clone(memory) : read(); },
    save: write,
    reset: function () {
      memory = clone(DEFAULTS);
      try { window.localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
      return clone(DEFAULTS);
    }
  };
})(window);
