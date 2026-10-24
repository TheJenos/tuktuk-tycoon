import { tradeProblems, type Action, type Bundle, type SeatId, type Trade } from '../rules';
import { type BotCtx, makeCtx } from './ctx';
import {
  CARD_VALUE,
  type GroupInfo,
  type Model,
  afterTrade,
  cashOf,
  groupBuilt,
  ownedBy,
  ownsGroup,
  propAt,
  value,
} from './model';
import { PROFILES } from './profile';

/*
 * Trades. Incoming offers are judged by the valuation: the bot's gain must reach its skill's share of what it gives
 * up, and (Normal and up) beat the rival's gain weighted by how zero-sum the table is; Hard never hands anyone a set
 * unless it gains more itself.
 *
 * Proposals (Normal: set-for-set swaps, evened out with cash; Hard: also lone property and cash sweeteners; Expert:
 * the same kinds of deal priced against Normal's and Hard's own acceptance rules, made only when its rollouts say
 * the deal beats no deal, see pricedOffers and search.ts) never block play: the bot rolls on while the receiver
 * thinks, and all offers are cleared when the turn ends. decide() is pure, so there is no memory of rejected offers.
 * Instead, from the state alone:
 * - at most one proposal per turn: only at the very start of the bot's own turn, before its first throw and before
 *   anything else happened in it (no turn.roll, state.seq === state.since); a rejection moves seq on, so it can
 *   never be followed by another proposal that turn (only a preRoll re-entered before the throw, e.g. after an
 *   accepted trade handed over mortgages, allows one more, and then the holdings have changed);
 * - only offers clearly favourable to the receiver by a typical receiver's own valuation (Expert: that the bots'
 *   rules accept), so rejections are rare;
 * - only every `tradeEvery`-th round, alternating a standard and a more generous margin, so an offer that was
 *   turned down comes back improved, and the same offer recurs at most every 2 x tradeEvery rounds, and only while
 *   it is still the bot's best.
 */

const bundleCards = (bd: Bundle): number => bd.cards.length * CARD_VALUE;

/** Printed value of a bundle: what a side gives up, for the "gain of at least x%" rules */
function faceValue(m: Model, bd: Bundle): number {
  return bd.cash + bd.props.reduce((a, x) => a + (propAt(m, x)?.price ?? 0), 0) + bundleCards(bd);
}

interface Judged {
  /** Gain of `seat` from the trade */
  mine: number;
  /** Gain of the other side */
  theirs: number;
  /** The trade completes a colour set for the other side */
  handsSet: boolean;
}

/** Some set `seat` owns whole in `after` but not in `before` */
const newSet = (before: Model, after: Model, seat: SeatId): boolean =>
  after.info.groups.some((g) => ownsGroup(after, seat, g) && !ownsGroup(before, seat, g));

/** Gains for both sides of `from` giving `give` to `to` for `get`, valued with `seat`'s profile */
function judge(c: BotCtx, from: SeatId, to: SeatId, give: Bundle, get: Bundle, seat: SeatId): Judged {
  const m = c.m;
  const other = seat === from ? to : from;
  const after = afterTrade(m, from, to, give, get);
  const cards = (s: SeatId): number => (s === from ? bundleCards(get) - bundleCards(give) : bundleCards(give) - bundleCards(get));
  return {
    mine: value(after, seat, c.prof) - value(m, seat, c.prof) + cards(seat),
    theirs: value(after, other, c.prof) - value(m, other, c.prof) + cards(other),
    handsSet: newSet(m, after, other),
  };
}

/** How the bot scores a deal for itself: its gain less the rival's, weighted by how zero-sum the table is */
function dealScore(c: BotCtx, j: Judged): number {
  // Hard never hands anyone a set unless it gains more itself, however many players are left
  const share = c.prof.rivalWeight >= 1 && j.handsSet ? 1 : c.rivalShare;
  return j.mine - c.prof.rivalWeight * share * Math.max(0, j.theirs);
}

/** What an offer made to the bot gains it, by its own valuation */
export const offerGain = (c: BotCtx, t: Trade): number => judge(c, t.from, t.to, t.give, t.get, c.seat).mine;

