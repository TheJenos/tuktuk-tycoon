import { apply } from './apply';
import { minBid } from './auction';
import { awaiting, defaultAction, timeoutCommand } from './autoplay';
import { getBoard, siblings } from './board';
import { createGame, SEAT_IDS } from './create';
import { activeSeats, levelOf, ownedBy, player } from './ctx';
import { legalActions } from './legal';
import { isWindow } from './react';
import type { Action, Bundle, Command, GameEvent, GameState, RulesConfig, SeatId } from './types';

/*
 * A seeded random player for the fuzz test and `npm run sim` (not part of the game). It mostly answers what the
 * game waits for, sometimes manages property or trades out of turn, and sometimes lets a timeout fire.
 */

export type Rand = () => number;

/** mulberry32 as a plain function, for test-side randomness */
export function randFrom(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(r: Rand, items: readonly T[]): T | undefined => items[Math.floor(r() * items.length)];

/**
 * The optional rules varied by seed (fuzz tests and `--options` sims), each one away from its default often enough
 * that every combination of a few comes up across a run
 */
export function variedRules(seed: number): Partial<RulesConfig> {
  const r = randFrom(seed * 104_729 + 17);
  return {
    doubleGoLanding: r() < 0.5,
    jackpot: r() < 0.5,
    incomeTaxMode: pick(r, ['choice', 'flat', 'percent'] as const),
    auctions: r() < 0.6,
    buyAfterFirstLap: r() < 0.4,
    auctionAll: r() < 0.25,
    jailRent: r() < 0.6,
    threeDoublesJail: r() < 0.7,
    dealProperties: pick(r, [0, 0, 1, 2, 3]),
    endMode: r() < 0.3 ? 'firstBankrupt' : 'lastStanding',
    trading: pick(r, ['on', 'on', 'off', 'afterLap'] as const),
    tradeAfterLap: 1 + Math.floor(r() * 3),
    fixedAuctionCountdown: r() < 0.4,
  };
}

const MANAGE = new Set(['build', 'sell', 'mortgage', 'unmortgage']);

/**
 * Leans towards buying and building so games reach complete colour groups, shortages and bankruptcies. Titan Smash is
 * listed once per pair of heroes (up to 15), so each pair weighs little.
 */
const WEIGHT: Partial<Record<Action['k'], number>> = { buy: 4, build: 6, mortgage: 0.5, unmortgage: 0.3, smash: 0.03 };

function weighted(r: Rand, items: readonly Action[]): Action | undefined {
  const total = items.reduce((a, x) => a + (WEIGHT[x.k] ?? 1), 0);
  let roll = r() * total;
  for (const x of items) {
    roll -= WEIGHT[x.k] ?? 1;
    if (roll < 0) return x;
  }
  return items[items.length - 1];
}

/** A random (often invalid) trade offer built from what the two seats hold */
function randomOffer(s: GameState, r: Rand, from: SeatId): Action | null {
  const b = getBoard(s.cfg.board);
  const to = pick(r, activeSeats(s).filter((x) => x !== from));
  if (!to) return null;
  const tradable = (seat: SeatId): number[] =>
    ownedBy(s, seat).filter((space) => siblings(b, space).every((x) => levelOf(s, x) === 0));
  const bundle = (seat: SeatId): Bundle => {
    const props = tradable(seat).filter(() => r() < 0.3);
    const cards = player(s, seat).goojf.filter(() => r() < 0.5);
    const cash = r() < 0.5 ? Math.floor(r() * Math.min(400, player(s, seat).cash + 1)) : 0;
    return { cash, props, cards };
  };
  return { k: 'propose', to, give: bundle(from), get: bundle(to) };
}

export interface RandomOpts {
  /** Chance of letting the awaited seat's timeout fire instead */
  timeout?: number;
  /** Chance of a random trade offer */
  trade?: number;
  /** Chance an action from legalActions may be a resignation */
  resign?: number;
  /** The same inside a Hero League window (react, aim, boost): a corner case to try more often; default `resign` */
  windowResign?: number;
}

/** The next random command, or null when the game is over */
export function randomCommand(s: GameState, r: Rand, opts: RandomOpts = {}): Command | null {
  if (s.phase.k === 'over') return null;
  const waiting = awaiting(s);
  if (r() < (opts.timeout ?? 0.05)) {
    const t = timeoutCommand(s);
    if (t) return t;
  }
  const seat = (r() < 0.85 ? pick(r, waiting) : undefined) ?? pick(r, activeSeats(s));
  if (!seat) return null;
  const basis = r() < 0.5 ? s.seq : undefined;
  const withBasis = (a: Action): Command => (basis === undefined ? { by: seat, a } : { by: seat, a, basis });

  if (r() < (opts.trade ?? 0.03)) {
    const offer = randomOffer(s, r, seat);
    if (offer) return withBasis(offer);
  }
  if (waiting.includes(seat) && r() < 0.15) {
    const d = defaultAction(s, seat);
    if (d) return withBasis(d);
  }
  const resign = isWindow(s.phase) ? (opts.windowResign ?? opts.resign ?? 0.002) : (opts.resign ?? 0.002);
  const legal = legalActions(s, seat).filter((a) => a.k !== 'resign' || r() < resign);
  if (legal.length === 0) {
    const first = waiting[0];
    const d = first === undefined ? null : defaultAction(s, first);
    return first === undefined || !d ? null : { by: first, a: d };
  }
  const progress = legal.filter((a) => !MANAGE.has(a.k));
  let a = (r() < 0.6 && progress.length ? weighted(r, progress) : weighted(r, legal)) as Action;
  if (a.k === 'bid' && s.phase.k === 'auction') {
    const min = minBid(s.phase);
    const room = player(s, seat).cash - min;
    a = { k: 'bid', amount: min + Math.floor(r() * Math.min(150, room + 1)) };
  }
  return withBasis(a);
}

/** Hero League's bar (the plan's): at least 95% of games end `allSaved` within this many rounds */
export const ALL_SAVED_ROUNDS = 60;

/** Commands after which a game counts as stuck */
const MAX_COMMANDS = 50_000;

export interface PlayOpts extends RandomOpts {
  /** apply()'s invariant check after every command (default on) */
  check?: boolean;
  /** Sees every command that applied, with its events and the state after it */
  onApply?: (events: GameEvent[], state: GameState) => void;
}

export interface PlayedGame {
  /** Where it stopped: over, out of commands, or after 50,000 */
  state: GameState;
  /** Commands tried, refused ones included */
  commands: number;
  /** Rounds played: every player's turn once (turns / players, rounded up) */
  rounds: number;
  /** Random trade offers refused (an offer is built blind, so that is expected) */
  refused: number;
  /** Any other refused command, which is a bug: "game <seed> #<n>: <command> -> <code> <message>" */
  failures: string[];
}

/**
 * One random game from the start, as `npm run sim` plays it: `players` seats ("Bot 1", ...) on `cfg` dealt by `seed`,
 * random commands from a player seeded by `seed` (a resignation now and then: `resign` 0.0005 unless `opts` say
 * otherwise) until it is over, nothing is left to send, or 50,000 commands
 */
export function playRandomGame(
  cfg: Partial<RulesConfig>,
  players: number,
  seed: number,
  opts: PlayOpts = {},
): PlayedGame {
  const { check = true, onApply, ...random } = opts;
  const seats = SEAT_IDS.slice(0, players).map((id, i) => ({ id, name: `Bot ${i + 1}` }));
  let s = createGame(cfg, seats, seed).state;
  const r = randFrom(seed * 2654435761);
  const failures: string[] = [];
  let refused = 0;
  let n = 0;
  for (; n < MAX_COMMANDS && s.phase.k !== 'over'; n++) {
    const cmd = randomCommand(s, r, { resign: 0.0005, ...random });
    if (!cmd) break;
    const res = apply(s, cmd, { check });
    if (!res.ok) {
      if (cmd.a.k === 'propose') refused++;
      else failures.push(`game ${seed} #${n}: ${JSON.stringify(cmd)} -> ${res.error.code} ${res.error.message}`);
      continue;
    }
    s = res.state;
    onApply?.(res.events, s);
  }
  return { state: s, commands: n, rounds: Math.ceil(s.turn.no / players), refused, failures };
}
