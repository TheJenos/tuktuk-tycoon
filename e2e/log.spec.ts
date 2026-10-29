import { expect, test } from './support/fixtures';
import { position, seatInfos } from './support/positions';
import { watch } from './support/watch';

/*
 * The game log folds to its header with its chevron, stays folded after a reload (remembered in this browser), and
 * opens again from the chevron, the Log button or L.
 */

test('the log collapses to its header, stays collapsed after a reload, and opens again', async ({ players }) => {
  const p = await players.open({ name: 'Jeno', viewport: { width: 1280, height: 800 } });
  const { page } = p;
  const seen = watch(page);
  await p.startSolo(position(seatInfos([{ name: 'Jeno' }, { name: 'Kasun', bot: true }])));
  const log = page.getByRole('region', { name: 'Game log' });
  await expect(log.getByRole('log')).toBeVisible();

  await log.getByRole('button', { name: 'Hide the log' }).click();
  await expect(log.getByRole('log')).toHaveCount(0);
  await expect(log.getByRole('radiogroup', { name: 'Show' })).toHaveCount(0);

  await page.reload();
  await page.getByRole('button', { name: /^Continue solo game/ }).click();
  await p.waitStarted();
  await expect(log.getByRole('button', { name: 'Show the log' })).toBeVisible();
  await expect(log.getByRole('log')).toHaveCount(0);

  // L shows it while it's asked for, and folds it again after
  await page.keyboard.press('l');
  await expect(log.getByRole('log')).toBeVisible();
  await page.keyboard.press('l');
  await expect(log.getByRole('log')).toHaveCount(0);

  await log.getByRole('button', { name: 'Show the log' }).click();
  await expect(log.getByRole('log')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /^Continue solo game/ }).click();
  await p.waitStarted();
  await expect(log.getByRole('log')).toBeVisible();
  seen.check();
});
