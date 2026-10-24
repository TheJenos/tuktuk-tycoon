import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetRoom, freeRoomPlayerId, pidInUse, rememberRoom, savedSeats } from '../rejoin';
import { memoryStorage, PIDS } from './helpers';

/* Seat memory across tabs: a second open tab of the same browser must not enter a room as the first tab's player. */

/** Another tab of this browser, in `code` as `pid` (answers the who-is-using-this-id question) */
function otherTab(pid: string): () => void {
  const ch = new BroadcastChannel('tuktuk-tabs');
  ch.onmessage = (e: MessageEvent<{ q?: string; pid?: string; id?: string }>) => {
    if (e.data.q === 'who' && e.data.pid === pid) ch.postMessage({ a: 'mine', pid, id: e.data.id });
  };
  return () => ch.close();
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('sessionStorage', memoryStorage());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('rejoin across tabs', () => {
  it('reuses the remembered id when no other tab is using it (the tab was closed)', async () => {
    rememberRoom('ABCDE', PIDS[0]);
    forgetRoom('ABCDE');
    vi.stubGlobal('sessionStorage', memoryStorage());
    expect(await freeRoomPlayerId('ABCDE', undefined, () => 'p_FRESH0000001')).toBe(PIDS[0]);
  });

  it('gives a second open tab a new player instead of the host\'s id', async () => {
    rememberRoom('ABCDE', PIDS[0]);
    forgetRoom('ABCDE');
    const close = otherTab(PIDS[0]);
    try {
      expect(await pidInUse(PIDS[0])).toBe(true);
      expect(await pidInUse(PIDS[1])).toBe(false);
      expect(await freeRoomPlayerId('ABCDE', undefined, () => 'p_FRESH0000001')).toBe('p_FRESH0000001');
      // A duplicated tab carries the first one's session id too: still a new player
      expect(await freeRoomPlayerId('ABCDE', PIDS[0], () => 'p_FRESH0000002')).toBe('p_FRESH0000002');
    } finally {
      close();
    }
  });

  it('answers for the rooms this tab is in, until it leaves them', async () => {
    rememberRoom('ROOMA', PIDS[2]);
    const asker = new BroadcastChannel('tuktuk-tabs');
    const ask = () => new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 250);
      asker.onmessage = (e: MessageEvent<{ a?: string; id?: string }>) => {
        if (e.data.a === 'mine' && e.data.id === 'Q1') (clearTimeout(timer), resolve(true));
      };
      asker.postMessage({ q: 'who', pid: PIDS[2], id: 'Q1' });
    });
    try {
      expect(await ask()).toBe(true);
      forgetRoom('ROOMA', { seat: true });
      expect(await ask()).toBe(false);
      expect(savedSeats()).toEqual([]);
    } finally {
      asker.close();
    }
  });
});
