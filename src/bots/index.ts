import { awaiting, type Action, type GameState, type SeatId } from '../rules';
import type { BotSkill } from '../net/types';
import { decideDetailed } from './decide';

/*
 * The bots: a pure heuristic player per skill. No network, no React, no clock; everything comes from the state.
 * - easy: sloppy and greedy (buys most of what it can afford, builds at random, never proposes trades).
 * - normal: sound rules of thumb, a cash reserve, set-for-set swaps.
 * - hard: values everything by landing probability (landingProb.ts), keeps a reserve sized by the rent around it,
 *   holds at 4 houses to keep the bank short, completes sets through trades with cash sweeteners.
 * - expert: hard plus Monte-Carlo search with the engine (search.ts, rollout.ts): it lays out a few plans for building,
 *   jail, raising cash and trades, plays each a few rounds ahead on the same dice and keeps the best; it prices offers
 *   against the bots' own acceptance rules; buy and auction limits are checked by rollouts too. Bounded by a budget of
 *   engine commands per decision, not a clock: a few ms on average and some 30 ms at most on a desktop. About 70% of
 *   2-player games against Hard (npm run sim:bots -- --players 2 --skills hard,expert --games 600 --jobs 8 --fast).
 *
 * Driver contract: after every committed seq, call decide() for each bot seat in seatsToAsk(state) (receivers of
 * open offers first, then every awaited seat) and dispatch a non-null result with basis = state.seq; a stale
 * dispatch is simply decided again on the new state. A bot only builds, lifts mortgages and proposes on its own
 * turn, proposes at most once per turn (at its start; see trade.ts for how repeats are avoided without memory), and
 * never waits on an offer: offers never block play.
 */

/**
 * The bot's next action for `seat`, or null when it has nothing to do right now. Pure: the same state, seat, skill
 * and rnd sequence give the same answer. Only returns actions the engine accepts now, and never null for a seat
 * the game is waiting for.
 */
export function decide(state: GameState, seat: SeatId, skill: BotSkill, rnd: () => number): Action | null {
  return decideDetailed(state, seat, skill, rnd).action;
}

/** "Thinking" delay before a bot acts, in ms at normal speed */
export function thinkMs(skill: BotSkill): number {
  return skill === 'easy' ? 900 : skill === 'normal' ? 700 : 500;
}

/**
 * Seats a driver should ask decide() for now, in order: receivers of open trade offers first (so a bot answers an
 * offer before the proposer moves on), then every seat the game is waiting for. Out seats are never listed.
 */
export function seatsToAsk(state: GameState): SeatId[] {
  if (state.phase.k === 'over') return [];
  const out: SeatId[] = [];
  for (const id of Object.keys(state.trades).sort()) {
    const to = state.trades[id]?.to;
    if (to && !state.players[to]?.out && !out.includes(to)) out.push(to);
  }
  for (const seat of awaiting(state)) if (!out.includes(seat)) out.push(seat);
  return out;
}
