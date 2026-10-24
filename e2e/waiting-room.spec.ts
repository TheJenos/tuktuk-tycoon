import { db, waitForValue } from './support/db';
import { expect, needsEmulator, test } from './support/fixtures';
import { playersPanel } from './support/play';
import { seatCard, startButton, waitingRoom } from './support/room';
import { confirm, openTab } from './support/ui';

/*
 * The waiting room: who sits where and who's online, the owner's controls (bots, rules, kicking, Start) and what
 * everyone else sees of them, the invite, giving up a seat, and leaving.
 */

needsEmulator();

test('owner and guest: the owner adds, changes and removes a bot and sets the rules; the guest sees it all', async ({ table }) => {
  const { code, alice, bob } = await table();
  const aw = waitingRoom(alice.page);
  const bw = waitingRoom(bob.page);
  await expect(startButton(alice.page)).toBeEnabled();
  await expect(startButton(bob.page)).toHaveCount(0);
  await expect(bw.getByRole('status').filter({ hasText: 'Waiting for' })).toHaveText(`Waiting for ${alice.name} to start`);
  await expect(seatCard(bob.page, alice.name).locator('.badge', { hasText: 'Host' })).toBeVisible();
  await expect(seatCard(bob.page, bob.name).locator('.badge', { hasText: 'You' })).toBeVisible();
  await expect(seatCard(alice.page, bob.name).getByRole('img', { name: 'Online' })).toBeVisible();
  await expect(seatCard(bob.page, alice.name).getByRole('img', { name: 'Online' })).toBeVisible();
  // Only the owner gets the seat controls
  await expect(bw.getByRole('button', { name: '＋ Add bot' })).toHaveCount(0);
  await expect(seatCard(bob.page, alice.name).getByRole('button', { name: 'Kick' })).toHaveCount(0);

  // A bot: added at Easy, made Hard, then removed
  await aw.getByLabel('Level of the next bot').selectOption('easy');
  await aw.getByRole('button', { name: '＋ Add bot' }).click();
  await expect(seatCard(bob.page, 'Ava').locator('.badge.bot')).toHaveText('Bot · Easy');
  await expect.poll(() => db.get(`lobby/${code}/seatsTaken`)).toBe(3);
  await aw.getByLabel("Ava's level").selectOption('hard');
  await expect(seatCard(bob.page, 'Ava').locator('.badge.bot')).toHaveText('Bot · Hard');
  await aw.getByRole('button', { name: 'Remove Ava' }).click();
  await expect(seatCard(bob.page, 'Ava')).toHaveCount(0);
  await expect.poll(() => db.get(`lobby/${code}/seatsTaken`)).toBe(2);

  // The rules: a form for the owner, a summary for everyone else
  await openTab(alice.page, 'Rules');
  await alice.page.getByRole('tabpanel', { name: 'Rules' }).getByRole('checkbox', { name: 'Speed Die' }).check();
  await openTab(bob.page, 'Rules');
  await expect(bob.page.getByRole('tabpanel', { name: 'Rules' }).getByRole('checkbox')).toHaveCount(0);
  await expect(bob.page.getByRole('tabpanel', { name: 'Rules' })).toContainText('Classic with the Speed Die');
  await expect.poll(() => db.get(`lobby/${code}/speedDie`)).toBe(true);
});

test('the owner removes a guest: the guest is back in the lobby and told why', async ({ table }) => {
  const { code, alice, bob } = await table();
  const bobId = await bob.id();
  await confirm(seatCard(alice.page, bob.name).getByRole('button', { name: 'Kick' }));
  await expect(bob.page.locator('#lobby')).toBeVisible();
  await expect(bob.page.locator('#lobby').getByRole('alert')).toContainText('You were removed from that room.');
  await expect(bob.page).not.toHaveURL(/#/);
  await expect(seatCard(alice.page, bob.name)).toHaveCount(0);
  expect(await db.get(`rooms/${code}/kicked/${bobId}`)).toBe(true);
  expect(await db.get(`lobby/${code}/members/${bobId}`)).toBeNull();
  // The invite link again: the same player, so the kick still applies (not a new guest with a fresh id)
  await bob.page.goto(`/?room=${code}`);
  await expect(bob.page.locator('#lobby').getByRole('alert').filter({ hasText: 'You were removed from that room.' })).toBeVisible({ timeout: 30_000 });
  expect(await db.get(`lobby/${code}/members/${bobId}`)).toBeNull();
});

test('Copy invite gives the link; a guest gives up a seat to watch, then takes one again', async ({ table }) => {
  const { code, alice, bob } = await table();
  await waitingRoom(alice.page).getByRole('button', { name: 'Copy invite' }).click();
  await expect(alice.page.locator('.lobby-toast')).toHaveText('Invite link copied: send it to your friends.');
  expect(await alice.page.evaluate(() => navigator.clipboard.readText())).toMatch(new RegExp(`\\?room=${code}$`));

  const bw = waitingRoom(bob.page);
  await bw.getByRole('button', { name: 'Give up my seat and watch' }).click();
  await expect(bw.getByRole('status').filter({ hasText: "You're watching this room." })).toBeVisible();
  await expect(seatCard(alice.page, bob.name)).toHaveCount(0);
  await expect(waitingRoom(alice.page).locator('.watchers')).toContainText(`Watching: ${bob.name}`);
  await bw.getByRole('button', { name: 'Take a seat' }).click();
  await expect(seatCard(alice.page, bob.name)).toBeVisible();
  await expect(seatCard(bob.page, bob.name).locator('.badge', { hasText: 'You' })).toBeVisible();
});

test('Start: both screens go to the game, with the room in the address', async ({ table }) => {
  const { code, alice, bob } = await table({ start: true });
  for (const p of [alice, bob]) {
    await expect(waitingRoom(p.page)).toHaveCount(0);
    await expect(playersPanel(p.page).locator('li.player-card')).toHaveCount(2);
    await expect(p.page).toHaveURL(new RegExp(`#${code}$`));
  }
  expect(await alice.mySeats()).toEqual(['s0']);
  expect(await bob.mySeats()).toEqual(['s1']);
  await waitForValue(`lobby/${code}/status`, (s) => s === 'playing');
  expect(await db.get(`rooms/${code}/setup/locked`)).toMatch(/^g_/);
});

test('a guest leaves the waiting room: the seat opens up again and the address is cleared', async ({ table }) => {
  const { code, alice, bob } = await table();
  const bobId = await bob.id();
  await confirm(waitingRoom(bob.page).getByRole('button', { name: 'Leave room' }));
  await expect(bob.page.locator('#lobby')).toBeVisible();
  await expect(bob.page).not.toHaveURL(/#/);
  await expect(seatCard(alice.page, bob.name)).toHaveCount(0);
  await waitForValue(`lobby/${code}/members`, (m) => !!m && !(bobId in (m as object)));
  await expect.poll(() => db.get(`lobby/${code}/seatsTaken`)).toBe(1);
});
