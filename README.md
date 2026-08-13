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

## Eight states, and going wherever you like

The world is a country: **eight states**, four across and two down, 5,600 by
2,600 metres of continuous ground. Redrock is dry and nearly bare, Pinecrest is
forest, Lakeshore runs cold and blue, Goldfield is yellow stubble. Each has its
own ground colour, its own tree density, its own town and its own petrol
station and shop.

They are not separate places you get taken to. It is one world with one road
network, so a state line is just a sign you drive past — the ground colour
changes, the HUD names the new state, and nothing loads. Two interstates run
the length of the country and two routes cross it, with a slip road into every
town, so from your own driveway you can reach any of the eight without leaving
the tarmac.

Ashcombe is the capital and much the biggest: **twelve avenues and ten cross
streets** over about 1,150 by 840 metres, with buildings lining every frontage.
The others run from proper towns down to a few blocks at an interstate
junction, because eight identical grids would be eight of the same place.

No grid is a lattice: streets bow by a few metres and the spacing varies block
to block, because a perfect grid reads as a spreadsheet from inside the car and
every junction looks like the last one.

**You do not have to follow the satnav.** Every street connects, so you can turn
off the route wherever you like, drive around, and rejoin anywhere. While you
are away the game says **FREE ROAM** and stops scoring you — off the route its
zone is not the road you are on, its centreline is not your lane, and the
distance left along it is not how far you are from home, so none of that
bookkeeping means anything. The satnav becomes a compass pointing at the house.
Come back to the route and the turn-by-turn picks up where it left off.

The minimap draws the whole network, not just the route. Free roam without a map
is just getting lost.

## The GPS

`Tab` — or the map button on a phone — puts the whole country on screen: every
state as a block in its own colour with its name across it, the one you are in
picked out, the whole road network, and all **24 destinations** — **home**, the
**other house**, thirteen named **shops**, and **nine petrol stations**, at
least one of each in every state. Pick one with `A` / `D` and `Enter`, or by tapping the pin, and the satnav switches from
turn-by-turn to a bearing and a distance — there is no sensible instruction to
give for an arbitrary corner of a street grid, and a compass is what a car has
always had. Stop inside the arrival radius and it says so; stop on a forecourt
and the tank is full. Choosing home puts the drive back the way it was.

Destinations are not placed by hand. Each one scans candidate frontages around
its own town and takes the first that clears everything already placed, home and
the village shop included, so nothing lands on top of anything else. The
labels are then laid out against measured boxes: each name tries a ring of
positions and takes the first clear of every pin and label already down, with a
leader line back to its pin when it had to move sideways. Two pins a street
apart are one pin at map scale, and a map where half the names sit on top of
each other is no better than no map.

Two ways to get there: take the chequered flag and press **Drive home** on the
results screen, or **Skip to the drive home** on the title screen.

The circuit and the country are two separate worlds — together they are over
two and a half million triangles, and their coordinates overlap — so the
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

On the drive home the right-hand column adds indicators, horn, lights and the
GPS. Opening the map clears the stick and pedals out of the way but keeps the
map button on screen — a map you cannot close is a map that has taken the car
off you — and picking a destination closes it for you.

Touch devices also get a lighter render preset automatically — no shadows, no
particles, capped resolution.

## Hitting things

The world is solid. Tree trunks, lamp posts, sign posts, traffic light poles,
gate piers, hedges and the walls of every building carry a collider — about
42,000 of them across the country, bucketed into a grid so testing them all
every frame costs nothing. Hedges and fences are soft and mostly just drag at you; a lamp
post is not.

Two test scripts cover this from opposite ends. `scripts/solid.mjs` is
geometric rather than behavioural: it walks the perimeter of all 1,700-odd
buildings looking for a gap wider than the car, walks every road checking the
lane is not pinched by scenery, checks the collider index returns what it is
asked for, and checks home can actually be parked at. `scripts/drivehome.mjs`
then rams 25 buildings from 8 headings each at 200 km/h and 60/20/10 fps, which
is the part that proves the resolver uses what the audit found.

A building is not one collider at its centre. Each one is ringed with colliders
around its actual footprint, taken from the mesh bounds and rotated with it, so
a house is solid from every side rather than only head-on — driving at a shop
from the side used to put you through the wall and out the back.

