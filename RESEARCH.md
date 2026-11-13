# RESEARCH.md — how the pros build this

Detailed notes, each with its own **Sources opened** and **Failed fetches** list:

- [research/01-threejs-pipeline.md](research/01-threejs-pipeline.md) — Three.js practice, instancing, disposal, three-mesh-bvh, glTF-Transform, KTX2, Blender export
- [research/02-runtime-tech.md](research/02-runtime-tech.md) — Rapier JS, WebGL2 vs WebGPU, fixed timestep, OffscreenCanvas/workers, ECS, iPad Safari limits, determinism
- [research/03-design-automation.md](research/03-design-automation.md) — Factorio belts, Oxygen Not Included heat/power, Satisfactory logistics
- [research/04-colonists-saves-ux.md](research/04-colonists-saves-ux.md) — RimWorld mood/breaks/storyteller, utility AI, determinism and saves, input

**Method and honesty note.** Pages were read with `curl` through the environment proxy and converted with html2text. The WebFetch tool couldn't reach hosts added mid-session; see ENVIRONMENT.md. Only pages actually opened are cited. Anything else is tagged in the notes as `[SNIPPET]` (search snippet only), `[BG]` (background knowledge) or `[OURS]` (our own design judgment). Four research agents wrote the notes, and I reviewed them.

## Coverage

| Topic from the brief                                                  | Status                                                                                                                                   |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Three.js manual: optimization, disposal, instancing, BatchedMesh, LOD | ✅ sourced (manual pages + three.js source)                                                                                              |
| Discover three.js                                                     | ✅ tips page (dated API, noted)                                                                                                          |
| three.js forum: game architecture                                     | ⚠️ partial: 3 threads on perf, dispose and iOS memory. No good architecture thread found.                                                |
| three-mesh-bvh, glTF-Transform, KTX2/Basis                            | ✅ sourced (READMEs, CLI docs, Khronos KTX Artist Guide)                                                                                 |
| Rapier JS, character controller, determinism                          | ✅ sourced (rapier.rs JS guide v0.21)                                                                                                    |
| WebGPU vs WebGL2, iPad Safari support                                 | ✅ sourced (three.js docs/releases, WebKit WWDC25 post, caniuse)                                                                         |
| Render vs sim loop                                                    | ✅ Gaffer "Fix Your Timestep"                                                                                                            |
| OffscreenCanvas / workers                                             | ✅ three.js manual, MDN, caniuse                                                                                                         |
| ECS: bitECS / miniplex / plain                                        | ✅ READMEs                                                                                                                               |
| Blender → glTF pipeline                                               | ⚠️ glTF-Blender-IO README only (docs.blender.org not allowed)                                                                            |
| Factorio (belts, FFF performance)                                     | ✅ FFF #176 (belts), #55/#76 (determinism)                                                                                               |
| Oxygen Not Included (heat, power)                                     | ✅ wiki: thermal conductivity, power, wire. ⚠️ pipes/liquids not read                                                                    |
| Satisfactory (logistics UX)                                           | ✅ wiki: conveyor belt, splitter                                                                                                         |
| RimWorld (needs, mood, breaks, storyteller)                           | ✅ 7 wiki pages                                                                                                                          |
| Utility AI                                                            | ✅ Game AI Pro ch. 9 and GAP3 ch. 13. ⚠️ Dave Mark's GDC talks (GDC Vault not allowed); "compensation factor" not found in what was read |
| Deterministic sim, lockstep                                           | ✅ Gaffer (2 articles), Factorio FFF                                                                                                     |
| **Fallout Shelter**                                                   | ❌ **not sourced**: Fandom bot-blocks scripted access. The section holds only unverified snippets.                                       |
| **Frostpunk**                                                         | ❌ **not sourced** (same Fandom block)                                                                                                   |
| **Project Zomboid, Subnautica**                                       | ❌ not researched (hosts not allowed)                                                                                                    |
| Save versioning/migrations articles                                   | ❌ no allowed source; the design is our own (standard practice)                                                                          |
| FPS controller feel, tablet touch-control design                      | ⚠️ only MDN Pointer Lock / multi-touch; the rest is our own judgment                                                                     |
| Modular kits (Joel Burgess / Skyrim)                                  | ❌ blog.joelburgess.com reset the connection                                                                                             |
| iPad Safari memory cap                                                | ⚠️ no authoritative number exists publicly; one forum report plus WebKit bug snippets                                                    |

For Fallout Shelter and Frostpunk I rely on your brief, which already describes the mechanics we want (merging up to 3 wide, tiers 1-3, skill matching, heat as pressure). Ways to close the gap are in the open questions in PLAN.md.

## Key findings → decisions (short form)

**Rendering (01, 02)**

- Draw calls are the CPU bottleneck long before triangles. A forum answer by a three.js maintainer: about 3,000 draw calls ran at 30 fps, and the fix was cutting calls, not polygons.
  → One `InstancedMesh` per kit piece per **floor chunk** (so a floor can be hidden or culled as a unit) and one per conveyor-item type. Track `renderer.info`.
