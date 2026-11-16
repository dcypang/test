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
- **Sky and light**: a shader sky with drifting clouds and a sun, and four times of day. At
  sunset and night, windows, streetlights and headlights come on and stars come out.
- **Rendering**: physically based materials lit by the sky, so glass, cars and water reflect it;
  soft sun shadows and ambient occlusion; bloom on lights; depth of field; atmospheric haze; and
  filmic tone mapping. Shingles, stucco, asphalt and grass detail is generated in the shaders.
- **Photo mode**: hides the interface and narrows the focus for a miniature look, with a button
  to save the picture.
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
device: if frames get slow it lowers the resolution, then turns off shadows, ambient occlusion
and depth of field, then stops the ambient animation. The full effects need WebGL2; older
browsers get a simpler lighting path. You can pin it from the menu (☰ → 3D graphics) or with `?gfx=high` or
`?gfx=low` in the URL.

### Controls

| Action | How |
| --- | --- |
| Pan | Drag with the Inspect tool, middle-drag, or hold Space and drag |
| Rotate / tilt (3D) | Right-drag or Shift-drag, `Q`/`E` and `R`/`F`, two-finger twist, or the buttons on the right |
| Time of day (3D) | `T` or the ☀️ button: afternoon, sunset, night, morning |
| Circle the camera (3D) | `C` or the 🎥 button |
| Photo mode (3D) | `P` or the 📷 button; 💾 saves a PNG; `Esc` leaves |
| Switch 3D / 2D | `V` or the 2D/3D button |
| Zoom | Mouse wheel, pinch, or `+` / `-` |
| Inspect | Click a building, street or lot |
| Pause / resume | Space |
| Zoning overlay | `Z` |
| Zoning brush size | `[` and `]` |

### What you can do

- **Build roads**: pick Street, Avenue, Boulevard or Highway. Click to place points and the road
  curves through them; click the last point again, press Enter, or connect into an existing road
  to finish. A single press-drag-release draws a straight road. Every new road gets a name
  ("Madrone Court", "Via del Sol", "Foothill Expressway"); a road that extends an existing one of
  the same type keeps its name. Click a road to rename it. Roads through buildings buy and
  demolish them, after asking. Highways carry traffic, but nothing can be built facing them.
- **Put homes and apartments where you want them**: paint a zone along a street (HR or R-1 for
  houses, R-M or MU for apartments and townhomes). Developers build on land you've just zoned or
  opened with a new road first, so a new street fills in over the following months. Or place a
  building yourself: the preview is green when zoning allows it (it starts right away), amber
  when it needs a variance (it goes to the Planning Commission), red when it can't go there.
- **Grow the city**: the map extends about 3 km past the city limits on every side. Painting a
  zone outside the limits annexes that land (with a fee) and makes it buildable.

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

The game reads its map from `data/saratoga.js`, which is built from real data:

- **Streets, parks, creeks, schools and landmarks** come from OpenStreetMap: all of Saratoga's
  1,024 named streets (Big Basin Way, Beaumont Avenue, Saratoga-Sunnyvale Road and the rest),
  plus a 300 m margin around the city limits.
- **Buildings** come from OpenStreetMap where it has them (about 7,500 inside the city). Where it
  doesn't, which is large parts of south Saratoga, the gaps are filled from Microsoft's Global ML
  Building Footprints, traced from aerial imagery (about 4,900 more). That gives 12,400 buildings
  inside the city limits; the inspector says which source each one came from.

To rebuild it:

```sh
python3 tools/fetch_osm.py --api --ms   # OSM main API in tiles + Microsoft footprints, then compile
python3 tools/fetch_osm.py --ms         # same, but download OSM through the Overpass API
python3 tools/fetch_osm.py --cached --ms  # recompile from the cached downloads
python3 tools/make_fallback_map.py      # approximate stand-in map, no network needed
```

Only the Python standard library is needed. Downloads are cached in `data/osm_tiles/`,
`data/ms_tiles/` and `data/raw_osm.json` (all ignored by git). Microsoft footprints are skipped
wherever they overlap an OpenStreetMap building, so nothing is counted twice; their measured
heights set the number of stories. Buildings keep their OSM type, levels, name and address where
mapped. Most homes in OSM have no house number, so the inspector shows the street they face.

### Accuracy notes

- **Terrain is approximate.** OpenStreetMap has no elevations, so the 3D view uses a modeled
  surface: a gently sloping valley floor in the north-east and foothills rising south-west of a
  line from Prospect Road past the Village toward Montalvo (`World.buildTerrain` in `js/world.js`).
- **Building heights** come from OSM `building:levels` where mapped; otherwise from the building
  type and size. Roof shapes, windows, doors, colours, trees, traffic and streetlights are
  generated to look plausible. They are decoration, not survey data.

- **Streets** are as complete as OpenStreetMap, which is very good for US streets.
- **Buildings**: after merging both sources, about 11% of residential street length in the city
  still has no building within 45 m. Spot checks put these in the hills, where homes sit far back
  on long private drives, and along campus and park roads, rather than missing data. A home built
  or torn down after the imagery was taken may still be missing or present.
- **Outside the 300 m margin** the world is open land for expansion; the real neighbouring towns
  are not included.
- **Zoning is inferred**, not copied from the official zoning map. Each 20 m cell gets a district
  from what is built around it: lot size estimated from house density, commercial and apartment
  buildings, schools, parks and empty hillsides. District rules (minimum lot, density, height,
  coverage) are simplified for play. Don't use this for a real project; check the Saratoga
  Municipal Code.
- Budget and growth numbers are tuned to make a playable game, roughly to Saratoga's scale (about
  31,000 residents and 11,000 homes).

Map data © OpenStreetMap contributors, available under the Open Database License. Building
footprints in the gaps are from Microsoft Global ML Building Footprints, also under the ODbL.

## Code layout

| File | Purpose |
| --- | --- |
| `index.html`, `css/style.css` | Page layout and styles |
| `js/rules.js` | Zoning districts, building types, buildable projects, economy constants |
| `js/world.js` | Map loading, spatial indexes, zoning grid inference, building placement |
| `js/sim.js` | Monthly simulation: growth, applications, budget, approval, housing law, save/load |
| `js/post3d.js` | Screen-space finish for the 3D view: ambient occlusion, depth of field, haze, bloom, tone mapping |
| `js/render3d.js` | 3D renderer (three.js): terrain and horizon, buildings and their details, streets, traffic, trees, sky, time of day, labels |
| `js/render.js` | Flat 2D map renderer and the overlays (zoning, vacant lots, street access, fire coverage) |
| `js/vendor/three.min.js` | three.js r149 (MIT), bundled so the game works offline |
| `js/ui.js` | Tools, input, inspector, Planning Commission and budget panels |
| `js/main.js` | Boot, main loop, persistence |
| `tools/fetch_osm.py` | OpenStreetMap (+ Microsoft footprints) → `data/saratoga.js` |
| `tools/make_fallback_map.py` | Approximate offline map |
