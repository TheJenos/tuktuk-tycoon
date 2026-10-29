import type { Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { rollButton, turnBar } from './support/play';
import { position, seatInfos } from './support/positions';
import { choose, openTab } from './support/ui';
import { watch } from './support/watch';

/*
 * The 2D board view (settings.boardView): the same 3D scene seen straight down. It is chosen in the lobby's Settings
 * or the game menu's, takes effect at once mid-game, is saved in this browser, and a game plays on in it.
 */

const saved = (page: Page) =>
  page.evaluate(() => (JSON.parse(localStorage.getItem('tuktuk-settings') ?? '{}') as { boardView?: string }).boardView);

test('2D view from the lobby, switched back to 3D mid-game from the game menu', async ({ players }) => {
  const p = await players.open('Hana');
  const { page } = p;
  const seen = watch(page);
  await p.gotoLobby();
  await openTab(page, 'Settings');
  await choose(page.getByRole('tabpanel', { name: 'Settings' }), 'Board view', '2D');
  expect(await saved(page)).toBe('2d');

  await p.startSolo(position(seatInfos([{ name: 'Hana' }, { name: 'Kofi', bot: true }])));
  await expect(page.locator('canvas')).toBeVisible();
  // A turn plays in 2D
  await p.rig([3, 4]);
  await rollButton(page).click();
  await expect(turnBar(page)).not.toContainText('roll the dice');

  await p.openGameMenu();
  await openTab(page, 'Settings');
  const view = p.gameMenu.getByRole('radiogroup', { name: 'Board view' });
  await expect(view.getByRole('radio', { name: '2D' })).toHaveAttribute('aria-checked', 'true');
  await view.getByRole('radio', { name: '3D' }).click();
  await expect(view.getByRole('radio', { name: '3D' })).toHaveAttribute('aria-checked', 'true');
  expect(await saved(page)).toBe('3d');
  seen.check();
});

test('on a phone the 2D view is chosen in a game and kept after a reload', async ({ players }) => {
  const p = await players.open({ name: 'Hana', mobile: true });
  const { page } = p;
  const seen = watch(page);
  await p.startSolo(position(seatInfos([{ name: 'Hana' }, { name: 'Kofi', bot: true }])));
  await p.openGameMenu();
  await openTab(page, 'Settings');
  await p.gameMenu.getByRole('radiogroup', { name: 'Board view' }).getByRole('radio', { name: '2D' }).click();
  await p.gameMenu.getByRole('button', { name: /Resume/ }).click();
  expect(await saved(page)).toBe('2d');
  // After a reload the game picks up again, still in 2D
  await page.reload();
  await page.getByRole('button', { name: /^Continue solo game/ }).click();
  await p.waitStarted();
  expect(await saved(page)).toBe('2d');
  seen.check();
});
