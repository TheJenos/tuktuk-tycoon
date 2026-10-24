import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryDb, MemoryServer } from '../db';
import { flush, useClock } from './helpers';

beforeEach(useClock);
afterEach(() => vi.useRealTimers());

describe('MemoryDb', () => {
  it('stores like RTDB: nulls and empty objects vanish, undefined throws', async () => {
    const db = new MemoryDb();
    await db.set('a', { b: 1, c: null, d: {} });
    expect(await db.get('a')).toEqual({ b: 1 });
    await db.update('a', { b: null, 'e/f': 2 });
    expect(await db.get('a')).toEqual({ e: { f: 2 } });
    await expect(db.set('x', { y: undefined })).rejects.toThrow(/undefined/);
    await db.remove('a');
    expect(await db.get('a')).toBeNull();
  });

  it('delivers the value now and on every change, to every client, in order', async () => {
    const server = new MemoryServer();
    const a = new MemoryDb(server);
    const b = new MemoryDb(server);
    const seen: unknown[] = [];
    b.watch('room/x', (v) => seen.push(v));
    await flush();
    await a.set('room/x', 1);
    await a.set('room', { x: 2, y: 3 });
    await a.set('room/y', 4); // x unchanged: not delivered again
    await flush();
    expect(seen).toEqual([null, 1, 2]);
  });

  it('transactions compare on the server: a cold cache retries with the real value', async () => {
    const server = new MemoryServer({ data: { n: 5 } });
    const db = new MemoryDb(server);
    const calls: Array<number | null> = [];
    const r = await db.transact<number>('n', (cur) => {
      calls.push(cur);
      return cur === null ? null : cur + 1;
    });
    expect(calls).toEqual([null, 5]);
    expect(r).toEqual({ committed: true, value: 6 });
    // Abort
    expect(await db.transact<number>('n', () => undefined)).toMatchObject({ committed: false });
    expect(server.read('n')).toBe(6);
  });

  it('serialises concurrent transactions from several clients (no lost update)', async () => {
    const server = new MemoryServer({ data: { n: 0 } });
    const clients = [0, 1, 2].map(() => new MemoryDb(server));
    clients.forEach((c) => c.watch('n', () => {}));
    await flush();
    await Promise.all(clients.flatMap((c) => [1, 2, 3].map(() => c.transact<number>('n', (cur) => (cur ?? 0) + 1))));
    expect(server.read('n')).toBe(9);
  });

  it('a lost ack makes the client run the update again on the committed value', async () => {
    const server = new MemoryServer({ data: { n: 0 } });
    const db = new MemoryDb(server);
    server.loseAcks(1);
    const seen: Array<number | null> = [];
    const r = await db.transact<number>('n', (cur) => {
      seen.push(cur);
      if (cur === null) return null;
      return cur === 0 ? 1 : undefined; // a second run sees its own write and aborts
    });
    expect(seen).toEqual([null, 0, 1]);
    expect(r.committed).toBe(false);
    expect(server.read('n')).toBe(1);
  });

  it('runs onDisconnect when a client is killed or drops, and reconnects', async () => {
    const server = new MemoryServer();
    const a = new MemoryDb(server);
    const ups: boolean[] = [];
    a.connected((up) => ups.push(up));
    await a.set('p/a', 'here');
    await a.set('p/keep', 'x');
    await a.onDisconnectRemove('p/a');
    a.disconnect();
    expect(server.read('p')).toEqual({ keep: 'x' });
    const write = a.set('p/a', 'back');
    await flush();
    expect(server.read('p/a')).toBeNull(); // queued while offline
    a.reconnect();
    await write;
    await flush();
    expect(server.read('p/a')).toBe('back');
    expect(ups).toEqual([true, false, true]);

    await a.onDisconnectRemove('p/a');
    await a.cancelOnDisconnect('p');
    const b = new MemoryDb(server);
    await b.onDisconnectRemove('p/keep');
    b.kill();
    expect(server.read('p')).toEqual({ a: 'back' });
    await expect(b.get('p')).rejects.toThrow(/gone/);
  });

  it('reports the configured server offset and makes time-ordered push keys', async () => {
    const db = new MemoryDb(new MemoryServer(), { offset: 1234 });
    let off = 0;
    db.serverOffset((ms) => (off = ms));
    await flush();
    expect(off).toBe(1234);
    const k1 = db.pushKey('e');
    vi.advanceTimersByTime(5);
    const k2 = db.pushKey('e');
    expect(k1 < k2).toBe(true);
  });
});
