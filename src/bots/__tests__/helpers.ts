import { expect } from 'vitest';
import { apply, createGame, type Action, type GameState, type Level, type RigRoll, type RulesConfig, type SeatId } from '../../rules';
import type { BotSkill } from '../../net/types';
import type { BotTable } from '../ctx';
import { decideDetailed } from '../decide';

export const SEATS: SeatId[] = ['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7'];
export const SKILLS: BotSkill[] = ['easy', 'normal', 'hard', 'expert'];

/** A game where s0 starts and play goes s0, s1, ...; debug is on so dice can be rigged */
export function scenario(n = 2, cfg: Partial<RulesConfig> = {}, seed = 1): GameState {
  const seats = SEATS.slice(0, n).map((id, i) => ({ id, name: `P${i}` }));
  const { state } = createGame({ debug: true, ...cfg }, seats, seed);
  state.order = SEATS.slice(0, n);
  state.turn = { seat: 's0', no: 1, doubles: 0, again: false };
  return state;
}

/**
 * A Hero League game where s0 starts and play goes s0, s1, ...; seat i plays heroes[i]. Debug is on so the dice and the
 * Hero die can be rigged. Hero-die faces = the heroes' list order: 1 jadeTitan, 2 starCaptain, 3 steelAce, 4 stormLord,
 * 5 velvetViper, 6 sharpshot.
 */
export function heroGame(heroes: string[], cfg: Partial<RulesConfig> = {}, seed = 1): GameState {
  const seats = heroes.map((hero, i) => ({ id: SEATS[i] as SeatId, name: `P${i}`, hero }));
  const { state } = createGame({ debug: true, ...cfg, board: 'heroes' }, seats, seed);
  state.order = SEATS.slice(0, heroes.length);
  state.turn = { seat: 's0', no: 1, doubles: 0, again: false };
  return state;
}

/** Queues rigged Hero-die faces */
export const rigHero = (s: GameState, ...faces: number[]): void => void (s.rigHero = [...(s.rigHero ?? []), ...faces]);

/** Owns spaces outright (mutates; for setting up scenarios) */
export function own(s: GameState, seat: SeatId, spaces: number[], opts: { level?: Level; mortgaged?: boolean } = {}): void {
  for (const space of spaces) {
    s.props[`p${space}`] = { owner: seat, level: opts.level ?? 0, ...(opts.mortgaged ? { mortgaged: true as const } : {}) };
    if (opts.level === 5) s.bank.hotels--;
    else if (opts.level) s.bank.houses -= opts.level;
  }
}

export const setCash = (s: GameState, seat: SeatId, cash: number): void => void (s.players[seat]!.cash = cash);
export const setPos = (s: GameState, seat: SeatId, pos: number): void => void (s.players[seat]!.pos = pos);
export const rig = (s: GameState, ...rolls: RigRoll[]): void => void s.rig.push(...rolls);

/** Applies a command that must succeed */
export function act(s: GameState, by: SeatId, a: Action): GameState {
  const r = apply(s, { by, a }, { check: true });
  if (!r.ok) throw new Error(`${by} ${JSON.stringify(a)}: ${r.error.code} ${r.error.message}`);
  return r.state;
}

/** The bot's move: its own choice (no fallback), and the engine accepts it with invariants checked. `table`: the
 *  other bot seats' skills */
export function bot(s: GameState, seat: SeatId, skill: BotSkill, rnd: () => number = () => 0.5, table: BotTable = {}): Action {
  const before = JSON.stringify(s);
  const d = decideDetailed(s, seat, skill, rnd, table);
  expect(JSON.stringify(s), 'decide must not mutate the state').toBe(before);
  expect(d.problem ?? null, `${skill} ${seat} in ${s.phase.k}`).toBeNull();
  expect(d.fellBack).toBe(false);
  if (!d.action) throw new Error(`${skill} ${seat} returned null in ${s.phase.k}`);
  const r = apply(s, { by: seat, a: d.action, basis: s.seq }, { check: true });
  expect(r.ok ? 'ok' : `${r.error.code} ${r.error.message}`).toBe('ok');
  return d.action;
}

/** Applies the bot's move and returns the next state */
export function botStep(s: GameState, seat: SeatId, skill: BotSkill): GameState {
  return act(s, seat, bot(s, seat, skill));
}
