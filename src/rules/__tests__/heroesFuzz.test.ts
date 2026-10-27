import { describe, expect, it } from 'vitest';
import { type HeroesLog, SEEDS, fuzz } from './fuzzRun';

/** What random play must reach, so the properties checked after every command never pass for want of a case */
const REACHED = [
  'react:thunder:move',
  'react:thunder:hero',
  'react:shield:hit',
  'react:shield:smash',
  'aim',
  'boost',
  'ev:aimPeek',
  'ev:short',
  'ev:noSave',
  'over:allSaved',
  'afterResign:react',
];

describe('fuzz: random legal play keeps every invariant (Hero League)', () => {
  const log: HeroesLog = { whys: [], seen: {} };
  for (let seed = 1; seed <= SEEDS; seed++) it(`seed ${seed}`, () => void fuzz(seed, false, 'heroes', log));

  it('finishes games and reaches every kind of window', () => {
    // There is no bankruptcy on Hero League: lastStanding only comes from the fuzz's resignations (inside windows
    // too). How often games end allSaved within 60 rounds is heroesEnd.test.ts's.
    expect(log.whys.filter((why) => why === 'allSaved').length).toBeGreaterThan(SEEDS);
    expect(log.whys.every((why) => why === 'allSaved' || why === 'lastStanding')).toBe(true);
    for (const k of REACHED) expect(log.seen[k] ?? 0, k).toBeGreaterThan(0);
  });
});