- Instanced and merged meshes lose per-object culling, and InstancedMesh bounds are lazy and can go stale.
  → Chunk per floor and set explicit bounds.
- `dispose()` is manual for geometry, material, texture and render target. A material's dispose doesn't free its textures.
  → A `disposeTree()` helper, shared materials with reference counts, and a memory readout in F3.
- WebGPU ships in Safari 26 (iOS/iPadOS 26+), but not on iPadOS ≤18. three.js WebGPURenderer still changes a lot from release to release.
  → **WebGLRenderer (WebGL2)**, no TSL, and rendering behind a thin interface so WebGPU stays an option later.
- KTX2 stays compressed on the GPU. The Khronos example: 96 MB of GPU memory as JPG/PNG vs 21 MB as KTX2.
  → Phase 4: ETC1S for albedo, UASTC for normal and ORM, power-of-two sizes, meshopt geometry, and the glTF-Transform pipeline `dedup → instance → meshopt → resize → etc1s/uastc`.
- OffscreenCanvas is supported in Safari 17+, but workers get no input.
  → **Render on the main thread.** Design the sim so it can move to a Worker later (commands in, typed-array snapshots out).

**Simulation (02, 03, 04)**

- Fix Your Timestep: fixed dt plus an accumulator, interpolation by alpha, and a clamp against the "spiral of death".
  → Constant 0.1 s tick. Speed = more ticks per frame under a wall-clock budget. The effective speed is shown when the sim falls behind.
- Factorio FFF #176: a belt is a _transport line_ that stores **gaps between items** plus end gaps. A free-flowing line updates 2 integers per tick, and a compressed line caches the index of its last positive gap. That gave 50-100× faster item movement.
  → `sim/logistics` lanes use this model, with integer fixed-point positions. Lanes break only at splitters and machine ports.
- Oxygen Not Included heat: transfer per tick is `q = ΔT·dt·k·factor`, using the geometric mean of the two conductivities. Heat capacity (m·c) and conductivity are kept separate.
  → One node per module `{heatCapacity, temp}`, links with conductance `k`, plus a leak to the rock. Insulation lowers `k` and thermal mass raises `C`. Use one formula, not ONI's special-case table, and pick dt so the explicit integration is stable (check `k·dt/C < 0.5` in a test).
- ONI power: wires have a wattage cap and overload damages them, batteries buffer and self-discharge, and transformers isolate networks.
  → Grid segments get a capacity, consumers get priority tiers 1-4, and brownouts shed the lowest tier first. Batteries come later.
- Satisfactory: belt tiers with throughputs in a data table, in-place upgrades, splitter filters including _Overflow_, and a 9-item splitter buffer.
  → Tiered lane speeds in data. Priority routing = ordered outputs with an overflow output last.
- Determinism (Gaffer, Factorio, Rapier docs): same state plus same inputs gives the same result, as long as nothing nondeterministic leaks in. `Math.sin/cos` aren't guaranteed identical across engines. Factorio checks this with a per-tick CRC.
  → The sim uses only `+ - * /`, `sqrt`, `floor`, `min`, `max` and `imul`, with no trig. It uses integer ticks, stable id iteration order and named seeded streams, and saves the RNG state. A state hash runs every N ticks with replay tests in CI.
- ECS: bitECS is about 5 kB with numeric ids and SoA; miniplex uses plain objects. At our scale (hundreds of entities plus 2,000 belt items) neither is needed.
  → **Plain data-oriented code**: typed-array SoA for belt items, and id-indexed arrays of plain records for rooms, machines and survivors. That serializes trivially and iterates deterministically.

**Survivors and storyteller (04)**

- RimWorld mood = base + Σ thoughts. Thoughts carry value, expiry, stack limit and a stacking multiplier. The visible mood bar moves toward its target at +12 per hour up and −8 per hour down. Breaks happen at 35% / 20% / 5% with mean times between breaks of 4 / 0.8 / 0.5 days. After a break a "Catharsis" thought (+40 for 3 days) prevents spirals, and sleeping pawns don't break.
  → We copy the _structure_ (with our own numbers), tune it with the balance runner, and map stress to a threshold modifier.
- RimWorld's storyteller: threat points come from wealth and population, scaled by an adaptation factor (0.4-1.47) that drops after deaths. Cassandra runs a 4.6-day "on" phase and a 6-day "off" phase. A population-intent factor scales "new colonist" events.
  → Our director: threat budget = f(bunker wealth, survivor count) × adaptation, with on/off tension windows jittered from the seed. Incident definitions carry `baseChance`, `cooldownDays`, `minDay` and `severity`. Mystery beats are scheduled on their own seeded stream.
- Utility AI (Game AI Pro): normalize each input to [0,1], pass it through a data-driven response curve (linear, quadratic, logistic, piecewise), multiply the considerations, and multiply by the action weight. A cooldown is just another consideration. Inertia prevents oscillation.
  → Actions live in JSON. AI re-decides at about 2 Hz, with a stickiness bonus for the current action and a minimum commit time. The product of many considerations shrinks scores, so we add our own correction for that and test it.

**Input and iPad (02, 04)**

