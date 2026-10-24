import { waitForValue } from './support/db';
import { expect, needsEmulator, test } from './support/fixtures';
import { badge, endTurn, rollButton, rigOthers, waitTurn } from './support/play';
import { roomPosition } from './support/positions';
import { seatCard, startButton, waitingRoom } from './support/room';
import { openTab } from './support/ui';

/*
 * The owner goes away: the room passes to the next seated player, who gets the owner's controls; mid-game the
 * chores (bots, AFK seats) move to their browser with the driver lease, so the game keeps going.
 */

needsEmulator();

test('the owner closes the tab in the waiting room: Bob owns the room and can start it', async ({ table }) => {
  const { code, alice, bob } = await table();
  const bobId = await bob.id();
  await expect(startButton(bob.page)).toHaveCount(0);
  await alice.close();

  await waitForValue(`lobby/${code}/hostId`, (v) => v === bobId, 30_000);
  await expect(startButton(bob.page)).toBeVisible();
  // Alice's seat stays (she may come back), shown offline
  await expect(seatCard(bob.page, alice.name).getByRole('img', { name: 'Offline' })).toBeVisible();
  await waitingRoom(bob.page).getByRole('button', { name: '＋ Add bot' }).click();
  await expect(waitingRoom(bob.page).locator('.seat-card.bot')).toHaveCount(1);
  await bob.startGame();
  expect(await bob.mySeats()).toEqual(['s1']);
});

test('the owner leaves mid-game: Bob takes over the room and the chores, and the bots keep playing', async ({ table }) => {
  test.slow();
  const { code, alice, bob } = await table({
    seated: async ({ alice }) => {
      await waitingRoom(alice.page).getByRole('button', { name: '＋ Add bot' }).click();
      await expect(waitingRoom(alice.page).locator('.seat-card.bot')).toHaveCount(1);
    },
    // Alice (s0) to move, then Bob (s1), then the bot (s2)
    position: (setup) => roomPosition(setup),
  });
  const [aliceId, bobId] = await Promise.all([alice.id(), bob.id()]);
  const driver = (d: unknown) => (d as { pid?: string } | null)?.pid;
  // The owner runs the chores to begin with
  await waitForValue(`rooms/${code}/driver`, (d) => driver(d) === aliceId);
  await alice.close();
  await waitForValue(`lobby/${code}/hostId`, (v) => v === bobId, 30_000);

  // As the owner now, Bob lets a bot play Alice's seat; his browser runs it once the old lease runs out
  await bob.openGameMenu();
  await openTab(bob.page, 'Players');
  const row = bob.gameMenu.locator('.menu-players li', { hasText: alice.name });
  await expect(row).toContainText('Playing');
  await rigOthers(bob, { fromTurn: true });
  await row.getByRole('button', { name: 'Let a bot play' }).click();
  await expect(row).toContainText('Away (a bot plays)');
  await bob.gameMenu.getByRole('button', { name: /^Resume/ }).click();
  await expect(badge(bob.page, alice.name, 'AFK')).toBeVisible();

  await waitTurn(bob, 60_000);
  await waitForValue(`rooms/${code}/driver`, (d) => driver(d) === bobId, 30_000);
  // Round the table again: Bob, the bot, Alice's seat, and back to Bob
  const seq = await bob.seq();
  await bob.rig([4, 6]);
  await rollButton(bob.page).click();
  await endTurn(bob);
  expect(await bob.seq()).toBeGreaterThan(seq + 3);
  const s = await bob.state();
  expect(s.turn.seat).toBe('s1');
  expect(s.turn.no).toBeGreaterThanOrEqual(4);
});
