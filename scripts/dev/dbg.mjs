import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], {
  stdio: 'ignore',
  cwd: '/home/user/modulo-bunker',
});
await new Promise((r) => setTimeout(r, 1500));
const b = await chromium.launch();
const page = await b.newPage();
page.on('console', (m) => console.log('console', m.text()));
await page.goto('http://localhost:4173/?seed=ember-07');
await page.waitForFunction(() => window.__game);
console.log(
  await page.evaluate(async () => {
    const G = window.__game;
    const p = G.player.position;
    const col = G.phys.playerCollider;
    const shape = col.shape;
    const boxes = G.bunker.colliders
      .get(0)
      .filter((b) => p.x > b.x0 && p.x < b.x1 && p.z > b.z0 && p.z < b.z1);
    return JSON.stringify({
      shapeType: shape.type,
      hh: shape.halfHeight,
      r: shape.radius,
      colY: col.translation().y,
      bodyY: p.y,
      boxes,
    });
  }),
);
await b.close();
server.kill();
