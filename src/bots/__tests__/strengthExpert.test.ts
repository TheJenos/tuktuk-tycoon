import { describe, expect, it } from 'vitest';
import { playGame } from '../arena';

/*
 * Search pays: Expert beats Hard head to head. 100 seeded games, seats alternating; Expert must win at least 60. A
 * coin flip gets there with p ~ 0.03, while Expert's measured rate (about 70% over 600-1000 games, see
 * `npm run sim:bots -- --players 2 --skills hard,expert --games 600 --jobs 8 --fast --expect expert=0.57`) leaves a
 * margin of two standard deviations. The longer run is the script's; this one keeps to a minute.
 */

const GAMES = 100;
const NEED = 60;

describe('strength', () => {
  it(`Expert beats Hard in a ${GAMES}-game head-to-head`, { timeout: 600_000 }, () => {
    let expert = 0;
    for (let g = 0; g < GAMES; g++) {
      const r = playGame({
        seed: 30_000 + g,
        players: 2,
        skills: g % 2 === 0 ? ['expert', 'hard'] : ['hard', 'expert'],
        speedDie: false,
        turnLimit: 200,
        check: false,
      });
      expect(r.failures).toEqual([]);
      if (r.winner && r.skills[r.winner] === 'expert') expert++;
    }
    expect(expert).toBeGreaterThanOrEqual(NEED);
  });
});
