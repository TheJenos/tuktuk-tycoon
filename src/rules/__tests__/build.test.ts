import { describe, expect, it } from 'vitest';
import { awaiting, buildOptions, defaultAction, legalActions, timeoutCommand, timer } from '..';
import type { GameState, Level } from '../types';
import { act, cash, ofType, own, refused, run, scenario, setCash } from './helpers';

const levels = (s: GameState, spaces: number[]): number[] => spaces.map((x) => s.props[`p${x}`]?.level ?? 0);
const PINK = [11, 13, 14];

describe('houses and hotels', () => {
  it('needs the whole group, nothing mortgaged, even levels, at most a hotel', () => {
    const s = scenario();
    own(s, 's0', [11, 13]);
    expect(refused(s, 's0', { k: 'build', group: 'pink', levels: [1, 0, 0] })).toBe('notOwner');
    own(s, 's0', [14], { mortgaged: true });
    expect(refused(s, 's0', { k: 'build', group: 'pink', levels: [1, 1, 1] })).toBe('mortgaged');
    delete s.props.p14!.mortgaged;
    expect(refused(s, 's0', { k: 'build', group: 'pink', levels: [2, 0, 0] })).toBe('uneven');
    expect(refused(s, 's0', { k: 'build', group: 'pink', levels: [6, 6, 6] })).toBe('badLevels');
    expect(refused(s, 's0', { k: 'build', group: 'pink', levels: [1, 1] })).toBe('badLevels');
    expect(refused(s, 's0', { k: 'build', group: 'rail', levels: [1] })).toBe('badGroup');
    const { state, events } = act(s, 's0', { k: 'build', group: 'pink', levels: [1, 1, 0] });
    expect(levels(state, PINK)).toEqual([1, 1, 0]);
    expect(cash(state, 's0')).toBe(1300);
    expect(state.bank.houses).toBe(30);
    expect(ofType(events, 'level').map((e) => [e.space, e.to, e.bank.houses])).toEqual([
      [11, 1, 31],
      [13, 1, 30],
    ]);
  });

  it('a hotel needs 4 houses on every street and gives the 4 houses back', () => {
    const s = scenario();
    own(s, 's0', PINK, { level: 4 });
    expect(s.bank.houses).toBe(20);
    const { state } = act(s, 's0', { k: 'build', group: 'pink', levels: [5, 4, 4] });
    expect(state.bank).toEqual({ houses: 24, hotels: 11 });
    expect(refused(state, 's0', { k: 'build', group: 'pink', levels: [6, 5, 5] })).toBe('badLevels');
  });

  it('checks the bank step by step: (4,4,3) -> (5,5,4) fails with no houses left', () => {
    const s = scenario({ cfg: { houses: 11 } });
    own(s, 's0', [11, 13], { level: 4 });
    own(s, 's0', [14], { level: 3 });
    expect(s.bank.houses).toBe(0);
    expect(refused(s, 's0', { k: 'build', group: 'pink', levels: [5, 5, 4] })).toBe('noHouses');
    expect(refused(s, 's0', { k: 'build', group: 'pink', levels: [4, 4, 4] })).toBe('noHouses');
  });

  it('only charges what it can afford, in cash', () => {
    const s = scenario();
    own(s, 's0', PINK);
    setCash(s, 's0', 250);
    expect(refused(s, 's0', { k: 'build', group: 'pink', levels: [1, 1, 1] })).toBe('cash');
  });

  it('sells back at half price, evenly; a hotel back to houses needs houses in the bank', () => {
    const s = scenario();
    own(s, 's0', PINK, { level: 2 });
    expect(refused(s, 's0', { k: 'sell', group: 'pink', levels: [0, 2, 2] })).toBe('uneven');
    const sold = act(s, 's0', { k: 'sell', group: 'pink', levels: [1, 2, 2] }).state;
    expect(cash(sold, 's0')).toBe(1550);

    // Hotels on pink; only 3 houses left in the bank (the other 6 are on s1's light blues).
    const h = scenario({ cfg: { houses: 9 } });
    own(h, 's0', PINK, { level: 5 });
    own(h, 's1', [6, 8, 9], { level: 2 });
    expect(h.bank).toEqual({ houses: 3, hotels: 9 });
    expect(refused(h, 's0', { k: 'sell', group: 'pink', levels: [4, 5, 5] })).toBe('noHouses');
    const all = act(h, 's0', { k: 'sell', group: 'pink', levels: [0, 0, 0] });
    expect(levels(all.state, PINK)).toEqual([0, 0, 0]);
    expect(all.state.bank.hotels).toBe(12);
    expect(cash(all.state, 's0')).toBe(1500 + 3 * 5 * 50);
  });

  it('a player who is not on turn can build after the turn player rolls', () => {
    const s = scenario();
    s.phase = { k: 'postRoll' };
    own(s, 's1', [37, 39]);
    expect(act(s, 's1', { k: 'build', group: 'darkBlue', levels: [1, 1] }).state.props.p39?.level).toBe(1);
  });

  it('lists single steps and reasons in buildOptions and legalActions', () => {
    const s = scenario();
    own(s, 's0', [37, 39]);
    own(s, 's0', [1]);
    const opts = buildOptions(s, 's0');
    expect(opts.map((o) => o.group)).toEqual(['brown', 'darkBlue']);
    expect(opts[0]?.reason).toMatch(/whole colour group/);
    expect(opts[1]?.build.map((b) => b.space)).toEqual([37, 39]);
    expect(legalActions(s, 's0')).toContainEqual({ k: 'build', group: 'darkBlue', levels: [1, 0] });
  });
});

