# 02 - Runtime technology choices

Tags: items marked **[SNIPPET]** come only from web-search result snippets (page not opened); **[BG]** = model background knowledge, not verified. Everything else was read from an opened page.

## 1. Rapier (JS)

Key findings:
- JS user guide on rapier.rs is versioned "JavaScript 0.21" while Rust/Python are 0.36 and the Rapier core CHANGELOG is at v0.36.1 (4 Oct 2026): the JS bindings lag the core, so check the installed npm version rather than assume the changelog items below exist in JS.
- Packages: `@dimforge/rapier3d` (WASM must be loaded async, e.g. `import('@dimforge/rapier3d').then(...)`; needs a bundler that handles .wasm). `@dimforge/rapier3d-compat` is a UMD package that embeds the WASM as base64 in the JS; use it when there is no bundler or the bundler mishandles WASM; slightly different init (`await RAPIER.init()` per the guide's pattern **[BG on exact call]**).
- KinematicCharacterController (JS): `world.createCharacterController(offset)` (guide uses 0.01; "not recommended" to change after creation; increase if the character gets stuck). `computeColliderMovement(collider, desiredTranslation)` then read corrected movement. `setUp(vec)`. Slopes: `setMaxSlopeClimbAngle(rad)`, `setMinSlopeSlideAngle(rad)`. `enableAutostep(maxHeight, minWidth, includeDynamic)` (guide example 0.5, 0.2, true); autostep only activates if touching the floor right before the obstacle. `enableSnapToGround(distance)` needs: touching ground at start, slight downward movement, ground within distance (example 0.5) at end. Optional filter flags/groups on `computeColliderMovement`; collision events readable afterward.
- Core CHANGELOG: autostep disabled by default since v0.19.0; snap-to-ground triggers on any non-upward move since v0.35.0 (no grounded flicker); `move_shape` respects slope angles since v0.23.0.
- Determinism (JS doc): the WASM/JS Rapier is "fully cross-platform deterministic" for identical initial conditions, same Rapier version, same creation/removal order; `world.takeSnapshot()` hash identical across machines. Inputs must themselves be deterministic: the doc explicitly warns `Math.sin`/`Math.cos` are not cross-platform deterministic.

Decision:
- Use `@dimforge/rapier3d-compat` initially (zero WASM config on Vite, iPad Safari); switch to non-compat + vite-plugin-wasm only if bundle size matters. Pin the exact version.
- Physics only for player capsule + static bunker colliders, stepped on the render side; it is not inside the 10 Hz sim, so Rapier determinism is a bonus, not a dependency.
- Controller: offset 0.01, autostep about 0.3 m, snap-to-ground about 0.3-0.5 m, max slope about 45 deg.

## 2. WebGL2 vs WebGPU (Three.js)

Key findings:
- three.js r187 is latest (30 Oct); r186 on 24 Sep. r187 notes still have a long list of WebGPURenderer fixes. `WebGLRenderer` is WebGL2-only (WebGL1 removed r163). Node materials/TSL work only with WebGPURenderer (r164). Migration churn continues (async methods deprecated r181, premultiplied alpha change r185, shadow bias changes r183).
- Docs: `WebGPURenderer` "tries to use a WebGPU backend if the browser supports WebGPU. If not, falls back to a WebGL 2 backend."
- WebKit WWDC25 post: WebGPU "now shipping in Safari 26 beta for macOS, iOS, iPadOS, and visionOS"; names Three.js, Babylon.js, PlayCanvas as working in Safari 26 beta.
- caniuse (WebGPU): Safari on iOS 26.0-27.2 "Supported"; iOS 17.4-18.7 disabled by default; desktop Safari 26.0-27.x shown as "Partial support"; Firefox still "Disabled by default" through 163; Chrome 113+ supported. Global usage 88.63% (86.83 + 1.8 partial).

Decision: Ship on `WebGLRenderer` (WebGL2). Our load (instanced belt items, few lights) does not need compute; WebGPU adds per-release API churn and iPad-driver risk, and iPads still on iPadOS 18 or earlier lack it. Keep rendering behind a thin interface and avoid TSL so `WebGPURenderer` (which falls back to WebGL2 anyway) can be tried later. Revisit if GPU-driven conveyor items are wanted.

## 3. Sim loop vs render loop

Key findings (Fix Your Timestep, opened):
- Variable dt makes behavior depend on framerate; semi-fixed (min(frame, dt) substeps) bounds dt but is not exactly reproducible due to float precision; for exact reproducibility use a fully fixed dt with an accumulator ("the renderer produces time and the simulation consumes it").
- Final recipe: clamp frameTime (0.25 s), `accumulator += frameTime`, `while (accumulator >= dt) { previous = current; integrate(current, t, dt); t += dt; accumulator -= dt }`, `alpha = accumulator/dt`, render `current*alpha + previous*(1-alpha)`.
- Spiral of death: if simulating X seconds takes more than X real seconds it never catches up; leave headroom (and clamp).

Decision: Accumulator with constant dt = 0.1 s. Time scale multiplies the real time added to the accumulator; hard-cap ticks per frame (e.g. 20, or an ~8 ms wall-clock budget) and drop excess backlog (slow visually) to avoid the spiral. Interpolate only visible things (belt item progress, survivors, doors) from prev/cur snapshots; at high scale skip interpolation. Camera/player runs at frame rate and is not interpolated from the sim.

## 4. OffscreenCanvas / Workers

Key findings:
- caniuse OffscreenCanvas: Safari 17.0+ supported (16.2-16.6 partial); Safari on iOS 17.0+ supported (16.2-16.7 partial); Chrome 69+, Firefox 105+; 96.95% global. MDN: Baseline since March 2023 (the three.js manual text saying "only Chrome" is outdated).
- three.js manual: worker gets canvas via `transferControlToOffscreen()` + `postMessage(..., [offscreen])`; workers cannot access DOM, mouse or keyboard events, so sizes and input must be forwarded as messages; manual recommends feature-detecting and falling back to main-thread rendering.

Decision: Do NOT render in a worker (input forwarding, pointer lock and touch live on main thread, iPad debugging cost). DO design the pure-TS sim to be movable into a Web Worker (commands in, snapshots out via transferable typed arrays; avoid SharedArrayBuffer since it needs COOP/COEP headers). Start main-thread with a time budget; move to a worker if x100 profiling demands.

## 5. ECS

Key findings:
- bitECS README (current): `createWorld`, `addEntity`, `addComponent`, `removeEntity`, `query(world,[A,B])`; entity ids are numbers (recycled immediately unless versioning); components can be typed-array SoA, plain arrays or objects; systems are plain functions; docs add relations, hierarchies, prefabs, observers. About 5 kb minzipped, zero deps. Version not stated on the pages read, and no benchmarks given.
- miniplex README: entities are plain objects (identity, not ids); archetype-style queries (`world.with/without/where`); no systems/scheduler; iterate with `for...of` (reverse, safe removal); `where` predicates need manual `reindex`; use marker components for changing state.

Decision: No general ECS in the sim core. At a few hundred entities + 2,000 belt items, plain data-oriented code wins: typed-array SoA for belt items (progress, lane, type, belt id) and id-indexed arrays of plain records for machines/survivors/rooms. Reasons: stable id iteration order (determinism), trivially serializable for saves/worker transfer, zero dependency. bitECS is the better fit if a query layer is wanted later (numeric ids, SoA); miniplex's object identity complicates serialization. Keep the sim ECS-agnostic.

## 6. iPad Safari constraints

Key findings:
- Pointer Lock: caniuse "Pointer Lock API" shows desktop Safari 10.1+ supported but Safari on iOS "Not supported" for every version listed (3.2-27.2). MDN notes Pointer Lock is not Baseline. (caniuse's iOS row also covers iPadOS; I did not find iPad-specific evidence.)
- Low Power Mode rAF cap: **[SNIPPET]** WebKit bug 215745 says rAF is intentionally throttled to 30 fps in Low Power Mode (iOS 14+; iOS 13 behavior was a bug); a Dec 2025 WebKit commit reportedly still tests ~30 fps in low-power mode. Page not opened.
- Memory: three.js forum thread "Issues with complex scene on iOS" (opened): ~45 MB of assets crashed/reloaded an iPhone 8 repeatedly, the author suspects RAM and says no way exists to query available RAM. **[SNIPPET]** WebKit bug 300782 reports pages killed under memory pressure and reload loops with no JS-visible error and no `webglcontextlost`; no reliable per-device number found. Treat any numeric limit (e.g. 500 MB, ~640 MB) as unconfirmed.
- Page Visibility / rAF pause in background tabs: **[BG]** standard behavior; not verified.

Decision: Dual input path: desktop = Pointer Lock + keyboard/mouse; iPad = touch (virtual stick + drag-look) and, for keyboard/trackpad, drag-look/`pointermove`, because Pointer Lock cannot be assumed on iPadOS; feature-detect `requestPointerLock`. Use delta time everywhere (30/60/120 Hz); cap pixel ratio (about 1.5-2); KTX2 compressed textures, InstancedMesh, dispose assets between scenes; budget memory conservatively (measure on a real iPad early; no authoritative cap known); save on `visibilitychange`/`pagehide`; plan for tab reloads (autosave).

## 7. Deterministic JS simulation

Key findings:
- Rapier JS doc (opened): `Math.sin`/`Math.cos` are not cross-platform deterministic.
- **[SNIPPET]** search results: ECMA-262 does not pin down sin/cos results; a Codeberg issue reports two V8 versions diverging on sin/cos while `Math.sqrt` (IEEE exact) agrees; the trigfills library exists because Firefox and Chrome trig output broke a simulation. Not opened.
- **[BG]** `+ - * /` and `Math.sqrt` on doubles are IEEE-754 exact in all engines; JS has no fused multiply-add; `Math.imul` and `|0` integer math are exact.

Decision:
- Sim uses only `+ - * /`, `Math.sqrt`, `floor/abs/min/max`, `Math.imul`. No `sin/cos/tan/exp/log/pow/atan2` in the sim; precompute tables with exact arithmetic if needed.
- Prefer integers/fixed-point (e.g. 1/1024 units) for belt positions and timers; time is an integer tick count; constant dt.
- Single seeded PRNG (sfc32 or mulberry32 using `Math.imul`/`>>>0`), state stored in saves; never `Math.random`/`Date.now` in sim; derive per-subsystem streams.
- Iterate in stable id order. Hash sim state (e.g. FNV-1a over typed arrays) every N ticks and run replay tests in CI (Node vs WebKit) comparing hashes.

## Sources opened
- https://rapier.rs/docs/user_guides/javascript/getting_started_js - packages, compat UMD with base64 WASM, version 0.21 guide.
- https://rapier.rs/docs/user_guides/javascript/character_controller - KCC offset, slopes, autostep, snap-to-ground APIs.
- https://rapier.rs/docs/user_guides/javascript/determinism - JS build cross-platform deterministic; Math.sin/cos warning.
- https://raw.githubusercontent.com/dimforge/rapier/master/CHANGELOG.md - v0.36.1, determinism, KCC history.
- https://github.com/dimforge/rapier - README (features).
- https://github.com/dimforge/rapier.js - archived/merged notice.
- https://gafferongames.com/post/fix_your_timestep/ - accumulator + interpolation recipe, spiral of death.
- https://threejs.org/manual/pages/offscreencanvas.html - worker rendering, no DOM/input in workers.
- https://threejs.org/docs/pages/WebGPURenderer.html - WebGPU backend with WebGL2 fallback.
- https://github.com/mrdoob/three.js/wiki/Migration-Guide - r180-r188 changes.
- https://github.com/mrdoob/three.js/releases - r187/r186 notes.
- https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas - Baseline since March 2023.
- https://developer.mozilla.org/en-US/docs/Web/API/Pointer_Lock_API - not Baseline; unadjustedMovement option.
- https://caniuse.com/webgpu - Safari/iOS WebGPU support table.
- https://caniuse.com/offscreencanvas - Safari 17+/iOS 17+ supported.
- https://caniuse.com/pointerlock - iOS Safari not supported.
- https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/ - WebGPU shipping in Safari 26 on all Apple platforms.
- https://discourse.threejs.org/t/issues-with-complex-scene-on-ios/46356 - iOS tab crash/reload from memory.
- https://github.com/NateTheGreatt/bitECS and .../docs/Intro.md - bitECS API/concepts.
- https://github.com/hmans/miniplex - miniplex README.

## Failed fetches / unconfirmed
- https://bugs.webkit.org/show_bug.cgi?id=215745, .../300782, https://codeberg.org/perplexdotgg/bounce/issues/8, popmotion rAF article: fetch returned empty; only search snippets seen (marked [SNIPPET]).
- MDN Math.sin page: no usable text extracted.
- web.dev (not allowed), caniuse iPadOS-specific pointer lock evidence (none found), Page Visibility details, authoritative iPadOS memory limits: unconfirmed.
- Earlier wrong guesses (404): github.com/jprochazk/hecs, jbhunter/miniplex, rapier.rs mdx paths.
