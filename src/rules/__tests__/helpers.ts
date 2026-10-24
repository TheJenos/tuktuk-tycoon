import { expect } from 'vitest';
import { apply, checkInvariants, createGame } from '..';
import type {
  Action,
  Actor,
  Command,
  GameEvent,
  GameState,
  Level,
  RigRoll,
  RulesConfig,
  SeatId,
} from '../types';

export const SEATS: SeatId[] = ['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7'];

/**
 * A game with `n` players where s0 starts and turn order is s0, s1, ... (the opening roll is overridden so tests
 * read naturally). Debug is on so dice can be rigged.
 */
export function scenario(opts: { n?: number; cfg?: Partial<RulesConfig>; seed?: number } = {}): GameState {
  const n = opts.n ?? 2;
  const seats = SEATS.slice(0, n).map((id, i) => ({ id, name: `P${i}` }));
  const { state } = createGame({ debug: true, ...opts.cfg }, seats, opts.seed ?? 1);
  state.order = SEATS.slice(0, n);
  state.turn = { seat: 's0', no: 1, doubles: 0, again: false };
  return state;
}

/** Owns spaces outright (mutates the state; for setting up scenarios) */
export function own(s: GameState, seat: SeatId, spaces: number[], opts: { level?: Level; mortgaged?: boolean } = {}): void {
  for (const space of spaces) {
    s.props[`p${space}`] = { owner: seat, level: opts.level ?? 0, ...(opts.mortgaged ? { mortgaged: true as const } : {}) };
    if (opts.level) {
      if (opts.level === 5) s.bank.hotels--;
      else s.bank.houses -= opts.level;
    }
  }
}

export const cash = (s: GameState, seat: SeatId): number => s.players[seat]?.cash ?? NaN;
export const pos = (s: GameState, seat: SeatId): number => s.players[seat]?.pos ?? NaN;
export const setCash = (s: GameState, seat: SeatId, n: number): void => {
  const p = s.players[seat];
  if (p) p.cash = n;
};
export const setPos = (s: GameState, seat: SeatId, n: number): void => {
  const p = s.players[seat];
  if (p) p.pos = n;
};

/** Queue rigged throws */
export const rig = (s: GameState, ...rolls: RigRoll[]): void => {
  s.rig.push(...rolls);
};

/** Puts these card ids on top of a deck, in order */
export function stack(s: GameState, deck: 'chance' | 'chest', ...ids: string[]): void {
  s.decks[deck] = [...ids, ...s.decks[deck].filter((id) => !ids.includes(id))];
}

export interface Step {
  state: GameState;
  events: GameEvent[];
}

/** Applies one command; it must succeed and keep every invariant */
export function act(s: GameState, by: Actor, a: Action, basis?: number): Step {
  const cmd: Command = basis === undefined ? { by, a } : { by, a, basis };
  const r = apply(s, cmd, { check: true });
  if (!r.ok) throw new Error(`${by} ${JSON.stringify(a)} failed: ${r.error.code} ${r.error.message}`);
  expect(checkInvariants(r.state)).toEqual([]);
  return { state: r.state, events: r.events };
}

/** Applies commands in order (each must succeed); returns the last state and every event */
export function run(s: GameState, ...cmds: [Actor, Action][]): Step {
  let state = s;
  const events: GameEvent[] = [];
  for (const [by, a] of cmds) {
    const r = act(state, by, a);
    state = r.state;
    events.push(...r.events);
  }
  return { state, events };
}

/** Applies a command expected to fail, returning the error code */
export function refused(s: GameState, by: Actor, a: Action, basis?: number): string {
  const r = apply(s, basis === undefined ? { by, a } : { by, a, basis }, { check: true });
  if (r.ok) throw new Error(`${by} ${JSON.stringify(a)} unexpectedly succeeded`);
  return r.error.code;
}

export const ofType = <T extends GameEvent['t']>(events: GameEvent[], t: T): Extract<GameEvent, { t: T }>[] =>
  events.filter((e): e is Extract<GameEvent, { t: T }> => e.t === t);

/** Every cash change of a seat in the events adds up to `delta` */
export function cashDelta(events: GameEvent[], seat: SeatId): number {
  let d = 0;
  for (const e of ofType(events, 'cash')) {
    if (e.from === seat) d -= e.amount;
    if (e.to === seat) d += e.amount;
  }
  return d;
}
