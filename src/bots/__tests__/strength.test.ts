import { describe, expect, it } from 'vitest';
import { playGame } from '../arena';

/*
 * Skill matters: Hard beats Easy head to head more often than not (in practice about 70-75% of games). Invariants
 * are left to the fuzz tests so this stays quick.
 */

const GAMES = 200;

describe('strength', () => {
  it(`Hard beats Easy in a ${GAMES}-game head-to-head`, { timeout: 180_000 }, () => {
    let hard = 0;
    for (let g = 0; g < GAMES; g++) {
      const r = playGame({
        seed: 20_000 + g,
        players: 2,
        skills: g % 2 === 0 ? ['hard', 'easy'] : ['easy', 'hard'],
        speedDie: g % 4 >= 2,
        turnLimit: 300,
        check: false,
      });
      expect(r.failures).toEqual([]);
      if (r.winner && r.skills[r.winner] === 'hard') hard++;
    }
    expect(hard).toBeGreaterThan(GAMES / 2);
  });
});
