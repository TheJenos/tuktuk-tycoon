import { getBoard } from './board';
import { formatMoney } from './currency';
import type {
  Actor,
  BoardDef,
  GameEvent,
  GameState,
  Phase,
  PlayerState,
  PropState,
  RuleError,
  SeatId,
} from './types';

/*
 * The working context of one apply(): the cloned state being mutated, its board, and the events produced. Also the
 * small state helpers every module shares.
 */

export interface Ctx {
  s: GameState;
  b: BoardDef;
  ev: GameEvent[];
  /** A phase was entered during this command (restarts the timer) */
  entered: boolean;
}

export const makeCtx = (s: GameState): Ctx => ({ s, b: getBoard(s.cfg.board), ev: [], entered: false });

export const emit = (c: Ctx, e: GameEvent): void => {
  c.ev.push(e);
};

/** Enter a phase. Every new phase (or a re-entered one) goes through here so timer keys restart. */
export function setPhase(c: Ctx, p: Phase): void {
  c.s.phase = p;
  c.entered = true;
}

export const err = (code: string, message: string): RuleError => ({ code, message });

/** Money in a player-facing message, as shown: 1500 units read "Rs. 150,000" (see currency.ts) */
export const rs = (n: number): string => formatMoney(n);

export function player(s: GameState, seat: SeatId): PlayerState {
  const p = s.players[seat];
  if (!p) throw new Error(`no player ${seat}`);
  return p;
}

export const isSeat = (s: GameState, by: Actor | string): by is SeatId =>
  by !== 'system' && Object.prototype.hasOwnProperty.call(s.players, by);

export const isActive = (s: GameState, seat: SeatId): boolean => {
  const p = s.players[seat];
  return !!p && !p.out;
};

/** Seats still in the game, in turn order */
export const activeSeats = (s: GameState): SeatId[] => s.order.filter((id) => isActive(s, id));

/** Seats in turn order starting after `seat` (wrapping), excluding it */
export function seatsAfter(s: GameState, seat: SeatId): SeatId[] {
  const i = s.order.indexOf(seat);
  return [...s.order.slice(i + 1), ...s.order.slice(0, Math.max(0, i))].filter((id) => id !== seat);
}

export const propKey = (space: number): string => `p${space}`;

export const prop = (s: GameState, space: number): PropState | undefined => s.props[propKey(space)];

export const ownerOf = (s: GameState, space: number): SeatId | undefined => prop(s, space)?.owner;

/** Spaces owned by a seat, in board order */
export function ownedBy(s: GameState, seat: SeatId): number[] {
  const out: number[] = [];
  for (const [key, ps] of Object.entries(s.props)) if (ps?.owner === seat) out.push(Number(key.slice(1)));
  return out.sort((a, b) => a - b);
}

export const levelOf = (s: GameState, space: number): number => prop(s, space)?.level ?? 0;

/** The interest on a mortgage value (rounded up: Power Cut Board 90 -> 9) */
export const interest = (s: GameState, m: number): number => Math.ceil((m * s.cfg.mortgagePct) / 100);

export const isOver = (s: GameState): boolean => s.phase.k === 'over';

/** The owner collects rent now (not when jailed with cfg.jailRent off) */
export const collectsRent = (s: GameState, owner: SeatId): boolean => s.cfg.jailRent || !s.players[owner]?.jail;

/** The seat may buy property and bid for it (cfg.buyAfterFirstLap: only once it has collected a GO salary) */
export const mayBuy = (s: GameState, seat: SeatId): boolean => !s.cfg.buyAfterFirstLap || (s.players[seat]?.laps ?? 0) > 0;

/** Seats that may bid for a property at auction, in turn order */
export const propBidders = (s: GameState): SeatId[] => activeSeats(s).filter((seat) => mayBuy(s, seat));

/** The trading rule allows trades between these two seats now (null) or why not */
export function tradingClosed(s: GameState, a: SeatId, b: SeatId): RuleError | null {
  const { trading, tradeAfterLap } = s.cfg;
  if (trading === 'off') return err('tradingOff', 'Trading is off in this game');
  if (trading === 'afterLap') {
    const short = [a, b].some((seat) => (s.players[seat]?.laps ?? 0) < tradeAfterLap);
    if (short) return err('tradingLater', `Trading opens after lap ${tradeAfterLap}`);
  }
  return null;
}

/** The phase and every phase it will resume to, outermost first */
export function phaseChain(p: Phase): Phase[] {
  const out: Phase[] = [p];
  let cur: Phase = p;
  while ('resume' in cur) {
    cur = cur.resume;
    out.push(cur);
  }
  return out;
}

/** Deep equality of plain JSON values (key order does not matter) */
export function deepEqual(x: unknown, y: unknown): boolean {
  if (x === y) return true;
  if (typeof x !== 'object' || typeof y !== 'object' || x === null || y === null) return false;
  if (Array.isArray(x) !== Array.isArray(y)) return false;
  const a = x as Record<string, unknown>;
  const b = y as Record<string, unknown>;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => k in b && deepEqual(a[k], b[k]));
}
