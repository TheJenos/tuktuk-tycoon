import { expect } from 'vitest';
import { variedRules } from '../../rules/randomPlayer';
import { playGame } from '../arena';
import { SKILLS } from './helpers';

/*
 * Bot-only games through the engine (shared by fuzz.test.ts and fuzzSpeed.test.ts so they run in parallel). Every
 * decision must be the bot's own choice and accepted with invariants checked, and every game must end by the turn
 * limit. Some games start poor or with a scarce bank so debts, bankruptcies and shortage contests happen, and two in
 * three vary the optional rules (jackpot, auctions off, first lap, quick deal, end mode, trading...).
 */

export const GAMES = 25;
const TURN_LIMIT = 300;

export function fuzzGame(i: number, speedDie: boolean): void {
  const seed = (speedDie ? 5000 : 1000) + i;
  const r = playGame({
    seed,
    players: 4,
    // Every skill in every game, in a different seat order each time
    skills: SKILLS.map((_, k) => SKILLS[(k + i) % SKILLS.length] as (typeof SKILLS)[number]),
    speedDie,
    turnLimit: TURN_LIMIT,
    cfg: {
      ...(i % 3 === 0 ? {} : variedRules(seed)),
      startCash: [1500, 1500, 800][i % 3],
      houses: i % 4 === 3 ? 10 : 32,
      hotels: i % 4 === 3 ? 3 : 12,
    },
  });
  expect(r.failures).toEqual([]);
  expect(r.ended).not.toBe('stuck');
  expect(r.turns).toBeLessThanOrEqual(TURN_LIMIT);
  expect(r.ranking).toHaveLength(4);
}
