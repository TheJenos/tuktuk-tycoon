import { CARD_H, CARD_W } from '../board/centre';

/*
 * Pure: where the drawn card holds in front of the camera. It sits in the middle of the part of the screen the HUD
 * leaves free, below a band kept for the DOM caption under the top panels (CardModal), so the two never overlap.
 */

/** Room under the top panels for the DOM caption, CSS px (its height at the largest UI size, plus margins) */
export const CAPTION_PX = 130;

export interface Hold {
  /** Distance in front of the camera */
  dist: number;
  /** Centre on screen, NDC (-1..1) */
  x: number;
  y: number;
}

/** `insets`: CSS px covered by panels on each side of a `w` x `h` canvas; `fov`: vertical, degrees */
export function cardHold(w: number, h: number, insets: { left: number; right: number; top: number; bottom: number }, fov: number): Hold {
  const tanH = Math.tan(((fov / 2) * Math.PI) / 180);
  const aspect = w / Math.max(1, h);
  const x0 = -1 + (2 * insets.left) / w;
  const x1 = 1 - (2 * insets.right) / w;
  const y0 = -1 + (2 * insets.bottom) / h;
  const y1 = 1 - (2 * (insets.top + CAPTION_PX)) / h;
  // Share of the view's width and height the card takes: 90% of the free rectangle, at most the old centred size,
  // and never so small it can't be read (panels covering nearly everything: back to the middle of the screen)
  const fits = x1 - x0 > 0.4 && y1 - y0 > 0.4;
  const fw = fits ? Math.min(0.6, 0.45 * (x1 - x0)) : 0.6;
  const fh = fits ? Math.min(0.46, 0.45 * (y1 - y0)) : 0.46;
  const dist = Math.max(CARD_H / (fh * 2 * tanH), CARD_W / (fw * 2 * tanH * aspect));
  return { dist, x: fits ? (x0 + x1) / 2 : 0, y: fits ? (y0 + y1) / 2 : 0 };
}
