import { expect, test } from '@playwright/test';

/* eslint-disable @typescript-eslint/no-explicit-any */
test('refit the empty bay through the manage panel', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/?seed=ember-07');
  await page.waitForFunction(() => (window as any).__game !== undefined);
  const roomId = await page.evaluate(() => {
    const G = (window as any).__game;
    const r = G.world.state.rooms.find((x: any) => x.type === 'empty');
    G.setMode('overview');
    G.selected = { kind: 'cell', cellId: r.cellIds[0] };
    G.setBuild(true);
    return r.id;
  });
  const panel = page.getByTestId('build-panel');
  await panel.getByRole('button', { name: /^FARM/ }).click();
  const refit = panel.getByRole('button', { name: /Refit → Hydroponics farm/ });
  await expect(refit).toBeEnabled();
  await refit.click();
  await page.waitForFunction((id) => (window as any).__game.world.room(id).type === 'hydroponics', roomId, {
    timeout: 10_000,
  });
  await expect(panel).toContainText('Hydroponics farm T1');
});

test('assign a survivor to a room through the tablet', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/?seed=ember-07');
  await page.waitForFunction(() => (window as any).__game !== undefined);
  const { name, kitchenId } = await page.evaluate(() => {
    const G = (window as any).__game;
    G.setTablet(true);
    return {
      name: G.world.state.survivors[0].name,
      kitchenId: G.world.state.rooms.find((r: any) => r.type === 'kitchen').id,
    };
  });
  const tablet = page.getByTestId('tablet');
  await expect(tablet).toBeVisible();
  await tablet.getByLabel(`Assign ${name}`).selectOption(String(kitchenId));
  await page.waitForFunction(
    (id) => (window as any).__game.world.state.survivors[0].assignedRoom === id,
    kitchenId,
    { timeout: 10_000 },
  );
});
