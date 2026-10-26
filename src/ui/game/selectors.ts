import {
  awaiting,
  boardOf,
  maxRaise,
  opponents,
  timer,
  tradingClosed,
  type AuctionPhase,
  type DebtPhase,
  type GameState,
  type Phase,
  type SeatId,
  type TimerInfo,
} from '../../rules';
import type { Doc } from '../../net/types';
import { phaseSecs } from '../../shared/timing';
import { listText, lotText as lotName, money, taxName, type Names } from './format';

/*
 * What the game screen asks of the logical state: which of my seats it waits on, which decision to show, the
 * running deadline, and a one-line description of the phase. Pure.
 */

/** My seats the logical state is waiting for */
export const myAwaited = (s: GameState, mine: readonly SeatId[]): SeatId[] => awaiting(s).filter((seat) => mine.includes(seat));

const active = (s: GameState, seat: SeatId) => !!s.players[seat] && !s.players[seat]?.out;

/** The parking space's printed name ("Tuk-Tuk Stand"), where the jackpot is won */
export const parkingOf = (s: GameState): string => boardOf(s).spaces.find((x) => x.k === 'parking')?.name ?? 'Free Parking';

/**
 * Why `seat` can't trade with anybody right now (the room's trading rule), or null when it can trade with someone.
 * 'off' when the room has trading switched off altogether (the Trade button goes away).
 */
export function tradeLock(s: GameState | null, seat: SeatId | null): { off: boolean; message: string } | null {
  if (!s || !seat) return null;
  if (s.cfg.trading === 'off') return { off: true, message: 'Trading is off in this game' };
  const others = opponents(s, seat);
  const reasons = others.map((x) => tradingClosed(s, seat, x));
  if (!others.length || reasons.some((r) => r === null)) return null;
  return { off: false, message: reasons[0]?.message ?? 'Trading is not open yet' };
}

/**
 * The seat my Manage / Trade actions come from (hot-seat has several): one the game waits on, else the turn seat
 * if it's mine, else my first seat still in. Null for spectators.
 */
export function actingSeat(s: GameState | null, mine: readonly SeatId[]): SeatId | null {
  if (!s) return mine[0] ?? null;
  const live = mine.filter((seat) => active(s, seat));
  return myAwaited(s, live)[0] ?? (live.includes(s.turn.seat) ? s.turn.seat : live[0] ?? null);
}

/** My seats taking part in the auction that have not passed (the high bidder included: it still watches) */
export function myBidders(s: GameState, mine: readonly SeatId[]): SeatId[] {
  const ph = s.phase;
  if (ph.k !== 'auction') return [];
  return ph.eligible.filter((seat) => mine.includes(seat) && !ph.passed.includes(seat) && active(s, seat));
}

const lotKey = (ph: AuctionPhase) => (ph.lot.k === 'prop' ? `p${ph.lot.space}` : ph.lot.k);

/**
 * Identifies the decision the state waits on from my seats, or null when there is none. It stays the same for as
 * long as that decision is open (an auction keeps its key through every bid), so a prompt that is up stays up
 * while other players' moves animate.
 */
export function decisionKey(s: GameState | null, mine: readonly SeatId[]): string | null {
  if (!s) return null;
  const ph = s.phase;
  if (ph.k === 'over') return 'over';
  if (ph.k === 'auction') {
    const seats = myBidders(s, mine);
    return seats.length ? `auction:${lotKey(ph)}:${ph.queue.length}:${seats.join(',')}` : null;
  }
  const seats = myAwaited(s, mine);
  return seats.length ? `${ph.k}:${s.since}:${seats.join(',')}` : null;
}

/**
 * The decision shown now. A new one appears only once the board is idle (the token has landed); one already up
 * stays up while it is still open, even if more animations queue meanwhile.
 */
export const gateDecision = (shown: string | null, key: string | null, idle: boolean): string | null =>
  key === null ? null : idle || shown === key ? key : null;

/**
 * The one local seat the shown decision is for, for hot-seat hand-overs. Null when none is shown, and for
 * decisions several of my seats answer together (an open auction, a building shortage).
 */
export function decisionSeat(s: GameState | null, mine: readonly SeatId[], shown: string | null): SeatId | null {
  if (!s || !shown || s.phase.k === 'auction' || s.phase.k === 'over') return null;
  const seats = myAwaited(s, mine);
  return seats.length === 1 ? (seats[0] ?? null) : null;
}

export interface HandOver {
  /** The last local seat that had a decision */
  last: SeatId | null;
  /** Waiting for this seat's player to take the device */
  pass: SeatId | null;
}

/**
 * The hand-over once `actor`'s decision is up: a different local seat than the last one asks for the device to be
 * passed (when the cards are on); the same one, or nobody, changes nothing. Returns `h` itself when nothing
 * changes.
 */
export function handOver(h: HandOver, actor: SeatId | null, cards: boolean): HandOver {
  if (!actor || actor === h.last) return h;
  return { last: actor, pass: cards && h.last ? actor : null };
}

export interface Deadline {
  /** Server ms */
  at: number;
  /** Seconds the phase allows (for the timer ring's full circle) */
  total: number;
  kind: TimerInfo['kind'];
}

