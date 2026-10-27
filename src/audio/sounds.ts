/*
 * The game's sounds: the files in public/sounds (OGG, with an MP3 beside each for browsers that can't play OGG; each
 * board other than All Island has its own set in public/sounds/<board>, in OGG Opus), how loud each one plays, how many copies may overlap and how much its pitch wanders between plays (so a
 * walk of ten hops doesn't sound like a machine gun). Where each file came from is in public/credits.html.
 */

export type SoundName =
  | 'dice-roll'
  | 'dice-land'
  | 'token-hop'
  | 'buy'
  | 'cash-in'
  | 'cash-out'
  | 'card-draw'
  | 'card-flip'
  | 'auction-start'
  | 'auction-bid'
  | 'auction-sold'
  | 'jail'
  | 'jail-free'
  | 'build'
  | 'sell'
  | 'mortgage'
  | 'bankrupt'
  | 'win'
  | 'lose'
  | 'jackpot'
  | 'turn'
  | 'click'
  | 'confirm'
  | 'error';

export type MusicName = 'music-intro' | 'music-loop';

export interface SoundDef {
  /** Gain at full effects volume */
  vol: number;
  /** Most copies playing at once (the oldest stops) */
  max: number;
  /** Random pitch spread, in semitones either way */
  pitch: number;
  /** A stinger: the music ducks under it */
  duck?: boolean;
}

export const SOUNDS: Record<SoundName, SoundDef> = {
  'dice-roll': { vol: 0.7, max: 2, pitch: 1 },
  'dice-land': { vol: 0.8, max: 2, pitch: 1 },
  'token-hop': { vol: 0.45, max: 4, pitch: 1.5 },
  buy: { vol: 0.7, max: 1, pitch: 0 },
  'cash-in': { vol: 0.7, max: 3, pitch: 1 },
  'cash-out': { vol: 0.7, max: 3, pitch: 1 },
  'card-draw': { vol: 0.8, max: 1, pitch: 0.5 },
  'card-flip': { vol: 0.8, max: 1, pitch: 0.5 },
  'auction-start': { vol: 0.7, max: 1, pitch: 0 },
  'auction-bid': { vol: 0.6, max: 3, pitch: 1.5 },
  'auction-sold': { vol: 0.7, max: 1, pitch: 0 },
  jail: { vol: 0.6, max: 1, pitch: 0, duck: true },
  'jail-free': { vol: 0.6, max: 1, pitch: 0 },
  build: { vol: 0.8, max: 3, pitch: 1 },
  sell: { vol: 0.7, max: 3, pitch: 1 },
  mortgage: { vol: 0.7, max: 2, pitch: 0.5 },
  bankrupt: { vol: 0.7, max: 1, pitch: 0, duck: true },
  win: { vol: 0.75, max: 1, pitch: 0, duck: true },
  lose: { vol: 0.6, max: 1, pitch: 0, duck: true },
  jackpot: { vol: 0.75, max: 1, pitch: 0, duck: true },
  turn: { vol: 0.5, max: 1, pitch: 0 },
  click: { vol: 0.35, max: 2, pitch: 0.7 },
  confirm: { vol: 0.45, max: 1, pitch: 0 },
  error: { vol: 0.5, max: 1, pitch: 0 },
};

export const SOUND_NAMES = Object.keys(SOUNDS) as SoundName[];

/** Seconds of music-loop.ogg: the loop is cut there (an MP3 decoder may pad the end) */
export const LOOP_SECONDS = 17.44;

/** The same for each board's own loop, by sound folder (boardThemes.ts); the originals' when a board has none */
export const LOOP_SECONDS_BY_FOLDER: Record<string, number> = { colombo: 108.39, hill: 130.23, south: 51.69 };
