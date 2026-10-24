import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkInvariants } from '../../rules';
import { SEAT_COLORS, TOKENS } from '../../shared/tokens';
import { clearSoloSave, createLocalSession, hasSoloSave, LOCAL_PLAYER, SOLO_SAVE_KEY, type LocalSeat } from '../local';
import type { Batch } from '../types';
import { flush, memoryStorage, runUntil, useClock } from './helpers';

const seats = (kinds: string): LocalSeat[] =>
  [...kinds].map((k, i) => ({
    name: `${k === 'b' ? 'Bot' : 'Me'} ${i}`,
    token: TOKENS[i]!.id,
    color: SEAT_COLORS[i]!,
    kind: k === 'b' ? 'bot' : 'human',
    ...(k === 'b' ? { skill: 'normal' as const } : {}),
  }));

beforeEach(() => {
  useClock();
  vi.stubGlobal('localStorage', memoryStorage());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('createLocalSession', () => {
  it('plays a 4-bot game to the end, every batch verified and in seq order', async () => {
    const s = createLocalSession({ seats: seats('bbbb'), rules: { turnLimit: 24 }, seed: 11 });
    const batches: Batch[] = [];
    s.onBatch((b) => batches.push(b));
    expect(s.online).toBe(false);
    expect(s.code).toBeNull();

    const over = await runUntil(() => s.current()?.game.phase.k === 'over', 3_600_000, 500);
    expect(over).toBe(true);
    const v = s.view.get();
    expect(v.tamper).toBeNull();
    expect(v.driver).toBe(true);
    expect(v.mySeats).toEqual([]);

    expect(batches[0]?.snap).toBe(true);
    for (let i = 1; i < batches.length; i++) {
      expect(batches[i]!.snap).toBeFalsy();
      expect(batches[i]!.seq).toBe(batches[i - 1]!.seq + 1);
      expect(batches[i]!.state.seq).toBe(batches[i]!.seq);
    }
    const last = batches.at(-1)!;
    expect(last.seq).toBe(v.doc!.seq);
    expect(last.events.some((e) => e.t === 'over')).toBe(true);
    expect(checkInvariants(last.state)).toEqual([]);
    // A finished game is not offered as "Continue"
    expect(hasSoloSave()).toBe(false);
    await s.dispose();
  });

  it('gives the local player every human seat (hot-seat) and refuses the bots\' seats', async () => {
    const s = createLocalSession({ seats: seats('hhb'), seed: 3 });
    await flush();
    expect(s.view.get().mySeats).toEqual(['s0', 's1']);
    expect(s.me).toBe(LOCAL_PLAYER);
    const r = await s.dispatch('s2', { k: 'roll' });
    expect(r).toMatchObject({ ok: false, code: 'notYourSeat' });
    await s.dispose();
  });

  it('autosaves after each move and resumes from the save', async () => {
    clearSoloSave();
    const a = createLocalSession({ seats: seats('hb'), seed: 5 });
    await flush();
    expect(hasSoloSave()).toBe(true);
    const doc = a.current()!;
    const seat = doc.game.turn.seat;
    if (seat === 's0') {
      expect((await a.dispatch('s0', { k: 'roll' })).ok).toBe(true);
    } else {
      // The bot goes first: let it play until it is our turn
      await runUntil(() => a.current()!.game.turn.seat === 's0' && a.current()!.game.phase.k === 'preRoll', 60_000);
    }
    await flush();
    const seq = a.current()!.seq;
    expect(seq).toBeGreaterThan(0);
    const saved = JSON.parse(localStorage.getItem(SOLO_SAVE_KEY)!) as { doc: string };
    expect(JSON.parse(saved.doc).seq).toBe(seq);
    await a.dispose();

    const b = createLocalSession({ seats: [], resume: true });
    const first: Batch[] = [];
    b.onBatch((x) => first.push(x));
    await flush();
    expect(b.current()?.seq).toBe(seq);
    expect(b.current()?.gid).toBe(doc.gid);
    expect(first[0]).toMatchObject({ snap: true, seq });
    await b.dispose();
  });

  it('works without any storage at all', async () => {
    vi.stubGlobal('localStorage', undefined);
    const s = createLocalSession({ seats: seats('hb'), seed: 9 });
    await flush();
    expect(s.current()?.seq).toBe(0);
    expect(hasSoloSave()).toBe(false);
    await s.dispose();
  });
});
