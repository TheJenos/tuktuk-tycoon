import { groupById, propertyAt } from './board';
import { collectsRent, ownedBy, prop } from './ctx';
import type { BoardDef, GameState, Roll, SeatId, SpeedFace } from './types';

/** White dice plus a number face; Bus and Tuk-Tuk Uncle count 0 */
export const faceValue = (f: SpeedFace | undefined): number => (typeof f === 'number' ? f : 0);
export const rollTotal = (r: Roll | undefined): number => (r ? r.w[0] + r.w[1] + faceValue(r.s) : 0);

/** The seat owns every space of a colour group */
export function ownsGroup(s: GameState, b: BoardDef, seat: SeatId, group: string): boolean {
  const g = groupById(b, group);
  return !!g && g.spaces.every((space) => prop(s, space)?.owner === seat);
}

/** How many railroads (or utilities) a seat owns, mortgaged ones included */
export function countOwned(s: GameState, b: BoardDef, seat: SeatId, kind: 'rail' | 'utility'): number {
  return ownedBy(s, seat).filter((space) => propertyAt(b, space)?.k === kind).length;
}

export interface RentOpts {
  /** Dice total for utilities (defaults to the current turn's roll) */
  dice?: number;
  /** Railroad card: multiply the rent */
  railMul?: number;
  /** Utility card: dice x this, whatever the number owned */
  utilityMul?: number;
}

/** Rent owed by a visitor landing on `space` now (0 when unowned, mortgaged, or the owner is jailed and jailRent is off) */
export function rentFor(s: GameState, b: BoardDef, space: number, opts: RentOpts = {}): number {
  const sp = propertyAt(b, space);
  const ps = prop(s, space);
  if (!sp || !ps || ps.mortgaged || !collectsRent(s, ps.owner)) return 0;
  switch (sp.k) {
    case 'street': {
      if (ps.level > 0) return sp.rent[ps.level] ?? 0;
      const base = sp.rent[0] ?? 0;
      return ownsGroup(s, b, ps.owner, sp.group) ? base * 2 : base;
    }
    case 'rail': {
      const n = countOwned(s, b, ps.owner, 'rail');
      return (b.railRent[n - 1] ?? 0) * (opts.railMul ?? 1);
    }
    case 'utility': {
      const dice = opts.dice ?? rollTotal(s.turn.roll);
      if (opts.utilityMul) return dice * opts.utilityMul;
      const n = countOwned(s, b, ps.owner, 'utility');
      return dice * (b.utilityMul[n - 1] ?? 0);
    }
  }
}
