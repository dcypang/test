# Find the Hidden Treasure — 3D 🏆

A web 3D treasure-hunt game starring the red-faced treasure hunter king — with his
golden crown, big googly magnifier eye, round black ears, yellow belly with a diamond
emblem, blue arms and legs, and a magic star wand — based on the original hand-drawn
"Find the hidden treasure" map.

## How to play

**Just open `index.html` in a web browser** (double-click it). Everything runs locally —
no internet or server needed.

- **Move:** WASD or arrow keys (on phones/tablets: on-screen joystick)
- **Jump:** Space (or the JUMP button)
- **Dig:** walk onto a purple ❌ mark, then press **E** (or the DIG button)
- **Camera:** drag with the mouse or a finger to orbit around the hero (or **Z** / **C** keys)

Your mission: explore the world, collect the ⭐ spinning stars, and dig up the ❌ spots.
One of them hides the real treasure chest — the rest are worms, old boots, and rusty
spoons! The treasure moves to a random spot every game.

## The world

Everything from the drawing is in there:

- 🌈 Rainbow cave portals in the corners
- 💧 The squiggly blue lake on its yellow patch
- ❓ Floating golden question blocks
- 🏰 The purple-towered castle on a hill
- 🍭 Colorful swirl lollipops in the snowy zone
- ➡️ Arrow signposts, pine trees, and the red wavy sky ribbon

## Tech

Plain HTML + JavaScript with [Three.js](https://threejs.org/) (vendored in
`vendor/three.global.js`, converted from the official `three@0.160.0` module build so
the game works from a plain `file://` double-click). No build step, no dependencies.

- `index.html` — page, HUD, and touch controls
- `game.js` — the character, the world, and the game logic
