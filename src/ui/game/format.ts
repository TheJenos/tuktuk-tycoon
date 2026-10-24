import type { Doc } from '../../net/types';
import { formatMoney, getBoard, isProperty, type Action, type BoardDef, type Bundle, type Creditor, type Deck, type GameState, type Level, type Lot, type SeatId } from '../../rules';

/*
 * Plain-English pieces shared by the HUD, the log and the screen-reader announcements: money, names, levels,
 * bundles and actions. Pure (no React, no DOM), so formatEvent and the selectors can be unit-tested.
 */

/**
 * Engine units as shown rupees: 1500 -> "Rs. 150,000"; negative amounts read "−Rs. 35,000" (a real minus sign). The
 * engine counts rulebook units; the UI shows them x MONEY_SCALE (see rules/currency.ts).
 */
export const money = (n: number): string => formatMoney(n);

/** "+Rs. 20,000" / "−Rs. 5,000" / "Rs. 0", for changes */
export const signedMoney = (n: number): string => formatMoney(n, { signed: true });

/** How the UI names seats and spaces */
export interface Names {
  board: BoardDef;
  seat(seat: SeatId): string;
  space(i: number): string;
}

/**
 * Names from the room's seats (what players chose in the lobby), falling back to the engine's player names and
 * then to the seat id, so a half-loaded doc still reads sensibly.
 */
export function makeNames(game: GameState | null, doc?: Pick<Doc, 'seats'> | null, board?: BoardDef): Names {
  const b = board ?? getBoard(game?.cfg.board ?? 'lanka');
  return {
    board: b,
    seat: (seat) => doc?.seats[seat]?.name || game?.players[seat]?.name || seat,
    space: (i) => b.spaces[i]?.name ?? `space ${i}`,
  };
}

export const partyName = (names: Names, c: Creditor): string => (c === 'bank' ? 'the bank' : names.seat(c));

/** The printed name of the board's start corner ("Start") */
export const startName = (b: BoardDef): string => b.spaces[0]?.name ?? 'Start';

/** The printed name of a tax space ("Inland Revenue" for the income tax) */
export function taxName(b: BoardDef, tax: 'income' | 'luxury'): string {
  const sp = b.spaces.find((x) => x.k === 'tax' && x.tax === tax);
  return sp?.name ?? (tax === 'income' ? 'Income tax' : 'Luxury tax');
}

/** A card deck's printed name (from the board data) */
export const deckName = (b: BoardDef, d: Deck): string => b.display.decks[d];

/** "2 houses", "a hotel", "no buildings" */
export function levelText(l: Level | number): string {
  if (l <= 0) return 'no buildings';
  if (l >= 5) return 'a hotel';
  return l === 1 ? '1 house' : `${l} houses`;
}

/** "Ann", "Ann and Bob", "Ann, Bob and Cat" */
export function listText(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** "Rs. 10,000, Galle Face Penthouse and a Get Out of Jail Free card", or "nothing" */
export function bundleText(names: Names, b: Bundle): string {
  const parts: string[] = [];
  if (b.cash > 0) parts.push(money(b.cash));
  for (const space of b.props) parts.push(names.space(space));
  if (b.cards.length === 1) parts.push('a Get Out of Jail Free card');
  else if (b.cards.length > 1) parts.push(`${b.cards.length} Get Out of Jail Free cards`);
  return parts.length ? listText(parts) : 'nothing';
}

/** What an action does, as a verb phrase after a name ("Ann declines to buy") */
export function actionText(names: Names, a: Action): string {
  switch (a.k) {
    case 'roll': return 'rolls';
    case 'bus': return `takes the bus ${plural(a.n, 'space')}`;
    case 'chooseSpace': return `moves to ${names.space(a.space)}`;
    case 'buy': return 'buys';
    case 'decline': return 'declines to buy';
    case 'incomeTax': return a.pick === 'flat' ? `pays the flat ${taxName(names.board, 'income')}` : `pays the percentage ${taxName(names.board, 'income')}`;
    case 'payFine': return 'pays the jail fine';
    case 'useCard': return 'uses a Get Out of Jail Free card';
    case 'endTurn': return 'ends the turn';
    case 'bid': return `bids ${money(a.amount)}`;
    case 'pass': return 'passes';
    case 'requestBuild': return `asks for ${a.n}`;
    case 'place': return `places a building on ${names.space(a.space)}`;
    case 'settleMortgages': return a.lift.length ? 'lifts received mortgages' : 'keeps the received mortgages';
    case 'autoRaise': return 'raises cash automatically';
    case 'bankrupt': return 'declares bankruptcy';
    case 'resign': return 'resigns';
    default: return a.k;
  }
}

/** "Galle Face Penthouse", "a house", "a hotel" */
export function lotText(names: Names, lot: Lot): string {
  return lot.k === 'prop' ? names.space(lot.space) : lot.k === 'house' ? 'a house' : 'a hotel';
}

/** The printed price of a property space (0 for others) */
export function priceOf(board: BoardDef, i: number): number {
  const sp = board.spaces[i];
  return isProperty(sp) ? sp.price : 0;
}

/** A space the player could own (streets, railroads, utilities) */
export const ownable = (board: BoardDef, i: number): boolean => isProperty(board.spaces[i]);

/** The generic last word of a space's name, and how it reads when it has to stay */
const SUFFIXES: Record<string, string> = { Station: 'Stn', Board: 'Bd', Gardens: 'Gdns', Street: 'St', Lane: 'Ln', Road: 'Rd' };
/** The usual short forms of long words on the board; any other long word is cut with a period */
const ABBREVIATIONS: Record<string, string> = {
  Bambalapitiya: 'Bamba.',
  Colombo: 'Col.',
};

/** A long word cut to fit `max` with a period, ending on a consonant as abbreviations do ("Peradeniya" -> "Peraden.") */
function cutWord(w: string, max: number): string {
  let n = max - 1;
  while (n > 3 && /[aeiouy]/i.test(w[n - 1] ?? '')) n--;
  return `${w.slice(0, n)}.`;
}

/**
 * A space's name for a small cell (the MiniBoard), every word at most `max` letters so none is cut off mid-word:
 * the generic last word dropped ("Maradana Lane" -> "Maradana"), a long word shortened ("Peradeniya Gardens" ->
 * "Peraden."), and the dropped word put back short when a well-known abbreviation would otherwise read the same
 * for two spaces.
 */
export function shortSpaceName(name: string, max = 9): string {
  const words = name.trim().split(/\s+/);
  const last = words.at(-1) ?? '';
  const suffix = words.length > 1 ? SUFFIXES[last] : undefined;
  const head = suffix ? words.slice(0, -1) : words;
  let known = false;
  const short = head.map((w) => {
    if (w.length <= max) return w;
    const abbr = ABBREVIATIONS[w];
    if (abbr && abbr.length <= max) {
      known = abbr.length <= 5;
      return abbr;
    }
    return cutWord(w, max);
  });
  if (known && suffix && short.length === 1) short.push(suffix);
  return short.join(' ');
}
