import { startAuction } from './auction';
import { deckOf, groupOf, propertyAt } from './board';
import { applySell, clearBuildings, groupLevels, planSell } from './buildings';
import { type Ctx, emit, err, levelOf, ownedBy, phaseChain, player, prop, propBidders, setPhase } from './ctx';
import { type Handler, seatAction } from './handler';
import { cleanOwed, creditors, maxRaise, owedTotal, payAll, transfer } from './money';
import { mortgageNow, mortgageProblem, startXfer } from './mortgage';
import { checkOver } from './over';
import { clearTrades } from './trade';
import type { CashWhy, Creditor, DebtPhase, Owed, Phase, SeatId, Step } from './types';

/*
 * Raising cash, bankruptcy and resigning. A debtor is bankrupt only when even selling every building and
 * mortgaging everything (maxRaise) would not cover the debt.
 * - To one player: buildings go back to the bank for half price, paid to the creditor; cash, property and cards go
 *   to the creditor, who then settles the mortgaged property (mortgageXfer).
 * - To the bank (or several creditors, paid in seat order as far as the cash goes): everything goes to the bank,
 *   mortgages are cleared, and the bank auctions the property at once.
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
 * only when this surfaces another phase or wipes the high bid; an uninvolved seat leaving keeps everyone's countdown.
 */
export function dropSeat(c: Ctx, seat: SeatId): void {
  clearTrades(c, 'out', seat);
  const turnOut = c.s.turn.seat === seat;
  const before = c.s.phase;
  const lostHigh = before.k === 'auction' && before.high?.seat === seat;
  const after = purge(before, seat, turnOut);
  if (after !== before || lostHigh) setPhase(c, after);
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

function toPlayer(c: Ctx, seat: SeatId, cred: SeatId, resigned: boolean): void {
  const spaces = ownedBy(c.s, seat);
  const value = clearBuildings(c, spaces);
  transfer(c, 'bank', cred, value, 'bankrupt');
  transfer(c, seat, cred, player(c.s, seat).cash, 'bankrupt');
  for (const space of spaces) {
    const ps = prop(c.s, space);
    if (!ps) continue;
    ps.owner = cred;
    emit(c, { t: 'owner', space, from: seat, to: cred, via: 'bankrupt' });
  }
  for (const id of [...player(c.s, seat).goojf]) {
    player(c.s, cred).goojf.push(id);
    emit(c, { t: 'cardGive', cardId: id, from: seat, to: cred });
  }
  const mortgaged = spaces.filter((space) => prop(c.s, space)?.mortgaged);
  retire(c, seat, cred, resigned);
  if (checkOver(c, true)) return;
  startXfer(c, cred, mortgaged);
}

/** `broke`: a bankruptcy (it ends a cfg.endMode 'firstBankrupt' game), not a plain resignation */
function toBank(c: Ctx, seat: SeatId, resigned: boolean, broke: boolean): void {
  const spaces = ownedBy(c.s, seat);
  clearBuildings(c, spaces);
  transfer(c, seat, 'bank', player(c.s, seat).cash, 'bankrupt');
  for (const id of player(c.s, seat).goojf) {
    const deck = deckOf(c.b, id);
    c.s.decks[deck].push(id);
    emit(c, { t: 'cardReturn', deck, cardId: id, seat });
  }
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

export function goBankrupt(c: Ctx, seat: SeatId, owed: Owed, why: CashWhy, resigned: boolean): void {
  const clean = cleanOwed(c.s, seat, owed);
  const list = creditors(c.s, seat, clean);
  const only = list[0];
  if (list.length === 1 && only !== undefined && only !== 'bank') {
    toPlayer(c, seat, only, resigned);
    return;
  }
  if (list.length > 1) {
    // Several creditors: raise everything, pay them in seat order as far as it goes; the rest goes to the bank.
    raiseCash(c, seat, Number.MAX_SAFE_INTEGER);
    for (const to of list) transfer(c, seat, to, Math.min(clean[to] ?? 0, player(c.s, seat).cash), why);
  }
  toBank(c, seat, resigned, true);
}

const currentDebt = (c: { s: { phase: Phase } }, seat: SeatId): DebtPhase | undefined =>
  c.s.phase.k === 'debt' && c.s.phase.debtor === seat ? c.s.phase : undefined;

export const autoRaise: Handler<'autoRaise'> = seatAction(
  (s, _b, seat) => (currentDebt({ s }, seat) ? null : err('noDebt', 'You are not in debt')),
  (c, seat) => {
    const debt = currentDebt(c, seat);
    if (!debt) return;
    const total = owedTotal(cleanOwed(c.s, seat, debt.owed));
    if (maxRaise(c.s, c.b, seat) < total) goBankrupt(c, seat, debt.owed, debt.why, false);
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
    if (debt) goBankrupt(c, seat, debt.owed, debt.why, false);
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
        goBankrupt(c, seat, debt.owed, debt.why, true);
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