/** The bot's answer to an offer made to it (the caller holds an accept until accepting is allowed) */
export function respond(c: BotCtx, t: Trade): 'accept' | 'reject' {
  const j = judge(c, t.from, t.to, t.give, t.get, c.seat);
  const gives = faceValue(c.m, t.get);
  if (j.mine < c.prof.acceptGain * Math.max(50, gives)) return 'reject';
  return dealScore(c, j) > 0 ? 'accept' : 'reject';
}

/** The receiver's view of its own gain, by Normal's standards (a typical receiver) */
function receiverView(c: BotCtx, to: SeatId, give: Bundle, get: Bundle): Judged {
  const view: BotCtx = { ...c, prof: { ...PROFILES.normal, weighted: c.prof.weighted } };
  return judge(view, c.seat, to, give, get, to);
}

/** How much of the proposer's gain a typical receiver tolerates (it wants a clear gain of its own) */
const tolerance = (c: BotCtx): number => 0.25 * c.rivalShare;

/**
 * How much more cash a typical receiver would want before saying yes (0 = it would accept): a gain of at least
 * `margin` of what it gives up, and not much less than the proposer's gain.
 */
function receiverShortfall(c: BotCtx, to: SeatId, give: Bundle, get: Bundle, margin: number): number {
  const j = receiverView(c, to, give, get);
  const k = tolerance(c);
  const gain = margin * Math.max(50, faceValue(c.m, get)) - j.mine;
  // Each extra rupee raises the receiver's gain and lowers the proposer's
  const balance = (k * Math.max(0, j.theirs) - j.mine) / (1 + k);
  return Math.max(0, gain, balance);
}

/** How much cash the receiver could add on its side and still say yes (negative: none) */
function receiverSurplus(c: BotCtx, to: SeatId, give: Bundle, get: Bundle, margin: number): number {
  const j = receiverView(c, to, give, get);
  const k = tolerance(c);
  // A rupee asked for lowers the receiver's gain and adds to what it gives up
  const gain = (j.mine - margin * Math.max(50, faceValue(c.m, get))) / (1 + margin);
  const balance = (j.mine - k * Math.max(0, j.theirs)) / (1 + k);
  return Math.min(gain, balance);
}

const empty = (): Bundle => ({ cash: 0, props: [], cards: [] });

/** The streets of `g` the seat lacks, when one rival holds them all and nothing in the group is built */
function missingFromOne(m: Model, seat: SeatId, g: GroupInfo): { from: SeatId; props: number[] } | null {
  if (groupBuilt(m, g)) return null;
  const missing = g.spaces.filter((x) => m.owner[x] !== seat);
  if (missing.length === 0 || missing.length > 2 || missing.length === g.spaces.length) return null;
  const from = m.owner[missing[0] as number];
  if (!from || from === seat || !missing.every((x) => m.owner[x] === from)) return null;
  return { from, props: missing };
}

/** Property the bot may give away: not part of a set it owns or nearly owns, in an unbuilt group */
function spareProps(c: BotCtx, exclude: Set<number>): number[] {
  const m = c.m;
  return ownedBy(m, c.seat).filter((x) => {
    if (exclude.has(x)) return false;
    const g = m.info.groupAt[x];
    if (!g) return true;
    if (groupBuilt(m, g) || ownsGroup(m, c.seat, g)) return false;
    return g.spaces.filter((y) => m.owner[y] === c.seat).length < g.spaces.length - 1;
  });
}

interface Offer {
  to: SeatId;
  give: Bundle;
  get: Bundle;
  score: number;
}

function withCash(give: Bundle, cash: number): Bundle {
  return { ...give, cash, props: [...give.props], cards: [...give.cards] };
}

