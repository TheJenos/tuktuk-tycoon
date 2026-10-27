import { COLOMBO_THEME } from '../boards/colombo/theme';
import { HILL_THEME } from '../boards/hill/theme';
import { LANKA_THEME } from '../boards/lanka/theme';
import { SOUTH_THEME } from '../boards/south/theme';
import { boardTokens, type TokenId } from './tokens';

/*
 * What each board brings besides its spaces and rules, collected from its folder (src/boards/<board>/theme.ts): its
 * tokens, its bots' names and its sounds (src/boards/<board>/sounds). All Island's are the game's originals; a board
 * without a theme uses them.
 */

export interface BoardTheme {
  tokens: TokenId[];
  /** Default names for bots, in the order they are handed out */
  botNames: readonly string[];
  /** Its sound folder ('' = All Island's, the originals every other board falls back to) */
  sounds: string;
  /** Seconds of its music loop (where the loop is cut) */
  loopSeconds: number;
}

const THEMES: Record<string, { botNames: readonly string[]; loopSeconds: number }> = {
  lanka: LANKA_THEME,
  colombo: COLOMBO_THEME,
  hill: HILL_THEME,
  south: SOUTH_THEME,
};

export function boardTheme(board: string): BoardTheme {
  const own = THEMES[board];
  const t = own ?? LANKA_THEME;
  return { tokens: boardTokens(board), botNames: t.botNames, sounds: own && board !== 'lanka' ? board : '', loopSeconds: t.loopSeconds };
}

/** The first of the board's bot names nobody at the table has (case-insensitive), else "Bot n" */
export function freeBotName(board: string, taken: Iterable<string>, n: number): string {
  const used = new Set([...taken].map((x) => x.toLowerCase()));
  return boardTheme(board).botNames.find((x) => !used.has(x.toLowerCase())) ?? `Bot ${n}`;
}

/** Whether a name is one of any board's default bot names (so a board change may swap it for the new board's) */
export const isDefaultBotName = (name: string): boolean => Object.values(THEMES).some((t) => t.botNames.includes(name));
