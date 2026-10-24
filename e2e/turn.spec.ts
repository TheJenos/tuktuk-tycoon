import { readState } from './support/db';
import { expect, needsEmulator, test } from './support/fixtures';
import { actionBar, buyPrompt, cashOn, endTurnButton, gameLog, rollButton, swatch, turnBar } from './support/play';
import { roomPosition, space } from './support/positions';

/*
 * One online turn between two browsers: Alice rolls (rigged), buys and ends her turn; Bob's screen follows every
 * step, and his Roll comes up only when it's his turn.
 */

needsEmulator();

test('a turn: Alice rolls, buys and ends her turn; Bob sees each step, then rolls himself', async ({ table }) => {
  const { code, alice, bob } = await table({ position: (setup) => roomPosition(setup) });
  await expect(turnBar(alice.page)).toContainText('Your turn');
  await expect(turnBar(bob.page)).toContainText(`${alice.name}'s turn`);
  await expect(rollButton(bob.page)).toHaveCount(0);
  await expect(actionBar(bob.page).getByRole('button', { name: /^Manage/ })).toBeEnabled();

  await alice.rig([1, 2]);
  await rollButton(alice.page).click();
  await expect(gameLog(bob.page)).toContainText(`${alice.name} rolls 1 + 2`);
  await expect(turnBar(bob.page)).toContainText(`${alice.name} decides on Maradana Lane`);
  await buyPrompt(alice.page).getByRole('button', { name: /^Buy for Rs\. 60/ }).click();
  await expect(swatch(bob.page, alice.name, 'Maradana Lane')).toBeVisible();
  await expect(cashOn(bob.page, alice.name)).toHaveText('Rs. 1,440');

  await endTurnButton(alice.page).click();
  await expect(rollButton(bob.page)).toBeVisible();
  await expect(turnBar(bob.page)).toContainText('Your turn');
  await expect(turnBar(alice.page)).toContainText(`${bob.name}'s turn`);
  await expect(rollButton(alice.page)).toHaveCount(0);

  await bob.rig([2, 3]);
  await rollButton(bob.page).click();
  await expect(buyPrompt(bob.page).getByRole('heading', { level: 2 })).toHaveText('Buy Colombo Fort Station?');
  await expect.poll(async () => (await alice.state()).players.s1?.pos).toBe(space('Colombo Fort Station'));

  // Both screens on the same move, and that's the one in the database
  await Promise.all([alice.waitIdle(), bob.waitIdle()]);
  const [a, b, stored] = await Promise.all([alice.seq(), bob.seq(), readState(code)]);
  expect(a).toBe(b);
  expect(stored?.seq).toBe(a);
});
