import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { timeoutCommand, type SeatId } from '../../rules';
import { ONLINE_TIMERS } from '../../shared/timing';
import { SEAT_COLORS, TOKENS } from '../../shared/tokens';
import { MemoryDb, MemoryServer } from '../db';
import { applyEnvelope, createDoc, decodeDoc, encodeDoc } from '../doc';
import { createLocalSession, type LocalSeat } from '../local';
import { DEFAULT_ROOM_RULES, RoomConnection, roomConfig, toRoomRules, watchRooms, type RoomRules, type RoomSummary } from '../network';
import type { Doc, Envelope } from '../types';
import { envelope, flush, memoryStorage, PIDS, runUntil, seatList, T0, useClock } from './helpers';

/*
 * The room options the net layer applies: AFK after N timeouts, bot pace and level, the time limit, spectators and
 * late join, and every rule surviving the trip through setRules into a started game.
 */

beforeEach(() => {
  useClock();
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('sessionStorage', memoryStorage());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function must(d: Doc, env: Envelope): Doc {
  const r = applyEnvelope(d, env);
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r.doc;
}

const doc = (o: { afkStrikes?: number; timeLimit?: number; botPace?: number } = {}): Doc =>
  createDoc({ gid: 'g_TEST000001', seats: seatList('hh'), timers: ONLINE_TIMERS, seed: 7, at: T0, ...o });

const timeoutNow = (x: Doc): Doc => must(x, envelope(timeoutCommand(x.game)!, PIDS[1], x.deadline!.at));

const localSeats = (kinds: string): LocalSeat[] =>
  [...kinds].map((k, i) => ({
    name: `${k === 'b' ? 'Bot' : 'Me'} ${i}`,
    token: TOKENS[i]!.id,
    color: SEAT_COLORS[i]!,
    kind: k === 'b' ? 'bot' : 'human',
    ...(k === 'b' ? { skill: 'normal' as const } : {}),
  }));

describe('AFK after N timeouts (Doc.afkStrikes)', () => {
  it('one timeout is enough with afkStrikes 1', () => {
    let d = doc({ afkStrikes: 1 });
    expect(d.afkStrikes).toBe(1);
    const seat = d.game.turn.seat;
    d = timeoutNow(d);
    expect(d.strikes[seat]).toBe(1);
    expect(d.seats[seat]?.afk).toBe(true);
    // Carried from move to move and through storage
    expect(decodeDoc(encodeDoc(d)).afkStrikes).toBe(1);
  });

  it('never hands a seat over with afkStrikes 0', () => {
    let d = doc({ afkStrikes: 0 });
    for (let i = 0; i < 12 && d.game.phase.k !== 'over'; i++) d = timeoutNow(d);
    expect(Math.max(...Object.values(d.strikes).map((n) => n ?? 0))).toBeGreaterThanOrEqual(3);
    expect(Object.values(d.seats).some((s) => s?.afk)).toBe(false);
  });

  it('keeps the default (2) for a document without the field', () => {
    let d = doc();
    expect(d.afkStrikes).toBeUndefined();
    const seat = d.game.turn.seat;
    d = timeoutNow(d);
    expect(d.seats[seat]?.afk).toBeUndefined();
  });
});

describe('time limit (Doc.endsAt, system timeUp)', () => {
  it('sets endsAt from the start and refuses timeUp before it', () => {
    const d = doc({ timeLimit: 30 });
    expect(d.endsAt).toBe(T0 + 30 * 60_000);
    expect(d.timeLimit).toBe(30);
    const cmd = { by: 'system' as const, a: { k: 'timeUp' as const }, basis: d.seq };
    expect(applyEnvelope(d, envelope(cmd, PIDS[0], d.endsAt! - 1))).toMatchObject({ ok: false, code: 'early' });
    const r = applyEnvelope(d, envelope(cmd, PIDS[0], d.endsAt!));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.game.phase).toMatchObject({ k: 'over', why: 'timeUp' });
    // A room without a limit never ends this way
    const none = doc();
    expect(applyEnvelope(none, envelope({ ...cmd, basis: none.seq }, PIDS[0], T0 + 1e9))).toMatchObject({ ok: false, code: 'early' });
  });

  it('the driver ends a local game when the clock runs out', async () => {
    const s = createLocalSession({ seats: localSeats('bbb'), seed: 5, timeLimit: 1 });
    await flush();
    expect(s.current()!.endsAt).toBe(T0 + 60_000);
    const over = await runUntil(() => s.current()?.game.phase.k === 'over', 120_000, 500);
    expect(over).toBe(true);
    expect(s.current()!.game.phase).toMatchObject({ k: 'over', why: 'timeUp' });
    expect(Date.now()).toBeGreaterThanOrEqual(T0 + 60_000);
    await s.dispose();
  });
});

describe('bot pace and level', () => {
  it('a quicker pace plays more moves in the same time, and is saved with the game', async () => {
    const moves = async (pace: number) => {
      const s = createLocalSession({ seats: localSeats('bbbb'), seed: 9, pace });
      await flush();
      expect(s.current()!.botPace).toBe(pace === 1 ? undefined : pace);
      await runUntil(() => false, 60_000, 250);
      const seq = s.current()!.seq;
      await s.dispose();
      vi.setSystemTime(T0);
      return seq;
    };
    const quick = await moves(0.5);
    const slow = await moves(2);
    expect(quick).toBeGreaterThan(slow);
  });

  it('keeps the pace and level in the document', () => {
    const d = createDoc({ gid: 'g_TEST000001', seats: seatList('hb'), seed: 1, at: T0, botPace: 2, botSkill: 'expert' });
    expect(decodeDoc(encodeDoc(d))).toMatchObject({ botPace: 2, botSkill: 'expert' });
    // Anything else is not kept
    const odd = createDoc({ gid: 'g_TEST000001', seats: seatList('hb'), seed: 1, at: T0, botPace: 7 });
    expect(odd.botPace).toBeUndefined();
  });
});

async function room(over: Partial<RoomRules> = {}, bots = 1) {
  const server = new MemoryServer();
  const owner = await RoomConnection.create(new MemoryDb(server), {
    me: PIDS[0],
    host: 'Alice',
    name: 'Options room',
    timers: ONLINE_TIMERS,
    options: {
      ...(over.spectators !== undefined ? { spectators: over.spectators } : {}),
      ...(over.lateJoin !== undefined ? { lateJoin: over.lateJoin } : {}),
      ...(over.botSkill ? { botSkill: over.botSkill } : {}),
    },
    bots: Array.from({ length: bots }, () => ({ skill: 'normal' as const })),
  });
  await flush();
  return { server, owner, code: owner.code };
}

describe('rooms: rules round trip', () => {
  it('every option set through setRules reaches the game, and bad values are dropped', async () => {
    const { owner, server, code } = await room();
    const patch: Partial<RoomRules> = {
      goSalary: 300, incomeFlat: 150, incomePct: 15, jailFine: 100, mortgagePct: 0, houses: 20, hotels: 8,
      doubleGoLanding: true, jackpot: true, incomeTaxMode: 'flat', auctions: false, buyAfterFirstLap: true, jailRent: false,
      threeDoublesJail: false, dealProperties: 2, endMode: 'firstBankrupt', trading: 'afterLap', tradeAfterLap: 3,
      auctionTimer: 12, decisionTimer: 30, debtTimer: 60, afkStrikes: 3, botPace: 2, botSkill: 'hard', spectators: false,
      lateJoin: true, timeLimit: 90,
    };
    await owner.setRules({ ...patch, endMode: 'sudden' as never, botPace: 3, incomeTaxMode: 'none' as never });
    await owner.setRules({ endMode: 'firstBankrupt' });
    await flush();
    const stored = server.read<RoomRules>(`rooms/${code}/setup/rules`)!;
    expect(stored).toMatchObject({ ...patch, botPace: 1, incomeTaxMode: 'choice' });
    await owner.setRules({ botPace: 2, incomeTaxMode: 'flat' });
    await flush();
    expect(owner.setup()!.rules).toMatchObject(patch);
    // The lobby record mirrors who may come in
    expect(server.read(`lobby/${code}`)).toMatchObject({ spectators: false, lateJoin: true });
    // A new bot comes at the room's level
    const bot = await owner.addBot();
    await flush();
    expect(owner.setup()!.seats[bot]?.skill).toBe('hard');

    await owner.start();
    await flush();
    const d = owner.session()!.current()!;
    expect(d.game.cfg).toMatchObject({
      goSalary: 300, incomeFlat: 150, incomePct: 15, jailFine: 100, mortgagePct: 0, houses: 20, hotels: 8,
      doubleGoLanding: true, jackpot: true, incomeTaxMode: 'flat', auctions: false, buyAfterFirstLap: true, jailRent: false,
      threeDoublesJail: false, dealProperties: 2, endMode: 'firstBankrupt', trading: 'afterLap', tradeAfterLap: 3,
    });
    expect(d.timers).toEqual({ turn: ONLINE_TIMERS.turn, decision: 30, auction: 12, debt: 60, reaction: ONLINE_TIMERS.reaction });
    expect(d).toMatchObject({ afkStrikes: 3, botPace: 2, botSkill: 'hard', timeLimit: 90 });
    expect(d.endsAt).toBeGreaterThanOrEqual(T0 + 90 * 60_000);
    expect(d.endsAt).toBeLessThanOrEqual(Date.now() + 90 * 60_000);
  });

  it('the board: picked at creation, changed by setRules, mirrored to the lobby and played', async () => {
    const server = new MemoryServer();
    const owner = await RoomConnection.create(new MemoryDb(server), {
      me: PIDS[0], host: 'Alice', name: 'Board room', timers: ONLINE_TIMERS, rules: { board: 'colombo' }, bots: [{ skill: 'normal' }],
    });
    await flush();
    const code = owner.code;
    expect(server.read(`rooms/${code}/setup/rules`)).toMatchObject({ board: 'colombo' });
    expect(server.read(`lobby/${code}`)).toMatchObject({ board: 'colombo' });
    await owner.setRules({ board: 'mars' });
    await flush();
    expect(owner.setup()!.rules.board).toBe('colombo');
    await owner.setRules({ board: 'south' });
    await flush();
    expect(owner.setup()!.rules.board).toBe('south');
    expect(server.read(`lobby/${code}`)).toMatchObject({ board: 'south' });
    let rooms: RoomSummary[] = [];
    const stop = watchRooms(new MemoryDb(server), (x) => (rooms = x));
    await flush();
    expect(rooms.find((x) => x.code === code)?.board).toBe('south');
    stop();
    await owner.start();
    await flush();
    expect(owner.session()!.current()!.game.cfg.board).toBe('south');
    // An unknown board never reaches a room; a room from before boards reads as the default board
    expect(toRoomRules({ board: 'mars' }).board).toBe('lanka');
    expect(roomConfig({ speedDie: false } as Partial<RoomRules>).rules.board).toBeUndefined();
  });

  it('toRoomRules and roomConfig agree, and old rooms get the defaults', () => {
    const r = toRoomRules({ jackpot: true, trading: 'off' }, ONLINE_TIMERS, { afkStrikes: 0, timeLimit: 45 });
    expect(Object.keys(r).sort()).toEqual(Object.keys(DEFAULT_ROOM_RULES).sort());
    const back = roomConfig(r);
    expect(back.rules).toMatchObject({ jackpot: true, trading: 'off', auctions: true });
    expect(back.options).toMatchObject({ afkStrikes: 0, timeLimit: 45, spectators: true, lateJoin: false, botPace: 1, botSkill: 'normal' });
    const old = roomConfig({ speedDie: true, turnTimer: 0 } as Partial<RoomRules>);
    expect(old.options).toEqual({ afkStrikes: 2, botPace: 1, botSkill: 'normal', spectators: true, lateJoin: false, timeLimit: 0 });
    expect(old.rules.jackpot).toBeUndefined();
  });
});

describe('rooms: spectators and late join', () => {
  it('late join: a spectator takes over a bot seat in the running game', async () => {
    const { owner, server } = await room({ lateJoin: true });
    await owner.start();
    await flush();
    const carol = await RoomConnection.join(new MemoryDb(server), owner.code, { me: PIDS[2], name: 'Carol' });
    await flush();
    expect(carol.mySeat()).toBeNull();
    expect(carol.takeableSeats()).toEqual(['s1']);
    expect(owner.takeableSeats()).toEqual([]);
    const r = await carol.takeSeat('s1' as SeatId);
    expect(r.ok).toBe(true);
    await flush();
    expect(carol.session()!.view.get().mySeats).toEqual(['s1']);
    expect(carol.session()!.current()!.seats.s1).toMatchObject({ kind: 'human', ctrl: PIDS[2], name: 'Carol' });
    expect(owner.session()!.view.get().tamper).toBeNull();
    // Only one seat each, and only seats nobody plays
    expect(await carol.takeSeat('s0' as SeatId)).toMatchObject({ ok: false, code: 'seated' });
  });

  it('without late join, taking a seat is refused', async () => {
    const { owner, server } = await room();
    await owner.start();
    await flush();
    const carol = await RoomConnection.join(new MemoryDb(server), owner.code, { me: PIDS[2], name: 'Carol' });
    await flush();
    expect(carol.takeableSeats()).toEqual([]);
    expect(await carol.takeSeat('s1' as SeatId)).toMatchObject({ ok: false, code: 'lateJoin' });
  });

  it('no spectators: a seat-less join is refused; with late join a running game seats the joiner instead', async () => {
    const closed = await room({ spectators: false }, 1);
    await closed.owner.start();
    await flush();
    await expect(RoomConnection.join(new MemoryDb(closed.server), closed.code, { me: PIDS[2], name: 'Carol' })).rejects.toMatchObject({ code: 'spectators' });
    await flush();
    expect(Object.keys(closed.server.read<Record<string, string>>(`lobby/${closed.code}/members`) ?? {})).toEqual([PIDS[0]]);

    const open = await room({ spectators: false, lateJoin: true }, 1);
    await open.owner.start();
    await flush();
    const dan = await RoomConnection.join(new MemoryDb(open.server), open.code, { me: PIDS[3], name: 'Dan' });
    await flush();
    expect(dan.session()!.view.get().mySeats).toEqual(['s1']);

    let rooms: RoomSummary[] = [];
    const stop = watchRooms(new MemoryDb(open.server), (x) => (rooms = x));
    await flush();
    expect(rooms.find((x) => x.code === open.code)).toMatchObject({ spectators: false, lateJoin: true });
    stop();
  });
});
