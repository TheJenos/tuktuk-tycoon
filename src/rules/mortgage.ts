import { groupOf, propertyAt, siblings } from './board';
import { type Ctx, emit, err, interest, levelOf, phaseChain, player, prop, propKey, setPhase } from './ctx';
import { type Handler, isInt, seatAction } from './handler';
import { pay, transfer } from './money';
import type { BoardDef, GameState, OwnerVia, RuleError, SeatId } from './types';

/** What lifting a mortgage costs: the mortgage value + interest (rounded up: Power Cut Board 83) */
export function unmortgageCost(s: GameState, b: BoardDef, space: number): number {
  const m = propertyAt(b, space)?.mortgage ?? 0;
  return m + interest(s, m);
}

/** Why this seat cannot mortgage the space now (null = it can); phases are checked by the caller */
export function mortgageProblem(s: GameState, b: BoardDef, seat: SeatId, space: unknown): RuleError | null {
  if (!isInt(space) || !propertyAt(b, space)) return err('badSpace', 'Not a property');
  const ps = prop(s, space);
  if (ps?.owner !== seat) return err('notOwner', 'You do not own it');
  if (ps.mortgaged) return err('mortgaged', 'Already mortgaged');
  if (siblings(b, space).some((sp) => levelOf(s, sp) > 0)) return err('buildings', 'Sell the group\'s buildings first');
  return null;
}

/** What the bank pays for a property sold back to it: its mortgage value, or nothing when it is mortgaged */
export function saleValue(s: GameState, b: BoardDef, space: number): number {
  return prop(s, space)?.mortgaged ? 0 : (propertyAt(b, space)?.mortgage ?? 0);
}

/** Why this seat cannot sell the space back to the bank now (null = it can); phases are checked by the caller */
export function saleProblem(s: GameState, b: BoardDef, seat: SeatId, space: unknown): RuleError | null {
  if (!isInt(space) || !propertyAt(b, space)) return err('badSpace', 'Not a property');
  if (prop(s, space)?.owner !== seat) return err('notOwner', 'You do not own it');
  if (siblings(b, space).some((sp) => levelOf(s, sp) > 0)) {
    const g = groupOf(b, space);
    return err('buildings', `Sell the buildings in ${g ? `the ${g.name} group` : 'its group'} first`);
  }
  // Received mortgaged in a trade and not settled yet: settle it first
  if (phaseChain(s.phase).some((p) => p.k === 'mortgageXfer' && p.spaces.includes(space))) {
    return err('settling', 'Settle its mortgage first');
  }
  return null;
}

/**
 * The property goes back to the bank (unowned, unbuilt, unmortgaged) and the bank pays its sale value: the mortgage
 * value, or nothing for a mortgaged one (the owner already has that loan). The caller has cleared the buildings.
 */
export function sellToBank(c: Ctx, seat: SeatId, space: number, via: OwnerVia): void {
  const ps = prop(c.s, space);
  if (!ps || ps.owner !== seat) return;
  const value = saleValue(c.s, c.b, space);
  if (ps.mortgaged) emit(c, { t: 'mortgage', space, on: false });
  delete c.s.props[propKey(space)];
  emit(c, { t: 'owner', space, from: seat, via });
  transfer(c, 'bank', seat, value, 'sale', space);
}

export function unmortgageProblem(s: GameState, b: BoardDef, seat: SeatId, space: unknown): RuleError | null {
  if (!isInt(space) || !propertyAt(b, space)) return err('badSpace', 'Not a property');
  const ps = prop(s, space);
  if (ps?.owner !== seat) return err('notOwner', 'You do not own it');
  if (!ps.mortgaged) return err('notMortgaged', 'It is not mortgaged');
  if (player(s, seat).cash < unmortgageCost(s, b, space)) return err('cash', 'Not enough cash to lift the mortgage');
  return null;
}

export function mortgageNow(c: Ctx, seat: SeatId, space: number): void {
  const ps = prop(c.s, space);
  if (!ps) return;
  ps.mortgaged = true;
  emit(c, { t: 'mortgage', space, on: true });
  transfer(c, 'bank', seat, propertyAt(c.b, space)?.mortgage ?? 0, 'mortgage', space);
}

export function unmortgageNow(c: Ctx, seat: SeatId, space: number, cost: number): void {
  const ps = prop(c.s, space);
  if (!ps) return;
  delete ps.mortgaged;
  emit(c, { t: 'mortgage', space, on: false });
  transfer(c, seat, 'bank', cost, 'unmortgage', space);
}

/**
 * A seat received mortgaged property in a trade: it chooses per space to lift it now (mortgage + 10%)
 * or pay just the 10% now and keep it mortgaged (lifting later costs the full mortgage + 10% again).
 */
export function startXfer(c: Ctx, seat: SeatId, spaces: number[]): void {
  const list = spaces.filter((space) => prop(c.s, space)?.mortgaged).sort((x, y) => x - y);
  if (list.length === 0) return;
  setPhase(c, { k: 'mortgageXfer', seat, spaces: list, resume: c.s.phase });
  emit(c, { t: 'xferStart', seat, spaces: list });
}

/** Total due when settling received mortgages, lifting `lift` and keeping the rest */
export function xferCost(s: GameState, b: BoardDef, spaces: number[], lift: number[]): number {
  return spaces.reduce((total, space) => {
    const m = propertyAt(b, space)?.mortgage ?? 0;
    return total + interest(s, m) + (lift.includes(space) ? m : 0);
  }, 0);
}

export const settleMortgages: Handler<'settleMortgages'> = seatAction(
  (s, b, seat, a) => {
    const ph = s.phase;
    if (ph.k !== 'mortgageXfer') return err('phase', 'No mortgages to settle');
    if (ph.seat !== seat) return err('notYou', 'Another player is settling mortgages');
    const lift = a.lift;
    if (!Array.isArray(lift) || !lift.every((sp) => isInt(sp) && ph.spaces.includes(sp))) {
      return err('badLift', 'Lift only mortgages you just received');
    }
    if (new Set(lift).size !== lift.length) return err('badLift', 'Each space once');
    if (lift.length > 0 && player(s, seat).cash < xferCost(s, b, ph.spaces, lift)) {
      return err('cash', 'Not enough cash to lift those; keep them mortgaged and pay the interest');
    }
    return null;
  },
  (c, seat, a) => {
    const ph = c.s.phase;
    if (ph.k !== 'mortgageXfer') return;
    setPhase(c, ph.resume);
    const keep = ph.spaces.filter((space) => !a.lift.includes(space));
    for (const space of a.lift) unmortgageNow(c, seat, space, unmortgageCost(c.s, c.b, space));
    // Interest only on the kept ones; when it cannot be paid this opens a debt to the bank.
    const due = xferCost(c.s, c.b, keep, []);
    if (due > 0) pay(c, seat, { bank: due }, 'interest');
  },
);
