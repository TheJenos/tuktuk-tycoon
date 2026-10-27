import { decide, seatsToAsk, thinkMs, type BotTable } from '../bots';
import {
  defaultAction,
  RULES_VERSION,
  timeoutCommand,
  type Action,
  type Command,
  type GameEvent,
  type SeatId,
} from '../rules';
import { animBudget } from '../shared/timing';
import { createStore, shallowArrayEqual, type Store } from '../state/store';
import type { Db } from './db';
import {
  applyEnvelope,
  decodeDoc,
  DocError,
  drivenSeat,
  encodeDoc,
  fullAnimBudget,
  reactIdleOnly,
  seatsOf,
  seqOfEnvelope,
  snapBatch,
  verifyNext,
  type NetError,
} from './doc';
import { envelopeId, hash32, seededRandom } from './ids';
import type { Batch, DispatchResult, Doc, Envelope, GameSession, PlayerId, SeatInfo, SessionView } from './types';

/*
 * One GameSession over a Db at rooms/{code}: the same code runs online (FirebaseDb) and offline (a private MemoryDb).
 *
 * - Every client commits its own actions with a transaction on rooms/{code}/state that runs the engine (doc.ts), so
 *   an illegal move is refused with the engine's message and a committed one applies exactly once.
 * - Every client replays each new seq from doc.recent: that yields the events the view plays, and checks that what
 *   was written is what the rules give (a mismatch shows the tamper banner).
 * - One client holds the driver lease (rooms/{code}/driver) and does the chores: bot and AFK moves, and timeouts.
 *   Chores carry basis = seq, so two drivers (an old one waking up, or the fallback) can never act twice.
 */

/** rooms/{code}/state */
export interface StateRecord {
  gid: string;
  seq: number;
  v: number;
  /** Server ms of the last write; never goes back */
  at: number;
  data: string;
}

/** rooms/{code}/driver */
export interface DriverLease {
  pid: PlayerId;
  /** Server ms */
  until: number;
}

export const LEASE_MS = 6_000;
export const RENEW_MS = 2_000;
/** Other visible clients wait this much longer than the owner before taking a free lease */
export const OWNER_HEADSTART_MS = 4_000;
/** Seated players go before spectators by this much */
export const SPECTATOR_EXTRA_MS = 2_000;
/** A hidden tab takes a free lease only once no visible tab has for this long */
export const HIDDEN_WAIT_MS = 10_000;
/** A renew tick this late in a hidden tab means it is being throttled: hand the lease back */
export const LATE_TICK_MS = 3_000;
/** Non-drivers fire a timeout this long after the deadline, plus a second per rank */
export const FALLBACK_MS = 5_000;
export const FALLBACK_STEP_MS = 1_000;
/** Tries per bot per seq (the first decides; the rest play the safe default) */
export const BOT_TRIES_PER_SEQ = 10;
/** After this many moves in one turn a bot only plays the safe default (no endless build/sell loops) */
export const BOT_MOVES_PER_TURN = 60;
/**
 * A bot in a Hero League reaction window answers this long after the throw has played (not after its thinking time),
 * so the players see the throw land before a bot re-rolls it; never later than this before the window closes
 */
export const REACT_AFTER_MS = 300;

export interface SessionOptions {
  db: Db;
  /** 'rooms/ABCDE' */
  roomPath: string;
  me: PlayerId;
  code: string | null;
  online: boolean;
  /** Always the driver, no lease (offline play) */
  alwaysDrive?: boolean;
  /** This client owns the room (it goes first for the lease) */
  isOwner?: () => boolean;
  /** The tab is visible (default: document.visibilityState) */
  visible?: () => boolean;
  /** This client's place in the fallback-timeout stagger, 0 first */
  rank?: () => number;
  /** Multiplies bot thinking and waiting time (1 = normal) */
  pace?: number;
  /** Write log/{gid}/m{seq} after each commit (default: when online) */
  log?: boolean;
  /** After each command this client committed */
  onCommit?: (doc: Doc) => void;
  /** The room's state was written by another RULES_VERSION */
  onVersion?: () => void;
}

const fail = (code: string, message: string): DispatchResult => ({ ok: false, code, message });
const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const docVisible = (): boolean => typeof document === 'undefined' || document.visibilityState !== 'hidden';

