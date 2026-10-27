import {
  canUsePower,
  cardOf,
  heroOf,
  heroesOf,
  shieldableByDrawer,
  smashPairs,
  type Action,
  type AimPhase,
  type BoostPhase,
  type CardFx,
  type Deck,
  type GameState,
  type PowerId,
  type ReactPhase,
  type SeatId,
} from '../rules';
import type { BotCtx } from './ctx';
import { landingTable } from './landingProb';
import { type Model, cashOf, landOf, ownedBy, propAt, rentAt, rentOwed, value, valueWith } from './model';

/*
 * Hero League's decisions (docs/heroes.md): when to use a superpower, and on what. Saving is compulsory, the jail fine
 * automatic, and nothing is built, mortgaged, traded or auctioned, so these are the only choices the board leaves.
 *
 * Every decision weighs what it changes in the bot's standing (its own gain less the average rival's, by the
 * score-aware valuation in model.ts) against what holding the superpower is worth until the next Rally Point salary
 * readies it again (keepCost). Outcomes are judged analytically: a move throw by its 36 faces, the Hero die by its 6,
 * a card by the deck's make-up (never its order), a landing by what the space does (a save or a back-up save, a
 * power-up, a card, Villain Ambush) plus the progress round the board towards the next salary.
 * - Thunder Call: re-roll a throw (anyone's move, a card's Hero die, a back-up's Hero die) when a fresh one is expected
 *   to be better by more than the superpower is worth (a mover who can still sting goes where Viper Strike suits it).
 * - Star Shield: say no to a Villain Strike effect or a Titan Smash that costs more than that.
 * - Viper Strike: the extra spaces (1-6) that best improve on the plain move, when the gain is worth it.
 * - Titan Smash: the pair of heroes whose swap improves the bot's standing most (skipping a hero who would shield).
 * - Dead Aim: aim when the best of two cards beats one card on average (the deck's make-up only); then the better card.
 * Easy is selfish and spends at once; Normal counts rivals at half and keeps a fixed reserve of value; Hard weighs the
 * landing table, every rival, and how soon the superpower would come back. Expert plays Hard's choices here.
 */

/** The board is Hero League */
export const heroesBoard = (c: BotCtx): boolean => !!c.m.info.b.heroes;

/** Seat -> Power gained (a rival's gain lowers the bot's standing) */
type Deltas = Partial<Record<SeatId, number>>;

/**
 * What one well-timed use of a superpower gains (Power), and how many rounds apart such chances come: holding it is
 * worth `worth` once a chance is all but sure to come before it would be readied again anyway.
 */
const HOLD: Record<Exclude<PowerId, 'copy'>, { worth: number; every: number }> = {
  smash: { worth: 135, every: 1.5 },
  shield: { worth: 165, every: 4 },
  thunder: { worth: 135, every: 1 },
  sting: { worth: 150, every: 1 },
  aim: { worth: 60, every: 4 },
};
/** Steel Ace's Suit Up is worth this share of the best superpower it could copy (one use for all of them) */
const COPY_W = 0.9;
/** Normal holds a superpower at this share of its worth, however soon it would come back */
const NORMAL_KEEP = 0.6;
/** Easy spends a superpower on any gain above this */
const EASY_KEEP = 25;
/** Easy forgets to use a superpower this often */
const EASY_MISS = 0.25;

/** Everything one decision's evaluation reads, with its memo (a decision is pure: nothing outlives it) */
interface Judge {
  c: BotCtx;
  s: GameState;
  m: Model;
  n: number;
  land: number[];
  /** Weight of each seat's gain in the bot's standing (its own 1, a rival's negative) */
  w: Partial<Record<SeatId, number>>;
  base: Partial<Record<SeatId, number>>;
  /** Spaces moved per turn on average */
  step: number;
  /** Rounds the game should still last */
  rounds: number;
  memo: Map<string, Deltas>;
}

function judge(c: BotCtx): Judge {
  const m = c.m;
  const rivals = m.active.filter((x) => x !== c.seat);
  const share = c.prof.skill === 'easy' ? 0 : c.prof.skill === 'normal' ? 0.5 : 1;
  const w: Partial<Record<SeatId, number>> = { [c.seat]: 1 };
  for (const r of rivals) w[r] = -share / Math.max(1, rivals.length);
  const base: Partial<Record<SeatId, number>> = {};
  for (const seat of m.active) base[seat] = value(m, seat, c.prof);
  return {
    c,
    s: c.s,
    m,
    n: m.info.n,
    land: landOf(m, c.prof),
    w,
    base,
    step: 7 * landingTable(m.info.b).rollsPerTurn,
    rounds: m.turnsLeft / Math.max(1, m.active.length),
    memo: new Map(),
  };
}

