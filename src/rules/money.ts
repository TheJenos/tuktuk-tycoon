import { propertyAt, isStreet, stepCost } from './board';
import { type Ctx, emit, isActive, ownedBy, player, prop, seatsAfter, setPhase, interest } from './ctx';
import { saleOf } from './rates';
import type { BoardDef, CashWhy, Creditor, GameState, Owed, SeatId, StreetDef } from './types';

/** What a street's buildings cost to put up (a hotel = 4 houses + the hotel step) */
export function buildingCost(sp: StreetDef, level: number): number {
  let total = 0;
  for (let l = 1; l <= level; l++) total += stepCost(sp, l);
  return total;
}

/** What the bank pays back for a street's buildings (half of each step, rounded down) */
export function buildingRefund(sp: StreetDef, level: number): number {
  let total = 0;
  for (let l = 1; l <= level; l++) total += Math.floor(stepCost(sp, l) / 2);
  return total;
}

/**
 * The rulebook's worth (Income Tax): cash + printed price of every property, mortgaged or not, + what the
 * buildings cost.
 */
export function worth(s: GameState, b: BoardDef, seat: SeatId): number {
  let total = player(s, seat).cash;
  for (const space of ownedBy(s, seat)) {
    const sp = propertyAt(b, space);
    if (!sp) continue;
    total += sp.price;
    if (isStreet(sp)) total += buildingCost(sp, prop(s, space)?.level ?? 0);
  }
  return total;
}

/** Worth for ranking: like worth(), but a mortgaged property counts what it would be worth once lifted */
export function netWorth(s: GameState, b: BoardDef, seat: SeatId): number {
  let total = player(s, seat).cash;
  for (const space of ownedBy(s, seat)) {
    const sp = propertyAt(b, space);
    const ps = prop(s, space);
    if (!sp || !ps) continue;
    total += ps.mortgaged ? sp.price - sp.mortgage - interest(s, sp.mortgage) : sp.price;
    if (isStreet(sp)) total += buildingCost(sp, ps.level);
  }
  return total;
}

/**
 * The most cash a seat could have right now: cash + every building sold + every property sold back to the bank
 * (selling beats mortgaging: 80% of the price against 60%)
 */
export function maxRaise(s: GameState, b: BoardDef, seat: SeatId): number {
  let total = player(s, seat).cash;
  for (const space of ownedBy(s, seat)) {
    const sp = propertyAt(b, space);
    const ps = prop(s, space);
    if (!sp || !ps) continue;
    if (isStreet(sp)) total += buildingRefund(sp, ps.level);
    // Its sale value (mortgage.ts saleValue): a mortgaged one's loan comes out of it
    total += saleOf(sp.price) - (ps.mortgaged ? sp.mortgage : 0);
  }
  return total;
}

export const owedTotal = (owed: Owed): number => Object.values(owed).reduce<number>((a, n) => a + (n ?? 0), 0);

/**
 * Creditors of a debt in payment order: seats from the debtor's left, then the bank. Counting from the debtor (as
 * Wedding Gifts payers are queued) means who absorbs a shortfall never depends on who won the opening roll.
 */
export function creditors(s: GameState, debtor: SeatId, owed: Owed): Creditor[] {
  const seats: Creditor[] = seatsAfter(s, debtor).filter((id) => (owed[id] ?? 0) > 0);
  return (owed.bank ?? 0) > 0 ? [...seats, 'bank'] : seats;
}

/** Payments to the bank that feed the parking jackpot (cfg.jackpot) */
export const JACKPOT_WHY: ReadonlySet<CashWhy> = new Set<CashWhy>(['tax', 'fine', 'card']);

/**
 * Moves cash and emits the event. The caller has checked the payer can afford it. With cfg.jackpot, taxes, fines and
 * card payments to the bank also go into the pot (whenever they are paid: on the spot or when a debt settles).
 */
export function transfer(c: Ctx, from: Creditor, to: Creditor, amount: number, why: CashWhy, space?: number): void {
  if (amount <= 0 || from === to) return;
  if (to === 'bank' && from !== 'bank' && c.s.cfg.jackpot && JACKPOT_WHY.has(why)) c.s.pot += amount;
  const after: Partial<Record<SeatId, number>> = {};
  if (from !== 'bank') {
    const p = player(c.s, from);
    p.cash -= amount;
    after[from] = p.cash;
  }
  if (to !== 'bank') {
    const p = player(c.s, to);
    p.cash += amount;
    after[to] = p.cash;
  }
  emit(c, { t: 'cash', from, to, amount, why, after, ...(space === undefined ? {} : { space }) });
}

/** Only amounts owed to someone still able to receive them (an out seat's share goes to nobody) */
export function cleanOwed(s: GameState, from: SeatId, owed: Owed): Owed {
  const out: Owed = {};
  for (const [to, n] of Object.entries(owed) as [Creditor, number][]) {
    if (!(n > 0)) continue;
    if (to === 'bank') out.bank = (out.bank ?? 0) + n;
    else if (to !== from && isActive(s, to)) out[to] = (out[to] ?? 0) + n;
  }
  return out;
}

/** Pays every creditor in order. The caller has checked the payer can afford the total. */
export function payAll(c: Ctx, from: SeatId, owed: Owed, why: CashWhy, space?: number): void {
  for (const to of creditors(c.s, from, owed)) transfer(c, from, to, owed[to] ?? 0, why, space);
}

/**
 * Pays now when the cash is there; otherwise the debtor enters `debt` (the current phase, and the pending steps,
 * wait until it is settled or the debtor is out). The debt keeps `space`, so the payment that settles it names the
 * same space as one made on the spot.
 */
export function pay(c: Ctx, from: SeatId, owed: Owed, why: CashWhy, space?: number): void {
  if (!isActive(c.s, from)) return;
  const clean = cleanOwed(c.s, from, owed);
  const total = owedTotal(clean);
  if (total === 0) return;
  if (player(c.s, from).cash >= total) {
    payAll(c, from, clean, why, space);
    return;
  }
  setPhase(c, { k: 'debt', debtor: from, owed: clean, why, ...(space === undefined ? {} : { space }), resume: c.s.phase });
  emit(c, { t: 'debt', debtor: from, owed: clean, total, why });
}

/** Settles the current debt phase if the debtor can now pay. Returns whether it did. */
export function settleDebt(c: Ctx): boolean {
  const ph = c.s.phase;
  if (ph.k !== 'debt') return false;
  const owed = cleanOwed(c.s, ph.debtor, ph.owed);
  const total = owedTotal(owed);
  if (isActive(c.s, ph.debtor) && player(c.s, ph.debtor).cash < total) return false;
  if (isActive(c.s, ph.debtor)) {
    payAll(c, ph.debtor, owed, ph.why, ph.space);
    emit(c, { t: 'debtPaid', debtor: ph.debtor });
  }
  setPhase(c, ph.resume);
  return true;
}
