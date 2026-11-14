# PLAN.md — Modulo: Bunker

> **Update (D-010, D-011):** the bunker is now a **pre-built 3D bunker**: section templates on a 3D grid, extending in all directions, with several shafts. You repair, upgrade and refit rooms, open sealed sections, and build machines and logistics. Building, merging and demolishing rooms (M1.2/M1.4 below) were replaced by this. First person is the main view.

Status: **draft for your OK**. No game code is written beyond the Step 0 hello-world.
Basis: RESEARCH.md (the recommended architecture is at its end) and the brief. Changes to the architecture get a DECISIONS.md entry.

---

## 1. Shape of the code

```
src/
  sim/        pure TS, deterministic. World state, tick systems, no Three/DOM/Date/Math.random
    core/     World, tick scheduler, event bus, command queue, state hash
    systems/  power, heat, air, water, food, machines, logistics, survivors, incidents, mystery
  gen/        seeded generation (bunker layout, damage, loot, survivor rolls, mystery schedule)
  data/       JSON definitions + TS types + validator (rooms, machines, items, recipes, crops,
              incidents, traits, skills, arcs, dialogue, mystery entries)
  save/       versioned serializer, migration chain, localStorage/IndexedDB, export/import
  render/     Three.js: reads sim snapshots, interpolates, greybox kit, overlays, labels
  input/      keyboard/mouse/pointer-lock, touch controls, remapping, action map
  player/     Rapier world (player capsule only), first-person controller, interaction raycast
  ui/         DOM/CSS: HUD, build mode, tablet, pause/settings, debug F3 + console
  audio/      placeholder bus subscribed to sim events (silent in greybox)
  app/        bootstrap, main loop (fixed-step sim + interpolated render), settings
tests/unit, tests/e2e, scripts/ (balance runner, benchmarks, check-*)
```

Hard rules (ESLint already enforces part of this):

