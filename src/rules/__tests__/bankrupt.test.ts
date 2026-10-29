import { describe, expect, it } from 'vitest';
import { awaiting, legalActions, maxRaise } from '..';
import type { GameState } from '../types';
import { act, cash, ofType, own, refused, rig, run, scenario, setCash, setPos, stack } from './helpers';

/** s0 lands on s1's Galle Face Penthouse with a hotel (Rs. 2000) holding little */
function hotelDebt(n = 3): GameState {
  const s = scenario({ n });
  own(s, 's1', [37, 39], { level: 5 });
  setCash(s, 's0', 100);
  own(s, 's0', [1, 3], { level: 1 });
  own(s, 's0', [12], { mortgaged: true });
  s.decks.chest = s.decks.chest.filter((id) => id !== 'cc-goojf');
  s.players.s0!.goojf = ['cc-goojf'];
  setPos(s, 's0', 35);
  rig(s, [1, 3]);
  return act(s, 's0', { k: 'roll' }).state;
}

/** s0 draws School Tax (Rs. 150) owing the bank, mid-doubles, with only mortgaged property */
function bankDebt(): GameState {
  const s = scenario({ n: 3 });
  setCash(s, 's0', 10);
  own(s, 's0', [1, 3, 5], { mortgaged: true });
  s.decks.chance = s.decks.chance.filter((id) => id !== 'ch-goojf');
  s.players.s0!.goojf = ['ch-goojf'];
  setPos(s, 's0', 15);
  stack(s, 'chest', 'cc-school');
  rig(s, [1, 1]);
  return act(s, 's0', { k: 'roll' }).state;
}

