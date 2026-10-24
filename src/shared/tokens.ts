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
 * Seat colours, one per seat (s0..s7). Picked to stay distinguishable with the common colour-vision deficiencies;
 * the token silhouette is always shown next to the colour, so colour is never the only cue.
 */
export const SEAT_COLORS = ['#e8a33d', '#3d8fe8', '#d6475b', '#3fae6a', '#9b6ae0', '#e07ac0', '#2bb3b3', '#c9c9c9'] as const;
