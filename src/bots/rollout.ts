import {
  apply,
  awaiting,
  boardOf,
  defaultAction,
  DEFAULT_RULES,
  type Action,
  type Command,
  type GameState,
  type RulesConfig,
  type SeatId,
} from '../rules';
import { type BotCtx, makeCtx } from './ctx';
import { choose } from './decide';
import { cashOf, modelOf, propAt, value, valueWith } from './model';
import { PROFILES, type Profile } from './profile';

/*
 * Expert's search: Monte-Carlo playouts with the engine. A question offers a few options, each a start position
 * (the bot bought a property or its keenest rival did, a build plan carried out, the fine paid, a trade made, debt
 * raised one way or another). Every option is played on the same dice a few rounds ahead, every seat following
 * Hard's rules (no trades, no search), and scored by the bot's standing at the end: its value less the average
 * rival's. The real dice are never used: playouts draw their own from a hash of the question.
 *
 * Cost is a budget of engine commands (Profile.search per decision), never a clock, so decide() stays pure. A
 * question takes a fixed share of what is left of the decision's budget whether or not its answer is memoized, so a
 * cache hit never changes what a later question of the same decision is given.
 */

export interface Option {
  /** The option's start from a playout's start (the real position on fresh dice), or null when it cannot be had */
  start: (s: GameState) => GameState | null;
  /** Engine commands start() spends */
  cost: number;
}

export interface Question {
  /** Names the question and the position (stateKey); together they must determine the options */
  key: string;
  options: Option[];
  /** Rounds played ahead (every active seat one turn each); a big table plays a little over one round instead */
  rounds: number;
  /** Share of the decision's remaining budget to spend (default all of it) */
  share?: number;
}

/** Engine commands an average turn takes in a playout (a throw, a purchase or a short auction, the end) */
const PER_TURN = 3.5;
/** Playouts per option: fewer and a comparison is mostly noise; more add little next to the margins in search.ts */
const MIN_PLAYOUTS = 3;
const MAX_PLAYOUTS = 12;
const MEMO_SIZE = 128;
const memo = new Map<string, (number | null)[] | null>();

/** Every seat plays this in a playout: Hard's rules without trades or search, auctions settled in a few bids */
const PLAYOUT: Profile = {
  ...PROFILES.hard,
  propose: 'never',
  search: 0,
  stepShare: 0.25,
  stepMin: 10,
  stepMax: 100,
};

/** The leaf valuation */
const LEAF: Profile = PROFILES.hard;

function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/**
 * A memo key for the position. `stable` leaves out what an auction's bids change (the bids, who passed, the
 * sequence numbers), so an auction asks once however many bids are made: bids move no money until the hammer falls.
 */
export function stateKey(s: GameState, stable = false): string {
  const k = keyed(s);
  if (!stable) return JSON.stringify(k);
  const ph = s.phase;
  const phase = ph.k === 'auction' ? { k: ph.k, lot: ph.lot, queue: ph.queue, resume: ph.resume } : ph;
  return JSON.stringify({ ...k, seq: 0, since: 0, phase });
}

/** Optional rules that came after the rest: left out of the key while they hold their default */
const OPTIONAL: (keyof RulesConfig)[] = [
  'doubleGoLanding',
  'jackpot',
  'incomeTaxMode',
  'auctions',
  'auctionAll',
  'buyAfterFirstLap',
  'jailRent',
  'threeDoublesJail',
  'dealProperties',
  'endMode',
  'trading',
  'tradeAfterLap',
];

/** The rules version the key always reads: a RULES_VERSION bump alone does not reshuffle the playouts' dice */
const KEY_VERSION = 3;

/**
 * The state as the key sees it: without what no rule in play reads (laps unless the first-lap or trading-after-lap
 * rule is on, the jackpot pot with the jackpot off, optional rules at their default) and with a fixed version. Under
 * the default rules the key, and so the playouts' dice, are what they were before those options existed.
 */
