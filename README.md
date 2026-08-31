# Landmark Rush

A two-part geo guessing game for mobile web. No build step, no backend, no API key.

**Part 1 — Name the city.** A landmark photo appears with four candidate cities.

**Part 2 — Find it on the map.** Pan and zoom to the landmark, tap to drop a pin and
lock it in before the clock runs out. Level 1 gives you **60 seconds** and accepts a pin
within **200 km**; every level after that shortens the clock and tightens the radius.

## Play it

It is a static site — open `index.html` through any web server:

```sh
npx http-server . -p 8080     # or: python3 -m http.server 8080
```

Then open `http://localhost:8080` (opening the file directly with `file://` will not work,
because the browser blocks the Wikipedia requests that fetch the photos).

To publish it, push this branch and turn on GitHub Pages for the repository — the whole
game is static files.

## Levels

XP builds slowly: a strong round is worth about 100 XP and each level takes roughly four
or five of them.

| Level | Name | Clock | Must land within |
|---|---|---|---|
| 1 | Explorer | 60s | 200 km |
| 2 | Wanderer | 55s | 160 km |
| 3 | Sightseer | 50s | 130 km |
| 4 | Navigator | 45s | 100 km |
| 5 | Pathfinder | 40s | 75 km |
| 6 | Cartographer | 35s | 55 km |
| 7 | Globetrotter | 30s | 40 km |
| 8 | Pathmaster | 27s | 25 km |
| 9 | Geo Ace | 24s | 15 km |
| 10 | Landmark Rush | 20s | 8 km |

Higher levels also draw from the harder end of the landmark list. Scoring is in
`js/levels.js` — the table above is the single place to retune difficulty.

## Maps

The map round runs on **Leaflet** with open, keyless tile sources, so it works the moment
you serve it. Pick a style in Settings:

| Style | Source | Licence / terms |
|---|---|---|
| Standard | OpenStreetMap | Open data (ODbL). Public tile servers are for light use. |
| Dark | CARTO Dark Matter | OSM data styled by CARTO; free for light use with attribution. |
| Light | CARTO Positron | Same as above. |
| Satellite | Esri World Imagery | Free with attribution; check Esri's terms for commercial use. |
| Topographic | OpenTopoMap | CC-BY-SA; volunteer servers, fair-use policy. |

Each style carries the attribution its licence requires and Leaflet renders it on the map —
`js/tiles.js` is the single place to add a provider, and the `attribution` field is not
optional. Satellite is the most fun for hunting a landmark.

None of these are built for heavy traffic. If the game gets real use, sign up with a tile
provider (MapTiler, Stadia, Thunderforest and others have free tiers) or run your own tile
server, and add it to `js/tiles.js`.

If you would rather use **Google Maps**, open Settings → Map → Google Maps and paste your
own Maps JavaScript API key. It is kept in `localStorage` on that device only and used
solely to load the Google script. A rejected key falls back to the open tiles rather than
breaking the round. The key is deliberately not hardcoded: anything checked into a public
static site is readable by anyone who views source.

## Photos

Photos are fetched at runtime from Wikipedia (the `pageimages` API, with the REST summary
endpoint as a backup) and cached in `localStorage` for a month, so no images are bundled
and no key is needed.

Alongside each image the game looks up its author and licence from Wikimedia Commons, and
the result screen credits them — "Photo: <author> · CC BY-SA 4.0", linking to both the file
page and the licence — which is what the CC licences ask for. The credit appears only after
the answer is revealed, since a file name would give the landmark away.

Files that are not freely licensed are refused rather than displayed: non-free images
cannot live on Commons, so a file that is missing there and marked fair-use on Wikipedia is
dropped, and that landmark falls back to its written clue. The same clue covers a photo
that simply fails to load, and a round whose map will not load still scores the photo half.

## Layout

```
index.html          screens: home, quiz, map, result
css/styles.css      mobile-first, dark, safe-area aware
js/landmarks.js     the landmark database (coords, tier, clue, fact)
js/tiles.js         open map styles, each with its required attribution
js/levels.js        level table + scoring
js/photos.js        Wikipedia photo lookup, licence check, caching, fallbacks
js/map.js           map providers (open tiles / Google) behind one interface
js/game.js          round flow, timer, XP
js/ui.js            rendering
js/storage.js       progress in localStorage
js/util.js          distance maths and small helpers
```

Adding a landmark means appending one entry to `js/landmarks.js`: a name, city, country,
the landmark's own latitude/longitude, a tier from 1 (world famous) to 3, the English
Wikipedia article title for the photo, a spoiler-free `clue` and a `fact` for the result
screen.

## Notes

- Progress, settings and the photo cache live in `localStorage`; there is no account and
  nothing leaves the device.
- Everything the game loads is open: OpenStreetMap-derived tiles (or Esri imagery) and
  freely licensed Commons photos. The only optional non-open piece is Google Maps, and it
  needs a key you supply.
- The clock uses wall time, so backgrounding the tab does not pause a round.
- Tested on a 390×844 and a 360×640 viewport; the quiz layout adapts for short screens.
