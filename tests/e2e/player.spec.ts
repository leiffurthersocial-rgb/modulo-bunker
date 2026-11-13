import { expect, test } from '@playwright/test';

/* eslint-disable @typescript-eslint/no-explicit-any */
const g = (page: any, fn: string) => page.evaluate(`(() => { const G = window.__game; ${fn} })()`);

test.describe('player', () => {
  test.skip(({ viewport }) => viewport?.width !== 1920, 'controller logic: desktop project only');

  test('walks, stays on the floor, and rides the elevator down', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/?seed=ember-07');
    await page.waitForFunction(() => (window as any).__game !== undefined);
    const start = await g(
      page,
      'const p = G.player.position; return { x: p.x, y: p.y, z: p.z, feet: G.player.feetY };',
    );
    // Walk forward (towards the elevator) for 0.6 s.
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(600);
    await page.keyboard.up('KeyW');
    await page.waitForTimeout(300);
    const after = await g(
      page,
      'const p = G.player.position; return { x: p.x, y: p.y, z: p.z, feet: G.player.feetY, grounded: G.player.grounded };',
    );
    expect(Math.hypot(after.x - start.x, after.z - start.z)).toBeGreaterThan(0.5);
    expect(Math.abs(after.feet - 0)).toBeLessThan(0.15);

    // Elevator: car starts at floor 0 (pos 0). Open doors by calling it, step in, send it to floor 2.
    await g(page, "G.command({ type: 'callElevator', floor: 0 });");
    await page.waitForFunction(() => (window as any).__game.world.state.elevator.doorTicks > 0);
    await g(page, 'G.player.teleport(0, 0, 1.8, Math.PI);');
    await page.waitForTimeout(400);
    await g(page, "G.command({ type: 'callElevator', floor: 2 });");
    await page.waitForFunction(
      () => Math.abs((window as any).__game.world.state.elevator.pos - 2) < 1e-6,
      null,
      {
        timeout: 30_000,
      },
    );
    await page.waitForTimeout(500);
    const ride = await g(page, 'return { feet: G.player.feetY, floor: G.player.floor };');
    expect(ride.floor).toBe(2);
    expect(Math.abs(ride.feet - -8)).toBeLessThan(0.2);
  });

  test('climbs down and up the ladder', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('/?seed=ember-07');
    await page.waitForFunction(() => (window as any).__game !== undefined);
    // Ladder column is at the back-left corner of the landing.
    await g(page, 'G.player.teleport(-1.6, 0.05, -3.6, 0);');
    await page.waitForTimeout(300);
    expect(await g(page, 'return G.player.mode;')).toBe('ladder');
    await page.keyboard.down('KeyS');
    await page.waitForFunction(() => (window as any).__game.player.feetY < -3.9, null, { timeout: 15_000 });
    await page.keyboard.up('KeyS');
    // Step off onto floor 2's landing (towards +x).
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(900);
    await page.keyboard.up('KeyD');
    await page.waitForTimeout(400);
    const off = await g(page, 'return { floor: G.player.floor, mode: G.player.mode, feet: G.player.feetY };');
    expect(off.floor).toBe(1);
    expect(off.mode).toBe('walk');
    expect(Math.abs(off.feet - -4)).toBeLessThan(0.2);
  });

  test('overview mode toggles with Tab', async ({ page }) => {
    await page.goto('/?seed=ember-07');
    await page.waitForFunction(() => (window as any).__game !== undefined);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);
    expect(await g(page, 'return G.mode;')).toBe('overview');
  });
});
