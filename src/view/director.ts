import type { GameEvent, GameState } from '../rules';
import type { Batch, GameSession } from '../net/types';
import { sessionStore } from '../state/session';
import { createStore } from '../state/store';
import { settings, type AnimSpeed } from '../ui/settings';
import { handlerFor, type PlayCtx } from './handlers';
import { reduceView } from './reduceView';
import type { Director, SceneApis, ViewState } from './types';

/*
 * The director plays each committed batch's events in order as animations, through the scene APIs, and keeps
 * view (the displayed state) one event behind the animation: a token walks first, then its position is patched.
 * At the end of every batch the view is set to the batch's state, so it can never drift from the logical one.
 *
 * It never stalls: 'instant' animations and hidden tabs fold whole batches synchronously; fastForward() finishes
 * everything at once; a snap batch or a seq gap jumps straight to its state; every awaited animation is raced
 * against its abort signal and a watchdog.
 */

export const LOG_MAX = 200;
/** Longest one animation may hold the queue (a frame loop that stopped can't freeze the game) */
const STEP_MAX_MS = 12_000;

export const EMPTY_VIEW: ViewState = { seq: -1, game: null, log: [], card: null, dice: null, heroDie: null };

/** Playback speed for a setting and the number of batches waiting behind the one playing */
export function playSpeed(anim: AnimSpeed, queued: number): number {
  const base = anim === 'fast' ? 2 : 1;
  return base * (queued > 6 ? 3 : queued > 2 ? 1.5 : 1);
}

/** A seed for an event's visuals that every client computes the same way */
export function eventSeed(seq: number, index: number): number {
  let h = Math.imul((seq + 1) >>> 0, 0x9e3779b1) ^ Math.imul(index + 1, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  return (h ^ (h >>> 15)) >>> 0;
}

/** The view once one event has played (pure) */
export function applyEvent(v: ViewState, ev: GameEvent, seq: number): ViewState {
  const entry = { seq, ev };
  const log = v.log.length >= LOG_MAX ? [...v.log.slice(v.log.length - LOG_MAX + 1), entry] : [...v.log, entry];
  return {
    ...v,
    game: v.game ? reduceView(v.game, ev) : v.game,
    log,
    card: ev.t === 'card' ? { seat: ev.seat, deck: ev.deck, text: ev.text } : ev.t === 'turn' ? null : v.card,
    dice: ev.t === 'dice' && ev.purpose !== 'order' ? ev : v.dice,
    ...(ev.t === 'heroDie' ? { heroDie: ev } : {}),
  };
}

const finished = (v: ViewState, b: Batch): ViewState => ({ ...v, seq: b.seq, game: b.state });

/** Resolves when `p` settles, the signal aborts or the watchdog fires, whichever comes first */
function settle(p: Promise<void>, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, STEP_MAX_MS);
    signal.addEventListener('abort', done, { once: true });
    p.then(done, done);
  });
}

/** A scene bug must not stop the game: a throwing handler counts as done */
function safely(fn: () => Promise<void> | void): Promise<void> | undefined {
  try {
    return fn() ?? undefined;
  } catch (err) {
    console.error('director handler failed', err);
    return undefined;
  }
}

export interface DirectorOptions {
  /** Defaults to settings.animSpeed */
  animSpeed?: () => AnimSpeed;
  /** Defaults to document.hidden */
  hidden?: () => boolean;
}

/**
 * An event as the director plays it, for listeners such as the sound effects. 'start': it is about to animate (its
 * `before` step begins); 'done': that step finished (the dice have landed, the token arrived) and the change is in
 * view; 'instant': it was folded without animation because animations are set to Instant. Events skipped by
 * fastForward(), a snap or a hidden tab are not reported, so catching up never makes a burst of sounds.
 */
export interface PlayInfo {
  phase: 'start' | 'done' | 'instant';
  seq: number;
  /** Playback speed (as the handlers get it) */
  speed: number;
  /** Aborted when the animation is cut short (fast-forward, snap, reset) */
  signal: AbortSignal;
}
export type PlayListener = (ev: GameEvent, info: PlayInfo) => void;

export interface DirectorControl extends Director {
  /** Called as each event plays (see PlayInfo); returns the unsubscribe */
  onPlay(fn: PlayListener): () => void;
  /** Nothing shown (a new session is about to send its first snap) */
  reset(): void;
  /** The scene API registered under `name`, if any */
  api<K extends keyof SceneApis>(name: K): SceneApis[K] | undefined;
}

interface Playing {
  b: Batch;
  /** Index of the next event whose changes are not in the view yet */
  i: number;
}

class DirectorImpl implements DirectorControl {
  readonly idle = createStore(true);
  readonly view = createStore<ViewState>(EMPTY_VIEW);
  private apis: Partial<SceneApis> = {};
  private queue: Batch[] = [];
  private cur: Playing | null = null;
  private running = false;
  /** Bumped by snap / fastForward / reset: a run() that wakes up under an older generation just leaves */
  private gen = 0;
  private ac = new AbortController();
  /** The last batch accepted (queued or snapped to) */
  private lastSeq = -1;
  private lastState: GameState | null = null;
  private readonly animSpeed: () => AnimSpeed;
  private readonly hidden: () => boolean;
  private listeners = new Set<PlayListener>();

  constructor(opts: DirectorOptions) {
    this.animSpeed = opts.animSpeed ?? (() => settings.get().animSpeed);
    this.hidden = opts.hidden ?? (() => typeof document !== 'undefined' && document.hidden);
  }

