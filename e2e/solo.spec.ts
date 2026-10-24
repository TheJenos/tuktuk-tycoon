import { OFFLINE_TIMERS } from '../src/shared/timing';
import { expect, test } from './support/fixtures';
import {
  actionBar,
  auctionDialog,
  badge,
  buyPrompt,
  cardShown,
  cashOn,
  endTurn,
  gameLog,
  jailPanel,
  manageDialog,
  playersPanel,
  playTurns,
  rollButton,
  swatch,
  tradeDialog,
  tradeOffers,
  until,
} from './support/play';
import { own, position, seatInfos, space, topCard } from './support/positions';
import { watch } from './support/watch';

/*
 * Offline play against bots, end to end: no database (nothing may go to the emulator's :9000) and nothing fetched
 * from beyond this machine. Play now and a reload that resumes the autosave, then rigged games (a seeded autosave
 * with debug rules, so game.test.rig decides the dice): buying, an auction by declining, a card, jail by three
 * doubles, building and mortgaging, and a trade with a bot.
 */

const RITA_AND_AVA = () => seatInfos([{ name: 'Rita' }, { name: 'Ava', bot: true }]);

test('Play now vs bots: name form, a game with 4 players, turns with the buttons, and a reload resumes it', async ({ players }) => {
  // Three bots take their turns at the pace every player sees (they wait out the animations they cause)
  test.slow();
  const p = await players.open({ name: null });
  const { page } = p;
  const seen = watch(page);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'What should we call you?' })).toBeVisible({ timeout: 45_000 });
  await page.getByLabel('Your name').fill('Rita');
  await page.getByRole('button', { name: /Continue/ }).click();

  await expect(page.locator('#lobby')).toBeVisible();
  await expect(page.getByText('Playing as')).toBeVisible();
  // Nothing saved yet
  await expect(page.getByRole('button', { name: /Continue solo game/ })).toHaveCount(0);
  await page.getByRole('button', { name: /Play now/ }).click();

  await p.waitStarted();
  await expect(page.locator('#lobby')).toHaveCount(0);
  await expect(playersPanel(page).locator('.player-list > li')).toHaveCount(4);
  await expect(playersPanel(page)).toContainText('Rita');
  await expect(playersPanel(page).locator('.badge.bot')).toHaveCount(3);
  expect(await p.mySeats()).toHaveLength(1);

  const start = await p.seq();
  const rolls = await playTurns(p, async (n) => n >= 3);
  expect(rolls).toBe(3);
  // On to our next roll
  await playTurns(p, () => rollButton(page).or(jailPanel(page)).isVisible());
  const seq = await p.seq();
  expect(seq).toBeGreaterThan(start);

  await page.reload();
  await expect(page.locator('#lobby')).toBeVisible();
  await page.getByRole('button', { name: /Continue solo game/ }).click();
  await p.waitStarted();
  expect(await p.seq()).toBe(seq);
  await expect(rollButton(page).or(jailPanel(page))).toBeVisible();

  // Back to the lobby through the game menu: the save stays
  await p.leave();
  await expect(page.getByRole('button', { name: /Continue solo game/ })).toBeVisible();

  seen.check();
});

