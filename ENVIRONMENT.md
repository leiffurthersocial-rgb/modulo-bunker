# ENVIRONMENT.md — Step 0 audit

Audit date: 2026-11-13. Machine: Claude Code cloud container (ephemeral; anything not pushed is lost).

## System

| Item       | Value                                                                                                                                                                                                                                                                                                                      |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OS         | Ubuntu 24.04.5 LTS, Linux 6.18 x86_64, 4 vCPU, 15 GiB RAM, no GPU                                                                                                                                                                                                                                                          |
| Disk       | 30 GB writable allowance (≈9 GB used at audit)                                                                                                                                                                                                                                                                             |
| Node / npm | v22.23.4 / 10.9.9 (pnpm 10.28 and yarn 1.22 also present)                                                                                                                                                                                                                                                                  |
| git        | 2.43.0                                                                                                                                                                                                                                                                                                                     |
| Python     | 3.13.18 (pip works through the proxy; PyPI allowed)                                                                                                                                                                                                                                                                        |
| ffmpeg     | 6.1.1 (apt build) — available                                                                                                                                                                                                                                                                                              |
| GitHub CLI | `gh` installed, but **not authenticated** (`GH_TOKEN` invalid). In this environment GitHub access goes through the GitHub MCP tools and a git proxy that is scoped to `leiffurthersocial-rgb/modulo-bunker` only. Push works for this repo; the GitHub REST API refuses other repos (e.g. KhronosGroup release downloads). |
| Vercel CLI | `vercel@65.15.0` runs via `npx vercel`. **Not authenticated**: you declined to store a token in this cloud environment, so no deploy was made from here. See SETUP.md for two deploy routes.                                                                                                                               |

## Browser / WebGL

