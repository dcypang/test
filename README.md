# Explorer's Passport

A general-knowledge quiz for 9-year-olds (Year 5 / grade 4). Every expedition draws **18 questions
from a bank of 500**, three from each of six subjects, across three rounds that
get harder as you go.

| Subject | Questions | Covers |
| --- | --- | --- |
| Olympiad maths | 100 | number puzzles, fractions and decimals, area and angles, logic, combinatorics, data |
| Science | 90 | living things, materials and changes, forces, light and sound, electricity, Earth and space |
| Geography | 90 | continents and oceans, physical features, maps and scale, climate, flags, landmarks |
| History | 82 | ancient civilisations, the Middle Ages, exploration, the Industrial Revolution, the modern age |
| English | 85 | word classes, punctuation, spelling, vocabulary, figurative language, reading comprehension |
| Social studies | 53 | government and voting, rights and duties, economics, community, media literacy |

Each question is tagged with a difficulty: round 1 is a warm-up, round 2 asks for
two steps, round 3 is olympiad level for the age. A right answer stamps its square on the
grid, and the grid doubles as the score report — subjects across, rounds down, so
you can see at a glance where the gaps are.

## How it fits together

| File | What it holds |
| --- | --- |
| `index.html` | The page, its styling, and the engine that draws and runs an expedition |
| `bank-*.js` | The 500 questions, one file per subject |
| `art.js` | Core kit: counters, number tracks, maps, flags, landmarks, animals |
| `art-math.js` | Number lines, fraction bars, geometry figures, Venn diagrams, tables, nets, charts |
| `art-science.js` | Solar system, water cycle, circuits, food chains, particles, forces, cells, organs, optics |
| `art-humanities.js` | Timelines, artefacts, hierarchies, flow charts, and the word-work cards English uses |

Every question names a renderer and its arguments (`art:['figure','tri',{b:10,h:6}]`),
so each picture is drawn to fit that question. Diagrams follow the page theme;
postcards — landmarks, animals, flags — sit on a fixed light panel with their own
palette so they hold up in dark mode. The English renderers return styled HTML
rather than SVG, because text wants real type.

The browser remembers the last 60 questions it showed and prefers fresh ones:
back-to-back expeditions draw no repeats.

Open `index.html` in any browser — no build step, works on phones, light and dark.

## Grade level

The bank was first written for 10-year-olds and then turned down a year. Thirty-six
questions were rewritten to bring the ceiling down: percentages, ratio, mean and
range, triangle area and volume formulas left the maths; semicolons, the passive
voice and relative clauses left the English; opportunity cost and public goods
became concrete choices rather than named concepts. The facts in science, history
and geography stayed — a 9-year-old can learn that Jupiter is the largest planet
just as well — but the most abstract reasoning questions were replaced.

> Earlier versions are in the git history: the 10-year-old bank at `968bf9b`, and
> the original 7-year-old quiz with its 100-question bank at `f7534e3`.
