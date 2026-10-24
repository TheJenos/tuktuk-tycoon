import { describe, expect, it } from 'vitest';
import { apply, createGame, defaultAction, awaiting, type GameEvent, type GameState, type SeatId } from '../../rules';
import type { Batch, GameSession, SessionView } from '../../net/types';
import { createStore } from '../../state/store';
import { sessionStore } from '../../state/session';
import type { AnimSpeed } from '../../ui/settings';
import { connectDirector, createDirector, director, playSpeed } from '../director';

/** A short game: the opening snap, then `n` batches of default moves */
function batches(n: number, seed = 3): { first: Batch; rest: Batch[] } {
  let { state } = createGame({}, [{ id: 's0', name: 'A' }, { id: 's1', name: 'B' }, { id: 's2', name: 'C' }], seed);
  const first: Batch = { seq: state.seq, events: [], state, snap: true };
  const rest: Batch[] = [];
  while (rest.length < n) {
    const seat = awaiting(state)[0] as SeatId;
    const a = defaultAction(state, seat);
    if (!a) break;
    const r = apply(state, { by: seat, a }, { check: false });
    if (!r.ok) throw new Error(r.error.message);
    state = r.state;
    rest.push({ seq: state.seq, events: r.events, state });
  }
  return { first, rest };
}

/** Lets pending promise callbacks and zero-delay timers run */
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/** Fake token API: every move waits until released (or aborted) */
function fakeTokens() {
  const calls: { seat: SeatId; speed: number; signal: AbortSignal; done: () => void }[] = [];
  return {
    calls,
    api: {
      move(seat: SeatId, _path: number[], _mode: 'walk' | 'back' | 'jump', signal: AbortSignal, speed: number) {
        return new Promise<void>((resolve) => {
          calls.push({ seat, speed, signal, done: resolve });
          signal.addEventListener('abort', () => resolve());
        });
      },
    },
  };
}

const moves = (bs: Batch[]) => bs.reduce((n, b) => n + b.events.filter((e) => e.t === 'move').length, 0);