const add = (d: Deltas, seat: SeatId, x: number): void => {
  if (x !== 0) d[seat] = (d[seat] ?? 0) + x;
};

function merge(into: Deltas, d: Deltas, scale = 1): Deltas {
  for (const [seat, x] of Object.entries(d) as [SeatId, number][]) add(into, seat, x * scale);
  return into;
}

/** The change in the bot's standing */
function gain(j: Judge, d: Deltas): number {
  let g = 0;
  for (const [seat, x] of Object.entries(d) as [SeatId, number][]) g += (j.w[seat] ?? 0) * x;
  return g;
}

function memo(j: Judge, key: string, make: () => Deltas): Deltas {
  const hit = j.memo.get(key);
  if (hit) return hit;
  const d = make();
  j.memo.set(key, d);
  return d;
}

// ---------------------------------------------------------------------------------------------------------------
// Superpowers: what holding one is worth (who can use one now is the engine's canUsePower)

/** What holding the seat's superpower for `rounds` more rounds is worth (Steel Ace: the best it could copy) */
function holdWorth(j: Judge, seat: SeatId, rounds: number): number {
  const own = heroOf(j.s, seat)?.power;
  if (!own) return 0;
  const one = (p: Exclude<PowerId, 'copy'>): number => HOLD[p].worth * (1 - Math.exp(-rounds / HOLD[p].every));
  if (own !== 'copy') return one(own);
  let best = 0;
  for (const x of j.m.active) {
    const p = heroOf(j.s, x)?.power;
    if (x !== seat && p && p !== 'copy') best = Math.max(best, COPY_W * one(p));
  }
  return best;
}

/** Rounds until a seat at `pos` next collects a Rally Point salary */
const roundsToGo = (j: Judge, pos: number): number => Math.max(0.5, (pos === 0 ? j.n : j.n - pos) / j.step);

/**
 * What the bot gives up by spending its superpower now: holding it until it would come back anyway (the next salary
 * collected from `pos`, the space it is expected to move on from) or the game ends. Easy spends at once; Normal holds
 * it at a fixed share of its worth.
 */
function keepCost(j: Judge, seat: SeatId, pos: number): number {
  const skill = j.c.prof.skill;
  if (skill === 'easy') return EASY_KEEP;
  if (skill === 'normal') return NORMAL_KEEP * holdWorth(j, seat, Infinity);
  return holdWorth(j, seat, Math.min(roundsToGo(j, pos), j.rounds));
}

/** A used superpower made ready again (a salary, a Recharge card): it can be used for about a lap */
function readied(j: Judge, seat: SeatId): number {
  const p = j.s.players[seat];
  if (!p || p.powerUsed === undefined) return 0;
  // A salary in the turn the superpower was used does not ready it
  if (seat === j.s.turn.seat && p.powerUsed === j.s.turn.no) return 0;
  return holdWorth(j, seat, Math.min(j.n / j.step, j.rounds));
}

// ---------------------------------------------------------------------------------------------------------------
// Moves and landings

/**
 * Progress round the board, worth the salary it brings closer (fading out once less than a lap of play is left), so a
 * long walk beats a short one and a jump back costs what it delays
 */
function progress(j: Judge, pos: number): number {
  const fade = Math.min(1, (j.rounds * j.step) / j.n);
  return (fade * j.s.cfg.goSalary * pos) / j.n;
}

/** The salary for a walk from `from` to `to` (0 when it does not pass Rally Point) */
function salaryOn(j: Judge, from: number, to: number): number {
  const dist = (((to - from) % j.n) + j.n) % j.n || j.n;
  if (from + dist < j.n) return 0;
  return j.s.cfg.goSalary * (to === 0 && j.s.cfg.doubleGoLanding ? 2 : 1);
}

/** Walking forward from `from` to `to`: the salary for passing Rally Point (and a superpower readied), the progress */
function walk(j: Judge, seat: SeatId, from: number, to: number): Deltas {
  const d: Deltas = {};
  const salary = salaryOn(j, from, to);
  add(d, seat, salary + (salary > 0 ? readied(j, seat) : 0) + progress(j, to) - progress(j, from));
  return d;
}

