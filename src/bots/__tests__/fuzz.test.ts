import { describe, it } from 'vitest';
import { GAMES, fuzzGame } from './fuzzRun';

describe('bot fuzz: four bots of every skill play legal games to the end (classic rules)', () => {
  for (let i = 0; i < GAMES; i++) it(`game ${i}`, () => fuzzGame(i, false));
});
