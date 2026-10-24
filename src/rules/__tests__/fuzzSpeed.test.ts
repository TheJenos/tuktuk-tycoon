import { describe, it } from 'vitest';
import { SEEDS, fuzz } from './fuzzRun';

describe('fuzz: random legal play keeps every invariant (Speed Die)', () => {
  for (let seed = 1; seed <= SEEDS; seed++) it(`seed ${seed}`, () => void fuzz(seed, true));
});
