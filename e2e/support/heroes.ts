import type { Locator, Page } from '@playwright/test';
import type { SeatInfo } from '../../src/net/types';
import { getBoard, isProperty, type GameState, type SeatId } from '../../src/rules';
import { hud } from './play';
import { seatInfos, type SeatSpec } from './positions';

/*
 * Hero League (board `heroes`, docs/heroes.md) for the specs: its spaces by name, seats playing chosen heroes, owning
 * locations in a position, and the game screen's Hero League pieces (the reaction banner, the superpower button).
 */

export const HEROES_BOARD = getBoard('heroes');

export type HeroId = 'jadeTitan' | 'starCaptain' | 'steelAce' | 'stormLord' | 'velvetViper' | 'sharpshot';

/** A Hero League board index by its printed name: heroSpace('Sky Carrier') is 16 */
export function heroSpace(name: string): number {
  const i = HEROES_BOARD.spaces.findIndex((sp) => sp.name === name);
  if (i < 0) throw new Error(`No Hero League space called ${name}`);
  return i;
}

/** Every location on the board */
export const LOCATIONS = HEROES_BOARD.spaces.flatMap((sp, i) => (isProperty(sp) ? [i] : []));

/** Seats s0, s1, ... as seatInfos makes them, each with its hero as its token (the game then plays that hero) */
export function heroSeats(specs: (SeatSpec & { hero: HeroId })[]): SeatInfo[] {
  return seatInfos(specs).map((info, i) => ({ ...info, token: specs[i]!.hero }));
}

/** `seat` has saved these locations */
export function save(s: GameState, seat: SeatId, ...spaces: number[]): void {
  for (const i of spaces) {
    if (!isProperty(HEROES_BOARD.spaces[i])) throw new Error(`${HEROES_BOARD.spaces[i]?.name ?? i} is not a location`);
    s.props[`p${i}`] = { owner: seat, level: 0 };
  }
}

/** The reaction window's banner (Thunder Call / Star Shield), over the middle of the board */
export const reactionBanner = (page: Page): Locator => hud(page).locator('.reaction-banner');

/** A local seat's row in the banner, by player name (hot-seat names each reactor) */
export const reactionRow = (page: Page, name: string): Locator => reactionBanner(page).getByRole('group', { name: `Reaction for ${name}` });

/** The superpower used on its own, beside Roll (Titan Smash) */
export const powerButton = (page: Page): Locator => hud(page).locator('.board-center .power-button');

/** My hero's card in the context column, and My locations under it (hot-seat: each with a switcher between my seats) */
export const heroCard = (page: Page): Locator => hud(page).getByRole('region', { name: 'My hero' });
export const myLocations = (page: Page): Locator => hud(page).getByRole('region', { name: 'My locations' });

/**
 * What is wrong with the players panel's hero lines as laid out now: a hero's name with no width, or a part of the
 * line (the name, the superpower's badge) outside its player's card or over their cash. Empty when every line fits.
 * A line for screen readers only (1px) is not looked into.
 */
export function heroLineFaults(page: Page): Promise<string[]> {
  return hud(page).locator('.player-card').evaluateAll((cards) =>
    cards.flatMap((card) => {
      const who = card.querySelector('.player-title strong')?.textContent ?? '?';
      const line = card.querySelector('.player-hero');
      if (!line) return [`${who}: no hero line`];
      const box = (e: Element) => e.getBoundingClientRect();
      const within = (a: DOMRect, b: DOMRect) => a.left >= b.left - 0.5 && a.right <= b.right + 0.5 && a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5;
      const meets = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      const c = box(card);
      if (box(line).width <= 1) return within(box(line), c) ? [] : [`${who}: the hidden hero line is outside the card`];
      const cash = card.querySelector('.player-cash');
      const faults: string[] = [];
      const name = line.querySelector('.hero-name');
      if (!name || box(name).width < 1) faults.push(`${who}: the hero's name has no room`);
      for (const part of line.children) {
        const r = box(part);
        if (!within(r, c)) faults.push(`${who}: "${part.textContent}" runs outside the card`);
        if (cash && meets(r, box(cash))) faults.push(`${who}: "${part.textContent}" is over the cash`);
      }
      return faults;
    }),
  );
}
