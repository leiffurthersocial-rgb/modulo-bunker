import { expect, test } from '@playwright/test';

test('hello scene renders with WebGL2 and no console errors', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?seed=smoke');
  await page.waitForFunction(() => (window as unknown as { __webgl2?: boolean }).__webgl2 !== undefined);
  expect(await page.evaluate(() => (window as unknown as { __webgl2: boolean }).__webgl2)).toBe(true);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `screenshots/tmp/smoke-${info.project.name}.png` });
  expect(errors).toEqual([]);
});
