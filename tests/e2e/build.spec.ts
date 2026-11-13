import { expect, test } from '@playwright/test';

/* eslint-disable @typescript-eslint/no-explicit-any */
test('build a room from the overview build panel', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/?seed=ember-07&view=overview');
  await page.waitForFunction(() => (window as any).__game !== undefined);
  const slotId = await page.evaluate(() => {
    const G = (window as any).__game;
    const s = G.world.state.slots.find((x: any) => x.state === 'empty' && x.floor === 0);
    G.selectedSlot = s.id;
    G.setBuild(true);
    return s.id;
  });
  await page
    .getByTestId('build-panel')
    .getByRole('button', { name: /^COMMON/ })
    .click();
  const build = page.getByTestId('build-panel').getByRole('button', { name: /Build Common room/ });
  await expect(build).toBeEnabled();
  await build.click();
  await page.waitForFunction((id) => (window as any).__game.world.slot(id).state === 'room', slotId, {
    timeout: 10_000,
  });
  const type = await page.evaluate((id) => {
    const G = (window as any).__game;
    return G.world.room(G.world.slot(id).roomId).type;
  }, slotId);
  expect(type).toBe('common');
  await expect(page.getByTestId('build-panel')).toContainText('Common room T1');
});
