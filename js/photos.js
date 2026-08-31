/* ============================================================
   Landmark photos.

   Images come from Wikipedia/Wikimedia at runtime, so the game ships
   with no bundled photos and needs no API key. Two endpoints are tried
   (the action API, then the REST summary); if both fail the caller
   falls back to the landmark's text clue so the round is still playable.
   Resolved URLs are cached in localStorage for a month.
   ============================================================ */
(function (window) {
  'use strict';

  var CACHE_KEY = 'landmark-rush:photos:v1';
  var TTL_MS = 30 * 24 * 60 * 60 * 1000;
  var FETCH_TIMEOUT = 9000;
  var API = 'https://en.wikipedia.org/w/api.php';
  var REST = 'https://en.wikipedia.org/api/rest_v1/page/summary/';

  var cache = loadCache();
  var inflight = {};

  function loadCache() {
    try {
      var raw = window.localStorage.getItem(CACHE_KEY);
      var obj = raw ? JSON.parse(raw) : {};
      var now = Date.now();
      Object.keys(obj).forEach(function (k) {
        if (!obj[k] || !obj[k].t || now - obj[k].t > TTL_MS) delete obj[k];
      });
      return obj;
    } catch (e) { return {}; }
  }

  function saveCache() {
    try { window.localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); }
    catch (e) { /* quota or private mode — memory cache still works */ }
  }

  function getJSON(url) {
    return U.withTimeout(
      fetch(url, { mode: 'cors', credentials: 'omit' }).then(function (r) {
        if (!r.ok) throw new Error('http ' + r.status);
        return r.json();
      }),
      FETCH_TIMEOUT
    );
  }

  /* Wikimedia thumbnails embed their width in the path; ask for a bigger one. */
  function upscale(url, width) {
    if (!url || url.indexOf('/thumb/') === -1) return url;
    return url.replace(/\/(\d+)px-([^/]+)$/, function (m, w, name) {
      return '/' + Math.max(parseInt(w, 10) || 0, width) + 'px-' + name;
    });
  }

  function viaActionApi(title) {
    var url = API + '?action=query&format=json&formatversion=2&origin=*' +
      '&prop=pageimages&piprop=thumbnail%7Cname&pithumbsize=1000&redirects=1' +
      '&titles=' + encodeURIComponent(title);
    return getJSON(url).then(function (data) {
      var page = data && data.query && data.query.pages && data.query.pages[0];
      if (!page || !page.thumbnail || !page.thumbnail.source) throw new Error('no image');
      return { src: page.thumbnail.source, file: page.pageimage || '', title: page.title || title };
    });
  }

  function viaRestSummary(title) {
    return getJSON(REST + encodeURIComponent(title.replace(/ /g, '_'))).then(function (data) {
      var src = (data.originalimage && data.originalimage.source) ||
                (data.thumbnail && upscale(data.thumbnail.source, 1000));
      if (!src) throw new Error('no image');
      var file = '';
      var m = /\/([^/]+)$/.exec(src.split('?')[0]);
      if (m) file = decodeURIComponent(m[1]).replace(/^\d+px-/, '');
      return { src: src, file: file, title: (data.titles && data.titles.normalized) || title };
    });
  }

  /* Resolve to a URL the browser has actually decoded, so a broken link
     surfaces here rather than as an empty frame mid-round. */
  function preloadImage(src) {
    return U.withTimeout(new Promise(function (resolve, reject) {
      var img = new Image();
      img.decoding = 'async';
      img.referrerPolicy = 'no-referrer';
      img.onload = function () { resolve(src); };
      img.onerror = function () { reject(new Error('image failed')); };
      img.src = src;
    }), FETCH_TIMEOUT + 3000);
  }

  var Photos = {
    /**
     * Resolve a landmark's photo.
     * @returns {Promise<{src:string, creditUrl:string, file:string}>}
     */
    get: function (landmark) {
      var id = landmark.id;

      if (cache[id] && cache[id].src) {
        return preloadImage(cache[id].src).then(function () {
          return { src: cache[id].src, file: cache[id].file || '', creditUrl: creditUrl(cache[id].file) };
        }).catch(function () {
          delete cache[id];
          return Photos.get(landmark);
        });
      }

      if (inflight[id]) return inflight[id];

      var p = viaActionApi(landmark.wiki)
        .catch(function () { return viaRestSummary(landmark.wiki); })
        .then(function (info) {
          return preloadImage(info.src).then(function () { return info; });
        })
        .then(function (info) {
          cache[id] = { src: info.src, file: info.file, t: Date.now() };
          saveCache();
          delete inflight[id];
          return { src: info.src, file: info.file, creditUrl: creditUrl(info.file) };
        })
        .catch(function (err) {
          delete inflight[id];
          throw err;
        });

      inflight[id] = p;
      return p;
    },

    /** Warm the cache for an upcoming landmark; failures are ignored. */
    prefetch: function (landmark) {
      if (!landmark) return;
      Photos.get(landmark).catch(function () { /* the round will fall back to the clue */ });
    }
  };

  function creditUrl(file) {
    if (!file) return '';
    return 'https://commons.wikimedia.org/wiki/File:' + encodeURIComponent(file.replace(/ /g, '_'));
  }

  window.Photos = Photos;
})(window);
