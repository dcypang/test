/* ============================================================
   Landmark photos.

   Images come from Wikipedia/Wikimedia at runtime, so the game ships
   with no bundled photos and needs no API key.

   Three sources are tried in order, and the first one whose image the
   browser actually decodes wins:

     1. Wikipedia pageimages, asking for freely licensed lead images only
        (pilicense=free), so the API does the licence filtering server-side.
     2. The REST summary endpoint, for articles pageimages has nothing for.
        This one can surface a non-free file, so it is the only source whose
        licence is checked here before the photo is shown.
     3. A Commons image search for the landmark. Commons hosts free files
        exclusively, so anything found here is safe to display.

   If all three fail the caller falls back to the landmark's text clue and
   the round is still playable.

   Author and licence are looked up separately and never block the photo —
   they are only needed on the result screen, seconds later.
   ============================================================ */
(function (window) {
  'use strict';

  var CACHE_KEY = 'landmark-rush:photos:v3';   // v3: v2 cached bogus "non-free" verdicts
  var TTL_MS = 30 * 24 * 60 * 60 * 1000;
  var FETCH_TIMEOUT = 9000;
  var API = 'https://en.wikipedia.org/w/api.php';
  var COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
  var REST = 'https://en.wikipedia.org/api/rest_v1/page/summary/';

  dropOldCaches();
  var cache = loadCache();
  var credits = {};        // file name -> credit, for this session
  var inflight = {};

  /* v2 could mark a freely licensed photo as non-free and remember it for a
     month; drop those older caches so nobody stays stuck on the clue. */
  function dropOldCaches() {
    try {
      ['landmark-rush:photos:v1', 'landmark-rush:photos:v2'].forEach(function (k) {
        window.localStorage.removeItem(k);
      });
    } catch (e) { /* storage unavailable */ }
  }

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

  function isPhotoFile(name) { return /\.(jpe?g|png|webp)$/i.test(name || ''); }

  /* ---------------------------------------------------------- sources */

  function viaActionApi(landmark) {
    var url = API + '?action=query&format=json&formatversion=2&origin=*' +
      '&prop=pageimages&piprop=thumbnail%7Cname&pithumbsize=1000&pilicense=free&redirects=1' +
      '&titles=' + encodeURIComponent(landmark.wiki);
    return getJSON(url).then(function (data) {
      var page = data && data.query && data.query.pages && data.query.pages[0];
      if (!page || !page.thumbnail || !page.thumbnail.source) throw new Error('no lead image');
      return { src: page.thumbnail.source, file: page.pageimage || '', source: 'pageimages' };
    });
  }

  /* The only source that can hand back a non-free file, so it is the only
     one that waits on a licence check before the photo is shown. */
  function viaRestSummary(landmark) {
    var title = landmark.wiki.replace(/ /g, '_');
    return getJSON(REST + encodeURIComponent(title)).then(function (data) {
      // Prefer a sized thumbnail: originals can be tens of megabytes.
      var src = (data.thumbnail && upscale(data.thumbnail.source, 1000)) ||
                (data.originalimage && data.originalimage.source);
      if (!src) throw new Error('no summary image');
      var file = '';
      var m = /\/([^/]+)$/.exec(src.split('?')[0]);
      if (m) file = decodeURIComponent(m[1]).replace(/^\d+px-/, '');
      return fetchCredit(file).catch(function () { return null; }).then(function (credit) {
        if (credit && credit.free === false) throw new Error('not freely licensed');
        if (credit) credits[file] = credit;
        return { src: src, file: file, source: 'summary' };
      });
    });
  }

  /* Commons hosts freely licensed files only, so anything found here is safe. */
  function viaCommonsSearch(landmark) {
    var query = landmark.name + ' ' + landmark.city;
    var url = COMMONS_API + '?action=query&format=json&formatversion=2&origin=*' +
      '&generator=search&gsrnamespace=6&gsrlimit=8&gsrsearch=' + encodeURIComponent(query) +
      '&prop=imageinfo&iiprop=url%7Cextmetadata&iiurlwidth=1000' +
      '&iiextmetadatafilter=' + CREDIT_FIELDS;
    return getJSON(url).then(function (data) {
      var pages = (data && data.query && data.query.pages) || [];
      for (var i = 0; i < pages.length; i++) {
        var page = pages[i];
        var info = page.imageinfo && page.imageinfo[0];
        if (!info || !info.thumburl || !isPhotoFile(page.title)) continue;
        var file = String(page.title).replace(/^File:/, '');
        credits[file] = creditFrom(page);
        return { src: info.thumburl, file: file, source: 'commons-search' };
      }
      throw new Error('no commons match');
    });
  }

  var SOURCES = [viaActionApi, viaRestSummary, viaCommonsSearch];

  /* ---------------------------------------------------------- licensing */

  var CREDIT_FIELDS = 'Artist%7CCredit%7CLicense%7CLicenseShortName%7CLicenseUrl';

  /* extmetadata values are little HTML fragments ("<a href=…>Name</a>"). */
  function textOf(html) {
    if (!html) return '';
    var doc = new DOMParser().parseFromString(String(html), 'text/html');
    return (doc.body.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 90);
  }

  /**
   * Only an explicit non-free marker counts. Matching "copyright" loosely
   * would refuse Commons' own "Copyrighted free use" template, which is a
   * free licence — that bug hid a lot of perfectly good photos.
   */
  function looksNonFree(license, shortName) {
    var text = (license + ' ' + shortName).toLowerCase();
    if (/copyrighted free use/.test(text)) return false;
    return /fair use|fairuse|non-free|nonfree/.test(text);
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
      '&prop=imageinfo&iiprop=extmetadata%7Curl&iiextmetadatafilter=' + CREDIT_FIELDS +
      '&titles=' + encodeURIComponent('File:' + file);
  }

  function fetchCredit(file) {
    if (!file) return Promise.resolve(null);
    if (credits[file]) return Promise.resolve(credits[file]);
    return getJSON(creditQuery(COMMONS_API, file)).then(function (data) {
      var page = data && data.query && data.query.pages && data.query.pages[0];
      if (page && !page.missing) return creditFrom(page);
      // Not on Commons: it may be a local Wikipedia upload.
      return getJSON(creditQuery(API, file)).then(function (local) {
        var lp = local && local.query && local.query.pages && local.query.pages[0];
        return (!lp || lp.missing) ? null : creditFrom(lp);
      });
    }).then(function (credit) {
      if (credit) credits[file] = credit;
      return credit;
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

  /* ---------------------------------------------------------- resolution */

  function commonsPage(file) {
    if (!file) return '';
    return 'https://commons.wikimedia.org/wiki/File:' + encodeURIComponent(file.replace(/ /g, '_'));
  }

  /** The object the game holds for a round. Credit fields fill in later. */
  function photoOf(src, file, source) {
    var photo = {
      src: src, file: file || '', source: source || 'cache',
      creditUrl: commonsPage(file), author: '', license: '', licenseUrl: ''
    };
    applyCredit(photo, credits[file]);
    return photo;
  }

  function applyCredit(photo, credit) {
    if (!credit) return photo;
    photo.author = credit.author || '';
    photo.license = credit.license || '';
    photo.licenseUrl = credit.licenseUrl || '';
    if (credit.pageUrl) photo.creditUrl = credit.pageUrl;
    return photo;
  }

  /** Walk the sources until one produces an image that actually loads. */
  function resolve(landmark, index, tried) {
    if (index >= SOURCES.length) {
      var err = new Error('no photo found');
      err.tried = tried;
      return Promise.reject(err);
    }
    return SOURCES[index](landmark)
      .then(function (info) {
        return preloadImage(info.src).then(function () { return info; });
      })
      .catch(function (e) {
        tried.push(SOURCES[index].name + ': ' + e.message);
        return resolve(landmark, index + 1, tried);
      });
  }

  var Photos = {
    /**
     * Resolve a landmark's photo.
     * @returns {Promise<{src, file, source, creditUrl, author, license, licenseUrl}>}
     */
    get: function (landmark) {
      var id = landmark.id;
      var hit = cache[id];

      if (hit && hit.src) {
        return preloadImage(hit.src)
          .then(function () { return photoOf(hit.src, hit.file, 'cache'); })
          .catch(function () {
            delete cache[id];
            saveCache();
            return Photos.get(landmark);
          });
      }

      if (inflight[id]) return inflight[id];

      var p = resolve(landmark, 0, []).then(function (info) {
        // Only successes are cached: a blip must not sideline a landmark.
        cache[id] = { src: info.src, file: info.file, t: Date.now() };
        saveCache();
        delete inflight[id];
        return photoOf(info.src, info.file, info.source);
      }).catch(function (err) {
        delete inflight[id];
        throw err;
      });

      inflight[id] = p;
      return p;
    },

    /** Fill in author and licence for an already-displayed photo. */
    credit: function (photo) {
      if (!photo || !photo.file) return Promise.resolve(photo);
      if (photo.license) return Promise.resolve(photo);
      return fetchCredit(photo.file)
        .then(function (credit) { return applyCredit(photo, credit); })
        .catch(function () { return photo; });
    },

    /** Warm the cache for an upcoming landmark; failures are ignored. */
    prefetch: function (landmark) {
      if (!landmark) return;
      Photos.get(landmark).catch(function () { /* the round will fall back to the clue */ });
    },

    /** Used by check.html to report what happened, without the cache hiding it. */
    diagnose: function (landmark) {
      var started = Date.now();
      return resolve(landmark, 0, []).then(function (info) {
        return { ok: true, ms: Date.now() - started, source: info.source, file: info.file, src: info.src };
      }, function (err) {
        return { ok: false, ms: Date.now() - started, tried: err.tried || [], error: err.message };
      });
    }
  };

  window.Photos = Photos;
})(window);