/** The smallest cash sweetener (rounded to Rs. 25) that makes the receiver say yes, within what the bot can spare */
function sweeten(c: BotCtx, to: SeatId, give: Bundle, get: Bundle, maxCash: number, margin: number): Bundle | null {
  let cash = give.cash;
  for (let tries = 0; tries < 6 && cash <= maxCash; tries++) {
    const g = withCash(give, cash);
    const short = receiverShortfall(c, to, g, get, margin);
    if (short <= 0) return g;
    cash += Math.max(25, Math.ceil(short / 25) * 25);
  }
  return null;
}

/** The bot's best offer now, if one is worth making */
export function bestOffer(c: BotCtx, margin = 0.15): Offer | null {
  const m = c.m;
  const style = c.prof.propose;
  if (style === 'never') return null;
  const spareCash = Math.max(0, cashOf(m, c.seat) - c.reserve - (style === 'swap' ? 200 : 100));
  const maxCash = style === 'swap' ? Math.min(150, spareCash) : spareCash;
  let best: Offer | null = null;
  const consider = (to: SeatId, give: Bundle, get: Bundle): void => {
    const sweet = sweeten(c, to, give, get, maxCash, margin);
    if (!sweet) return;
    const options: Bundle[] = [get];
    if (sweet.cash === 0) {
      // The deal already pleases the receiver: ask for cash on top to even it out
      const room = receiverSurplus(c, to, sweet, get, margin);
      for (const share of [0.5, 0.9]) {
        const ask = Math.min(cashOf(m, to), Math.floor((room * share) / 25) * 25);
        if (ask >= 25) options.push(withCash(get, ask));
      }
    }
    for (const ask of options) {
      if (ask !== get && receiverShortfall(c, to, sweet, ask, margin) > 0) continue;
      if (tradeProblems(c.s, { from: c.seat, to, give: sweet, get: ask }).length > 0) continue;
      const j = judge(c, c.seat, to, sweet, ask, c.seat);
      const score = dealScore(c, j);
      if (j.mine > 50 && score > 25 && (!best || score > best.score)) best = { to, give: sweet, get: ask, score };
    }
  };

  for (const g of m.info.groups) {
    const want = missingFromOne(m, c.seat, g);
    if (!want) continue;
    const get: Bundle = { ...empty(), props: want.props };
    // A swap that completes a set for the receiver too
    for (const g2 of m.info.groups) {
      if (g2.id === g.id) continue;
      const theirs = missingFromOne(m, want.from, g2);
      if (!theirs || theirs.from !== c.seat) continue;
      consider(want.from, { ...empty(), props: theirs.props }, get);
    }
    if (style !== 'full') continue;
    // Lone property, then cash alone
    const spare = spareProps(c, new Set(want.props));
    for (const x of spare.slice(0, 4)) consider(want.from, { ...empty(), props: [x] }, get);
    consider(want.from, empty(), get);
  }
  return best;
}

/**
 * Whether the bot may propose now, and if so whether this is a generous round: every other proposal round the offer
 * is more generous, so a rejected offer comes back improved
 */
export function proposalRound(c: BotCtx): { generous: boolean } | null {
  const s = c.s;
  if (c.prof.propose === 'never' || s.phase.k !== 'preRoll' || s.turn.seat !== c.seat) return null;
  if (s.turn.roll || s.seq !== s.since) return null;
  if (Object.values(s.trades).some((t) => t.from === c.seat) || Object.keys(s.trades).length >= 8) return null;
  const round = Math.floor((s.turn.no - 1) / Math.max(1, c.m.active.length));
  if (round % c.prof.tradeEvery !== 0) return null;
  return { generous: Math.floor(round / c.prof.tradeEvery) % 2 === 1 };
}

