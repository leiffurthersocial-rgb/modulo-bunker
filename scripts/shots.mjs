// Takes greybox screenshots against `vite preview`. Usage:
//   node scripts/shots.mjs <outDir> <name> <url-query> [js-to-eval-before-shot] [profiles=desktop,ipad]
// Starts its own preview server on :4173 if none is running.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const [outDir = 'screenshots/tmp', name = 'shot', query = '', js = '', profilesArg = 'desktop,ipad'] =
  process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const base = 'http://localhost:4173';
let server;
try {
  await fetch(base);
} catch {
  server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(base);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}
const profiles = {
  desktop: { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 },
  ipad: { viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true },
};
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const errors = [];
for (const p of profilesArg.split(',')) {
  const ctx = await browser.newContext(profiles[p]);
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(`[${p}] ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`[${p}] ${e.message}`));
  await page.goto(`${base}/?${query}`);
  await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 30000 });
  if (js) await page.evaluate(js);
  await page.waitForTimeout(1200);
  const file = `${outDir}/${name}-${p}.png`;
  await page.screenshot({ path: file });
  console.log('wrote', file);
  await ctx.close();
}
await browser.close();
server?.kill();
if (errors.length) {
  console.error('CONSOLE ERRORS:\n' + errors.join('\n'));
  process.exit(1);
}