/** A jump (back, to the Holding Cell, a swap): no salary, only the progress gained or lost */
function jump(j: Judge, seat: SeatId, from: number, to: number): Deltas {
  const d: Deltas = {};
  add(d, seat, progress(j, to) - progress(j, from));
  return d;
}

/**
 * `saver` saves location `x` (paying for it unless free): its points and power-ups, and what that does to the pairs.
 * Saving the last villain-held location ends the game: every seat is left with its score, power-ups to come and all.
 */
function saveDelta(j: Judge, saver: SeatId, x: number, paid: boolean): Deltas {
  return memo(j, `save:${saver}:${x}:${paid}`, () => {
    const d: Deltas = {};
    const last = j.m.info.props.every((y) => y === x || j.m.owner[y] !== undefined);
    const points = j.m.info.b.heroes?.locationPoints ?? 0;
    for (const seat of j.m.active) {
      const after = last
        ? cashOf(j.m, seat) + points * (ownedBy(j.m, seat).length + (seat === saver ? 1 : 0))
        : valueWith(j.m, seat, x, saver, j.c.prof);
      add(d, seat, after - (j.base[seat] ?? 0));
    }
    if (paid) add(d, saver, -(propAt(j.m, x)?.price ?? 0));
    return d;
  });
}

/** The seat loses its cheapest location (ties: the lowest index) back to its villain */
function loseDelta(j: Judge, seat: SeatId): Deltas {
  return memo(j, `lose:${seat}`, () => {
    let cheapest: number | undefined;
    for (const x of ownedBy(j.m, seat)) {
      if (cheapest === undefined || (propAt(j.m, x)?.price ?? 0) < (propAt(j.m, cheapest)?.price ?? 0)) cheapest = x;
    }
    const d: Deltas = {};
    if (cheapest === undefined) return d;
    for (const r of j.m.active) add(d, r, valueWith(j.m, r, cheapest, undefined, j.c.prof) - (j.base[r] ?? 0));
    return d;
  });
}

/**
 * Captured at `from`: the fine at the start of the next turn, the jump back to the Holding Cell, and no power-ups while
 * there (the rivals keep what they would have paid)
 */
function jailDelta(j: Judge, seat: SeatId, from: number): Deltas {
  return memo(j, `jail:${seat}:${from}`, () => {
    const d = jump(j, seat, from, j.m.info.b.jailIndex);
    add(d, seat, -Math.min(j.s.cfg.jailFine, cashOf(j.m, seat)));
    const rivals = j.m.active.filter((x) => x !== seat);
    let income = 0;
    for (const x of ownedBy(j.m, seat)) income += rentAt(j.m, x) * (j.land[x] ?? 0);
    const lost = income * rivals.length;
    add(d, seat, -lost);
    for (const r of rivals) add(d, r, lost / rivals.length);
    return d;
  });
}

/**
 * The seat comes to rest on `at` with `cash` in hand: a villain-held location is saved (or a back-up hero saves it),
 * another hero's charges its power-up (what the cash covers), Villain Ambush captures, a card space draws (the deck's
 * average; deeper than two cards in a row counts nothing)
 */
function restAt(j: Judge, seat: SeatId, at: number, cash: number, depth: number): Deltas {
  return memo(j, `rest:${seat}:${at}:${cash}:${depth}`, () => {
    const b = j.m.info.b;
    const sp = b.spaces[at];
    const p = propAt(j.m, at);
    if (p) {
      const owner = j.m.owner[at];
      if (owner === undefined) {
        if (cash >= p.price) return saveDelta(j, seat, at, true);
        const backups = j.m.active.filter((x) => x !== seat && cashOf(j.m, x) >= p.price);
        const d: Deltas = {};
        for (const x of backups) merge(d, saveDelta(j, x, at, true), 1 / backups.length);
        return d;
      }
      const d: Deltas = {};
      const paid = Math.min(rentOwed(j.m, seat, at), Math.max(0, cash));
      if (paid > 0) {
        add(d, seat, -paid);
        add(d, owner, paid);
      }
      return d;
    }
    if (at === b.goToJailIndex) return jailDelta(j, seat, at);
    if ((sp?.k === 'chance' || sp?.k === 'chest') && depth < 2) return deckDelta(j, seat, sp.k, at, cash, depth);
    return {};
  });
}

