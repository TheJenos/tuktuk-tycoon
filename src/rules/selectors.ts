import { minBid as auctionMinBid } from './auction';
import { cardById, getBoard, groupOf as boardGroupOf, isStreet } from './board';
import {
  buildableGroups,
  capacity,
  groupLevels,
  placeSites as boardPlaceSites,
} from './buildings';
import { activeSeats as active, isActive as seatActive, ownerOf as owner, prop } from './ctx';
import type { Handler } from './handler';
import { HANDLERS } from './handlers';
import { maxRaise as raise, netWorth as net, worth as taxWorth } from './money';
import { unmortgageCost as liftCost, xferCost as settleCost } from './mortgage';
import { ranking as rank } from './over';
import { type RentOpts, ownsGroup as owns, rentFor as rent } from './rent';
import { tradeProblems as problems } from './trade';
import type {
  Action,
  BoardDef,
  BuildKind,
  CardDef,
  GameState,
  GroupDef,
  Level,
  PropState,
  RuleError,
  SeatId,
  Trade,
} from './types';

/*
 * Read-only helpers for the UI and bots. Each takes the state and finds the board itself.
 */

export const boardOf = (s: GameState): BoardDef => getBoard(s.cfg.board);

const check = (s: GameState, seat: SeatId, a: Action): RuleError | null =>
  (HANDLERS[a.k] as Handler<Action['k']>).check(s, boardOf(s), seat, a as never);

/** Rent a visitor would pay on `space` now (utilities: pass the dice total, default the current roll) */
export const rentFor = (s: GameState, space: number, opts?: RentOpts): number => rent(s, boardOf(s), space, opts);
/** The rulebook's worth (Income Tax): cash + printed prices + building cost */
export const worth = (s: GameState, seat: SeatId): number => taxWorth(s, boardOf(s), seat);
/** Worth for rankings: mortgaged property counts its value once lifted */
export const netWorth = (s: GameState, seat: SeatId): number => net(s, boardOf(s), seat);
/** Cash + every building sold + every property mortgaged */
export const maxRaise = (s: GameState, seat: SeatId): number => raise(s, boardOf(s), seat);
export const groupOf = (s: GameState, space: number): GroupDef | undefined => boardGroupOf(boardOf(s), space);
export const ownsGroup = (s: GameState, seat: SeatId, group: string): boolean => owns(s, boardOf(s), seat, group);
export const ownerOf = (s: GameState, space: number): SeatId | undefined => owner(s, space);
export const propertyState = (s: GameState, space: number): PropState | undefined => prop(s, space);
export const isActive = (s: GameState, seat: SeatId): boolean => seatActive(s, seat);
export const activeSeats = (s: GameState): SeatId[] => active(s);
/** Mortgage value + interest */
export const unmortgageCost = (s: GameState, space: number): number => liftCost(s, boardOf(s), space);
/** What settleMortgages{lift} costs for received mortgaged property */
export const xferCost = (s: GameState, spaces: number[], lift: number[]): number =>
  settleCost(s, boardOf(s), spaces, lift);
/** Everything wrong with an offer right now; empty = it can be proposed or accepted */
export const tradeProblems = (s: GameState, t: Omit<Trade, 'id'>): RuleError[] => problems(s, boardOf(s), t);
/** null = the seat may mortgage the space now; otherwise why not */
export const canMortgage = (s: GameState, seat: SeatId, space: number): RuleError | null =>
  check(s, seat, { k: 'mortgage', space });
export const canUnmortgage = (s: GameState, seat: SeatId, space: number): RuleError | null =>
  check(s, seat, { k: 'unmortgage', space });
/** The lowest legal bid in the current auction */
export const minBid = (s: GameState): number | undefined =>
  s.phase.k === 'auction' ? auctionMinBid(s.phase) : undefined;
/** Where a building unit may be placed now (place phase, or for planning) */
export const placeSites = (s: GameState, seat: SeatId, kind: BuildKind): number[] =>
  boardPlaceSites(s, boardOf(s), seat, kind, !(s.phase.k === 'place' && s.phase.bid !== undefined));
/** Units of a kind a seat could want now (what requestBuild accepts at most) */
export const buildCapacity = (s: GameState, seat: SeatId, kind: BuildKind): number =>
  capacity(s, boardOf(s), seat, kind);
/** Final standings if the game ended now */
export const ranking = (s: GameState): SeatId[] => rank(s, boardOf(s));
export const cardOf = (s: GameState, id: string): CardDef | undefined => cardById(boardOf(s), id);

export interface BuildOption {
  group: string;
  name: string;
  spaces: number[];
  levels: Level[];
  /** The seat owns the whole group */
  complete: boolean;
  houseCost: number;
  /** Legal single-step raises now */
  build: { space: number; action: Action }[];
  /** Legal single-step sales now */
  sell: { space: number; action: Action }[];
  /** Sell every building in the group at once (always possible, even with no houses in the bank) */
  sellAll?: Action;
  /** Why nothing can be built now (set when `build` is empty) */
  reason?: string;
}

/** Build and sell choices for every colour group the seat owns part of, with reasons when blocked */
export function buildOptions(s: GameState, seat: SeatId): BuildOption[] {
  const b = boardOf(s);
  const complete = new Set(buildableGroups(s, b, seat).map((g) => g.id));
  const out: BuildOption[] = [];
  for (const g of b.groups) {
    const first = b.spaces[g.spaces[0] as number];
    if (!isStreet(first) || !g.spaces.some((space) => owner(s, space) === seat)) continue;
    const levels = groupLevels(s, g);
    const step = (i: number, d: number): number[] => levels.map((l, j) => (j === i ? l + d : l));
    const opt: BuildOption = {
      group: g.id,
      name: g.name,
      spaces: [...g.spaces],
      levels,
      complete: g.spaces.every((space) => owner(s, space) === seat),
      houseCost: first.house,
      build: [],
      sell: [],
    };
    g.spaces.forEach((space, i) => {
      const up: Action = { k: 'build', group: g.id, levels: step(i, 1) };
      if (check(s, seat, up) === null) opt.build.push({ space, action: up });
      const down: Action = { k: 'sell', group: g.id, levels: step(i, -1) };
      if ((levels[i] ?? 0) > 0 && check(s, seat, down) === null) opt.sell.push({ space, action: down });
    });
    const all: Action = { k: 'sell', group: g.id, levels: levels.map(() => 0) };
    if (levels.some((l) => l > 0) && check(s, seat, all) === null) opt.sellAll = all;
    if (opt.build.length === 0) {
      if (!opt.complete) opt.reason = 'Own the whole colour group to build';
      else if (!complete.has(g.id)) opt.reason = 'Lift every mortgage in the group first';
      else {
        const lowest = levels.indexOf(Math.min(...levels) as Level);
        const why = check(s, seat, { k: 'build', group: g.id, levels: step(lowest, 1) });
        opt.reason = why?.message ?? 'Cannot build now';
      }
    }
    out.push(opt);
  }
  return out;
}

/** What each Income Tax choice would cost (the UI should hide this until the player has chosen) */
export function incomeTaxAmounts(s: GameState, seat: SeatId): { flat: number; percent: number } {
  return { flat: s.cfg.incomeFlat, percent: Math.floor((worth(s, seat) * s.cfg.incomePct) / 100) };
}

/** Seats still in, for UIs that list opponents */
export const opponents = (s: GameState, seat: SeatId): SeatId[] => active(s).filter((x) => x !== seat);