- `sim/` and `gen/` never import `three`, DOM globals, `performance`, `Date` or `Math.random`.
- The sim changes only through **commands** (`build`, `assign`, `setPriority`, `toggleMachine`…). Player input, UI and debug tools emit commands. This makes saves, replays and the balance runner the same code path.
- The sim talks outward only through the **event bus** (`incident.started`, `room.built`, `survivor.mood`…). UI, audio and later the horror director subscribe to it.
- Content lives in `src/data/*.json`, and new content needs no code change. Behaviours are referenced by string ids from a small code registry (e.g. an incident's `"resolver": "repairMachine"`).

## 2. Time and loop

- Sim tick = fixed **0.1 s real at x1**. Game time is 1 real s = 1 game min, so 1 tick = 6 game seconds. Every system uses the fixed `dt` (game seconds), so ticks stay identical regardless of speed.
- Speed scaling runs **more ticks per frame, never a bigger dt**: x0.5 / x1 / x4 / x10 / x100 = 5 / 10 / 40 / 100 / 1000 ticks per real second. The per-frame tick budget is about 6 ms. If the sim can't keep up, the effective speed drops and the HUD shows "x100 (running x63)", as RimWorld and Factorio do. That keeps determinism intact at any speed.
- Render interpolates between the last two sim snapshots (only positions that move: survivors, elevator, belt items). Above x10, interpolation is skipped.
- Menus and hidden tab: rendering pauses, and the sim either pauses (pause menu) or runs at a reduced tick rate (tablet open), per your Battery Saver rule.

## 3. Phase 1 — Greybox vertical slice (milestones, each one commit + screenshots)

**M1.1 Core skeleton**

- World state, tick scheduler with time scale, command queue, event bus, state hash.
- Data loader with a small schema validator (validation runs in tests and dev, and is stripped from prod).
- Seed from `?seed=`; a default seed when absent.
- Accept: unit tests show the same seed plus the same command log give the same state hash after 10k ticks, at x1 and x100 alike.

**M1.2 Bunker generation and greybox world**

- Central 4 m shaft. Floors with 4 cells × 2 sides of 6 × 3.5 × 8 m. Floor count 10 (3 open) out of a max of 20.
- Slot states: rock / excavated / sealed / damaged / operational, as colour-coded translucent blocks with floating labels (type, tier, status). Corridor strip along the shaft side of each floor.
- Seeded damage, sealed sections, starting rooms and loot.
- Accept: generation tests check every unsealed slot is reachable from the start, the start can bootstrap power, and the same seed gives the same layout. Screenshots of 3 seeds.

**M1.3 Player**

- Rapier `KinematicCharacterController` capsule: walk, sprint, crouch, jump.
- Interact raycast with highlight. Carry one small item.
- Elevator: a sim entity the player rides as a kinematic platform, called from panels.
- Ladder: climb mode inside a trigger volume.
- Pointer Lock with click-to-capture; fallback drag-to-look when lock is unavailable (iPadOS).
- Touch controls: virtual stick, look area, interact/build/jump buttons, auto-suggested on touch devices.
- Settings: sensitivity, FOV, invert-Y, remappable keys.
- Accept: Playwright walks a scripted path on desktop and iPad-touch profiles.

**M1.4 Rooms**

- Build mode: aim at a slot to see a ghost preview, cost and validity. Build, upgrade (tier 1-3, block count and label change), merge (same type, adjacent, up to 3 wide), demolish (partial refund).
- Rooms come from `rooms.json`: size, cost, power draw, capacity, outputs per tier, merge bonus.
- Accept: e2e builds a room, upgrades it and merges two cells.

**M1.5 Five-resource sim, HUD and overlays**

- Power: generators, consumers, priority tiers 1-4, brownout sheds the lowest priority first.
- Heat: per-module temperature, heaters, leak to the rock at an outside temperature that slowly falls. Module-to-module conduction comes in Phase 2 with the full model, but the data fields exist now.
- Air: CO2 from occupants and machines; scrubbers.
- Water: ice → melt → purify → potable.
- Food: crops with growth that depends on light, water and warmth, then harvest, cook, eat, spoil.
- HUD with 5 resource bars and trends.
- Overlay toggle (power / heat) recolours modules.
- Debug panel with simple canvas graphs.
- Accept: invariant tests (no negatives, conservation). A 3-day headless run on 10 seeds doesn't collapse with a sensible build order.

**M1.6 Survivors (basic)**

- 4 capsules with name labels and a status icon.
- Needs decay: hunger, thirst, sleep, warmth, plus stubs for the rest.
- Assignment to rooms through the tablet. Simple utility choice (work / eat / drink / sleep / warm up).
- Pathfinding over the module graph (corridors, shaft, elevator queue, ladder).
- Skills and traits are rolled from the seed. Full utility AI, moods and relationships come in Phase 2
- Accept: AI sanity tests (a starving survivor eats rather than works). Survivors reach every floor via the elevator.

**M1.7 Machines and logistics (first slice)**

- 2 machines: Ice Melter and Water Purifier, each with input/output slots, a recipe, power draw and wear.
- Conveyors as **gap-based lanes** (Factorio FFF #176 model) with grid-snapped placement inside rooms. Items render as one InstancedMesh per item type.
- Pipe network for water: a graph of segments where each network pools its volume and has a throughput cap.
- Accept: conservation tests (items and water are never created or lost in transit). A stress test of 2,000 items on lanes measures sim time per tick.

**M1.8 Save/load, debug, ship**

- Versioned JSON saves with a migration chain and tests.
- Autosave, export/import, localStorage for small saves and IndexedDB for large ones.
- F3 overlay (FPS, draw calls, triangles, sim ms, entity counts) and a console: free cam, time scale, give resources, spawn incident, unlock slot.
- Pause menu with the seed and a copy-link button.
- Playwright smoke and interaction tests on 3 profiles. Vercel deploy via the GitHub integration (needs your one-time setup, SETUP.md §4).
- **STOP for review:** screenshots, numbers, open questions.

## 4. Phase 2–6 (outline; detailed plans written at each stop)

- **P2 Depth:** the full machine set, splitters/filters/priority, request/supply chests, the item elevator, the if/then logic panel, incidents with a storyteller (threat budget, cooldowns, seeded), heat conduction between modules, full utility AI with moods, mental breaks, relationships and the arc format (2 placeholder arcs per survivor), the mystery feed, excavation, a research tree, and the balance runner (30 days × 100 seeds, Node, reporting starvation/freeze/collapse rates).
- **P3 Performance:** quality presets including Battery Saver, an FPS cap, floor ±1 render culling with proxies, the watchdog, the benchmark route and max-load scene, and a memory budget for iPad.
- **P4 Assets:** fetch/process scripts, `/lab` material route, kit swap by room-type id, lighting and audio. This needs either the asset hosts allowed or runs on your machine.
- **P5 Characters:** comparison of approaches A and B, `/character-lab`. Photos stay local and private.
- **P6 Polish.**

## 5. Testing summary

- Vitest: determinism (state hash), generation validity, sim invariants, save round-trip and migrations, AI sanity, recipe graph validity (every item obtainable, no dead ends).
- Playwright: 3 profiles, fail on console errors, screenshots, build-and-assign interaction.
- After any visual change I look at the screenshots myself before claiming it works.
- CI: typecheck, lint, unit, build, e2e.

## 6. Open questions for you

1. **Vercel:** OK to connect the repo through Vercel's GitHub integration (SETUP.md §4, Option A)? That's the only way to get a public build without storing a token in the cloud environment. Until then, a reviewable build means running locally.
2. **Fallout Shelter / Frostpunk sources:** Fandom blocks scripted access. Options: (a) proceed from your brief, which already specifies the mechanics; (b) allow `en.wikipedia.org` on the `modulo-bunker` environment for overview-level facts; (c) paste or upload pages you want me to use. I recommend (a).
3. **UI tech:** plain TS + DOM for the HUD, plus **Preact** (about 4 kB) for the tablet, build menu and settings, which will have many stateful panels. The alternative is fully vanilla. I recommend Preact.
4. **Heat in Phase 1:** the brief puts conduction in Phase 2. It's cheap once the node/link model exists. Do you want a minimal version in M1.5, so the heat overlay already shows gradients?
5. **Your iPad:** which model and iPadOS version? That sets the memory budget and whether WebGPU is even an option later.
6. **Default seed** for screenshots, tests and the "new game" button? I'll use `"ember-07"` unless you have a preference.
