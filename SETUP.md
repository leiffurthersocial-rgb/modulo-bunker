# SETUP.md — reproduce on your own machine

## 1. Prerequisites

- Node.js 22 LTS (or newer) and npm 10+
- git
- Optional (Phase 4): Python 3.11+, ffmpeg, KTX-Software (toktx), Blender 4.x+

macOS (Homebrew):

```bash
brew install node@22 git ffmpeg
```

```bash
brew install --cask blender
```

KTX-Software (toktx): download the installer for your OS from the Khronos GitHub releases page (KhronosGroup/KTX-Software, "Releases"), then check it with:

```bash
toktx --version
```

## 2. Clone and install

```bash
git clone https://github.com/leiffurthersocial-rgb/modulo-bunker.git
```

```bash
cd modulo-bunker && npm ci
```

Playwright browsers (on your machine, not needed in the cloud container):

```bash
npx playwright install chromium webkit
```

WebKit lets you run the e2e tests against Safari's engine locally, which is a closer check for iPad than Chromium.

## 3. Everyday commands

```bash
npm run dev
```

Opens the Vite dev server (http://localhost:5173). To test on your iPad on the same Wi-Fi network:

```bash
npm run dev -- --host
```

Then open `http://<your-computer-LAN-IP>:5173` in iPad Safari.

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

```bash
npm run e2e
```

Screenshots land in `screenshots/tmp/`.

```bash
npm run check:webgl
```

```bash
bash scripts/check-network.sh
```

## 4. Deploying to Vercel

No Vercel token is stored in the cloud environment, so deploys go through one of these routes.

**Option A (recommended): Vercel's GitHub integration.** No token in any agent environment.

1. On vercel.com: Add New, then Project, then import `leiffurthersocial-rgb/modulo-bunker`.
2. Framework preset: Vite. `vercel.json` already sets the build command and the `dist` output.
3. Each push to a branch gets a preview URL; the production branch deploys to production.

**Option B: the CLI on your machine.**

```bash
npx vercel login
```

```bash
npx vercel deploy
```

```bash
npx vercel deploy --prod
```

## 5. Phase 4 asset fetching (later)

The asset hosts (Poly Haven, ambientCG, Quaternius, Kenney, Sketchfab, Freesound, Pixabay, Hugging Face) are blocked in the cloud environment. When Phase 4 starts you can either allow them on the `modulo-bunker` environment, or run on your machine:

```bash
FREESOUND_API_KEY=... SKETCHFAB_API_TOKEN=... npx tsx scripts/fetch-assets.ts
```

```bash
npx tsx scripts/process-assets.ts
```

(These scripts are written in Phase 4. Raw downloads go into `.asset-cache/`, which is gitignored.)

## 6. Private character photos (Phase 5)

Put photos in `characters/inbox/<name>/`. That folder is gitignored and is never committed or uploaded anywhere without your explicit say-so.