- Chromium for Playwright is preinstalled at `/opt/pw-browsers` (build 1243, matching Playwright **1.63.0**). The project pins `playwright` and `@playwright/test` to exactly `1.63.0` so they find it. Don't run `playwright install` here.
- `node scripts/check-webgl.mjs` result: **WebGL2 works headless with default flags** and with `--use-angle=swiftshader --enable-unsafe-swiftshader`. In every case the renderer was `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))`, MAX_TEXTURE_SIZE 8192. `navigator.gpu` (WebGPU) was absent.
- Consequence: rendering here is **CPU software rendering**. Screenshots and correctness tests are valid. **Frame-time numbers from this container are not representative** of any real device; the Phase 3 benchmark needs a run on your Mac/PC and iPad (the route will log the numbers for you to paste back).
- A Three.js scene renders and screenshots fine. `tests/e2e/smoke.spec.ts` passes on all 3 profiles with zero console errors:
  - `desktop`: 1920×1080, DPR 1
  - `ipad-keyboard`: 1180×820, DPR 2, no touch (iPad Air 11" with Magic Keyboard / trackpad)
  - `ipad-touch`: 1180×820, DPR 2, `hasTouch` + `isMobile`, iPadOS Safari user agent
- Caveat: Chromium is not WebKit. These profiles emulate iPad viewport and touch, not Safari's engine, memory limits or pointer-lock behaviour. Real-device checks on your iPad are still needed. Playwright's WebKit build is not installed here, and installing it would need the Playwright CDN host to be allowed.

## Network (through the agent proxy)

The session started on your **Default** environment (package managers, GitHub, Vercel and some unrelated Swiss data hosts). For the research step I created a personal environment **`modulo-bunker`**, which you approved, and moved this session onto it. It allows package registries, GitHub, Vercel and 17 documentation/wiki hosts.

Result of `bash scripts/check-network.sh`:

| Host                                                                    | Status                                                    |
| ----------------------------------------------------------------------- | --------------------------------------------------------- |
| github.com, registry.npmjs.org, pypi.org                                | reachable                                                 |
| vercel.com, api.vercel.com                                              | reachable (no token stored)                               |
| fonts.googleapis.com, fonts.gstatic.com                                 | reachable                                                 |
| threejs.org, rapier.rs, gltf-transform.dev and the other research hosts | reachable (added for STEP 1)                              |
| **api.polyhaven.com, dl.polyhaven.org**                                 | **BLOCKED** (proxy 403)                                   |
| **ambientcg.com**                                                       | **BLOCKED**                                               |
| **quaternius.com**                                                      | **BLOCKED**                                               |
| **kenney.nl**                                                           | **BLOCKED**                                               |
| **sketchfab.com, api.sketchfab.com**                                    | **BLOCKED**                                               |
| **freesound.org**                                                       | **BLOCKED**                                               |
| **pixabay.com**                                                         | **BLOCKED**                                               |
| **huggingface.co**                                                      | **BLOCKED**                                               |
| cdn.jsdelivr.net, unpkg.com                                             | BLOCKED (not needed; we bundle from npm)                  |
| fallout.fandom.com (and probably other Fandom wikis)                    | host allowed, but Fandom answers 403 to scripted requests |

Notes:

- **The WebFetch tool bypasses the proxy** and keeps the machine's start-up DNS rules, so it can't reach hosts added mid-session. `curl` through the proxy works. Research pages were read with `curl | html2text`.
- Asset hosts are only needed in **Phase 4**. As you asked, I didn't work around the blocks. Two options for Phase 4:
  1. Add the asset hosts to the `modulo-bunker` environment then. Your `modulo-ragdoll` and `modulo-architect` environments already list most of them, so the host lists are known.
  2. Run `scripts/fetch-assets.ts` on your machine (commands in SETUP.md) and commit the processed outputs (not the raw cache).

## Asset tooling

| Tool                 | Status                                                                                                                                                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| gltf-transform CLI   | **installed** (`@gltf-transform/cli@4.5.1` devDependency, `npx gltf-transform`)                                                                                                                                                                                                 |
| toktx / KTX-Software | **not installable here**: not in Ubuntu apt, and the GitHub release downloads are outside this session's GitHub scope. Fallbacks: (a) install on your machine (SETUP.md); (b) the `ktx2-encoder` npm package (WASM Basis Universal encoder, v0.6.0), to be verified in Phase 4. |
| Blender (headless)   | **not installed** (optional). Two routes are available: `apt install blender` (4.0.2, old) or `pip install bpy` (5.3.0, Blender as a Python module). I'll install it in Phase 4 only if needed, to save container disk.                                                         |
| ffmpeg               | **available** (6.1.1)                                                                                                                                                                                                                                                           |
| Python               | available (`html2text` installed for research; nothing else)                                                                                                                                                                                                                    |

## Repo setup (done)

- Vite 8.3.8 + TypeScript 6.0 (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). TypeScript 7.0 is out, but typescript-eslint 8.72 supports TS < 6.1 only. See DECISIONS.md.
- ESLint 10 (flat config, typescript-eslint, eslint-config-prettier) with a rule that blocks `three` imports and DOM globals inside `src/sim` and `src/gen`.
- Prettier 3.10, Vitest 5.1, Playwright 1.63.0 (3 profiles).
- GitHub Actions `.github/workflows/ci.yml`: typecheck, lint, unit tests, build, then Playwright smoke with a screenshot artifact.
- `vercel.json`: Vite framework preset, `dist` output, `Cache-Control: public, max-age=31536000, immutable` on `/assets/*`, and explicit content types for `.wasm` (application/wasm), `.ktx2` (image/ktx2) and `.glb` (model/gltf-binary).
- `npm audit`: 1 moderate advisory (minimatch ReDoS) inside **dev-only** ESLint tooling. There is no non-breaking fix yet. It doesn't ship to players. Left as is.

## Verification run

```
npm run typecheck   ✓
npm run lint        ✓
npm test            ✓ 3 tests (seeded RNG determinism)
npm run build       ✓
npm run e2e         ✓ 3/3 profiles, WebGL2=true, no console errors
```
