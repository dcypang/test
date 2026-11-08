# SimSaratoga

A SimCity-style city planning game set in **Saratoga, California**. You are the town's planning
director: rezone land, decide on development projects, balance the budget and meet the state's
housing target, on a map built from Saratoga's real streets and building footprints.

## Play

Open `index.html` through any static web server:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

No build step and no dependencies. The game saves to your browser's local storage.

### Controls

| Action | How |
| --- | --- |
| Pan | Drag with the Inspect tool, right-drag, or hold Space and drag |
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
| `js/render.js` | Canvas renderer and overlays (zoning, vacant lots, street access, fire coverage) |
| `js/ui.js` | Tools, input, inspector, Planning Commission and budget panels |
| `js/main.js` | Boot, main loop, persistence |
| `tools/fetch_osm.py` | OpenStreetMap → `data/saratoga.js` |
| `tools/make_fallback_map.py` | Approximate offline map |