/**
 * The average draw from a deck at `at`. Only the deck's make-up is read, in the board's card order (never the deck's
 * own order, which would say what comes next).
 */
function deckDelta(j: Judge, seat: SeatId, deck: Deck, at: number, cash: number, depth: number): Deltas {
  return memo(j, `deck:${seat}:${deck}:${at}:${cash}:${depth}`, () => {
    const b = j.m.info.b;
    const inDeck = new Set(j.s.decks[deck]);
    const cards = (deck === 'chance' ? b.chance : b.chest).filter((card) => inDeck.has(card.id));
    const d: Deltas = {};
    for (const card of cards) {
      const fx = deck === 'chance' ? shielded(j, seat, card.fx, at, cash, depth + 1) : effect(j, seat, card.fx, at, cash, depth + 1);
      merge(d, fx, 1 / cards.length);
    }
    return d;
  });
}

/** A Villain Strike effect on a seat able to say no to it: it does when that costs more than Star Shield is worth */
function shielded(j: Judge, seat: SeatId, fx: CardFx, at: number, cash: number, depth: number): Deltas {
  const d = effect(j, seat, fx, at, cash, depth);
  if (!shieldableByDrawer(fx) || !canUsePower(j.s, seat, 'shield')) return d;
  const keep = keepCost(j, seat, at);
  return (d[seat] ?? 0) < -keep ? { [seat]: -keep } : d;
}

/** A Hero-die hit on `seat` where it stands (nothing on a hero in the Holding Cell for a move or a capture) */
function hitDelta(j: Judge, seat: SeatId, fx: CardFx, depth: number): Deltas {
  return memo(j, `hit:${seat}:${JSON.stringify(fx)}:${depth}`, () => {
    const p = j.s.players[seat];
    if (!p || p.out || (p.jail && (fx.k === 'back' || fx.k === 'jail'))) return {};
    return shielded(j, seat, fx, p.pos, cashOf(j.m, seat), depth);
  });
}

/** The next villain-held location after `from` */
function nextFree(j: Judge, from: number): number | undefined {
  for (let i = 1; i <= j.n; i++) {
    const x = (from + i) % j.n;
    if (propAt(j.m, x) && j.m.owner[x] === undefined) return x;
  }
  return undefined;
}

/** What a card's effect does, the seat standing on `at` with `cash` */
function effect(j: Judge, seat: SeatId, fx: CardFx, at: number, cash: number, depth: number): Deltas {
  const d: Deltas = {};
  const rivals = j.m.active.filter((x) => x !== seat);
  switch (fx.k) {
    case 'cash':
      add(d, seat, fx.amount >= 0 ? fx.amount : -Math.min(Math.max(0, cash), -fx.amount));
      return d;
    case 'each':
      if (fx.amount < 0) {
        const paid = Math.min(Math.max(0, cash), -fx.amount * rivals.length);
        add(d, seat, -paid);
        for (const r of rivals) add(d, r, paid / Math.max(1, rivals.length));
      } else {
        for (const r of rivals) {
          const paid = Math.min(Math.max(0, cashOf(j.m, r)), fx.amount);
          add(d, r, -paid);
          add(d, seat, paid);
        }
      }
      return d;
    case 'jail':
      return jailDelta(j, seat, at);
    case 'back': {
      const to = (((at - fx.n) % j.n) + j.n) % j.n;
      return merge(jump(j, seat, at, to), restAt(j, seat, to, cash, depth));
    }
    case 'advance': {
      const salary = salaryOn(j, at, fx.to);
      return merge(walk(j, seat, at, fx.to), restAt(j, seat, fx.to, cash + salary, depth));
    }
    case 'lose':
      return loseDelta(j, seat);
    case 'heroDie': {
      // Each hero played is hit (once) if any of the throws comes up with its face
      const p = 1 - Math.pow(5 / 6, fx.rolls);
      for (const x of j.m.active) merge(d, hitDelta(j, x, fx.hit, depth), p);
      return d;
    }
    case 'nearestFree': {
      const to = nextFree(j, at);
      if (to === undefined) return d;
      const salary = salaryOn(j, at, to);
      return merge(walk(j, seat, at, to), fx.free ? saveDelta(j, seat, to, false) : restAt(j, seat, to, cash + salary, depth));
    }
    case 'recharge':
      add(d, seat, readied(j, seat));
      return d;
    default:
      return d;
  }
}