/** The running deadline, when it belongs to the current phase and that phase is timed */
export function activeDeadline(doc: Doc | null): Deadline | null {
  if (!doc?.deadline) return null;
  const t = timer(doc.game);
  if (!t || t.key !== doc.deadline.key) return null;
  const total = phaseSecs(t.kind, doc.timers);
  return total > 0 ? { at: doc.deadline.at, total, kind: t.kind } : null;
}

/** The Speed Die is in play for this seat's next roll (never for a roll out of jail: white dice only) */
export const speedActive = (s: GameState, seat: SeatId): boolean => s.cfg.speedDie && !!s.players[seat]?.speed && !s.players[seat]?.jail;

/** One line saying what the game waits for, from my point of view */
export function phaseLabel(s: GameState, names: Names, mine: readonly SeatId[]): string {
  const ph = s.phase;
  const who = (seat: SeatId) => (mine.includes(seat) ? (mine.length > 1 ? `${names.seat(seat)} (you)` : 'You') : names.seat(seat));
  const turn = who(s.turn.seat);
  const yours = mine.includes(s.turn.seat);
  switch (ph.k) {
    case 'preRoll':
      if (s.players[s.turn.seat]?.jail) return yours ? `${turn}: in jail. Roll for doubles, pay or use a card` : `${turn} is in jail`;
      return yours ? `${turn}: roll the dice` : `${turn} to roll`;
    case 'postRoll': return yours ? `${turn}: manage, trade or end the turn` : `${turn} may manage or trade before ending the turn`;
    case 'bus': return yours ? `${turn}: choose a bus move` : `${turn} chooses a bus move`;
    case 'chooseSpace': return yours ? `${turn}: triples! Pick any space` : `${turn} rolled triples and picks a space`;
    case 'buy': return yours ? `${turn}: buy ${names.space(ph.space)} or auction it` : `${turn} decides on ${names.space(ph.space)}`;
    case 'incomeTax': return yours ? `${turn}: choose how to pay ${taxName(names.board, 'income')}` : `${turn} chooses how to pay ${taxName(names.board, 'income')}`;
    case 'auction': {
      const high = ph.high ? `${money(ph.high.amount)} by ${names.seat(ph.high.seat)}` : 'no bids yet';
      return `Auction for ${lotName(names, ph.lot)}: ${high}`;
    }
    case 'place': return mine.includes(ph.seat) ? `${who(ph.seat)}: place the ${ph.kind}` : `${who(ph.seat)} places a ${ph.kind}`;
    case 'buildClaim': {
      const open = ph.open.filter((seat) => active(s, seat));
      return `Building shortage: waiting for ${listText(open.map(who)) || 'the bank'}`;
    }
    case 'mortgageXfer': return `${who(ph.seat)} ${who(ph.seat) === 'You' ? 'settle' : 'settles'} received mortgages`;
    case 'debt': {
      const total = Object.values(ph.owed).reduce<number>((a, n) => a + (n ?? 0), 0);
      return `${who(ph.debtor)} must raise cash to pay ${money(total)}`;
    }
    case 'over': return `${names.seat(ph.winner)} wins the game`;
    case 'busy': return '';
  }
}

/** Spaces where the turn seat would land with each Bus option */
export function busTargets(s: GameState, seat: SeatId, opts: readonly number[]): number[] {
  const n = boardOf(s).spaces.length;
  const pos = s.players[seat]?.pos ?? 0;
  return opts.map((o) => (pos + o) % n);
}

/** The total a seat owes in its debt phase */
export function debtTotal(s: GameState): number {
  return s.phase.k === 'debt' ? Object.values(s.phase.owed).reduce<number>((a, n) => a + (n ?? 0), 0) : 0;
}

/** The seat's debt, if it is in one (the debt may be waiting under another phase) */
export function debtOf(s: GameState, seat: SeatId): DebtPhase | null {
  for (let p: Phase | undefined = s.phase; p; p = 'resume' in p ? p.resume : undefined) {
    if (p.k === 'debt' && p.debtor === seat) return p;
  }
  return null;
}

/**
 * The resign confirmation. Resigning in a debt that selling and mortgaging everything can't cover is a bankruptcy
 * to the creditor (docs/rules.md, Resigning): everything is sold to the bank and the creditors get the cash (each
 * at most what it is owed); no property passes to them.
 */
export function resignQuestion(s: GameState, seat: SeatId, names: Names, many: boolean): string {
  const ask = `Resign${many ? ` ${names.seat(seat)}` : ''}?`;
  const debt = debtOf(s, seat);
  if (!debt) return `${ask} Your property goes back to the bank.`;
  const owed = Object.entries(debt.owed).filter(([c, n]) => (n ?? 0) > 0 && (c === 'bank' || !s.players[c as SeatId]?.out));
  const total = owed.reduce((a, [, n]) => a + (n ?? 0), 0);
  const players = owed.map(([c]) => c).filter((c): c is SeatId => c !== 'bank');
  if (!players.length || maxRaise(s, seat) >= total) return `${ask} Your debt is paid first, then your property goes back to the bank.`;
  if (players.length === 1 && owed.length === 1) {
    return `${ask} You can't pay ${names.seat(players[0]!)}: everything you own is sold to the bank and they get the cash.`;
  }
  return `${ask} You can't pay in full: everything you own is sold to the bank and the cash goes to ${listText(players.map(names.seat))}.`;
}
