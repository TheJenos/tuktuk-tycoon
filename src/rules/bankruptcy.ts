import { startAuction } from './auction';
import { deckOf, groupOf, propertyAt } from './board';
import { applySell, clearBuildings, groupLevels, planSell } from './buildings';
import { type Ctx, emit, err, levelOf, ownedBy, phaseChain, player, prop, propBidders, setPhase } from './ctx';
import { type Handler, seatAction } from './handler';
import { cleanOwed, creditors, maxRaise, owedTotal, payAll, transfer } from './money';
import { mortgageNow, mortgageProblem, sellToBank } from './mortgage';
import { checkOver } from './over';
import { clearTrades } from './trade';
import type { CashWhy, Creditor, DebtPhase, Owed, Phase, SeatId, Step } from './types';

/*
 * Raising cash, bankruptcy and resigning. A debtor is bankrupt only when even selling every building and
 * mortgaging everything (maxRaise) would not cover the debt.
 * - Owing a player (alone or with others): everything is sold to the bank. Buildings go back for half price, every
 *   property for its mortgage value (nothing when mortgaged) and returns to the bank unowned and unmortgaged, and
 *   Get Out of Jail Free cards go back to their decks. The cash is paid to the creditors in order, each at most its
 *   share; what is left goes to the bank. No property or card passes to a creditor.
 * - Owing only the bank: everything goes to the bank, mortgages are cleared, and the bank auctions the property at
 *   once (with cfg.auctions off it simply keeps it).
 */

/** The deterministic raise-cash plan: sell buildings evenly (highest first), then mortgage cheapest first */
export function raiseCash(c: Ctx, seat: SeatId, target: number): void {
  for (let guard = 0; guard < 500 && player(c.s, seat).cash < target; guard++) {
    if (sellOne(c, seat)) continue;
    const m = ownedBy(c.s, seat)
      .filter((space) => mortgageProblem(c.s, c.b, seat, space) === null)
      .sort((x, y) => (propertyAt(c.b, x)?.mortgage ?? 0) - (propertyAt(c.b, y)?.mortgage ?? 0) || x - y)[0];
    if (m === undefined) return;
    mortgageNow(c, seat, m);
  }
}

/** Sells one building level (the highest standing one that can go evenly), or a whole group if none can */
function sellOne(c: Ctx, seat: SeatId): boolean {
  const built = ownedBy(c.s, seat)
    .filter((space) => levelOf(c.s, space) > 0)
    .sort((x, y) => levelOf(c.s, y) - levelOf(c.s, x) || y - x);
  for (const space of built) {
    const g = groupOf(c.b, space);
    if (!g) continue;
    const levels = groupLevels(c.s, g).map((l, i) => (g.spaces[i] === space ? l - 1 : l));
    const plan = planSell(c.s, c.b, seat, g.id, levels);
    if (!('code' in plan)) {
      applySell(c, seat, plan);
      return true;
    }
  }
  // Hotels with no houses in the bank to break them into: the whole group goes at once.
  for (const space of built) {
    const g = groupOf(c.b, space);
    if (!g) continue;
    const plan = planSell(c.s, c.b, seat, g.id, g.spaces.map(() => 0));
    if (!('code' in plan)) {
      applySell(c, seat, plan);
      return true;
    }
  }
  return false;
}

/** Ends a seat's game: marks it out and removes it from every phase, offer and pending step */
function retire(c: Ctx, seat: SeatId, to: Creditor, resigned: boolean): void {
  const p = player(c.s, seat);
  p.out = resigned ? 'resigned' : 'bankrupt';
  p.outAt = c.s.seq + 1;
  delete p.jail;
  p.goojf = [];
  emit(c, { t: 'bankrupt', seat, to, resigned });
  dropSeat(c, seat);
}

