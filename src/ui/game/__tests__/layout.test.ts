import { describe, expect, it } from 'vitest';
import { cellOf, fitUiScale, insetsFrom, isTypingTarget, shortcutOf, sideOf, stripScroll } from '../layout';

const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height });

describe('cellOf', () => {
  it('puts the 40 spaces round the edge of an 11x11 grid, clockwise from GO bottom right', () => {
    expect(cellOf(0)).toEqual({ row: 11, col: 11 });
    expect(cellOf(10)).toEqual({ row: 11, col: 1 });
    expect(cellOf(20)).toEqual({ row: 1, col: 1 });
    expect(cellOf(30)).toEqual({ row: 1, col: 11 });
    expect(cellOf(39)).toEqual({ row: 10, col: 11 });
    const cells = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const { row, col } = cellOf(i);
      expect(row === 1 || row === 11 || col === 1 || col === 11).toBe(true);
      cells.add(`${row},${col}`);
    }
    expect(cells.size).toBe(40);
    expect([0, 9, 10, 19, 20, 29, 30, 39].map((i) => sideOf(i))).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });
});

describe('insetsFrom', () => {
  it('measures each panel from the edge it hugs', () => {
    const got = insetsFrom(
      [
        { edge: 'left', rect: rect(12, 12, 280, 300) },
        { edge: 'right', rect: rect(1000 - 352, 12, 340, 700) },
        { edge: 'bottom', rect: rect(400, 800 - 80, 300, 68) },
        { edge: 'top', rect: rect(400, 12, 300, 40) },
        { edge: '', rect: rect(0, 0, 999, 999) },
        { edge: 'left', rect: rect(0, 0, 0, 0) },
      ],
      1000,
      800,
    );
    expect(got).toEqual({ left: 292, right: 352, top: 52, bottom: 80 });
  });
});

describe('shortcuts', () => {
  it('maps the game keys, never with modifiers', () => {
    expect(shortcutOf({ key: 'r' })).toBe('roll');
    expect(shortcutOf({ key: 'R' })).toBe('roll');
    expect(shortcutOf({ key: 'Escape' })).toBe('menu');
    expect(shortcutOf({ key: 'c' })).toBe('recenter');
    expect(shortcutOf({ key: 'n' })).toBe('mute');
    expect(shortcutOf({ key: 'r', ctrlKey: true })).toBeNull();
    expect(shortcutOf({ key: 'x' })).toBeNull();
  });

  it('knows where keys mean typing', () => {
    expect(isTypingTarget({ tagName: 'INPUT' })).toBe(true);
    expect(isTypingTarget({ tagName: 'INPUT', type: 'number' })).toBe(true);
    expect(isTypingTarget({ tagName: 'INPUT', type: 'checkbox' })).toBe(false);
    expect(isTypingTarget({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTypingTarget({ tagName: 'BUTTON' })).toBe(false);
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe('stripScroll (the players strip)', () => {
  it('scrolls the least that shows the current player, and mine too when both fit', () => {
    // A 300 px window over cards 100 px apart
    const card = (i: number) => ({ start: i * 100, end: i * 100 + 96 });
    expect(stripScroll(0, 300, card(1))).toBe(0);
    expect(stripScroll(0, 300, card(4))).toBe(196);
    expect(stripScroll(400, 300, card(1))).toBe(100);
    // Current 4, mine 2: both fit, as little move as possible
    expect(stripScroll(0, 300, card(4), card(2))).toBe(196);
    // Current 6, mine 1: they can't both be in view: the current one wins
    expect(stripScroll(0, 300, card(6), card(1))).toBe(396);
  });
});

describe('fitUiScale (Panel size)', () => {
  it('keeps the setting where the window has room, and lowers it only as far as the layout needs', () => {
    expect(fitUiScale(1.4, 1440, 900)).toBe(1.4);
    expect(fitUiScale(1.4, 1920, 1080)).toBe(1.4);
    expect(fitUiScale(1.4, 1024, 600)).toBe(1.11);
    expect(fitUiScale(1.2, 1024, 600)).toBe(1.11);
    expect(fitUiScale(1.4, 1280, 720)).toBe(1.33);
    expect(fitUiScale(1.4, 390, 844)).toBe(1.3);
    expect(fitUiScale(1.4, 768, 1024)).toBe(1.3);
    // Never below 100%, and a smaller setting is the player's choice
    expect(fitUiScale(1.4, 800, 360)).toBe(1);
    expect(fitUiScale(0.8, 1024, 600)).toBe(0.8);
    expect(fitUiScale(1, 320, 480)).toBe(1);
  });
});
