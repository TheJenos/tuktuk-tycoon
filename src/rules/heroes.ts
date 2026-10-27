import { propertyAt, propertySpaces } from './board';
import { type Ctx, activeSeats, emit, isActive, isSeat, ownedBy, player, prop, propKey } from './ctx';
import { finish } from './over';
import type { BoardDef, CardFx, GameState, HeroDef, OwnerVia, PowerId, SeatId } from './types';

/*
 * Hero League (a board with a `heroes` block, docs/heroes.md): who plays which hero, whether a superpower can be used
 * now (its own, or Steel Ace's copy of a ready hero's), the Hero die's faces, saving a location and the end when every
 * location is saved. The windows and superpower actions built on these are in react.ts and powers.ts.
 */

/** The board's heroes in Hero-die face order (empty off a heroes board) */
export const heroesOf = (b: BoardDef): HeroDef[] => b.heroes?.list ?? [];

/** The hero a seat plays (undefined off a heroes board) */
export function heroDef(b: BoardDef, s: GameState, seat: SeatId): HeroDef | undefined {
  const id = s.players[seat]?.hero;
  return id === undefined ? undefined : heroesOf(b).find((h) => h.id === id);
}

/** The Hero-die face (1-6) of the hero a seat plays; 0 when none */
export const faceOf = (b: BoardDef, s: GameState, seat: SeatId): number =>
  heroesOf(b).findIndex((h) => h.id === s.players[seat]?.hero) + 1;

/** The active seat playing the hero on a Hero-die face (undefined: nobody plays it) */
export function seatOfFace(b: BoardDef, s: GameState, face: number): SeatId | undefined {
  const h = heroesOf(b)[face - 1];
  return h ? activeSeats(s).find((seat) => s.players[seat]?.hero === h.id) : undefined;
}

/** An active seat playing a hero whose superpower is not used */
export function ready(s: GameState, seat: SeatId): boolean {
  const p = s.players[seat];
  return !!p && !p.out && p.hero !== undefined && p.powerUsed === undefined;
}

/**
 * How a seat can use `power` now: its own hero's ('own'), or Steel Ace's Suit Up copying another active hero who has
 * it and is ready ('copy'). Undefined when it cannot (its own power used, or nobody to copy). Phases are the caller's.
 */
export function powerSource(b: BoardDef, s: GameState, seat: SeatId, power: PowerId): 'own' | 'copy' | undefined {
  if (!b.heroes || !ready(s, seat)) return undefined;
  const own = heroDef(b, s, seat)?.power;
  if (own === power) return 'own';
  if (own !== 'copy' || power === 'copy') return undefined;
  return holderOf(b, s, power, seat) ? 'copy' : undefined;
}

/** The other active seat whose hero has `power`, if it is ready */
export function holderOf(b: BoardDef, s: GameState, power: PowerId, except: SeatId): SeatId | undefined {
  return activeSeats(s).find((seat) => seat !== except && heroDef(b, s, seat)?.power === power && ready(s, seat));
}

/** Seats that could re-roll a throw now (Thunder Call, or Steel Ace copying it), in turn order */
export const thunderSeats = (b: BoardDef, s: GameState): SeatId[] =>
  activeSeats(s).filter((seat) => powerSource(b, s, seat, 'thunder') !== undefined);

/** Spends a seat's superpower (on its own hero's card, also when copying) and says so */
export function usePower(c: Ctx, seat: SeatId, power: PowerId, target?: SeatId): void {
  const copied = powerSource(c.b, c.s, seat, power) === 'copy';
  player(c.s, seat).powerUsed = c.s.turn.no;
  emit(c, { t: 'power', seat, power, ...(copied ? { copied: true as const } : {}), ...(target ? { target } : {}) });
}

/**
 * The superpower is ready again: a Recharge card always, a Rally Point salary (`salary`) unless it was used during
 * this very turn (so a power's own move round the board never brings it straight back)
 */
