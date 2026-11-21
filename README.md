# Solano Heat

An original open-world crime/driving sandbox that runs in the browser with three.js (WebGL2), tuned for iPhone (17 Pro class) with touch controls.

Sunset coastal city: 144 city blocks with two skyline clusters, a wide west-facing beach, a 14 m elevated freeway looping the whole city on pillars (with ramps down to the port and the airport), Solano International airport (runway, terminal, jet bridges, an airliner that takes off, circles the city and lands), the Port of Solano (container yard, gantry cranes, moored cargo ships, piers, boats, lighthouse), 14 walk-in shops, a home (villa with pool, bed to sleep through the night, closet, kitchen), parking lots with cars to take, a resort island (Isla Verde) reachable by plane, a multi-section airport (check-in, security, café, gate lounge) where you buy boarding passes and fly, traffic on the streets and the freeway, pedestrians, police pursuits with on-ramp chasing, delivery jobs, cash pickups and stunt ramps.

## Play

Open `index.html` in Safari (or any modern browser). Landscape works best on a phone.

| | Touch | Keyboard |
|---|---|---|
| Move / drive | Left thumb (stick) | WASD / arrows |
| Look | Drag right side | Mouse (click to lock) |
| Get in / out (carjack) | GET IN | F |
| Jump / handbrake drift | JUMP / DRIFT | Space |
| Sprint | Push stick to the edge | Shift |
| Horn, radio | HORN, RADIO | H, R |
| Full map (pan, zoom, tap to set a waypoint) | Tap the minimap | M |
| Enter a shop or the airport terminal | Walk through a lit doorway | same |
| Fly: buy a boarding pass at check-in, go through security, walk into gate B2 | LAND skips ahead | F skips ahead |
| Go home | Map → Home sets a waypoint | same |
| Pause (quality, time of day, sound) | II button | Esc |

## Graphics

- PBR materials with image-based lighting from a physically based sky, ACES tone mapping
- Dynamic day/night cycle (16 min per day), moon, stars, night sky dome
- 4096 px sun/moon shadows that follow the camera (texel-snapped)
- HDR bloom, 4x MSAA, clear-coat car paint, procedural glass curtain walls
- Ocean with analytic shoreline depth, multi-wave normals, foam
- Wind-swayed palm fronds, tire smoke, street-light pools at night
- Quality presets (Ultra / High / Balanced) plus automatic resolution scaling to hold 60 fps

## Files

- `solano-heat.html`: the game (page body, used for the hosted artifact)
- `index.html`: standalone build, generated with `python3 build.py solano-heat.html index.html`
