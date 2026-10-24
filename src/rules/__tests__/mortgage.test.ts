import { describe, expect, it } from 'vitest';
import { awaiting, canMortgage, defaultAction, timer, unmortgageCost, xferCost } from '..';
import type { GameState } from '../types';
import { act, cash, ofType, own, refused, scenario, setCash } from './helpers';

/** s1 sells s0 Power Cut Board (mortgaged) and Galle Face Penthouse (mortgaged) for Rs. 10 */
function received(): GameState {
  const s = scenario();
  own(s, 's1', [12, 39], { mortgaged: true });
  const offer = act(s, 's1', {
    k: 'propose',
    to: 's0',
    give: { cash: 0, props: [12, 39], cards: [] },
    get: { cash: 10, props: [], cards: [] },
  }).state;
  return act(offer, 's0', { k: 'accept', id: Object.keys(offer.trades)[0] as string }).state;
}

describe('mortgages', () => {
  it('only unimproved groups can be mortgaged; it pays the mortgage value', () => {
    const s = scenario();
    own(s, 's0', [37, 39], { level: 1 });
    own(s, 's0', [5]);
    expect(refused(s, 's0', { k: 'mortgage', space: 37 })).toBe('buildings');
    expect(canMortgage(s, 's0', 39)?.code).toBe('buildings');
    expect(refused(s, 's1', { k: 'mortgage', space: 5 })).toBe('notOwner');
    const { state, events } = act(s, 's0', { k: 'mortgage', space: 5 });
    expect(cash(state, 's0')).toBe(1600);
    expect(ofType(events, 'mortgage')).toEqual([{ t: 'mortgage', space: 5, on: true }]);
    expect(refused(state, 's0', { k: 'mortgage', space: 5 })).toBe('mortgaged');
  });

  it('lifting costs the mortgage + 10% rounded up', () => {
    const s = scenario();
    own(s, 's0', [12, 37], { mortgaged: true });
    expect(unmortgageCost(s, 12)).toBe(83);
    expect(unmortgageCost(s, 37)).toBe(193);
    const { state } = act(s, 's0', { k: 'unmortgage', space: 12 });
    expect(cash(state, 's0')).toBe(1500 - 83);
    expect(state.props.p12?.mortgaged).toBeUndefined();
    setCash(state, 's0', 100);
    expect(refused(state, 's0', { k: 'unmortgage', space: 37 })).toBe('cash');
  });

  it('a new owner of mortgaged property chooses: lift now, or pay 10% now and keep it', () => {
    const s = received();
    expect(s.phase).toMatchObject({ k: 'mortgageXfer', seat: 's0', spaces: [12, 39], resume: { k: 'preRoll' } });
    expect(awaiting(s)).toEqual(['s0']);
    expect(timer(s)?.kind).toBe('decision');
    expect(defaultAction(s, 's0')).toEqual({ k: 'settleMortgages', lift: [] });
    expect(xferCost(s, [12, 39], [39])).toBe(8 + 20 + 200);
    expect(refused(s, 's1', { k: 'settleMortgages', lift: [] })).toBe('notYou');
    expect(refused(s, 's0', { k: 'settleMortgages', lift: [5] })).toBe('badLift');

    const { state, events } = act(s, 's0', { k: 'settleMortgages', lift: [39] });
    expect(state.phase.k).toBe('preRoll');
    expect(state.props.p39?.mortgaged).toBeUndefined();
    expect(state.props.p12?.mortgaged).toBe(true);
    expect(cash(state, 's0')).toBe(1500 - 10 - 220 - 8);
    expect(ofType(events, 'mortgage')).toEqual([{ t: 'mortgage', space: 39, on: false }]);
    // Kept mortgages cost the full mortgage + 10% again when lifted later.
    expect(unmortgageCost(state, 12)).toBe(83);
  });

  it('refuses a lift the new owner cannot afford', () => {
    const s = received();
    setCash(s, 's0', 100);
    expect(refused(s, 's0', { k: 'settleMortgages', lift: [39] })).toBe('cash');
    expect(cash(act(s, 's0', { k: 'settleMortgages', lift: [] }).state, 's0')).toBe(100 - 8 - 20);
  });
});
