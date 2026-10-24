import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../../rules';
import { uncleTarget } from '../board/uncleTarget';

const log = (...evs: GameEvent[]) => evs.map((ev, i) => ({ seq: i, ev }));
const uncle: GameEvent = { t: 'uncle', seat: 's0', to: 11, target: 'bank' };
const walk: GameEvent = { t: 'move', seat: 's0', from: 37, to: 11, path: [38, 39, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], via: 'uncle' };

describe("Tuk-Tuk Uncle's target", () => {
  it('is marked from the uncle event until the token lands', () => {
    expect(uncleTarget(log({ t: 'land', seat: 's0', space: 37 }, uncle))).toBe(11);
    expect(uncleTarget(log(uncle, walk))).toBe(11);
    // Passing GO on the way
    expect(uncleTarget(log(uncle, walk, { t: 'salary', seat: 's0', amount: 200 }))).toBe(11);
    expect(uncleTarget(log(uncle, walk, { t: 'land', seat: 's0', space: 11 }))).toBeNull();
  });

  it('marks nothing when Tuk-Tuk Uncle stays put or for other moves', () => {
    expect(uncleTarget(log({ t: 'uncle', seat: 's0' }))).toBeNull();
    expect(uncleTarget(log(uncle, { ...walk, via: 'dice' }))).toBeNull();
    expect(uncleTarget([])).toBeNull();
  });
});
