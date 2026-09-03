# Disneyland Paris ride-order optimiser

Plans a day at Disneyland Paris for **two parents and one child who can stand in
two queues at once**, using live wait-time data, and validates that the strategy
is actually good by replaying it against whole days of historical queue data.

Built for a trip on **27 November 2026**. Everything about the party, the date
and the strategy lives in `dlp/config.py`.

```
python3 -m dlp.cli serve          # map, timeline and a re-plan button
python3 -m dlp.cli plan           # same plan, printed
python3 -m dlp.cli collect --loop # start banking real wait times
python3 -m dlp.cli backtest       # prove the strategy is worth following
```

No dependencies. Python 3.11+, standard library only.

---

## The idea

The scarce resource in a theme park is not time, it is *queue slots*. A family
of three moving as one unit can only ever be in one line. Your party can be in
two, so the planner runs the day as two tracks:

| | Track A — the family track | Track B — the free parent |
|---|---|---|
| Who | one parent + the child | the other parent |
| Counts as | a ride the child got to do | a ride only an adult did |
| Does | the actual itinerary | buys Premier Access windows, takes single-rider lines, rides what the child is too small for, or tags along |

Track B's job is not to collect rides. It is to **manufacture options for
Track A**. Booking a Premier Access return window while the family is standing
in the Meet Mickey line is a genuine second queue, and it is where most of the
gain comes from.

Measured over four simulated days, against the same party restricted to one
queue at a time (`parallel_queues: 1`):

| | one queue | two queues |
|---|---|---|
| Family time in line | 449 min | **402 min** |
| Queueing for two things at once | 0 min | 98 min |
| Distinct rides for the child | 19.8 | 20.5 |
| Must-do list | 5/5 | 5/5 |

The reliable win is **47 fewer minutes standing in line** for the same must-dos
— it held on every day tested. The extra rides did not: on one of the four days
the two-queue plan did *fewer* distinct rides, because the second queue buys
options and some days it spends them on better rides rather than more of them.
Anyone claiming this kind of tool reliably adds rides is overselling it.

The planner decides, minute by minute, when splitting up is worth it and when
the family should just ride together — because a holiday where one parent
queues alone all day is efficient and miserable.

---

## What it does

