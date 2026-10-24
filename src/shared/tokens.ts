/** The eight player tokens. Ids are stored in rooms; labels are shown in the UI. */
export const TOKENS = [
  { id: 'hat', label: 'Top hat' },
  { id: 'car', label: 'Racecar' },
  { id: 'boat', label: 'Sailboat' },
  { id: 'rocket', label: 'Rocket' },
  { id: 'crown', label: 'Crown' },
  { id: 'anchor', label: 'Anchor' },
  { id: 'teapot', label: 'Teapot' },
  { id: 'knight', label: 'Knight' },
] as const;

export type TokenId = (typeof TOKENS)[number]['id'];

export const isTokenId = (v: unknown): v is TokenId => TOKENS.some((t) => t.id === v);

/**
 * Seat colours, one per seat (s0..s7). Picked to stay distinguishable with the common colour-vision deficiencies;
 * the token silhouette is always shown next to the colour, so colour is never the only cue.
 */
export const SEAT_COLORS = ['#e8a33d', '#3d8fe8', '#d6475b', '#3fae6a', '#9b6ae0', '#e07ac0', '#2bb3b3', '#c9c9c9'] as const;
