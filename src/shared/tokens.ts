import { COLOMBO_THEME } from '../boards/colombo/theme';
import { HEROES_THEME } from '../boards/heroes/theme';
import { HILL_THEME } from '../boards/hill/theme';
import { LANKA_THEME } from '../boards/lanka/theme';
import { SOUTH_THEME } from '../boards/south/theme';
import { getBoard, type GameState, type SeatId } from '../rules';

/** Each board's token set (src/boards/<board>/theme.ts) */
const SETS = {
  lanka: LANKA_THEME.tokens,
  colombo: COLOMBO_THEME.tokens,
  hill: HILL_THEME.tokens,
  south: SOUTH_THEME.tokens,
  heroes: HEROES_THEME.tokens,
};

/**
 * The player tokens: each board its own set (eight on the classic boards, Hero League's six heroes; ids unique across
 * boards). Ids are stored in rooms (database.rules.json lists them); labels are shown in the UI. A board's set is in
 * seat-slot order: slot k of one board stands for slot k of another (tokenOn), so a seat keeps a token of its own when
 * the board changes. A slot the other set does not have wraps around; tokensOn re-maps a whole table without repeats.
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

/** A board's tokens, in slot order (All Island's for a board without a set) */
export function boardTokens(board: string): TokenId[] {
  const own = TOKENS.filter((t) => t.board === board).map((t) => t.id);
  return own.length ? own : TOKENS.filter((t) => t.board === 'lanka').map((t) => t.id);
}

/**
 * A token as `board` shows it: itself when it's from that board's set, else the same slot of that board's set (a slot
 * past the end of a smaller set wraps around to its start, so it may repeat another seat's: see tokensOn)
 */
export function tokenOn(board: string, id: string): TokenId {
  const set = boardTokens(board);
  if ((set as string[]).includes(id)) return id as TokenId;
  const slot = boardTokens(tokenBoard(id)).indexOf(id as TokenId);
  return set[slot < 0 ? 0 : slot % set.length] ?? DEFAULT_TOKEN;
}

/**
 * A table's tokens as `board` shows them, none twice while the set has enough: every seat whose slot the set has keeps
 * it (the first of two seats on one slot does), the others take the set's free tokens in slot order. Only a table
 * larger than the set repeats any (those seats keep tokenOn's wrapped slot).
 */
export function tokensOn(board: string, ids: readonly string[]): TokenId[] {
  const set = boardTokens(board);
  const out: (TokenId | null)[] = ids.map(() => null);
  const used = new Set<TokenId>();
  ids.forEach((id, i) => {
    const inSet = (set as string[]).includes(id);
    const slot = boardTokens(tokenBoard(id)).indexOf(id as TokenId);
    const t = inSet ? (id as TokenId) : slot >= 0 && slot < set.length ? set[slot] : undefined;
    if (t && !used.has(t)) {
      out[i] = t;
      used.add(t);
    }
  });
  const free = set.filter((t) => !used.has(t));
  return out.map((t, i) => t ?? free.shift() ?? tokenOn(board, ids[i] ?? ''));
}

/** The board's tokens nobody at the table holds (the table as `board` shows it: tokensOn), in slot order */
export function freeTokens(board: string, held: readonly string[]): TokenId[] {
  const used = new Set(tokensOn(board, held));
  return boardTokens(board).filter((t) => !used.has(t));
}

/**
 * The token for a new seat: the board's first one nobody at the table holds, or on Hero League a random free hero (who
 * plays which hero is part of the game); none when every one is held
 */
export function pickFreeToken(board: string, held: readonly string[], rnd: () => number = Math.random): TokenId | undefined {
  const free = freeTokens(board, held);
  return getBoard(board).heroes ? free[Math.floor(rnd() * free.length)] : free[0];
}

/**
 * The token a seat shows: on Hero League the hero it plays (a token picked from another board's set was mapped by
 * slot), else the one `chosen` in the lobby. createDoc stores it in the seat; the HUD and the scene read it the same way.
 */
export const seatToken = (game: Pick<GameState, 'players'> | null | undefined, seat: SeatId, chosen: string | undefined): string | undefined =>
  game?.players[seat]?.hero ?? chosen;

/**
 * Seat colours, one per seat (s0..s7): saturated, and spread as far apart around the colour wheel as eight hues go
 * (red, blue, yellow, green, then purple, orange, cyan, pink), so the first four seats get the four most distinct.
 * The token silhouette is always shown next to the colour, so colour is never the only cue.
 */
export const SEAT_COLORS = ['#e01e2b', '#2457ff', '#f5c400', '#1e9e3a', '#a32eff', '#ff7f00', '#00b7cc', '#ff40c0'] as const;
