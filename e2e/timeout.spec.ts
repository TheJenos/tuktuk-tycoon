import { expect, needsEmulator, rules, test } from './support/fixtures';
import { badge, gameLog, turnBar } from './support/play';
import { roomPosition } from './support/positions';

/*
 * Turn timers: a player who doesn't act has the safe default played for them when time's up (the driver sends it,
 * exactly once); two timeouts in a row hand the seat to a bot until they take it back.
 */

needsEmulator();

test('time runs out twice: the table rolls and ends the turn for Bob, then a bot plays his seat until he takes it back', async ({ table }) => {
  test.slow();
  const { alice, bob } = await table({
    rules: rules({ turnTimer: 4, decisionTimer: 4 }),
    // Bob to move
    position: (setup) => roomPosition(setup, { first: 's1' }),
  });
  await expect(turnBar(bob.page).getByRole('timer', { name: /^Time to decide/ })).toBeVisible();
  // When the table rolls for him it lands on Just Visiting: nothing more to decide that turn
  await bob.rig([4, 6]);

  await expect(gameLog(alice.page)).toContainText(`Time's up: ${bob.name} rolls`, { timeout: 30_000 });
  await expect(gameLog(alice.page).getByText(new RegExp(`^Time's up: ${bob.name}`))).toHaveCount(2, { timeout: 30_000 });
  for (const p of [alice, bob]) await expect(badge(p.page, bob.name, 'AFK')).toBeVisible();
  // Each timeout was sent once (one roll, one end of turn), and from here the bot plays without waiting for the clock
  await expect(gameLog(bob.page).getByText(new RegExp(`^Time's up: ${bob.name}`))).toHaveCount(2);

  await bob.openGameMenu();
  await expect(bob.gameMenu).toContainText(`A bot is playing ${bob.name} for you.`);
  await bob.gameMenu.getByRole('button', { name: 'Take back control' }).click();
  for (const p of [alice, bob]) await expect(badge(p.page, bob.name, 'AFK')).toHaveCount(0);
  await expect(bob.gameMenu).not.toContainText('A bot is playing');
});
