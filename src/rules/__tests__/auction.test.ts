import { describe, expect, it } from 'vitest';
import { awaiting, minBid, minRaise, timeoutCommand, timer } from '..';
import type { GameState, RulesConfig } from '../types';
import { act, cash, ofType, own, refused, rig, run, scenario, setCash } from './helpers';

/** s0 lands on Kottu Street (6, Rs. 100) and declines: an auction among `n` players, opening at 70 */
function declined(n = 3, cfg: Partial<RulesConfig> = {}): GameState {
  const s = scenario({ n, cfg });
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
    s = act(s, 's2', { k: 'bid', amount: 70 }).state;
    s = act(s, 's1', { k: 'bid', amount: 80 }).state;
    // A bid sent while s1's was in flight arrives too low: refused on its meaning, not on seq.
    expect(refused(s, 's0', { k: 'bid', amount: 75 })).toBe('low');
    expect(refused(s, 's0', { k: 'bid', amount: 80 })).toBe('low');
    s = act(s, 's0', { k: 'bid', amount: 85 }).state;
    expect(s.phase).toMatchObject({ k: 'auction', high: { seat: 's0', amount: 85 } });
    expect(awaiting(s)).toEqual(['s1', 's2']);
    expect(refused(s, 's0', { k: 'bid', amount: 100 })).toBe('highBidder');
    expect(refused(s, 's0', { k: 'pass' })).toBe('highBidder');
  });

  it('refuses bids above cash, below the opening bid, or from a seat that passed', () => {
    let s = declined();
    setCash(s, 's1', 80);
    expect(refused(s, 's1', { k: 'bid', amount: 81 })).toBe('cash');
    expect(refused(s, 's1', { k: 'bid', amount: 0 })).toBe('low');
    expect(refused(s, 's1', { k: 'bid', amount: 69 })).toBe('low');
    expect(refused(s, 's1', { k: 'bid', amount: 70.5 })).toBe('low');
    s = act(s, 's1', { k: 'pass' }).state;
    expect(refused(s, 's1', { k: 'bid', amount: 75 })).toBe('passed');
  });

  it('closes by itself once everyone but the high bidder has passed; a bid under the price is fine', () => {
    const s = declined();
    const { state, events } = run(s, ['s1', { k: 'bid', amount: 70 }], ['s0', { k: 'pass' }], ['s2', { k: 'pass' }]);
    expect(state.props.p6).toEqual({ owner: 's1', level: 0 });
    expect(cash(state, 's1')).toBe(1430);
    expect(ofType(events, 'auctionEnd')).toEqual([
      { t: 'auctionEnd', lot: { k: 'prop', space: 6 }, winner: 's1', amount: 70 },
    ]);
    expect(ofType(events, 'owner')).toEqual([{ t: 'owner', space: 6, to: 's1', via: 'auction' }]);
    expect(state.phase.k).toBe('postRoll');
  });

  it('closeAuction (the deadline) sells to the high bidder; it needs the system and a current basis', () => {
    let s = declined();
    s = act(s, 's2', { k: 'bid', amount: 80 }).state;
    expect(refused(s, 's0', { k: 'closeAuction' })).toBe('badActor');
    expect(refused(s, 'system', { k: 'closeAuction' })).toBe('basis');
    expect(refused(s, 'system', { k: 'closeAuction' }, s.seq - 1)).toBe('stale');
    expect(timeoutCommand(s)).toEqual({ by: 'system', a: { k: 'closeAuction' }, basis: s.seq });
    const { state } = act(s, 'system', { k: 'closeAuction' }, s.seq);
    expect(state.props.p6?.owner).toBe('s2');
    expect(cash(state, 's2')).toBe(1420);
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
    expect(refused(s, 's1', { k: 'bid', amount: 150 })).toBe('cash');
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
    // s0 opens at 70: s1, with 70, cannot beat it
    setCash(state, 's1', 70);
    const after = act(state, 's0', { k: 'bid', amount: 70 });
    expect(ofType(after.events, 'pass')).toEqual([{ t: 'pass', seat: 's1', auto: true }]);
    expect(after.state.props.p6?.owner).toBe('s0');
  });

  it('restarts the deadline on every bid but not on a pass or a mortgage', () => {
    let s = declined();
    own(s, 's0', [1]);
    const k0 = timer(s)?.key;
    s = act(s, 's1', { k: 'pass' }).state;
    expect(timer(s)?.key).toBe(k0);
    s = act(s, 's2', { k: 'bid', amount: 70 }).state;
    const k1 = timer(s)?.key;
    expect(k1).not.toBe(k0);
    s = act(s, 's0', { k: 'mortgage', space: 1 }).state;
    expect(timer(s)?.key).toBe(k1);
    s = act(s, 's0', { k: 'bid', amount: 75 }).state;
    expect(timer(s)?.key).not.toBe(k1);
  });

  it('restarts the countdown when the high bidder leaves the game (its bid is wiped)', () => {
    let s = declined(4);
    s = act(s, 's2', { k: 'bid', amount: 80 }).state;
    const k0 = timer(s)?.key;
    s = act(s, 's2', { k: 'resign' }).state;
    expect(s.phase).toMatchObject({ k: 'auction' });
    expect(s.phase.k === 'auction' && s.phase.high).toBeUndefined();
    expect(timer(s)?.key).not.toBe(k0);
  });

  it('fixedAuctionCountdown: the timer key holds through bids, passes and mortgaging', () => {
    let s = declined(3, { fixedAuctionCountdown: true });
    own(s, 's0', [1]);
    const k0 = timer(s)?.key;
    expect(k0).toMatch(/^auction:/);
    s = act(s, 's1', { k: 'bid', amount: 70 }).state;
    expect(timer(s)?.key).toBe(k0);
    s = act(s, 's2', { k: 'bid', amount: 75 }).state;
    expect(timer(s)?.key).toBe(k0);
    s = act(s, 's1', { k: 'pass' }).state;
    expect(timer(s)?.key).toBe(k0);
    s = act(s, 's0', { k: 'mortgage', space: 1 }).state;
    expect(timer(s)?.key).toBe(k0);
    s = act(s, 's0', { k: 'bid', amount: 90 }).state;
    expect(timer(s)?.key).toBe(k0);
  });

  it('fixedAuctionCountdown: keeps the countdown when the high bidder leaves the game (its bid is wiped)', () => {
    let s = declined(4, { fixedAuctionCountdown: true });
    s = act(s, 's2', { k: 'bid', amount: 80 }).state;
    const k0 = timer(s)?.key;
    s = act(s, 's2', { k: 'resign' }).state;
    expect(s.phase).toMatchObject({ k: 'auction' });
    expect(s.phase.k === 'auction' && s.phase.high).toBeUndefined();
    expect(timer(s)?.key).toBe(k0);
  });

  it('still ends early once every eligible seat but the high bidder has passed', () => {
    let s = declined(4);
    s = act(s, 's3', { k: 'bid', amount: 72 }).state;
    s = act(s, 's0', { k: 'pass' }).state;
    s = act(s, 's1', { k: 'pass' }).state;
    expect(s.phase.k).toBe('auction');
    const { state, events } = act(s, 's2', { k: 'pass' });
    expect(ofType(events, 'auctionEnd')).toEqual([{ t: 'auctionEnd', lot: { k: 'prop', space: 6 }, winner: 's3', amount: 72 }]);
    expect(state.props.p6?.owner).toBe('s3');
    expect(state.phase.k).toBe('postRoll');
  });

  it("fixedAuctionCountdown: a new lot gets a new timer key (the bank auctioning a bankrupt's property one space at a time)", () => {
    const s = scenario({ n: 3, cfg: { fixedAuctionCountdown: true } });
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
    t = act(t, 's1', { k: 'bid', amount: 45 }).state;
    expect(timer(t)?.key).toBe(k1);
    t = act(t, 's2', { k: 'pass' }).state;
    expect(t.phase).toMatchObject({ k: 'auction', lot: { k: 'prop', space: 3 } });
    expect(timer(t)?.key).not.toBe(k1);
  });
});

