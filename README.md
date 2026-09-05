# Landmark Rush

A two-part geo guessing game for mobile web. No build step, no backend, no API key.

**Part 1 — Name the city.** A landmark photo appears with four candidate cities.

**Part 2 — Find it on the map.** Pan and zoom to the landmark, tap to drop a pin and
lock it in before the clock runs out. Level 1 gives you **60 seconds** and accepts a pin
within **200 km**; every level after that shortens the clock and tightens the radius.

## Play it

It is a static site — no build step, no server code.

**On your phone, right now.** Serve the folder from your computer and open it from your
phone on the same Wi-Fi:

```sh
python3 -m http.server 8080        # or: npx http-server . -p 8080
ipconfig getifaddr en0             # macOS; Linux: hostname -I
```

Then browse to `http://<that-address>:8080` on the phone. Opening `index.html` directly
as a `file://` URL will *not* work — the browser blocks the Wikipedia requests that fetch
the photos.

**Put it online (free).** This repo is public, so GitHub Pages costs nothing:

1. Settings → Pages
2. Source: *Deploy from a branch*
3. Branch: `claude/geo-landmark-game-u7jki3` (or `master` once merged), folder `/ (root)`
4. Save, wait a minute, and it is live at `https://dcypang.github.io/test/`

Pages serves from any branch, so you do not have to merge first. Any static host works
just as well — Netlify, Vercel and Cloudflare Pages will all take this folder as-is.

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

Individual players can also switch to **Google Maps** in Settings with a key of their own,
kept in `localStorage` on that device. To power the whole game with Google Maps, see below.

## Powering it with Google Maps

Paste a key into `js/config.js` and the game uses Google Maps for everyone:

```js
window.GEO_CONFIG = { googleMapsKey: 'AIza…' };
```

That is the only code change. The open styles stay available in Settings, and a player's
own key still wins over the deployment key.

**What the key needs**

1. A Google Cloud project with a **billing account** attached. Maps Platform will not serve
   a key without one, even within the free allowance.
2. The **Maps JavaScript API** enabled on that project. That is the only API this game
   calls — no Places, no Geocoding, no Street View.
3. The key **restricted, both ways**, before it goes anywhere public:
   - *Application restriction* → HTTP referrers → `https://dcypang.github.io/test/*`
     (add `http://localhost:*/*` while developing).
   - *API restriction* → Maps JavaScript API only.

A Maps JavaScript key is always visible in the page — that is how the API works. The
referrer restriction, not secrecy, is what stops another site spending your quota. Never
put an unrestricted key in `js/config.js`, and never reuse a server-side key.

**What it costs**

Google bills Dynamic Maps per *map load* — one map initialisation, not one per round. This
game builds the map once per session and reuses it across rounds, so a twenty-round session
is a single map load. (There is a test for that; it is easy to regress.)

Google replaced its old flat monthly credit with per-API free allowances in 2025, and the
Dynamic Maps allowance was in the region of 10,000 loads a month with a few dollars per
thousand after that. **Check the current Maps Platform pricing page rather than trusting
that figure** — it is the number that decides whether a public deployment can surprise you.
Set a budget alert, and cap the daily quota for the Maps JavaScript API (APIs & Services →
Quotas): with a public key, a quota cap is what turns a runaway bill into a map that simply
stops loading.

**Before publishing a Google-powered version**

Google Maps Platform's terms restrict some uses, and geo-guessing games specifically have
historically needed an arrangement with Google rather than running on a plain key. Read the
restrictions in the current Maps Platform Terms of Service before putting a public,
Google-powered version online. The open-tile version raises no such question.

**Is it worth it?** For gameplay, not obviously. Esri satellite imagery is already the best
view for hunting a landmark. Google's real advantages are familiarity and denser labelling
when you are zoomed in close, which starts to matter at level 8 and up where the radius is
under 25 km.

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
js/config.js        deployment settings (optional Google Maps key)
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
