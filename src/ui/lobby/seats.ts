import type { BotSkill } from '../../net/types';
import type { LocalSeat } from '../../net/local';
import { SEAT_COLORS, TOKENS, type TokenId } from '../../shared/tokens';

/*
 * Seats as the lobby's forms edit them before a game exists: who sits (you, another player at this screen, or a
 * bot), with a token and a colour each, both unique at the table.
 */

export const MIN_SEATS = 2;
export const MAX_SEATS = 8;

/** Bot names: common Sri Lankan first names */
export const BOT_NAMES = ['Nimal', 'Kamala', 'Kasun', 'Dilini', 'Ruwan', 'Sanduni', 'Chamara', 'Nadeesha'] as const;

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

const freeToken = (seats: SeatDraft[]): TokenId => TOKENS.find((t) => !seats.some((s) => s.token === t.id))?.id ?? TOKENS[0].id;
const freeColor = (seats: SeatDraft[]): string => SEAT_COLORS.find((c) => !seats.some((s) => s.color === c)) ?? SEAT_COLORS[0];

export function freeBotName(seats: { name: string }[]): string {
  const taken = new Set(seats.map((s) => s.name.toLowerCase()));
  return BOT_NAMES.find((n) => !taken.has(n.toLowerCase())) ?? `Bot ${seats.length + 1}`;
}

function freePlayerName(seats: SeatDraft[]): string {
  const taken = new Set(seats.map((s) => s.name.toLowerCase()));
  for (let i = 2; ; i++) if (!taken.has(`player ${i}`)) return `Player ${i}`;
}

/** A new seat of `kind`, with the first token, colour and name nobody at the table has */
export function addSeat(seats: SeatDraft[], kind: SeatDraft['kind'], skill: BotSkill = 'normal'): SeatDraft[] {
  if (seats.length >= MAX_SEATS) return seats;
  const seat: SeatDraft = {
    key: nextKey++,
    kind,
    name: kind === 'bot' ? freeBotName(seats) : freePlayerName(seats),
    skill,
    token: freeToken(seats),
    color: freeColor(seats),
  };
  return [...seats, seat];
}

/** You plus `bots` bots and `humans` more players at this screen */
export function startingSeats(you: string, { humans = 0, bots = 3 }: { humans?: number; bots?: number } = {}): SeatDraft[] {
  let seats: SeatDraft[] = [{ key: nextKey++, kind: 'you', name: you, skill: 'normal', token: TOKENS[0].id, color: SEAT_COLORS[0] }];
  for (let i = 0; i < humans; i++) seats = addSeat(seats, 'human');
  for (let i = 0; i < bots; i++) seats = addSeat(seats, 'bot');
  return seats;
}

export const toLocalSeats = (seats: SeatDraft[]): LocalSeat[] =>
  seats.map((s) => ({
    name: s.name.trim(),
    token: s.token,
    color: s.color,
    kind: s.kind === 'bot' ? 'bot' : 'human',
    ...(s.kind === 'bot' ? { skill: s.skill } : {}),
  }));
