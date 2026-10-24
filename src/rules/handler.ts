import { type Ctx, err } from './ctx';
import type { Action, ActionKind, Actor, BoardDef, GameState, RuleError, SeatId } from './types';

export type ActionOf<K extends ActionKind> = Extract<Action, { k: K }>;

/**
 * One action: `check` is a pure read of the live state (legalActions calls it for every candidate), `run` mutates
 * the cloned state and may assume `check` passed.
 */
export interface Handler<K extends ActionKind> {
  /** Who may send it: a seat, the system (driver chores), or either */
  who: 'seat' | 'system' | 'any';
  check(s: GameState, b: BoardDef, by: Actor, a: ActionOf<K>): RuleError | null;
  run(c: Ctx, by: Actor, a: ActionOf<K>): void;
}

export type HandlerTable = { [K in ActionKind]: Handler<K> };

/** A handler only seats may send (the actor is a SeatId) */
export function seatAction<K extends ActionKind>(
  check: (s: GameState, b: BoardDef, seat: SeatId, a: ActionOf<K>) => RuleError | null,
  run: (c: Ctx, seat: SeatId, a: ActionOf<K>) => void,
): Handler<K> {
  return {
    who: 'seat',
    check: (s, b, by, a) => check(s, b, by as SeatId, a),
    run: (c, by, a) => run(c, by as SeatId, a),
  };
}

export function systemAction<K extends ActionKind>(
  check: (s: GameState, b: BoardDef, a: ActionOf<K>) => RuleError | null,
  run: (c: Ctx, a: ActionOf<K>) => void,
): Handler<K> {
  return { who: 'system', check: (s, b, _by, a) => check(s, b, a), run: (c, _by, a) => run(c, a) };
}

export const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);

/** The common check for turn choices: the phase is open and the seat is the turn seat */
export function turnCheck(s: GameState, seat: SeatId, phase: string): RuleError | null {
  if (s.phase.k !== phase) return err('phase', 'That choice is not open now');
  if (s.turn.seat !== seat) return err('notYourTurn', 'It is not your turn');
  return null;
}

/** Phases in which owners may build and unmortgage */
export const MANAGE_PHASES: ReadonlySet<string> = new Set(['preRoll', 'postRoll', 'buy']);
/** Phases in which anyone may sell buildings and mortgage (raising cash) */
export const RAISE_PHASES: ReadonlySet<string> = new Set([
  'preRoll',
  'postRoll',
  'buy',
  'incomeTax',
  'auction',
  'debt',
  'mortgageXfer',
]);
/** Phases in which a trade offer may be accepted */
export const ACCEPT_PHASES: ReadonlySet<string> = new Set(['preRoll', 'postRoll', 'buy', 'debt']);
