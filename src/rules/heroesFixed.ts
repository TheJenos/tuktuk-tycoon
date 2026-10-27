import type { RulesConfig } from './types';

/*
 * The rules a heroes board (Hero League) pins: normalizeConfig forces them whatever the room asked for, and the board's
 * standard rules are these. Kept in a file of its own (no imports but types) so the board data can use it without an
 * import cycle through board.ts.
 */

/** Config fields pinned on a heroes board (the rest stay adjustable: start cash, salary, fine, turn limit...) */
export const HEROES_FIXED: Readonly<Partial<Omit<RulesConfig, 'board' | 'debug'>>> = {
  speedDie: false,
  houses: 0,
  hotels: 0,
  auctions: false,
  auctionAll: false,
  jailRent: false,
  buyAfterFirstLap: false,
  dealProperties: 0,
  endMode: 'lastStanding',
  jackpot: false,
  trading: 'off',
};
