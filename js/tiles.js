/* ============================================================
   Open map styles.

   Every style here is keyless and openly licensed or free to use with
   attribution, so the game works the moment it is served. Each entry
   carries the attribution its licence requires — Leaflet renders it in
   the corner of the map, so do not drop the `attribution` field when
   adding a provider.

   `terms` is a note for whoever deploys this, surfaced in Settings and
   the README; it is not shown mid-round.
   ============================================================ */
(function (window) {
  'use strict';

  var OSM_CREDIT = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';

  var TILES = [
    {
      id: 'osm',
      label: 'Standard',
      blurb: 'OpenStreetMap',
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      maxZoom: 19,
      attribution: OSM_CREDIT,
      terms: 'Open data under the ODbL. The public tile servers are meant for light use — run your own or use a paid provider if this gets busy.'
    },
    {
      id: 'carto-dark',
      label: 'Dark',
      blurb: 'CARTO Dark Matter',
      url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      subdomains: 'abcd',
      maxZoom: 20,
      attribution: OSM_CREDIT + ' &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>',
      terms: 'OpenStreetMap data styled by CARTO, free for light use with attribution.'
    },
    {
      id: 'carto-light',
      label: 'Light',
      blurb: 'CARTO Positron',
      url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      subdomains: 'abcd',
      maxZoom: 20,
      attribution: OSM_CREDIT + ' &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>',
      terms: 'OpenStreetMap data styled by CARTO, free for light use with attribution.'
    },
    {
      id: 'esri-satellite',
      label: 'Satellite',
      blurb: 'Esri World Imagery',
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      maxZoom: 19,
      attribution: 'Imagery &copy; <a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a>, Maxar, Earthstar Geographics',
      terms: 'Esri publishes these tiles for free use with attribution. Check Esri\'s terms before shipping a commercial product on them.'
    },
    {
      id: 'opentopo',
      label: 'Topographic',
      blurb: 'OpenTopoMap',
      url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
      subdomains: 'abc',
      maxZoom: 17,
      attribution: OSM_CREDIT + ', <a href="https://opentopomap.org" target="_blank" rel="noopener">OpenTopoMap</a> (CC-BY-SA)',
      terms: 'CC-BY-SA. Volunteer-run servers with a fair-use policy — light traffic only.'
    }
  ];

  window.TILES = {
    all: TILES,
    "default": 'osm',
    get: function (id) {
      for (var i = 0; i < TILES.length; i++) if (TILES[i].id === id) return TILES[i];
      return TILES[0];
    }
  };
})(window);
