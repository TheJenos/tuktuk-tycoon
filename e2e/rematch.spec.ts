import { db, waitForValue } from './support/db';
import { expect, needsEmulator, test } from './support/fixtures';
import { cashOn, gameOver, turnBar } from './support/play';
import { roomPosition, setCash } from './support/positions';
import { confirm, openTab } from './support/ui';

/*
 * The end of a game and the next one: once only bots are left playing, the owner finishes it early (ranked by net
 * worth), everyone sees the standings, and only the owner may call a rematch, which starts a new game with the same
 * seats on every screen.
 */

needsEmulator();

test('Finish now ranks by net worth on both screens; the owner\'s Rematch starts a fresh game for both', async ({ table }) => {
  const { code, alice, bob } = await table({ position: (setup) => roomPosition(setup, { edit: (s) => setCash(s, 's1', 2500) }) });

  await alice.openGameMenu();
  // Not while Bob is still playing: hand his seat to a bot first
  await expect(alice.gameMenu.getByRole('button', { name: 'Finish now' })).toHaveCount(0);
  await openTab(alice.page, 'Players');
  await alice.gameMenu.locator('.menu-players li', { hasText: bob.name }).getByRole('button', { name: 'Let a bot play' }).click();
  await openTab(alice.page, 'Game');
  await confirm(alice.gameMenu.getByRole('button', { name: 'Finish now' }));
  // The menu gets out of the way of the standings
  await expect(alice.gameMenu).toBeHidden();
  for (const p of [alice, bob]) {
    await expect(gameOver(p.page).getByRole('heading', { level: 2 })).toHaveText(`${bob.name} wins!`);
    await expect(gameOver(p.page)).toContainText('Finished early: ranked by net worth');
    await expect(gameOver(p.page).locator('.standings li')).toHaveCount(2);
  }
  await waitForValue(`lobby/${code}/status`, (s) => s === 'finished');
  await expect(gameOver(bob.page).getByRole('button', { name: 'Rematch' })).toHaveCount(0);

  const gid = await db.get<string>(`rooms/${code}/state/gid`);
  await gameOver(alice.page).getByRole('button', { name: 'Rematch' }).click();
  await waitForValue(`rooms/${code}/state/gid`, (g) => !!g && g !== gid);
  for (const p of [alice, bob]) {
    await expect(gameOver(p.page)).toHaveCount(0);
    await expect.poll(async () => (await p.state()).phase.k).not.toBe('over');
    await expect(turnBar(p.page)).toContainText('Turn 1');
    await expect(cashOn(p.page, bob.name)).toHaveText('Rs. 150,000');
  }
  expect(await alice.mySeats()).toEqual(['s0']);
  expect(await bob.mySeats()).toEqual(['s1']);
  await waitForValue(`lobby/${code}/status`, (s) => s === 'playing');
});
