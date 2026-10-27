import { describe, expect, it } from 'vitest';
import { RULES_VERSION, canSellProperty, decode, encode, legalActions, sellPropertyValue } from '..';
import type { GameState } from '../types';
import { act, cash, cashDelta, ofType, own, refused, rig, run, scenario, setCash, setPos } from './helpers';

/*
 * Selling a property back to the bank (sellProperty): the bank pays 80% of the price (less the mortgage value for a
 * mortgaged one: the loan comes out of it), the property becomes the bank's again (unowned, unbuilt, unmortgaged) and
 * anyone may buy it when they land there. Open in the phases mortgaging is, and only with no buildings in the colour group.
 */

describe('sellProperty', () => {
  it('unmortgaged: the bank pays 80% of the price and the property is the bank’s again', () => {
    const s = scenario();
    own(s, 's0', [39]);
    expect(sellPropertyValue(s, 39)).toBe(320);
    expect(canSellProperty(s, 's0', 39)).toBeNull();
    const { state, events } = act(s, 's0', { k: 'sellProperty', space: 39 });
    expect(state.props.p39).toBeUndefined();
    expect(cash(state, 's0')).toBe(1820);
    expect(ofType(events, 'owner')).toEqual([{ t: 'owner', space: 39, from: 's0', via: 'sold' }]);
    expect(ofType(events, 'cash')).toEqual([
      { t: 'cash', from: 'bank', to: 's0', amount: 320, why: 'sale', after: { s0: 1820 }, space: 39 },
    ]);
    expect(ofType(events, 'mortgage')).toEqual([]);
  });

  it('mortgaged: the bank pays 80% of the price less the loan (the owner keeps it) and clears the mortgage', () => {
    const s = scenario();
    own(s, 's0', [5], { mortgaged: true });
    // Colombo Fort Station: 160 (80% of 200) less its 120 mortgage
    expect(sellPropertyValue(s, 5)).toBe(40);
    const { state, events } = act(s, 's0', { k: 'sellProperty', space: 5 });
    expect(state.props.p5).toBeUndefined();
    expect(cashDelta(events, 's0')).toBe(40);
    expect(ofType(events, 'mortgage')).toEqual([{ t: 'mortgage', space: 5, on: false }]);
    expect(ofType(events, 'owner')).toEqual([{ t: 'owner', space: 5, from: 's0', via: 'sold' }]);
  });

  it('refused while any property of the colour group has buildings, and for what the seat does not own', () => {
    const s = scenario();
    own(s, 's0', [37, 39], { level: 1 });
    own(s, 's1', [5]);
    expect(refused(s, 's0', { k: 'sellProperty', space: 37 })).toBe('buildings');
    expect(canSellProperty(s, 's0', 39)?.message).toBe('Sell the buildings in the Dark Blue group first');
    expect(refused(s, 's0', { k: 'sellProperty', space: 5 })).toBe('notOwner');
    expect(refused(s, 's0', { k: 'sellProperty', space: 0 })).toBe('badSpace');
    expect(refused(s, 's0', { k: 'sellProperty', space: 1.5 })).toBe('badSpace');
    // Once the buildings are sold, the deeds can go
    const sold = act(s, 's0', { k: 'sell', group: 'darkBlue', levels: [0, 0] }).state;
    expect(canSellProperty(sold, 's0', 37)).toBeNull();
  });

  it('is listed in legalActions once per sellable space, for any owner, not only the turn seat', () => {
    const s = scenario({ n: 3 });
    own(s, 's1', [5, 12]);
    own(s, 's1', [37, 39], { level: 1 });
    const sales = legalActions(s, 's1').filter((a) => a.k === 'sellProperty');
    expect(sales).toEqual([{ k: 'sellProperty', space: 5 }, { k: 'sellProperty', space: 12 }]);
    expect(cash(act(s, 's1', { k: 'sellProperty', space: 12 }).state, 's1')).toBe(1620);
  });

  it('raises cash in a debt: the debt settles by itself', () => {
    const s = scenario({ n: 3 });
    own(s, 's1', [37, 39]);
    own(s, 's0', [5]);
    setCash(s, 's0', 40);
    setPos(s, 's0', 35);
    rig(s, [1, 3]);
    const debt = act(s, 's0', { k: 'roll' }).state;
    expect(debt.phase).toMatchObject({ k: 'debt', debtor: 's0', owed: { s1: 100 } });
    expect(legalActions(debt, 's0')).toContainEqual({ k: 'sellProperty', space: 5 });
    const { state, events } = act(debt, 's0', { k: 'sellProperty', space: 5 });
    expect(ofType(events, 'debtPaid')).toEqual([{ t: 'debtPaid', debtor: 's0' }]);
    // 40 + 160 for the station - 100 rent
    expect(cash(state, 's0')).toBe(100);
    expect(state.phase.k).toBe('postRoll');
  });

  it('raises cash during an auction, then the seat can bid with it', () => {
    const s = scenario({ n: 3 });
    own(s, 's1', [39]);
    setCash(s, 's1', 10);
    rig(s, [2, 4]);
    let a = run(s, ['s0', { k: 'roll' }], ['s0', { k: 'decline' }]).state;
    expect(refused(a, 's1', { k: 'bid', amount: 50 })).toBe('cash');
    a = act(a, 's1', { k: 'sellProperty', space: 39 }).state;
    a = act(a, 's1', { k: 'bid', amount: 150 }).state;
    expect(a.phase).toMatchObject({ k: 'auction', high: { seat: 's1', amount: 150 } });
  });

  it('is refused outside the raising phases and for property still being settled after a trade', () => {
    const s = scenario({ n: 2 });
    own(s, 's0', [5]);
    own(s, 's1', [15], { mortgaged: true });
    const o = act(s, 's0', { k: 'propose', to: 's1', give: { cash: 0, props: [5], cards: [] }, get: { cash: 0, props: [15], cards: [] } }).state;
    const id = Object.keys(o.trades)[0] as string;
    const x = act(o, 's1', { k: 'accept', id }).state;
    expect(x.phase).toMatchObject({ k: 'mortgageXfer', seat: 's0', spaces: [15] });
    expect(refused(x, 's0', { k: 'sellProperty', space: 15 })).toBe('settling');
    // The settled property can then be sold like any other
    const settled = act(x, 's0', { k: 'settleMortgages', lift: [] }).state;
    expect(canSellProperty(settled, 's0', 15)).toBeNull();
  });

  it('the bank sells it again: the next player to land there may buy it', () => {
    const s = scenario();
    own(s, 's0', [6]);
    const sold = act(s, 's0', { k: 'sellProperty', space: 6 }).state;
    rig(sold, [2, 4]);
    const landed = act(sold, 's0', { k: 'roll' }).state;
    expect(landed.phase).toEqual({ k: 'buy', space: 6 });
  });
});

describe('codec upgrade', () => {
  it('decodes a state of the previous version (same shape) under the current rules; refuses older ones', () => {
    const s: GameState = { ...scenario(), v: 3 };
    expect(decode(encode(s)).v).toBe(RULES_VERSION);
    expect(() => decode(encode({ ...s, v: 2 }))).toThrow(/version/);
  });

  it('carries an older game on only on a board that still has the 40 spaces it was laid out on', () => {
    const lanka: GameState = { ...scenario(), v: 4 };
    expect(decode(encode(lanka)).v).toBe(RULES_VERSION);
    for (const board of ['colombo', 'hill', 'south']) {
      expect(() => decode(encode({ ...lanka, cfg: { ...lanka.cfg, board } }))).toThrow(/changed size/);
      // Made under the current version, the same board decodes as it is
      expect(decode(encode({ ...lanka, v: RULES_VERSION, cfg: { ...lanka.cfg, board } })).cfg.board).toBe(board);
    }
  });
});
