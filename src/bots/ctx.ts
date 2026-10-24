import { SEAT_IDS, type GameState, type PlayerState, type SeatId } from '../rules';
import { type Model, modelOf, reserve } from './model';
import type { Profile } from './profile';

/** Everything one decision reads: the state, who decides, how well, and the bot's model of the board */
export interface BotCtx {
  s: GameState;
  seat: SeatId;
  me: PlayerState;
  prof: Profile;
  rnd: () => number;
  m: Model;
  /** Cash to keep back right now */
  reserve: number;
  /** 2 players: every rival gain is the bot's loss; more players: it shares the loss */
  rivalShare: number;
  /** Engine commands of search left for this decision (rollout.ts) */
  budget: { left: number };
}

export function makeCtx(s: GameState, seat: SeatId, prof: Profile, rnd: () => number): BotCtx | null {
  const me = s.players[seat];
  if (!me || me.out) return null;
  const m = modelOf(s);
  return {
    s,
    seat,
    me,
    prof,
    rnd,
    m,
    reserve: reserve(m, seat, me.pos, prof),
    rivalShare: m.active.length <= 2 ? 1 : 0.5,
    budget: { left: prof.search },
  };
}

/**
 * A number in [0, 1) that stays the same for a given state of the dice, seat and salt. Used for private auction
 * limits: the state's RNG only moves when dice are thrown, so the limit holds for a whole auction however often
 * the bot is asked.
 */
export function stableNoise(s: GameState, seat: SeatId, salt: number): number {
  let h = (s.rng ^ Math.imul(SEAT_IDS.indexOf(seat) + 1, 0x9e3779b1) ^ Math.imul(salt + 7, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export const pickOne = <T>(rnd: () => number, items: readonly T[]): T | undefined =>
  items[Math.min(items.length - 1, Math.floor(rnd() * items.length))];