/**
 * Two dice thrown from `from` (`doubles` already this turn): the third double captures, a double throws again.
 * `sting`: the thrower can still stretch the move with Viper Strike (its boost comes after the throw's Thunder window).
 */
function throwDelta(
  j: Judge,
  seat: SeatId,
  from: number,
  w: [number, number],
  doubles: number,
  depth: number,
  sting = false,
): Deltas {
  const dbl = w[0] === w[1];
  if (dbl && doubles + 1 >= 3 && j.s.cfg.threeDoublesJail) return jailDelta(j, seat, from);
  const total = w[0] + w[1];
  if (sting) return stingPick(j, seat, from, total, dbl, doubles + 1, depth).d;
  return moveDelta(j, seat, from, total, dbl, doubles + 1, depth);
}

/** The expected throw from `from` (`sting`: as throwDelta) */
function throwEv(j: Judge, seat: SeatId, from: number, doubles: number, depth: number, sting = false): Deltas {
  return memo(j, `throw:${seat}:${from}:${doubles}:${depth}:${sting}`, () => {
    const d: Deltas = {};
    for (let a = 1; a <= 6; a++) {
      for (let b = 1; b <= 6; b++) merge(d, throwDelta(j, seat, from, [a, b], doubles, depth, sting), 1 / 36);
    }
    return d;
  });
}

/**
 * A dice move of `steps` from `from` comes to rest; a double (`again`) throws once more from there, plain dice
 * (`doubles`: the turn's doubles, this one counted)
 */
function moveDelta(j: Judge, seat: SeatId, from: number, steps: number, again: boolean, doubles: number, depth: number): Deltas {
  const to = (from + steps) % j.n;
  const cash = cashOf(j.m, seat) + salaryOn(j, from, to);
  const d = merge(walk(j, seat, from, to), restAt(j, seat, to, cash, depth));
  if (again && depth < 1 && to !== j.m.info.b.goToJailIndex) merge(d, throwEv(j, seat, to, doubles, depth + 1));
  return d;
}

/** The change in `seat`'s standing as the bot would weigh it in its place: its own gain less its rivals' share */
function gainFor(j: Judge, seat: SeatId, d: Deltas): number {
  if (seat === j.c.seat) return gain(j, d);
  // Every rival of the bot is weighed alike, and so are this seat's rivals (the bot among them)
  const rival = j.w[seat] ?? 0;
  let g = 0;
  for (const [x, v] of Object.entries(d) as [SeatId, number][]) g += (x === seat ? 1 : rival) * v;
  return g;
}

/**
 * Viper Strike on a dice move of `total` from `from`: the extra spaces (1-6) that most improve on the plain move for
 * `seat`, taken when that is worth more than keeping the superpower (n 0: the plain move). `d`: what the move does,
 * the superpower spent included.
 */
function stingPick(
  j: Judge,
  seat: SeatId,
  from: number,
  total: number,
  again: boolean,
  doubles: number,
  depth: number,
): { n: number; d: Deltas } {
  const plain = moveDelta(j, seat, from, total, again, doubles, depth);
  let best = 0;
  let bestD = plain;
  let bestGain = -Infinity;
  for (let n = 1; n <= (j.m.info.b.heroes?.stingMax ?? 0); n++) {
    const d = moveDelta(j, seat, from, total + n, again, doubles, depth);
    const g = gainFor(j, seat, d);
    if (g > bestGain) [best, bestD, bestGain] = [n, d, g];
  }
  const keep = keepCost(j, seat, (from + total + best) % j.n);
  if (best === 0 || bestGain - gainFor(j, seat, plain) <= keep) return { n: 0, d: plain };
  return { n: best, d: merge({ [seat]: -keep }, bestD) };
}

/** A seat jumped from `from` to `to` (a Titan Smash): the progress, and where its next throw goes from */
function shift(j: Judge, seat: SeatId, from: number, to: number): Deltas {
  const doubles = seat === j.s.turn.seat ? j.s.turn.doubles : 0;
  const d = jump(j, seat, from, to);
  merge(d, throwEv(j, seat, to, doubles, 0));
  return merge(d, throwEv(j, seat, from, doubles, 0), -1);
}

