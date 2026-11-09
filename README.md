# test

## Greenprint City

`greenprint/index.html` is a single-file browser game about planning a city for 2050.
Open it in any modern browser; it needs no build step or server.

Pick a city (San Francisco, Phoenix, Oslo or Singapore), then work through four chapters:

- **Energy**: *Prioritize* ranks power sources; power is bought from the top of the list until each source's
  capacity runs out, and each row shows its cost and CO₂ per kWh on a gauge. *Renew* splits renewables among
  solar, wind, geothermal, wave and hydro on a semicircle. *Store* sets battery and microgrid levels, which
  decide how much of the grid renewables can run.
- **Buildings**: *Mix* zones the land and sets the green-space share. *Live* and *Work* balance housing and
  commercial uses on semicircle sliders. *Conserve* sets how many older buildings get retrofitted and how
  efficient new construction must be.
- **Transport**: rank transportation technologies, then divide street space among sidewalks, bike lanes,
  car lanes, bus lanes and rail.
- **Greenspace**: split green land among parks, habitat and farms, then set tree canopy and green-roof coverage.

The city can be viewed two ways: a **street view** that animates power plants, buildings and traffic, and a
**map view** that shows the city as a lit model table with land-use colors projected onto white buildings
and traffic lights moving along the streets. A live sustainability score, four category scores and a feed
of resident reactions update with every change. The final report grades the plan against the city's starting
point. The scoring is a simplified model meant to show trade-offs, not to predict a real city.
