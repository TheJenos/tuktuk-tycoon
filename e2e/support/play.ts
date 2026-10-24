import { expect, type Locator, type Page } from '@playwright/test';
import type { GameState, SeatId } from '../../src/rules';
import type { Player, Throw } from './player';
import { BOARD } from './positions';

/*
 * The game screen as a player sees it (src/ui/game), and playing through it with its own buttons. Bots are kept
 * out of a test's way: before the test's turn ends, each bot's next throw is rigged to land where nothing is asked
 * of anyone (quietThrow), so the test's own moves are the only things that happen to it.
 */

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const hud = (page: Page) => page.locator('#hud');
export const actionBar = (page: Page) => hud(page).getByRole('navigation', { name: 'Actions' });
/** The turn's Roll (not the jail panel's "Roll for doubles") */
export const rollButton = (page: Page) => actionBar(page).getByRole('button', { name: /^Roll(?! for)/ });
export const endTurnButton = (page: Page) => actionBar(page).getByRole('button', { name: /^End turn/ });
export const jailPanel = (page: Page) => actionBar(page).getByRole('group', { name: /^In jail/ });
export const turnBar = (page: Page) => page.getByTestId('turn-bar');
/** The decision prompt in the context panel (the bottom sheet on phones) */
export const prompt = (page: Page) => page.getByTestId('prompt');
export const buyPrompt = (page: Page) => hud(page).locator('.buy-prompt');
/** The drawn Astrologer's Advice / Seettu Pot card's caption (or the card itself on the 2D board) */
export const cardShown = (page: Page) => page.getByTestId('card-modal');
export const auctionDialog = (page: Page) => page.locator('#auction');
export const manageDialog = (page: Page) => page.getByRole('dialog', { name: 'Manage properties' });
export const tradeDialog = (page: Page) => page.getByRole('dialog', { name: 'Propose a trade' });
export const tradeOffers = (page: Page) => page.getByRole('region', { name: 'Trade offers' });
export const gameOver = (page: Page) => page.locator('#game-over');
/** Hot-seat: "Pass to <name>" before another local player's decision */
export const passCard = (page: Page) => page.getByRole('dialog', { name: /^Pass to / });
export const gameLog = (page: Page) => page.getByRole('log', { name: 'Events' });
export const playersPanel = (page: Page) => page.getByRole('region', { name: 'Players' });

/** A player's card in the Players panel, by name */
export function playerCard(page: Page, name: string): Locator {
  return playersPanel(page).locator('li.player-card').filter({ has: page.locator('.player-title strong', { hasText: new RegExp(`^${escape(name)}$`) }) });
}

/** The cash on a player's card: its final value, as read out (the shown digits count up to it) */
export const cashOn = (page: Page, name: string) => playerCard(page, name).locator('.player-cash .money > .sr-only');

/** A property swatch on a player's card: "Maradana Lane", "Maradana Lane, mortgaged", "Maradana Lane, 2 houses" */
export const swatch = (page: Page, owner: string, label: string) => playerCard(page, owner).getByRole('button', { name: label, exact: true });

/** A badge on a player's card ("Jail", "AFK", "Bankrupt", ...) */
export const badge = (page: Page, owner: string, text: string) => playerCard(page, owner).locator('.badge', { hasText: new RegExp(`^${escape(text)}`) });

// ---------------------------------------------------------------------------------------------------- waiting

/**
 * Poll `check` until it's true, answering meanwhile what the test isn't about: an auction someone else started
 * (we pass). A bot's trade offer is left alone: offers never block play, and expire with the turn.
 */
export async function until(p: Player, check: () => Promise<boolean>, what: string, timeout = 60_000): Promise<void> {
  const end = Date.now() + timeout;
  for (;;) {
    await p.waitIdle();
    if (await check()) return;
    const pass = auctionDialog(p.page).getByRole('button', { name: 'Pass' });
    if ((await pass.count()) > 0 && (await pass.first().isEnabled())) await pass.first().click().catch(() => {});
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await p.page.waitForTimeout(150);
  }
}

/** Until it's our turn to roll again (or to choose in jail) */
export function waitTurn(p: Player, timeout?: number): Promise<void> {
  const roll = actionBar(p.page).getByRole('button', { name: /^Roll/ });
  return until(p, () => roll.first().isVisible(), 'our turn', timeout);
}

// ---------------------------------------------------------------------------------------------------- bots

const NON_DOUBLES: Partial<Record<number, [number, number]>> = {
  3: [1, 2], 4: [1, 3], 5: [1, 4], 6: [2, 4], 7: [3, 4], 8: [3, 5], 9: [4, 5], 10: [4, 6], 11: [5, 6],
};
/** Nothing to decide or pay to anyone there (a tax is the bank's) */
const QUIET = new Set(['go', 'jail', 'parking', 'tax', 'goToJail']);

/**
 * A throw for `seat`'s next roll that lands it on a corner or a tax, or else on a property no human owns and not
 * in `avoid`: never on Chance or Community Chest (cards that move it again or take cash from other players),
 * never rent to a human. Never doubles, so it is one throw per turn; a jailed seat stays or leaves to a quiet spot.
 */
