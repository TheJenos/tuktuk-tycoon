import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ONLINE_TIMERS } from '../../shared/timing';
import { MemoryDb, MemoryServer } from '../db';
import { createRoomWithCode, IDLE_GAME_MS, RoomConnection, type LobbyRecord, type SetupRecord } from '../network';
import { rememberedPid, savedSeats } from '../rejoin';
import type { StateRecord } from '../session';
import type { Batch } from '../types';
import { decodeDoc } from '../doc';
import { flush, memoryStorage, PIDS, runUntil, useClock } from './helpers';

/* Room lifecycle edge cases: rematches, leaving mid-game, Discord rooms reopened, lost acks, abandoned joins. */

beforeEach(() => {
  useClock();
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('sessionStorage', memoryStorage());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const lobbyOf = (server: MemoryServer, code: string) => server.read<LobbyRecord>(`lobby/${code}`);
const stateOf = (server: MemoryServer, code: string) => server.read<StateRecord>(`rooms/${code}/state`);
const docAt = (server: MemoryServer, code: string) => decodeDoc(stateOf(server, code)!.data);

async function room(o: { bots?: number; code?: string } = {}) {
  const server = new MemoryServer();
  const db = new MemoryDb(server);
  const owner = await RoomConnection.create(db, {
    me: PIDS[0],
    host: 'Alice',
    name: 'Test room',
    timers: ONLINE_TIMERS,
    bots: Array.from({ length: o.bots ?? 0 }, () => ({ skill: 'normal' as const })),
    ...(o.code ? { code: o.code } : {}),
  });
  await flush();
  const join = async (me: string, name: string) => {
    const d = new MemoryDb(server);
    const c = await RoomConnection.join(d, owner.code, { me, name });
    await flush();
    return { c, db: d };
  };
  return { server, db, owner, code: owner.code, join };
}

async function finishedGame(o: { bots?: number } = {}) {
  const r = await room({ bots: o.bots ?? 1 });
  await r.owner.start();
  await flush();
  await runUntil(() => r.owner.session()!.isDriver(), 10_000, 100);
  return r;
}

describe('rematch', () => {
  it('logs each game under its own gid, so the second game\'s first moves are not refused as overwrites', async () => {
    const { owner, server, code } = await finishedGame({ bots: 2 });
    await runUntil(() => (stateOf(server, code)?.seq ?? 0) >= 2, 300_000);
    const first = stateOf(server, code)!.gid;
    const batches: Batch[] = [];
    owner.session()!.onBatch((b) => batches.push(b));
    expect((await owner.finishNow()).ok).toBe(true);
    await flush();
    await owner.rematch();
    await flush();
    const second = stateOf(server, code)!.gid;
    // The view is told it is a new game (the last game's log and dice go)
    expect(batches.filter((b) => b.fresh)).toEqual([expect.objectContaining({ snap: true, seq: 0 })]);
    await runUntil(() => (stateOf(server, code)?.seq ?? 0) >= 1, 300_000);
    const log = server.read<Record<string, Record<string, unknown>>>(`rooms/${code}/log`)!;
    expect(Object.keys(log).sort()).toEqual([first, second].sort());
    expect(Object.keys(log[second]!)).toContain('m000001');
    expect(Object.keys(log[first]!)).toContain('m000001');
  });

  it('keeps the table as it ended: a kicked player\'s seat goes to a bot, one who left is played by a bot', async () => {
    const { owner, server, code, join } = await room({ bots: 1 });
    const { c: bob } = await join(PIDS[1], 'Bob');
    const { c: carol } = await join(PIDS[2], 'Carol');
    await owner.start();
    await flush();
    await runUntil(() => owner.session()!.isDriver(), 10_000, 100);
    const bobSeat = bob.mySeat()!;
    const carolSeat = carol.mySeat()!;
    await owner.kick(PIDS[1]);
    await carol.leave();
    await flush();
    expect(docAt(server, code).seats[carolSeat]).toMatchObject({ ctrl: PIDS[2], afk: true });
    expect((await owner.finishNow()).ok).toBe(true);
    await flush();
    await owner.rematch();
    await flush();
    const doc = docAt(server, code);
    expect(doc.seats[bobSeat]).toMatchObject({ kind: 'bot', ctrl: '' });
    expect(doc.seats[carolSeat]).toMatchObject({ kind: 'human', ctrl: PIDS[2], afk: true });
    expect(doc.seats.s0).toMatchObject({ kind: 'human', ctrl: PIDS[0] });
    expect(doc.seats.s0?.afk).toBeUndefined();
  });

  it('a double click starts exactly one new game, and the setup stays locked to it', async () => {
    const { owner, server, code } = await finishedGame();
    expect((await owner.finishNow()).ok).toBe(true);
    await flush();
    const first = stateOf(server, code)!.gid;
    const a = owner.rematch();
    const b = owner.rematch();
    expect(b).toBe(a);
    await Promise.all([a, b]);
    await flush();
    const next = stateOf(server, code)!;
    expect(next.gid).not.toBe(first);
    expect(next.seq).toBe(0);
    expect(server.read<SetupRecord>(`rooms/${code}/setup`)?.locked).toBe(next.gid);
    expect(lobbyOf(server, code)?.status).toBe('playing');
    // Once the new game runs, another rematch is refused instead of tearing it down
    await expect(owner.rematch()).rejects.toMatchObject({ code: 'started' });
    expect(stateOf(server, code)!.gid).toBe(next.gid);
  });
});

describe('leaving and finishing', () => {
  it('leaving a running game hands my seat to the driver until I come back', async () => {
    const { owner, server, code, join } = await room({ bots: 1 });
    const { c: bob } = await join(PIDS[1], 'Bob');
    await owner.start();
    await flush();
    const seat = bob.mySeat()!;
    await bob.leave();
    await flush();
    expect(docAt(server, code).seats[seat]).toMatchObject({ kind: 'human', ctrl: PIDS[1], afk: true });
    // Back by the invite link: the seat is still Bob's, and his own move takes it back
    const back = await RoomConnection.join(new MemoryDb(server), code, { me: PIDS[1], name: 'Bob' });
    await flush();
    expect(back.session()?.view.get().mySeats).toEqual([seat]);
    expect((await back.takeBackControl(seat)).ok).toBe(true);
    await flush();
    expect(docAt(server, code).seats[seat]?.afk).toBeUndefined();
  });

  it('Finish now is refused while another human is still playing', async () => {
    const { owner, join } = await room({ bots: 1 });
    const { c: bob } = await join(PIDS[1], 'Bob');
    await owner.start();
    await flush();
    expect(owner.othersPlaying()).toEqual([bob.mySeat()]);
    expect(await owner.finishNow()).toMatchObject({ ok: false, code: 'playing' });
    expect((await owner.letBotPlay(bob.mySeat()!)).ok).toBe(true);
    await flush();
    expect(owner.othersPlaying()).toEqual([]);
    expect((await owner.finishNow()).ok).toBe(true);
  });

  it('a room seeded with only turnTimer 0 has every human timer off', async () => {
    const { owner, server, code } = await room({ bots: 1 });
    server.write(`rooms/${code}/setup/rules`, { speedDie: false, turnTimer: 0 });
    await flush();
    await owner.start();
    await flush();
    expect(docAt(server, code).timers).toMatchObject({ turn: 0, decision: 0, debt: 0 });
  });
});

describe('kicked players', () => {
  it('keep their id, so the invite link meets the kick, and are not offered a rejoin', async () => {
    const { owner, server, code } = await room();
    const bobDb = new MemoryDb(server);
    const bob = await RoomConnection.join(bobDb, code, { me: PIDS[1], name: 'Bob' });
    await flush();
    expect(bob.mySeat()).toBe('s1');
    await owner.kick(PIDS[1]);
    await flush();
    expect(rememberedPid(code)).toBe(PIDS[1]);
    expect(savedSeats().map((s) => s.code)).not.toContain(code);
  });
});

describe('Discord rooms (fixed code)', () => {
  it('reopening the Activity after everyone closed it rejoins the running game instead of wiping it', async () => {
    const { owner, db, server, code } = await room({ bots: 1, code: 'DABCDEFG' });
    await owner.start();
    await flush();
    const gid = stateOf(server, code)!.gid;
    db.kill();
    await vi.advanceTimersByTimeAsync(5_000);
    await flush();
    expect(lobbyOf(server, code)?.members).toBeUndefined();
    const again = await RoomConnection.joinOrCreate(new MemoryDb(server), code, { me: PIDS[0], host: 'Alice', name: 'Discord game' });
    await flush();
    expect(stateOf(server, code)?.gid).toBe(gid);
    expect(lobbyOf(server, code)?.status).toBe('playing');
    expect(again.session()?.view.get().mySeats).toEqual(['s0']);
  });

  it('an abandoned game is taken over once it has been idle for a day', async () => {
    const server = new MemoryServer();
    const at = Date.now();
    const old: LobbyRecord = { name: 'Old', host: 'X', hostId: PIDS[3], createdAt: at, status: 'playing', speedDie: false, maxSeats: 4, seatsTaken: 2, public: false, lastMoveAt: at };
    server.write('lobby/DOLDROOM', old);
    const mine = (createdAt: number): LobbyRecord => ({ ...old, name: 'New', hostId: PIDS[0], createdAt });
    expect(await createRoomWithCode(new MemoryDb(server), 'DOLDROOM', mine(at + 60_000))).toBe(false);
    expect(await createRoomWithCode(new MemoryDb(server), 'DOLDROOM', mine(at + IDLE_GAME_MS + 1))).toBe(true);
  });
});

describe('lost acks (the SDK runs a committed transaction again)', () => {
  it('adding and removing a bot happens once and reports success', async () => {
    const { owner, server } = await room();
    server.loseAcks(1);
    const seat = await owner.addBot('easy');
    await flush();
    expect(Object.keys(owner.setup()!.seats).sort()).toEqual(['s0', seat]);
    server.loseAcks(1);
    await expect(owner.removeBot(seat)).resolves.toBeUndefined();
    await flush();
    expect(Object.keys(owner.setup()!.seats)).toEqual(['s0']);
  });

  it('creating a room keeps the one record it wrote', async () => {
    const server = new MemoryServer();
    server.loseAcks(1);
    const conn = await RoomConnection.create(new MemoryDb(server), { me: PIDS[0], host: 'Alice', name: 'Mine', timers: ONLINE_TIMERS });
    await flush();
    expect(Object.keys(server.read<Record<string, unknown>>('lobby') ?? {})).toEqual([conn.code]);
  });
});

describe('abandoned joins', () => {
  it('abandon() lets go of the room without touching the member entry or the seat', async () => {
    const { server, code, join } = await room();
    const { c: first } = await join(PIDS[1], 'Bob');
    const { c: second } = await join(PIDS[1], 'Bob');
    expect(second.mySeat()).toBe('s1');
    first.abandon();
    await flush();
    expect(second.mySeat()).toBe('s1');
    expect(lobbyOf(server, code)?.members?.[PIDS[1]]).toBe('Bob');
    expect(server.read(`rooms/${code}/setup/seats/s1/ctrl`)).toBe(PIDS[1]);
  });
});
