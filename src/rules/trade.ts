import { propertyAt, siblings } from './board';
import { type Ctx, emit, err, interest, isActive, isSeat, levelOf, player, prop, setPhase, tradingClosed } from './ctx';
import { boardMoney } from './currency';
import { ACCEPT_PHASES, type Handler, isInt, seatAction } from './handler';
import { transfer } from './money';
import type { BoardDef, Bundle, GameState, Phase, RuleError, SeatId, Trade } from './types';

/*
 * Private deals: cash, unimproved property (no buildings anywhere in its group) and Get Out of Jail Free cards.
 * Offers are checked again when accepted and at most one is open per proposer. They never expire: an offer stays
 * open until it is accepted, rejected or cancelled, or one of its parties leaves the game. No loans: cash for
 * nothing, nothing for cash and cash for cash are refused.
 */

export const MAX_TRADES = 8;

export const isEmptyBundle = (bd: Bundle): boolean => bd.cash === 0 && bd.props.length === 0 && bd.cards.length === 0;
const cashOnly = (bd: Bundle): boolean => bd.cash > 0 && bd.props.length === 0 && bd.cards.length === 0;

/** A well-formed bundle (commands come from the network) */
export function isBundle(x: unknown): x is Bundle {
  if (typeof x !== 'object' || x === null) return false;
  const bd = x as Record<string, unknown>;
  return (
    isInt(bd.cash) &&
    bd.cash >= 0 &&
    Array.isArray(bd.props) &&
    bd.props.every(isInt) &&
    new Set(bd.props).size === bd.props.length &&
    Array.isArray(bd.cards) &&
    bd.cards.every((id) => typeof id === 'string') &&
    new Set(bd.cards).size === bd.cards.length
  );
}

function bundleProblems(s: GameState, b: BoardDef, seat: SeatId, bd: Bundle): RuleError[] {
  const out: RuleError[] = [];
  const p = player(s, seat);
  if (bd.cash > p.cash) out.push(err('cash', `${p.name} does not have ${boardMoney(b, bd.cash)}`));
  for (const space of bd.props) {
    const sp = propertyAt(b, space);
    if (!sp) out.push(err('badSpace', `Space ${space} is not a property`));
    else if (prop(s, space)?.owner !== seat) out.push(err('notOwner', `${p.name} does not own ${sp.name}`));
    else if (siblings(b, space).some((x) => levelOf(s, x) > 0)) {
      out.push(err('buildings', `Sell the buildings in ${sp.name}'s group first`));
    }
  }
  for (const id of bd.cards) if (!p.goojf.includes(id)) out.push(err('noCard', `${p.name} does not hold that card`));
  return out;
}

/** Interest a seat owes on the mortgaged properties it would receive */
const interestOn = (s: GameState, b: BoardDef, spaces: number[]): number =>
  spaces
    .filter((space) => prop(s, space)?.mortgaged)
    .reduce((a, space) => a + interest(s, propertyAt(b, space)?.mortgage ?? 0), 0);

/** Everything wrong with a trade right now (empty = it can be accepted) */
export function tradeProblems(s: GameState, b: BoardDef, t: Omit<Trade, 'id'>): RuleError[] {
  if (!isSeat(s, t.from) || !isSeat(s, t.to) || !isActive(s, t.from) || !isActive(s, t.to)) {
    return [err('badParty', 'Both players must still be in the game')];
  }
  if (t.from === t.to) return [err('self', 'You cannot trade with yourself')];
  const closed = tradingClosed(s, t.from, t.to);
  if (closed) return [closed];
  if (!isBundle(t.give) || !isBundle(t.get)) return [err('badBundle', 'Malformed offer')];
  const out = [...bundleProblems(s, b, t.from, t.give), ...bundleProblems(s, b, t.to, t.get)];
  if (isEmptyBundle(t.give) && isEmptyBundle(t.get)) out.push(err('empty', 'The offer is empty'));
  else if ((cashOnly(t.give) && isEmptyBundle(t.get)) || (cashOnly(t.get) && isEmptyBundle(t.give))) {
    out.push(err('loan', 'Cash for nothing is a loan; only the bank lends'));
  } else if (cashOnly(t.give) && cashOnly(t.get)) out.push(err('loan', 'Cash for cash is not a trade'));
  // Mortgaged property costs its new owner 10% at once; that must come out of cash, never open a debt.
  const fromAfter = player(s, t.from).cash - t.give.cash + t.get.cash;
  const toAfter = player(s, t.to).cash - t.get.cash + t.give.cash;
  if (out.length === 0 && fromAfter < interestOn(s, b, t.get.props)) {
    out.push(err('cantAffordInterest', 'Not enough cash left to pay the interest on the mortgaged property'));
  }
  if (out.length === 0 && toAfter < interestOn(s, b, t.give.props)) {
    out.push(err('cantAffordInterest', 'Not enough cash left to pay the interest on the mortgaged property'));
  }
  return out;
}

