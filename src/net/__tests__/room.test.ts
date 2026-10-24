import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RULES_VERSION } from '../../rules';
import { ONLINE_TIMERS } from '../../shared/timing';
import { TOKENS } from '../../shared/tokens';
import { MemoryDb, MemoryServer, type Db } from '../db';
import { EMPTY_GRACE_MS, RoomConnection, RoomError, watchRooms, type ClosedReason, type LobbyRecord, type RoomSummary } from '../network';
import { rememberedPid, roomPlayerId } from '../rejoin';
import type { StateRecord } from '../session';
import { flush, memoryStorage, PIDS, runUntil, useClock } from './helpers';

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

async function room(o: { bots?: number; maxSeats?: number; owner?: string } = {}) {
  const server = new MemoryServer();
  const db = new MemoryDb(server);
  const owner = await RoomConnection.create(db, {
    me: o.owner ?? PIDS[0],
    host: 'Alice',
    name: 'Test room',
    timers: ONLINE_TIMERS,
    maxSeats: o.maxSeats,
    bots: Array.from({ length: o.bots ?? 0 }, () => ({ skill: 'normal' as const })),
  });
  await flush();
  const join = async (me: string, name: string, opts: { seat?: boolean } = {}, handlers = {}) => {
    const d = new MemoryDb(server);
    const c = await RoomConnection.join(d, owner.code, { me, name, ...opts }, handlers);
    await flush();
    return { c, db: d };
  };
  return { server, db, owner, code: owner.code, join };
}