describe('auctioning every property (auctionAll)', () => {
  it('landing on an unowned property starts an auction at once, the lander bidding like everyone else', () => {
    const s = scenario({ n: 3, cfg: { auctionAll: true } });
    rig(s, [2, 4]);
    const { state, events } = run(s, ['s0', { k: 'roll' }]);
    expect(state.phase).toMatchObject({ k: 'auction', lot: { k: 'prop', space: 6 }, eligible: ['s0', 's1', 's2'] });
    expect(ofType(events, 'auctionStart')).toHaveLength(1);
    // No buying at the printed price
    expect(refused(state, 's0', { k: 'buy' })).toBe('phase');
    // The winner owns it for the bid, and play goes on with the lander's turn
    let t = act(state, 's1', { k: 'bid', amount: 80 }).state;
    t = act(t, 's0', { k: 'pass' }).state;
    t = act(t, 's2', { k: 'pass' }).state;
    expect(t.props.p6?.owner).toBe('s1');
    expect(cash(t, 's1')).toBe(1500 - 80);
    expect(t.phase.k).toBe('postRoll');
    expect(t.turn.seat).toBe('s0');
  });

  it('needs auctions: the option turns them on', () => {
    expect(scenario({ n: 2, cfg: { auctionAll: true, auctions: false } }).cfg.auctions).toBe(true);
  });

  it('a player still on the first lap triggers nothing, as without it', () => {
    const s = scenario({ n: 2, cfg: { auctionAll: true, buyAfterFirstLap: true } });
    rig(s, [2, 4]);
    const { state, events } = run(s, ['s0', { k: 'roll' }]);
    expect(state.phase.k).toBe('postRoll');
    expect(ofType(events, 'auctionStart')).toHaveLength(0);
    expect(state.props.p6).toBeUndefined();
  });
});

