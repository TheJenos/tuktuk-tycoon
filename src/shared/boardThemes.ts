import { boardTokens, type TokenId } from './tokens';

/*
 * What each board brings besides its spaces and rules (those are in src/rules/data): its tokens (src/shared/tokens.ts),
 * its bots' names and its sounds. All Island's are the game's originals; a board without an entry uses them.
 */

export interface BoardTheme {
  tokens: TokenId[];
  /** Default names for bots, in the order they are handed out */
  botNames: readonly string[];
  /** Folder under public/sounds for its music and effects ('' = the originals at public/sounds) */
  sounds: string;
}

const BOT_NAMES: Record<string, readonly string[]> = {
  lanka: ['Nimal', 'Kamala', 'Kasun', 'Dilini', 'Ruwan', 'Sanduni', 'Chamara', 'Nadeesha'],
  colombo: ['Dinesh', 'Ishara', 'Tharindu', 'Malsha', 'Shehan', 'Thilini', 'Rukshan', 'Anjali'],
  hill: ['Sunil', 'Pushpa', 'Muthu', 'Kumari', 'Bandara', 'Lakshmi', 'Selvam', 'Menike'],
  south: ['Sampath', 'Nadeeka', 'Lahiru', 'Hiruni', 'Jayantha', 'Sewwandi', 'Kalum', 'Dulani'],
};

const SOUNDS: Record<string, string> = { lanka: '', colombo: 'colombo', hill: 'hill', south: 'south' };

export function boardTheme(board: string): BoardTheme {
  return { tokens: boardTokens(board), botNames: BOT_NAMES[board] ?? (BOT_NAMES.lanka as readonly string[]), sounds: SOUNDS[board] ?? '' };
}

/** The first of the board's bot names nobody at the table has (case-insensitive), else "Bot n" */
export function freeBotName(board: string, taken: Iterable<string>, n: number): string {
  const used = new Set([...taken].map((x) => x.toLowerCase()));
  return boardTheme(board).botNames.find((x) => !used.has(x.toLowerCase())) ?? `Bot ${n}`;
}

/** Whether a name is one of any board's default bot names (so a board change may swap it for the new board's) */
export const isDefaultBotName = (name: string): boolean => Object.values(BOT_NAMES).some((l) => l.includes(name));