  enqueue(b: Batch): void {
    // A new game in the same session (a rematch): the last one's log, dice and card go with it
    if (b.fresh) this.reset();
    if (!b.snap && b.seq <= this.lastSeq) return; // a duplicate
    if (b.snap || b.seq !== this.lastSeq + 1 || !this.lastState) return this.snap(b.state, b.seq);
    this.lastSeq = b.seq;
    this.lastState = b.state;
    this.queue.push(b);
    if (this.running) return;
    this.running = true;
    this.idle.set(false);
    void this.run(this.gen);
  }

  fastForward(): void {
    if (!this.running) return;
    this.stop();
    let v = this.view.get();
    if (this.cur) v = this.fold(v, this.cur);
    for (const b of this.queue) v = this.fold(v, { b, i: 0 });
    this.cur = null;
    this.queue = [];
    this.view.set(v);
    this.idle.set(true);
  }

  snap(state: GameState, seq: number): void {
    this.stop();
    this.cur = null;
    this.queue = [];
    this.lastSeq = seq;
    this.lastState = state;
    this.view.set({ ...this.view.get(), seq, game: state, card: null });
    this.idle.set(true);
  }

  reset(): void {
    this.stop();
    this.cur = null;
    this.queue = [];
    this.lastSeq = -1;
    this.lastState = null;
    this.view.set(EMPTY_VIEW);
    this.idle.set(true);
  }

  register<K extends keyof SceneApis>(name: K, api: SceneApis[K]): () => void {
    this.apis[name] = api;
    return () => {
      if (this.apis[name] === api) delete this.apis[name];
    };
  }

  api<K extends keyof SceneApis>(name: K): SceneApis[K] | undefined {
    return this.apis[name];
  }

  onPlay(fn: PlayListener): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  /** A listener's bug must not stop the game either */
  private emit(ev: GameEvent, info: PlayInfo): void {
    for (const fn of this.listeners) {
      try {
        fn(ev, info);
      } catch (err) {
        console.error('director listener failed', err);
      }
    }
  }

  private stop(): void {
    this.gen++;
    this.running = false;
    this.ac.abort();
    this.ac = new AbortController();
  }

  private instant(): boolean {
    return this.animSpeed() === 'instant' || this.hidden();
  }

  /** The rest of a batch without animations */
  private fold(v: ViewState, p: Playing): ViewState {
    for (let i = p.i; i < p.b.events.length; i++) v = applyEvent(v, p.b.events[i] as GameEvent, p.b.seq);
    return finished(v, p.b);
  }

  private ctx(p: Playing): PlayCtx {
    return {
      apis: this.apis,
      signal: this.ac.signal,
      speed: playSpeed(this.animSpeed(), this.queue.length),
      seed: eventSeed(p.b.seq, p.i),
      game: this.view.get().game,
      events: p.b.events,
      index: p.i,
    };
  }

  private async run(gen: number): Promise<void> {
    while (gen === this.gen) {
      if (!this.cur) {
        const b = this.queue.shift();
        if (!b) {
          this.running = false;
          this.idle.set(true);
          return;
        }
        this.cur = { b, i: 0 };
      }
      const cur = this.cur;
      const ev = cur.b.events[cur.i];
      if (!ev || this.instant()) {
        if (ev && this.listeners.size && !this.hidden()) {
          const info: PlayInfo = { phase: 'instant', seq: cur.b.seq, speed: 1, signal: this.ac.signal };
          for (let i = cur.i; i < cur.b.events.length; i++) this.emit(cur.b.events[i] as GameEvent, info);
        }
        this.view.set(this.fold(this.view.get(), cur));
        this.cur = null;
        continue;
      }
      const h = handlerFor(ev);
      const ctx = this.ctx(cur);
      if (ev.t === 'card') this.view.update({ card: { seat: ev.seat, deck: ev.deck, text: ev.text } });
      const info = { seq: cur.b.seq, speed: ctx.speed, signal: ctx.signal };
      if (this.listeners.size) this.emit(ev, { ...info, phase: 'start' });
      const before = h?.before && safely(() => h.before?.(ev, ctx));
      if (before) {
        await settle(before, ctx.signal);
        if (gen !== this.gen) return;
      }
      this.view.set(applyEvent(this.view.get(), ev, cur.b.seq));
      cur.i++;
      if (this.listeners.size) this.emit(ev, { ...info, phase: 'done' });
      const after = h?.after && safely(() => h.after?.(ev, ctx));
      if (after) {
        await settle(after, ctx.signal);
        if (gen !== this.gen) return;
      }
    }
  }
}

export function createDirector(opts: DirectorOptions = {}): DirectorControl {
  return new DirectorImpl(opts);
}

/** THE director: the HUD and the scene read `director.view` and `director.idle` */
export const director: DirectorControl = createDirector();

// rAF stops in a hidden tab, so a walk that is mid-way would never finish: finish everything instead.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) director.fastForward();
  });
}

let link: { session: GameSession; off: () => void; refs: number } | null = null;

/**
 * Plays `session`'s batches through the director. Connecting the session that is already connected only adds a
 * reference (the director also follows sessionStore by itself), so calling this from a screen is always safe.
 */
export function connectDirector(session: GameSession): () => void {
  if (link?.session !== session) {
    link?.off();
    director.reset();
    link = { session, off: session.onBatch((b) => director.enqueue(b)), refs: 0 };
  }
  const mine = link;
  mine.refs++;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    if (link !== mine || --mine.refs > 0) return;
    mine.off();
    link = null;
  };
}

let followed: (() => void) | null = null;
function followSession(): void {
  const session = sessionStore.get().session;
  if (session && link?.session === session && followed) return;
  followed?.();
  followed = session ? connectDirector(session) : null;
  if (!session && !link) director.reset();
}
sessionStore.subscribe(followSession);
followSession();
