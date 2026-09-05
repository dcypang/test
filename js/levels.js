/* ============================================================
   Level progression.

   Level 1 ("Easy") gives 60 seconds to pin the landmark on the map
   and accepts a guess within 200 km. Every level shortens the clock
   and tightens the radius. XP is earned slowly: roughly four or five
   good rounds per level.
   ============================================================ */
(function (window) {
  'use strict';

  var LEVELS = [
    { level:1,  name:'Explorer',      seconds:60, radiusKm:200, xpNeeded:0,    tiers:[1,1,1,2] },
    { level:2,  name:'Wanderer',      seconds:55, radiusKm:160, xpNeeded:320,  tiers:[1,1,2,2] },
    { level:3,  name:'Sightseer',     seconds:50, radiusKm:130, xpNeeded:760,  tiers:[1,1,2,2] },
    { level:4,  name:'Navigator',     seconds:45, radiusKm:100, xpNeeded:1300, tiers:[1,2,2,3] },
    { level:5,  name:'Pathfinder',    seconds:40, radiusKm:75,  xpNeeded:1950, tiers:[1,2,2,3] },
    { level:6,  name:'Cartographer',  seconds:35, radiusKm:55,  xpNeeded:2700, tiers:[2,2,3,3] },
    { level:7,  name:'Globetrotter',  seconds:30, radiusKm:40,  xpNeeded:3550, tiers:[2,2,3,3] },
    { level:8,  name:'Pathmaster',    seconds:27, radiusKm:25,  xpNeeded:4500, tiers:[2,3,3,3] },
    { level:9,  name:'Geo Ace',       seconds:24, radiusKm:15,  xpNeeded:5550, tiers:[2,3,3,3] },
    { level:10, name:'Landmark Rush', seconds:20, radiusKm:8,   xpNeeded:6700, tiers:[3,3,3,3] }
  ];

  var Levels = {
    all: LEVELS,
    max: LEVELS.length,

    /** Config for a level number (clamped to the table). */
    config: function (level) {
      return LEVELS[U.clamp(level, 1, LEVELS.length) - 1];
    },

    /** Highest level whose XP requirement is met. */
    levelForXp: function (xp) {
      var lv = 1;
      for (var i = 0; i < LEVELS.length; i++) {
        if (xp >= LEVELS[i].xpNeeded) lv = LEVELS[i].level;
      }
      return lv;
    },

    /** Progress toward the next level: {pct, have, need, isMax}. */
    progress: function (xp) {
      var lv = Levels.levelForXp(xp);
      if (lv >= LEVELS.length) return { pct: 100, have: 0, need: 0, isMax: true };
      var from = LEVELS[lv - 1].xpNeeded;
      var to = LEVELS[lv].xpNeeded;
      return {
        pct: U.clamp(((xp - from) / (to - from)) * 100, 0, 100),
        have: xp - from,
        need: to - from,
        isMax: false
      };
    }
  };

  /* ---- scoring ---- */
  Levels.CITY_XP = 40;
  Levels.MAP_XP_MAX = 70;

  /** XP for naming the city, including a small streak bonus. */
  Levels.cityScore = function (correct, streak) {
    if (!correct) return 0;
    return Levels.CITY_XP + Math.min(25, streak * 5);
  };

  /**
   * XP for the map round.
   * found      - inside the level's radius before the clock ran out
   * distanceKm - how far the pin landed from the landmark
   * timeLeft   - seconds remaining
   * limit      - seconds allowed
   * knewCity   - whether the player named the city unaided (half XP if not)
   */
  Levels.mapScore = function (found, distanceKm, timeLeft, limit, radiusKm, knewCity) {
    if (!found) return 0;
    var accuracy = U.clamp(1 - (distanceKm / radiusKm), 0.25, 1);
    var speed = 0.55 + 0.45 * U.clamp(timeLeft / limit, 0, 1);
    var xp = Math.round(Levels.MAP_XP_MAX * accuracy * speed);
    return knewCity ? xp : Math.round(xp / 2);
  };

  window.Levels = Levels;
})(window);
