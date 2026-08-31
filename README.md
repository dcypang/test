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

The map round ships with **Leaflet + OpenStreetMap**, so it works with no key. If you want
the real thing, open **Settings → Map → Google Maps** and paste your own Maps JavaScript
API key; it is kept in `localStorage` on that device only and used solely to load the
Google script. If the key is rejected the game falls back to OpenStreetMap rather than
breaking the round.

OpenStreetMap's public tile servers are fine for casual play but are not meant to carry a
popular app. If this gets real traffic, swap the tile URL in `js/map.js` for a proper tile
provider, or switch to Google Maps.

## Photos

Photos are fetched at runtime from Wikipedia (the `pageimages` API, with the REST summary
endpoint as a backup) and cached in `localStorage` for a month, so no images are bundled
and no key is needed. Each landmark also carries a written clue: if the photo cannot be
loaded, the round is played from the clue instead. If the map itself cannot load, the round
still scores the photo half. Photo credit links to the file on Wikimedia Commons, and is
only shown after the answer is revealed so it cannot give the answer away.

## Layout

```
index.html          screens: home, quiz, map, result
css/styles.css      mobile-first, dark, safe-area aware
js/landmarks.js     the landmark database (coords, tier, clue, fact)
js/levels.js        level table + scoring
js/photos.js        Wikipedia photo lookup, caching and fallbacks
js/map.js           map providers (OpenStreetMap / Google) behind one interface
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
- The clock uses wall time, so backgrounding the tab does not pause a round.
- Tested on a 390×844 and a 360×640 viewport; the quiz layout adapts for short screens.
