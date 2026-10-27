import { COLOMBO_THEME } from '../boards/colombo/theme';
import { HILL_THEME } from '../boards/hill/theme';
import { LANKA_THEME } from '../boards/lanka/theme';
import { SOUTH_THEME } from '../boards/south/theme';

/** Each board's token set (src/boards/<board>/theme.ts) */
const SETS = { lanka: LANKA_THEME.tokens, colombo: COLOMBO_THEME.tokens, hill: HILL_THEME.tokens, south: SOUTH_THEME.tokens };

/**
 * The player tokens: eight per board, each board its own set (ids unique across boards). Ids are stored in rooms
 * (database.rules.json lists them); labels are shown in the UI. A board's set is in seat-slot order: slot k of one
 * board stands for slot k of another (tokenOn), so a seat keeps a token of its own when the board changes.
 */
export const TOKENS = (Object.entries(SETS) as [string, (typeof SETS)[keyof typeof SETS]][]).flatMap(([board, set]) =>
  set.map((t) => ({ ...t, board })),
);

export type TokenId = (typeof SETS)[keyof typeof SETS][number]['id'];

export const isTokenId = (v: unknown): v is TokenId => TOKENS.some((t) => t.id === v);

/** Shown for a seat whose token is missing or from an older version */
export const DEFAULT_TOKEN: TokenId = 'tuktuk';

/** The board whose set a token is from (All Island's for an unknown one) */
export const tokenBoard = (id: string): string => TOKENS.find((t) => t.id === id)?.board ?? 'lanka';

/** A board's eight tokens, in slot order (All Island's for a board without a set) */
export function boardTokens(board: string): TokenId[] {
  const own = TOKENS.filter((t) => t.board === board).map((t) => t.id);
  return own.length ? own : TOKENS.filter((t) => t.board === 'lanka').map((t) => t.id);
}

/** A token as `board` shows it: itself when it's from that board's set, else the same slot of that board's set */
export function tokenOn(board: string, id: string): TokenId {
  const set = boardTokens(board);
  if ((set as string[]).includes(id)) return id as TokenId;
  const slot = boardTokens(tokenBoard(id)).indexOf(id as TokenId);
  return set[slot < 0 ? 0 : slot] ?? DEFAULT_TOKEN;
}

/**
 * Seat colours, one per seat (s0..s7): saturated, and spread as far apart around the colour wheel as eight hues go
 * (red, blue, yellow, green, then purple, orange, cyan, pink), so the first four seats get the four most distinct.
 * The token silhouette is always shown next to the colour, so colour is never the only cue.
 */
export const SEAT_COLORS = ['#e01e2b', '#2457ff', '#f5c400', '#1e9e3a', '#a32eff', '#ff7f00', '#00b7cc', '#ff40c0'] as const;
