import { OFFLINE_TIMERS } from '../src/shared/timing';
import { expect, test } from './support/fixtures';
import {
  auctionDialog,
  buyPrompt,
  endTurnButton,
  gameLog,
  passCard,
  playTurns,
  rollButton,
  swatch,
  turnBar,
} from './support/play';
import { position, seatInfos, space } from './support/positions';
import { openTab } from './support/ui';
import { watch } from './support/watch';

/*
 * Hot-seat: several players at one screen, with bots. Before another local player's decision the device is
 * handed over ("Pass to Kofi"), and their choices stay hidden until they say they're ready; an auction gives each
 * local bidder a row of their own.
 */

test('Local game from the wizard: two players at this screen and two bots take turns', async ({ players }) => {
  test.slow();
  const p = await players.open('Hana');
  const { page } = p;
  const seen = watch(page);
  await p.gotoLobby();

  await openTab(page, 'Local game');
  const panel = page.getByRole('tabpanel', { name: 'Local game' });
  await expect(panel.getByRole('radiogroup', { name: 'Starting cash' })).toBeVisible();
  await panel.getByRole('radio', { name: 'Rs. 2,000' }).click();
  await panel.getByRole('button', { name: /^Next: Seats/ }).click();

  // You, Player 2 and two bots to begin with
  await expect(panel.locator('.seat-row')).toHaveCount(4);
  await expect(panel.locator('.seat-row.human input')).toHaveValue('Player 2');
  await panel.locator('.seat-row.human input').fill('Kofi');
  await panel.getByRole('button', { name: /^Next: Start/ }).click();
  await expect(panel.getByRole('list', { name: 'At the table' }).locator('li')).toHaveCount(4);
  await panel.getByRole('button', { name: 'Start game' }).click();

  await p.waitStarted();
  expect(await p.mySeats()).toHaveLength(2);
  expect((await p.state()).players.s0?.cash).toBe(2000);

  // Each player at this screen is handed the device by name before their move ("Pass to Kofi"), and their turn
  // reads as theirs
  const passed = new Set<string>();
  const turns = new Set<string>();
  await playTurns(p, async () => {
    await p.waitIdle();
    const rollable = await rollButton(page).isVisible();
    const text = rollable ? ((await turnBar(page).textContent()) ?? '') : '';
    for (const who of ['Hana', 'Kofi']) if (text.includes(`${who}'s turn`)) turns.add(who);
    return turns.size === 2 && passed.has('Kofi');
  }, { limit: 300, onPass: (name) => passed.add(name) });
  expect([...turns].sort()).toEqual(['Hana', 'Kofi']);
  expect(passed.has('Kofi')).toBe(true);
  seen.check();
});

test('hot-seat: the device is passed before the next player sees their turn, both bid in one auction, and the card can be turned off', async ({ players }) => {
  const p = await players.open('Hana');
  const { page } = p;
  const seen = watch(page);
  await p.startSolo(position(seatInfos([{ name: 'Hana' }, { name: 'Kofi' }]), { timers: { ...OFFLINE_TIMERS, auction: 60 } }));
  expect(await p.mySeats()).toEqual(['s0', 's1']);

  // Hana's turn first: nobody to hand over to yet
  await expect(passCard(page)).toHaveCount(0);
  await expect(turnBar(page)).toContainText("Hana's turn");
  await p.rig([1, 2], [2, 3], [4, 6]);
  await rollButton(page).click();

  // Hana declines Maradana Lane: one auction, a bid row for each of them
  await buyPrompt(page).getByRole('button', { name: /^Auction/ }).click();
  const auction = auctionDialog(page);
  const hana = auction.getByRole('group', { name: 'Bids for Hana' });
  const kofi = auction.getByRole('group', { name: 'Bids for Kofi' });
  await expect(hana).toBeVisible();
  await expect(kofi).toBeVisible();
  await expect(passCard(page)).toHaveCount(0);
  await hana.getByRole('button', { name: 'Hana: Bid Rs. 10', exact: true }).click();
  await expect(hana.locator('.badge', { hasText: 'Holds the high bid' })).toBeVisible();
  await kofi.getByRole('button', { name: 'Pass' }).click();
  await expect(auction).toBeHidden();
  await expect(gameLog(page)).toContainText('Hana wins Maradana Lane for Rs. 10');
  await expect(swatch(page, 'Hana', 'Maradana Lane')).toBeVisible();

  // Kofi's turn waits behind the hand-over card: no Roll until he says he's ready
  await endTurnButton(page).click();
  await expect(passCard(page)).toBeVisible();
  await expect(passCard(page).getByRole('heading')).toHaveText('Pass to Kofi');
  await expect(rollButton(page)).toHaveCount(0);
  await passCard(page).getByRole('button', { name: "I'm Kofi: show my turn" }).click();
  await expect(passCard(page)).toHaveCount(0);
  await expect(turnBar(page)).toContainText("Kofi's turn");
  await rollButton(page).click();
  await buyPrompt(page).getByRole('button', { name: /^Buy for Rs\. 200/ }).click();
  await expect(swatch(page, 'Kofi', 'Colombo Fort Station')).toBeVisible();

  // Turn the hand-over card off in the game menu: Hana's turn then comes straight up
  await p.openGameMenu();
  await openTab(page, 'Settings');
  const cards = p.gameMenu.getByRole('checkbox', { name: /^Hot-seat: a "Pass to" card/ });
  await expect(cards).toBeChecked();
  await cards.uncheck();
  await p.gameMenu.getByRole('button', { name: /^Resume/ }).click();
  await expect(p.gameMenu).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('tuktuk-hotseat'))).toBe('0');
  await endTurnButton(page).click();
  await expect(turnBar(page)).toContainText("Hana's turn");
  await expect(rollButton(page)).toBeVisible();
  await expect(passCard(page)).toHaveCount(0);
  await rollButton(page).click();
  await p.waitIdle();
  expect((await p.state()).players.s0?.pos).toBe(space('Pinnawala Elephant Walk'));
  seen.check();
});
