import { expect, test } from '@playwright/test';

/* eslint-disable @typescript-eslint/no-explicit-any */
const g = (page: any, fn: string) => page.evaluate(`(() => { const G = window.__game; ${fn} })()`);

test.describe('player (first person)', () => {
  test.skip(({ viewport }) => viewport?.width !== 1920, 'controller logic: desktop project only');

  test('walks and stays on the floor', async ({ page }) => {
    await page.goto('/?seed=ember-07');
    await page.waitForFunction(() => (window as any).__game !== undefined);
    const start = await g(
      page,
      'const p = G.player.position; return { x: p.x, z: p.z, level: G.player.level };',
    );
    await page.keyboard.down('KeyW');
    await page.waitForFunction(
      (s0: { x: number; z: number }) => {
        const p = (window as any).__game.player.position;
        return Math.hypot(p.x - s0.x, p.z - s0.z) > 0.8;
      },
      start,
      { timeout: 15_000 },
    );
    await page.keyboard.up('KeyW');
    await page.waitForTimeout(300);
    const after = await g(
      page,
      'const p = G.player.position; return { x: p.x, z: p.z, feet: G.player.feetY, level: G.player.level };',
    );
    expect(Math.hypot(after.x - start.x, after.z - start.z)).toBeGreaterThan(0.5);
    expect(after.level).toBe(start.level);
    expect(Math.abs(after.feet - -4 * start.level)).toBeLessThan(0.15);
  });

  test('rides an elevator down to another level', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/?seed=ember-07');
    await page.waitForFunction(() => (window as any).__game !== undefined);
    const info = await g(
      page,
      `const sh = G.world.state.shafts.find(s => s.kind === 'elevator');
       const lv = G.player.level;
       const landings = [];
       for (let y = sh.top; y <= sh.bottom; y++) { const c = G.world.cellAt(sh.x, y, sh.z); if (c && G.world.linksOf(c.id).length) landings.push(y); }
       return { id: sh.id, x: sh.x * 6 + 3, z: sh.z * 6 + 3, start: lv, target: landings[landings.length - 1] };`,
    );
    await g(page, `G.command({ type: 'callElevator', shaftId: ${info.id}, level: ${info.start} });`);
    await page.waitForFunction(
      (lv: number) => {
        const el = (window as any).__game.world.state.elevators[0];
        return el.doorTicks > 0 && Math.abs(el.pos - lv) < 1e-6;
      },
      info.start,
      { timeout: 30_000 },
    );
    await g(page, `G.player.teleport(${info.x}, ${-4 * info.start}, ${info.z}, 0);`);
    await page.waitForTimeout(300);
    await g(page, `G.command({ type: 'callElevator', shaftId: ${info.id}, level: ${info.target} });`);
    await page.waitForFunction(
      (t: number) => Math.abs((window as any).__game.world.state.elevators[0].pos - t) < 1e-6,
      info.target,
      { timeout: 45_000 },
    );
    await page.waitForTimeout(500);
    const ride = await g(page, 'return { feet: G.player.feetY, level: G.player.level };');
    expect(ride.level).toBe(info.target);
    expect(Math.abs(ride.feet - -4 * info.target)).toBeLessThan(0.2);
  });

  test('climbs down a ladder to the level below', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('/?seed=ember-07');
    await page.waitForFunction(() => (window as any).__game !== undefined);
    const lad = await g(
      page,
      `const lv = G.player.level; const sh = G.world.state.shafts.find(s => s.kind === 'ladder' && !s.broken && s.top <= lv && s.bottom > lv);
       return { x: sh.x * 6 + 0.4, z: sh.z * 6 + 0.4, lv };`,
    );
    await g(page, `G.player.teleport(${lad.x}, ${-4 * lad.lv + 0.05}, ${lad.z}, 0);`);
    await page.waitForTimeout(300);
    expect(await g(page, 'return G.player.mode;')).toBe('ladder');
    await page.keyboard.down('KeyS');
    await page.waitForFunction(
      (lv: number) => (window as any).__game.player.feetY < -4 * (lv + 1) + 0.1,
      lad.lv,
      {
        timeout: 15_000,
      },
    );
    await page.keyboard.up('KeyS');
    await page.keyboard.down('KeyD');
    await page.waitForFunction(() => (window as any).__game.player.mode === 'walk', null, {
      timeout: 15_000,
    });
    await page.waitForTimeout(300);
    await page.keyboard.up('KeyD');
    await page.waitForTimeout(400);
    const off = await g(page, 'return { level: G.player.level, mode: G.player.mode, feet: G.player.feetY };');
    expect(off.level).toBe(lad.lv + 1);
    expect(off.mode).toBe('walk');
  });

  test('Tab opens the map overview', async ({ page }) => {
    await page.goto('/?seed=ember-07');
    await page.waitForFunction(() => (window as any).__game !== undefined);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);
    expect(await g(page, 'return G.mode;')).toBe('overview');
  });
});
