import { describe, expect, it } from 'vitest';
import type { Trade } from '../../../rules';
import { bundleParts, listSep, offerRole, openOffers } from '../trade/offers';

const t = (id: string, from: Trade['from'], to: Trade['to']): Trade => ({ id, from, to, give: { cash: 0, props: [], cards: [] }, get: { cash: 0, props: [], cards: [] } });

describe('offerRole', () => {
  it('tells offers to me, mine and other players’ apart', () => {
    expect(offerRole(t('a', 's1', 's0'), ['s0'])).toBe('incoming');
    expect(offerRole(t('a', 's0', 's1'), ['s0'])).toBe('outgoing');
    expect(offerRole(t('a', 's1', 's2'), ['s0'])).toBe('other');
    // A spectator: every offer is someone else's
    expect(offerRole(t('a', 's0', 's1'), [])).toBe('other');
    // Hot-seat: between two of my seats, the one it is to answers it
    expect(offerRole(t('a', 's0', 's1'), ['s0', 's1'])).toBe('incoming');
  });
});

describe('openOffers', () => {
  it('lists every offer, incoming first, then mine, then the others, each in the order made', () => {
    const trades = { x1: t('x1', 's2', 's3'), x2: t('x2', 's0', 's1'), x3: t('x3', 's3', 's1'), x4: t('x4', 's1', 's0') };
    expect(openOffers(trades, ['s0']).map((x) => x.id)).toEqual(['x4', 'x2', 'x1', 'x3']);
    expect(openOffers(trades, []).map((x) => x.id)).toEqual(['x1', 'x2', 'x3', 'x4']);
    expect(openOffers({}, ['s0'])).toEqual([]);
  });
});

describe('bundleParts', () => {
  it('keeps cash and cards as text and each property as its own part, in bundleText order', () => {
    expect(bundleParts({ cash: 50, props: [1, 3], cards: ['c1'] })).toEqual([
      { k: 'text', text: 'Rs. 5,000' },
      { k: 'prop', space: 1 },
      { k: 'prop', space: 3 },
      { k: 'text', text: 'a Get Out of Jail Free card' },
    ]);
    expect(bundleParts({ cash: 0, props: [], cards: ['c1', 'c2'] })).toEqual([{ k: 'text', text: '2 Get Out of Jail Free cards' }]);
    expect(bundleParts({ cash: 0, props: [], cards: [] })).toEqual([{ k: 'text', text: 'nothing' }]);
  });

  it('joins as "a, b and c"', () => {
    expect([0, 1, 2].map((i) => listSep(i, 3))).toEqual(['', ', ', ' and ']);
    expect([0, 1].map((i) => listSep(i, 2))).toEqual(['', ' and ']);
    expect(listSep(0, 1)).toBe('');
  });
});
