import type { Edge } from '../layout';

/*
 * Where the floating preview card of a hovered property goes (pure geometry). On a phone it sits just above the
 * bottom sheet holding the offers; elsewhere under the offers list in the context column (over the log), or, when
 * there is no room below, beside the column on the board's side. It says which edge it hugs, so the camera frames
 * the previewed tile clear of it.
 */

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface CardPlacement {
  left: number;
  top: number;
  width: number;
  edge: Edge;
}

/**
 * @param anchor the offers list as seen (clipped to its scrolling panel); on a phone, the bottom sheet
 * @param height the card's height, CSS px
 */
export function previewPlacement(anchor: Rect, height: number, vw: number, vh: number, phone: boolean, gap = 8, margin = 6): CardPlacement {
  const clampTop = (t: number) => Math.max(margin, Math.min(t, vh - margin - height));
  if (phone) {
    const width = Math.min(vw - 2 * margin, 360);
    return { left: Math.round((vw - width) / 2), top: Math.round(clampTop(anchor.top - gap - height)), width, edge: 'bottom' };
  }
  const width = Math.max(220, Math.min(340, anchor.right - anchor.left));
  if (anchor.bottom + gap + height <= vh - margin) return { left: Math.round(anchor.left), top: Math.round(anchor.bottom + gap), width, edge: 'right' };
  return { left: Math.round(Math.max(margin, anchor.left - gap - width)), top: Math.round(clampTop(anchor.top)), width, edge: 'right' };
}

/** A tap on a property's preview control: show it, or hide it if it is the one showing */
export const toggledPreview = (current: number | null, space: number): number | null => (current === space ? null : space);
