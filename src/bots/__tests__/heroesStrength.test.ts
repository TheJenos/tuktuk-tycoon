import { describe, expect, it } from 'vitest';
import { HEROES } from '../../rules';
import { playGame } from '../arena';

/*
 * Hero League leaves the bots only their superpowers to play, so luck weighs more than on the classic boards; still,
 * Hard beats a player who picks any legal move at random in about 70% of 2-player games (npm run sim:bots --
 * --board=heroes --players 2 --skills hard,random --games 2000 --jobs 8 --fast). 200 seeded games, seats alternating;
 * Hard must win more than 60% (three standard deviations below its rate). Invariants are left to the fuzz tests.
 */

const GAMES = 200;
const IDS = HEROES.heroes!.list.map((h) => h.id);

describe('strength on Hero League', () => {
  it(`Hard beats random play in a ${GAMES}-game head-to-head`, { timeout: 120_000 }, () => {
    let hard = 0;
    for (let g = 0; g < GAMES; g++) {
      // Each pair of games plays one pair of heroes, Hard on either side
      const h = (g >> 1) % IDS.length;
      const r = playGame({
        seed: 40_000 + g,
        players: 2,
        skills: g % 2 === 0 ? ['hard', 'random'] : ['random', 'hard'],
        speedDie: false,
        turnLimit: 300,
        check: false,
        cfg: { board: 'heroes' },
        heroes: [IDS[h] as string, IDS[(h + 3) % IDS.length] as string],
      });
      expect(r.failures).toEqual([]);
      if (r.winner && r.skills[r.winner] === 'hard') hard++;
    }
    expect(hard).toBeGreaterThan(GAMES * 0.6);
  });
});
