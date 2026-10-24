import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomConnection } from '../../net/network';
import type { Session } from '../../net/session';

/*
 * The screen router: entering and leaving rooms and local games keeps the stage's session and the address bar in
 * step, and a room that closes under us goes back to the lobby with the reason.
 */

let url = '';

beforeEach(() => {
  url = 'https://tuktuk.test/?room=ABCDE&frame_id=7';
  vi.stubGlobal('location', {
    get href() {
      return url;
    },
    get pathname() {
      return new URL(url).pathname;
    },
    get search() {
      return new URL(url).search;
    },
    get hash() {
      return new URL(url).hash;
    },
  });
  vi.stubGlobal('history', { replaceState: (_: unknown, __: string, next: string) => (url = new URL(next, url).href) });
  vi.resetModules();
});
afterEach(() => vi.unstubAllGlobals());

const load = async () => ({ ...(await import('../app')), ...(await import('../session')) });

type Spy = ReturnType<typeof vi.fn>;
const fakeConn = (code = 'TEST1') => ({ code, leave: vi.fn(() => Promise.resolve()) }) as unknown as RoomConnection & { leave: Spy };
const fakeSession = () => ({ dispose: vi.fn(() => Promise.resolve()), current: () => ({ gid: 'g_TEST' }) }) as unknown as Session & { dispose: Spy };

describe('app screens', () => {
  it('reads the invite once', async () => {
    const { launchIntent, takeLaunch } = await load();
    expect(launchIntent().invite).toBe('ABCDE');
    expect(takeLaunch().invite).toBe('ABCDE');
    expect(takeLaunch().invite).toBeNull();
  });

  it('a room: #CODE in the address, the stage gets the game once it starts, a close goes back with the reason', async () => {
    const { appStore, enterRoom, roomView, sessionStore } = await load();
    const { view, handlers } = roomView();
    const conn = fakeConn();
    const room = { conn, view, discord: false };
    enterRoom(room);
    expect(url).toBe('https://tuktuk.test/?frame_id=7#TEST1');
    expect(appStore.get().screen).toEqual({ k: 'room', room });
    expect(sessionStore.get().session).toBeNull();

    handlers.onOwner?.('p_ALICE0000001', 'Alice');
    expect(view.get().owner).toEqual({ id: 'p_ALICE0000001', name: 'Alice' });
    const game = fakeSession();
    handlers.onSession?.(game);
    expect(view.get()).toMatchObject({ game, gid: 'g_TEST' });
    expect(sessionStore.get().session).toBe(game);

    handlers.onClosed?.('kicked');
    expect(appStore.get().screen).toEqual({ k: 'lobby', notice: 'You were removed from that room.' });
    expect(sessionStore.get().session).toBeNull();
    expect(conn.leave).toHaveBeenCalledTimes(1);
    expect(url).toBe('https://tuktuk.test/?frame_id=7');
  });

  it('leaving only acts on the room on screen', async () => {
    const { appStore, enterRoom, leaveRoom, roomView } = await load();
    const a = { conn: fakeConn('AAAAA'), view: roomView().view, discord: false };
    const b = { conn: fakeConn('BBBBB'), view: roomView().view, discord: false };
    enterRoom(b);
    leaveRoom(a);
    expect(appStore.get().screen.k).toBe('room');
    expect(a.conn.leave).not.toHaveBeenCalled();
    leaveRoom(b);
    expect(appStore.get().screen.k).toBe('lobby');
    expect(b.conn.leave).toHaveBeenCalledTimes(1);
  });

  it('a local game: the stage shows it, leaving disposes it and leaves the address alone', async () => {
    const { appStore, enterLocal, leaveLocal, sessionStore } = await load();
    const session = fakeSession();
    enterLocal(session);
    expect(sessionStore.get().session).toBe(session);
    expect(appStore.get().screen).toEqual({ k: 'local', session });
    leaveLocal(session);
    expect(session.dispose).toHaveBeenCalledTimes(1);
    expect(appStore.get().screen).toEqual({ k: 'lobby', notice: null });
    expect(sessionStore.get().session).toBeNull();
    expect(url).toBe('https://tuktuk.test/?room=ABCDE&frame_id=7');
  });
});
