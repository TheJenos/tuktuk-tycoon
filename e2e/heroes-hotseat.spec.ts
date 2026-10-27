import { OFFLINE_TIMERS } from '../src/shared/timing';
import { expect, test } from './support/fixtures';
import { heroCard, heroLineFaults, heroSeats, heroSpace, LOCATIONS, myLocations, powerButton, reactionBanner, reactionRow, save } from './support/heroes';
import { badge, boardCenter, cashOn, endTurnButton, gameLog, gameOver, passCard, playerCard, prompt, rollButton, swatch, turnBar } from './support/play';
import { place, position, topCard } from './support/positions';
import { openTab } from './support/ui';
import { watch } from './support/watch';

/*
 * Hero League at one screen (docs/heroes.md): two players playing their heroes. Saving is compulsory, a Titan Smash
 * swaps two heroes before the roll, Thunder Call re-rolls another hero's throw, Dead Aim shows its two cards to its
 * own player, Star Shield says no to a Hero-die hit, and the game ends once every location is saved. A reaction
 * window never asks for the device to be passed: the banner names the hero's player. The reaction windows get a long
 * timer here, so a slow run never sees one time out.
 */

const TIMERS = { ...OFFLINE_TIMERS, reaction: 60 };

test('Hero League hot-seat: Titan Smash, a save, a Thunder Call re-roll without a hand-over, then the pass to the next player', async ({ players }) => {
  const p = await players.open('Hana');
  const { page } = p;
  const seen = watch(page);
  await p.startSolo(position(heroSeats([{ name: 'Hana', hero: 'jadeTitan' }, { name: 'Kofi', hero: 'stormLord' }]), {
    rules: { board: 'heroes' },
    timers: TIMERS,
    edit: (s) => place(s, 's1', heroSpace('The Iron Raft')),
  }));
  expect(await p.mySeats()).toEqual(['s0', 's1']);
  await expect(turnBar(page)).toContainText("Hana's turn");
  await expect(cashOn(page, 'Hana')).toHaveText('1,500 Power');
  await expect(playerCard(page, 'Hana').locator('.player-hero')).toContainText('Jade Titan');
  await expect(badge(page, 'Kofi', 'Thunder Call ready')).toBeVisible();
  // Each card shows its hero's name and superpower badge inside it, clear of the cash, on a desktop, a tablet and a
  // phone (where the line is for screen readers: the token is the hero's figure)
  for (const [width, height] of [[1366, 820], [960, 540], [390, 844]] as const) {
    await page.setViewportSize({ width, height });
    if (width > 640) await expect(playerCard(page, 'Kofi').locator('.hero-name')).toBeVisible();
    await expect.poll(() => heroLineFaults(page), { message: `${width}x${height}` }).toEqual([]);
  }
  await page.setViewportSize({ width: 960, height: 540 });
  // My hero and My locations show the same local seat: Kofi picked in either shows in both
  await expect(heroCard(page)).toContainText('Jade Titan');
  await myLocations(page).getByRole('radio', { name: 'Kofi' }).click();
  await expect(heroCard(page)).toContainText('Storm Lord');
  await expect(heroCard(page).getByRole('radio', { name: 'Kofi' })).toBeChecked();
  await heroCard(page).getByRole('radio', { name: 'Hana' }).click();
  await expect(myLocations(page).getByRole('radio', { name: 'Hana' })).toBeChecked();
  await expect(heroCard(page)).toContainText('Jade Titan');
  // Nothing to manage or trade on this board
  const bar = page.getByRole('navigation', { name: 'Actions' });
  await expect(bar.getByRole('button', { name: /^Manage/ })).toHaveCount(0);
  await expect(bar.getByRole('button', { name: /^Trade/ })).toHaveCount(0);

  // Titan Smash before the roll: Hana and Kofi trade places
  await powerButton(page).click();
  await expect(prompt(page).getByRole('heading', { level: 2 })).toHaveText('Titan Smash');
  await prompt(page).getByRole('radiogroup', { name: 'Hero to move' }).getByRole('radio', { name: /^Hana/ }).click();
  await prompt(page).getByRole('radiogroup', { name: 'Swap with' }).getByRole('radio', { name: /^Kofi/ }).click();
  await expect(prompt(page)).toContainText('Hana goes to The Iron Raft and Kofi to Rally Point.');
  await prompt(page).getByRole('button', { name: 'Swap them' }).click();
  await expect(gameLog(page)).toContainText('Hana swaps two heroes: Titan Smash');
  await expect(badge(page, 'Hana', 'Superpower used')).toBeVisible();
  await p.waitIdle();
  let s = await p.state();
  expect([s.players.s0?.pos, s.players.s1?.pos]).toEqual([heroSpace('The Iron Raft'), 0]);
  await expect(powerButton(page)).toHaveCount(0);

  // Hana rolls 1 + 2: Kofi's Storm Lord may have it re-rolled, from this same screen (no "Pass to")
  await p.rig([1, 2], [2, 3]);
  await rollButton(page).click();
  await expect(reactionBanner(page)).toBeVisible();
  await expect(reactionBanner(page).getByRole('heading', { level: 2 })).toHaveText('Thunder Call?');
  await expect(reactionBanner(page)).toContainText('Hana rolled 1 + 2');
  await expect(passCard(page)).toHaveCount(0);
  const kofi = reactionRow(page, 'Kofi');
  await expect(kofi.getByRole('button', { name: 'Pass' })).toBeVisible();
  await kofi.getByRole('button', { name: /^Re-roll/ }).click();
  await expect(reactionBanner(page)).toHaveCount(0);

  // The re-roll stands (2 + 3) and moves Hana from The Iron Raft to Daily Trumpet Tower, which they must save
  await expect(gameLog(page)).toContainText("Kofi re-rolls Hana's throw: Thunder Call");
  await expect(gameLog(page)).toContainText('Hana saves Daily Trumpet Tower for 160 Power');
  await expect(swatch(page, 'Hana', 'Daily Trumpet Tower')).toBeVisible();
  await expect(cashOn(page, 'Hana')).toHaveText('1,340 Power');
  await expect(badge(page, 'Kofi', 'Superpower used')).toBeVisible();
  s = await p.state();
  expect(s.players.s0?.pos).toBe(heroSpace('Daily Trumpet Tower'));

  // The location's card: its villain and its power-up, no houses and no mortgage
  await p.openDeed(heroSpace('Daily Trumpet Tower'));
  const inspector = page.locator('#tile-inspector');
  await expect(inspector).toContainText('Villain: The Cranium');
  await expect(inspector).toContainText('Saved by Hana');
  await expect(inspector.locator('.deed-rent')).toContainText('Power-up');
  await expect(inspector.getByRole('button', { name: /^Mortgage|^Build|^Sell/ })).toHaveCount(0);
  await inspector.getByRole('button', { name: /^Close/ }).click();

  // Kofi's turn goes to them through the hand-over card, as on every board
  await endTurnButton(page).click();
  await expect(passCard(page).getByRole('heading')).toHaveText('Pass to Kofi');
  await passCard(page).getByRole('button', { name: "I'm Kofi: show my turn" }).click();
  await expect(turnBar(page)).toContainText("Kofi's turn");
  await expect(rollButton(page)).toBeVisible();

  // The rules say Hero League's rules and its heroes, not the classic options it pins
  await p.openGameMenu();
  await openTab(page, 'Rules');
  const rules = p.gameMenu.locator('.rules-list');
  await expect(rules).toContainText('Hero League');
  await expect(rules).not.toContainText('Mortgage interest');
  await expect(rules).not.toContainText('Auctions');
  await expect(p.gameMenu.getByRole('list', { name: 'Heroes' })).toContainText('Thunder Call');
  seen.check();
});

