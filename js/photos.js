/* ============================================================
   Landmark photos.

   Images come from Wikipedia/Wikimedia at runtime, so the game ships
   with no bundled photos and needs no API key. Two endpoints are tried
   (the action API, then the REST summary); if both fail the caller
   falls back to the landmark's text clue so the round is still playable.
   Resolved URLs are cached in localStorage for a month.

   Each photo's author and licence are looked up from Wikimedia Commons
   alongside the image, so the result screen can credit it the way its
   licence requires. A file that turns out not to be freely licensed is
   refused, and that landmark falls back to its clue.
   ============================================================ */
(function (window) {
  'use strict';

  var CACHE_KEY = 'landmark-rush:photos:v2';
  var TTL_MS = 30 * 24 * 60 * 60 * 1000;
  var FETCH_TIMEOUT = 9000;
  var API = 'https://en.wikipedia.org/w/api.php';
  var COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
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

  /* ---------------------------------------------------------- licensing */

  /* extmetadata values are little HTML fragments ("<a href=…>Name</a>"). */
  function textOf(html) {
    if (!html) return '';
    var doc = new DOMParser().parseFromString(String(html), 'text/html');
    return (doc.body.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 90);
  }

  function looksNonFree(license, shortName) {
    return /fair.?use|non.?free|copyright/i.test(license + ' ' + shortName);
  }

  function creditFrom(page) {
    var info = page && page.imageinfo && page.imageinfo[0];
    var meta = (info && info.extmetadata) || {};
    var val = function (k) { return meta[k] && meta[k].value; };
    var license = val('License') || '';
    var shortName = textOf(val('LicenseShortName')) || (license ? license.toUpperCase() : '');
    return {
      author: textOf(val('Artist')) || textOf(val('Credit')),
      license: shortName,
      licenseUrl: val('LicenseUrl') || '',
      pageUrl: (info && info.descriptionurl) || '',
      free: !looksNonFree(license, shortName)
    };
  }

  function creditQuery(host, file) {
    return host + '?action=query&format=json&formatversion=2&origin=*' +
      '&prop=imageinfo&iiprop=extmetadata%7Curl' +
      '&iiextmetadatafilter=Artist%7CCredit%7CLicense%7CLicenseShortName%7CLicenseUrl' +
      '&titles=' + encodeURIComponent('File:' + file);
  }

  /**
   * Author + licence for a Commons file.
   * Non-free files cannot live on Commons, so a file that is missing there
   * but present on Wikipedia is exactly the case worth refusing.
   */
  function fetchCredit(file) {
    if (!file) return Promise.resolve(null);
    return getJSON(creditQuery(COMMONS_API, file)).then(function (data) {
      var page = data && data.query && data.query.pages && data.query.pages[0];
      if (page && !page.missing) return creditFrom(page);
      return getJSON(creditQuery(API, file)).then(function (local) {
        var lp = local && local.query && local.query.pages && local.query.pages[0];
        if (!lp || lp.missing) return null;          // unknown: let it through
        return creditFrom(lp);
      });
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
      var hit = cache[id];

      if (hit && hit.nonFree) return Promise.reject(new Error('not freely licensed'));

      if (hit && hit.src) {
        return preloadImage(hit.src)
          .then(function () { return resolved(hit.src, hit.file, hit.credit); })
          .catch(function () {
            delete cache[id];
            return Photos.get(landmark);
          });
      }

      if (inflight[id]) return inflight[id];

      var p = viaActionApi(landmark.wiki)
        .catch(function () { return viaRestSummary(landmark.wiki); })
        .then(function (info) {
          // The licence lookup runs alongside the download, not after it.
          return Promise.all([
            preloadImage(info.src),
            fetchCredit(info.file).catch(function () { return null; })
          ]).then(function (both) {
            info.credit = both[1];
            return info;
          });
        })
        .then(function (info) {
          delete inflight[id];
          if (info.credit && info.credit.free === false) {
            cache[id] = { nonFree: true, t: Date.now() };
            saveCache();
            throw new Error('not freely licensed');
          }
          cache[id] = { src: info.src, file: info.file, credit: info.credit, t: Date.now() };
          saveCache();
          return resolved(info.src, info.file, info.credit);
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

  /** Shape handed to the game: everything the result screen needs to credit the photo. */
  function resolved(src, file, credit) {
    credit = credit || null;
    return {
      src: src,
      file: file || '',
      creditUrl: (credit && credit.pageUrl) || creditUrl(file),
      author: (credit && credit.author) || '',
      license: (credit && credit.license) || '',
      licenseUrl: (credit && credit.licenseUrl) || ''
    };
  }

  window.Photos = Photos;
})(window);
