import type { Locator, Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { playerCard } from './support/play';
import { position, seatInfos } from './support/positions';
import { choose, confirm, openTab, setRange } from './support/ui';
import { watch } from './support/watch';

/*
 * Settings are saved in this browser as they change (tuktuk-settings, tuktuk-name): the lobby's Settings view and the
 * game menu's are two views of the same store, and both survive a reload.
 */

const settingsPanel = (page: Page) => page.getByRole('tabpanel', { name: 'Settings' });
const radio = (scope: Locator, group: string, option: string) =>
  scope.getByRole('radiogroup', { name: group }).getByRole('radio', { name: option, exact: true });
const range = (scope: Locator, label: string) =>
  scope.locator('label.lobby-setting.range', { hasText: label }).locator('input[type=range]');
const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('tuktuk-settings') ?? '{}') as Record<string, unknown>);

test('lobby Settings are saved as they change, survive a reload, and Reset puts the defaults back', async ({ players }) => {
  const p = await players.open('Sam');
  const { page } = p;
  const seen = watch(page);
  await p.gotoLobby();
  await openTab(page, 'Settings');
  const panel = settingsPanel(page);
  const flag = (name: string) => panel.getByRole('checkbox', { name, exact: true });

  await choose(panel, 'Graphics quality', 'Medium');
  await choose(panel, 'Animation speed', 'Fast');
  await flag('Reduce motion').check();
  await expect(page.locator('html')).toHaveClass(/reduce-motion/);
  await flag("Show each player's net worth").uncheck();
  // Sound and music start off for the tests (and the e2e build never makes a sound): each volume follows its switch
  await expect(range(panel, 'Effects volume')).toBeDisabled();
  await expect(range(panel, 'Music volume')).toBeDisabled();
  await flag('Sound effects').check();
  await expect(range(panel, 'Effects volume')).toBeEnabled();
  await setRange(range(panel, 'Effects volume'), 0.35);
  await flag('Music').check();
  await setRange(range(panel, 'Music volume'), 0.2);
  await setRange(range(panel, 'Panel size'), 1.2);
  await expect(panel.locator('label.lobby-setting.range', { hasText: 'Effects volume' })).toContainText('35%');
  await expect(panel.locator('label.lobby-setting.range', { hasText: 'Music volume' })).toContainText('20%');
  await expect(panel.locator('label.lobby-setting.range', { hasText: 'Panel size' })).toContainText('120%');
  expect(await saved(page)).toMatchObject({ quality: 'medium', animSpeed: 'fast', reduceMotion: true, showNetWorth: false, sound: true, volume: 0.35, music: true, musicVolume: 0.2, uiScale: 1.2 });

  await page.reload();
  await openTab(page, 'Settings');
  await expect(radio(panel, 'Graphics quality', 'Medium')).toHaveAttribute('aria-checked', 'true');
  await expect(radio(panel, 'Animation speed', 'Fast')).toHaveAttribute('aria-checked', 'true');
  await expect(flag('Reduce motion')).toBeChecked();
  await expect(page.locator('html')).toHaveClass(/reduce-motion/);
  await expect(flag("Show each player's net worth")).not.toBeChecked();
  await expect(flag('Sound effects')).toBeChecked();
  await expect(range(panel, 'Effects volume')).toHaveValue('0.35');
  await expect(flag('Music')).toBeChecked();
  await expect(range(panel, 'Music volume')).toHaveValue('0.2');
  await expect(range(panel, 'Panel size')).toHaveValue('1.2');

  await confirm(panel.getByRole('button', { name: 'Reset to defaults' }));
  await expect(radio(panel, 'Graphics quality', 'High')).toHaveAttribute('aria-checked', 'true');
  await expect(radio(panel, 'Animation speed', 'Normal')).toHaveAttribute('aria-checked', 'true');
  await expect(flag('Reduce motion')).not.toBeChecked();
  await expect(flag("Show each player's net worth")).toBeChecked();
  await expect(range(panel, 'Panel size')).toHaveValue('1');
  expect(await saved(page)).toMatchObject({ quality: 'high', animSpeed: 'normal', reduceMotion: false, showNetWorth: true, uiScale: 1 });
  seen.check();
});

test('renaming in Settings: a bad name is refused, a good one is kept after a reload', async ({ players }) => {
  const p = await players.open('Sam');
  const { page } = p;
  await p.gotoLobby();
  await openTab(page, 'Settings');
  const panel = settingsPanel(page);
  const input = panel.getByLabel('Your name');
  await expect(input).toHaveValue('Sam');
  await expect(panel.getByRole('button', { name: 'Rename' })).toBeDisabled();

  await input.fill('S');
  await panel.getByRole('button', { name: 'Rename' }).click();
  await expect(panel.getByRole('alert')).toHaveText('Names are 2–16 characters: letters, numbers, spaces, - or _.');
  await input.fill('Samira');
  await panel.getByRole('button', { name: 'Rename' }).click();
  await expect(panel.getByRole('status')).toContainText('Saved.');
  await expect(page.locator('.lobby-profile')).toContainText('Samira');

  await page.reload();
  await expect(page.locator('.lobby-profile')).toContainText('Samira');
  expect(await page.evaluate(() => localStorage.getItem('tuktuk-name'))).toBe('Samira');
  // A new game seats the new name
  await page.getByRole('button', { name: /Play now/ }).click();
  await p.waitStarted();
  await expect(playerCard(page, 'Samira')).toBeVisible();
});

test("the game menu's Settings are the lobby's: a change in a game shows at once and is there in the lobby", async ({ players }) => {
  const p = await players.open('Sam');
  const { page } = p;
  const seen = watch(page);
  await p.startSolo(position(seatInfos([{ name: 'Sam' }, { name: 'Ava', bot: true }])));
  const worth = playerCard(page, 'Sam').locator('small[title="Net worth"]');
  await expect(worth).toBeVisible();

  await p.openGameMenu();
  await openTab(page, 'Settings');
  await p.gameMenu.getByRole('checkbox', { name: "Show each player's net worth" }).uncheck();
  await choose(p.gameMenu, 'Graphics quality', 'Medium');
  await p.gameMenu.getByRole('button', { name: /^Resume/ }).click();
  await expect(p.gameMenu).toBeHidden();
  await expect(worth).toHaveCount(0);

  await p.leave();
  await openTab(page, 'Settings');
  const panel = settingsPanel(page);
  await expect(panel.getByRole('checkbox', { name: "Show each player's net worth" })).not.toBeChecked();
  await expect(radio(panel, 'Graphics quality', 'Medium')).toHaveAttribute('aria-checked', 'true');

  // And back in the game after a reload, it still holds
  await page.reload();
  await page.getByRole('button', { name: /^Continue solo game/ }).click();
  await p.waitStarted();
  await expect(playerCard(page, 'Sam')).toBeVisible();
  await expect(worth).toHaveCount(0);
  seen.check();
});
