import { expect, needsEmulator, test, uniqueName } from './support/fixtures';
import { actionBar, buyPrompt, cashOn, hud, rollButton, swatch } from './support/play';
import { roomPosition } from './support/positions';
import { roomCard, waitingRoom } from './support/room';
import { openTab } from './support/ui';

/*
 * Watching: someone who comes in once the game is running (or finds every seat taken) sees everything and can
 * do nothing; the Rooms list offers Watch for a game in progress.
 */

needsEmulator();

test('joining a running game by code: watching, with no seat, and every move shown', async ({ table, players }) => {
  const { code, alice } = await table({ position: (setup) => roomPosition(setup) });
  const carol = await players.open(uniqueName('Carol'));
  await carol.gotoLobby();
  await carol.joinByCode(code);
  await carol.waitStarted();
  await expect(hud(carol.page).getByRole('status').filter({ hasText: 'Watching: you have no seat in this game' })).toBeVisible();
  expect(await carol.mySeats()).toEqual([]);
  await expect(rollButton(carol.page)).toHaveCount(0);
  await expect(actionBar(carol.page).getByRole('button', { name: /^Manage/ })).toBeDisabled();
  await expect(actionBar(carol.page).getByRole('button', { name: /^Trade/ })).toBeDisabled();
  // A spectator's hooks can't move for anyone either
  expect((await carol.dispatch({ k: 'roll' })).ok).toBe(false);

  await alice.rig([1, 2]);
  await rollButton(alice.page).click();
  await buyPrompt(alice.page).getByRole('button', { name: /^Buy for Rs\. 60/ }).click();
  await expect(swatch(carol.page, alice.name, 'Maradana Lane')).toBeVisible();
  await expect(cashOn(carol.page, alice.name)).toHaveText('Rs. 1,440');
  // Alice's own screen may hear about her purchase after Carol's does: compare the two once hers shows it too
  await expect(swatch(alice.page, alice.name, 'Maradana Lane')).toBeVisible();
  await alice.waitIdle();
  await expect.poll(() => carol.seq()).toBe(await alice.seq());
});

test('a full waiting room: the next one in watches, and the others see them watching', async ({ table, players }) => {
  const { code, alice } = await table({ room: { maxSeats: 2 } });
  const carol = await players.open(uniqueName('Carol'));
  await carol.gotoLobby();
  await carol.joinByCode(code);
  const watching = waitingRoom(carol.page).getByRole('status').filter({ hasText: "You're watching this room." });
  await expect(watching).toContainText('Every seat is taken.');
  await expect(waitingRoom(alice.page).locator('.watchers')).toContainText(`Watching: ${carol.name}`);
});

test('Rooms offers Watch for a game in progress', async ({ table, players }) => {
  const { code } = await table({ start: true });
  const carol = await players.open(uniqueName('Carol'));
  await carol.gotoLobby();
  await openTab(carol.page, 'Rooms');
  const card = roomCard(carol.page, code);
  await expect(card).toContainText('Playing');
  await card.getByRole('button', { name: `Watch E2E ${code} (${code})` }).click();
  await carol.waitJoined();
  await carol.waitStarted();
  expect(await carol.mySeats()).toEqual([]);
  await expect(hud(carol.page).getByRole('status').filter({ hasText: 'Watching: you have no seat in this game' })).toBeVisible();
});