/** The bot seats and their skills, as the bots see the table (an AFK human's seat stays human: they may come back) */
const botTable = (doc: Doc): BotTable =>
  Object.fromEntries(Object.values(doc.seats).flatMap((x) => (x?.kind === 'bot' ? [[x.seat, x.skill ?? doc.botSkill ?? 'normal']] : [])));

interface Chore {
  due: number;
  timer: ReturnType<typeof setTimeout> | null;
}

export class Session implements GameSession {
  readonly online: boolean;
  readonly me: PlayerId;
  readonly code: string | null;
  readonly view: Store<SessionView>;
  /** Resolves once the state has been read the first time (a game or none) */
  readonly loaded: Promise<void>;

  private readonly db: Db;
  private markLoaded: () => void = () => {};
  private readonly statePath: string;
  private readonly driverPath: string;
  private readonly logPath: string;
  private readonly opts: SessionOptions;
  private readonly pace: number;

  private doc: Doc | null = null;
  /** The last game seen, even after its state went away: a different one next is a new game for the view */
  private lastGid: string | null = null;
  private lastEvents: readonly GameEvent[] = [];
  private readonly subs = new Set<{ cb: (b: Batch) => void; primed: boolean }>();
  private unsubs: Array<() => void> = [];
  private offset = 0;
  private disposed = false;

  private lease: DriverLease | null = null;
  private leaseKnown = false;
  private leaseBusy = false;
  private renewedAt = -Infinity;
  private freeSince: number | null = null;
  private backoffUntil = 0;
  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  private tickDue = 0;

  /** Chore id -> its timer. Ids start with `${gid}:${seq}:` so a new seq drops the old ones. */
  private readonly chores = new Map<string, Chore>();
  private readonly inFlight = new Set<string>();
  private readonly done = new Set<string>();
  private readonly tries = new Map<string, number>();
  private readonly turnMoves = new Map<string, number>();
  private choresFor = '';
  private seqSeenAt = 0;

  constructor(opts: SessionOptions) {
    this.opts = opts;
    this.db = opts.db;
    this.online = opts.online;
    this.me = opts.me;
    this.code = opts.code;
    this.pace = opts.pace ?? 1;
    this.statePath = `${opts.roomPath}/state`;
    this.driverPath = `${opts.roomPath}/driver`;
    this.logPath = `${opts.roomPath}/log`;
    this.loaded = new Promise<void>((resolve) => (this.markLoaded = resolve));
    this.view = createStore<SessionView>({
      doc: null,
      mySeats: [],
      connected: !opts.online,
      driver: opts.alwaysDrive === true,
      tamper: null,
    });

    this.unsubs.push(
      this.db.serverOffset((ms) => (this.offset = ms)),
      this.db.connected((up) => this.view.update({ connected: up })),
      this.db.watch<StateRecord>(this.statePath, (rec) => this.onState(rec), () => this.markLoaded()),
    );
    if (this.online && !opts.alwaysDrive) {
      this.unsubs.push(this.db.watch<DriverLease>(this.driverPath, (v) => this.onLease(v)));
      this.scheduleTick();
      if (typeof document !== 'undefined') {
        const onVis = () => this.leaseCheck();
        document.addEventListener('visibilitychange', onVis);
        this.unsubs.push(() => document.removeEventListener('visibilitychange', onVis));
      }
    }
  }

  // ------------------------------------------------------------------------------------------------ GameSession

  serverNow(): number {
    return Date.now() + this.offset;
  }

  onBatch(cb: (b: Batch) => void): () => void {
    const sub = { cb, primed: false };
    this.subs.add(sub);
    if (this.doc) {
      sub.primed = true;
      cb(snapBatch(this.doc));
    }
    return () => {
      this.subs.delete(sub);
    };
  }

  dispatch(seat: SeatId, a: Action): Promise<DispatchResult> {
    if (this.disposed) return Promise.resolve(fail('closed', 'You left the game'));
    if (!this.view.get().mySeats.includes(seat)) return Promise.resolve(fail('notYourSeat', 'That is not your seat'));
    return this.send({ by: seat, a });
  }

