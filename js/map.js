/* ============================================================
   Map layer.

   Two interchangeable providers behind one small interface:
     • 'osm'    — Leaflet + OpenStreetMap tiles. Works with no API key,
                  so the game is playable out of the box.
     • 'google' — the real Google Maps JS API, used when the player
                  supplies their own key in Settings.

   Interface: reset(), onPick(fn), setPicking(bool), showAnswer(guess, answer),
              invalidate(), provider
   ============================================================ */
(function (window) {
  'use strict';

  var WORLD = { lat: 20, lng: 0, zoom: 2 };

  /* Longitudes drift past ±180 when the player pans across world copies. */
  function normalize(latlng) {
    var lng = ((latlng.lng + 180) % 360 + 360) % 360 - 180;
    return { lat: latlng.lat, lng: lng };
  }

  /* ---------------------------------------------------------- Leaflet */
  function createLeaflet(el) {
    var map = L.map(el, {
      zoomControl: false,
      attributionControl: true,
      worldCopyJump: true,
      minZoom: 2,
      maxZoom: 18,
      tap: true
    }).setView([WORLD.lat, WORLD.lng], WORLD.zoom);

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      crossOrigin: true,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);

    L.control.zoom({ position: 'bottomleft' }).addTo(map);

    var guessMarker = null, answerMarker = null, line = null, ring = null;
    var picking = false, pickCb = null;

    function pin(cls, pulse) {
      return L.divIcon({
        className: '',
        html: '<div class="pin ' + cls + (pulse ? ' pin--pulse' : '') + '"></div>',
        iconSize: [26, 26],
        iconAnchor: [13, 26]
      });
    }

    map.on('click', function (e) {
      if (!picking) return;
      var p = normalize(e.latlng);
      place(p);
      if (pickCb) pickCb(p);
    });

    function place(p) {
      if (guessMarker) map.removeLayer(guessMarker);
      guessMarker = L.marker([p.lat, p.lng], { icon: pin('pin--guess'), keyboard: false }).addTo(map);
    }

    function clear() {
      [guessMarker, answerMarker, line, ring].forEach(function (layer) {
        if (layer) map.removeLayer(layer);
      });
      guessMarker = answerMarker = line = ring = null;
    }

    return {
      provider: 'osm',
      reset: function () {
        clear();
        picking = true;
        map.setView([WORLD.lat, WORLD.lng], WORLD.zoom, { animate: false });
        setTimeout(function () { map.invalidateSize(); }, 60);
      },
      onPick: function (fn) { pickCb = fn; },
      setPicking: function (on) { picking = on; },
      invalidate: function () { map.invalidateSize(); },
      showAnswer: function (guess, answer, radiusKm) {
        picking = false;
        answerMarker = L.marker([answer.lat, answer.lng], { icon: pin('pin--answer', true), keyboard: false }).addTo(map);
        ring = L.circle([answer.lat, answer.lng], {
          radius: radiusKm * 1000, color: '#37d399', weight: 1.5, opacity: .7,
          fillColor: '#37d399', fillOpacity: .08
        }).addTo(map);

        var pts = [[answer.lat, answer.lng]];
        if (guess) {
          if (!guessMarker) place(guess);
          line = L.polyline([[guess.lat, guess.lng], [answer.lat, answer.lng]], {
            color: '#4cc2ff', weight: 2.5, dashArray: '7 7', opacity: .9
          }).addTo(map);
          pts.push([guess.lat, guess.lng]);
        }
        map.fitBounds(L.latLngBounds(pts).pad(0.35), {
          paddingTopLeft: [24, 110], paddingBottomRight: [24, 140], maxZoom: 12, animate: true
        });
      }
    };
  }

  /* ---------------------------------------------------------- Google */
  var googleLoader = null;

  function loadGoogle(key) {
    if (window.google && window.google.maps) return Promise.resolve();
    if (googleLoader) return googleLoader;

    googleLoader = new Promise(function (resolve, reject) {
      var cbName = '__lrGmapsReady';
      var timer = setTimeout(function () { reject(new Error('Google Maps timed out')); }, 12000);
      window[cbName] = function () { clearTimeout(timer); resolve(); };
      var s = document.createElement('script');
      s.async = true;
      s.src = 'https://maps.googleapis.com/maps/api/js?v=weekly&callback=' + cbName +
              '&key=' + encodeURIComponent(key);
      s.onerror = function () { clearTimeout(timer); reject(new Error('Google Maps failed to load')); };
      document.head.appendChild(s);
    }).catch(function (e) { googleLoader = null; throw e; });

    return googleLoader;
  }

  function createGoogle(el, key) {
    return loadGoogle(key).then(function () {
      var g = window.google.maps;
      var map = new g.Map(el, {
        center: { lat: WORLD.lat, lng: WORLD.lng },
        zoom: WORLD.zoom,
        gestureHandling: 'greedy',
        disableDefaultUI: true,
        zoomControl: true,
        zoomControlOptions: { position: g.ControlPosition.LEFT_BOTTOM },
        clickableIcons: false,
        streetViewControl: false,
        mapTypeId: 'roadmap'
      });

      var guessMarker = null, answerMarker = null, line = null, ring = null;
      var picking = false, pickCb = null;

      function symbol(color) {
        return {
          path: g.SymbolPath.CIRCLE, scale: 9, fillColor: color, fillOpacity: 1,
          strokeColor: '#ffffff', strokeWeight: 2
        };
      }

      function place(p) {
        if (guessMarker) guessMarker.setMap(null);
        guessMarker = new g.Marker({ position: p, map: map, icon: symbol('#4cc2ff'), zIndex: 3 });
      }

      map.addListener('click', function (e) {
        if (!picking) return;
        var p = normalize({ lat: e.latLng.lat(), lng: e.latLng.lng() });
        place(p);
        if (pickCb) pickCb(p);
      });

      function clear() {
        [guessMarker, answerMarker, line, ring].forEach(function (o) { if (o) o.setMap(null); });
        guessMarker = answerMarker = line = ring = null;
      }

      return {
        provider: 'google',
        reset: function () {
          clear();
          picking = true;
          map.setCenter({ lat: WORLD.lat, lng: WORLD.lng });
          map.setZoom(WORLD.zoom);
        },
        onPick: function (fn) { pickCb = fn; },
        setPicking: function (on) { picking = on; },
        invalidate: function () { g.event.trigger(map, 'resize'); },
        showAnswer: function (guess, answer, radiusKm) {
          picking = false;
          answerMarker = new g.Marker({ position: answer, map: map, icon: symbol('#37d399'), zIndex: 4 });
          ring = new g.Circle({
            map: map, center: answer, radius: radiusKm * 1000,
            strokeColor: '#37d399', strokeOpacity: .7, strokeWeight: 1.5,
            fillColor: '#37d399', fillOpacity: .08
          });

          var bounds = new g.LatLngBounds();
          bounds.extend(answer);
          if (guess) {
            if (!guessMarker) place(guess);
            line = new g.Polyline({
              map: map, path: [guess, answer], strokeColor: '#4cc2ff',
              strokeOpacity: .9, strokeWeight: 2.5
            });
            bounds.extend(guess);
          }
          map.fitBounds(bounds, { top: 120, bottom: 150, left: 30, right: 30 });
        }
      };
    });
  }

  /* ---------------------------------------------------------- factory */
  window.GameMap = {
    /**
     * @returns {Promise<object>} adapter; falls back to OSM if Google fails.
     */
    create: function (el, opts) {
      opts = opts || {};
      if (opts.provider === 'google' && opts.googleKey) {
        return createGoogle(el, opts.googleKey).catch(function (err) {
          if (opts.onFallback) opts.onFallback(err);
          el.innerHTML = '';
          return createLeaflet(el);
        });
      }
      return Promise.resolve(createLeaflet(el));
    }
  };
})(window);
