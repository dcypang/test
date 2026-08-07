# Find the Hidden Treasure — Voxel Adventure 🏆

A blocky, Minecraft-style 3D web game starring the red-faced treasure hunter king —
with his golden crown, big googly magnifier eye, black ears, yellow belly with a
diamond emblem, blue arms and legs, and a magic star wand — based on the original
hand-drawn "Find the hidden treasure" map.

## How to play

**Just open `index.html` in a web browser** (double-click it). Everything runs locally —
no internet or server needed.

- **Move:** WASD or arrow keys (on phones/tablets: on-screen joystick)
- **Jump:** Space (or the JUMP button)
- **Dig:** walk onto a ❌ mark, then press **E** (or the DIG button)
- **Camera:** drag with the mouse or a finger to orbit around the hero (or **Z** / **C** keys)

Your mission: explore the world, collect the ⭐ spinning star blocks, and dig up the ❌
spots. One of them hides the real treasure chest — the rest are worms, old boots, and
rusty spoons! The treasure moves to a random spot every game.

Digging up the treasure summons its guardian, the **Giant Hand Girl**. You each get
three hearts: dodge the shadow squares where her giant hands are about to slam, then
bonk a hand with the star wand while it rests on the ground. Three bonks and she gives
up the treasure — but if her hands catch you three times, it's game over.

## The world

Everything from the drawing, rebuilt out of blocks:

- 🌈 Rainbow cave portals in opposite corners — walk in to teleport across the map
- 💧 The blobby blue lake on its sandy shore
- ❓ Floating question blocks — jump and bonk them from below for hidden stars
- 🏰 A huge stone-brick castle with cobblestone battlements, corner towers and spires,
  a throne hall, two staircases, a second floor, and a walkable rooftop with a banner.
  The walls turn to glass while you're inside so the camera can see. Pulsing golden
  arrows mark the route in both directions: gate → stairs by the left wall → upper
  floor → far stairs → rooftop, and back down again. Railings keep you from falling
  off the upper floor.
- 🍭 Candy lollipops in the snow biome
- 🌲 Blocky trees, signposts, sand paths, and snow

## Tech

Plain HTML + JavaScript with [Three.js](https://threejs.org/) (vendored in
`vendor/three.global.js`, converted from the official `three@0.160.0` module build so
the game works from a plain `file://` double-click). No build step, no dependencies,
no image files.

The voxel look is generated entirely in code:

- **Texture atlas** — every block texture is drawn pixel by pixel into one 16×16-per-tile
  canvas atlas at load time (grass, dirt, cobble, stone brick, logs, leaves, wool,
  gold, portal, faces…), sampled with `NearestFilter` so it stays crisp and pixelated.
- **Per-block-type geometry** — a `BoxGeometry` per top/side/bottom texture combination,
  with its UVs remapped into the atlas, so grass blocks show grass on top, dirt
  underneath, and a grassy edge on the sides.
- **Instanced rendering** — every block of a given type is drawn in a single
  `InstancedMesh` draw call.
- **Flat ground is tiled planes, not cubes.** With one texture tile per world block it
  looks identical from above but costs a handful of triangles instead of ~23,000 cubes,
  which is what keeps it smooth on phones. Anything with height is a real block.

Files:

- `index.html` — page, blocky HUD, and touch controls
- `game.js` — texture atlas, world builder, characters, and game logic
