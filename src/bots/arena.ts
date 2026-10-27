import {
  apply,
  awaiting,
  createGame,
  legalActions,
  SEAT_IDS,
  timeoutCommand,
  type Action,
  type GameState,
  type OverPhase,
  type RulesConfig,
  type SeatId,
} from '../rules';
import type { BotSkill } from '../net/types';
import { type Decision, decideDetailed } from './decide';
import { seatsToAsk } from './index';

/*
 * Bot-only games straight through the engine (no session, no clock), for `npm run sim:bots` and the bot tests.
 * The loop plays like a driver: it asks the receivers of open offers first, then the awaited seats, and commits
 * the first action anyone takes. Every decision must be the policy's own and accepted by the engine, the engine's
 * invariants are checked after every command, and the game must end within its turn limit. A seat may also play
 * 'random' (any legal move, never resigning): the baseline the bots should clearly beat.
 */

/** Who plays a seat: a bot skill, or 'random' */
export type ArenaSkill = BotSkill | 'random';

export interface ArenaGame {
  seed: number;
  players: number;
  /** Skill per seat, in seat order (s0, s1, ...) */
  skills: ArenaSkill[];
  speedDie: boolean;
  turnLimit: number;
  /** Check invariants after every command (default on) */
  check?: boolean;
  /** Other room rules (starting cash, a scarce bank, ...) */
  cfg?: Partial<RulesConfig>;
  /** Hero League: the hero each seat asks for, in seat order (else the engine's assignment) */
  heroes?: string[];
}

/** Time spent deciding, per skill (wall clock, for the sim's report; decide() itself never reads a clock) */
export interface DecisionTimes {
  n: number;
  ms: number;
  max: number;
  /** Decisions that took longer than SLOW_MS */
  slow: number;
}

export const SLOW_MS = 60;

export interface GameReport {
  seed: number;
  ended: OverPhase['why'] | 'stuck';
  turns: number;
  commands: number;
  winner?: SeatId;
  ranking: SeatId[];
  skills: Partial<Record<SeatId, ArenaSkill>>;
  trades: number;
  proposals: number;
  auctions: number;
  bankruptcies: number;
  /** Hero League: the hero each seat played, the final scores, superpowers used and back-up saves */
  heroes?: Partial<Record<SeatId, string>>;
  scores?: Partial<Record<SeatId, number>>;
  powers: number;
  backups: number;
  /** Decisions the policies got wrong (fallbacks, refusals, stalls, broken invariants) */
  failures: string[];
  times: Partial<Record<ArenaSkill, DecisionTimes>>;
}

/** mulberry32 for the bots' own randomness (separate from the game's dice) */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Commands per game before it counts as stuck (a 400-turn game takes a few thousand) */
const MAX_COMMANDS = 60_000;

/** The random seat's move: a kind of legal action at random (15 Titan Smash pairs weigh as one), then one of it */
function randomAction(s: GameState, seat: SeatId, rnd: () => number): Action | null {
  const legal = legalActions(s, seat).filter((a) => a.k !== 'resign');
  const kinds = [...new Set(legal.map((a) => a.k))];
  const kind = kinds[Math.floor(rnd() * kinds.length)];
  const of = legal.filter((a) => a.k === kind);
  return of[Math.floor(rnd() * of.length)] ?? null;
}

export function playGame(g: ArenaGame): GameReport {
  const seats = SEAT_IDS.slice(0, g.players);
  const skills: Partial<Record<SeatId, ArenaSkill>> = {};
  seats.forEach((seat, i) => (skills[seat] = g.skills[i % g.skills.length] as ArenaSkill));
  // Bots price their offers by the other bots' skills only
  const table: Partial<Record<SeatId, BotSkill>> = {};
  for (const seat of seats) {
    const skill = skills[seat];
    if (skill && skill !== 'random') table[seat] = skill;
  }
  let s: GameState = createGame(
    { ...g.cfg, speedDie: g.speedDie, turnLimit: g.turnLimit },
    seats.map((id, i) => ({ id, name: `Bot ${i + 1}`, ...(g.heroes?.[i] ? { hero: g.heroes[i] } : {}) })),
    g.seed,
  ).state;
  const rnd = rng(g.seed * 2654435761);
  const report: GameReport = {
    seed: g.seed,
    ended: 'stuck',
    turns: 0,
    commands: 0,
    ranking: [],
    skills,
    trades: 0,
    proposals: 0,
    auctions: 0,
    bankruptcies: 0,
    powers: 0,
    backups: 0,
    failures: [],
    times: {},
  };
  const fail = (msg: string): void => {
    if (report.failures.length < 10) report.failures.push(`seed ${g.seed} seq ${s.seq} ${s.phase.k}: ${msg}`);
  };

  let n = 0;
  for (; n < MAX_COMMANDS && s.phase.k !== 'over'; n++) {
    const waiting = awaiting(s);
    let next: GameState | null = null;
    for (const seat of seatsToAsk(s)) {
      const skill = skills[seat] ?? 'normal';
      const t0 = performance.now();
      const d: Decision =
        skill === 'random' ? { action: randomAction(s, seat, rnd), fellBack: false } : decideDetailed(s, seat, skill, rnd, table);
      const ms = performance.now() - t0;
      const tm = (report.times[skill] ??= { n: 0, ms: 0, max: 0, slow: 0 });
      tm.n++;
      tm.ms += ms;
      tm.max = Math.max(tm.max, ms);
      if (ms > SLOW_MS) tm.slow++;
      if (d.fellBack) fail(`${seat} (${skills[seat]}) ${d.problem ?? 'fell back'}`);
      if (!d.action) {
        if (waiting.includes(seat)) fail(`${seat} is awaited but returned null`);
        continue;
      }
      const r = apply(s, { by: seat, a: d.action, basis: s.seq }, { check: g.check ?? true });
      if (!r.ok) {
        fail(`${seat} ${JSON.stringify(d.action)} -> ${r.error.code} ${r.error.message}`);
        continue;
      }
      if (d.action.k === 'propose') report.proposals++;
      for (const e of r.events) {
        if (e.t === 'tradeDone') report.trades++;
        else if (e.t === 'auctionStart') report.auctions++;
        else if (e.t === 'bankrupt') report.bankruptcies++;
        else if (e.t === 'power') report.powers++;
        else if (e.t === 'owner' && e.via === 'backup') report.backups++;
      }
      next = r.state;
      break;
    }
    if (!next) {
      // Nobody acted: a timeout keeps the game going (and the stall is reported)
      fail('no seat acted');
      const t = timeoutCommand(s);
      const r = t ? apply(s, t, { check: g.check ?? true }) : null;
      if (!r || !r.ok) break;
      next = r.state;
    }
    s = next;
    if (report.failures.length >= 10) break;
  }
  report.commands = n;
  report.turns = s.turn.no;
  if (s.phase.k === 'over') {
    report.ended = s.phase.why;
    report.winner = s.phase.winner;
    report.ranking = s.phase.ranking;
    if (s.phase.scores) report.scores = s.phase.scores;
  } else fail(`not over after ${n} commands (turn ${s.turn.no})`);
  const heroes: Partial<Record<SeatId, string>> = {};
  for (const seat of seats) {
    const hero = s.players[seat]?.hero;
    if (hero) heroes[seat] = hero;
  }
  if (Object.keys(heroes).length) report.heroes = heroes;
  return report;
}
