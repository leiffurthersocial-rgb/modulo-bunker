# 04 - Colonists, AI, saves, controls UX, modular kits

Legend: [SRC] = stated by a page I opened (see Sources). [OURS] = our own judgment, not from a source. Nothing else is asserted.

## 1. RimWorld mood, thoughts, mental breaks
Key findings [SRC: Mood, Mental break, Thoughts]:
- Mood % = base mood (set by difficulty, e.g. 42 Peaceful ... 22 Losing is Fun) + sum of thought effects. Example: Low expectations +18, Hungry -6 on Peaceful = 54%.
- Mood has a *target* (instant sum of thoughts) and a *current* bar that moves toward it at max +12/in-game hour up, -8/hour down. So a meal fixes the target immediately but mood recovers gradually.
- Thought table columns: Mood Effect, Expiration time (days), Stack Limit, Stacking Multiplier. Need-state thoughts have no expiry (N/A, stack 1): Hungry -6, Ravenously hungry -12 (mutually exclusive stages). Event memories expire (e.g. Tox water -8, 0.1 day, stack 1).
- Three break tiers matching mood bands (Stressed / On edge / About to break). Base threshold stat 35%: minor 35%, major 20% (4/7 of minor), extreme 5% (1/7 of minor). Traits add to thresholds (Steadfast lowers, Nervous raises).
- Per-tier mean time between breaks while below threshold: minor 4 days, major 0.8 days, extreme 0.5 days. Each tier has its own pool of break types (minor: hide in room; extreme: murder).
- After a break: Catharsis thought +40 for 3 days, stacks up to 5 times with diminishing effect, which prevents break spirals. Thoughts are NOT reset.
- Pawn must be awake and mobile to break (sleeping pawns cannot).
Decision [OURS]: implement mood as base + sum(thoughts); thought = {id, value, expiresTick|null, stackKey, stackLimit}; displayed mood eases toward target at asymmetric rates (up faster than down). Break check every N sim seconds per survivor using seeded RNG with MTB per tier (start with scaled RimWorld values), plus Catharsis-style post-break thought and a "no break while asleep" rule. Stress need maps to a threshold modifier.

## 2. RimWorld storyteller
Key findings [SRC: Storyteller, Raid points, Cassandra Classic, Randy Random]:
- Event frequency/type depends on colony wealth, building wealth, colonist count, animal count, recent death/severe wounds, and time since last major event.
- Raid Points = (WealthPoints + PawnPoints) * Difficulty * StartingFactor * AdaptionFactor; min 35, max 10,000. Storyteller Wealth = items + creatures + 0.5 * buildings; wealth points are linear from 0 at 14,000 to 2,400 at 400,000.
- Starting factor eases the opening (0.7 at day 10, ~1 after 40 days). Adaption factor (range 0.4-1.47) rises when the colony is doing well and drops after colonist deaths/downings, decaying over days.
- Cassandra: fixed cycle from day 11, 4.6-day "On" phase (1 or 2 major threats, 50/50, at least 1.9 days apart) and 6-day "Off" phase. Randy: random events any time, raid points multiplied by 0.5x-1.5x.
- PopulationIntent scales incident chance for colonist-adding events: IncreaseEasy = max(PopulationIntent - 0.4, min), IncreaseMedium = max(PI, min), IncreaseHard = max(PI + 0.4, min); chance = baseChance * that factor; PI is a function of population and days at location; prisoners count half.
Decision [OURS]: director holds threatBudget = f(wealth, survivors) * adaption, adaption nudged by recent injuries/deaths; Cassandra-like on/off tension windows with seeded jitter; incident defs carry baseChance, cooldownDays, populationEffect. Since we have 4 survivors, add a "rescue/new survivor" incident family driven by population intent. All draws from the seeded RNG; director state is saved.

## 3. Utility AI
Key findings [SRC: Game AI Pro ch. 9 "Introduction to Utility Theory"; ch. 13 (vol. 3) "Choosing Effective Utility-Based Considerations"]:
- Normalize every input to [0,1]; each action has a weight; pick the highest score, or use scores as weights for weighted random among top choices (ch. 9). Combine factors by averaging, multiplying, min/max, optionally weighted.
- Curves: linear U = x/m; quadratic (slow start, steep end; rotate it to model hunger); logistic U = 1/(1+e^-x) with tunable steepness; piecewise linear for designer-tuned curves.
- Ch. 13 model: each action (DSE) has considerations; each raw input is normalized to [0,1], passed through a data-driven response curve, and the scores are multiplied. Cooldown is a consideration whose curve returns near 0 until the cooldown ends.
- Inertia (ch. 9): add weight to the current action, or enter a cooldown during which staying has very high weight, or delay re-decision until the action finishes; reason given: oscillation when two actions score similarly.
- I did not find the "compensation factor" formula in either chapter (not verified; GDC Vault not reachable).
Decision [OURS]: actions in JSON: {id, weight, considerations:[{input, curve:{type,params}}]}; score = weight * product(curves). Because multiplying many terms drags scores down, add a compensation step (our own: geometric-mean-style correction) - test in unit tests. Inertia: bonus (+~15%) for current action and a minimum commit time; re-decide at ~2 Hz, not every 10 Hz tick. Needs drive utility through quadratic/logistic curves so urgency rises sharply near critical.

