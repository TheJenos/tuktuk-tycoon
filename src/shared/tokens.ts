/** The eight player tokens. Ids are stored in rooms (database.rules.json lists them); labels are shown in the UI. */
export const TOKENS = [
  { id: 'tuktuk', label: 'Tuk-tuk' },
  { id: 'elephant', label: 'Elephant' },
  { id: 'coconut', label: 'King coconut' },
  { id: 'cricket', label: 'Cricket bat' },
  { id: 'tea', label: 'Cup of tea' },
  { id: 'drum', label: 'Kandyan drum' },
  { id: 'oruwa', label: 'Oruwa canoe' },
  { id: 'kite', label: 'New Year kite' },
] as const;

export type TokenId = (typeof TOKENS)[number]['id'];

export const isTokenId = (v: unknown): v is TokenId => TOKENS.some((t) => t.id === v);

/** Shown for a seat whose token is missing or from an older version */
export const DEFAULT_TOKEN: TokenId = 'tuktuk';

/**
 * Seat colours, one per seat (s0..s7): saturated, and spread as far apart around the colour wheel as eight hues go
 * (red, blue, yellow, green, then purple, orange, cyan, pink), so the first four seats get the four most distinct.
 * The token silhouette is always shown next to the colour, so colour is never the only cue.
 */
export const SEAT_COLORS = ['#e01e2b', '#2457ff', '#f5c400', '#1e9e3a', '#a32eff', '#ff7f00', '#00b7cc', '#ff40c0'] as const;
