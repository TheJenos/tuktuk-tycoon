import type { BotSkill } from '../../net/types';
import type { LocalSeat } from '../../net/local';
import { getBoard } from '../../rules';
import { boardTheme, freeBotName as boardBotName, isDefaultBotName } from '../../shared/boardThemes';
import { SEAT_COLORS, boardTokens, tokenOn, type TokenId } from '../../shared/tokens';

/*
 * Seats as the lobby's forms edit them before a game exists: who sits (you, another player at this screen, or a
 * bot), with a token and a colour each, both unique at the table. The board decides how many may sit, which tokens
 * there are and what the bots are called.
 */

export const MIN_SEATS = 2;
/** The most seats any board has */
export const MAX_SEATS = 8;

/** How many players a board seats */
export const maxSeatsFor = (board: string): number => Math.min(MAX_SEATS, getBoard(board).maxPlayers);

export const SKILLS: { value: BotSkill; label: string; hint: string }[] = [
  { value: 'easy', label: 'Easy', hint: 'Buys on a whim, never trades' },
  { value: 'normal', label: 'Normal', hint: 'Keeps a cash reserve, builds evenly' },
  { value: 'hard', label: 'Hard', hint: 'Values sets, holds houses to starve the bank' },
  { value: 'expert', label: 'Expert', hint: 'Looks ahead with simulated games' },
];

export const skillLabel = (s: BotSkill | undefined): string => SKILLS.find((x) => x.value === s)?.label ?? 'Normal';

export interface SeatDraft {
  /** Stable key for the list */
  key: number;
  kind: 'you' | 'human' | 'bot';
  name: string;
  skill: BotSkill;
  token: TokenId;
  color: string;
}

let nextKey = 1;

const freeToken = (seats: SeatDraft[], board: string): TokenId => {
  const set = boardTokens(board);
  return set.find((t) => !seats.some((s) => tokenOn(board, s.token) === t)) ?? (set[0] as TokenId);
};
const freeColor = (seats: SeatDraft[]): string => SEAT_COLORS.find((c) => !seats.some((s) => s.color === c)) ?? SEAT_COLORS[0];

/** The board's first bot name nobody at the table has */
export const freeBotName = (seats: { name: string }[], board = 'lanka'): string => boardBotName(board, seats.map((s) => s.name), seats.length + 1);

function freePlayerName(seats: SeatDraft[]): string {
  const taken = new Set(seats.map((s) => s.name.toLowerCase()));
  for (let i = 2; ; i++) if (!taken.has(`player ${i}`)) return `Player ${i}`;
}

/** A new seat of `kind`, with the board's first token, colour and name nobody at the table has (none past its cap) */
export function addSeat(seats: SeatDraft[], kind: SeatDraft['kind'], skill: BotSkill = 'normal', board = 'lanka'): SeatDraft[] {
  if (seats.length >= maxSeatsFor(board)) return seats;
  const seat: SeatDraft = {
    key: nextKey++,
    kind,
    name: kind === 'bot' ? freeBotName(seats, board) : freePlayerName(seats),
    skill,
    token: freeToken(seats, board),
    color: freeColor(seats),
  };
  return [...seats, seat];
}

/** You plus `bots` bots and `humans` more players at this screen, on `board` */
export function startingSeats(you: string, { humans = 0, bots = 3 }: { humans?: number; bots?: number } = {}, board = 'lanka'): SeatDraft[] {
  let seats: SeatDraft[] = [{ key: nextKey++, kind: 'you', name: you, skill: 'normal', token: boardTokens(board)[0] as TokenId, color: SEAT_COLORS[0] }];
  for (let i = 0; i < humans; i++) seats = addSeat(seats, 'human', 'normal', board);
  for (let i = 0; i < bots; i++) seats = addSeat(seats, 'bot', 'normal', board);
  return seats;
}

/**
 * The table moved to another board: every token becomes the same slot of the new board's set (so they stay unique),
 * and bots still called by a default name take the new board's names. Seats past the new board's cap stay, for the
 * player to remove (seatsProblem says so).
 */
export function seatsOnBoard(seats: SeatDraft[], board: string): SeatDraft[] {
  const out = seats.map((s) => ({ ...s, token: tokenOn(board, s.token) }));
  const kept = out.filter((s) => !(s.kind === 'bot' && isDefaultBotName(s.name)));
  return out.map((s) => {
    if (s.kind !== 'bot' || !isDefaultBotName(s.name)) return s;
    const name = freeBotName(kept, board);
    const seat = { ...s, name };
    kept.push(seat);
    return seat;
  });
}

/** The names the board's bots get, for a preview */
export const botNamesFor = (board: string): readonly string[] => boardTheme(board).botNames;

export const toLocalSeats = (seats: SeatDraft[]): LocalSeat[] =>
  seats.map((s) => ({
    name: s.name.trim(),
    token: s.token,
    color: s.color,
    kind: s.kind === 'bot' ? 'bot' : 'human',
    ...(s.kind === 'bot' ? { skill: s.skill } : {}),
  }));