function keyed(s: GameState): object {
  const cfg = s.cfg;
  const laps = cfg.buyAfterFirstLap || cfg.trading === 'afterLap';
  const { pot, ...rest } = s;
  const c: Partial<RulesConfig> = { ...cfg };
  for (const key of OPTIONAL) if (c[key] === DEFAULT_RULES[key]) delete c[key];
  const out: Record<string, unknown> = { ...rest, v: KEY_VERSION, cfg: c };
  if (cfg.jackpot) out.pot = pot;
  if (!laps) {
    const players: Record<string, unknown> = {};
    for (const [seat, p] of Object.entries(s.players)) {
      if (!p) continue;
      const q: Record<string, unknown> = { ...p };
      delete q.laps;
      players[seat] = q;
    }
    out.players = players;
  }
  return out;
}

type Step = Command | ((s: GameState) => Command | null);

/** An option that plays these commands in order (a function step may read the position reached so far) */
export function play(steps: Step[]): Option {
  return {
    cost: steps.length,
    start: (s0) => {
      let s = s0;
      for (const step of steps) {
        const cmd = typeof step === 'function' ? step(s) : step;
        if (!cmd) return null;
        const r = apply(s, cmd, { check: false });
        if (!r.ok) return null;
        s = r.state;
      }
      return s;
    },
  };
}

/** Turns a playout runs: `rounds` rounds at a small table, a little over one round at a big one */
const horizon = (rounds: number, active: number): number => Math.min(rounds * active, Math.max(2 * rounds, active + 1));

/** Plays every seat with the playout policy for `turns` turns, or until `cap` commands are spent */
function playout(start: GameState, turns: number, cap: number): GameState {
  let s = start;
  const until = s.turn.no + turns;
  const rnd = (): number => 0.5;
  for (let n = 0; n < cap && s.phase.k !== 'over' && s.turn.no < until; n++) {
    const seat = awaiting(s)[0];
    if (!seat) break;
    const c = makeCtx(s, seat, PLAYOUT, rnd);
    const a: Action | null = (c && choose(c)) ?? defaultAction(s, seat);
    if (!a) break;
    let r = apply(s, { by: seat, a }, { check: false });
    if (!r.ok) {
      const d = defaultAction(s, seat);
      if (!d) break;
      r = apply(s, { by: seat, a: d }, { check: false });
      if (!r.ok) break;
    }
    s = r.state;
  }
  return s;
}

/** The bot's standing: its value minus the average rival's */
export function standing(s: GameState, seat: SeatId): number {
  const m = modelOf(s);
  const mine = s.players[seat]?.out ? 0 : value(m, seat, LEAF);
  const rivals = m.active.filter((x) => x !== seat);
  if (rivals.length === 0) return mine;
  return mine - rivals.reduce((a, x) => a + value(m, x, LEAF), 0) / rivals.length;
}

/** Commands an option's start takes, as room() assumes */
const START_COST = 2;

/**
 * How many options a question of `rounds` and `share` could compare with the budget left (fewer than 2: none, the
 * caller should not even lay them out)
 */
export function room(c: BotCtx, rounds: number, share = 1): number {
  const each = START_COST + PER_TURN * horizon(rounds, Math.max(1, c.m.active.length));
  return Math.floor((c.budget.left * share) / (MIN_PLAYOUTS * each));
}

/**
 * The mean standing per option (null: that option could not start), or null when the decision's budget left is too
 * small for a fair comparison.
 */
