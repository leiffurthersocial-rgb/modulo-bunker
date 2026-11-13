# 03 - Design references: base-building / automation

Status: Factorio, ONI and Satisfactory are sourced from pages actually opened (via curl helper). Fallout Shelter and Frostpunk could not be opened (bot block); their sections are unverified.

## Factorio (FFF #176, belts optimization)
Mechanics & data model
- Adjacent belts are merged into one transport line sharing one item array, so a long run behaves like an underground. Reason given: cache coherency.
- Old model: every item on every moving belt gets its position advanced each tick (20,000 items = 20,000 updates).
- New model: store the distance (gap) between consecutive items, plus an initial and a final gap to the line ends. A free-flowing line only increments/decrements those two end integers, never touching items.
- When blocked, the end gap is 0 and the last non-zero gap is decremented instead. Compression is permanent, so the index of the last positive gap is cached and can only decrease: amortized constant time.
- Cost: item position is no longer an array index (sum the gaps). Inserters track what happened in the line each tick and keep an absolute position at O(1).
- Dynamic merge/unmerge keeps lines near inserters/side-loads short (about 9 tiles, "to be calibrated") and inserter-free lines up to about 100 tiles. Splitters are the legitimate line breakers; about 100 tiles is the max line length (player pick/drop, rendering).
- Reported results: 50-100x on item movement, expected 5-10x overall; a base at 25 UPS reached 35-40.
What we take / avoid
- Take: a conveyor lane = ordered list of gaps plus two end gaps, O(1) when flowing, with cost only at transfer points (machine in/out). Keep one lane per run, not per tile. Model lane state as FLOWING / BLOCKED (compressed).
- Take: lanes only split at splitters and machine ports.
- Avoid: absolute per-item coordinates, and per-tile belt entities (our bunker is cell-based, so one lane per room-to-room link is enough).

## Oxygen Not Included
Mechanics & data model (Thermal Conductivity wiki page; marked outdated for U47, tagged as touched by U58)
- Heat transfer per simulation tick (dt = 0.2 s): q = dT * dt * k * factor, in DTU. Between adjacent cells, solid-solid uses the geometric mean kgeom = sqrt(k1*k2) with factor 1000. Solid-gas, gas-gas, gas-liquid use that factor times 25 for solid-gas and 625 for liquid-liquid (see page for the exact table).
- The page notes the in-game claim that the lowest conductivity is used does not hold in all cases.
- Building to cell: q = dT * dt * kmult * Cth_max, where kmult = k1*k2/2 and thermal mass per area Cth_max = s * m_hot * c_hot / A (s = mass scale, typically 0.2 for buildings, 1 for tiles; only the primary construction material's mass counts).
- Buildings do not exchange heat directly with other buildings.
- Pipe contents to pipe: q = dT * dt * kavg * 50.
- Power (Wire, Power pages): wire has a max wattage, plain Wire 1 kW; overload above that damages or destroys the wire; Conductive Wire 2 kW. Batteries are not output-limited, so even one battery can overload a wire. Batteries slowly self-discharge ("power runoff"). Transformers/regulators protect networks from overload. Jumbo Battery holds 40 kJ, 4x a normal battery. Switch and automated Power Shutoff exist.
- Specific heat capacity (stored heat per mass) and conductivity (rate) are separate per-material properties.
What we take / avoid
- Take: per-module node {mass, temp, specificHeat, conductivity, area}; link exchange q = dT * dt * kLink * area; kLink as the geometric mean or min of the two materials; separate "heat capacity" from "conductivity" so insulation = low k and thermal mass = high m*c.
- Take: wire capacity per grid segment with overload consequences, batteries as buffers, transformers/priority shedding.
- Avoid: per-cell gas simulation and the multiple special-case factor tables. Use one formula and a fixed tick.

## Satisfactory
Mechanics & data model (Conveyor Belt and Conveyor Splitter wiki pages)
- Belt marks: Mk1-6 = 60/120/270/480/780/1200 items/min (speeds 1.2/2.4/5.4/9.6/15.6/24 m/s). Belts can be upgraded or downgraded in place by aiming the other mark at them. Direction cannot be reversed.
- Placement: snap to poles/ports; the first snap point is input and the second is output. Three build modes (Default / Straight with 90 degree turns / Curve), cycled with R. Max slope 35 degrees. Belts must be built after the buildings they connect to.
- Splitter: one input, up to three outputs, round-robin; if an output is backed up, items go to the remaining outputs; if all are blocked it fills a 9-item buffer. Splits only across connected outputs (halves/thirds).
- Smart splitter: per-output filter None / Any / Any Undefined / Overflow / specific item. Programmable: multiple filters per output. Splitters can be built on an existing belt and upgraded in place.
- Splitter and merger placed on existing belts do not respect the foundation grid.
What we take / avoid
- Take: tiered lane capacity as a data table; in-place tier upgrade; splitter filters including Overflow as the priority mechanism (priority = ordered outputs, last = overflow); build modes that make illegal connections visible before placing.
- Avoid: free-form belt routing and slopes; our ports sit on cell edges. Foundation-grid details were not retrieved.

## Fallout Shelter (UNVERIFIED - fandom returned a bot block)
From search snippets only, not opened: rooms upgrade to level 3; merged rooms have their own cost tier; sources disagree on a 2- or 3-wide merge cap; working dwellers add their matching SPECIAL stat to output, boosted by happiness; upgrades reportedly raise disaster strength in that room.
Take: separate width and tier axes, with a data field room.stat. Rush, incident spread and scaling were not retrieved.

## Frostpunk (UNVERIFIED - fandom returned a bot block)
Not retrieved. No facts recorded.

## Sources opened
- https://factorio.com/blog/post/fff-176 - FFF #176 belts optimization (gap-based transport lines, O(1) update).
- https://oxygennotincluded.wiki.gg/wiki/Thermal_Conductivity - heat transfer equations, mass scale, outdated tag.
- https://oxygennotincluded.wiki.gg/wiki/Power - generators, batteries, regulators.
- https://oxygennotincluded.wiki.gg/wiki/Wire - 1 kW max, overload rule.
- https://satisfactory.wiki.gg/wiki/Conveyor_Belt - tiers, speeds, build modes, slope.
- https://satisfactory.wiki.gg/wiki/Splitter - splitter behavior, smart/programmable filters.
(Opened via curl through the proxy helper, since WebFetch DNS was blocked. The Oxygen Not Included Heat page was fetched but not used.)

## Failed fetches
- https://fallout.fandom.com/wiki/Fallout_Shelter_rooms - bot block ("Enable JavaScript and cookies").
- https://frostpunk.fandom.com/wiki/Heat - same bot block.
- WebFetch calls to all hosts failed with DNS errors (ENOTFOUND) before the curl helper was used.
- Not attempted: other Factorio FFFs (electric network, fluid rewrite), ONI pipe/liquid pages.
