import { placeSites, type Action, type AuctionPhase } from '../rules';
import { type BotCtx, stableNoise } from './ctx';
import { blocksSet, completesSet, propAt, streetAt } from './model';
import { propertyWorth } from './turn';

/*
 * Timed open bidding. Each bot has a private limit for the lot (stable for the whole auction, see stableNoise). It
 * bids only while it is not the high bidder and the high bid is below its limit, in small steps, and passes once
 * the price reaches its limit. The high bidder is not awaited, so a bot never bids against itself.
 */

/** The most the bot will pay for the lot (whole rupees, never more than its cash) */
export function auctionLimit(c: BotCtx, ph: AuctionPhase): number {
  const cash = c.me.cash;
  const lot = ph.lot;
  if (lot.k !== 'prop') {
    // A building unit from a shortage contest: worth about a house, more to a bot that plays the shortage
    const sites = placeSites(c.s, c.seat, lot.k);
    const sp = sites.length ? streetAt(c.m, sites[0] as number) : undefined;
    if (!sp) return 0;
    const unit = lot.k === 'hotel' ? (sp.hotel ?? sp.house) : sp.house;
    const mul = c.prof.skill === 'easy' ? 0.6 + 0.6 * stableNoise(c.s, c.seat, 99) : c.prof.holdAtFour ? 1.6 : 1.1;
    return Math.floor(Math.min(unit * mul, cash - c.reserve / 2));
  }
  const space = lot.space;
  const p = propAt(c.m, space);
  if (!p) return 0;
  const complete = completesSet(c.m, c.seat, space);
  const block = blocksSet(c.m, c.seat, space);
  let limit: number;
  let keep = c.reserve / 2;
  switch (c.prof.skill) {
    case 'easy':
      limit = p.price * (0.6 + 0.4 * stableNoise(c.s, c.seat, space));
      keep = 0;
      break;
    case 'normal':
      limit = p.price * (complete ? 1.5 : block ? 1.2 : 1);
      if (complete) keep = 0;
      break;
    default: {
      const worth = propertyWorth(c, space);
      limit = Math.min(worth, p.price * c.prof.auctionCap * (complete || block ? 1 : 0.75));
      if (complete) keep = 0;
      break;
    }
  }
  return Math.floor(Math.min(limit, cash - keep));
}

export function auctionChoice(c: BotCtx, ph: AuctionPhase): Action {
  const limit = auctionLimit(c, ph);
  const high = ph.high?.amount ?? 0;
  const min = high + 1;
  if (limit < min || c.me.cash < min) return { k: 'pass' };
  const price = ph.lot.k === 'prop' ? (propAt(c.m, ph.lot.space)?.price ?? 100) : 150;
  const p = c.prof;
  const step = Math.max(p.stepMin, Math.min(p.stepMax, Math.round(price * p.stepShare)));
  // Open well below the limit so a lot nobody else wants goes cheap
  const open = c.prof.skill === 'easy' ? Math.round(price * (0.2 + 0.3 * c.rnd())) : Math.round(limit * 0.4);
  const want = ph.high ? high + step : Math.max(1, open);
  return { k: 'bid', amount: Math.max(min, Math.min(want, limit)) };
}