  /** `keepLease`: another Session of this player (a newer join) may hold the lease now: leave it to that one */
  async dispose({ keepLease = false }: { keepLease?: boolean } = {}): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.clearChores();
    if (this.tickTimer) clearTimeout(this.tickTimer);
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.subs.clear();
    if (!keepLease && this.holdsLease()) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([this.releaseLease(), new Promise<void>((r) => (timer = setTimeout(r, 1_500)))]);
      clearTimeout(timer);
    }
  }

  // ------------------------------------------------------------------------------------------------ extras

  /** The latest committed document */
  current(): Doc | null {
    return this.doc;
  }

  /** This client runs the chores now */
  isDriver(): boolean {
    return this.opts.alwaysDrive === true || this.holdsLease();
  }

  /** Commit any command as this client (e.g. the owner's system endGame); refused like any other */
  command(cmd: Command): Promise<DispatchResult> {
    if (this.disposed) return Promise.resolve(fail('closed', 'You left the game'));
    return this.send(cmd);
  }

  /**
   * Change who sits where, atomically with the moves (assign a seat, hand it to a bot, take it back). Only the
   * seats change: seq stays, and every client checks that the game itself did not.
   */
  async editSeats(edit: (seats: Doc['seats'], doc: Doc) => NetError | null): Promise<DispatchResult> {
    const out = { res: null as DispatchResult | null };
    try {
      const r = await this.db.transact<StateRecord>(this.statePath, (cur) => {
        out.res = null;
        if (cur === null) return null;
        let doc: Doc;
        try {
          doc = decodeDoc(cur.data);
        } catch (err) {
          out.res = fail(err instanceof DocError ? err.code : 'corrupt', errorText(err));
          return undefined;
        }
        const seats = structuredClone(doc.seats);
        const problem = edit(seats, doc);
        if (problem) {
          out.res = { ok: false, ...problem };
          return undefined;
        }
        // A seat taken back or handed to someone else starts with a clean record
        const strikes = { ...doc.strikes };
        const reactIdle = { ...doc.reactIdle };
        for (const s of Object.values(seats) as SeatInfo[]) {
          const was = doc.seats[s.seat];
          if ((was?.afk && !s.afk) || was?.ctrl !== s.ctrl || was?.kind !== s.kind) {
            delete strikes[s.seat];
            delete reactIdle[s.seat];
          }
        }
        out.res = { ok: true, seq: doc.seq };
        const next: Doc = { ...doc, seats, strikes, sv: (doc.sv ?? 0) + 1 };
        if (Object.keys(reactIdle).length) next.reactIdle = reactIdle;
        else delete next.reactIdle;
        return { gid: cur.gid, seq: doc.seq, v: RULES_VERSION, at: Math.max(cur.at, this.serverNow()), data: encodeDoc(next) };
      });
      if (r.committed && r.value === null) return fail('closed', 'The game is not running');
      return out.res ?? fail('failed', 'The change could not be sent');
    } catch (err) {
      return fail('error', errorText(err));
    }
  }

  /** Hand a seat to the driver (true) or give it back to its player (false) */
  setAfk(seat: SeatId, on: boolean): Promise<DispatchResult> {
    return this.editSeats((seats) => {
      const s = seats[seat];
      if (!s) return { code: 'badSeat', message: 'Nobody sits there' };
      if (s.kind !== 'human') return { code: 'bot', message: 'A bot already plays that seat' };
      if (on) s.afk = true;
      else delete s.afk;
      return null;
    });
  }

  // ------------------------------------------------------------------------------------------------ commit

  private async send(cmd: Command): Promise<DispatchResult> {
    const env: Envelope = { id: envelopeId(), pid: this.me, at: this.serverNow(), cmd };
    const out = { res: null as DispatchResult | null, doc: null as Doc | null };
    try {
      const r = await this.db.transact<StateRecord>(this.statePath, (cur) => {
        out.res = null;
        out.doc = null;
        // Cold cache: write null so the server compares and sends the real value back
        if (cur === null) return null;
        if (cur.v !== RULES_VERSION) {
          out.res = fail('version', 'This game was made by another version');
          return undefined;
        }
        let doc: Doc;
        try {
          doc = decodeDoc(cur.data);
        } catch (err) {
          out.res = fail(err instanceof DocError ? err.code : 'corrupt', errorText(err));
          return undefined;
        }
        // `at` never goes back (database rule): a client whose clock runs behind stamps the last write's time
        const e = env.at >= cur.at ? env : { ...env, at: cur.at };
        const applied = applyEnvelope(doc, e);
        if (!applied.ok) {
          // Our own envelope is already in: the commit landed and the SDK ran us again
          out.res = applied.code === 'duplicate'
            ? { ok: true, seq: seqOfEnvelope(doc, env.id) ?? doc.seq }
            : fail(applied.code, applied.message);
          return undefined;
        }
        out.doc = applied.doc;
        out.res = { ok: true, seq: applied.doc.seq };
        return { gid: cur.gid, seq: applied.doc.seq, v: RULES_VERSION, at: e.at, data: encodeDoc(applied.doc) };
      });
      if (r.committed && r.value === null) return fail('closed', 'The game is not running');
      if (r.committed && out.doc) this.afterCommit(out.doc);
      return out.res ?? fail('failed', 'The move could not be sent');
    } catch (err) {
      return fail('error', errorText(err));
    }
  }

  private afterCommit(doc: Doc): void {
    const env = doc.recent.at(-1);
    if (env && (this.opts.log ?? this.online)) {
      const entry = { env: JSON.stringify(env), h: hash32(JSON.stringify(doc.game)).toString(16) };
      // Keyed by game too: a rematch starts again at seq 0, and the log is write-once
      this.db.set(`${this.logPath}/${doc.gid}/m${String(doc.seq).padStart(6, '0')}`, entry).catch(() => {});
    }
    try {
      this.opts.onCommit?.(doc);
    } catch (err) {
      console.error('onCommit failed', err);
    }
  }

  // ------------------------------------------------------------------------------------------------ replay

  private onState(rec: StateRecord | null): void {
    if (this.disposed) return;
    try {
      this.readState(rec);
    } finally {
      this.markLoaded();
    }
  }

  private readState(rec: StateRecord | null): void {
    if (!rec || typeof rec.data !== 'string') {
      if (this.doc) {
        this.doc = null;
        this.lastEvents = [];
        this.view.update({ doc: null, mySeats: [] });
      }
      this.plan();
      return;
    }
    if (rec.v !== RULES_VERSION) {
      this.opts.onVersion?.();
      return;
    }
    let next: Doc;
    try {
      next = decodeDoc(rec.data);
    } catch (err) {
      if (err instanceof DocError && err.code === 'version') this.opts.onVersion?.();
      else this.view.update({ tamper: 'The game data could not be read' });
      return;
    }

    const prev = this.doc;
    let batches: Batch[];
    let tamper: string | null | undefined;
    if (!prev || prev.gid !== next.gid) {
      batches = [this.lastGid !== null && this.lastGid !== next.gid ? { ...snapBatch(next), fresh: true } : snapBatch(next)];
      tamper = null;
    } else {
      const v = verifyNext(prev, next);
      if ('tamper' in v) {
        console.warn('Replay check failed:', v.tamper);
        batches = [snapBatch(next)];
        tamper = v.tamper;
      } else if ('gap' in v) {
        batches = [snapBatch(next)];
      } else {
        batches = v.batches;
      }
    }
    this.doc = next;
    this.lastGid = next.gid;
    const last = batches.at(-1);
    if (last) this.lastEvents = last.events;
    this.emit(batches);

    const mine = seatsOf(next, this.me);
    const was = this.view.get().mySeats;
    this.view.update({
      doc: next,
      mySeats: shallowArrayEqual(was, mine) ? was : mine,
      ...(tamper !== undefined ? { tamper } : {}),
    });
    this.leaseCheck();
    this.plan();
  }

  private emit(batches: Batch[]): void {
    const doc = this.doc;
    if (!doc) return;
    for (const sub of [...this.subs]) {
      try {
        if (!sub.primed) {
          sub.primed = true;
          sub.cb(snapBatch(doc));
          continue;
        }
        for (const b of batches) sub.cb(b);
      } catch (err) {
        console.error('Batch listener failed', err);
      }
    }
  }

  // ------------------------------------------------------------------------------------------------ chores

  /** (Re)arm the chores for the current seq. Idempotent: called from every watch callback and tick. */
  private plan(): void {
    const doc = this.doc;
    if (this.disposed || !doc || doc.game.phase.k === 'over') {
      this.clearChores();
      return;
    }
    const prefix = `${doc.gid}:${doc.seq}:`;
    const now = this.serverNow();
    if (this.choresFor !== prefix) {
      this.clearChores();
      this.done.clear();
      this.tries.clear();
      this.choresFor = prefix;
      this.seqSeenAt = now;
    }
    const wanted = new Set<string>();

    if (this.isDriver()) {
      // From the commit, so every driver paces the same; a fresh game has none yet
      const lastAt = doc.recent.at(-1)?.at ?? this.seqSeenAt;
      const wait = animBudget(this.lastEvents);
      // The room's bot speed when it has one (online rooms, newer local saves), else this session's
      const pace = doc.botPace ?? this.pace;
      // A Hero League reaction window: bots answer once the throw has played, however long its batch was, and
      // before the window closes
      const react = doc.game.phase.k === 'react';
      const reactDue = Math.min(lastAt + fullAnimBudget(this.lastEvents) * pace + REACT_AFTER_MS, (doc.deadline?.at ?? Infinity) - REACT_AFTER_MS);
      // Receivers of open trade offers first, then every seat the game waits for
      for (const seat of seatsToAsk(doc.game)) {
        const info = doc.seats[seat];
        if (!drivenSeat(info)) continue;
        const id = `${prefix}bot:${seat}`;
        wanted.add(id);
        const due = react ? reactDue : lastAt + Math.max(thinkMs(info?.skill ?? doc.botSkill ?? 'normal'), wait) * pace;
        this.arm(id, due, now, () => this.botMove(seat, doc, id));
      }
      // ...and one left only to seats that let their last windows run out closes once the throw has played
      if (react && reactIdleOnly(doc)) {
        const id = `${prefix}reactIdle`;
        wanted.add(id);
        this.arm(id, lastAt + fullAnimBudget(this.lastEvents) + REACT_AFTER_MS, now, () => this.closeIdleReact(doc, id));
      }
    }
    if (doc.deadline && (this.isDriver() || this.online)) {
      const id = `${prefix}timeout:${doc.deadline.key}`;
      wanted.add(id);
      const due = this.isDriver() ? doc.deadline.at : doc.deadline.at + FALLBACK_MS + FALLBACK_STEP_MS * (this.opts.rank?.() ?? 0);
      this.arm(id, due, now, () => this.fireTimeout(doc, id));
    }
    // The room's time limit: the driver ends the game once it runs out (the others stand by, like for timeouts)
    if (doc.endsAt !== undefined && (this.isDriver() || this.online)) {
      const id = `${prefix}timeUp`;
      wanted.add(id);
      const due = this.isDriver() ? doc.endsAt : doc.endsAt + FALLBACK_MS + FALLBACK_STEP_MS * (this.opts.rank?.() ?? 0);
      this.arm(id, due, now, () => this.fireTimeUp(doc, id));
    }
    for (const [id, c] of this.chores) {
      if (wanted.has(id)) continue;
      if (c.timer) clearTimeout(c.timer);
      this.chores.delete(id);
    }
  }

  private arm(id: string, due: number, now: number, run: () => Promise<void>): void {
    if (this.done.has(id) || this.inFlight.has(id)) return;
    const had = this.chores.get(id);
    if (had && had.due === due) return;
    if (had?.timer) clearTimeout(had.timer);
    const chore: Chore = { due, timer: null };
    this.chores.set(id, chore);
    const go = () => {
      chore.timer = null;
      if (this.chores.get(id) !== chore || this.done.has(id) || this.inFlight.has(id)) return;
      this.chores.delete(id);
      void run();
    };
    // Overdue work runs straight from the watch callback that noticed it: timers may be throttled in hidden tabs
    if (due <= now) queueMicrotask(go);
    else chore.timer = setTimeout(go, due - now);
  }

  private clearChores(): void {
    for (const c of this.chores.values()) if (c.timer) clearTimeout(c.timer);
    this.chores.clear();
  }

  private stillAt(doc: Doc): boolean {
    const cur = this.doc;
    return !this.disposed && !!cur && cur.gid === doc.gid && cur.seq === doc.seq;
  }

  private async botMove(seat: SeatId, doc: Doc, id: string): Promise<void> {
    if (!this.stillAt(doc) || !this.isDriver()) return;
    const info = this.doc?.seats[seat];
    if (!drivenSeat(info)) return;
    const n = this.tries.get(id) ?? 0;
    if (n >= BOT_TRIES_PER_SEQ) return;
    this.tries.set(id, n + 1);

    const g = doc.game;
    const turnKey = `${doc.gid}:${g.turn.no}:${seat}`;
    const moves = this.turnMoves.get(turnKey) ?? 0;
    let a: Action | null;
    if (n === 0 && moves < BOT_MOVES_PER_TURN) {
      try {
        a = decide(g, seat, info?.skill ?? doc.botSkill ?? 'normal', seededRandom(hash32(id)), botTable(doc));
      } catch (err) {
        console.error('Bot failed to decide', err);
        a = defaultAction(g, seat);
      }
      // Waiting is a choice in an auction (the deadline closes it); anywhere else it would stall the game
      if (a === null && g.phase.k !== 'auction') a = defaultAction(g, seat);
    } else {
      a = defaultAction(g, seat);
    }
    if (!a) {
      this.done.add(id);
      return;
    }

    this.inFlight.add(id);
    const r = await this.send({ by: seat, a, basis: doc.seq });
    this.inFlight.delete(id);
    if (r.ok) {
      this.done.add(id);
      if (this.turnMoves.size > 64) this.turnMoves.clear();
      this.turnMoves.set(turnKey, moves + 1);
      return;
    }
    // stale: the new seq re-plans this bot; anything else: retry with the safe default
    if (r.code === 'stale' || r.code === 'closed' || !this.stillAt(doc)) {
      this.done.add(id);
      return;
    }
    console.warn(`Bot move for ${seat} refused (${r.code}): ${r.message}`, a);
    this.arm(id, this.serverNow() + 50, this.serverNow(), () => this.botMove(seat, doc, id));
  }

  private async fireTimeout(doc: Doc, id: string): Promise<void> {
    if (!this.stillAt(doc) || !doc.deadline) return;
    const now = this.serverNow();
    if (now < doc.deadline.at) {
      this.arm(id, doc.deadline.at, now, () => this.fireTimeout(doc, id));
      return;
    }
    const cmd = timeoutCommand(doc.game);
    if (!cmd) {
      this.done.add(id);
      return;
    }
    this.inFlight.add(id);
    const r = await this.send(cmd);
    this.inFlight.delete(id);
    const n = (this.tries.get(id) ?? 0) + 1;
    this.tries.set(id, n);
    if (r.ok || r.code === 'stale' || r.code === 'closed' || n >= 3 || !this.stillAt(doc)) {
      this.done.add(id);
      return;
    }
    this.arm(id, this.serverNow() + 500, this.serverNow(), () => this.fireTimeout(doc, id));
  }

  /** A reaction window waiting only on seats that let their last ones run out: close it without waiting (reactIdleOnly) */
  private async closeIdleReact(doc: Doc, id: string): Promise<void> {
    if (!this.stillAt(doc) || !this.isDriver()) return;
    this.inFlight.add(id);
    const r = await this.send({ by: 'system', a: { k: 'closeReact' }, basis: doc.seq });
    this.inFlight.delete(id);
    // Refused (a seat came back meanwhile): the deadline closes it as usual
    this.done.add(id);
    if (!r.ok && r.code !== 'stale' && r.code !== 'closed') console.warn(`Could not close the reaction window (${r.code}): ${r.message}`);
  }

  private async fireTimeUp(doc: Doc, id: string): Promise<void> {
    if (!this.stillAt(doc) || doc.endsAt === undefined) return;
    const now = this.serverNow();
    if (now < doc.endsAt) {
      this.arm(id, doc.endsAt, now, () => this.fireTimeUp(doc, id));
      return;
    }
    this.inFlight.add(id);
    const r = await this.send({ by: 'system', a: { k: 'timeUp' }, basis: doc.seq });
    this.inFlight.delete(id);
    const n = (this.tries.get(id) ?? 0) + 1;
    this.tries.set(id, n);
    // stale: the next seq plans it again (already due, so at once)
    if (r.ok || r.code === 'stale' || r.code === 'closed' || n >= 3 || !this.stillAt(doc)) {
      this.done.add(id);
      return;
    }
    this.arm(id, this.serverNow() + 500, this.serverNow(), () => this.fireTimeUp(doc, id));
  }

  // ------------------------------------------------------------------------------------------------ lease

  private holdsLease(now = this.serverNow()): boolean {
    return !!this.lease && this.lease.pid === this.me && this.lease.until > now;
  }

  private onLease(v: DriverLease | null): void {
    if (this.disposed) return;
    this.lease = v && typeof v.pid === 'string' && typeof v.until === 'number' ? v : null;
    this.leaseKnown = true;
    this.refreshDriver();
    this.leaseCheck();
  }

  private refreshDriver(): void {
    const driver = this.isDriver();
    if (driver !== this.view.get().driver) this.view.update({ driver });
    this.plan();
  }

  private scheduleTick(): void {
    this.tickDue = Date.now() + RENEW_MS;
    this.tickTimer = setTimeout(() => this.tick(), RENEW_MS);
  }

  private tick(): void {
    if (this.disposed) return;
    const late = Date.now() - this.tickDue;
    this.scheduleTick();
    // Throttled (a hidden tab's timers): let a client that runs on time drive. A visible tab that ran late was only
    // busy for a moment (building the board, a slow frame) and is back on time now: it keeps the lease, or the chores
    // would leave the owner for good on its first long task. (After a sleep the lease has run out by itself.)
    if (late > LATE_TICK_MS && this.holdsLease() && !this.isVisible()) {
      this.backoffUntil = this.serverNow() + HIDDEN_WAIT_MS;
      void this.releaseLease();
      return;
    }
    this.leaseCheck();
    this.refreshDriver();
  }

  private isVisible(): boolean {
    return (this.opts.visible ?? docVisible)();
  }

  private leaseCheck(): void {
    if (!this.online || this.opts.alwaysDrive || this.disposed || !this.leaseKnown) return;
    const doc = this.doc;
    const now = this.serverNow();
    if (!doc || doc.game.phase.k === 'over') {
      if (this.holdsLease(now)) void this.releaseLease();
      return;
    }
    if (this.holdsLease(now)) {
      if (now - this.renewedAt >= RENEW_MS - 250) void this.takeLease();
      return;
    }
    if (now < this.backoffUntil) return;
    const lease = this.lease;
    if (lease && lease.until > now) {
      this.freeSince = null;
      return;
    }
    const freeAt = lease ? lease.until : (this.freeSince ??= now);
    const wait = !this.isVisible()
      ? HIDDEN_WAIT_MS
      : this.opts.isOwner?.()
        ? 0
        : seatsOf(doc, this.me).length
          ? OWNER_HEADSTART_MS
          : OWNER_HEADSTART_MS + SPECTATOR_EXTRA_MS;
    if (now >= freeAt + wait) void this.takeLease();
  }

  private async takeLease(): Promise<void> {
    if (this.leaseBusy || this.disposed) return;
    this.leaseBusy = true;
    try {
      const r = await this.db.transact<DriverLease>(this.driverPath, (cur) => {
        const now = this.serverNow();
        if (cur && cur.pid !== this.me && cur.until > now) return undefined;
        return { pid: this.me, until: now + LEASE_MS };
      });
      if (r.committed && r.value && !this.disposed) {
        this.renewedAt = this.serverNow();
        this.lease = r.value;
        this.refreshDriver();
      }
    } catch {
      // Offline or refused: the lease simply runs out and someone else takes it
    } finally {
      this.leaseBusy = false;
    }
  }

  private async releaseLease(): Promise<void> {
    try {
      // Cold cache (already unsubscribed): null makes the server compare and send the real lease back
      await this.db.transact<DriverLease>(this.driverPath, (cur) => (cur === null || cur.pid === this.me ? null : undefined));
    } catch {
      // It expires by itself
    }
    if (this.lease?.pid === this.me) this.lease = null;
    if (!this.disposed) this.refreshDriver();
  }
}
