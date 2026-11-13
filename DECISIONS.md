# DECISIONS.md

Format: what, why, alternatives rejected. Newest at the bottom.

## D-001 TypeScript 6.0, not 7.0 (2026-11-13)

- **What:** pin `typescript@~6.0.2`.
- **Why:** TypeScript 7.0 (the native port) is released, but `typescript-eslint@8.72.2` declares `typescript >=4.8.4 <6.1.0`. Type-aware linting matters more right now than faster compiles.
- **Rejected:** TS 7 without type-aware ESLint; TS 7 with an unsupported peer.
- **Revisit:** when typescript-eslint supports 7.x.

## D-002 Playwright pinned to 1.63.0 (2026-11-13)

- **What:** exact pin of `playwright` and `@playwright/test` to 1.63.0.
- **Why:** the cloud container ships Chromium build 1243 for that version and can't download browsers. CI installs its own browsers, so the pin costs nothing there.
- **Rejected:** latest (1.65) with an `executablePath` override, which is more fragile.

## D-003 Seeded RNG: cyrb128 hash + sfc32, named streams (2026-11-13)

- **What:** `src/gen/rng.ts`. The seed string is hashed with cyrb128 into 4×32-bit words, which feed sfc32. `Rng.stream(seed, name)` derives independent streams ('layout', 'loot', 'events', 'mystery'…), and `getState()` serializes state into saves.
- **Why:** it's fast, has a 128-bit state, and is easy to serialize. Separate streams mean extra draws in one system (e.g. events) don't shift the bunker layout.
- **Rejected:** mulberry32 (32-bit state, too small for long runs); `Math.random` (not seedable).

## D-004 Software WebGL in CI/cloud; perf numbers from real devices only (2026-11-13)

- **What:** headless Chromium uses SwiftShader. Screenshots and functional tests run here; frame-time benchmarks run on your hardware.
- **Why:** CPU rendering timings would mislead the quality-tier tuning.

## D-005 Separate `modulo-bunker` cloud environment (2026-11-13)

- **What:** a personal environment for this repo with doc/wiki hosts allowed, so the Default environment shared by your other repos stays untouched.
- **Rejected:** editing Default; unrestricted network.

## D-006 No Vercel token in the cloud environment (2026-11-13)

- **What:** you declined to store a token, so deploys go through Vercel's GitHub integration (preferred) or your local CLI.
- **Consequence:** "deploy hello world to Vercel" is **not done** from here; it needs one of the routes in SETUP.md §4.

## D-007 Answers to the PLAN.md open questions (2026-11-13)

- **Vercel:** you connect the repo through Vercel's GitHub integration yourself. No token in the cloud environment.
- **Fallout Shelter / Frostpunk:** work from the brief (no further sourcing).
- **UI:** Preact for stateful panels (tablet, build menu, settings, debug). The HUD is plain DOM. It must work equally on iPad and desktop: large touch targets (≥44 px), no hover-only affordances.
- **Heat:** Phase 1 has per-module temperature with heaters and a leak to the rock, but no module-to-module conduction. The data fields exist, and conduction comes in Phase 2.
- **iPad target:** the game will run on friends' various iPads, so we design for the weakest plausible device: a 2021-era base iPad (A13, 3 GB RAM, iPadOS 17/18, **no WebGPU, no Pointer Lock**). Budget for the greybox phases: JS heap under 150 MB, total page under 300 MB.
- **Default seed:** `ember-07`.

## D-008 Phase 1 resource model: global stores plus physical automation (2026-11-13)

- **What:** bulk resources (water, food, ice, filters, scrap, parts) live in a bunker-wide **store**, Fallout Shelter style. Rooms produce into it and consume from it, limited by storage capacity. Machines and conveyors are a **physical** layer on top: items on lanes are real, and a machine's output port either feeds a lane or, if unconnected, delivers into the store. Power, heat and air are computed per tick and aren't stored items (batteries come later).
- **Why:** keeps the greybox playable and readable from day one while automation adds depth (throughput and bonuses). Phase 2 adds chests with request/supply rules on the same model.
- **Rejected:** fully physical logistics for everything (too much to build before the game is fun), and a store-only design (no automation depth).

## D-009 Sim time (2026-11-13)

- 1 tick = 0.1 real s at x1 = **6 game seconds**, so 1 game day = 14,400 ticks = 24 real minutes.
- Speed = ticks per real second (x0.5 → 5, x1 → 10, x4 → 40, x10 → 100, x100 → 1,000), with a wall-clock budget per frame. If the sim falls behind, the HUD shows the effective speed.
- Survivor AI decides every 5 ticks (2 Hz real at x1).
