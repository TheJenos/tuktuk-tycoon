import type { Bundle, SeatId, Trade } from '../../../rules';
import { money } from '../format';

/*
 * Pure helpers for the open-offers list: every open offer is public, the ones involving my seats first.
 */

/** How an offer stands to this client: to answer, mine to cancel, or between two other players (read-only) */
export type OfferRole = 'incoming' | 'outgoing' | 'other';

export function offerRole(t: Pick<Trade, 'from' | 'to'>, mine: readonly SeatId[]): OfferRole {
  if (mine.includes(t.to)) return 'incoming';
  if (mine.includes(t.from)) return 'outgoing';
  return 'other';
}

const RANK: Record<OfferRole, number> = { incoming: 0, outgoing: 1, other: 2 };

/** All open offers: incoming ones first, then mine, then everyone else's, each in the order they were made */
export function openOffers(trades: Readonly<Record<string, Trade>>, mine: readonly SeatId[]): Trade[] {
  return Object.values(trades)
    .map((t, i) => ({ t, i, r: RANK[offerRole(t, mine)] }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.t);
}

/** One item of an offer's terms: plain text (cash, cards, "nothing") or a property, drawn as a chip */
export type TermPart = { k: 'text'; text: string } | { k: 'prop'; space: number };

/** A bundle as list items, in bundleText's order: cash, the properties, the Get Out of Jail Free cards */
export function bundleParts(b: Bundle): TermPart[] {
  const parts: TermPart[] = [];
  if (b.cash > 0) parts.push({ k: 'text', text: money(b.cash) });
  for (const space of b.props) parts.push({ k: 'prop', space });
  if (b.cards.length === 1) parts.push({ k: 'text', text: 'a Get Out of Jail Free card' });
  else if (b.cards.length > 1) parts.push({ k: 'text', text: `${b.cards.length} Get Out of Jail Free cards` });
  return parts.length ? parts : [{ k: 'text', text: 'nothing' }];
}

/** The separator before item `i` of `n` in "a, b and c" */
export function listSep(i: number, n: number): string {
  if (i === 0) return '';
  return i === n - 1 ? ' and ' : ', ';
}
