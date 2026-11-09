# SimSaratoga

A SimCity-style city planning game set in **Saratoga, California**. You are the town's planning
director: rezone land, decide on development projects, balance the budget and meet the state's
housing target, on a map built from Saratoga's real streets and building footprints.

The city is shown in **3D**:

- **Buildings**: every footprint is extruded to its number of stories. Homes get gable or hip roofs
  with eaves, chimneys, front doors, garage doors, windows and the occasional solar array. Shops
  get storefront glass, awnings on the street side, parapets and rooftop units. Sites under
  construction rise month by month, with a tower crane on the taller ones.
- **Streets**: asphalt with sidewalks, centre lines and lane dashes, streetlights on the main
  roads, and traffic that drives on the right, from Highway 85 down to residential streets.
- **Landscape**: foothills that continue to the horizon, a painted ground with lawns, driveways,
  orchard rows and creeks, and about 60,000 trees (broadleaf, pine and redwood) that sway in the
  wind and follow the seasons: blossom in spring, golden hills in late summer, fall colour, bare
  branches in winter.
- **Sky and light**: a shader sky with drifting clouds and a sun, soft shadows, and four times of
  day. At sunset and night, windows, streetlights and headlights come on and stars come out.
- **Camera**: orbit, tilt and zoom from a regional overview down to street level.

A flat 2D map is one click away.

## Play

Open `index.html` through any static web server:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

No build step and no dependencies. The game saves to your browser's local storage.

The 3D view needs WebGL and falls back to the flat map without it. Graphics quality adapts to the
device: if frames get slow it lowers the resolution, then turns off shadows, then stops the
ambient animation. You can pin it from the menu (☰ → 3D graphics) or with `?gfx=high` or
`?gfx=low` in the URL.

### Controls

| Action | How |
| --- | --- |
| Pan | Drag with the Inspect tool, middle-drag, or hold Space and drag |
| Rotate / tilt (3D) | Right-drag or Shift-drag, `Q`/`E` and `R`/`F`, two-finger twist, or the buttons on the right |
| Time of day (3D) | `T` or the ☀️ button: afternoon, sunset, night, morning |
| Circle the camera (3D) | `C` or the 🎥 button |
| Switch 3D / 2D | `V` or the 2D/3D button |
| Zoom | Mouse wheel, pinch, or `+` / `-` |
| Inspect | Click a building, street or lot |
| Pause / resume | Space |
| Zoning overlay | `Z` |
| Zoning brush size | `[` and `]` |

### What you can do

- **Zone** land with Saratoga's district names: HR (Hillside Residential), R-1-40,000 down to
  R-1-10,000, R-M, MU (Housing Element mixed-use sites), C-N, C-H (the Village on Big Basin Way),
  PF and OS.
- **File private projects**: ADUs, SB 9 duplexes, homes, townhomes, apartments, mixed-use and shops.
  Each is checked against zoning (allowed use, height, site clearance, street access). Projects
  that meet the code can be approved automatically; the rest need a variance and come to you.
- **Build city facilities**: parks, fire stations, libraries, community centers and streets.
- **Bulldoze** buildings (the city has to buy them first) and road segments.
- **Ask voters for a parcel tax**, which needs a two-thirds vote.

### What the simulation tracks

- **Housing Element / RHNA**: Saratoga's 2023–2031 target of 1,712 homes. Fall too far behind and
  the state finds the city out of compliance, which lets *builder's remedy* projects bypass local
  zoning.
- **State housing law**: ADUs and SB 9 projects must be approved ministerially. Denying them brings
  warnings and penalties.
- **Budget**: the city's share of the 1% property tax (Prop 13), sales tax and fees, against the
  county sheriff contract, street maintenance, parks and administration.
- **Approval rating**: budget, parks, traffic, fire protection in the foothills, the pace of change
  to the town's character, and housing-law compliance.
- **Growth**: developers file projects on vacant, road-adjacent lots and redevelop older buildings
  in up-zoned districts. Construction takes months.

## Map data

The game reads its map from `data/saratoga.js`.

```sh
python3 tools/fetch_osm.py           # download Saratoga from OpenStreetMap and compile it
python3 tools/fetch_osm.py --cached  # recompile from data/raw_osm.json
python3 tools/make_fallback_map.py   # approximate stand-in map, no network needed
```

`fetch_osm.py` uses the Overpass API to download every building footprint, street, park, creek
and named place within the city limits plus a 300 m margin. It then compiles them into local metre
coordinates. Only the Python standard library is needed. Buildings keep their OSM type, levels,
name and address, so clicking a house shows its real street address where OSM has one.

**The bundled `data/saratoga.js` may be the approximate stand-in.** The game's welcome screen
says which map is loaded. The stand-in places the real arterials (Saratoga-Sunnyvale Road, Big
Basin Way, Saratoga-Los Gatos Road, Saratoga Avenue, Prospect, Cox, Quito, Fruitvale, Pierce, Highway 85),
landmarks (the Village, Hakone Gardens, Montalvo, the Mountain Winery, West Valley College,
Saratoga High) and the density pattern from flat valley lots to big hillside parcels. Local
streets and houses in it are generated, so it is not building-for-building accurate. Run
`fetch_osm.py` on a machine that can reach `overpass-api.de` to get the real map.

### Accuracy notes

- **Terrain is approximate.** OpenStreetMap has no elevations, so the 3D view uses a modeled
  surface: a gently sloping valley floor in the north-east and foothills rising south-west of a
  line from Prospect Road past the Village toward Montalvo (`World.buildTerrain` in `js/world.js`).
- **Building heights** come from OSM `building:levels` where mapped; otherwise from the building
  type and size. Roof shapes, windows, doors, colours, trees, traffic and streetlights are
  generated to look plausible. They are decoration, not survey data.

- **Building footprints and streets** are as accurate as OpenStreetMap's coverage of Saratoga.
- **Zoning is inferred**, not copied from the official zoning map. Each 20 m cell gets a district
  from what is built around it: lot size estimated from house density, commercial and apartment
  buildings, schools, parks and empty hillsides. District rules (minimum lot, density, height,
  coverage) are simplified for play. Don't use this for a real project; check the Saratoga
  Municipal Code.
- Budget and growth numbers are tuned to make a playable game, roughly to Saratoga's scale (about
  31,000 residents and 11,000 homes).

Map data © OpenStreetMap contributors, available under the Open Database License.

## Code layout

| File | Purpose |
| --- | --- |
| `index.html`, `css/style.css` | Page layout and styles |
| `js/rules.js` | Zoning districts, building types, buildable projects, economy constants |
| `js/world.js` | Map loading, spatial indexes, zoning grid inference, building placement |
| `js/sim.js` | Monthly simulation: growth, applications, budget, approval, housing law, save/load |
| `js/render3d.js` | 3D renderer (three.js): terrain and horizon, buildings and their details, streets, traffic, trees, sky, time of day, labels |
| `js/render.js` | Flat 2D map renderer and the overlays (zoning, vacant lots, street access, fire coverage) |
| `js/vendor/three.min.js` | three.js r149 (MIT), bundled so the game works offline |
| `js/ui.js` | Tools, input, inspector, Planning Commission and budget panels |
| `js/main.js` | Boot, main loop, persistence |
| `tools/fetch_osm.py` | OpenStreetMap → `data/saratoga.js` |
| `tools/make_fallback_map.py` | Approximate offline map |
