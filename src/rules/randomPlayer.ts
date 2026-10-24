import { minBid } from './auction';
import { awaiting, defaultAction, timeoutCommand } from './autoplay';
import { getBoard, siblings } from './board';
import { activeSeats, levelOf, ownedBy, player } from './ctx';
import { legalActions } from './legal';
import type { Action, Bundle, Command, GameState, SeatId } from './types';

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

const MANAGE = new Set(['build', 'sell', 'mortgage', 'unmortgage']);

/** Leans towards buying and building so games reach complete colour groups, shortages and bankruptcies */
const WEIGHT: Partial<Record<Action['k'], number>> = { buy: 4, build: 6, mortgage: 0.5, unmortgage: 0.3 };

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
  const legal = legalActions(s, seat).filter((a) => a.k !== 'resign' || r() < (opts.resign ?? 0.002));
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