describe('RoomConnection: waiting room', () => {
  it('creates a room with the creator seated and its bots, and lists it', async () => {
    const watcher = new MemoryDb(new MemoryServer());
    void watcher;
    const { server, owner, code } = await room({ bots: 1 });
    expect(code).toMatch(/^[A-Z0-9]{5}$/);
    expect(owner.isOwner()).toBe(true);
    expect(lobbyOf(server, code)).toMatchObject({
      name: 'Test room', host: 'Alice', hostId: PIDS[0], status: 'waiting', v: RULES_VERSION, seatsTaken: 2, members: { [PIDS[0]]: 'Alice' },
    });
    const setup = owner.setup()!;
    expect(setup.locked).toBe('');
    expect(setup.seats.s0).toMatchObject({ kind: 'human', ctrl: PIDS[0], token: TOKENS[0].id });
    expect(setup.seats.s1).toMatchObject({ kind: 'bot', ctrl: '', skill: 'normal' });
    expect(server.read(`rooms/${code}/presence/${PIDS[0]}`)).toMatchObject({ name: 'Alice', seat: 's0', vis: true });

    let rooms: RoomSummary[] = [];
    const stop = watchRooms(new MemoryDb(server), (r) => (rooms = r));
    await flush();
    expect(rooms).toEqual([expect.objectContaining({ code, name: 'Test room', status: 'waiting', seatsTaken: 2, players: ['Alice'], otherVersion: false })]);
    stop();
  });

  it('joining claims a free seat by transaction: unique tokens, the seat cap, then spectating', async () => {
    const { server, code, join } = await room({ bots: 1, maxSeats: 3 });
    const { c: bob } = await join(PIDS[1], 'Bob');
    expect(bob.mySeat()).toBe('s2');
    const bobSeat = bob.setup()!.seats.s2!;
    const tokens = Object.values(bob.setup()!.seats).map((s) => s!.token);
    expect(new Set(tokens).size).toBe(3);
    expect(bobSeat.ctrl).toBe(PIDS[1]);
    expect(lobbyOf(server, code)?.seatsTaken).toBe(3);
    await expect(bob.claimSeat(TOKENS[0].id)).rejects.toMatchObject({ code: 'token' });

    const { c: carol } = await join(PIDS[2], 'Carol');
    expect(carol.mySeat()).toBeNull();
    await expect(carol.claimSeat()).rejects.toMatchObject({ code: 'full' });
    await bob.leaveSeat();
    await flush();
    expect(await carol.claimSeat()).toBe('s2');
    await flush();
    expect(server.read(`rooms/${code}/presence/${PIDS[2]}/seat`)).toBe('s2');
    expect(Object.keys(lobbyOf(server, code)?.members ?? {}).sort()).toEqual([PIDS[0], PIDS[1], PIDS[2]]);
  });

  it('owner-only edits: bots and rules', async () => {
    const { owner, join } = await room();
    const bot = await owner.addBot('hard');
    await owner.editBot(bot, 'easy');
    await owner.setRules({ speedDie: true, turnTimer: 30 });
    await flush();
    expect(owner.setup()!.seats[bot]).toMatchObject({ kind: 'bot', skill: 'easy' });
    expect(owner.setup()!.rules).toMatchObject({ speedDie: true, turnTimer: 30 });
    expect(owner.lobby()?.speedDie).toBe(true);
    const { c: bob } = await join(PIDS[1], 'Bob');
    expect(() => bob.addBot()).toThrow(RoomError);
    await owner.removeBot(bot);
    await flush();
    expect(owner.setup()!.seats[bot]).toBeUndefined();
  });

  it('re-registers presence after a dropped connection', async () => {
    const { server, db, code } = await room();
    db.disconnect();
    expect(lobbyOf(server, code)?.members).toBeUndefined();
    db.reconnect();
    await flush();
    expect(lobbyOf(server, code)?.members).toEqual({ [PIDS[0]]: 'Alice' });
    expect(server.read(`rooms/${code}/presence/${PIDS[0]}`)).toBeTruthy();
  });

  it('kick: the player is told, loses the seat and cannot come back', async () => {
    const { owner, server, code, join } = await room();
    const closed: ClosedReason[] = [];
    const { c: bob } = await join(PIDS[1], 'Bob', {}, { onClosed: (why: ClosedReason) => closed.push(why) });
    expect(bob.mySeat()).toBe('s1');
    await owner.kick(PIDS[1]);
    await flush();
    expect(closed).toEqual(['kicked']);
    expect(owner.setup()!.seats.s1).toBeUndefined();
    await expect(RoomConnection.join(new MemoryDb(server), code, { me: PIDS[1], name: 'Bob' })).rejects.toMatchObject({ code: 'kicked' });
  });

  it('refuses a room made by another version, and a closed one', async () => {
    const server = new MemoryServer({ data: { lobby: { OLD01: { name: 'Old', host: 'X', hostId: PIDS[3], createdAt: 1, status: 'waiting', v: RULES_VERSION + 1 } } } });
    await expect(RoomConnection.join(new MemoryDb(server), 'OLD01', { me: PIDS[0], name: 'A' })).rejects.toMatchObject({ code: 'version' });
    await expect(RoomConnection.join(new MemoryDb(server), 'NONE1', { me: PIDS[0], name: 'A' })).rejects.toMatchObject({ code: 'closed' });
  });
});

describe('RoomConnection: owner', () => {
  it('a joiner whose id sorts first does not take over a room whose owner is here', async () => {
    const { server, code, join } = await room({ owner: PIDS[3] });
    const { c: alice } = await join(PIDS[0], 'Ann');
    expect(alice.isOwner()).toBe(false);
    expect(alice.owner()).toBe(PIDS[3]);
    expect(lobbyOf(server, code)?.hostId).toBe(PIDS[3]);
  });

  it('when the owner goes, a seated human inherits before a spectator', async () => {
    const { server, db, code, join } = await room();
    const { c: bob } = await join(PIDS[1], 'Bob', { seat: false });
    const { c: carol } = await join(PIDS[2], 'Carol');
    expect(bob.mySeat()).toBeNull();
    expect(carol.mySeat()).toBe('s1');
    db.kill();
    await flush();
    expect(lobbyOf(server, code)?.hostId).toBe(PIDS[2]);
    expect(carol.isOwner()).toBe(true);
    expect(bob.isOwner()).toBe(false);
  });
});

