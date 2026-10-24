import { describe, expect, it } from 'vitest';
import { makeCtx } from '../ctx';
import { throwDice } from '../dice';
import { d6, int, nextU32, seedState, shuffle } from '../rng';
import { scenario } from './helpers';

describe('rng', () => {
  it('repeats the same stream for the same seed', () => {
    const a = { rng: seedState(42) };
    const b = { rng: seedState(42) };
    const xs = Array.from({ length: 20 }, () => nextU32(a));
    expect(Array.from({ length: 20 }, () => nextU32(b))).toEqual(xs);
    expect(seedState(1)).not.toBe(seedState(2));
    expect(seedState(0)).not.toBe(0);
  });

  it('continues the same stream from a saved state', () => {
    const full = { rng: seedState(7) };
    const seq = Array.from({ length: 10 }, () => nextU32(full));
    const half = { rng: seedState(7) };
    const first = Array.from({ length: 5 }, () => nextU32(half));
    const saved = { rng: JSON.parse(JSON.stringify(half.rng)) as number };
    expect([...first, ...Array.from({ length: 5 }, () => nextU32(saved))]).toEqual(seq);
  });

  it('rolls fair dice (60k rolls within 2%)', () => {
    const h = { rng: seedState(123) };
    const counts = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 60_000; i++) counts[d6(h) - 1]!++;
    for (const n of counts) expect(Math.abs(n - 10_000)).toBeLessThan(200);
  });

  it('keeps int() in bounds', () => {
    const h = { rng: seedState(9) };
    for (let i = 0; i < 1000; i++) {
      const x = int(h, 7);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(7);
    }
  });

  it('shuffles into a permutation', () => {
    const h = { rng: seedState(5) };
    const out = shuffle(h, [1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...out].sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('maps the Speed Die to 1, 2, 3, Bus, Tuk-Tuk Uncle, Tuk-Tuk Uncle', () => {
    const c = makeCtx(scenario({ cfg: { speedDie: true } }));
    const counts: Record<string, number> = {};
    for (let i = 0; i < 60_000; i++) {
      const f = String(throwDice(c, true).s);
      counts[f] = (counts[f] ?? 0) + 1;
    }
    expect(Object.keys(counts).sort()).toEqual(['1', '2', '3', 'bus', 'uncle']);
    for (const f of ['1', '2', '3', 'bus']) expect(Math.abs((counts[f] ?? 0) - 10_000)).toBeLessThan(250);
    expect(Math.abs((counts.uncle ?? 0) - 20_000)).toBeLessThan(400);
  });
});