export function recharge(c: Ctx, seat: SeatId, salary: boolean): void {
  const p = player(c.s, seat);
  if (p.powerUsed === undefined || (salary && p.powerUsed === c.s.turn.no)) return;
  delete p.powerUsed;
  emit(c, { t: 'powerReady', seat });
}

/** Every location is saved (owned by a hero) */
export const allSaved = (b: BoardDef, s: GameState): boolean => propertySpaces(b).every((space) => !!prop(s, space));

/** The final score: cash + locationPoints for each location owned */
export const scoreOf = (b: BoardDef, s: GameState, seat: SeatId): number =>
  player(s, seat).cash + (b.heroes?.locationPoints ?? 0) * ownedBy(s, seat).length;

/**
 * A hero now owns the location. The end is checked right after every grant: once every location is saved the game is
 * over (the rest of the chain, a roll still owed included, is dropped).
 */
export function grant(c: Ctx, seat: SeatId, space: number, via: OwnerVia): void {
  c.s.props[propKey(space)] = { owner: seat, level: 0 };
  emit(c, { t: 'owner', space, to: seat, via });
  if (allSaved(c.b, c.s)) finish(c, 'allSaved');
}

/** The location's cost (0 for anything else) */
export const costOf = (b: BoardDef, space: number): number => propertyAt(b, space)?.price ?? 0;

/**
 * Seats that could stand in as the back-up hero for a lander short of a location's cost: every other active seat
 * with the cash, in Hero-die face order (so a draw among them depends only on who they are)
 */
export function backupSeats(b: BoardDef, s: GameState, lander: SeatId, space: number): SeatId[] {
  const price = costOf(b, space);
  return activeSeats(s)
    .filter((seat) => seat !== lander && player(s, seat).cash >= price)
    .sort((x, y) => faceOf(b, s, x) - faceOf(b, s, y));
}

/**
 * A Villain Strike effect would do something to the seat (a shield window opens only then): losing Power with some
 * left, losing a location with one owned, being moved or captured outside the Holding Cell
 */
export function bites(s: GameState, seat: SeatId, fx: CardFx): boolean {
  const p = s.players[seat];
  if (!p || p.out) return false;
  switch (fx.k) {
    case 'cash':
      return fx.amount >= 0 || p.cash > 0;
    case 'each':
      return fx.amount >= 0 || (p.cash > 0 && activeSeats(s).length > 1);
    case 'lose':
      return ownedBy(s, seat).length > 0;
    case 'jail':
    case 'back':
      return !p.jail;
    default:
      return true;
  }
}

/**
 * The Titan Smash pairs a seat may swap now: two distinct active heroes outside the Holding Cell (the smasher may be
 * one; two on the same space may be picked too, the swap then moves nobody), once per unordered pair (turn order).
 * Empty unless it is that seat's preRoll before the turn's first roll and it can use Titan Smash.
 */
export function smashPairs(b: BoardDef, s: GameState, seat: SeatId): { a: SeatId; b: SeatId }[] {
  if (s.phase.k !== 'preRoll' || s.turn.seat !== seat || s.turn.roll || !powerSource(b, s, seat, 'smash')) return [];
  const free = activeSeats(s).filter((x) => !s.players[x]?.jail);
  const out: { a: SeatId; b: SeatId }[] = [];
  free.forEach((x, i) => {
    for (const y of free.slice(i + 1)) out.push({ a: x, b: y });
  });
  return out;
}

/** Two heroes a Titan Smash can swap: distinct, active and outside the Holding Cell */
export function swappable(s: GameState, a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a === b || !isSeat(s, a) || !isSeat(s, b)) return false;
  return isActive(s, a) && isActive(s, b) && !player(s, a).jail && !player(s, b).jail;
}

/** A Titan Smash of these two would move someone: they can be swapped and stand on different spaces */
export const smashMoves = (s: GameState, a: SeatId, b: SeatId): boolean =>
  swappable(s, a, b) && player(s, a).pos !== player(s, b).pos;