/** Shortage contest: 3 houses in the bank, s0 owns brown, s1 owns light blue */
function shortage(): GameState {
  const s = scenario({ n: 3, cfg: { houses: 3 } });
  own(s, 's0', [1, 3]);
  own(s, 's1', [6, 8, 9]);
  return s;
}

describe('building shortage contest', () => {
  it('opens a window for rivals when the build would leave too few houses', () => {
    const s = shortage();
    const { state, events } = act(s, 's0', { k: 'build', group: 'brown', levels: [1, 1] });
    expect(state.phase).toMatchObject({ k: 'buildClaim', kind: 'house', by: 's0', req: { s0: 2 }, open: ['s1'] });
    expect(ofType(events, 'claimStart')).toEqual([{ t: 'claimStart', kind: 'house', by: 's0', open: ['s1'], supply: 3 }]);
    expect(awaiting(state)).toEqual(['s1']);
    expect(timer(state)?.kind).toBe('decision');
    expect(defaultAction(state, 's1')).toEqual({ k: 'pass' });
    expect(timeoutCommand(state)).toEqual({ by: 'system', a: { k: 'closeClaim' }, basis: state.seq });
    expect(levels(state, [1, 3])).toEqual([0, 0]);
  });

  it('no contest while the bank has plenty', () => {
    const s = scenario({ n: 3 });
    own(s, 's0', [1, 3]);
    own(s, 's1', [6, 8, 9]);
    expect(act(s, 's0', { k: 'build', group: 'brown', levels: [1, 1] }).state.phase.k).toBe('preRoll');
  });

  it('grants everything when the requests fit: the starter builds, the rival places its units', () => {
    const s = act(shortage(), 's0', { k: 'build', group: 'brown', levels: [1, 1] }).state;
    const asked = act(s, 's1', { k: 'requestBuild', n: 1 });
    expect(asked.state.phase).toMatchObject({ k: 'place', seat: 's1', kind: 'house', count: 1 });
    expect(levels(asked.state, [1, 3])).toEqual([1, 1]);
    expect(cash(asked.state, 's0')).toBe(1400);
    expect(legalActions(asked.state, 's1')).toEqual(expect.arrayContaining([{ k: 'place', space: 6 }]));
    const placed = act(asked.state, 's1', { k: 'place', space: 8 }).state;
    expect(levels(placed, [6, 8, 9])).toEqual([0, 1, 0]);
    expect(cash(placed, 's1')).toBe(1450);
    expect(placed.phase.k).toBe('preRoll');
    expect(placed.bank.houses).toBe(0);
  });

  it('a pass (or the window timing out) lets the starter build as asked', () => {
    const s = act(shortage(), 's0', { k: 'build', group: 'brown', levels: [1, 1] }).state;
    expect(levels(act(s, 's1', { k: 'pass' }).state, [1, 3])).toEqual([1, 1]);
    const timedOut = act(s, 'system', { k: 'closeClaim' }, s.seq);
    expect(levels(timedOut.state, [1, 3])).toEqual([1, 1]);
    expect(ofType(timedOut.events, 'claimRequest')).toEqual([{ t: 'claimRequest', seat: 's1', n: 0 }]);
  });

  it('auctions units one at a time when the requests exceed the supply; winners pay the bid', () => {
    let s = act(shortage(), 's0', { k: 'build', group: 'brown', levels: [1, 1] }).state;
    s = act(s, 's1', { k: 'requestBuild', n: 3 }).state;
    expect(s.phase).toMatchObject({ k: 'auction', lot: { k: 'house' }, eligible: ['s0', 's1'] });
    // Unit 1: s0 wins for Rs. 5 and places it.
    s = run(s, ['s0', { k: 'bid', amount: 5 }], ['s1', { k: 'pass' }]).state;
    expect(s.phase).toMatchObject({ k: 'place', seat: 's0', bid: 5 });
    expect(cash(s, 's0')).toBe(1495);
    s = act(s, 's0', { k: 'place', space: 1 }).state;
    expect(cash(s, 's0')).toBe(1495);
    // Unit 2: s1 wins for Rs. 60.
    expect(s.phase).toMatchObject({ k: 'auction', lot: { k: 'house' } });
    s = run(s, ['s1', { k: 'bid', amount: 60 }], ['s0', { k: 'pass' }], ['s1', { k: 'place', space: 6 }]).state;
    // Unit 3: 1 left; s0 still wants 1, s1 wants 2 -> one more auction; nobody bids, the contest ends.
    expect(s.phase).toMatchObject({ k: 'auction', lot: { k: 'house' } });
    const done = act(s, 'system', { k: 'closeAuction' }, s.seq);
    expect(done.state.phase.k).toBe('preRoll');
    expect(ofType(done.events, 'claimEnd').at(-1)?.outcome).toBe('done');
    expect(levels(done.state, [1, 3, 6, 8, 9])).toEqual([1, 0, 1, 0, 0]);
    expect(done.state.bank.houses).toBe(1);
  });

  it('the place timeout uses the first legal site', () => {
    let s = act(shortage(), 's0', { k: 'build', group: 'brown', levels: [1, 1] }).state;
    s = act(s, 's1', { k: 'requestBuild', n: 1 }).state;
    expect(defaultAction(s, 's1')).toEqual({ k: 'place', space: 6 });
    const t = timeoutCommand(s);
    expect(t).toEqual({ by: 'system', a: { k: 'forced', seat: 's1', a: { k: 'place', space: 6 } }, basis: s.seq });
    expect(levels(act(s, 'system', t!.a, s.seq).state, [6])).toEqual([1]);
  });

  it('hotel shortages are contested the same way', () => {
    const s = scenario({ n: 2, cfg: { hotels: 1 } });
    own(s, 's0', [37, 39], { level: 4 });
    own(s, 's1', [1, 3], { level: 4 });
    const { state } = act(s, 's0', { k: 'build', group: 'darkBlue', levels: [5, 4] });
    expect(state.phase).toMatchObject({ k: 'buildClaim', kind: 'hotel', open: ['s1'] });
    const lvl: Level[] = [5, 4];
    expect(levels(act(state, 's1', { k: 'pass' }).state, [37, 39])).toEqual(lvl);
  });
});
