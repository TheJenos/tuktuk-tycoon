import { describe, expect, it } from 'vitest';
import { timer, type Phase } from '../../../rules';
import type { Doc } from '../../../net/types';
import { ONLINE_TIMERS, OFFLINE_TIMERS } from '../../../shared/timing';
import { makeNames } from '../format';
import {
  actingSeat,
  activeDeadline,
  busTargets,
  decisionKey,
  decisionSeat,
  gateDecision,
  handOver,
  myAwaited,
  myBidders,
  phaseLabel,
  resignQuestion,
} from '../selectors';
import { act, game, own } from './helpers';

const doc = (g = game(), extra: Partial<Doc> = {}): Doc => ({
  gid: 'g1', seq: g.seq, game: g, seats: {}, ids: [], recent: [], timers: ONLINE_TIMERS, strikes: {}, ...extra,
});

describe('decisions', () => {
  it('waits on my seats only', () => {
    const s = game(3);
    expect(myAwaited(s, ['s0'])).toEqual(['s0']);
    expect(myAwaited(s, ['s1'])).toEqual([]);
    expect(decisionKey(s, ['s1'])).toBeNull();
    expect(decisionKey(s, ['s0'])).toMatch(/^preRoll:/);
    expect(decisionKey(null, ['s0'])).toBeNull();
  });

  it('keeps an auction key through bids, for the high bidder too', () => {
    let s = game(3);
    s.phase = { k: 'buy', space: 39 };
    s.players.s0!.pos = 39;
    s = act(s, 's0', { k: 'decline' }).state;
    expect(s.phase.k).toBe('auction');
    const before = decisionKey(s, ['s1']);
    expect(before).toMatch(/^auction:p39/);
    s = act(s, 's1', { k: 'bid', amount: 10 }).state;
    expect(myBidders(s, ['s1'])).toEqual(['s1']);
    expect(myAwaited(s, ['s1'])).toEqual([]);
    expect(decisionKey(s, ['s1'])).toBe(before);
    s = act(s, 's2', { k: 'bid', amount: 20 }).state;
    expect(decisionKey(s, ['s1'])).toBe(before);
    s = act(s, 's1', { k: 'pass' }).state;
    expect(decisionKey(s, ['s1'])).toBeNull();
  });

  it('shows a new decision only when idle, and keeps one that is up', () => {
    expect(gateDecision(null, 'a', false)).toBeNull();
    expect(gateDecision(null, 'a', true)).toBe('a');
    expect(gateDecision('a', 'a', false)).toBe('a');
    expect(gateDecision('a', 'b', false)).toBeNull();
    expect(gateDecision('a', null, true)).toBeNull();
  });

  it('picks the acting seat for hot-seat', () => {
    const s = game(3);
    expect(actingSeat(s, ['s1', 's0'])).toBe('s0');
    expect(actingSeat(s, ['s2', 's1'])).toBe('s2');
    s.players.s2!.out = 'bankrupt';
    expect(actingSeat(s, ['s2', 's1'])).toBe('s1');
    expect(actingSeat(s, [])).toBeNull();
  });

  it('lands the bus options', () => {
    const s = game();
    s.players.s0!.pos = 36;
    expect(busTargets(s, 's0', [3, 4, 7])).toEqual([39, 0, 3]);
  });
});

describe('activeDeadline', () => {
  it('reads the deadline of the current phase only', () => {
    const g = game();
    const key = timer(g)!.key;
    expect(activeDeadline(doc(g, { deadline: { key, at: 5000 } }))).toEqual({ at: 5000, total: 60, kind: 'turn' });
    expect(activeDeadline(doc(g, { deadline: { key: 'old', at: 5000 } }))).toBeNull();
    expect(activeDeadline(doc(g))).toBeNull();
    expect(activeDeadline(null)).toBeNull();
  });

  it('ignores untimed phases (offline turns)', () => {
    const g = game();
    expect(activeDeadline(doc(g, { timers: OFFLINE_TIMERS, deadline: { key: timer(g)!.key, at: 1 } }))).toBeNull();
  });
});

