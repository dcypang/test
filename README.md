# Explorer's Passport

A quiz for 7-year-olds. Every trip draws **18 stops from a bank of 100 questions**,
so the same child can play again and again without repeats.

- **Numbers (40)** — adding, doubles and halves, arrays and sharing, counting in
  2s/5s/10s, telling the time, money, fractions, shapes, patterns, measuring and
  reading a pictogram.
- **Where in the world (40)** — continents and oceans, capital cities, twelve
  flags, eight famous landmarks, six animals and their habitats, and the compass.
- **Summit puzzles (20)** — olympiad-style thinking at the right level for a
  7-year-old: counting hidden squares, cuts versus pieces, growing sequences,
  handshakes, balance scales, sum-and-difference pairs.

Twelve stops go round the world, alternating numbers and places; six summit
puzzles follow. A right answer wins a stamp, and the trip ends with a rank from
Packing Bags up to Grand Explorer.

## How it fits together

| File | What it holds |
| --- | --- |
| `index.html` | The page, its styling, and the engine that draws and runs a trip |
| `bank.js` | All 100 questions — text, choices, answer, picture spec, and the fact or reasoning shown afterwards |
| `art.js` | The illustration kit: 24 renderers that draw every picture as SVG |

Every question names a renderer and its arguments (`art:['clock',7,30]`), so the
pictures are drawn to fit the question rather than picked from a fixed set.
Diagrams — counters, ten-frames, number tracks, bar models — follow the page
theme. Postcards — landmarks, animals, flags — sit on a fixed light panel with
their own palette, so a camel stays sand-coloured in dark mode.

The browser remembers the last 40 questions it showed and prefers fresh ones, so
back-to-back trips rarely overlap. Numeric choices are sorted, word choices are
shuffled, so the right answer never sits in a predictable place.

Open `index.html` in any browser — no build step, works on phones, light and dark.
