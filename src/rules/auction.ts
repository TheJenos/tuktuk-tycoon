import { type Ctx, emit, err, isActive, player, propBidders, setPhase } from './ctx';
import { boardMoney } from './currency';
import { type Handler, isInt, seatAction, systemAction } from './handler';
import { maxRaise, pay, transfer } from './money';
import type { AuctionPhase, BoardDef, GameState, Lot, Phase, RuleError, SeatId } from './types';

/*
 * Timed open bidding. Any eligible seat that has not passed may bid at any time, more than the high bid and no more
 * than its cash; a pass is final. The engine has no clock: the driver sends closeAuction when the deadline (see
 * timer()) passes. Every bid restarts the countdown (the net layer gives at least AUCTION_BID_SECS after a bid); with
 * cfg.fixedAuctionCountdown it runs from the moment the lot is put up and bids never add time. It closes by itself
 * once everyone but the high bidder has passed.
 */

export function startAuction(c: Ctx, lot: Lot, eligible: SeatId[], resume: Phase, queue: number[] = []): void {
  const ph: AuctionPhase = { k: 'auction', lot, eligible: [...eligible], passed: [], queue, resume };
  setPhase(c, ph);
  emit(c, { t: 'auctionStart', lot, eligible: [...eligible], queue: [...queue] });
  autoPass(c, ph);
}

/** Pass for every seat that could not beat the high bid even after selling and mortgaging everything */
function autoPass(c: Ctx, ph: AuctionPhase): void {
  const floor = ph.high?.amount ?? 0;
  for (const seat of ph.eligible) {
    if (ph.passed.includes(seat) || seat === ph.high?.seat) continue;
    if (maxRaise(c.s, c.b, seat) <= floor) {
      ph.passed.push(seat);
      emit(c, { t: 'pass', seat, auto: true });
    }
  }
}

/** Seats that may still bid */
export const bidders = (s: GameState, ph: AuctionPhase): SeatId[] =>
  ph.eligible.filter((seat) => !ph.passed.includes(seat) && seat !== ph.high?.seat && isActive(s, seat));

/** Everyone but the high bidder has passed (or left) */
export const auctionDone = (s: GameState, ph: AuctionPhase): boolean => bidders(s, ph).length === 0;

/** The lowest legal bid right now */
export const minBid = (ph: AuctionPhase): number => (ph.high?.amount ?? 0) + 1;

/**
 * Ends the current auction: the high bidder pays and takes the lot; with no bids the bank keeps it (a building unit
 * goes to nobody). A winner whose cash fell below the bid meanwhile (a nested settlement) owes it as a debt.
 */
export function closeAuction(c: Ctx): void {
  const ph = c.s.phase;
  if (ph.k !== 'auction') return;
  const win = ph.high && isActive(c.s, ph.high.seat) ? ph.high : undefined;
  emit(c, { t: 'auctionEnd', lot: ph.lot, ...(win ? { winner: win.seat, amount: win.amount } : {}) });
  const space = ph.lot.k === 'prop' ? ph.lot.space : undefined;
  const short = !!win && player(c.s, win.seat).cash < win.amount;
  if (win && !short) transfer(c, win.seat, 'bank', win.amount, 'auction', space);

  if (ph.lot.k === 'prop') {
    if (win) {
      c.s.props[`p${ph.lot.space}`] = { owner: win.seat, level: 0 };
      emit(c, { t: 'owner', space: ph.lot.space, to: win.seat, via: 'auction' });
    }
    const [next, ...rest] = ph.queue;
    if (next !== undefined) startAuction(c, { k: 'prop', space: next }, propBidders(c.s), ph.resume, rest);
    else setPhase(c, ph.resume);
  } else {
    // A building unit from a shortage contest: the winner places it next, then the contest goes on.
    const claim = ph.resume.k === 'buildClaim' ? ph.resume : undefined;
    if (!win) {
      if (claim) claim.stop = true;
      setPhase(c, ph.resume);
      return;
    }
    if (claim) claim.req[win.seat] = Math.max(0, (claim.req[win.seat] ?? 0) - 1);
    setPhase(c, { k: 'place', seat: win.seat, kind: ph.lot.k, count: 1, bid: win.amount, resume: ph.resume });
    emit(c, { t: 'placeStart', seat: win.seat, kind: ph.lot.k, count: 1 });
  }
  if (win && short) pay(c, win.seat, { bank: win.amount }, 'auction', space);
}

export function checkBid(s: GameState, seat: SeatId, amount: unknown): RuleError | null {
  const ph = s.phase;
  if (ph.k !== 'auction') return err('phase', 'There is no auction');
  if (!ph.eligible.includes(seat)) return err('notBidder', 'You are not in this auction');
  if (ph.passed.includes(seat)) return err('passed', 'You have passed');
  if (ph.high?.seat === seat) return err('highBidder', 'You already hold the high bid');
  if (!isInt(amount) || amount < minBid(ph)) return err('low', `Bid at least ${boardMoney(s.cfg.board, minBid(ph))}`);
  if (amount > player(s, seat).cash) return err('cash', 'You cannot bid more than your cash');
  return null;
}

export const bid: Handler<'bid'> = seatAction(
  (s, _b, seat, a) => checkBid(s, seat, a.amount),
  (c, seat, a) => {
    const ph = c.s.phase;
    if (ph.k !== 'auction') return;
    ph.high = { seat, amount: a.amount };
    emit(c, { t: 'bid', seat, amount: a.amount });
    // Re-entering restarts the deadline: every bid gives the others a fresh countdown. A fixed countdown runs on from
    // when the lot was put up.
    if (!c.s.cfg.fixedAuctionCountdown) setPhase(c, ph);
    autoPass(c, ph);
  },
);

export function checkPassAuction(s: GameState, seat: SeatId): RuleError | null {
  const ph = s.phase;
  if (ph.k !== 'auction') return err('phase', 'There is no auction');
  if (!bidders(s, ph).includes(seat)) {
    if (ph.high?.seat === seat) return err('highBidder', 'The high bidder cannot pass');
    return err('notBidder', 'You are not bidding');
  }
  return null;
}

export function passAuction(c: Ctx, seat: SeatId): void {
  const ph = c.s.phase;
  if (ph.k !== 'auction') return;
  ph.passed.push(seat);
  emit(c, { t: 'pass', seat });
}

export const closeAuctionAction: Handler<'closeAuction'> = systemAction(
  (s: GameState, _b: BoardDef) => (s.phase.k === 'auction' ? null : err('phase', 'There is no auction')),
  (c) => closeAuction(c),
);
