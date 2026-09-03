# Browser demo

`park-day.html` is a self-contained port of the planner that runs entirely in
the browser: the simulator, the walking model, the forecaster and the two-track
beam search, with no server and no dependencies.

It exists so the planner can be tried without cloning anything. Published at:
<https://claude.ai/code/artifact/6808cdcf-a468-4195-891c-359d9d03deb2>

**It is a demo, not the tool.** Two differences matter:

- Wait times are **simulated**, never live. That is deliberate — it is what
  lets the crowd dial work — but it means the plans here show how the strategy
  behaves, not what will happen on 27 November.
- It plans forward only. There is no collector, no database, no backtest and
  no oracle, so none of the validation lives here. Run `python3 -m dlp.cli
  backtest` for that.

The port tracks the Python package but is not generated from it, so the two can
drift. Numbers agree closely rather than exactly: the JavaScript uses a
different pseudo-random generator, so a given seed produces a different (but
statistically equivalent) day. Spot-checked at build time, Python vs JS over
comparable days: 21-23 distinct child rides, must-do 5/5, 374-420 minutes in
line, 79-146 minutes of parallel queueing, ~5km walked by the child.

The map is the same renderer as `web/map.js`, drawing the geometry from
`dlp/data/park_geometry.json`: park outlines, themed lands at their real
compass bearings, water, and both parks on one shared scale. That geometry is
a schematic until `python3 -m dlp.cli import-map` replaces it with surveyed
OpenStreetMap data — after which regenerate the demo so it picks up the new
shapes.

To edit it, change `park-day.html` directly — it is one file, ordered as
styles, markup, ride data, park geometry, engine, renderers, controls.
