import { describe, expect, it } from 'vitest';
import { ALL_SAVED_ROUNDS, type PlayedGame, playRandomGame } from '../randomPlayer';

/*
 * Hero League must end by saving every location, not drag on: random legal play (no resignations; timeouts now and
 * then) at 2-6 seats with 1,500 and 600 Power to start. At least 95% of games end `allSaved` within 60 rounds (the
 * plan's bar, over the mixed table). The slowest single table, two players on 600 Power, is measured on its own.
 */

const GAMES_PER_SIZE = 24;

const whyOf = (g: PlayedGame): string => (g.state.phase.k === 'over' ? g.state.phase.why : 'stuck');
const savedInTime = (g: PlayedGame): boolean => whyOf(g) === 'allSaved' && g.rounds <= ALL_SAVED_ROUNDS;

describe('Hero League ends by saving every location', () => {
  it(`at least 95% of games end allSaved within ${ALL_SAVED_ROUNDS} rounds`, () => {
    const results: PlayedGame[] = [];
    for (let n = 2; n <= 6; n++) {
      for (let g = 0; g < GAMES_PER_SIZE; g++) {
        const cfg = { board: 'heroes', startCash: g % 2 ? 600 : 1500 };
        results.push(playRandomGame(cfg, n, n * 1000 + g, { resign: 0, check: false }));
      }
    }
    expect(results.filter(savedInTime).length / results.length).toBeGreaterThanOrEqual(0.95);
    expect(results.map(whyOf).every((why) => why === 'allSaved')).toBe(true);
  });

  it('two players on 600 Power (the slowest table): at least 93% of the sim games end allSaved within 60 rounds', () => {
    // Exactly `npm run sim -- 1000 --board=heroes --players=2 --cash=600` (its default flags; random resignations
    // included, the games they end not counted; check off: the outcome is the same while the invariants hold). This
    // table alone sits just under the mixed bar: 908 of 956 here (94.97%), about 94.5% over 10,000 more games
    // (docs/heroes.md). The floor catches a real slowdown, not the noise.
    const cfg = { board: 'heroes', speedDie: false, turnLimit: 400, startCash: 600 };
    let counted = 0;
    let good = 0;
    for (let seed = 1; seed <= 1000; seed++) {
      const g = playRandomGame(cfg, 2, seed, { check: false });
      if (whyOf(g) === 'lastStanding') continue;
      counted++;
      if (savedInTime(g)) good++;
    }
    expect(counted).toBeGreaterThan(900);
    expect(good / counted, `${good}/${counted}`).toBeGreaterThanOrEqual(0.93);
  }, 120_000);
});
