import { describe, expect, it } from 'vitest';
import { boardArea, frameArea } from '../camera/framing';
import { distanceScale, TOP_DOWN, VIEW_FOV } from '../camera/view';
import { HOP_HEIGHT, JUMP_HEIGHT, liftScale } from '../tokens/hop';

describe('the 2D board view', () => {
  it('uses a long lens; distances scale so the same area fills the view', () => {
    expect(VIEW_FOV['2d']).toBeLessThan(VIEW_FOV['3d']);
    expect(distanceScale('3d')).toBe(1);
    const insets = { left: 0, right: 0, top: 0, bottom: 0 };
    const lens = (fov: number) => ({ fov, aspect: 16 / 9, minDistance: 0, maxDistance: Infinity });
    const near = frameArea(boardArea(), 0, TOP_DOWN, lens(VIEW_FOV['3d']), insets).distance;
    const far = frameArea(boardArea(), 0, TOP_DOWN, lens(VIEW_FOV['2d']), insets).distance;
    // Straight down the board is flat but for the tokens' height, so the fit grows with the lens almost exactly
    expect(far / near).toBeCloseTo(distanceScale('2d'), 0);
  });

  it('frames straight down onto the middle of the area, with no sideways shift for a centred board', () => {
    const f = frameArea(boardArea(), 0, TOP_DOWN, { fov: VIEW_FOV['2d'], aspect: 1, minDistance: 0, maxDistance: Infinity }, { left: 0, right: 0, top: 0, bottom: 0 });
    expect(f.target[0]).toBeCloseTo(0);
    expect(f.target[2]).toBeCloseTo(0);
    expect(f.offset[0]).toBeCloseTo(0);
    expect(f.offset[1]).toBeCloseTo(0);
  });

  it('shows a hop as the token growing: 1 on the ground, larger in the air, capped for a jump', () => {
    expect(liftScale(0)).toBe(1);
    expect(liftScale(-0.1)).toBe(1);
    expect(liftScale(HOP_HEIGHT)).toBeGreaterThan(1.2);
    expect(liftScale(JUMP_HEIGHT)).toBe(1.6);
  });
});