Contact is swept, not sampled. At 270 km/h and a bad frame rate the car moves
several metres between updates, which is enough to pass clean through a lamp
post if you only test where it ended up; instead the step is solved for first
contact against each collider — a quadratic in how far along the step the
swept circle first touches — and the car is put back to that point. Tested
clean up to 271 km/h at 10 fps.

Car-to-car contact is mass weighted with a tangential friction term, and the
yaw it imparts comes from the real lever arm, so a corner hit spins you and a
square one does not. Every impact throws sparks along the contact, debris in
the colour of whatever you hit, a puff of dust if it was a big one, and adds
to the car's damage.

No collider is ever left on a drivable surface. Scenery is laid out relative to
one road at a time, so a fence beside the main route or a wall behind a house
will happily cross a side street — and a wall across a side street is a wall
across a road.

## Drawing a city

The static world is split into spatial chunks with bounding spheres, and only
what the camera can see is submitted. One mesh for a whole city is one draw call
that cannot be culled: every building behind you is transformed, twice, before
the depth test discovers it was never visible. Chunked, a typical frame in
Ashcombe draws about a third of the props. There is a distance cut as well —
beyond the fog there is nothing to see, so there is nothing to draw, and touch
devices cut it closer still.

    node scripts/polycount.mjs    triangle budget and chunk count, scene by scene

## How the steering feels

The steering is tuned as an arcade mobile racer's, not a simulator's, and the
targets that define that are written down in `scripts/steerlib.mjs` rather than
carried around in someone's head. On a phone you have one thumb, no force
feedback, and no way to feel the rear stepping out until it has gone — so the
car turns in promptly, answers in proportion to how far you push, holds on
rather than snaps, and straightens itself when you let go.

The single change that mattered most: **full lock is sized against the grip
available at the current speed** rather than being a fixed angle that tapers.
Past the grip limit more steering only scrubs, so a fixed rack throws away most
of the stick's travel as speed rises. At 120 km/h the car had nine times more
lock than the front tyres could use, which meant a quarter of a stick was
already at the limit and the rest did nothing:

| stick | old car | now |
|---|---|---|
| 25% | 84% of full turn | 25% |
| 50% | 98% | 54% |
| 75% | 104% | 79% |
| 100% | 100% | 100% |

Two aids sit on top, and they are for the player only — the AI reads the whole
state vector every frame and they just fight its controller. Yaw damping takes
the dart out of turn-in; grip assist bends the direction of travel back toward
where the car is pointing, which is what makes a mobile racer feel like it goes
where you point instead of washing wide.

    node scripts/steerfeel.mjs    the scorecard for the current car
    node scripts/steerloop.mjs    ten iterations of tuning against it

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
| `Tab` | GPS — `A` / `D` to choose a destination, `Enter` to set it |
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
    node scripts/solid.mjs      # collider audit: nothing can be driven through
    node scripts/polycount.mjs  # triangle budget, scene by scene
    node scripts/steerfeel.mjs  # steering feel scorecard
    node scripts/steerloop.mjs  # tune the steering against it

`simtest.mjs` runs the simulation in plain Node with a stubbed WebGL object, so
handling and AI regressions get caught in seconds without a GPU. It seeds
`Math.random` first: the AI makes deliberate mistakes, and unseeded, one run to
the next varies by ten seconds a lap — far more than most changes to the driver
are worth, so tuning against it measures noise. Seeded, the corner-speed ceiling
could be swept properly: 0.79 of the theoretical limit is the last value that
gains, and by 0.82 the field is 23% off track and four seconds a lap slower.

Both browser suites step the game themselves and switch off its animation loop
while they do it. Left running, that loop advances the simulation between the
harness's evaluate blocks by however long a screenshot happened to take, and the
same build gives a different answer every run — which it did, until the AI's
skill spread was also seeded before the race rather than after it.

`drivehome.mjs` is the end-to-end one: it puts an AI driver in the player's seat,
takes the race to the chequered flag, clicks through the results screen, then
drives every leg of the way home — pit lane, paddock exit, across the world
handover at the gate, the full public route, and up the driveway to park. It
exists because the satnav used to count down to zero 35 m short of the house —
the route spline ended at the kerb and the driveway is a separate path — which
left you stranded in the street with the game insisting you had arrived.
