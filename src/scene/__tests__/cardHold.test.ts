import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { CARD_H, CARD_W } from '../board/centre';
import { CAPTION_PX, cardHold } from '../cards/hold';

/** The held card's corners on screen (NDC), placed as Cards does: in front of a camera looking down -Z */
function corners(w: number, h: number, insets: { left: number; right: number; top: number; bottom: number }) {
  const cam = new PerspectiveCamera(40, w / h, 0.1, 100);
  cam.updateMatrixWorld();
  const hold = cardHold(w, h, insets, 40);
  const tanH = Math.tan((20 * Math.PI) / 180);
  const c = new Vector3(hold.x * hold.dist * tanH * (w / h), hold.y * hold.dist * tanH, -hold.dist);
  return [-1, 1].flatMap((sx) => [-1, 1].map((sy) => new Vector3(c.x + (sx * CARD_W) / 2, c.y + (sy * CARD_H) / 2, c.z).project(cam)));
}

describe('the held card', () => {
  const cases = [
    { name: 'desktop', w: 1440, h: 900, insets: { left: 291, right: 352, top: 70, bottom: 78 } },
    { name: 'tablet', w: 900, h: 700, insets: { left: 0, right: 330, top: 150, bottom: 78 } },
    { name: 'phone', w: 390, h: 844, insets: { left: 0, right: 0, top: 137, bottom: 67 } },
  ];
  for (const { name, w, h, insets } of cases) {
    it(`stays clear of the panels and the caption band (${name})`, () => {
      const pts = corners(w, h, insets);
      const top = 1 - (2 * (insets.top + CAPTION_PX)) / h;
      for (const p of pts) {
        expect(p.x).toBeGreaterThanOrEqual(-1 + (2 * insets.left) / w - 1e-6);
        expect(p.x).toBeLessThanOrEqual(1 - (2 * insets.right) / w + 1e-6);
        expect(p.y).toBeLessThanOrEqual(top + 1e-6);
        expect(p.y).toBeGreaterThanOrEqual(-1 + (2 * insets.bottom) / h - 1e-6);
      }
      // ...and is still big enough to read: at least a fifth of the screen's width
      expect(Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x))).toBeGreaterThan(0.4);
    });
  }

  it('goes back to the middle of the screen when the panels leave no room', () => {
    const hold = cardHold(800, 400, { left: 0, right: 0, top: 200, bottom: 150 }, 40);
    expect(hold.x).toBe(0);
    expect(hold.y).toBe(0);
  });
});
