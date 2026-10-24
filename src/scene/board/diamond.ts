import { CORNER } from './layout';

/** Half the corner square's diagonal: how far its outer and inner corners are from its centre */
export const CORNER_HALF_DIAGONAL = CORNER / Math.SQRT2;

/**
 * Usable text width inside a corner square drawn on its diagonal (the context rotated by 45 degrees, so the square
 * is a diamond): a line `h` tall centred `t` across the diagonal from the corner's centre, less `pad` for a margin.
 * The diamond's width at offset t is 2 * (R - |t|); the line's far edge (|t| + h / 2) is where it is narrowest.
 */
export function diamondWidth(t: number, h: number, pad = 0.08): number {
  return Math.max(0, 2 * (CORNER_HALF_DIAGONAL - Math.abs(t) - h / 2) - pad);
}