/** Two heroes trade places */
function swapDelta(j: Judge, a: SeatId, b: SeatId): Deltas {
  const pa = j.s.players[a]?.pos ?? 0;
  const pb = j.s.players[b]?.pos ?? 0;
  return merge(shift(j, a, pa, pb), shift(j, b, pb, pa));
}

// ---------------------------------------------------------------------------------------------------------------
// The decisions

/** Easy now and then forgets its superpower */
const forgets = (c: BotCtx): boolean => c.prof.skill === 'easy' && c.rnd() < EASY_MISS;

/** preRoll on Hero League: Titan Smash (or Steel Ace's copy of it) when a swap is worth it, else roll */
export function preRollChoice(c: BotCtx): Action {
  const pairs = smashPairs(c.s, c.seat);
  if (pairs.length === 0 || forgets(c)) return { k: 'roll' };
  const j = judge(c);
  let best: { a: SeatId; b: SeatId } | undefined;
  let bestGain = -Infinity;
  for (const pair of pairs) {
    const pa = c.s.players[pair.a]?.pos;
    const pb = c.s.players[pair.b]?.pos;
    if (pa === pb) continue;
    const d = swapDelta(j, pair.a, pair.b);
    // A hero the swap hurts says no if it can (the superpower would be spent for nothing)
    const refused = [pair.a, pair.b].some(
      (x) => x !== c.seat && canUsePower(c.s, x, 'shield') && (d[x] ?? 0) < -keepCost(j, x, c.s.players[x]?.pos ?? 0),
    );
    if (refused) continue;
    const g = gain(j, d);
    if (g > bestGain) [best, bestGain] = [pair, g];
  }
  if (!best) return { k: 'roll' };
  // Where the bot will throw from: its next salary comes from there (not this turn's: the superpower is used in it)
  const me = c.me.pos;
  const from = best.a === c.seat ? (c.s.players[best.b]?.pos ?? me) : best.b === c.seat ? (c.s.players[best.a]?.pos ?? me) : me;
  if (bestGain <= keepCost(j, c.seat, (from + Math.round(j.step)) % j.n)) return { k: 'roll' };
  return { k: 'smash', a: best.a, b: best.b };
}

/**
 * The turn seat's move throw as it stands, and the bot's view of a fresh one. A thrower that can still sting takes
 * the extra spaces it likes best on either; re-rolling its own throw spends the superpower it would sting with (Steel
 * Ace's Suit Up), so the bot's own fresh throw is plain.
 */
function moveGain(j: Judge, thrower: SeatId): number {
  const r = j.s.turn.roll;
  const from = j.s.players[thrower]?.pos ?? 0;
  if (!r) return 0;
  const sting = canUsePower(j.s, thrower, 'sting');
  const now = gain(j, throwDelta(j, thrower, from, r.w, j.s.turn.doubles, 0, sting));
  return gain(j, throwEv(j, thrower, from, j.s.turn.doubles, 0, sting && thrower !== j.c.seat)) - now;
}

/** A card's Hero-die throw: the hero rolled is hit after the card's last throw (unless a later throw hits it anyway) */
function cardDieGain(j: Judge, ph: ReactPhase, face: number, card: string | undefined): number {
  const fx = card === undefined ? undefined : cardOf(j.s, card)?.fx;
  const then = ph.then;
  if (fx?.k !== 'heroDie' || then.k !== 'heroFace') return 0;
  const heroes = heroesOf(j.m.info.b);
  const worth = (f: number): number => {
    const target = j.m.active.find((x) => j.s.players[x]?.hero === heroes[f - 1]?.id);
    if (!target || then.hits.includes(target)) return 0;
    return gain(j, hitDelta(j, target, fx.hit, 1)) * Math.pow(5 / 6, then.left);
  };
  let fresh = 0;
  for (let f = 1; f <= 6; f++) fresh += worth(f) / 6;
  return fresh - worth(face);
}

/** A back-up throw: the hero rolled saves the location; a fresh throw picks evenly among the heroes who can pay */
function backupGain(j: Judge, lander: SeatId, face: number, space: number): number {
  const price = propAt(j.m, space)?.price ?? 0;
  const eligible = j.m.active.filter((x) => x !== lander && cashOf(j.m, x) >= price);
  if (eligible.length < 2) return 0;
  const save = (x: SeatId): number => gain(j, saveDelta(j, x, space, true));
  const fresh = eligible.reduce((a, x) => a + save(x), 0) / eligible.length;
  const hero = heroesOf(j.m.info.b)[face - 1]?.id;
  const target = eligible.find((x) => j.s.players[x]?.hero === hero);
  return fresh - (target ? save(target) : fresh);
}

