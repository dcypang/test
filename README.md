# Pacific Charter

A charter-flying simulator on a world aeronautical chart. You fly one aircraft out of
**San Francisco**, pick up people who are waiting in terminals anywhere on the planet, and
get them where they are going. Everything runs in a browser with no network access at all.

Open `index.html` — that is the whole game.

## What is in it

- **A GPS chart of the entire world.** Real coastlines and borders from Natural Earth,
  drawn on an equirectangular projection you can pan and zoom without seams at the date
  line. Live readout of latitude and longitude in degrees and decimal minutes, track,
  ground speed, altitude, distance to go and time enroute.
- **88 airports across every continent**, from Heathrow and Haneda down to Longyearbyen,
  Ushuaia and Papeete.
- **People with somewhere to be.** Every terminal generates passengers who each want to
  reach a specific field by a specific time, with a reason for the trip and a fare. The
  Demand tab ranks where the world is trying to get to, and the Demand overlay draws each
  waiting party as a thread from where they are to where they want to be.
- **Flying that behaves.** Great-circle routing, a climb and descent profile, a jet-stream
  model that gives you a tailwind eastbound and costs you westbound, fuel burn, reserve
  fuel, refuelling costs that rise at remote fields, and landing fees.
- **A day/night terminator** computed from the simulated date and time, so you can watch
  yourself fly into the dark.

Fourteen seats, roughly 7,500 nm on full tanks. Consolidating a cabin full of people going
the same direction is what makes money; a near-empty long haul loses it. The longest pairs
(San Francisco to Johannesburg, say) need a fuel stop, exactly as they would in reality.

## Controls

| Action | How |
| --- | --- |
| Pan / zoom the chart | Drag, scroll |
| Plan a leg | Click any airport |
| Board a passenger | Terminal tab → Board |
| See a passenger's route | Hover their card, or press Chart |
| Follow the aircraft / fit the world | `F` / `W` |
| Demand threads, range ring | `D` / `R` |
| Time acceleration | `1`–`5`, up to 1200× |

Progress saves to `localStorage` automatically.

## Building

`index.html` is generated. The source lives in `src/app.html`, with the world geometry,
airport table and typefaces folded in at build time so the published page makes no network
requests:

```
python3 tools/build.py            # src/app.html + data/ + assets/ -> index.html
```

To regenerate the coastline data from the vendored TopoJSON:

```
python3 tools/extract_world.py vendor/countries-110m.json data/world.json
```

That decodes the delta-encoded, quantized TopoJSON into flat `[lon, lat, ...]` rings
rounded to two decimals — 285 rings, about 10,600 points, 132 KB.

## Layout

```
src/app.html            the application: markup, styles and simulation
data/world.json         coastlines and borders, extracted from Natural Earth 110m
data/airports.json      88 airports with position, region and hub weight
assets/fonts/           Barlow, Barlow Condensed, IBM Plex Mono (subset woff2)
tools/build.py          inlines data and fonts into index.html
tools/extract_world.py  TopoJSON -> compact lon/lat rings
vendor/                 upstream countries-110m.json, unmodified
index.html              generated, self-contained, ~338 KB
```

## Design notes

The interface is drawn after a printed sectional chart: paper ground, tan land against
chart blue water, magenta for courses and for anything a person can act on, and a
condensed grotesque for labels with a monospace face for every number. The dark theme is
the same chart under an electronic flight bag's night mode rather than an inversion. The
chart follows the viewer's system theme and can be switched by hand.

Coastlines, graticule and terminator are painted once into an offscreen canvas and blitted
each frame, so the map holds 60 fps even with several hundred demand threads drawn.

## Credits

World geometry from [Natural Earth](https://www.naturalearthdata.com/) via the
[world-atlas](https://github.com/topojson/world-atlas) package (public domain). Barlow and
Barlow Condensed by Jeremy Tribby, IBM Plex Mono by IBM — both under the SIL Open Font
License; see `assets/fonts/`.
