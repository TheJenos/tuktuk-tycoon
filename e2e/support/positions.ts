import { createDoc, encodeDoc, nextDeadline } from '../../src/net/doc';
import { LOCAL_PLAYER, SOLO_SAVE_KEY } from '../../src/net/local';
import { readSetup, roomConfig, setupSeats, type SetupRecord } from '../../src/net/network';
import type { BotSkill, Doc, PlayerId, SeatInfo } from '../../src/net/types';
import {
  checkInvariants,
  getBoard,
  isProperty,
  RULES_VERSION,
  SEAT_IDS,
  type Deck,
  type GameState,
  type Level,
  type RulesConfig,
  type SeatId,
} from '../../src/rules';
import { OFFLINE_TIMERS, type TimerRules } from '../../src/shared/timing';
import { SEAT_COLORS, TOKENS } from '../../src/shared/tokens';

/*
 * Game positions for a test to start from, made with the game's own code (src/net/doc.ts) and then arranged: who
 * moves first, where everyone stands, who owns what, which card is on top. Every position is checked against the
 * engine's invariants, so a test never starts from a state the game would refuse to play on.
 *
 * Offline games start from a seeded autosave (soloSave, then Continue); online rooms from a seeded
 * rooms/{code}/state (fixtures.ts, `position`). Both have `debug` on, so game.test.rig() and setCash() work.
 */

export const BOARD = getBoard('lanka');

/** A board index by its printed name: space('Galle Face Penthouse') is 39 */
export function space(name: string): number {
  const i = BOARD.spaces.findIndex((sp) => sp.name === name);
  if (i < 0) throw new Error(`No space called ${name}`);
  return i;
}

export const spaceName = (i: number): string => BOARD.spaces[i]?.name ?? `space ${i}`;

export interface SeatSpec {
  name: string;
  /** A bot (of this level, or Normal) instead of a human seat */
  bot?: BotSkill | true;
}

/** Seats s0, s1, ... in order: humans controlled by `ctrl`, bots by nobody */
export function seatInfos(specs: SeatSpec[], ctrl: PlayerId = LOCAL_PLAYER): SeatInfo[] {
  return specs.map((spec, i): SeatInfo => {
    const seat = SEAT_IDS[i];
    if (!seat) throw new Error('At most 8 seats');
    const base = { seat, name: spec.name, token: TOKENS[i]!.id, color: SEAT_COLORS[i]! };
    return spec.bot
      ? { ...base, kind: 'bot', ctrl: '', skill: spec.bot === true ? 'normal' : spec.bot }
      : { ...base, kind: 'human', ctrl };
  });
}

export interface PositionOptions {
  rules?: Partial<RulesConfig>;
  timers?: TimerRules;
  /** Moves first (the default: the first seat); play then follows seat order */
  first?: SeatId;
  /** Arrange the state (see the helpers below) */
  edit?(s: GameState): void;
  gid?: string;
  seed?: number;
}

/** A new game at seq 0 with debug rules, arranged by `edit` */
export function position(seats: SeatInfo[], o: PositionOptions = {}): Doc {
  const timers = o.timers ?? OFFLINE_TIMERS;
  const at = Date.now();
  const doc = createDoc({ gid: o.gid ?? `g_E2E${at.toString(36)}`, seats, rules: { debug: true, ...o.rules }, timers, seed: o.seed ?? 7, at });
  const s = doc.game;
  const ids = seats.map((x) => x.seat);
  const first = o.first ?? ids[0]!;
  const k = ids.indexOf(first);
  if (k < 0) throw new Error(`${first} is not at the table`);
  s.order = [...ids.slice(k), ...ids.slice(0, k)];
  s.turn = { seat: first, no: 1, doubles: 0, again: false };
  o.edit?.(s);
  const broken = checkInvariants(s);
  if (broken.length) throw new Error(`The test position breaks the rules: ${broken.join('; ')}`);
  // Arranging may have changed which decision the clock runs on
  delete doc.deadline;
  const deadline = nextDeadline(undefined, s, [], at, timers);
  if (deadline) doc.deadline = deadline;
  return doc;
}

// ---------------------------------------------------------------------------------------------------- arranging

const player = (s: GameState, seat: SeatId) => {
  const p = s.players[seat];
  if (!p) throw new Error(`${seat} is not at the table`);
  return p;
};

/** `seat` owns these spaces (unbuilt, unmortgaged) */
export function own(s: GameState, seat: SeatId, ...spaces: number[]): void {
  for (const i of spaces) {
    if (!isProperty(BOARD.spaces[i])) throw new Error(`${spaceName(i)} can't be owned`);
    s.props[`p${i}`] = { owner: seat, level: 0 };
  }
}

/** Buildings on an owned street (the bank's stock follows); the caller keeps the group even */
export function build(s: GameState, space: number, level: Level): void {
  const ps = s.props[`p${space}`];
  if (!ps) throw new Error(`Nobody owns ${spaceName(space)}`);
  const houses = (l: number) => (l === 5 ? 0 : l);
  s.bank.houses += houses(ps.level) - houses(level);
  s.bank.hotels += (ps.level === 5 ? 1 : 0) - (level === 5 ? 1 : 0);
  ps.level = level;
}

export function mortgage(s: GameState, space: number): void {
  const ps = s.props[`p${space}`];
  if (!ps) throw new Error(`Nobody owns ${spaceName(space)}`);
  ps.mortgaged = true;
}

export function place(s: GameState, seat: SeatId, pos: number): void {
  player(s, seat).pos = pos;
}

export function setCash(s: GameState, seat: SeatId, cash: number): void {
  player(s, seat).cash = cash;
}

/** In jail, with `tries` failed rolls behind them */
export function jail(s: GameState, seat: SeatId, tries = 0): void {
  const p = player(s, seat);
  p.pos = BOARD.jailIndex;
  p.jail = { tries };
}

/** The Speed Die is unlocked for `seat` (as after a first GO salary) */
export function speedOn(s: GameState, seat: SeatId): void {
  player(s, seat).speed = true;
}

/** `cardId` on top of its deck */
export function topCard(s: GameState, deck: Deck, cardId: string): void {
  const cards = s.decks[deck];
  const i = cards.indexOf(cardId);
  if (i < 0) throw new Error(`${cardId} is not in the ${deck} deck`);
  cards.splice(i, 1);
  cards.unshift(cardId);
}

// ---------------------------------------------------------------------------------------------------- offline

/** The localStorage entry (src/net/local.ts) that "Continue solo game" picks up */
export function soloSave(doc: Doc, name = ''): [key: string, value: string] {
  return [SOLO_SAVE_KEY, JSON.stringify({ v: RULES_VERSION, name, at: Date.now(), doc: encodeDoc(doc) })];
}

// ---------------------------------------------------------------------------------------------------- online

/**
 * A position for an online room, from its setup once everyone has sat down (`table({ position })`): the seats as
 * the waiting room has them (Alice s0, Bob s1, then any bots), and the room's rules and timers as Start would use.
 */
export function roomPosition(setup: Partial<SetupRecord> | null, o: PositionOptions = {}): Doc {
  const room = readSetup(setup ?? {});
  if (!room) throw new Error('The room has no setup');
  const seats = setupSeats(room);
  const { rules, timers } = roomConfig(room.rules);
  return position(seats, { ...o, rules: { ...rules, ...o.rules }, timers: o.timers ?? timers });
}