export function quietThrow(s: GameState, seat: SeatId, humans: readonly SeatId[], avoid: readonly number[] = []): Throw {
  const p = s.players[seat];
  if (!p) throw new Error(`${seat} is not at the table`);
  const from = p.jail ? BOARD.jailIndex : p.pos;
  const speed = s.cfg.speedDie && p.speed && !p.jail;
  const n = BOARD.spaces.length;
  const score = (total: number): number => {
    const to = (from + total) % n;
    const sp = BOARD.spaces[to]!;
    if (avoid.includes(to) || sp.k === 'chance' || sp.k === 'chest') return 9;
    if (QUIET.has(sp.k)) return 0;
    const owner = s.props[`p${to}`]?.owner;
    if (owner && humans.includes(owner)) return 9;
    return owner ? 1 : 2;
  };
  // With the speed die in play a 1 is added: the white dice still never match
  const totals = Object.keys(NON_DOUBLES).map(Number).map((t) => (speed ? t + 1 : t));
  const best = totals.reduce((a, b) => (score(b) < score(a) ? b : a));
  if (score(best) === 9) throw new Error(`No quiet throw for ${seat} from ${from}`);
  return speed ? [...NON_DOUBLES[best - 1]!, 1] : [...NON_DOUBLES[best]!];
}

/**
 * Rig a quiet throw for every seat that isn't ours (offline: they are bots; online: bots and AFK seats), in turn
 * order from the one after the turn seat until our next seat (or from the turn seat itself, with `fromTurn`).
 * Call it at our postRoll, before ending the turn.
 */
export async function rigOthers(p: Player, o: { avoid?: readonly number[]; fromTurn?: boolean } = {}): Promise<void> {
  const [s, mine] = await Promise.all([p.state(), p.mySeats()]);
  if (s.rig.length) throw new Error(`Rigged throws left over: ${JSON.stringify(s.rig)}`);
  const at = s.order.indexOf(s.turn.seat);
  const after = [...s.order.slice(at + (o.fromTurn ? 0 : 1)), ...s.order.slice(0, at + (o.fromTurn ? 0 : 1))];
  const throws: Throw[] = [];
  for (const seat of after) {
    if (mine.includes(seat)) break;
    if (s.players[seat]?.out) continue;
    throws.push(quietThrow(s, seat, mine, o.avoid));
  }
  if (throws.length) await p.rig(...throws);
}

/** End our turn with the others' throws rigged quiet, and wait for our next one */
export async function endTurn(p: Player, avoid?: readonly number[]): Promise<void> {
  // Right after a Roll click the roll may still be on its way to the database (waitIdle alone would see the old
  // move, with our rigged throw still queued): End turn is offered once it has landed and played out
  await expect(endTurnButton(p.page)).toBeEnabled();
  await p.waitIdle();
  await rigOthers(p, { avoid });
  await endTurnButton(p.page).click();
  await waitTurn(p);
}

// ---------------------------------------------------------------------------------------------------- free play

/**
 * Play whatever the game asks of this screen with the buttons a player would press, on real dice, until `done()`:
 * buy what we can, roll, end the turn, pass in auctions, OK the cards. Bots play themselves meanwhile; a hot-seat
 * "Pass to <name>" card is answered (and reported to `onPass`). Returns how many times we pressed Roll.
 */
export async function playTurns(p: Player, done: (rolls: number) => Promise<boolean>, o: { limit?: number; onPass?: (name: string) => void } = {}): Promise<number> {
  const page = p.page;
  let rolls = 0;
  for (let i = 0; i < (o.limit ?? 200) && !(await done(rolls)); i++) {
    await p.waitIdle();
    const handOver = page.getByRole('button', { name: /^I'm .+: show my turn/ });
    if (await handOver.isVisible()) {
      const label = (await handOver.textContent()) ?? '';
      o.onPass?.(label.replace(/^I'm /, '').replace(/: show my turn.*$/, ''));
      await handOver.click();
      continue;
    }
    const buy = hud(page).getByRole('button', { name: /^Buy for/ });
    const roll = actionBar(page).getByRole('button', { name: /^Roll/ });
    const end = endTurnButton(page);
    const pass = auctionDialog(page).getByRole('button', { name: 'Pass' });
    const ok = hud(page).locator('.prompt button.primary');
    // A property we can't afford: let it go to auction
    const decline = buyPrompt(page).getByRole('button', { name: /^Auction/ });
    const enabled = async (l: Locator) => (await l.count()) > 0 && (await l.first().isEnabled());
    if (await enabled(buy)) await buy.first().click();
    else if (await enabled(roll)) {
      await roll.first().click();
      rolls++;
    } else if (await enabled(end)) await end.click();
    else if (await enabled(pass)) await pass.first().click();
    else if (await enabled(ok)) await ok.first().click();
    else if (await enabled(decline)) await decline.click();
    else await page.waitForTimeout(150);
  }
  return rolls;
}
