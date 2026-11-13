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
