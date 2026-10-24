import { describe, expect, it } from 'vitest';
import { previewPlacement, toggledPreview } from '../deeds/preview';

describe('previewPlacement', () => {
  const list = { left: 1088, right: 1428, top: 120, bottom: 360 };

  it('puts the card under the offers in the context column when it fits', () => {
    expect(previewPlacement(list, 260, 1440, 900, false)).toEqual({ left: 1088, top: 368, width: 340, edge: 'right' });
  });

  it('puts it beside the column, on the board side, when there is no room below', () => {
    expect(previewPlacement({ ...list, bottom: 760 }, 260, 1440, 900, false)).toEqual({ left: 740, top: 120, width: 340, edge: 'right' });
    // Kept on screen
    expect(previewPlacement({ ...list, top: 800, bottom: 880 }, 260, 1440, 900, false).top).toBe(900 - 6 - 260);
  });

  it('puts it above the bottom sheet on a phone, centred, hugging the bottom edge', () => {
    expect(previewPlacement({ left: 0, right: 390, top: 600, bottom: 844 }, 200, 390, 844, true)).toEqual({ left: 15, top: 392, width: 360, edge: 'bottom' });
    // A tall sheet: never off the top of the screen
    expect(previewPlacement({ left: 0, right: 390, top: 100, bottom: 844 }, 200, 390, 844, true).top).toBe(6);
  });
});

describe('toggledPreview', () => {
  it('shows a space, and hides it on a second tap', () => {
    expect(toggledPreview(null, 3)).toBe(3);
    expect(toggledPreview(5, 3)).toBe(3);
    expect(toggledPreview(3, 3)).toBeNull();
  });
});