## 4. Saves and determinism
Key findings [SRC: Gaffer Deterministic Lockstep, Floating Point Determinism; Factorio FFF-55, FFF-76]:
- Determinism = same initial state + same inputs gives bit-identical results; checksum of full state each frame must match. Same delta time is a precondition (Gaffer).
- Hidden nondeterminism example: a physics engine using an internal RNG for constraint order; fix was seeding it per frame (Gaffer). Factorio: "unpredictable events can leak into the game" if the programmer is not careful (FFF-76).
- Float results can differ across compilers, OS, instruction sets, debug vs release; same binary+architecture can be made deterministic; cross-platform needs strict IEEE mode and restricted ops with perf cost (Gaffer FP article). Note: this concerns native code; JS uses IEEE doubles but I did not verify JS cross-engine behavior.
- Send inputs per frame, simulate frame n only when input n is present; playout/latency buffer smooths jitter (Gaffer; Factorio "latency" interval delays local actions).
- Factorio debugging: cheap heuristic CRC every tick, full game-state CRC every tick for deep debugging, and diffing saves taken at the desync (with human-readable tags in a debug build).
- Save versioning/migration articles: not researched (no allowed source found).
Decision [OURS]: fixed 10 Hz step; one seeded PRNG whose state is saved; stable entity iteration order (by id); no Math.random/Date in sim; prefer integer or quantized values for sim state where cheap. Add per-tick (or every-N) state hash in dev, and a replay test: run N ticks from save twice, compare hashes. Saves: {schemaVersion, seed, tick, rng, state}; chain of pure migrations v(n)->v(n+1) applied at load; fixture save per version in tests.

## 5. First-person controller and touch
Key findings [SRC: MDN Pointer Lock API, Pointer events multi-touch]:
- requestPointerLock() on the canvas (promise-based); option unadjustedMovement:true gives raw input without OS acceleration. Pointer events support multiple simultaneous pointers (needed for joystick + look at once on iPad).
- Not researched (no allowed source): acceleration values, coyote time, head bob, step-up, mobile FPS control design.
Decision [OURS]: input layer outputs one intent struct {moveX, moveZ, lookDX, lookDY, interact}; desktop via pointer lock + keys, iPad via pointerId-tracked floating left joystick and right-side drag look, tap center reticle to interact. Accelerate toward target velocity with separate ground accel/decel; step-up probe ~0.3 m; subtle head bob with off option. Tune by feel.

## 6. Modular kit
Key findings: Joel Burgess's Skyrim modular talk could not be read (connection reset). Subnautica habitat building not researched (not allowed).
Decision [OURS]: 6x3.5x8 m cells on a grid; module origin at cell corner; typed sockets (door, vent, pipe, cable) at fixed local positions on faces; adjacency valid only if socket types match; per-cell light setup/ambient so any assembly lights consistently; one function per room via silhouette and light color for readability.

## 7. Project Zomboid moodles
Not researched (host not allowed). Decision [OURS]: need icons with 4 severity steps, hidden when fine.

## Sources opened
- https://rimworldwiki.com/wiki/Mood - base mood, target vs bar rates, example
- https://rimworldwiki.com/wiki/Mental_break - tiers, 35/20/5% thresholds, MTBs, catharsis
- https://rimworldwiki.com/wiki/Thoughts - thought table columns (expiry, stack limit/multiplier), examples
- https://rimworldwiki.com/wiki/Storyteller - factors, PopulationIntent formulas
- https://rimworldwiki.com/wiki/Raid_points - raid point formula, wealth curve, factors
- https://rimworldwiki.com/wiki/Cassandra_Classic - on/off cycle
- https://rimworldwiki.com/wiki/Randy_Random - random events, 0.5-1.5x points
- https://www.gameaipro.com/GameAIPro/GameAIPro_Chapter09_An_Introduction_to_Utility_Theory.pdf - curves, inertia
- https://www.gameaipro.com/GameAIPro3/GameAIPro3_Chapter13_Choosing_Effective_Utility-Based_Considerations.pdf - DSEs, response curves, cooldown
- https://gafferongames.com/post/deterministic_lockstep/ - determinism definition, inputs, playout buffer
- https://gafferongames.com/post/floating_point_determinism/ - float determinism caveats
- https://factorio.com/blog/post/fff-55 - determinism testing, CRC
- https://factorio.com/blog/post/fff-76 - lockstep tradeoffs, latency
- https://developer.mozilla.org/en-US/docs/Web/API/Pointer_lock_API (fetched as Pointer_Lock_API) - pointer lock, unadjustedMovement
- https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events/Multi-touch_interaction - multi-pointer

## Failed fetches / not researched
- https://blog.joelburgess.com/2013/04/skyrims-modular-level-design-gdc-2013.html (and blog root): connection reset
- https://www.gameaipro.com/GameAIPro/GameAIPro_Chapter10_Dual-Utility_Reasoning.pdf: guessed URL, returned a 746-byte non-PDF
- Not allowed by instruction: Project Zomboid wiki, Subnautica wikis, GDC Vault
- No source sought/found for: save versioning articles, FPS movement feel, mobile FPS touch design, light probes in kits
