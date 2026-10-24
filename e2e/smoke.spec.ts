import { expect, test } from '@playwright/test';

test('the app boots: a WebGL canvas behind the DOM, and no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');

  // The dev server compiles the app on the first visits of a run
  await expect(page.getByRole('heading', { name: 'Tuk-Tuk Tycoon' })).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId('app-ready')).toBeVisible();

  const canvas = page.locator('canvas');
  await expect(canvas).toHaveCount(1);
  // three.js tags the canvas once its WebGLRenderer exists, so this proves software WebGL works.
  await expect(canvas).toHaveAttribute('data-engine', /^three\.js r\d+/);

  expect(errors).toEqual([]);
});