test('rigged dice: a card, a purchase, jail on the third doubles, the fine, and an auction by declining', async ({ players }) => {
  const p = await players.open('Rita');
  const { page } = p;
  const seen = watch(page);
  // A long auction clock: the auction ends when both have had their say, not while the test is looking
  await p.startSolo(position(RITA_AND_AVA(), { timers: { ...OFFLINE_TIMERS, auction: 60 }, edit: (s) => topCard(s, 'chest', 'cc-bankerror') }));
  await expect(rollButton(page)).toBeVisible();

  await p.rig([1, 1], [2, 2], [3, 3]);
  // Doubles onto the Seettu Pot: the card shows, and doubles roll again
  await rollButton(page).click();
  await expect(cardShown(page)).toContainText('Bank error in your favour (the teller was watching the cricket). Collect Rs. 200.');
  await expect(cashOn(page, 'Rita')).toHaveText('Rs. 1,700');
  await cardShown(page).getByRole('button', { name: 'OK' }).click();
  await expect(cardShown(page)).toBeHidden();

  // Doubles again, onto Kottu Street: buy it
  await rollButton(page).click();
  await expect(buyPrompt(page).getByRole('heading', { level: 2 })).toHaveText('Buy Kottu Street?');
  await buyPrompt(page).getByRole('button', { name: /^Buy for Rs\. 100/ }).click();
  await expect(swatch(page, 'Rita', 'Kottu Street')).toBeVisible();
  await expect(cashOn(page, 'Rita')).toHaveText('Rs. 1,600');

  // A third doubles: straight to jail, without moving on
  await rollButton(page).click();
  await expect(gameLog(page)).toContainText('Rita rolls doubles three times and goes to the Police Station Bench');
  await expect(badge(page, 'Rita', 'Jail')).toBeVisible();
  expect((await p.state()).players.s0).toMatchObject({ pos: space('Police Station Bench'), jail: { tries: 0 } });

  // A reload picks the game up at the same move
  const seq = await p.seq();
  await page.reload();
  await page.getByRole('button', { name: /^Continue solo game/ }).click();
  await p.waitStarted();
  expect(await p.seq()).toBe(seq);
  await expect(badge(page, 'Rita', 'Jail')).toBeVisible();

  await endTurn(p);
  // In jail: pay the fine before rolling, then roll as usual
  await expect(jailPanel(page)).toContainText('try 1 of 3');
  await jailPanel(page).getByRole('button', { name: 'Pay Rs. 50' }).click();
  await expect(cashOn(page, 'Rita')).toHaveText('Rs. 1,550');
  await expect(jailPanel(page)).toBeHidden();
  await expect(badge(page, 'Rita', 'Jail')).toBeHidden();

  // Pinnawala Elephant Walk: decline it and it goes up for auction, the decliner bidding too
  await p.rig([1, 2]);
  await rollButton(page).click();
  await expect(buyPrompt(page).getByRole('heading', { level: 2 })).toHaveText('Buy Pinnawala Elephant Walk?');
  await buyPrompt(page).getByRole('button', { name: /^Auction/ }).click();
  const auction = auctionDialog(page);
  await expect(auction.getByRole('heading', { name: 'Auction: Pinnawala Elephant Walk' })).toBeVisible();
  await expect(auction.getByRole('group', { name: 'Your bid' })).toContainText('Cash Rs. 1,550');
  // Ten over the high bid (Ava may already have bid: the button raises whatever stands)
  await auction.locator('.bid-row button', { hasText: /^\+Rs\. 10\b/ }).click();
  await expect(auction.locator('.high-bid')).toContainText(/High bid Rs\. [\d,]+ by (Rita|Ava)/);
  // Pass once outbid (the high bidder can't); it closes when the other has passed too, or at the deadline
  await until(p, async () => (await auction.count()) === 0, 'the auction to close');
  const result = gameLog(page).getByText(/^(Rita|Ava) wins Pinnawala Elephant Walk for Rs\. [\d,]+$/);
  await expect(result).toHaveCount(1);
  const [, winner, price] = /^(\w+) wins Pinnawala Elephant Walk for Rs\. ([\d,]+)$/.exec((await result.textContent()) ?? '') ?? [];
  expect((await p.state()).props[`p${space('Pinnawala Elephant Walk')}`]?.owner).toBe(winner === 'Rita' ? 's0' : 's1');
  await expect(swatch(page, winner!, 'Pinnawala Elephant Walk')).toBeVisible();
  const left = winner === 'Rita' ? 1550 - Number(price?.replace(/,/g, '')) : 1550;
  await expect(cashOn(page, 'Rita')).toHaveText(`Rs. ${left.toLocaleString('en-US')}`);

  seen.check();
});