**Collects real-time data.** `dlp/collector.py` polls
[themeparks.wiki](https://api.themeparks.wiki/v1) and
[queue-times.com](https://queue-times.com) every five minutes into SQLite. Both
are free and need no key. Park ids are resolved *by name* rather than
hard-coded, because providers renumber their parks.

**Forecasts queues, rather than trusting the current number.** Planning against
the wait posted right now is the classic mistake: by the time you have crossed
the park and queued, that figure is forty minutes stale. `dlp/forecast.py`
combines three things:

1. a **shape prior** — each ride's characteristic curve across the operating
   day, learned from collected history once there is enough of it, falling back
   to class-based curves before then;
2. a **day-level crowd anchor** — every live reading compared against its prior
   gives one robust multiplier for how busy today is (one ride is noisy, forty
   together are not);
3. a **per-ride correction that decays** with a 55-minute half-life, so short
   horizons trust the live number and long horizons trust the curve.

**Plans the day.** `dlp/optimizer.py` is an event-driven beam search over the
two tracks. It handles walking times, park hopping, height limits, Rider Switch,
single-rider lines, a Premier Access budget, a compulsory lunch window, ride
breakdowns, and a must-do list it treats as near-mandatory.

**Validates the strategy.** `dlp/backtest.py` — see below.

**Draws it on the park map.** A single self-contained SVG projected from
lat/lon: no tile server, no map library, works offline and prints. Park
outlines, themed lands, water and the Main Street axis are drawn as real
regions, with two coloured routes, numbered stops, and pins sized and coloured
by current wait. See **The map** below for what is surveyed and what is not.

---

## Backtest validation

A plan that looks clever is worthless if it was built on waits that never
materialised. Every strategy is scored identically:

1. take a day with a **complete** trace of what every queue did;
2. run the strategy **online** — at each replan it sees only the readings that
   existed at that moment, never the future;
3. advance the party using the **actual** waits, not the predicted ones, so
   plans slip exactly as they would in the park;
4. score what really happened.

The headline number is the **optimality gap**. The same day is also solved by an
oracle handed the entire day's true waits up front. That is not a strategy
anybody can run — it is the ceiling. A strategy at 93% of the oracle is 7% away
from the best *any* planner could have done, and most of that remainder is
caused by information that did not exist at decision time.

```
$ python3 -m dlp.cli backtest --days 10

strategy                 days   value  rides  uniq   must  queue  walk  %oracle  worst
--------------------------------------------------------------------------------------
oracle_upper_bound         10   449.1   22.5  22.4   1.00    385   318    100.0  100.0
optimizer_online           10   419.4   21.2  21.2   1.00    404   320     93.3   87.2
greedy_shortest_wait       10   208.6   21.1  21.1   0.10    303   118     46.4   41.8
fixed_popularity_route     10   178.8   10.3  10.3   0.90    432   183     39.7   33.5

Optimiser reaches 93.3% of the perfect-foresight ceiling on average,
87.2% on its worst day. That is 2.01x the best baseline.
```

The baselines matter as much as the score. `greedy_shortest_wait` is what a
family does with the official app open — always walk to whatever is shortest
right now. Note it gets a ride count barely below the optimiser (21.1 vs 21.2)
while finishing **10%** of the must-do list: it fills the day with whatever is
nearest and empty, and the headliners are never the shortest queue. Counting
rides is the wrong scoreboard, which is exactly why the objective weights what
the child actually wanted to do. `fixed_popularity_route` is the internet's
standard advice — rope-drop the headliners in popularity order — which does hit
the must-dos but manages half as many rides.

The optimiser spends slightly *more* time in line than the greedy baseline
(404 vs 303 minutes) and walks nearly three times as far. That is the trade
working as intended: it is buying the rides that matter with queue time and
shoe leather, rather than minimising a number nobody cares about.

Backtest on days you have actually collected once the collector has been running:

```
python3 -m dlp.cli backtest --use-stored --days 20
```

---

## Testing it

Nothing to install. Timings below are measured on a clean clone.

```bash
git clone <this repo> && cd test
```

**1. See a plan — 5 seconds.** No network needed; uses the built-in simulator.

```bash
python3 -m dlp.cli plan --simulate
```

You should get a full 09:30–22:00 day, two tracks (A = parent + child,
B = free parent), `must-do 5/5`, and a footer reporting time in line, parallel
queueing, and how far the child walks. Try `--crowd 9` for a packed day and
`--crowd 3` for a quiet one; the plan should visibly change shape.

**2. See it on the map — instant.**

```bash
python3 -m dlp.cli serve      # open http://127.0.0.1:8000
```

Switch the source dropdown to **simulated day** (live APIs will be unreachable
until you have collected data). Change the *plan from* time and hit **Re-plan
now** to watch the day rebuild from that moment. Hover any pin for its posted
wait and height limit.

**3. Run the test suite — about 2 minutes.** 37 tests.

```bash
python3 -m unittest discover -s tests -v
```

These check the things worth checking, not just that the code runs: that no
track is ever in two places at once, that nothing is scheduled past park
close, that the child is never put on a ride they are too short for, that
lunch lands inside its window, that the Premier Access budget is respected,
that the forecaster reverts a spiking ride toward its prior, that the replay
source never leaks future data into the planner, and that the online planner
never beats the perfect-foresight oracle.

**4. Validate the strategy — about 1 minute for 4 days.**

```bash
python3 -m dlp.cli backtest --days 4
```

Expect the optimiser around 93–95% of the oracle, roughly 2x the best
baseline, and `must 1.00`. Scale up with `--days 20` (about 5 minutes). If
`optimizer_online` ever exceeds 100% of the oracle, something is leaking
future data and the result is meaningless.

**5. Point it at the real thing** — needs internet.

```bash
python3 -m dlp.cli collect --resolve-ids   # confirm provider park ids
python3 -m dlp.cli collect                 # one poll
python3 -m dlp.cli status                  # what you have so far
python3 -m dlp.cli collect --loop          # leave running until November
```

`--resolve-ids` is the one to run first: it asks each provider for its real
Disneyland Paris park ids by name. If the ids in the config have gone stale,
this is where you find out, rather than discovering an empty database in
November. A failed poll prints the actual reason, not just "no data".

> **This is the one path not verified end to end.** The sandbox this was built
> in blocks outbound requests to both wait-time APIs, so the live adapters are
> exercised against stub and error paths but have never seen a real response
> from queue-times.com or themeparks.wiki. Expect to need one round of fixes
> on the attraction name matching the first time you run `collect` for real —
> `status` will show you how many of the 43 attractions actually matched.

Once you have collected real days:

```bash
python3 -m dlp.cli backtest --use-stored --days 20
```

**Start the collector early.** The forecaster falls back to generic curves until
roughly ten real days of the same weekday and month are banked. Running it from
now until late November gives it real Friday-in-Christmas-season behaviour to
learn from, which is exactly what 27 November is.

### On the day

```bash
python3 -m dlp.cli serve
```

Open it on a phone on the hotel wifi, and hit **Re-plan now** every twenty
minutes or whenever something goes sideways. The plan is only ever as good as
its most recent reading; a plan built at 09:30 and followed rigidly until 18:00
is worse than no plan at all, because it will keep sending you to queues that
have since doubled.

---

## Configure it for your party

`dlp/config.py` holds the defaults. Override any of them in a JSON file:

```json
{
  "trip_date": "2026-11-27",
  "party": { "child_height_cm": 118, "child_stamina_min": 260 },
  "must_do": ["ratatouille", "peter_pan", "big_thunder", "meet_mickey"],
  "skip": ["tower_of_terror"],
  "strategy": { "premier_access_budget": 6, "allow_standby_hold": false },
  "hours": { "DLP": ["09:30", "22:00"], "DAW": ["09:30", "20:00"] },
  "afternoon_break_min": 60
}
```

```bash
python3 -m dlp.cli --config mytrip.json plan
```

The settings worth thinking about:

- **`child_height_cm`** decides which rides the child can join, and it is the
  single most consequential setting. The default is **110cm**. At that height
  four attractions are off limits: Indiana Jones (140cm), Hyperspace Mountain,
  RC Racer and Avengers Flight Force (120cm each). Growing to 120cm would
  unlock three of those. Note how little margin 110cm has: **3cm** clear of
  Crush's Coaster (107cm) and **8cm** clear of Big Thunder, Star Tours and
  Tower of Terror (102cm each). Measure in the shoes he will actually wear,
  and verify the limits in the official app — the ones here are seeded
  approximations, and at this height a 5cm error costs you a headliner.
- **`must_do`** rides get a large value bonus, so the planner treats missing one
  as a failure. Keep the list to five or six or it stops meaning anything.
- **`premier_access_budget`** is how many paid return windows you will buy.
  Setting it to 0 shows you what the day looks like without spending anything.
- **`allow_standby_hold`** lets the free parent hold a standby place for the
  family to join near the front. **Disneyland Paris does not permit this**, and
  it is off by default. It is modelled because you asked for two simultaneous
  queues and this is one way people do it — but the plan does not need it, and
  the legitimate mechanisms (Premier Access, single rider, Rider Switch) supply
  most of the benefit.
- **`parallel_queues`** set to 1 makes the party move as a single unit, with the
  second parent unable to queue independently. Worth running once as a
  comparison: it is what the day looks like without the second track, and the
  difference is the whole point of the tool.

---

## Walking

Walking is charged three ways, because it is a real cost with a small child:

- **Time** is consumed by the schedule. Travel between attractions uses
  straight-line distance times a 1.35 detour factor (park paths curve around
  lakes and buildings), plus a penalty for crossing between lands and a much
  larger one for hopping between the two parks — that leg is mostly a walk
  down Main Street, the esplanade, and a bag check. A group with the child
  walks at 0.85 m/s; a lone adult at 1.30.
- **Distance** is reported per leg and totalled, separately for the child and
  for the whole party. A typical plan has the child covering about 5km.
- **Fatigue.** Past `child_stamina_min` on foot, every further walking minute
  costs more, so the planner stops marching a tired child across the park for
  a marginal ride.

One honest caveat on the tuning. Measured across several simulated days,
changing `walk_penalty_per_min` from 0 to 0.05 moves the distance walked by
**under 100 metres out of roughly 5km**. The route is already about as tight
as the geography allows, because the planner ranks each candidate by value per
minute *including* the walk to reach it — so it prefers the nearer ride before
any penalty is applied. What the knob actually trades is ride count against
time on foot: at 0 the child gets ~21.7 rides and ~306 minutes walking; at
0.012 it is ~20.3 rides and ~269 minutes. It is a preference, not an optimum.
Raise it if you would rather have a calmer day than one more attraction.

## The map

Disneyland Park is hub-and-spoke: Main Street runs north from the entrance to a
Central Plaza with the castle on it, and the themed lands fan out around it.
The map draws that structure — lands as regions at their **real compass
bearings**, the Studios as its actual arrangement of lots, both parks on **one
shared scale** so their true relative sizes show. Rescaling each park to fill
its own panel would quietly misrepresent a resort where one park is twice the
other.

What ships in `dlp/data/park_geometry.json` is nonetheless a **schematic**, and
says so in its own metadata. The topology is right; the outlines are generated
shapes, not surveyed ones. It is produced by `tools/make_schematic_map.py`,
which places every land and every attraction by bearing and radius from the
Central Plaza — so the file is reproducible and auditable rather than a list of
hand-typed numbers, and a test asserts every attraction really does fall inside
its own land.

For the real thing:

```bash
python3 -m dlp.cli import-map --dry-run   # see what Overpass returns
python3 -m dlp.cli import-map             # write it
```

That pulls surveyed park boundaries, land polygons, water and attraction
positions from OpenStreetMap, which maps Disneyland Paris in detail. The
importer tries three Overpass mirrors, matches OSM attraction names against the
catalog, prints what it found and what it could not match, and **refuses to
write a thin response** over working data — Overpass returns almost nothing
when it is busy, and silently replacing a good map with an empty one would be
worse than failing. Imported data is © OpenStreetMap contributors, ODbL.

> The import has been tested against recorded responses, not against the live
> API — the sandbox this was built in blocks every OSM endpoint. Run
> `--dry-run` first.

## Things to check before you go

The catalog in `dlp/data/attractions.json` is a **seed**, and it is marked as
such in the file:

- **Coordinates** are schematic (see **The map** above). Run
  `python3 -m dlp.cli import-map` for surveyed OpenStreetMap geometry, or
  `sync-catalog` for attraction coordinates from themeparks.wiki. Walking
  distances are only as good as these, so do this before trusting the
  kilometre figures.
- **Height limits** are approximations. Verify them in the official Disneyland
  Paris app — they are the one input where being wrong ruins a moment in front
  of a child.
- **Park hours** for 27 November 2026 are seeded with a typical late-November
  schedule. `sync-catalog` prints the real ones for your date; put them in your
  config.
- **The attraction line-up changes.** The Studios park is mid-rebuild into
  Disney Adventure World, so check what is actually operating and add closures
  to `skip`.

---

## Layout

```
dlp/
  config.py      trip, party and strategy settings — start here
  model.py       attractions, plan items, a scored day
  walk.py        walking times: haversine + detour factor + park-hop penalty
  store.py       SQLite time series
  forecast.py    prior shape + crowd anchor + decaying live correction
  optimizer.py   two-track event-driven beam search
  backtest.py    online replay, baselines, oracle, optimality gap
  collector.py   the polling daemon
  server.py      stdlib HTTP server for the web UI
  osm.py         OpenStreetMap import: real park geometry over the schematic
  cli.py         command line
  sources/       queue-times, themeparks.wiki, simulator, db replay
tools/           make_schematic_map.py — regenerates the fallback map
web/             map (SVG), timeline, schedule
demo/            self-contained browser build of the planner
tests/           python3 -m unittest discover -s tests
```

### The simulator

`dlp/sources/simulator.py` generates realistic full days — rope-drop lull,
morning build, midday plateau, parade dip, closing surge, autocorrelated noise,
and random breakdowns with the wait spike that follows a reopening. It exists so
the optimiser and backtester are runnable and testable *before* any real data
has been collected.

Simulated rows are written with `source='simulated'` and can never be confused
with observed data. They are for exercising the pipeline. **Do not read the
backtest numbers above as predictions about the real park** — they demonstrate
that the strategy dominates the baselines under a realistic queue model. Re-run
with `--use-stored` once you have collected real days to get numbers that mean
something about Disneyland Paris specifically.