describe('RoomConnection: game', () => {
  it('start is idempotent per gid', async () => {
    const { owner, server, code, join } = await room({ bots: 1 });
    const { c: bob } = await join(PIDS[1], 'Bob');
    await expect(bob.start()).rejects.toMatchObject({ code: 'owner' });
    await Promise.all([owner.start(), owner.start()]);
    await flush();
    const state = stateOf(server, code)!;
    expect(state.seq).toBe(0);
    expect(owner.setup()!.locked).toBe(state.gid);
    expect(lobbyOf(server, code)?.status).toBe('playing');
    await owner.start();
    await flush();
    expect(stateOf(server, code)!.gid).toBe(state.gid);
    expect(owner.session()?.current()?.gid).toBe(state.gid);
    expect(bob.session()?.view.get().mySeats).toEqual(['s2']);
    expect(owner.session()?.view.get().mySeats).toEqual(['s0']);
  });

  it('the heir finishes a start the owner began and did not finish', async () => {
    const { owner, db, server, code, join } = await room({ bots: 1 });
    void owner;
    const { c: bob } = await join(PIDS[1], 'Bob');
    // The owner locked the setup and crashed before creating the game
    server.write(`rooms/${code}/setup/locked`, 'g_CRASHED0001');
    db.kill();
    expect(await runUntil(() => stateOf(server, code)?.gid === 'g_CRASHED0001', 10_000, 100)).toBe(true);
    expect(bob.isOwner()).toBe(true);
    await flush();
    expect(lobbyOf(server, code)?.status).toBe('playing');
    expect(bob.session()?.current()?.gid).toBe('g_CRASHED0001');
  });

  it('a spectator sees the game read-only', async () => {
    const { owner, code, server, join } = await room({ bots: 1 });
    await owner.start();
    await flush();
    const { c: carol } = await join(PIDS[2], 'Carol');
    const s = carol.session()!;
    expect(s.current()?.gid).toBe(stateOf(server, code)!.gid);
    expect(s.view.get().mySeats).toEqual([]);
    expect(carol.mySeat()).toBeNull();
    const seat = s.current()!.game.turn.seat;
    expect(await s.dispatch(seat, { k: 'roll' })).toMatchObject({ ok: false, code: 'notYourSeat' });
    expect(server.read(`rooms/${code}/presence/${PIDS[2]}/seat`)).toBe('');
  });

  it('a spectator coming in from the Rooms list is shown the running game, though the lobby watch answers from cache', async () => {
    const { owner, server, code } = await room({ bots: 1 });
    await owner.start();
    await flush();
    // The Rooms list keeps all of lobby/ cached, so the SDK answers a new lobby/{code} watch synchronously, as it is
    // registered: before the room has subscribed to its game's view. Nothing else changes at a quiet table.
    const inner: Db = new MemoryDb(server);
    const cached: Db = {
      get: (p) => inner.get(p),
      set: (p, v) => inner.set(p, v),
      update: (p, v) => inner.update(p, v),
      remove: (p) => inner.remove(p),
      transact: (p, fn) => inner.transact(p, fn),
      watch: (p, cb, onError) => {
        if (p.startsWith('lobby/')) cb(server.read(p));
        return inner.watch(p, cb, onError);
      },
      onDisconnectRemove: (p) => inner.onDisconnectRemove(p),
      cancelOnDisconnect: (p) => inner.cancelOnDisconnect(p),
      connected: (cb) => inner.connected(cb),
      serverOffset: (cb) => inner.serverOffset(cb),
      pushKey: (p) => inner.pushKey(p),
    };
    const onSession = vi.fn();
    const carol = await RoomConnection.join(cached, code, { me: PIDS[2], name: 'Carol' }, { onSession });
    await flush();
    expect(carol.session()?.current()?.gid).toBe(stateOf(server, code)!.gid);
    expect(onSession).toHaveBeenCalledTimes(1);
    expect(onSession).toHaveBeenCalledWith(carol.session());
    expect(carol.mySeat()).toBeNull();
  });

  it('rejoins its seat after closing the tab (same player id from storage)', async () => {
    const { owner, server, code, join } = await room({ bots: 1 });
    const { c: bob, db: bobDb } = await join(PIDS[1], 'Bob');
    await owner.start();
    await flush();
    expect(rememberedPid(code)).toBe(PIDS[1]);
    void bob;
    bobDb.kill();
    await flush();
    const pid = roomPlayerId(code);
    expect(pid).toBe(PIDS[1]);
    const back = await RoomConnection.join(new MemoryDb(server), code, { me: pid, name: 'Bob' });
    await flush();
    expect(back.session()?.view.get().mySeats).toEqual(['s2']);
    expect(back.mySeat()).toBe('s2');
  });

  it('owner seat controls: let a bot play, take back, give a seat away', async () => {
    const { owner, join } = await room({ bots: 1 });
    const { c: bob } = await join(PIDS[1], 'Bob');
    const { c: carol } = await join(PIDS[2], 'Carol', { seat: false });
    await owner.start();
    await flush();
    const seq = owner.session()!.current()!.seq;
    expect((await owner.letBotPlay('s2')).ok).toBe(true);
    await flush();
    expect(bob.session()!.current()!.seats.s2?.afk).toBe(true);
    expect(bob.session()!.current()!.seq).toBe(seq);
    expect(bob.session()!.view.get().tamper).toBeNull();
    expect((await bob.takeBackControl('s2')).ok).toBe(true);
    expect(await carol.takeBackControl('s2')).toMatchObject({ ok: false, code: 'notYourSeat' });
    expect((await owner.assignSeat('s2', PIDS[2])).ok).toBe(true);
    await flush();
    expect(carol.session()!.view.get().mySeats).toEqual(['s2']);
    expect(bob.session()!.view.get().mySeats).toEqual([]);
  });

  it('finish now, then a rematch with a new gid', async () => {
    const { owner, server, code, join } = await room({ bots: 1 });
    await join(PIDS[1], 'Bob');
    await owner.start();
    await flush();
    await runUntil(() => owner.session()!.isDriver(), 10_000, 100);
    const first = stateOf(server, code)!.gid;
    // Only once no other human is playing (Bob's seat goes to a bot)
    expect((await owner.finishNow()).ok).toBe(false);
    expect((await owner.letBotPlay('s2')).ok).toBe(true);
    await flush();
    expect((await owner.finishNow()).ok).toBe(true);
    await flush();
    expect(owner.session()!.current()!.game.phase.k).toBe('over');
    expect(lobbyOf(server, code)?.status).toBe('finished');
    await owner.rematch();
    await flush();
    const next = stateOf(server, code)!;
    expect(next.gid).not.toBe(first);
    expect(next.seq).toBe(0);
    expect(lobbyOf(server, code)?.status).toBe('playing');
    expect(owner.session()!.current()!.gid).toBe(next.gid);
  });
});

