import type { UiState } from '../../state/ui';

/*
 * Pure geometry for the game screen: how much of the viewport the HUD panels cover (the camera keeps the board
 * clear of them), where each space sits on the 2D MiniBoard, and which keys are game shortcuts.
 */

export type Edge = 'left' | 'right' | 'top' | 'bottom';
export type Insets = UiState['insets'];

export interface EdgeRect {
  /** The edge the panel hugs in the current layout (from its CSS `--edge`); anything else is ignored */
  edge: string;
  rect: { left: number; top: number; right: number; bottom: number; width: number; height: number };
}

const isEdge = (e: string): e is Edge => e === 'left' || e === 'right' || e === 'top' || e === 'bottom';

/** The insets (CSS px from each viewport edge) covered by the panels */
export function insetsFrom(items: readonly EdgeRect[], vw: number, vh: number): Insets {
  const out: Insets = { left: 0, right: 0, top: 0, bottom: 0 };
  for (const { edge, rect } of items) {
    if (!isEdge(edge) || rect.width <= 0 || rect.height <= 0) continue;
    const cover = edge === 'left' ? rect.right : edge === 'right' ? vw - rect.left : edge === 'top' ? rect.bottom : vh - rect.top;
    out[edge] = Math.max(out[edge], Math.round(Math.min(cover, edge === 'left' || edge === 'right' ? vw : vh)));
  }
  return out;
}

export const sameInsets = (a: Insets, b: Insets): boolean =>
  a.left === b.left && a.right === b.right && a.top === b.top && a.bottom === b.bottom;

/**
 * A board space's cell in the MiniBoard's (side+1)x(side+1) grid (1-based CSS grid lines), laid out like the 3D
 * board: GO bottom right, play running clockwise (left along the bottom, up the left side, along the top, down).
 */
export function cellOf(i: number, spaces = 40): { row: number; col: number } {
  const side = spaces / 4;
  const last = side + 1;
  const k = i % side;
  switch (Math.floor(i / side)) {
    case 0: return { row: last, col: last - k };
    case 1: return { row: last - k, col: 1 };
    case 2: return { row: 1, col: 1 + k };
    default: return { row: 1 + k, col: last };
  }
}

/** Which side of the board a space is on (0 bottom, 1 left, 2 top, 3 right), for the band's position */
export const sideOf = (i: number, spaces = 40): number => Math.floor(i / (spaces / 4)) % 4;

export type Shortcut = 'roll' | 'endTurn' | 'buy' | 'auction' | 'manage' | 'trade' | 'log' | 'recenter' | 'view' | 'mute' | 'menu';

const KEYS: Record<string, Shortcut> = {
  r: 'roll',
  e: 'endTurn',
  b: 'buy',
  a: 'auction',
  m: 'manage',
  t: 'trade',
  l: 'log',
  c: 'recenter',
  v: 'view',
  n: 'mute',
  escape: 'menu',
};

/** The game shortcut for a key press (none with Ctrl, Alt or Meta held, so browser keys keep working) */
export function shortcutOf(e: { key: string; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean }): Shortcut | null {
  if (e.ctrlKey || e.altKey || e.metaKey) return null;
  return KEYS[e.key.toLowerCase()] ?? null;
}

/** Focus is somewhere keys mean typing (a text field, a select, an editable element) */
export function isTypingTarget(el: { tagName?: string; isContentEditable?: boolean; type?: string } | null): boolean {
  if (!el?.tagName) return false;
  const tag = el.tagName.toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) return true;
  if (tag !== 'INPUT') return false;
  return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset'].includes((el.type ?? 'text').toLowerCase());
}

/** A stretch of a scrolling strip, in content px */
export interface Span {
  start: number;
  end: number;
}

/**
 * Where to scroll a strip (its scrollLeft or scrollTop) so `must` is in view, and `want` with it when both fit:
 * the least move from `pos`, for a window `size` px long. The browser clamps it to the strip's ends.
 */
export function stripScroll(pos: number, size: number, must: Span, want?: Span | null): number {
  const show = (from: number, s: Span) => Math.min(Math.max(from, s.end - size), s.start);
  if (want) {
    const both = { start: Math.min(must.start, want.start), end: Math.max(must.end, want.end) };
    if (both.end - both.start <= size) return show(pos, both);
  }
  return show(pos, must);
}

/**
 * The panel zoom actually used: the Panel size setting, lowered as far as this window needs so the HUD still fits
 * it (never below 100%; a setting under 100% is kept). The side columns grow with the zoom up to their share of the
 * width; each layout needs its panels' content to keep a minimum width in CSS px, and the stacked panels a minimum
 * height: on 1024x600 a 140% setting draws at 111%, on 1440x900 and up at 140%.
 */
export function fitUiScale(scale: number, vw: number, vh: number): number {
  if (!(scale > 1)) return scale;
  let fit: number;
  if (vw <= 640) {
    // Phones: the action bar's six tools across the sheet
    fit = vw / 300;
  } else if (vw <= 1023) {
    // Tablets: the 270 px context column beside a 300 px board column (the turn and action bars)
    fit = Math.min((vw - 24) / 570, vh / 540);
  } else {
    // Desktop: players (25vw) and context (30vw) columns at least 230 and 270 px of content, and the height
    fit = Math.min((0.25 * vw) / 230, (0.3 * vw) / 270, vh / 540);
  }
  return Math.max(1, Math.min(scale, Math.floor(fit * 100) / 100));
}