describe('bankruptcy', () => {
  it('only when even selling everything back to the bank would not cover the debt', () => {
    const s = scenario();
    own(s, 's1', [39], { level: 1 });
    own(s, 's1', [37], { level: 1 });
    setCash(s, 's0', 40);
    own(s, 's0', [5]);
    setPos(s, 's0', 35);
    rig(s, [1, 3]);
    const debt = act(s, 's0', { k: 'roll' }).state;
    // Exactly the 200 rent: cash 40 + the station's sale value 160 (80% of 200)
    expect(maxRaise(debt, 's0')).toBe(200);
    expect(refused(debt, 's0', { k: 'bankrupt' })).toBe('canPay');
    expect(legalActions(debt, 's0')).not.toContainEqual({ k: 'bankrupt' });
    expect(refused(debt, 's1', { k: 'autoRaise' })).toBe('noDebt');
  });

  it('to a player: everything is sold to the bank and the creditor gets the cash; no property or card passes to it', () => {
    const s = hotelDebt();
    expect(s.phase).toMatchObject({ k: 'debt', debtor: 's0', owed: { s1: 2000 } });
    expect(maxRaise(s, 's0')).toBe(100 + 25 + 25 + 48 + 48 + 30);
    const { state, events } = act(s, 's0', { k: 'bankrupt' });
    expect(state.players.s0).toMatchObject({ out: 'bankrupt', cash: 0, goojf: [] });
    // cash 100 + two houses at half price 50 + the browns' sale values 96 (80% of 60 each) + the mortgaged utility's
    // 30 (80% of 150, less its 90 loan)
    expect(cash(state, 's1')).toBe(1500 + 100 + 50 + 96 + 30);
    expect([1, 3, 12].map((x) => state.props[`p${x}`])).toEqual([undefined, undefined, undefined]);
    expect(state.bank.houses).toBe(32);
    expect(state.players.s1?.goojf).toEqual([]);
    expect(state.decks.chest.at(-1)).toBe('cc-goojf');
    expect(ofType(events, 'cardReturn')).toEqual([{ t: 'cardReturn', deck: 'chest', cardId: 'cc-goojf', seat: 's0' }]);
    expect(ofType(events, 'bankrupt')).toEqual([{ t: 'bankrupt', seat: 's0', to: 's1', resigned: false }]);
    expect(ofType(events, 'owner')).toEqual([
      { t: 'owner', space: 1, from: 's0', via: 'bankrupt' },
      { t: 'owner', space: 3, from: 's0', via: 'bankrupt' },
      { t: 'owner', space: 12, from: 's0', via: 'bankrupt' },
    ]);
    // The whole proceeds reach the creditor as the debt's payment (rent), in one transfer
    expect(ofType(events, 'cash').filter((e) => e.to === 's1')).toEqual([
      { t: 'cash', from: 's0', to: 's1', amount: 276, why: 'rent', after: { s0: 0, s1: 1776 }, space: 39 },
    ]);
    // No mortgages change hands, so nothing to settle: the next seat plays
    expect(ofType(events, 'xferStart')).toEqual([]);
    expect(state.turn).toMatchObject({ seat: 's1', no: 2 });
    expect(state.phase.k).toBe('preRoll');
    expect(awaiting(state)).toEqual(['s1']);
  });

  it('to the bank, mid-doubles: everything goes back, mortgages cleared, auctioned one by one, then the next turn', () => {
    const s = bankDebt();
    expect(s.phase).toMatchObject({ k: 'debt', debtor: 's0', owed: { bank: 150 } });
    expect(s.turn.again).toBe(true);
    const { state, events } = act(s, 's0', { k: 'bankrupt' });
    expect(state.phase).toMatchObject({ k: 'auction', lot: { k: 'prop', space: 1 }, queue: [3, 5], eligible: ['s1', 's2'], resume: { k: 'busy' } });
    expect(state.pending).toEqual([{ k: 'nextTurn' }]);
    expect(state.props).toEqual({});
    expect(state.decks.chance.at(-1)).toBe('ch-goojf');
    expect(ofType(events, 'mortgage').map((e) => e.space)).toEqual([1, 3, 5]);
    expect(ofType(events, 'cash').find((e) => e.why === 'bankrupt')).toMatchObject({ from: 's0', to: 'bank', amount: 10 });

    let t = run(state, ['s1', { k: 'bid', amount: 42 }], ['s2', { k: 'pass' }]).state;
    expect(t.props.p1).toEqual({ owner: 's1', level: 0 });
    expect(t.phase).toMatchObject({ k: 'auction', lot: { k: 'prop', space: 3 }, queue: [5] });
    t = run(t, ['s1', { k: 'pass' }], ['s2', { k: 'pass' }]).state;
    expect(t.props.p3).toBeUndefined();
    t = act(t, 'system', { k: 'closeAuction' }, t.seq).state;
    expect(t.phase.k).toBe('preRoll');
    expect(t.turn).toMatchObject({ seat: 's1', no: 2, doubles: 0 });
  });

  it('several creditors are paid in seat order as far as the cash goes, each at most its share', () => {
    const s = scenario({ n: 3 });
    setCash(s, 's0', 30);
    setPos(s, 's0', 4);
    stack(s, 'chance', 'ch-chairman');
    rig(s, [1, 2]);
    const debt = act(s, 's0', { k: 'roll' }).state;
    expect(debt.phase).toMatchObject({ k: 'debt', owed: { s1: 50, s2: 50 } });
    const { state } = act(debt, 's0', { k: 'bankrupt' });
    expect([cash(state, 's1'), cash(state, 's2')]).toEqual([1530, 1500]);
    expect(state.turn.seat).toBe('s1');
  });

  it('the last player left wins', () => {
    const s = hotelDebt(2);
    const { state, events } = act(s, 's0', { k: 'bankrupt' });
    expect(state.phase).toEqual({ k: 'over', winner: 's1', ranking: ['s1', 's0'], why: 'lastStanding' });
    expect(ofType(events, 'over')).toHaveLength(1);
    expect(refused(state, 's1', { k: 'roll' })).toBe('over');
    expect(awaiting(state)).toEqual([]);
  });

  it('autoRaise sells buildings evenly, highest first, then mortgages cheapest first, then pays', () => {
    const s = scenario();
    setCash(s, 's0', 0);
    own(s, 's0', [1, 3], { level: 2 });
    own(s, 's0', [5, 12]);
    setPos(s, 's0', 14);
    stack(s, 'chest', 'cc-school');
    rig(s, [1, 2]);
    const debt = act(s, 's0', { k: 'roll' }).state;
    const { state, events } = act(debt, 's0', { k: 'autoRaise' });
    expect(ofType(events, 'level').map((e) => [e.space, e.to])).toEqual([
      [3, 1],
      [1, 1],
      [3, 0],
      [1, 0],
    ]);
    // 4 houses bring 100, then the browns' mortgages 36 each: 172 - 150
    expect(ofType(events, 'mortgage').map((e) => e.space)).toEqual([1, 3]);
    expect(cash(state, 's0')).toBe(22);
    expect(state.phase.k).toBe('postRoll');
  });

  it('autoRaise, with nothing left to mortgage, sells mortgaged property back to the bank, cheapest first', () => {
    const s = scenario();
    setCash(s, 's0', 10);
    own(s, 's0', [1, 3], { mortgaged: true });
    own(s, 's0', [5]);
    setPos(s, 's0', 14);
    stack(s, 'chest', 'cc-school');
    rig(s, [1, 2]);
    const debt = act(s, 's0', { k: 'roll' }).state;
    expect(debt.phase).toMatchObject({ k: 'debt', debtor: 's0', owed: { bank: 150 } });
    const { state, events } = act(debt, 's0', { k: 'autoRaise' });
    // The station is mortgaged first (120: 130), then the browns go back to the bank for 12 each (48 less 36)
    expect(ofType(events, 'mortgage')).toEqual([
      { t: 'mortgage', space: 5, on: true },
      { t: 'mortgage', space: 1, on: false },
      { t: 'mortgage', space: 3, on: false },
    ]);
    expect(ofType(events, 'owner')).toEqual([
      { t: 'owner', space: 1, from: 's0', via: 'sold' },
      { t: 'owner', space: 3, from: 's0', via: 'sold' },
    ]);
    expect(ofType(events, 'cash').filter((e) => e.why === 'sale').map((e) => [e.space, e.amount])).toEqual([
      [1, 12],
      [3, 12],
    ]);
    expect(state.props).toEqual({ p5: { owner: 's0', level: 0, mortgaged: true } });
    expect(cash(state, 's0')).toBe(10 + 120 + 12 + 12 - 150);
    expect(state.phase.k).toBe('postRoll');
  });

  it('autoRaise goes bankrupt when the debt cannot be covered', () => {
    const { state } = act(hotelDebt(), 's0', { k: 'autoRaise' });
    expect(state.players.s0?.out).toBe('bankrupt');
  });
});

