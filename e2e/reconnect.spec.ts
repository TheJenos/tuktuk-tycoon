import { expect, needsEmulator, test } from './support/fixtures';
import { buyPrompt, hud, playerCard, rollButton, swatch } from './support/play';
import { roomPosition } from './support/positions';

/*
 * Connection trouble mid-game: a dropped connection shows on both screens and heals by itself; a reload goes
 * straight back to the same seat; a new tab finds the game still running and rejoins it from the lobby.
 */

needsEmulator();

test('a dropped connection: a banner for Bob, Bob offline on Alice\'s screen, and both clear when he is back', async ({ table }) => {
  test.slow();
  const { alice, bob } = await table({ position: (setup) => roomPosition(setup) });
  const lost = hud(bob.page).getByRole('alert').filter({ hasText: 'Connection lost: reconnecting…' });
  const bobOnAlice = playerCard(alice.page, bob.name);
  await expect(bobOnAlice.locator('.presence.online')).toBeVisible();

  await bob.context.setOffline(true);
  await expect(lost).toBeVisible({ timeout: 60_000 });
  // The database notices the dropped socket and takes Bob's presence away
  await expect(bobOnAlice.locator('.presence.offline')).toBeVisible({ timeout: 60_000 });

  await bob.context.setOffline(false);
  await expect(lost).toHaveCount(0, { timeout: 60_000 });
  await expect(bobOnAlice.locator('.presence.online')).toBeVisible({ timeout: 60_000 });
  // And the game goes on from where it was, on both screens
  await alice.rig([1, 2]);
  await rollButton(alice.page).click();
  await buyPrompt(alice.page).getByRole('button', { name: /^Buy for/ }).click();
  await expect(swatch(bob.page, alice.name, 'Maradana Lane')).toBeVisible();
});

test('a reload goes straight back into the same seat', async ({ table }) => {
  const { code, alice, bob } = await table({ position: (setup) => roomPosition(setup) });
  const id = await bob.id();
  const seq = await bob.seq();
  await bob.page.reload();
  await bob.waitJoined();
  await bob.waitStarted();
  expect(await bob.id()).toBe(id);
  expect(await bob.mySeats()).toEqual(['s1']);
  expect(await bob.seq()).toBe(seq);
  await expect(bob.page).toHaveURL(new RegExp(`#${code}$`));

  // Still playing together
  await alice.rig([1, 2]);
  await rollButton(alice.page).click();
  await buyPrompt(alice.page).getByRole('button', { name: /^Buy for/ }).click();
  await expect(swatch(bob.page, alice.name, 'Maradana Lane')).toBeVisible();
});

test('a new tab: the lobby says the game is still running, and Rejoin takes the seat back', async ({ table }) => {
  const { code, bob } = await table({ position: (setup) => roomPosition(setup) });
  const id = await bob.id();
  const tab = await bob.reopen();
  await tab.gotoLobby();
  const banner = tab.page.locator('.rejoin-card');
  await expect(banner).toContainText(`Your game in ${code} is still running`);
  await banner.getByRole('button', { name: 'Rejoin' }).click();
  await tab.waitJoined();
  await tab.waitStarted();
  expect(await tab.id()).toBe(id);
  expect(await tab.mySeats()).toEqual(['s1']);
});