test('Dead Aim shows its two cards to its player, the Hero die picks a hero, and Star Shield says no', async ({ players }) => {
  const p = await players.open('Hana');
  const { page } = p;
  const seen = watch(page);
  await p.startSolo(position(heroSeats([{ name: 'Hana', hero: 'sharpshot' }, { name: 'Kofi', hero: 'starCaptain' }]), {
    rules: { board: 'heroes' },
    timers: TIMERS,
    edit: (s) => {
      topCard(s, 'chance', 'ch-mindtrap');
      topCard(s, 'chance', 'ch-illusionist');
    },
  }));

  // Hana lands on Villain Strike: take aim or draw
  await p.rig([2, 3]);
  await p.rigHero('Star Captain');
  await rollButton(page).click();
  await expect(prompt(page).getByRole('heading', { level: 2 })).toHaveText('Dead Aim');
  await prompt(page).getByRole('button', { name: /^Take aim/ }).click();
  await expect(prompt(page).getByRole('heading', { level: 2 })).toHaveText('Pick a card');
  const cards = prompt(page).getByRole('button', { name: /^Play: / });
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toHaveAccessibleName(/^Play: The Illusionist casts a spell/);
  // The log says Hana looked, never what they saw
  await expect(gameLog(page)).toContainText('Hana looks at the top 2 cards of Villain Strike');
  await expect(gameLog(page)).not.toContainText('mind-trap');
  await cards.first().click();

  // The Hero die comes up Star Captain: Kofi may say no, from this screen
  await expect(gameLog(page)).toContainText('Hana throws the Hero die: Star Captain (Kofi)');
  await expect(reactionBanner(page)).toBeVisible();
  await expect(reactionBanner(page).getByRole('heading', { level: 2 })).toHaveText('Star Shield?');
  await expect(reactionBanner(page)).toContainText('Kofi loses 100 Power');
  await expect(passCard(page)).toHaveCount(0);
  await reactionRow(page, 'Kofi').getByRole('button', { name: /^Shield/ }).click();
  await expect(gameLog(page)).toContainText('Kofi says no: Star Shield');
  await p.waitIdle();
  await expect(cashOn(page, 'Kofi')).toHaveText('1,500 Power');
  await expect(badge(page, 'Kofi', 'Superpower used')).toBeVisible();
  await expect(badge(page, 'Hana', 'Superpower used')).toBeVisible();
  await expect(endTurnButton(page)).toBeVisible();
  seen.check();
});