test('Manage: a rigged landing completes Brown, then houses after setCash, a mortgage and its lift', async ({ players }) => {
  const p = await players.open('Rita');
  const { page } = p;
  const seen = watch(page);
  await p.startSolo(position(RITA_AND_AVA(), { edit: (s) => own(s, 's0', space('Pettah Pavement'), space('Colombo Fort Station')) }));

  await p.rig([1, 2]);
  await rollButton(page).click();
  await buyPrompt(page).getByRole('button', { name: /^Buy for Rs\. 60/ }).click();
  await expect(swatch(page, 'Rita', 'Maradana Lane')).toBeVisible();
  await p.setCash('s0', 1000);
  await expect(cashOn(page, 'Rita')).toHaveText('Rs. 1,000');
  await expect(gameLog(page)).toContainText("Rita's cash is set (test)");

  await actionBar(page).getByRole('button', { name: /^Manage/ }).click();
  const manage = manageDialog(page);
  await expect(manage).toBeVisible();
  await expect(manage.locator('.bank-stock')).toHaveText('Bank: 32 houses · 12 hotels');
  const brown = manage.getByRole('region', { name: 'Brown' });
  const build = (name: string) => brown.getByRole('button', { name: new RegExp(`^Build on ${name}`) });
  const level = (name: string) => brown.getByRole('group', { name: `Buildings on ${name}` }).locator('output');

  // Even building: Pettah Pavement can't get two ahead of Baltic
  await build('Pettah Pavement').click();
  await expect(level('Pettah Pavement')).toContainText('1 house');
  await expect(build('Pettah Pavement')).toBeDisabled();
  await expect(build('Pettah Pavement')).toHaveAccessibleName('Build on Pettah Pavement: Build evenly: Maradana Lane first');
  await build('Maradana Lane').click();
  await build('Pettah Pavement').click();
  await build('Maradana Lane').click();
  await expect(manage.locator('.bank-stock')).toContainText('→ 28 houses');
  // A group with buildings can't be mortgaged
  await expect(brown.getByRole('button', { name: /^Mortgage for/ }).first()).toBeDisabled();
  await manage.getByRole('button', { name: 'Apply (−Rs. 200)' }).click();
  await expect(level('Pettah Pavement')).toHaveText('2 houses');
  await expect(level('Maradana Lane')).toHaveText('2 houses');
  await expect(manage.locator('.bank-stock')).toHaveText('Bank: 28 houses · 12 hotels');
  await expect(cashOn(page, 'Rita')).toHaveText('Rs. 800');
  await expect(swatch(page, 'Rita', 'Pettah Pavement, 2 houses')).toBeAttached();

  // Mortgage the railroad, then lift it again (mortgage + 10%)
  const rails = manage.getByRole('region', { name: 'Stations and boards' });
  await rails.getByRole('button', { name: 'Mortgage for Rs. 100' }).click();
  await manage.getByRole('button', { name: 'Apply (+Rs. 100)' }).click();
  await expect(rails.locator('.badge', { hasText: 'Mortgaged' })).toBeVisible();
  await expect(cashOn(page, 'Rita')).toHaveText('Rs. 900');
  await expect(swatch(page, 'Rita', 'Colombo Fort Station, mortgaged')).toBeAttached();
  await rails.getByRole('button', { name: 'Lift for Rs. 110' }).click();
  await manage.getByRole('button', { name: 'Apply (−Rs. 110)' }).click();
  await expect(rails.locator('.badge', { hasText: 'Mortgaged' })).toHaveCount(0);
  await expect(cashOn(page, 'Rita')).toHaveText('Rs. 790');

  await manage.getByRole('button', { name: 'Close' }).click();
  await expect(manage).toBeHidden();
  const s = await p.state();
  expect(s.props[`p${space('Pettah Pavement')}`]?.level).toBe(2);
  expect(s.props[`p${space('Colombo Fort Station')}`]?.mortgaged).toBeUndefined();
  // The turn goes on as usual afterwards
  await endTurn(p, [space('Pettah Pavement'), space('Maradana Lane')]);
  seen.check();
});

test('a trade with a bot: an invalid offer is held back, a fair one is accepted', async ({ players }) => {
  const p = await players.open('Rita');
  const { page } = p;
  const seen = watch(page);
  await p.startSolo(position(RITA_AND_AVA(), { edit: (s) => own(s, 's1', space('Pettah Pavement')) }));

  await actionBar(page).getByRole('button', { name: /^Trade/ }).click();
  const trade = tradeDialog(page);
  await expect(trade.getByRole('radio', { name: 'Ava' })).toHaveAttribute('aria-checked', 'true');
  const send = trade.getByRole('button', { name: 'Send offer' });
  // Cash for nothing would be a loan
  await trade.getByRole('group', { name: 'You give' }).getByLabel('Cash').fill('300');
  await expect(send).toBeDisabled();
  await expect(trade.locator('.trade-problems')).not.toHaveText('The offer is valid');
  await trade.getByRole('group', { name: 'You get from Ava' }).getByRole('checkbox', { name: 'Pettah Pavement' }).check();
  await expect(trade.locator('.trade-problems')).toHaveText('The offer is valid');
  await send.click();
  await expect(trade).toBeHidden();

  // Ava takes Rs. 300 for a lone Rs. 60 street
  await expect(swatch(page, 'Rita', 'Pettah Pavement')).toBeVisible();
  await expect(cashOn(page, 'Rita')).toHaveText('Rs. 1,200');
  await expect(cashOn(page, 'Ava')).toHaveText('Rs. 1,800');
  await expect(gameLog(page)).toContainText('Rita and Ava trade: Rs. 300 for Pettah Pavement');
  await expect(tradeOffers(page)).toHaveCount(0);
  seen.check();
});