export function proposal(c: BotCtx): Action | null {
  const round = proposalRound(c);
  const offer = round ? bestOffer(c, round.generous ? 0.35 : 0.15) : null;
  return offer ? { k: 'propose', to: offer.to, give: offer.give, get: offer.get } : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Expert: offers priced against the bots' own acceptance rules (whether they are worth it is for the rollouts)

export interface Proposal {
  to: SeatId;
  give: Bundle;
  get: Bundle;
}

/** Cash steps the price searches work in */
const CASH_STEP = 10;

/** Accepts `give` for `get` from `from` by every one of these receivers' standards */
function allAccept(views: BotCtx[], from: SeatId, to: SeatId, give: Bundle, get: Bundle): boolean {
  const t: Trade = { id: '?', from, to, give, get };
  return views.every((v) => respond(v, t) === 'accept');
}

/**
 * The cheapest cash on the bot's side (to Rs. 10) that every receiver view accepts, or null when even `maxCash` is not
 * enough. Acceptance only grows with the cash offered, so a bisection finds it.
 */
function leastCash(c: BotCtx, views: BotCtx[], to: SeatId, give: Bundle, get: Bundle, maxCash: number): Bundle | null {
  const ok = (cash: number): boolean => allAccept(views, c.seat, to, withCash(give, cash), get);
  if (ok(0)) return withCash(give, 0);
  let hi = Math.floor(maxCash / CASH_STEP);
  if (hi < 1 || !ok(hi * CASH_STEP)) return null;
  let lo = 0;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ok(mid * CASH_STEP)) hi = mid;
    else lo = mid;
  }
  return withCash(give, hi * CASH_STEP);
}

/** The most cash (to Rs. 10) the receiver could add to `get` and still accept, by every view (0: none) */
function mostAsk(c: BotCtx, views: BotCtx[], to: SeatId, give: Bundle, get: Bundle): number {
  const ok = (cash: number): boolean => allAccept(views, c.seat, to, give, withCash(get, cash));
  let lo = 0;
  let hi = Math.floor(cashOf(c.m, to) / CASH_STEP) + 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ok(mid * CASH_STEP)) lo = mid;
    else hi = mid;
  }
  return lo * CASH_STEP;
}

/**
 * Expert's candidate offers: the missing streets of a set, held by one rival, for cash, a lone property and cash,
 * or a swap that completes a set for the rival too, each at the price that Normal's and Hard's own rules accept (and
 * Easy's too in a generous round). Best by the bot's own valuation first, at most `max`.
 */
export function pricedOffers(c: BotCtx, generous: boolean, max: number): Proposal[] {
  const m = c.m;
  const maxCash = Math.max(0, cashOf(m, c.seat) - 50);
  const out: (Proposal & { mine: number })[] = [];
  const viewsOf = new Map<SeatId, BotCtx[]>();
  const views = (to: SeatId): BotCtx[] => {
    let v = viewsOf.get(to);
    if (!v) {
      const profs = generous ? [PROFILES.easy, PROFILES.normal, PROFILES.hard] : [PROFILES.normal, PROFILES.hard];
      v = profs.flatMap((p) => makeCtx(c.s, to, p, c.rnd) ?? []);
      viewsOf.set(to, v);
    }
    return v;
  };
  const consider = (to: SeatId, give: Bundle, get: Bundle): void => {
    const v = views(to);
    const priced = leastCash(c, v, to, give, get, maxCash);
    if (!priced) return;
    let ask = get;
    if (priced.cash === 0 && priced.props.length > 0) {
      const extra = mostAsk(c, v, to, priced, get);
      if (extra > 0) ask = withCash(get, extra);
    }
    if (tradeProblems(c.s, { from: c.seat, to, give: priced, get: ask }).length > 0) return;
    const j = judge(c, c.seat, to, priced, ask, c.seat);
    out.push({ to, give: priced, get: ask, mine: j.mine });
  };

  for (const g of m.info.groups) {
    const want = missingFromOne(m, c.seat, g);
    if (!want) continue;
    const get: Bundle = { ...empty(), props: want.props };
    consider(want.from, empty(), get);
    for (const x of spareProps(c, new Set(want.props)).slice(0, 3)) consider(want.from, { ...empty(), props: [x] }, get);
    for (const g2 of m.info.groups) {
      if (g2.id === g.id) continue;
      const theirs = missingFromOne(m, want.from, g2);
      if (theirs && theirs.from === c.seat) consider(want.from, { ...empty(), props: theirs.props }, get);
    }
  }
  return out
    .sort((x, y) => y.mine - x.mine)
    .slice(0, max)
    .map(({ to, give, get }) => ({ to, give, get }));
}
