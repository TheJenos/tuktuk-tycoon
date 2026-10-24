import { describe, expect, it } from 'vitest';
import { CORNER_HALF_DIAGONAL, diamondWidth } from '../board/diamond';
import { CORNER } from '../board/layout';

describe('diamondWidth', () => {
  it('is the full diagonal through the centre and narrows towards the corners', () => {
    expect(diamondWidth(0, 0, 0)).toBeCloseTo(CORNER * Math.SQRT2);
    expect(diamondWidth(0.46, 0.22, 0)).toBeCloseTo(2 * (CORNER_HALF_DIAGONAL - 0.57));
    expect(diamondWidth(-0.46, 0.22)).toBeCloseTo(diamondWidth(0.46, 0.22));
    expect(diamondWidth(0.5, 0.2)).toBeLessThan(diamondWidth(0.2, 0.2));
  });

  it('is never negative', () => {
    expect(diamondWidth(2, 0.5)).toBe(0);
  });
});