describe('phaseLabel', () => {
  it('says what every phase waits for', () => {
    const s = game(3);
    const names = makeNames(s, null);
    const phases: Phase[] = [
      { k: 'preRoll' },
      { k: 'postRoll' },
      { k: 'bus', opts: [1, 2, 3] },
      { k: 'chooseSpace' },
      { k: 'buy', space: 39 },
      { k: 'incomeTax' },
      { k: 'auction', lot: { k: 'prop', space: 39 }, high: { seat: 's1', amount: 40 }, passed: [], eligible: ['s0', 's1'], queue: [], resume: { k: 'postRoll' } },
      { k: 'place', seat: 's1', kind: 'house', count: 1, resume: { k: 'postRoll' } },
      { k: 'buildClaim', kind: 'house', by: 's0', req: {}, open: ['s1', 's2'], resume: { k: 'postRoll' } },
      { k: 'mortgageXfer', seat: 's1', spaces: [39], resume: { k: 'postRoll' } },
      { k: 'debt', debtor: 's1', owed: { s0: 120 }, why: 'rent', resume: { k: 'postRoll' } },
      { k: 'over', winner: 's1', ranking: ['s1', 's0', 's2'], why: 'lastStanding' },
    ];
    for (const phase of phases) {
      s.phase = phase;
      expect(phaseLabel(s, names, ['s0']).length).toBeGreaterThan(5);
      expect(phaseLabel(s, names, []).length).toBeGreaterThan(5);
    }
    s.phase = { k: 'buy', space: 39 };
    expect(phaseLabel(s, names, ['s0'])).toBe('You: buy Galle Face Penthouse or auction it');
    expect(phaseLabel(s, names, ['s1'])).toBe('Ann decides on Galle Face Penthouse');
    s.phase = { k: 'debt', debtor: 's1', owed: { s0: 120, bank: 30 }, why: 'rent', resume: { k: 'postRoll' } };
    expect(phaseLabel(s, names, ['s0'])).toBe('Bob must raise cash to pay Rs. 15,000');
  });
});

describe('hot-seat hand-over', () => {
  it('names the one local seat a shown decision is for', () => {
    const s = game(3);
    const key = decisionKey(s, ['s0', 's1']);
    expect(decisionSeat(s, ['s0', 's1'], key)).toBe('s0');
    expect(decisionSeat(s, ['s0', 's1'], null)).toBeNull();
    expect(decisionSeat(s, ['s1'], decisionKey(s, ['s1']))).toBeNull();
    s.phase = { k: 'auction', lot: { k: 'prop', space: 39 }, passed: [], eligible: ['s0', 's1'], queue: [], resume: { k: 'postRoll' } };
    expect(decisionSeat(s, ['s0', 's1'], decisionKey(s, ['s0', 's1']))).toBeNull();
  });

  it('asks to pass the device only between two different local seats', () => {
    let h = { last: null, pass: null } as Parameters<typeof handOver>[0];
    h = handOver(h, 's0', true);
    expect(h).toEqual({ last: 's0', pass: null });
    expect(handOver(h, 's0', true)).toBe(h);
    expect(handOver(h, null, true)).toBe(h);
    const next = handOver(h, 's1', true);
    expect(next).toEqual({ last: 's1', pass: 's1' });
    expect(handOver(h, 's1', false)).toEqual({ last: 's1', pass: null });
  });
});

describe('resignQuestion', () => {
  const names = (g: ReturnType<typeof game>) => makeNames(g);
  const inDebt = (g: ReturnType<typeof game>, owed: Partial<Record<'s1' | 'bank', number>>): void => {
    g.phase = { k: 'debt', debtor: 's0', owed, why: 'rent', resume: { k: 'postRoll' } } as Phase;
  };

  it('says the property goes back to the bank when there is no debt, or the debt can be paid', () => {
    const g = game();
    expect(resignQuestion(g, 's0', names(g), false)).toBe('Resign? Your property goes back to the bank.');
    inDebt(g, { s1: 100 });
    expect(resignQuestion(g, 's0', names(g), false)).toMatch(/debt is paid first/);
  });

  it("says everything goes to the one player who can't be paid", () => {
    const g = game();
    own(g, 's0', [1, 3]);
    g.players.s0!.cash = 10;
    inDebt(g, { s1: 1200 });
    expect(resignQuestion(g, 's0', names(g), false)).toBe("Resign? You can't pay Bob: everything you own goes to them.");
    inDebt(g, { s1: 1200, bank: 50 });
    expect(resignQuestion(g, 's0', names(g), true)).toMatch(/^Resign Ann\? You can't pay in full: your cash goes to Bob/);
  });
});