/**
 * Removes an out seat from the phase chain, offers and pending steps. The turn seat's turn ends. The timer restarts
 * only when this surfaces another phase; an uninvolved seat leaving keeps everyone's countdown, and so does an
 * auction whose high bidder left (its bid is wiped, the fixed countdown runs on).
 */
export function dropSeat(c: Ctx, seat: SeatId): void {
  clearTrades(c, seat);
  const turnOut = c.s.turn.seat === seat;
  const before = c.s.phase;
  const after = purge(before, seat, turnOut);
  if (after !== before) setPhase(c, after);
  if (turnOut) c.s.pending = [{ k: 'nextTurn' }];
  else c.s.pending = c.s.pending.filter((st) => stepSeat(st) !== seat);
}

const stepSeat = (st: Step): SeatId | undefined => ('seat' in st ? st.seat : 'from' in st ? st.from : undefined);

function purge(p: Phase, seat: SeatId, turnOut: boolean): Phase {
  switch (p.k) {
    case 'auction':
      p.eligible = p.eligible.filter((x) => x !== seat);
      p.passed = p.passed.filter((x) => x !== seat);
      if (p.high?.seat === seat) delete p.high;
      p.resume = purge(p.resume, seat, turnOut);
      return p;
    case 'place':
    case 'mortgageXfer':
      if (p.seat === seat) return purge(p.resume, seat, turnOut);
      p.resume = purge(p.resume, seat, turnOut);
      return p;
    case 'buildClaim':
      p.open = p.open.filter((x) => x !== seat);
      delete p.req[seat];
      if (p.by === seat) delete p.build;
      p.resume = purge(p.resume, seat, turnOut);
      return p;
    case 'debt': {
      if (p.debtor === seat) return purge(p.resume, seat, turnOut);
      // A debt owed to a player who is out is owed to the bank instead.
      const share = p.owed[seat];
      if (share) {
        delete p.owed[seat];
        p.owed.bank = (p.owed.bank ?? 0) + share;
      }
      p.resume = purge(p.resume, seat, turnOut);
      return p;
    }
    case 'over':
      return p;
    default:
      return turnOut ? { k: 'busy' } : p;
  }
}

/** Get Out of Jail Free cards go back to the bottom of their decks */
function returnCards(c: Ctx, seat: SeatId): void {
  for (const id of player(c.s, seat).goojf) {
    const deck = deckOf(c.b, id);
    c.s.decks[deck].push(id);
    emit(c, { t: 'cardReturn', deck, cardId: id, seat });
  }
  player(c.s, seat).goojf = [];
}

/**
 * Bankruptcy owing at least one player: everything is sold to the bank (buildings at half price, property at its
 * mortgage value or nothing when mortgaged; it returns to the bank unowned), the cards go back to their decks, and
 * the cash goes to the creditors in order, each at most its share. Whatever is left goes to the bank.
 */
function toCreditors(c: Ctx, seat: SeatId, owed: Owed, list: Creditor[], why: CashWhy, resigned: boolean, space?: number): void {
  const spaces = ownedBy(c.s, seat);
  transfer(c, 'bank', seat, clearBuildings(c, spaces), 'sell');
  for (const x of spaces) sellToBank(c, seat, x, 'bankrupt');
  returnCards(c, seat);
  for (const to of list) transfer(c, seat, to, Math.min(owed[to] ?? 0, player(c.s, seat).cash), why, space);
  transfer(c, seat, 'bank', player(c.s, seat).cash, 'bankrupt');
  // The bankrupt event names the creditor when there is just one; several are reported as the bank (as before)
  retire(c, seat, list.length === 1 && list[0] ? list[0] : 'bank', resigned);
  checkOver(c, true);
}