- caniuse lists **Pointer Lock as not supported on iOS/iPadOS Safari** (every version). MDN: `unadjustedMovement` gives raw mouse input. Pointer events support multi-touch (stick and look at the same time).
  → Two paths: pointer lock on desktop. On iPad, drag-to-look with a trackpad or mouse, plus a touch layer (floating left stick, right-side look, buttons), all producing one intent struct.
- No public number exists for iPad page memory. A forum report: about 45 MB of assets crashed an iPhone 8 into a reload loop. WebKit reports (snippets only) describe pages killed under memory pressure without a `webglcontextlost` event.
  → A conservative budget, autosave on `visibilitychange`/`pagehide`, and early real-device testing.

---

## Recommended architecture (one page)

```
             commands                          events (bus)
 input/ ──► [CommandQueue] ──► sim/ (pure TS, 10 Hz fixed) ──► ui/ audio/ (horror director later)
 ui/    ──►                     │  World: SoA + id-indexed records
                                │  systems: power→heat→air→water→machines→logistics
                                │           →food→survivors(AI@2Hz)→incidents→mystery
                                │  RNG streams: layout, loot, events, ai, mystery
                                ▼
                         snapshot (prev,cur) ──► render/ (Three.js WebGL2, interpolate)
 player/ (Rapier capsule, render-rate) ◄────────── static colliders built from sim layout
 save/  ◄── serialize(World + rng + tick + schemaVersion) ──► migrations ──► IndexedDB/localStorage
 gen/   ── seed → initial World (pure)          data/ ── JSON defs + types + validator
```

1. **The sim is a pure function of (seed, data, command log).** Everything else is a view or an input. The balance runner, replays, tests and saves all use the same path. The sim can move to a Worker without changing its API.
2. **Fixed 0.1 s tick, integer tick counter, speed by tick count.** Systems run in a fixed order. Survivor AI is time-sliced at about 2 Hz.
3. **Data-oriented state.** Belt lanes use the Factorio gap model in Int32Arrays. Rooms, machines, survivors and networks are arrays of plain records indexed by id. No ECS library.
4. **Networks as graphs.** Power, water pipes, heat links and belt lanes are each a small graph rebuilt only when building changes (dirty flag) and solved per tick in O(edges).
5. **Render reads, never writes.** It uses an InstancedMesh per kit piece per floor and per item type, a floor ±1 visibility window (Phase 3), labels only near the camera, and WebGLRenderer, with WebGPU behind an interface later.
6. **The player lives outside the sim.** Rapier `rapier3d-compat` drives the player capsule only, at render rate. Survivors path on the sim's module graph with no physics. The elevator is a sim entity, and the player rides it as a kinematic platform.
7. **Content-first.** All defs are JSON. Behaviours are referenced by id from a small registry. The validator runs in tests and dev.
8. **Saves:** `{schemaVersion, seed, tick, rngStates, world, commandLogTail}`, migrated through pure v(n)→v(n+1) functions, with a fixture save per version in tests.

## Risks

| Risk                                                                       | Impact                                      | Mitigation                                                                                                                                                                             |
| -------------------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **iPad Safari memory kill** (silent reload, no event)                      | Lost progress, crash loops                  | Conservative budget (target well under 1 GB total; greybox well under 300 MB). KTX2 later. Dispose per floor. Autosave on visibility change. Measure on your iPad at every phase stop. |
| **iPad CPU at x100 speed** (1,000 ticks/s)                                 | Sim can't keep up                           | Wall-clock tick budget with the effective speed shown, O(1) belt lanes, AI at 2 Hz, dirty-flag network rebuilds. Worker offload as a fallback.                                         |
| **No Pointer Lock on iPadOS**                                              | First-person look feels off with a trackpad | Drag-to-look and touch layer from M1.3. Test on your device early.                                                                                                                     |
| **Low Power Mode caps rAF at 30 fps** (snippet, unconfirmed)               | Feel                                        | Everything uses delta time. Battery Saver targets 30 anyway.                                                                                                                           |
| **Headless perf numbers are meaningless here** (SwiftShader CPU rendering) | Wrong tuning                                | Benchmark route logs numbers on your hardware. CI checks only correctness.                                                                                                             |
| **Determinism drift** (float/trig, iteration order)                        | Desyncing replays and saves                 | No trig in the sim, integer state where cheap, stable ordering, state-hash replay tests.                                                                                               |
| **Cross-browser** (we test Chromium; the target is WebKit)                 | Safari-only bugs                            | Run Playwright WebKit on your machine (SETUP.md), plus a manual iPad pass per phase.                                                                                                   |
| **Scope** (automation + survivors + mystery is large)                      | Never fun in greybox                        | Vertical slice first, balance runner early, stop at each phase for your review.                                                                                                        |
| **Asset hosts blocked here** (Phase 4)                                     | Can't fetch assets                          | Allow hosts on the `modulo-bunker` environment then, or run the fetch scripts locally.                                                                                                 |
| **three.js release churn**                                                 | Upgrade breakage                            | Pin r187. Upgrade deliberately using the migration guide.                                                                                                                              |