describe('opening bid and growing raises', () => {
  it("opens at 70% of the property's price, rounded up", () => {
    const s = declined();
    expect(s.phase).toMatchObject({ k: 'auction', open: 70 });
    expect(minBid(s)).toBe(70);
    expect(refused(s, 's1', { k: 'bid', amount: 69 })).toBe('low');
    // Mattakkuliya Road (1, Rs. 60): 42
    const t = scenario({ n: 2 });
    rig(t, [1, 0]);
    t.players.s0!.pos = 0;
    const a = run(t, ['s0', { k: 'roll' }], ['s0', { k: 'decline' }]).state;
    expect(a.phase).toMatchObject({ k: 'auction', lot: { k: 'prop', space: 1 }, open: 42 });
  });

  it('raises by at least Rs. 100 for the first 3 bids, Rs. 1,000 from the 3rd, Rs. 10,000 from the 6th', () => {
    let s = declined();
    const raises: (number | undefined)[] = [minRaise(s)];
    let high = 70;
    for (const [seat, inc] of [['s1', 0], ['s2', 1], ['s1', 1], ['s2', 10], ['s1', 10], ['s2', 10], ['s1', 100]] as const) {
      high += inc;
      s = act(s, seat, { k: 'bid', amount: high }).state;
      raises.push(minRaise(s));
    }
    expect(raises).toEqual([1, 1, 1, 10, 10, 10, 100, 100]);
    // A raise under the minimum is refused
    expect(refused(s, 's2', { k: 'bid', amount: high + 10 })).toBe('low');
    expect(minBid(s)).toBe(high + 100);
  });

  it('a seat that could not cover the next minimum raise is passed automatically', () => {
    let s = declined();
    s = run(s, ['s1', { k: 'bid', amount: 70 }], ['s2', { k: 'bid', amount: 71 }], ['s1', { k: 'bid', amount: 72 }]).state;
    // Raises are now Rs. 1,000 (10): s2 with 81 cannot cover 82
    setCash(s, 's2', 81);
    const { events } = act(s, 's0', { k: 'bid', amount: 82 });
    expect(ofType(events, 'pass')).toEqual([{ t: 'pass', seat: 's2', auto: true }]);
  });
});
