import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SeatId } from '../../rules';
import { ONLINE_TIMERS, type TimerRules } from '../../shared/timing';
import { encodeDoc } from '../doc';
import { HIDDEN_WAIT_MS, LEASE_MS, OWNER_HEADSTART_MS } from '../session';
import type { Batch } from '../types';
import { docOf, flush, makeDoc, PIDS, runUntil, SEATS, table, T0, useClock } from './helpers';

beforeEach(useClock);
afterEach(() => vi.useRealTimers());

const FAST: TimerRules = { turn: 3, decision: 3, auction: 3, debt: 3 };

describe('dispatch races (several clients on one MemoryServer)', () => {
  it('concurrent auction bids: one consistent winner, nothing applied twice', async () => {
    const doc = makeDoc('hhh', { rules: { debug: true }, timers: ONLINE_TIMERS });
    const t = table(doc, PIDS.slice(0, 3).map((me, i) => ({ me, owner: i === 0 })));
    await flush();
    const turn = doc.game.turn.seat;
    const T = t.sessions[SEATS.indexOf(turn)]!;
    expect((await T.dispatch(turn, { k: 'debugRig', dice: [[1, 2]] })).ok).toBe(true);
    expect((await T.dispatch(turn, { k: 'roll' })).ok).toBe(true);
    await flush();
    expect(docOf(T).game.phase).toEqual({ k: 'buy', space: 3 });
    expect((await T.dispatch(turn, { k: 'decline' })).ok).toBe(true);
    await flush();
    expect(docOf(T).game.phase.k).toBe('auction');

    // Everyone bids the opening Rs. 4,200 (70% of the price) at once: exactly one gets it, the others are told why not
    const same = await Promise.all(t.sessions.map((s, i) => s.dispatch(SEATS[i]!, { k: 'bid', amount: 42 })));
    expect(same.filter((r) => r.ok)).toHaveLength(1);
    for (const r of same) if (!r.ok) expect(['low', 'highBidder']).toContain(r.code);
    await flush();
    const winner = SEATS[same.findIndex((r) => r.ok)]!;
    expect(docOf(t.sessions[0]!).game.phase).toMatchObject({ k: 'auction', high: { seat: winner, amount: 42 } });

    // The other two raise at once with different amounts
    const others = [0, 1, 2].filter((i) => SEATS[i] !== winner);
    const raise = await Promise.all(others.map((i, j) => t.sessions[i]!.dispatch(SEATS[i]!, { k: 'bid', amount: 50 + 10 * j })));
    await flush();
    const committed = raise.filter((r) => r.ok).length;
    expect(committed).toBeGreaterThanOrEqual(1);
    const d = docOf(t.sessions[0]!);
    expect(d.seq).toBe(3 + 1 + committed);
    // Every client holds the very same document
    for (const s of t.sessions) expect(encodeDoc(docOf(s))).toBe(encodeDoc(d));
    const high = (d.game.phase as { high: { seat: SeatId; amount: number } }).high;

    // The owner's client drives: it closes the auction at the deadline, and the winner pays once
    expect(t.sessions[0]!.view.get().driver).toBe(true);
    await runUntil(() => docOf(t.sessions[1]!).game.phase.k !== 'auction', 60_000);
    const end = docOf(t.sessions[1]!);
    expect(end.game.props.p3).toMatchObject({ owner: high.seat });
    expect(end.game.players[high.seat]!.cash).toBe(1500 - high.amount);
    expect(end.seq).toBe(d.seq + 1);
  });

  it('a lost ack does not apply a move twice', async () => {
    const doc = makeDoc('hh');
    const t = table(doc, [{ me: PIDS[0], owner: true }, { me: PIDS[1] }]);
    await flush();
    const turn = doc.game.turn.seat;
    t.server.loseAcks(1);
    const r = await t.sessions[SEATS.indexOf(turn)]!.dispatch(turn, { k: 'roll' });
    expect(r).toEqual({ ok: true, seq: 1 });
    await flush();
    expect(t.server.read('rooms/ROOM1/state/seq')).toBe(1);
    expect(docOf(t.sessions[1]!).recent).toHaveLength(1);
  });

  it('refuses a move out of turn with the engine\'s reason, and a seat that is not yours', async () => {
    const doc = makeDoc('hh');
    const t = table(doc, [{ me: PIDS[0] }, { me: PIDS[1] }]);
    await flush();
    const turn = doc.game.turn.seat;
    const other: SeatId = turn === 's0' ? 's1' : 's0';
    const r = await t.sessions[SEATS.indexOf(other)]!.dispatch(other, { k: 'roll' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/\w/);
    expect(await t.sessions[0]!.dispatch('s1', { k: 'roll' })).toMatchObject({ ok: false, code: 'notYourSeat' });
  });

  it('two drivers racing the same timeout apply it once', async () => {
    const doc = makeDoc('hh', { timers: FAST });
    const t = table(doc, [{ me: PIDS[0], alwaysDrive: true }, { me: PIDS[1], alwaysDrive: true }]);
    const seen: Batch[] = [];
    t.sessions[1]!.onBatch((b) => seen.push(b));
    await flush();
    await vi.advanceTimersByTimeAsync(FAST.turn * 1000 + 20);
    await flush();
    expect(docOf(t.sessions[0]!).seq).toBe(1);
    expect(seen.flatMap((b) => b.events).filter((e) => e.t === 'timeout')).toHaveLength(1);
    expect(Object.keys(t.server.read<Record<string, unknown>>(`rooms/ROOM1/log/${doc.gid}`) ?? {})).toEqual(['m000001']);
  });

  it('two drivers playing the same bots never act twice on one seq', async () => {
    const doc = makeDoc('bbb', { timers: FAST, rules: { turnLimit: 9 } });
    const t = table(doc, [{ me: PIDS[0], alwaysDrive: true }, { me: PIDS[1], alwaysDrive: true }]);
    const seqs: number[][] = [[], []];
    t.sessions.forEach((s, i) => s.onBatch((b) => seqs[i]!.push(b.seq)));
    await runUntil(() => t.sessions[0]!.current()?.game.phase.k === 'over', 1_800_000, 500);
    const end = docOf(t.sessions[0]!);
    expect(end.game.phase.k).toBe('over');
    for (const s of seqs) expect(s).toEqual(Array.from({ length: s.length }, (_, i) => s[0]! + i));
    for (const s of t.sessions) expect(s.view.get().tamper).toBeNull();
    // Every chore carried the basis it was decided on
    for (const [i, e] of end.recent.entries()) expect(e.cmd.basis).toBe(end.seq - end.recent.length + i);
  });

  it('a non-driver fires the timeout as a fallback when the driver is gone', async () => {
    const doc = makeDoc('hh', { timers: FAST });
    const t = table(doc, [{ me: PIDS[0], owner: true }, { me: PIDS[1] }]);
    await flush();
    expect(t.sessions[0]!.view.get().driver).toBe(true);
    await vi.advanceTimersByTimeAsync(FAST.turn * 1000 - 100);
    t.dbs[0]!.kill();
    void t.sessions[0]!.dispose();
    // Deadline + 5 s + 1 s for rank 1, well before the dead driver's lease has run out and been waited for
    await vi.advanceTimersByTimeAsync(100 + 5_000 + 1_000 + 50);
    await flush();
    const d = docOf(t.sessions[1]!);
    expect(d.seq).toBe(1);
    expect(d.recent.at(-1)?.pid).toBe(PIDS[1]);
    expect(t.sessions[1]!.view.get().driver).toBe(false);
  });
});

describe('driver lease', () => {
  it('hands over when the driver\'s tab dies, and the bots keep playing', async () => {
    const doc = makeDoc('hhbb', { timers: FAST });
    const t = table(doc, [{ me: PIDS[0], owner: true }, { me: PIDS[1] }]);
    const [A, B] = t.sessions as [typeof t.sessions[0], typeof t.sessions[0]];
    await flush();
    expect(A.view.get().driver).toBe(true);
    expect(B.view.get().driver).toBe(false);
    await runUntil(() => docOf(B).seq >= 6, 300_000);
    expect(docOf(B).recent.every((e) => e.pid === PIDS[0] || e.cmd.by === 's1')).toBe(true);

    const killedAt = Date.now();
    const seqAtKill = docOf(B).seq;
    t.dbs[0]!.kill();
    void A.dispose();
    expect(await runUntil(() => B.view.get().driver, 30_000, 100)).toBe(true);
    expect(Date.now() - killedAt).toBeLessThanOrEqual(LEASE_MS + OWNER_HEADSTART_MS + 2_500);
    await runUntil(() => docOf(B).seq >= seqAtKill + 8, 600_000);
    expect(docOf(B).seq).toBeGreaterThanOrEqual(seqAtKill + 8);
    expect(docOf(B).recent.some((e) => e.pid === PIDS[1] && (e.cmd.by === 's2' || e.cmd.by === 's3'))).toBe(true);
    expect(B.view.get().tamper).toBeNull();
  });

  it('a throttled driver (late ticks in a hidden tab) gives the lease back', async () => {
    const doc = makeDoc('hhbb', { timers: ONLINE_TIMERS });
    let aVisible = true;
    const t = table(doc, [{ me: PIDS[0], owner: true, visible: () => aVisible }, { me: PIDS[1] }]);
    const [A, B] = t.sessions as [typeof t.sessions[0], typeof t.sessions[0]];
    await flush();
    await vi.advanceTimersByTimeAsync(2_050);
    expect(A.view.get().driver).toBe(true);
    // A's tab goes to the background, and the clock jumps 3.5 s while its timers are held back (throttled)
    aVisible = false;
    vi.setSystemTime(Date.now() + 3_500);
    await vi.advanceTimersByTimeAsync(2_000);
    await flush();
    expect(A.view.get().driver).toBe(false);
    expect(await runUntil(() => B.view.get().driver, 20_000, 100)).toBe(true);
    expect(A.view.get().driver).toBe(false);
  });

  it('a visible driver that was busy for a moment (one late tick) keeps the lease: the owner keeps the chores', async () => {
    const doc = makeDoc('hhbb', { timers: ONLINE_TIMERS });
    const t = table(doc, [{ me: PIDS[0], owner: true }, { me: PIDS[1] }]);
    const [A, B] = t.sessions as [typeof t.sessions[0], typeof t.sessions[0]];
    await flush();
    await vi.advanceTimersByTimeAsync(2_050);
    expect(A.view.get().driver).toBe(true);
    // A long task (the game screen building the board on a slow machine) holds A's timers back 3.5 s
    vi.setSystemTime(Date.now() + 3_500);
    await vi.advanceTimersByTimeAsync(2_000);
    await flush();
    expect(A.view.get().driver).toBe(true);
    // ... and A renews on time from there, so B never gets a free lease to take
    await vi.advanceTimersByTimeAsync(LEASE_MS + OWNER_HEADSTART_MS + 4_000);
    await flush();
    expect(A.view.get().driver).toBe(true);
    expect(B.view.get().driver).toBe(false);
    expect(t.server.read<{ pid: string }>('rooms/ROOM1/driver')?.pid).toBe(PIDS[0]);
  });

  it('visible tabs go first; a hidden tab takes it only when nobody visible has', async () => {
    const doc = makeDoc('hhbb', { timers: ONLINE_TIMERS });
    const t = table(doc, [{ me: PIDS[0], owner: true, visible: () => false }, { me: PIDS[1] }]);
    await flush();
    expect(await runUntil(() => t.sessions[1]!.view.get().driver, 20_000, 100)).toBe(true);
    expect(Date.now() - T0).toBeGreaterThanOrEqual(OWNER_HEADSTART_MS);
    expect(t.sessions[0]!.view.get().driver).toBe(false);

    const alone = table(makeDoc('hb', { timers: ONLINE_TIMERS }), [{ me: PIDS[0], owner: true, visible: () => false }]);
    const start = Date.now();
    await flush();
    await vi.advanceTimersByTimeAsync(HIDDEN_WAIT_MS - 2_000);
    expect(alone.sessions[0]!.view.get().driver).toBe(false);
    expect(await runUntil(() => alone.sessions[0]!.view.get().driver, 10_000, 100)).toBe(true);
    expect(Date.now() - start).toBeGreaterThanOrEqual(HIDDEN_WAIT_MS);
  });
});
