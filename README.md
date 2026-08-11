# Apex & Home

A racing game that doesn't end at the chequered flag: win the race, then drive
the car home through the countryside, a village and your own street — and park
it in the garage.

**[Play it here](https://claude.ai/code/artifact/9aeff0d7-8647-42c4-a15c-09d67a286fa2)**,
or clone the repo and open **`index.html`** in a browser. That's it: no build
step, no server, no dependencies, no network access. Everything — the car, the
circuit, the town, the engine note — is generated procedurally at load time.

Click the page once before driving, so it can hear the keyboard.

## The two halves

**The race.** A 2.4 km road course with eight cars, a standing start behind the
five red lights, kerbs, gravel traps, armco, grandstands and a pit complex.
Three laps by default, live timing, positions and a lap chart.

**The drive home.** One continuous 2.7 km road, driven in one go. You start
parked in the pit lane, roll down past the garages, and instead of rejoining the
circuit the pit exit carries straight on: through the paddock, out under the
circuit gate, and onto the public road. Then a country lane, a village with
working traffic lights and oncoming traffic, a suburban street, and finally the
turn into your own driveway.

The same car, now dusty from the race. There is a satnav, there are speed
limits, and there is a rating out of 100 that notices if you ignore either.
Halfway through the village there is a layby outside the shop — pull in, come
to a stop, and the shopping is on the passenger seat when you get home. It costs
nothing but time. The drive ends when the car is stopped in front of the garage
with the light on.

Two ways to get there: take the chequered flag and press **Drive home** on the
results screen, or **Skip to the drive home** on the title screen.

The circuit and the town are two separate worlds — merging them would mean a
million triangles resident at once, and their coordinates overlap — so the
handover happens as you pass under the gate. The car keeps its speed, gear and
revs across it, and both sides of the gate carry the same stonework and the same
avenue of trees, so there is nothing in shot when the world changes.

## From the driver's seat

The game opens in the cockpit, and the cockpit is the point. You sit behind a
flat-bottomed suede-rimmed wheel with a screen and a shift-light strip in the
hub; the lights come up green, amber, red as the revs climb and flash at the
limiter. Your hands are on the rim at quarter to three and stay there — they
ride round with the wheel, and the forearms are solved back to the elbows each
frame rather than being frozen in one pose.

Around it: a binnacle hood, air vents, a switch panel with flip guards and a
master cut-off, the rear-view mirror, a window net on the driver's door, a
six-point harness, the pedal box and a dead pedal for your left foot.

Your head is not bolted to the chassis. It leans away from the cornering force,
dips under braking, and looks a little way into a corner before the car gets
there. `C` cycles through cockpit, bonnet, chase, far chase and bumper; **View**
on the title screen picks which one you start in.

## On a phone

It plays on a touchscreen. Turn the phone sideways and the game swaps to an
on-screen layout: a round thumbstick for steering under your left thumb, BRAKE
and GO pedals under your right, and a compact HUD that keeps the corners your
thumbs need clear.

Steering is a **360° thumbstick rather than arrow buttons**, deliberately. The
car has speed-sensitive steering and needs small, precise inputs at racing
speed; buttons can only ask for full lock, which just makes the front tyres
slide. The stick floats: put your thumb down anywhere in the bottom-left
quadrant and the ring appears there, so you never have to find a target without
looking. Push it as far left or right as you want lock — the knob is free to
move anywhere in the circle, but it is the sideways component that steers — and
lift off to straighten up.

If pushing right feels like it should turn left, **Stick direction → Inverted**
on the title screen flips it.

Touch devices also get a lighter render preset automatically — no shadows, no
particles, capped resolution.

## Hitting things

The world is solid. Tree trunks, lamp posts, sign posts, traffic light poles,
gate piers, hedges and the walls of every building carry a collider — about
1,950 of them per scene, bucketed into a grid so testing them all every frame
costs nothing. Hedges and fences are soft and mostly just drag at you; a lamp
post is not.

Car-to-car contact is mass weighted with a tangential friction term, and the
yaw it imparts comes from the real lever arm, so a corner hit spins you and a
square one does not. Every impact throws sparks along the contact, debris in
the colour of whatever you hit, a puff of dust if it was a big one, and adds
to the car's damage.

No collider is ever left on a drivable surface. Scenery is laid out relative to
one road at a time, so a fence beside the main route or a wall behind a house
will happily cross a side street — and a wall across a side street is a wall
across a road.

## Controls

| | |
|---|---|
| `W` / `↑` | throttle |
| `S` / `↓` | brake, hold at a standstill for reverse |
| `A` `D` / `←` `→` | steer |
| `Space` | handbrake |
| `Q` / `E` | shift down / up |
| `G` | automatic / manual gearbox |
| `C` | camera (chase, far chase, bonnet, cockpit, bumper) |
| `B` | look behind |
| `L` | headlights |
| `Z` / `X` | indicators |
| `H` | horn |
| `R` | recover to the road |
| `P` / `Esc` | pause |
| `M` | mute |

A gamepad works too: left stick to steer, triggers for throttle and brake,
shoulder buttons to shift.

## How the car is simulated

Not a fudge — a real four-wheel vehicle model, stepped at 240 Hz:

- A simplified Pacejka tyre per wheel, with slip ratio integrated through wheel
  inertia and slip angle from the contact-patch velocity, combined through a
  friction ellipse.
- Longitudinal and lateral load transfer, plus aerodynamic downforce that grows
  with speed, so the car has far more grip at 200 km/h than at 50.
- Load-sensitive grip, so the heavily loaded outside tyre gives up first.
- A real gearbox: torque curve, six ratios, final drive, rev limiter, engine
  braking, and a torque cut on upshifts.
- Optional ABS, traction control and stability control, all switchable.

It behaves the way the numbers say it should: 0–100 km/h in 4.0 s, 100–0 in
27 m, 1.5 g of lateral grip at low speed rising with downforce, 271 km/h flat
out. `scripts/simtest.mjs` asserts all of that.

## Repository layout

    src/            the game, one concern per file
      math.js       vectors, matrices, splines
      gl.js         WebGL2 wrapper: programs, meshes, MSAA render targets
      mesh.js       CPU geometry builder (lofts, primitives, transform stack)
      shaders.js    all GLSL
      physics.js    the vehicle model
      car_model.js  the procedural race car
      world.js      terrain, road network, surface queries, racing line
      props.js      barriers, grandstands, buildings, trees, traffic cars
      scenes.js     the circuit and the route home
      renderer.js   shadow cascades, sky, glass, particles, decals, post
      car.js        a drivable car: physics + visuals + effects
      ai.js         the racing driver and the traffic driver
      audio.js      synthesised engine, tyres, wind — no samples
      hud.js        the canvas overlay, desktop and compact layouts
      touch.js      on-screen driving controls for phones
      ui.js         menus and results
      game.js       input, camera, race logic, the drive home
    build.mjs       bundles src/ into index.html, plus dist/embed.html for
                    hosts that supply their own document shell
    scripts/        headless test harnesses

## Working on it

    node build.mjs              # rebuild index.html from src/
    node scripts/simtest.mjs    # physics + AI assertions, no browser
    node scripts/smoke.mjs      # drive it in headless Chromium, capture shots
    node scripts/mobile.mjs     # emulate a phone and exercise the touch controls
    node scripts/drivehome.mjs  # race to the flag, then drive the whole way home
    node scripts/polycount.mjs  # triangle budget, scene by scene

`simtest.mjs` runs the simulation in plain Node with a stubbed WebGL object, so
handling and AI regressions get caught in seconds without a GPU. It seeds
`Math.random` first: the AI makes deliberate mistakes, and unseeded, one run to
the next varies by ten seconds a lap — far more than most changes to the driver
are worth, so tuning against it measures noise. Seeded, the corner-speed ceiling
could be swept properly: 0.79 of the theoretical limit is the last value that
gains, and by 0.82 the field is 23% off track and four seconds a lap slower.

`drivehome.mjs` is the end-to-end one: it puts an AI driver in the player's seat,
takes the race to the chequered flag, clicks through the results screen, then
drives every leg of the way home — pit lane, paddock exit, across the world
handover at the gate, the full public route, and up the driveway to park. It
exists because the satnav used to count down to zero 35 m short of the house —
the route spline ended at the kerb and the driveway is a separate path — which
left you stranded in the street with the game insisting you had arrived.
