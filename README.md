# Gildmarch

An original real-time strategy game for the browser: a medieval world played
with a command sidebar. No build step, no dependencies, no image or audio
files — open `index.html` and play.

## Run it

Open `index.html` in any modern browser (double-clicking the file works), or
serve the folder:

```bash
python3 -m http.server 8000
```

Add `?auto=1` to skip the menu. Other switches, mostly for testing:
`demo=1` (computer vs computer), `reveal=1` (no fog), `speed=4`, `seed=42`,
`diff=easy|normal|hard`.

## The idea

The brief was a medieval empire-builder that plays like a sidebar-driven
base-builder. The two genres are blended like this:

| From the medieval empire-builder | From the sidebar base-builder |
| --- | --- |
| Setting, troop types and counters (spear beats rider, rider beats archer, engines beat walls) | Everything is built from a sidebar with one queue per tab; finished buildings are placed by hand |
| Three ages that unlock the tech tree | One resource, hauled by automated carts from ore fields to a refinery building |
| Windmills and grain | Grain works as a power grid: fall short and production halves, powered towers and the minimap go dark |
| Healers, siege engines that must settle before firing | Buildings must be placed near your own; sell and repair modes; rally points; veterancy |
| | A scouting power and a superweapon with a countdown both sides can see |
| | Capturing buildings with an engineer unit; a wagon that unpacks into a new base |

## About assets

Both source games are commercial products whose art, audio, names and maps
are proprietary, so none of it is used here. Everything in this repository is
original:

- **Art** is drawn procedurally with canvas paths and cached as sprites.
  `js/art.js` builds thirteen buildings from textured isometric solids
  (stone courses, planks, shingles, thatch), replays the same geometry to
  cast a soft shadow for each, and draws fourteen outlined, shaded units,
  five tree species and the particle sprites. `js/terrain.js` paints the
  ground in cached chunks with blended borders, water depth, shore foam,
  animated glints and drifting cloud shadows.
- **Sound and music** are synthesised with Web Audio in `js/audio.js`.
- **Names, numbers and maps** are this project's own; maps are generated
  from a seed and are mirror-symmetric for fairness.

## Controls

| | Mouse | Touch |
| --- | --- | --- |
| Select | Click, or drag a box | Tap; use **Box** then drag |
| Order (move / attack / gather / rally) | Right-click | Tap the target |
| Scroll | Arrow keys, screen edges, middle-drag | Drag |
| Zoom | Wheel | Pinch |
| Cancel a queued item | Right-click its icon | Long-press its icon |

Keys: `Q W E R` tabs · `A` attack-move · `S` stop · `D` unpack wagon ·
`K` repair · `Z` sell · `H` home · `Space` last alert · `Ctrl+1…9` set group,
`1…9` recall · `Ctrl+A` whole army · `P` pause · `M` music.
Shift-click a troop icon to queue five; shift-click when placing to queue
another of the same building.

## Layout

```
index.html        page shell and menus
css/style.css     sidebar and overlay styling (portrait layout included)
js/util.js        constants and helpers
js/data.js        ages, damage table, building and unit definitions
js/map.js         map generation and A* pathfinding
js/art.js         procedural sprites: buildings, units, trees, particles
js/terrain.js     blended ground, water and cloud shadows
js/audio.js       synthesised effects and music
js/game.js        simulation: economy, queues, movement, combat, fog
js/ai.js          computer opponent
js/render.js      isometric renderer and minimap
js/ui.js          input, selection, orders, sidebar
js/main.js        boot, menus, main loop
```

The computer opponent uses the same queues, costs and rules as the player.
Difficulty scales its income, build speed and patience.
