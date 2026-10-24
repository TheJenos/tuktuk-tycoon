import { bidders } from './auction';
import { getBoard, isProperty } from './board';
import { placeSites } from './buildings';
import { isActive, player, prop } from './ctx';
import { worth } from './money';
import type { Action, Command, GameState, SeatId, TimerInfo } from './types';

/*
 * Who the game waits for, what a safe move for them is, and how a network layer times them out. The engine has no
 * clock: the net layer keeps one deadline per timer().key and, once it passes, applies timeoutCommand().
 */

/** Seats whose input blocks progress (in an open auction: every seat that may still bid) */
export function awaiting(s: GameState): SeatId[] {
  const ph = s.phase;
  switch (ph.k) {
    case 'over':
    case 'busy':
      return [];
    case 'auction':
      return bidders(s, ph);
    case 'buildClaim':
      return ph.open.filter((seat) => isActive(s, seat));
    case 'place':
    case 'mortgageXfer':
      return [ph.seat];
    case 'debt':
      return [ph.debtor];
    default:
      return [s.turn.seat];
  }
}

/** The next bank-owned property ahead, for a triple's free move; else GO (or Free Parking when already on GO) */
function defaultSpace(s: GameState, seat: SeatId): number {
  const b = getBoard(s.cfg.board);
  const n = b.spaces.length;
  const pos = player(s, seat).pos;
  for (let i = 1; i < n; i++) {
    const space = (pos + i) % n;
    if (isProperty(b.spaces[space]) && !prop(s, space)) return space;
  }
  return pos === 0 ? b.spaces.findIndex((sp) => sp.k === 'parking') : 0;
}

/**
 * A safe move for an awaited seat (timeouts, AFK fallback): roll, the bigger Bus move, decline to buy (the property
 * is auctioned), the cheaper tax, pass, keep received mortgages, raise cash automatically, end the turn.
 */
export function defaultAction(s: GameState, seat: SeatId): Action | null {
  if (!awaiting(s).includes(seat)) return null;
  const ph = s.phase;
  switch (ph.k) {
    case 'preRoll':
      return { k: 'roll' };
    case 'bus':
      return { k: 'bus', n: Math.max(...ph.opts) };
    case 'chooseSpace':
      return { k: 'chooseSpace', space: defaultSpace(s, seat) };
    case 'buy':
      return { k: 'decline' };
    case 'incomeTax': {
      if (s.cfg.incomeTaxMode !== 'choice') return { k: 'incomeTax', pick: s.cfg.incomeTaxMode };
      const pct = Math.floor((worth(s, getBoard(s.cfg.board), seat) * s.cfg.incomePct) / 100);
      return { k: 'incomeTax', pick: pct < s.cfg.incomeFlat ? 'percent' : 'flat' };
    }
    case 'postRoll':
      return { k: 'endTurn' };
    case 'auction':
    case 'buildClaim':
      return { k: 'pass' };
    case 'place': {
      const site = placeSites(s, getBoard(s.cfg.board), seat, ph.kind, ph.bid === undefined)[0];
      return site === undefined ? null : { k: 'place', space: site };
    }
    case 'mortgageXfer':
      return { k: 'settleMortgages', lift: [] };
    case 'debt':
      return { k: 'autoRaise' };
    default:
      return null;
  }
}

const TIMER_KIND: Record<string, TimerInfo['kind']> = {
  preRoll: 'turn',
  postRoll: 'turn',
  bus: 'decision',
  chooseSpace: 'decision',
  buy: 'decision',
  incomeTax: 'decision',
  place: 'decision',
  buildClaim: 'decision',
  mortgageXfer: 'decision',
  auction: 'auction',
  debt: 'debt',
};

/**
 * The deadline the net layer should run now. The key changes exactly when the deadline should restart: whenever a
 * phase is entered, and on every auction bid (not when someone else mortgages or trades meanwhile).
 */
export function timer(s: GameState): TimerInfo | null {
  const kind = TIMER_KIND[s.phase.k];
  return kind ? { key: `${s.phase.k}:${s.since}`, kind } : null;
}

/**
 * What to apply once the deadline passes: close the auction or the contest window, or play the awaited seat's
 * defaultAction as a `forced` system command. Always carries basis = seq, so a stale timeout is refused.
 */
export function timeoutCommand(s: GameState): Command | null {
  const ph = s.phase;
  if (ph.k === 'over' || ph.k === 'busy') return null;
  if (ph.k === 'auction') return { by: 'system', a: { k: 'closeAuction' }, basis: s.seq };
  if (ph.k === 'buildClaim') return { by: 'system', a: { k: 'closeClaim' }, basis: s.seq };
  const seat = awaiting(s)[0];
  const a = seat === undefined ? null : defaultAction(s, seat);
  return seat === undefined || !a ? null : { by: 'system', a: { k: 'forced', seat, a }, basis: s.seq };
}
