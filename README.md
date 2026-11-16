# Bay Gridlock

A traffic-management game played on the real San Francisco Bay Area freeway network.
Every dot is a commuter driving from home to work and back. Traffic grows 5% a day; you
spend fare and toll money on lanes, freeway upgrades and new roads to keep it moving.
If commuter mood reaches zero you are recalled.

## Play

Open `index.html` in a browser. It is a single self-contained file (no server, no build
step needed to play). Works with touch (drag to pan, pinch to zoom) and mouse.

- **Tap a road** to see its speed and load in each direction, then add a lane each way,
  rebuild a surface road as a freeway, or set a bridge toll.
- **Build road** joins any two junctions with a straight new road. Stretches over water
  are priced as a bridge.
- The yellow **Bottleneck** tab jumps to the worst jam. A road that is "over capacity"
  needs lanes; one that is "backed up from the road ahead" needs the jam downstream fixed.
- Keys: space pause, 1-3 speed, B build, Esc cancel, +/- zoom.

The game saves to the browser's local storage at the end of each day and after each purchase.

## How it works

- `src/sim.js` is the simulation, with no DOM dependencies. Each road segment lets out
  `lanes x flow` cars a minute and stores a limited number of cars, so queues form on the
  narrow road and spill back upstream. Drivers re-route every few minutes on live travel
  times. Trips come from a gravity model over 65 cities and gateways, rebuilt nightly, so
  a new crossing induces new trips.
- `src/game.js` draws the map on a canvas and handles input and the HUD.
- `src/page.html` is the markup and styles.
- `src/map-data.js` is generated: 317 junctions, 363 road segments, 8 named bridges.

## Rebuild

```sh
python3 tools/bundle.py              # src/ -> index.html
node tools/simtest.js 20 widen       # headless balance run (20 days, auto-widening player)
```

To regenerate the map (`pip install pyshp`), download `ne_10m_roads_north_america.{shp,dbf,shx}`
from Natural Earth as `rna.*` and `california-counties.geojson` as `cacounties.geojson` into
one folder, then:

```sh
python3 tools/build_map.py <folder> src/map-data.js
```

## Data

Road geometry: [Natural Earth](https://www.naturalearthdata.com/) North America roads, public domain.
Shoreline: California county outlines derived from US Census cartographic boundary files.
City populations, job counts and lane counts are rough game values, not survey data.