describe('room cleanup', () => {
  it('the last one out of a waiting room deletes it (after reading members again)', async () => {
    const { owner, server, code, join } = await room();
    const { c: bob } = await join(PIDS[1], 'Bob');
    await bob.leave();
    expect(lobbyOf(server, code)).not.toBeNull();
    expect(owner.setup()?.seats.s1).toBeUndefined();
    await owner.leave();
    expect(lobbyOf(server, code)).toBeNull();
    expect(server.read(`rooms/${code}`)).toBeNull();
  });

  it('the lobby list sweeps a room left empty by a crash, after the grace time', async () => {
    const { server, db, code } = await room();
    let rooms: RoomSummary[] = [];
    const stop = watchRooms(new MemoryDb(server), (r) => (rooms = r));
    await flush();
    expect(rooms.map((r) => r.code)).toEqual([code]);
    db.kill();
    await flush();
    expect(rooms).toEqual([]);
    await vi.advanceTimersByTimeAsync(EMPTY_GRACE_MS - 2_000);
    expect(lobbyOf(server, code)).not.toBeNull();
    await vi.advanceTimersByTimeAsync(3_000);
    await flush();
    expect(lobbyOf(server, code)).toBeNull();
    expect(server.read(`rooms/${code}`)).toBeNull();
    stop();
  });

  it('a player coming back within the grace time keeps the room', async () => {
    const { server, db, code } = await room();
    const stop = watchRooms(new MemoryDb(server), () => {});
    await flush();
    db.disconnect();
    await vi.advanceTimersByTimeAsync(EMPTY_GRACE_MS / 2);
    db.reconnect();
    await flush();
    await vi.advanceTimersByTimeAsync(EMPTY_GRACE_MS);
    await flush();
    expect(lobbyOf(server, code)?.members).toEqual({ [PIDS[0]]: 'Alice' });
    stop();
  });
});