export const openTradeOf = (s: GameState, seat: SeatId): Trade | undefined =>
  Object.values(s.trades).find((t) => t.from === seat);

const copyBundle = (bd: Bundle): Bundle => ({ cash: bd.cash, props: [...bd.props], cards: [...bd.cards] });

export const propose: Handler<'propose'> = seatAction(
  (s, b, seat, a) => {
    if (openTradeOf(s, seat)) return err('tradeOpen', 'You already have an open offer');
    if (Object.keys(s.trades).length >= MAX_TRADES) return err('tooMany', 'Too many open offers');
    if (!isSeat(s, a.to)) return err('badParty', 'No such player');
    return tradeProblems(s, b, { from: seat, to: a.to, give: a.give, get: a.get })[0] ?? null;
  },
  (c, seat, a) => {
    const id = `t${c.s.seq}`;
    const trade: Trade = { id, from: seat, to: a.to, give: copyBundle(a.give), get: copyBundle(a.get) };
    c.s.trades[id] = trade;
    emit(c, { t: 'tradeProposed', trade: structuredClone(trade) });
  },
);

function moveBundle(c: Ctx, from: SeatId, to: SeatId, bd: Bundle): number[] {
  transfer(c, from, to, bd.cash, 'trade');
  for (const space of bd.props) {
    const ps = prop(c.s, space);
    if (!ps) continue;
    ps.owner = to;
    emit(c, { t: 'owner', space, from, to, via: 'trade' });
  }
  for (const id of bd.cards) {
    const giver = player(c.s, from);
    giver.goojf = giver.goojf.filter((x) => x !== id);
    player(c.s, to).goojf.push(id);
    emit(c, { t: 'cardGive', cardId: id, from, to });
  }
  return bd.props.filter((space) => prop(c.s, space)?.mortgaged);
}

export const accept: Handler<'accept'> = seatAction(
  (s, b, seat, a) => {
    const t = typeof a.id === 'string' ? s.trades[a.id] : undefined;
    if (!t) return err('noTrade', 'That offer is gone');
    if (t.to !== seat) return err('notYours', 'The offer is not to you');
    if (!ACCEPT_PHASES.has(s.phase.k)) return err('phase', 'Offers can be accepted before or after a roll, or in debt');
    return tradeProblems(s, b, t)[0] ?? null;
  },
  (c, _seat, a) => {
    const t = c.s.trades[a.id];
    if (!t) return;
    delete c.s.trades[a.id];
    const toFrom = moveBundle(c, t.from, t.to, t.give);
    const toProposer = moveBundle(c, t.to, t.from, t.get);
    emit(c, { t: 'tradeDone', trade: structuredClone(t) });
    // Each side that received mortgaged property settles it (proposer first), then play resumes.
    let next: Phase = c.s.phase;
    if (toFrom.length) next = { k: 'mortgageXfer', seat: t.to, spaces: toFrom.sort((x, y) => x - y), resume: next };
    if (toProposer.length) {
      next = { k: 'mortgageXfer', seat: t.from, spaces: toProposer.sort((x, y) => x - y), resume: next };
    }
    if (next !== c.s.phase) {
      setPhase(c, next);
      if (toProposer.length) emit(c, { t: 'xferStart', seat: t.from, spaces: toProposer });
      if (toFrom.length) emit(c, { t: 'xferStart', seat: t.to, spaces: toFrom });
    }
  },
);

export const reject: Handler<'reject'> = seatAction(
  (s, _b, seat, a) => {
    const t = typeof a.id === 'string' ? s.trades[a.id] : undefined;
    if (!t) return err('noTrade', 'That offer is gone');
    return t.to === seat ? null : err('notYours', 'The offer is not to you');
  },
  (c, _seat, a) => {
    delete c.s.trades[a.id];
    emit(c, { t: 'tradeRejected', id: a.id });
  },
);

export const cancel: Handler<'cancel'> = seatAction(
  (s, _b, seat, a) => {
    const t = typeof a.id === 'string' ? s.trades[a.id] : undefined;
    if (!t) return err('noTrade', 'That offer is gone');
    return t.from === seat ? null : err('notYours', 'Only the proposer can cancel');
  },
  (c, _seat, a) => {
    delete c.s.trades[a.id];
    emit(c, { t: 'tradeCancelled', id: a.id, why: 'cancelled' });
  },
);

/** Drops the offers made by or to a seat that is out of the game */
export function clearTrades(c: Ctx, seat: SeatId): void {
  for (const t of Object.values(c.s.trades)) {
    if (t.from !== seat && t.to !== seat) continue;
    delete c.s.trades[t.id];
    emit(c, { t: 'tradeCancelled', id: t.id, why: 'out' });
  }
}