/** A reaction window: re-roll the throw (Thunder Call), say no to the effect (Star Shield), or pass */
export function reactChoice(c: BotCtx, ph: ReactPhase): Action {
  const at = c.s.since;
  const pass: Action = { k: 'pass', at };
  if (forgets(c)) return pass;
  const j = judge(c);
  const about = ph.about;
  if (ph.kind === 'thunder') {
    if (!canUsePower(c.s, c.seat, 'thunder')) return pass;
    let g = 0;
    // The bot's own move: its next salary comes after this turn's move (one in this turn readies nothing)
    let from = c.me.pos;
    if (about.k === 'move') {
      g = moveGain(j, ph.seat);
      if (ph.seat === c.seat) from = (from + Math.round(j.step)) % j.n;
    } else if (about.k === 'hero') {
      g = about.purpose === 'card' ? cardDieGain(j, ph, about.face, about.card) : backupGain(j, ph.seat, about.face, about.space ?? -1);
    }
    return g > keepCost(j, c.seat, from) ? { k: 'reroll', at } : pass;
  }
  if (ph.seat !== c.seat || !canUsePower(c.s, c.seat, 'shield')) return pass;
  let d: Deltas = {};
  if (about.k === 'hit') d = effect(j, c.seat, about.fx, c.me.pos, c.me.cash, 1);
  else if (about.k === 'smash' && ph.then.k === 'swap') d = swapDelta(j, ph.then.a, ph.then.b);
  return gain(j, d) < -keepCost(j, c.seat, c.me.pos) ? { k: 'shield', at } : pass;
}

/** What drawing a card would do for the bot where it stands */
function cardGain(j: Judge, id: string): number {
  const fx = cardOf(j.s, id)?.fx;
  return fx ? gain(j, effect(j, j.c.seat, fx, j.c.me.pos, j.c.me.cash, 1)) : 0;
}

/**
 * Dead Aim. Before the reveal: aim when the better of two cards beats a plain draw by more than the superpower is
 * worth, judged on the deck's make-up alone (every pair of its cards alike). After it: the better of the cards shown.
 */
export function aimChoice(c: BotCtx, ph: AimPhase): Action {
  const at = c.s.since;
  const j = judge(c);
  if (ph.cards) {
    let best = ph.cards[0] as string;
    let bestGain = -Infinity;
    for (const id of ph.cards) {
      const g = cardGain(j, id);
      if (g > bestGain) [best, bestGain] = [id, g];
    }
    return { k: 'pickCard', card: best, at };
  }
  if (forgets(c)) return { k: 'pass', at };
  const b = j.m.info.b;
  const inDeck = new Set(c.s.decks[ph.deck]);
  const values = (ph.deck === 'chance' ? b.chance : b.chest).filter((card) => inDeck.has(card.id)).map((card) => cardGain(j, card.id));
  const k = Math.max(1, b.heroes?.aimCards ?? 2);
  if (values.length < k) return { k: 'pass', at };
  const one = values.reduce((a, x) => a + x, 0) / values.length;
  // The expected best of k cards drawn without replacement: the i-th worst is the best with C(i, k-1) / C(N, k)
  const sorted = [...values].sort((x, y) => x - y);
  let best = 0;
  let ways = 0;
  sorted.forEach((x, i) => {
    const w = choose(i, k - 1);
    best += w * x;
    ways += w;
  });
  best /= Math.max(1, ways);
  return best - one > keepCost(j, c.seat, c.me.pos) ? { k: 'aim', at } : { k: 'pass', at };
}

/** Binomial coefficient (small numbers) */
function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return r;
}

/** Viper Strike: the extra spaces whose landing beats the plain move by the most, when that is worth the superpower */
export function boostChoice(c: BotCtx, ph: BoostPhase): Action {
  const at = c.s.since;
  if (forgets(c)) return { k: 'pass', at };
  // The throw stands (a double already counted): one still to throw goes on from where the move ends
  const { n } = stingPick(judge(c), c.seat, c.me.pos, ph.total, c.s.turn.again, c.s.turn.doubles, 0);
  return n === 0 ? { k: 'pass', at } : { k: 'sting', n, at };
}
