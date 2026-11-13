import { expect, test } from '@playwright/test';

type W = { __game?: { world: { state: { tick: number; rooms: unknown[] } }; runner: { speed: number } } };

test('game boots on a fixed seed, sim ticks, no console errors', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?seed=ember-07');
  await page.waitForFunction(() => (window as unknown as W).__game !== undefined);
  await page.waitForFunction(() => (window as unknown as W).__game!.world.state.tick > 5);
  const rooms = await page.evaluate(() => (window as unknown as W).__game!.world.state.rooms.length);
  expect(rooms).toBeGreaterThan(5);
  await page.screenshot({ path: `screenshots/tmp/smoke-${info.project.name}.png` });
  expect(errors).toEqual([]);
});