describe('resigning', () => {
  it('outside a debt: everything goes to the bank and is auctioned', () => {
    const s = scenario({ n: 3 });
    own(s, 's1', [6, 8]);
    s.phase = { k: 'postRoll' };
    const { state, events } = act(s, 's1', { k: 'resign' });
    expect(ofType(events, 'bankrupt')).toEqual([{ t: 'bankrupt', seat: 's1', to: 'bank', resigned: true }]);
    expect(state.players.s1?.out).toBe('resigned');
    expect(state.phase).toMatchObject({ k: 'auction', lot: { k: 'prop', space: 6 }, queue: [8], resume: { k: 'postRoll' } });
  });

  it('the turn player resigning ends the turn; in a 2-player game the other wins', () => {
    const s = scenario({ n: 3 });
    expect(act(s, 's0', { k: 'resign' }).state.turn).toMatchObject({ seat: 's1', no: 2 });
    expect(act(scenario(), 's0', { k: 'resign' }).state.phase).toMatchObject({ k: 'over', winner: 's1' });
  });

  it('during a debt it can pay: the creditor is paid first, the rest goes to the bank', () => {
    const s = scenario({ n: 3 });
    own(s, 's1', [5, 15, 25, 35]);
    setCash(s, 's0', 100);
    own(s, 's0', [39]);
    setPos(s, 's0', 31);
    rig(s, [1, 3]);
    const debt = act(s, 's0', { k: 'roll' }).state;
    expect(debt.phase).toMatchObject({ k: 'debt', owed: { s1: 200 } });
    const { state } = act(debt, 's0', { k: 'resign' });
    expect(cash(state, 's1')).toBe(1700);
    expect(state.props.p39).toBeUndefined();
    expect(state.phase).toMatchObject({ k: 'auction', lot: { k: 'prop', space: 39 } });
  });

  it('during a debt it cannot pay: it is a bankruptcy to the creditor (everything sold to the bank)', () => {
    const { state } = act(hotelDebt(), 's0', { k: 'resign' });
    expect(state.players.s0?.out).toBe('resigned');
    expect(state.props.p1).toBeUndefined();
    expect(cash(state, 's1')).toBe(1776);
  });

  it('a high bidder who resigns loses the bid; the auction goes on', () => {
    const s = scenario({ n: 3 });
    rig(s, [2, 4]);
    let a = run(s, ['s0', { k: 'roll' }], ['s0', { k: 'decline' }], ['s2', { k: 'bid', amount: 70 }]).state;
    a = act(a, 's2', { k: 'resign' }).state;
    expect(a.phase).toMatchObject({ k: 'auction', eligible: ['s0', 's1'] });
    expect(a.phase.k === 'auction' && a.phase.high).toBeUndefined();
  });

  it('a creditor who resigns: the debt is owed to the bank instead', () => {
    const s = scenario({ n: 3 });
    own(s, 's1', [5, 15, 25, 35]);
    setCash(s, 's0', 100);
    own(s, 's0', [39]);
    setPos(s, 's0', 31);
    rig(s, [1, 3]);
    const debt = act(s, 's0', { k: 'roll' }).state;
    const { state } = act(debt, 's1', { k: 'resign' });
    expect(state.phase).toMatchObject({ k: 'auction' });
    const chain = JSON.stringify(state.phase);
    expect(chain).toContain('"owed":{"bank":200}');
  });

  it('a trade party who resigns: the offer is cancelled', () => {
    const s = scenario({ n: 3 });
    own(s, 's0', [5]);
    const o = act(s, 's0', { k: 'propose', to: 's2', give: { cash: 0, props: [5], cards: [] }, get: { cash: 10, props: [], cards: [] } });
    const { state, events } = act(o.state, 's2', { k: 'resign' });
    expect(state.trades).toEqual({});
    expect(ofType(events, 'tradeCancelled')[0]?.why).toBe('out');
  });

  it('an awaited non-turn seat who resigns: play moves on', () => {
    // s0 draws Wedding Gifts on Community Chest; s1 (Rs. 20 and the brown street) owes s0 Rs. 50
    const s = scenario({ n: 3 });
    setCash(s, 's1', 20);
    own(s, 's1', [3]);
    setPos(s, 's0', 14);
    stack(s, 'chest', 'cc-wedding');
    rig(s, [1, 2]);
    const debt = act(s, 's0', { k: 'roll' }).state;
    expect(debt.phase).toMatchObject({ k: 'debt', debtor: 's1', owed: { s0: 50 } });
    expect(awaiting(debt)).toEqual(['s1']);
    // It can cover the 50 (20 + 36 for mortgaging the street): the debt is paid, the rest goes to the bank, which auctions it
    const { state } = act(debt, 's1', { k: 'resign' });
    expect(state.phase).toMatchObject({ k: 'auction', lot: { k: 'prop', space: 3 }, eligible: ['s0', 's2'] });
    const after = run(state, ['s0', { k: 'pass' }], ['s2', { k: 'pass' }]).state;
    expect(after.phase.k).toBe('postRoll');
    expect(cash(after, 's0')).toBe(1600);
  });
});

