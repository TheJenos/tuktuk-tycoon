import { createGame } from '..';
import type { GameState, RulesConfig, SeatId } from '../types';
import { SEATS } from './helpers';

/*
 * Hero League scenarios. Faces of the Hero die (= the heroes' list order): 1 Jade Titan (smash), 2 Star Captain
 * (shield), 3 Steel Ace (copy), 4 Storm Lord (thunder), 5 Velvet Viper (sting), 6 Sharpshot (aim).
 * Board: 0 Rally Point, 1-2 brown 70 (40), 3 Hero HQ, 4 teal 120 (70), 5 Villain Strike, 6 teal 120, 7 Holding Cell,
 * 8 VS, 9 pink 160 (100), 10 pink 180 (110), 11 VS, 12 orange 200 (120), 13 orange 220 (130), 14 Rooftop Lookout,
 * 15 red 240 (140), 16 red 260 (150), 17 yellow 280 (170), 18 VS, 19 yellow 300 (180), 20 VS, 21 Villain Ambush,
 * 22 green 320 (190), 23 Hero HQ, 24 green 320 (190), 25 VS, 26 purple 400 (240), 27 purple 400 (240).
 */

export type HeroId = 'jadeTitan' | 'starCaptain' | 'steelAce' | 'stormLord' | 'velvetViper' | 'sharpshot';

export const FACE: Record<HeroId, number> = {
  jadeTitan: 1,
  starCaptain: 2,
  steelAce: 3,
  stormLord: 4,
  velvetViper: 5,
  sharpshot: 6,
};

/** Every location index on the board */
export const LOCATIONS = [1, 2, 4, 6, 9, 10, 12, 13, 15, 16, 17, 19, 22, 24, 26, 27];

/**
 * A Hero League game where s0 starts and turn order is s0, s1, ...; seat i plays heroes[i] (default: Jade Titan and
 * Sharpshot, whose powers open no window on someone else's move). Debug is on so the dice and the Hero die can be rigged.
 */
export function heroGame(heroes: HeroId[] = ['jadeTitan', 'sharpshot'], cfg: Partial<RulesConfig> = {}, seed = 1): GameState {
  const seats = heroes.map((hero, i) => ({ id: SEATS[i] as SeatId, name: `P${i}`, hero }));
  const { state } = createGame({ debug: true, ...cfg, board: 'heroes' }, seats, seed);
  state.order = SEATS.slice(0, heroes.length);
  state.turn = { seat: 's0', no: 1, doubles: 0, again: false };
  return state;
}

/** Queue rigged Hero-die faces */
export const rigHero = (s: GameState, ...faces: number[]): void => {
  s.rigHero = [...(s.rigHero ?? []), ...faces];
};

/** Marks these seats' superpowers used during the current turn (so a salary this turn does not bring them back) */
export function spend(s: GameState, ...seats: SeatId[]): void {
  for (const seat of seats) s.players[seat]!.powerUsed = s.turn.no;
}

/** Puts a seat in the Holding Cell */
export function jail(s: GameState, seat: SeatId): void {
  s.players[seat]!.pos = 7;
  s.players[seat]!.jail = { tries: 0 };
}
