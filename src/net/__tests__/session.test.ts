import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultAction, type SeatId } from '../../rules';
import type { TimerRules } from '../../shared/timing';
import { applyEnvelope } from '../doc';
import { Session } from '../session';
import { MemoryDb, MemoryServer } from '../db';
import type { Batch, Doc } from '../types';
import { docOf, envelope, flush, makeDoc, PIDS, record, runUntil, SEATS, table, T0, useClock } from './helpers';

beforeEach(useClock);
afterEach(() => vi.useRealTimers());

const FAST: TimerRules = { turn: 3, decision: 3, auction: 3, debt: 3 };

describe('Session', () => {
  it('gives a late subscriber a snap of the current state first, then each seq', async () => {
    const doc = makeDoc('hh');
    const t = table(doc, [{ me: PIDS[0], owner: true }, { me: PIDS[1] }]);
    await flush();
    const turn = doc.game.turn.seat;
    const T = t.sessions[SEATS.indexOf(turn)]!;
    const early: Batch[] = [];
    t.sessions[1]!.onBatch((b) => early.push(b));
    expect(early).toEqual([expect.objectContaining({ seq: 0, snap: true })]);
    expect((await T.dispatch(turn, { k: 'roll' })).ok).toBe(true);
    await flush();
    const late: Batch[] = [];
    t.sessions[1]!.onBatch((b) => late.push(b));
    expect(late).toEqual([expect.objectContaining({ seq: 1, snap: true })]);
    expect(early.map((b) => [b.seq, !!b.snap])).toEqual([[0, true], [1, false]]);
    expect(early[1]!.events.some((e) => e.t === 'dice')).toBe(true);
  });

  it('shows the tamper banner when a written state does not replay', async () => {
    const doc = makeDoc('hh');
    const t = table(doc, [{ me: PIDS[0], owner: true }, { me: PIDS[1] }]);
    const seen: Batch[] = [];
    t.sessions[1]!.onBatch((b) => seen.push(b));
    await flush();
    const turn = doc.game.turn.seat;
    const next = applyEnvelope(doc, envelope({ by: turn, a: { k: 'roll' } }, doc.seats[turn]!.ctrl));
    if (!next.ok) throw new Error(next.message);
    const forged: Doc = structuredClone(next.doc);
    forged.game.players[turn]!.cash += 5_000;
    t.server.write('rooms/ROOM1/state', record(forged, T0 + 2_000));
    await flush();
    expect(t.sessions[1]!.view.get().tamper).toMatch(/Move 1 by P\d broke the rules/);
    expect(seen.at(-1)).toMatchObject({ seq: 1, snap: true });
    expect(docOf(t.sessions[1]!).game.players[turn]!.cash).toBe(forged.game.players[turn]!.cash);
  });

  it('two timeouts in a row hand a seat to the driver; its player acting takes it back', async () => {
    const doc = makeDoc('hh', { timers: FAST, rules: { debug: true } });
    const t = table(doc, [{ me: PIDS[0], owner: true }, { me: PIDS[1] }]);
    await flush();
    const seat = doc.game.turn.seat;
    const mine = t.sessions[SEATS.indexOf(seat)]!;
    expect(await runUntil(() => docOf(mine).seats[seat]?.afk === true, 120_000)).toBe(true);
    // The driver plays it now: a seat move with a basis, not a forced timeout
    expect(await runUntil(() => docOf(mine).recent.some((e) => e.cmd.by === seat && e.cmd.basis !== undefined), 120_000)).toBe(true);
    expect(docOf(mine).seats[seat]?.afk).toBe(true);
    expect(mine.view.get().mySeats).toContain(seat);
    // Rigging from the player's page is not a move (e2e tests do it): the bot keeps the seat
    expect((await mine.dispatch(seat, { k: 'debugSetCash', seat, cash: 1234 })).ok).toBe(true);
    await flush();
    expect(docOf(mine).seats[seat]?.afk).toBe(true);
    // The player's own move takes it back: the next time the game waits on the seat, before the bot answers
    let back = false;
    for (let i = 0; i < 600 && !back; i++) {
      const a = defaultAction(docOf(mine).game, seat);
      back = !!a && (await mine.dispatch(seat, a)).ok;
      if (!back) await vi.advanceTimersByTimeAsync(100);
    }
    expect(back).toBe(true);
    await flush();
    expect(docOf(mine).seats[seat]?.afk).toBeUndefined();
    expect(docOf(mine).strikes[seat]).toBeUndefined();
  });

  it('setAfk / take back is a seats-only change at the same seq', async () => {
    const doc = makeDoc('hh');
    const t = table(doc, [{ me: PIDS[0], owner: true }, { me: PIDS[1] }]);
    await flush();
    const r = await t.sessions[0]!.setAfk('s1', true);
    expect(r).toEqual({ ok: true, seq: 0 });
    await flush();
    expect(docOf(t.sessions[1]!).seats.s1?.afk).toBe(true);
    expect(t.sessions[1]!.view.get().tamper).toBeNull();
    expect((await t.sessions[1]!.setAfk('s1', false)).ok).toBe(true);
    await flush();
    expect(docOf(t.sessions[0]!).seats.s1?.afk).toBeUndefined();
  });

  it('reports a state from another version and never touches it', async () => {
    const doc = makeDoc('hh');
    const server = new MemoryServer({ data: { rooms: { ROOM1: { state: { ...record(doc), v: 999 } } } } });
    const onVersion = vi.fn();
    const s = new Session({ db: new MemoryDb(server), roomPath: 'rooms/ROOM1', me: PIDS[0], code: 'ROOM1', online: true, onVersion });
    await flush();
    expect(onVersion).toHaveBeenCalled();
    expect(s.current()).toBeNull();
    await s.dispose();
  });

  it('dispose hands the lease back', async () => {
    const doc = makeDoc('hb');
    const t = table(doc, [{ me: PIDS[0], owner: true }]);
    await flush();
    expect(t.sessions[0]!.view.get().driver).toBe(true);
    expect(t.server.read('rooms/ROOM1/driver')).toMatchObject({ pid: PIDS[0] });
    await t.sessions[0]!.dispose();
    expect(t.server.read('rooms/ROOM1/driver')).toBeNull();
  });

  it('a commit stamps at no earlier than the last write, so it never goes back', async () => {
    const doc = makeDoc('hh');
    const server = new MemoryServer({ data: { rooms: { ROOM1: { state: record(doc, T0 + 60_000) } } } });
    const turn: SeatId = doc.game.turn.seat;
    const s = new Session({ db: new MemoryDb(server), roomPath: 'rooms/ROOM1', me: doc.seats[turn]!.ctrl, code: 'ROOM1', online: false, alwaysDrive: true });
    await flush();
    expect((await s.dispatch(turn, { k: 'roll' })).ok).toBe(true);
    expect(server.read<{ at: number }>('rooms/ROOM1/state')!.at).toBe(T0 + 60_000);
    expect(docOf(s).recent.at(-1)!.at).toBe(T0 + 60_000);
    await s.dispose();
  });
});
