import { describe, expect, it } from 'vitest';
import { awaiting, timeoutCommand, timer } from '..';
import type { GameState } from '../types';
import { act, cash, ofType, own, refused, rig, run, scenario, setCash } from './helpers';

/** s0 lands on Kottu Street (6, Rs. 100) and declines: an auction among `n` players */
function declined(n = 3): GameState {
  const s = scenario({ n });
  rig(s, [2, 4]);
  return run(s, ['s0', { k: 'roll' }], ['s0', { k: 'decline' }]).state;
}

describe('timed open auction', () => {
  it('declining starts an auction open to everyone, the decliner and jailed players too', () => {
    const s = scenario({ n: 3 });
    s.players.s2!.jail = { tries: 0 };
    s.players.s2!.pos = 10;
    rig(s, [2, 4]);
    const { state, events } = run(s, ['s0', { k: 'roll' }], ['s0', { k: 'decline' }]);
    expect(state.phase).toMatchObject({ k: 'auction', lot: { k: 'prop', space: 6 }, eligible: ['s0', 's1', 's2'], passed: [] });
    expect(ofType(events, 'auctionStart')[0]).toMatchObject({ eligible: ['s0', 's1', 's2'] });
    expect(awaiting(state)).toEqual(['s0', 's1', 's2']);
    expect(timer(state)?.kind).toBe('auction');
  });

  it('takes bids from anyone in any order; each must beat the high bid', () => {
    let s = declined();
    s = act(s, 's2', { k: 'bid', amount: 10 }).state;
    s = act(s, 's1', { k: 'bid', amount: 20 }).state;
    // A bid sent while s1's was in flight arrives too low: refused on its meaning, not on seq.
    expect(refused(s, 's0', { k: 'bid', amount: 15 })).toBe('low');
    expect(refused(s, 's0', { k: 'bid', amount: 20 })).toBe('low');
    s = act(s, 's0', { k: 'bid', amount: 25 }).state;
    expect(s.phase).toMatchObject({ k: 'auction', high: { seat: 's0', amount: 25 } });
    expect(awaiting(s)).toEqual(['s1', 's2']);
    expect(refused(s, 's0', { k: 'bid', amount: 30 })).toBe('highBidder');
    expect(refused(s, 's0', { k: 'pass' })).toBe('highBidder');
  });

  it('refuses bids above cash, below Rs. 1, or from a seat that passed', () => {
    let s = declined();
    setCash(s, 's1', 40);
    expect(refused(s, 's1', { k: 'bid', amount: 41 })).toBe('cash');
    expect(refused(s, 's1', { k: 'bid', amount: 0 })).toBe('low');
    expect(refused(s, 's1', { k: 'bid', amount: 2.5 })).toBe('low');
    s = act(s, 's1', { k: 'pass' }).state;
    expect(refused(s, 's1', { k: 'bid', amount: 5 })).toBe('passed');
  });

  it('closes by itself once everyone but the high bidder has passed; a bid under the price is fine', () => {
    const s = declined();
    const { state, events } = run(s, ['s1', { k: 'bid', amount: 7 }], ['s0', { k: 'pass' }], ['s2', { k: 'pass' }]);
    expect(state.props.p6).toEqual({ owner: 's1', level: 0 });
    expect(cash(state, 's1')).toBe(1493);
    expect(ofType(events, 'auctionEnd')).toEqual([
      { t: 'auctionEnd', lot: { k: 'prop', space: 6 }, winner: 's1', amount: 7 },
    ]);
    expect(ofType(events, 'owner')).toEqual([{ t: 'owner', space: 6, to: 's1', via: 'auction' }]);
    expect(state.phase.k).toBe('postRoll');
  });

  it('closeAuction (the deadline) sells to the high bidder; it needs the system and a current basis', () => {
    let s = declined();
    s = act(s, 's2', { k: 'bid', amount: 30 }).state;
    expect(refused(s, 's0', { k: 'closeAuction' })).toBe('badActor');
    expect(refused(s, 'system', { k: 'closeAuction' })).toBe('basis');
    expect(refused(s, 'system', { k: 'closeAuction' }, s.seq - 1)).toBe('stale');
    expect(timeoutCommand(s)).toEqual({ by: 'system', a: { k: 'closeAuction' }, basis: s.seq });
    const { state } = act(s, 'system', { k: 'closeAuction' }, s.seq);
    expect(state.props.p6?.owner).toBe('s2');
    expect(cash(state, 's2')).toBe(1470);
  });

  it('with no bids the bank keeps the property', () => {
    const passed = run(declined(), ['s0', { k: 'pass' }], ['s1', { k: 'pass' }], ['s2', { k: 'pass' }]).state;
    expect(passed.props.p6).toBeUndefined();
    expect(passed.phase.k).toBe('postRoll');
    const s = declined();
    const closed = act(s, 'system', { k: 'closeAuction' }, s.seq).state;
    expect(closed.props.p6).toBeUndefined();
  });

  it('allows mortgaging to raise cash mid-auction, but not building or lifting mortgages', () => {
    let s = declined();
    setCash(s, 's1', 10);
    own(s, 's1', [39]);
    own(s, 's1', [37], { mortgaged: true });
    expect(refused(s, 's1', { k: 'bid', amount: 50 })).toBe('cash');
    s = act(s, 's1', { k: 'mortgage', space: 39 }).state;
    expect(cash(s, 's1')).toBe(10 + 240);
    s = act(s, 's1', { k: 'bid', amount: 150 }).state;
    expect(refused(s, 's1', { k: 'unmortgage', space: 37 })).toBe('phase');
    expect(refused(s, 's1', { k: 'build', group: 'darkBlue', levels: [1, 1] })).toBe('phase');
  });

  it('passes automatically for seats that cannot raise more than the high bid', () => {
    const s = scenario({ n: 3 });
    setCash(s, 's2', 0);
    rig(s, [2, 4]);
    const { state, events } = run(s, ['s0', { k: 'roll' }], ['s0', { k: 'decline' }]);
    expect(ofType(events, 'pass')).toEqual([{ t: 'pass', seat: 's2', auto: true }]);
    expect(awaiting(state)).toEqual(['s0', 's1']);
    setCash(state, 's1', 50);
    const after = act(state, 's0', { k: 'bid', amount: 50 });
    expect(ofType(after.events, 'pass')).toEqual([{ t: 'pass', seat: 's1', auto: true }]);
    expect(after.state.props.p6?.owner).toBe('s0');
  });

  it('has a fixed countdown: the timer key holds through bids, passes and mortgaging', () => {
    let s = declined();
    own(s, 's0', [1]);
    const k0 = timer(s)?.key;
    expect(k0).toMatch(/^auction:/);
    s = act(s, 's1', { k: 'bid', amount: 5 }).state;
    expect(timer(s)?.key).toBe(k0);
    s = act(s, 's2', { k: 'bid', amount: 9 }).state;
    expect(timer(s)?.key).toBe(k0);
    s = act(s, 's1', { k: 'pass' }).state;
    expect(timer(s)?.key).toBe(k0);
    s = act(s, 's0', { k: 'mortgage', space: 1 }).state;
    expect(timer(s)?.key).toBe(k0);
    s = act(s, 's0', { k: 'bid', amount: 20 }).state;
    expect(timer(s)?.key).toBe(k0);
  });

  it('keeps the countdown when the high bidder leaves the game (its bid is wiped)', () => {
    let s = declined(4);
    s = act(s, 's2', { k: 'bid', amount: 30 }).state;
    const k0 = timer(s)?.key;
    s = act(s, 's2', { k: 'resign' }).state;
    expect(s.phase).toMatchObject({ k: 'auction' });
    expect(s.phase.k === 'auction' && s.phase.high).toBeUndefined();
    expect(timer(s)?.key).toBe(k0);
  });

  it('still ends early once every eligible seat but the high bidder has passed', () => {
    let s = declined(4);
    s = act(s, 's3', { k: 'bid', amount: 12 }).state;
    s = act(s, 's0', { k: 'pass' }).state;
    s = act(s, 's1', { k: 'pass' }).state;
    expect(s.phase.k).toBe('auction');
    const { state, events } = act(s, 's2', { k: 'pass' });
    expect(ofType(events, 'auctionEnd')).toEqual([{ t: 'auctionEnd', lot: { k: 'prop', space: 6 }, winner: 's3', amount: 12 }]);
    expect(state.props.p6?.owner).toBe('s3');
    expect(state.phase.k).toBe('postRoll');
  });

  it("a new lot gets a new timer key (the bank auctioning a bankrupt's property one space at a time)", () => {
    const s = scenario({ n: 3 });
    own(s, 's0', [1, 3]);
    setCash(s, 's0', 10);
    s.players.s0!.pos = 0;
    rig(s, [2, 2]);
    // Income tax on 4 in a fixed mode: 200 owed to the bank, more than the 10 + 30 + 30 s0 could raise
    s.cfg.incomeTaxMode = 'flat';
    let t = run(s, ['s0', { k: 'roll' }]).state;
    expect(t.phase.k).toBe('debt');
    t = act(t, 's0', { k: 'bankrupt' }).state;
    expect(t.phase).toMatchObject({ k: 'auction', lot: { k: 'prop', space: 1 }, queue: [3] });
    const k1 = timer(t)?.key;
    t = act(t, 's1', { k: 'bid', amount: 5 }).state;
    expect(timer(t)?.key).toBe(k1);
    t = act(t, 's2', { k: 'pass' }).state;
    expect(t.phase).toMatchObject({ k: 'auction', lot: { k: 'prop', space: 3 } });
    expect(timer(t)?.key).not.toBe(k1);
  });
});
