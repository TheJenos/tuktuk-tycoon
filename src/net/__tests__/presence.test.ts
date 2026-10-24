import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ONLINE_TIMERS } from '../../shared/timing';
import { MemoryDb, MemoryServer } from '../db';
import { RoomConnection } from '../network';
import { flush, memoryStorage, PIDS, useClock } from './helpers';

beforeEach(() => {
  useClock();
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('sessionStorage', memoryStorage());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('RoomConnection: SessionView.presence', () => {
  it('marks each human seat online while its player is in the room, and never bots', async () => {
    const server = new MemoryServer();
    const alice = await RoomConnection.create(new MemoryDb(server), {
      me: PIDS[0], host: 'Alice', name: 'Presence', timers: ONLINE_TIMERS, bots: [{ skill: 'normal' }],
    });
    const bobDb = new MemoryDb(server);
    const bob = await RoomConnection.join(bobDb, alice.code, { me: PIDS[1], name: 'Bob' });
    await flush();
    // The room's session exists before the game, without a document (nothing to report yet)
    expect(alice.roomSession().view.get().presence).toBeUndefined();
    expect(alice.session()).toBeNull();

    await alice.start();
    await flush();
    const view = () => alice.roomSession().view.get();
    expect(view().doc).not.toBeNull();
    expect(view().presence).toEqual({ s0: 'online', s2: 'online' });
    expect(bob.roomSession().view.get().presence).toEqual({ s0: 'online', s2: 'online' });

    bobDb.disconnect();
    await flush();
    expect(view().presence).toEqual({ s0: 'online', s2: 'offline' });

    bobDb.reconnect();
    await flush();
    expect(view().presence).toEqual({ s0: 'online', s2: 'online' });
    await Promise.all([alice.leave(), bob.leave()]);
  });
});
