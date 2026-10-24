import { describe, expect, it } from 'vitest';
import { legalActions, tradeProblems } from '..';
import type { Bundle, GameState, SeatId } from '../types';
import { act, cash, ofType, own, refused, rig, run, scenario, setCash } from './helpers';

const bundle = (b: Partial<Bundle> = {}): Bundle => ({ cash: 0, props: [], cards: [], ...b });

function offer(s: GameState, from: SeatId, to: SeatId, give: Partial<Bundle>, get: Partial<Bundle>) {
  const r = act(s, from, { k: 'propose', to, give: bundle(give), get: bundle(get) });
  return { state: r.state, id: Object.keys(r.state.trades).find((id) => r.state.trades[id]?.from === from) as string };
}

describe('trades', () => {
  it('swaps cash, property and cards on accept', () => {
    const s = scenario();
    own(s, 's0', [1]);
    own(s, 's1', [3]);
    s.decks.chance = s.decks.chance.filter((id) => id !== 'ch-goojf');
    s.players.s1!.goojf = ['ch-goojf'];
    const o = offer(s, 's0', 's1', { cash: 100, props: [1] }, { props: [3], cards: ['ch-goojf'] });
    expect(legalActions(o.state, 's1')).toEqual(expect.arrayContaining([{ k: 'accept', id: o.id }, { k: 'reject', id: o.id }]));
    expect(legalActions(o.state, 's0')).toContainEqual({ k: 'cancel', id: o.id });
    const { state, events } = act(o.state, 's1', { k: 'accept', id: o.id });
    expect(state.props.p1?.owner).toBe('s1');
    expect(state.props.p3?.owner).toBe('s0');
    expect(state.players.s0?.goojf).toEqual(['ch-goojf']);
    expect([cash(state, 's0'), cash(state, 's1')]).toEqual([1400, 1600]);
    expect(ofType(events, 'tradeDone')).toHaveLength(1);
    expect(state.trades).toEqual({});
  });

  it('refuses property in a group with buildings, loans, empty, self and negative offers', () => {
    const s = scenario();
    own(s, 's0', [37, 39], { level: 1 });
    own(s, 's0', [5]);
    const p = (give: Partial<Bundle>, get: Partial<Bundle>, to: SeatId = 's1') =>
      refused(s, 's0', { k: 'propose', to, give: bundle(give), get: bundle(get) });
    expect(p({ props: [37] }, { cash: 50 })).toBe('buildings');
    expect(p({ cash: 50 }, {})).toBe('loan');
    expect(p({}, { cash: 50 })).toBe('loan');
    expect(p({ cash: 50 }, { cash: 60 })).toBe('loan');
    expect(p({}, {})).toBe('empty');
    expect(p({ props: [5] }, {}, 's0')).toBe('self');
    expect(p({ cash: -5, props: [5] }, {})).toBe('badBundle');
    expect(p({ props: [3] }, {})).toBe('notOwner');
    expect(p({ cash: 5000, props: [5] }, {})).toBe('cash');
    // Property for nothing is a gift, not a loan.
    expect(act(s, 's0', { k: 'propose', to: 's1', give: bundle({ props: [5] }), get: bundle() }).state.trades).not.toEqual({});
  });

  it('re-checks at accept time', () => {
    const s = scenario();
    own(s, 's0', [5]);
    const o = offer(s, 's0', 's1', { props: [5] }, { cash: 100 });
    setCash(o.state, 's1', 50);
    expect(refused(o.state, 's1', { k: 'accept', id: o.id })).toBe('cash');
    o.state.props.p5!.owner = 's1';
    expect(refused(o.state, 's1', { k: 'accept', id: o.id })).toBe('notOwner');
  });

  it('one open offer per proposer; only the right party may answer; cleared at the end of the turn', () => {
    const s = scenario({ n: 3 });
    own(s, 's0', [5, 15]);
    const o = offer(s, 's0', 's1', { props: [5] }, { cash: 10 });
    expect(refused(o.state, 's0', { k: 'propose', to: 's2', give: bundle({ props: [15] }), get: bundle({ cash: 1 }) })).toBe('tradeOpen');
    expect(refused(o.state, 's2', { k: 'accept', id: o.id })).toBe('notYours');
    expect(refused(o.state, 's1', { k: 'cancel', id: o.id })).toBe('notYours');
    expect(refused(o.state, 's0', { k: 'reject', id: o.id })).toBe('notYours');
    expect(ofType(act(o.state, 's1', { k: 'reject', id: o.id }).events, 'tradeRejected')).toHaveLength(1);
    expect(ofType(act(o.state, 's0', { k: 'cancel', id: o.id }).events, 'tradeCancelled')[0]?.why).toBe('cancelled');
    rig(o.state, [4, 6]);
    const ended = run(o.state, ['s0', { k: 'roll' }], ['s0', { k: 'endTurn' }]);
    expect(ended.state.trades).toEqual({});
    expect(ofType(ended.events, 'tradeCancelled')[0]?.why).toBe('turnEnd');
  });

  it('a debtor may sell property to pay, and the debt settles by itself', () => {
    const s = scenario();
    own(s, 's0', [39]);
    own(s, 's1', [5, 15, 25, 35]);
    setCash(s, 's0', 100);
    s.players.s0!.pos = 31;
    rig(s, [1, 3]);
    const debt = act(s, 's0', { k: 'roll' }).state;
    expect(debt.phase).toMatchObject({ k: 'debt', owed: { s1: 200 } });
    const o = offer(debt, 's0', 's1', { props: [39] }, { cash: 300 });
    const { state } = act(o.state, 's1', { k: 'accept', id: o.id });
    expect(state.phase.k).toBe('postRoll');
    expect(cash(state, 's0')).toBe(200);
  });

  it('cannot be accepted during an auction', () => {
    const s = scenario();
    own(s, 's1', [5]);
    rig(s, [2, 4]);
    const auction = run(s, ['s0', { k: 'roll' }], ['s0', { k: 'decline' }]).state;
    const o = offer(auction, 's1', 's0', { props: [5] }, { cash: 10 });
    expect(refused(o.state, 's0', { k: 'accept', id: o.id })).toBe('phase');
  });

  it('refuses a trade whose receiver could not pay the 10% on mortgaged property from cash', () => {
    const s = scenario();
    own(s, 's1', [39], { mortgaged: true });
    setCash(s, 's0', 25);
    const problems = tradeProblems(s, { from: 's0', to: 's1', give: bundle({ cash: 10 }), get: bundle({ props: [39] }) });
    expect(problems.map((p) => p.code)).toEqual(['cantAffordInterest']);
  });
});
