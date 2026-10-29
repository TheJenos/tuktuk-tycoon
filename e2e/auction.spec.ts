import { expect, needsEmulator, rules, test } from './support/fixtures';
import { auctionDialog, buyPrompt, cashOn, gameLog, rollButton, swatch } from './support/play';
import { roomPosition, space } from './support/positions';

/*
 * Timed open bidding between two browsers. Both bid the same amount at the same moment: the database transaction
 * lets exactly one in and the other is refused (it no longer beats the high bid). Then a raise, a pass, and the
 * winner pays. Each bid restarts the countdown (a new timer key).
 */

needsEmulator();

test('two browsers bid at once: one bid lands, then a raise, a pass, and the winner pays', async ({ table }) => {
  // A long clock: the auction ends by passing, not while the test is between steps
  const { alice, bob } = await table({ rules: rules({ auctionTimer: 60 }), position: (setup) => roomPosition(setup) });
  await alice.rig([1, 2]);
  await rollButton(alice.page).click();
  await buyPrompt(alice.page).getByRole('button', { name: /^Auction/ }).click();
  for (const p of [alice, bob]) {
    await expect(auctionDialog(p.page).getByRole('heading', { name: 'Auction: Maradana Lane' })).toBeVisible();
    await expect(auctionDialog(p.page).locator('.high-bid')).toContainText('No bids yet');
  }
  // The auction's timer key (phase + since): each bid restarts the countdown
  const opened = (await alice.state()).since;

  // The same bid from both, sent together
  // Both open at Rs. 4,200 (70% of the price)
  const results = await Promise.all([alice.dispatch({ k: 'bid', amount: 42 }), bob.dispatch({ k: 'bid', amount: 42 })]);
  expect(results.filter((r) => r.ok)).toHaveLength(1);
  await expect.poll(async () => {
    const s = await alice.state();
    return s.phase.k === 'auction' ? s.phase.high?.amount : s.phase.k;
  }).toBe(42);
  const s = await alice.state();
  const high = s.phase.k === 'auction' ? s.phase.high?.seat : undefined;
  const [leader, other] = high === 's0' ? [alice, bob] : [bob, alice];
  expect(results[leader === alice ? 0 : 1]?.ok).toBe(true);
  for (const p of [alice, bob]) await expect(auctionDialog(p.page).locator('.high-bid')).toContainText(`High bid Rs. 4,200 by ${leader.name}`);
  await expect(auctionDialog(leader.page).locator('.badge', { hasText: 'You hold the high bid' })).toBeVisible();
  await expect(auctionDialog(leader.page).getByRole('button', { name: 'Pass' })).toBeDisabled();

  // The other raises with the ladder; the leader lets it go
  await auctionDialog(other.page).getByRole('button', { name: 'Bid Rs. 4,300', exact: true }).click();
  await expect(auctionDialog(leader.page).locator('.high-bid')).toContainText(`High bid Rs. 4,300 by ${other.name}`);
  // Two bids in: the countdown is no longer the one the lot started with
  expect((await leader.state()).since).not.toBe(opened);
  await auctionDialog(leader.page).getByRole('button', { name: 'Pass' }).click();

  for (const p of [alice, bob]) {
    await expect(auctionDialog(p.page)).toHaveCount(0);
    await expect(gameLog(p.page)).toContainText(`${other.name} wins Maradana Lane for Rs. 4,300`);
    await expect(swatch(p.page, other.name, 'Maradana Lane')).toBeVisible();
    await expect(cashOn(p.page, other.name)).toHaveText('Rs. 145,700');
    await expect(cashOn(p.page, leader.name)).toHaveText('Rs. 150,000');
    // One Rs. 4,200 opening bid made it in
    await expect(gameLog(p.page).getByText(/bids Rs\. 4,200$/)).toHaveCount(1);
  }
  expect((await bob.state()).props[`p${space('Maradana Lane')}`]?.owner).toBe(other === alice ? 's0' : 's1');
});