export function ask(c: BotCtx, q: Question): (number | null)[] | null {
  // Hero League is never searched: a playout would draw the cards in the decks' real order (heroes.ts judges it instead)
  if (boardOf(c.s).heroes) return null;
  const allot = Math.floor(c.budget.left * (q.share ?? 1));
  c.budget.left -= allot;
  const turns = horizon(q.rounds, Math.max(1, c.m.active.length));
  const each = q.options.reduce((a, o) => a + o.cost, 0) / Math.max(1, q.options.length) + PER_TURN * turns;
  // A small budget compares only the first options (callers list the most promising first)
  const n = Math.min(q.options.length, Math.floor(allot / (MIN_PLAYOUTS * each)));
  if (n < 2) return null;
  const k = Math.min(MAX_PLAYOUTS, Math.floor(allot / (n * each)));
  const key = `${q.key}|${c.seat}|${allot}`;
  const hit = memo.get(key);
  if (hit !== undefined) return hit;
  const result = compute(c, q.options.slice(0, n), q.options.length, k, turns, Math.floor(allot / (n * k)), hash(key));
  memo.set(key, result);
  if (memo.size > MEMO_SIZE) memo.delete(memo.keys().next().value as string);
  return result;
}

function compute(c: BotCtx, options: Option[], of: number, k: number, turns: number, cap: number, seed: number) {
  const sums: (number | null)[] = Array.from({ length: of }, (_, j) => (j < options.length ? 0 : null));
  for (let i = 0; i < k; i++) {
    const rng = (seed + Math.imul(i + 1, 0x9e3779b1)) >>> 0 || 1;
    const base: GameState = { ...c.s, rng, rig: [] };
    options.forEach((o, j) => {
      const sum = sums[j];
      if (sum === null || sum === undefined) return;
      const start = o.start(base);
      sums[j] = start ? sum + standing(playout(start, turns, Math.max(1, cap - o.cost)), c.seat) : null;
    });
  }
  const means = sums.map((x) => (x === null || x === undefined ? null : x / k));
  return means.some((x) => x !== null) ? means : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Bank property: what owning it is worth against the keenest rival owning it

/** A start where `owner` (or nobody) has just bought `space` for its price and play goes on */
function branch(space: number, owner: SeatId | undefined): Option {
  return {
    cost: 1,
    start: (s) => {
      const price = propAt(modelOf(s), space)?.price ?? 0;
      const g = structuredClone(s);
      const resume = g.phase.k === 'auction' ? g.phase.resume : { k: 'busy' as const };
      if (owner) {
        const p = g.players[owner];
        if (!p || p.cash < price) return null;
        p.cash -= price;
        g.props[`p${space}`] = { owner, level: 0 };
      }
      // A no-op debug command on the private copy makes the engine run the rest of the turn from `resume`
      g.phase = resume;
      g.cfg = { ...g.cfg, debug: true };
      const seat = g.order.find((x) => !g.players[x]?.out);
      if (!seat) return null;
      const cash = g.players[seat]?.cash ?? 0;
      const r = apply(g, { by: seat, a: { k: 'debugSetCash', seat, cash } }, { check: false });
      return r.ok ? r.state : null;
    },
  };
}

/** Share of the budget for a property's worth: the estimate is blended with the heuristic anyway (rolloutWeight) */
const WORTH_SHARE = 0.4;

/** Expert's rollout estimate of what bank property `space` is worth to the bot (null when it cannot be evaluated) */
export function rolloutWorth(c: BotCtx, space: number): number | null {
  const m = c.m;
  const price = propAt(m, space)?.price ?? 0;
  if (cashOf(m, c.seat) < price || room(c, 2, WORTH_SHARE) < 2) return null;
  // The rival who would gain most from it (and can pay for it)
  let rival: SeatId | undefined;
  let best = -Infinity;
  for (const o of m.active) {
    if (o === c.seat || cashOf(m, o) < price) continue;
    const gain = valueWith(m, o, space, o, LEAF) - value(m, o, LEAF);
    if (gain > best) [rival, best] = [o, gain];
  }
  const r = ask(c, {
    key: `worth:${space}:${rival ?? '-'}|${stateKey(c.s, true)}`,
    options: [branch(space, c.seat), branch(space, rival)],
    rounds: 2,
    share: WORTH_SHARE,
  });
  const mine = r?.[0];
  const theirs = r?.[1];
  if (mine === null || mine === undefined || theirs === null || theirs === undefined) return null;
  return price + mine - theirs;
}