test('the reactions setting passes for me, and the game ends once every location is saved, ranked by score', async ({ players }) => {
  const p = await players.open('Hana');
  const { page } = p;
  const seen = watch(page);
  const last = heroSpace('Daily Trumpet Tower');
  const rest = LOCATIONS.filter((i) => i !== last);
  await p.startSolo(position(heroSeats([{ name: 'Hana', hero: 'jadeTitan' }, { name: 'Kofi', hero: 'stormLord' }]), {
    rules: { board: 'heroes' },
    timers: TIMERS,
    edit: (s) => {
      save(s, 's0', ...rest.slice(0, 10));
      save(s, 's1', ...rest.slice(10));
    },
  }));

  // Hana throws 4 + 5 to the last villain-held location; Kofi's banner offers "only ask on my throws"
  await p.rig([4, 5]);
  await rollButton(page).click();
  await expect(reactionBanner(page)).toBeVisible();
  // A click, not check(): ticking it closes the banner at once, so check() could never see it ticked afterwards
  await reactionBanner(page).getByRole('checkbox', { name: 'Only ask on my throws' }).click();
  // Not Kofi's throw: the game passes for them at once
  await expect(reactionBanner(page)).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('tuktuk-settings') ?? '{}').reactions)).toBe('mine');

  // Hana saves it: every location is saved and the game is over
  await expect(gameOver(page)).toBeVisible();
  await expect(gameOver(page)).toContainText('Every location saved');
  await expect(gameOver(page).getByRole('heading', { name: 'Hana wins!' })).toBeVisible();
  // 1,340 Power + 11 locations x 100
  await expect(gameOver(page).locator('.standings li').first()).toContainText('score 2,440: 1,340 Power + 11 locations');
  await expect(gameLog(page)).toContainText('Every location saved: Hana wins on score');
  await expect(boardCenter(page).getByRole('button', { name: /^Roll/ })).toHaveCount(0);
  seen.check();
});