/** `broke`: a bankruptcy (it ends a cfg.endMode 'firstBankrupt' game), not a plain resignation */
function toBank(c: Ctx, seat: SeatId, resigned: boolean, broke: boolean): void {
  const spaces = ownedBy(c.s, seat);
  clearBuildings(c, spaces);
  transfer(c, seat, 'bank', player(c.s, seat).cash, 'bankrupt');
  returnCards(c, seat);
  for (const space of spaces) {
    // The bank clears the mortgages before it auctions the property.
    if (prop(c.s, space)?.mortgaged) emit(c, { t: 'mortgage', space, on: false });
    delete c.s.props[`p${space}`];
    emit(c, { t: 'owner', space, from: seat, via: 'bankrupt' });
  }
  retire(c, seat, 'bank', resigned);
  if (checkOver(c, broke)) return;
  // Auctions off: the bank simply keeps the property
  if (c.s.cfg.auctions) queueAuctions(c, spaces);
}

/** The bank auctions property it took over, one space at a time, before play goes on */
function queueAuctions(c: Ctx, spaces: number[]): void {
  const [first, ...rest] = spaces;
  if (first === undefined) return;
  const ph = c.s.phase;
  if (ph.k === 'auction' && ph.lot.k === 'prop') {
    ph.queue.push(...spaces);
    return;
  }
  startAuction(c, { k: 'prop', space: first }, propBidders(c.s), ph, rest);
}

/** `space`: what the debt was for (the creditors' payments name it, like a payment made on the spot) */
export function goBankrupt(c: Ctx, seat: SeatId, owed: Owed, why: CashWhy, resigned: boolean, space?: number): void {
  const clean = cleanOwed(c.s, seat, owed);
  const list = creditors(c.s, seat, clean);
  // A player is owed: everything is sold to the bank and the creditors share the cash (seat order, then the bank)
  if (list.some((to) => to !== 'bank')) toCreditors(c, seat, clean, list, why, resigned, space);
  else toBank(c, seat, resigned, true);
}

const currentDebt = (c: { s: { phase: Phase } }, seat: SeatId): DebtPhase | undefined =>
  c.s.phase.k === 'debt' && c.s.phase.debtor === seat ? c.s.phase : undefined;

export const autoRaise: Handler<'autoRaise'> = seatAction(
  (s, _b, seat) => (currentDebt({ s }, seat) ? null : err('noDebt', 'You are not in debt')),
  (c, seat) => {
    const debt = currentDebt(c, seat);
    if (!debt) return;
    const total = owedTotal(cleanOwed(c.s, seat, debt.owed));
    if (maxRaise(c.s, c.b, seat) < total) goBankrupt(c, seat, debt.owed, debt.why, false, debt.space);
    else raiseCash(c, seat, total);
  },
);

export const bankrupt: Handler<'bankrupt'> = seatAction(
  (s, b, seat) => {
    const debt = currentDebt({ s }, seat);
    if (!debt) return err('noDebt', 'You are not in debt');
    if (maxRaise(s, b, seat) >= owedTotal(cleanOwed(s, seat, debt.owed))) {
      return err('canPay', 'You can still raise enough: sell buildings or mortgage');
    }
    return null;
  },
  (c, seat) => {
    const debt = currentDebt(c, seat);
    if (debt) goBankrupt(c, seat, debt.owed, debt.why, false, debt.space);
  },
);

/** Leave the game. Debts are paid first when the assets cover them; otherwise it is a bankruptcy to the creditor. */
export const resign: Handler<'resign'> = seatAction(
  () => null,
  (c, seat) => {
    const debt = phaseChain(c.s.phase).find((p): p is DebtPhase => p.k === 'debt' && p.debtor === seat);
    if (debt) {
      const owed = cleanOwed(c.s, seat, debt.owed);
      const total = owedTotal(owed);
      if (maxRaise(c.s, c.b, seat) < total) {
        goBankrupt(c, seat, debt.owed, debt.why, true, debt.space);
        return;
      }
      raiseCash(c, seat, total);
      payAll(c, seat, owed, debt.why, debt.space);
      debt.owed = {};
      emit(c, { t: 'debtPaid', debtor: seat });
    }
    toBank(c, seat, true, false);
  },
);