describe('director', () => {
  it('plays batches in order and ends every batch on its state', async () => {
    const d = createDirector({ animSpeed: () => 'normal', hidden: () => false });
    const { first, rest } = batches(12);
    d.enqueue(first);
    expect(d.view.get().game).toBe(first.state);
    const tokens = fakeTokens();
    d.register('tokens', tokens.api);
    for (const b of rest) d.enqueue(b);
    expect(d.idle.get()).toBe(false);
    // Release each walk as it starts; the view must show the old position while the token walks.
    for (let guard = 0; guard < 200 && !d.idle.get(); guard++) {
      await tick();
      const c = tokens.calls.find((x) => !x.signal.aborted);
      if (c) {
        tokens.calls.splice(tokens.calls.indexOf(c), 1);
        c.done();
      }
    }
    expect(d.idle.get()).toBe(true);
    const last = rest[rest.length - 1] as Batch;
    expect(d.view.get().game).toBe(last.state);
    expect(d.view.get().seq).toBe(last.seq);
    expect(d.view.get().log.length).toBe(rest.reduce((n, b) => n + b.events.length, 0));
  });

  it('patches the view only after the animation of an event', async () => {
    const d = createDirector({ animSpeed: () => 'normal', hidden: () => false });
    const { first, rest } = batches(6);
    const withMove = rest.find((b) => b.events.some((e) => e.t === 'move')) as Batch;
    const before = rest[rest.indexOf(withMove) - 1]?.state ?? first.state;
    d.snap(before, withMove.seq - 1);
    const tokens = fakeTokens();
    d.register('tokens', tokens.api);
    d.enqueue(withMove);
    await tick();
    const mv = withMove.events.find((e) => e.t === 'move') as Extract<GameEvent, { t: 'move' }>;
    expect(tokens.calls.length).toBe(1);
    expect(d.view.get().game?.players[mv.seat]?.pos).toBe(before.players[mv.seat]?.pos);
    tokens.calls[0]?.done();
    await tick();
    expect(d.view.get().game?.players[mv.seat]?.pos).toBe(mv.to);
  });

  it('resolves at once when no scene API is registered (DOM-only)', () => {
    const d = createDirector({ animSpeed: () => 'normal', hidden: () => false });
    const { first, rest } = batches(10);
    d.enqueue(first);
    for (const b of rest) d.enqueue(b);
    // Nothing awaited anything: the whole queue played synchronously.
    expect(d.idle.get()).toBe(true);
    expect(d.view.get().game).toBe(rest[rest.length - 1]?.state);
  });

  it('plays instantly when animations are instant or the tab is hidden', () => {
    for (const opts of [{ animSpeed: (): AnimSpeed => 'instant', hidden: () => false }, { animSpeed: (): AnimSpeed => 'normal', hidden: () => true }]) {
      const d = createDirector(opts);
      const tokens = fakeTokens();
      d.register('tokens', tokens.api);
      const { first, rest } = batches(8);
      d.enqueue(first);
      for (const b of rest) d.enqueue(b);
      expect(tokens.calls.length).toBe(0);
      expect(d.idle.get()).toBe(true);
      expect(d.view.get().game).toBe(rest[rest.length - 1]?.state);
    }
  });

  it('fastForward finishes everything synchronously and aborts the running animation', async () => {
    const d = createDirector({ animSpeed: () => 'normal', hidden: () => false });
    const tokens = fakeTokens();
    d.register('tokens', tokens.api);
    const { first, rest } = batches(10);
    d.enqueue(first);
    for (const b of rest) d.enqueue(b);
    await tick();
    expect(tokens.calls.length).toBe(1);
    d.fastForward();
    expect(tokens.calls[0]?.signal.aborted).toBe(true);
    expect(d.idle.get()).toBe(true);
    expect(d.view.get().game).toBe(rest[rest.length - 1]?.state);
    expect(d.view.get().log.length).toBe(rest.reduce((n, b) => n + b.events.length, 0));
    // The aborted run wakes up under an old generation and leaves the view alone.
    await tick();
    expect(d.view.get().game).toBe(rest[rest.length - 1]?.state);
    expect(d.idle.get()).toBe(true);
  });

  it('a snap into a new game (a rematch) drops the log, dice and card of the last', () => {
    const d = createDirector({ animSpeed: () => 'instant', hidden: () => false });
    const { first, rest } = batches(6);
    d.enqueue(first);
    for (const b of rest) d.enqueue(b);
    expect(d.view.get().log.length).toBeGreaterThan(0);
    expect(d.view.get().dice).not.toBeNull();
    const next = batches(0, 9).first;
    // A plain snap (a gap in the same game) keeps the log
    d.enqueue({ ...next, seq: rest.at(-1)!.seq + 20 });
    expect(d.view.get().log.length).toBeGreaterThan(0);
    d.enqueue({ ...next, fresh: true });
    expect(d.view.get()).toMatchObject({ seq: next.seq, game: next.state, log: [], dice: null, card: null });
  });

  it('snaps on a seq gap or a snap batch, dropping the queue', async () => {
    const d = createDirector({ animSpeed: () => 'normal', hidden: () => false });
    const tokens = fakeTokens();
    d.register('tokens', tokens.api);
    const { first, rest } = batches(12);
    d.enqueue(first);
    d.enqueue(rest[0] as Batch);
    d.enqueue(rest[1] as Batch);
    await tick();
    const later = rest[8] as Batch;
    d.enqueue(later); // gap
    expect(tokens.calls.every((c) => c.signal.aborted)).toBe(true);
    expect(d.idle.get()).toBe(true);
    expect(d.view.get().game).toBe(later.state);
    expect(d.view.get().seq).toBe(later.seq);
    // Old and duplicate batches are ignored; the next one plays.
    d.enqueue(rest[2] as Batch);
    d.enqueue(later);
    expect(d.view.get().game).toBe(later.state);
    const snap = { ...(rest[3] as Batch), snap: true };
    d.enqueue(snap);
    expect(d.view.get().game).toBe(snap.state);
    expect(d.idle.get()).toBe(true);
  });

  it('speeds up with a backlog', async () => {
    expect(playSpeed('normal', 0)).toBe(1);
    expect(playSpeed('normal', 3)).toBe(1.5);
    expect(playSpeed('normal', 7)).toBe(3);
    expect(playSpeed('fast', 0)).toBe(2);
    expect(playSpeed('fast', 7)).toBe(6);
    const d = createDirector({ animSpeed: () => 'normal', hidden: () => false });
    const tokens = fakeTokens();
    d.register('tokens', tokens.api);
    const { first, rest } = batches(60);
    d.enqueue(first);
    const withMoves = rest.filter((b) => b.events.some((e) => e.t === 'move'));
    expect(withMoves.length).toBeGreaterThan(8);
    for (const b of rest) d.enqueue(b);
    const speeds: number[] = [];
    for (let guard = 0; guard < 500 && !d.idle.get(); guard++) {
      await tick();
      for (const c of tokens.calls.splice(0)) {
        speeds.push(c.speed);
        c.done();
      }
    }
    expect(speeds.length).toBe(moves(rest));
    expect(Math.max(...speeds)).toBe(3);
    expect(speeds).toContain(1.5);
    expect(speeds[speeds.length - 1]).toBe(1);
  });

  it('never waits on a handler that throws', () => {
    const d = createDirector({ animSpeed: () => 'normal', hidden: () => false });
    d.register('tokens', { move: () => { throw new Error('boom'); } });
    const { first, rest } = batches(4);
    d.enqueue(first);
    const err = console.error;
    console.error = () => {};
    for (const b of rest) d.enqueue(b);
    console.error = err;
    expect(d.idle.get()).toBe(true);
    expect(d.view.get().game).toBe(rest[rest.length - 1]?.state);
  });

  it('sets the card while it shows and the dice once they land', async () => {
    const d = createDirector({ animSpeed: () => 'normal', hidden: () => false });
    let release: () => void = () => {};
    d.register('cards', { show: () => new Promise<void>((r) => { release = r; }) });
    const state = batches(0).first.state;
    d.snap(state, state.seq);
    const card: GameEvent = { t: 'card', seat: 's0', deck: 'chance', cardId: 'ch-go', text: 'Advance to Start.', kept: false };
    const dice: GameEvent = { t: 'dice', seat: 's0', purpose: 'move', w: [3, 4], doubles: false, triples: false, total: 7 };
    d.enqueue({ seq: state.seq + 1, events: [dice, card], state });
    expect(d.view.get().dice).toBe(dice);
    expect(d.view.get().card?.text).toBe('Advance to Start.');
    expect(d.idle.get()).toBe(false);
    release();
    await tick();
    expect(d.idle.get()).toBe(true);
    expect(d.view.get().card?.text).toBe('Advance to Start.');
    d.enqueue({ seq: state.seq + 2, events: [{ t: 'turn', seat: 's1', no: 2 }], state });
    expect(d.view.get().card).toBeNull();
  });
});

describe('connectDirector', () => {
  function fakeSession(state: GameState) {
    const listeners = new Set<(b: Batch) => void>();
    const view = createStore<SessionView>({ doc: null, mySeats: [], connected: true, driver: true, tamper: null });
    const session: GameSession = {
      online: false,
      me: 'p_test',
      code: null,
      view,
      onBatch(cb) {
        listeners.add(cb);
        cb({ seq: state.seq, events: [], state, snap: true });
        return () => listeners.delete(cb);
      },
      dispatch: async () => ({ ok: true, seq: 0 }),
      serverNow: () => Date.now(),
      dispose: async () => {},
    };
    return { session, listeners };
  }

  it('follows sessionStore and tolerates an extra connect', () => {
    const { first } = batches(0);
    const a = fakeSession(first.state);
    sessionStore.set({ session: a.session });
    expect(a.listeners.size).toBe(1);
    expect(director.view.get().game).toBe(first.state);
    const off = connectDirector(a.session);
    expect(a.listeners.size).toBe(1);
    off();
    expect(a.listeners.size).toBe(1);
    sessionStore.set({ session: null });
    expect(a.listeners.size).toBe(0);
    expect(director.view.get().game).toBeNull();
  });
});