describe('a debt settled later names what it was for', () => {
  /** s0 lands on s1's Galle Face Penthouse with the set (Rs. 100) holding Rs. 40 and Colombo Fort Station (mortgage Rs. 120) */
  function rentDebt(): GameState {
    const s = scenario({ n: 3 });
    own(s, 's1', [37, 39]);
    own(s, 's0', [5]);
    setCash(s, 's0', 40);
    setPos(s, 's0', 35);
    rig(s, [1, 3]);
    return act(s, 's0', { k: 'roll' }).state;
  }

  it('the debt keeps the space, and raising cash by hand settles it with a rent payment for that space', () => {
    const debt = rentDebt();
    expect(debt.phase).toMatchObject({ k: 'debt', debtor: 's0', owed: { s1: 100 }, why: 'rent', space: 39 });
    const { state, events } = act(debt, 's0', { k: 'mortgage', space: 5 });
    expect(ofType(events, 'cash').filter((e) => e.why === 'rent')).toEqual([
      { t: 'cash', from: 's0', to: 's1', amount: 100, why: 'rent', after: { s0: 60, s1: 1600 }, space: 39 },
    ]);
    expect(ofType(events, 'debtPaid')).toEqual([{ t: 'debtPaid', debtor: 's0' }]);
    expect(state.phase.k).toBe('postRoll');
  });

  it('autoRaise and a paying resignation name the space too', () => {
    const auto = act(rentDebt(), 's0', { k: 'autoRaise' }).events;
    expect(ofType(auto, 'cash').find((e) => e.why === 'rent')).toMatchObject({ from: 's0', to: 's1', amount: 100, space: 39 });
    const resigned = act(rentDebt(), 's0', { k: 'resign' }).events;
    expect(ofType(resigned, 'cash').find((e) => e.why === 'rent')).toMatchObject({ from: 's0', to: 's1', amount: 100, space: 39 });
  });

  it('a payment with no space (a card) opens a debt without one', () => {
    const s = scenario({ n: 3 });
    setCash(s, 's0', 10);
    own(s, 's0', [39]);
    setPos(s, 's0', 15);
    stack(s, 'chest', 'cc-school');
    rig(s, [1, 1]);
    const debt = act(s, 's0', { k: 'roll' }).state;
    expect(debt.phase).toMatchObject({ k: 'debt', why: 'card' });
    expect('space' in debt.phase).toBe(false);
    const { events } = act(debt, 's0', { k: 'mortgage', space: 39 });
    const paid = ofType(events, 'cash').find((e) => e.why === 'card');
    expect(paid).toMatchObject({ from: 's0', to: 'bank', amount: 150 });
    expect(paid && 'space' in paid).toBe(false);
  });
});
