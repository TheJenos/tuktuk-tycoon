import type { Database } from 'firebase/database';

/*
 * The database seam. FirebaseDb is the Realtime Database; MemoryDb is an in-process stand-in that powers offline play
 * and the race tests. Several MemoryDb clients can share one MemoryServer to act as several browsers: transactions
 * compare-and-retry against the server like the SDK's (a cold cache sends null first; applyLocally is always off),
 * onDisconnect runs when a client is killed or drops, and values are pruned the way RTDB prunes them.
 */

export interface TransactResult<T> {
  committed: boolean;
  /** The value at the path afterwards (committed) or as last seen (aborted) */
  value: T | null;
}

export interface Db {
  get<T = unknown>(path: string): Promise<T | null>;
  set(path: string, value: unknown): Promise<void>;
  /** Multi-path update relative to `path`; a null value removes that child */
  update(path: string, patch: Record<string, unknown>): Promise<void>;
  remove(path: string): Promise<void>;
  /**
   * Compare-and-set. `fn` may run several times (reset any result it records at its top); it gets null while the
   * cache is cold, returns the next value, null to delete, or undefined to abort. Never applied locally first.
   */
  transact<T>(path: string, fn: (cur: T | null) => T | null | undefined): Promise<TransactResult<T>>;
  /** The value now and after every change; returns the unsubscribe */
  watch<T = unknown>(path: string, cb: (value: T | null) => void, onError?: (err: Error) => void): () => void;
  /** Remove `path` on the server when this client's connection drops */
  onDisconnectRemove(path: string): Promise<void>;
  cancelOnDisconnect(path: string): Promise<void>;
  /** Connection state now and on every change */
  connected(cb: (up: boolean) => void): () => void;
  /** Server clock minus ours, in ms, now and on every change */
  serverOffset(cb: (ms: number) => void): () => void;
  /** A fresh, time-ordered child key under `path` */
  pushKey(path: string): string;
}

// ---------------------------------------------------------------------------------------------------------------
// MemoryDb

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

const segments = (path: string): string[] => path.split('/').filter(Boolean);
const joinPath = (parts: string[]): string => parts.join('/');
const isPrefix = (a: string[], b: string[]): boolean => a.length <= b.length && a.every((s, i) => s === b[i]);
const isObject = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);

/** RTDB storage rules: undefined throws, null and empty objects vanish, arrays are kept as given */
function prune(v: unknown, where: string): Json {
  if (v === undefined) throw new Error(`MemoryDb: undefined at ${where || '/'}`);
  if (v === null) return null;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`MemoryDb: ${v} at ${where}`);
    return v;
  }
  if (typeof v === 'string' || typeof v === 'boolean') return v;
  if (Array.isArray(v)) {
    const out = v.map((x, i) => prune(x, `${where}/${i}`));
    return out.length ? out : null;
  }
  if (typeof v === 'object') {
    const out: JsonObject = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      const p = prune(x, `${where}/${k}`);
      if (p !== null) out[k] = p;
    }
    return Object.keys(out).length ? out : null;
  }
  throw new Error(`MemoryDb: cannot store ${typeof v} at ${where}`);
}

const clone = <T>(v: T): T => (v === null || typeof v !== 'object' ? v : structuredClone(v));
const same = (a: Json, b: Json): boolean => JSON.stringify(a) === JSON.stringify(b);

function readAt(root: Json, parts: string[]): Json {
  let node: Json = root;
  for (const p of parts) {
    if (!isObject(node) && !Array.isArray(node)) return null;
    node = (node as Record<string, Json>)[p] ?? null;
  }
  return node;
}

function writeAt(root: Json, parts: string[], value: Json): Json {
  if (!parts.length) return value;
  const [head, ...rest] = parts as [string, ...string[]];
  const base: JsonObject = isObject(root) ? { ...root } : {};
  const child = writeAt(base[head] ?? null, rest, value);
  if (child === null) delete base[head];
  else base[head] = child;
  return Object.keys(base).length ? base : null;
}

interface Watch {
  parts: string[];
  cb: (v: unknown) => void;
  /** Last value queued for delivery */
  last: string | undefined;
  /** Last value delivered: what this client "knows" (its cache) */
  known: Json | undefined;
  live: boolean;
}

/** One shared in-memory database; every MemoryDb client on it sees the others' writes */
export class MemoryServer {
  private root: Json = null;
  private readonly clients = new Set<MemoryDb>();
  private readonly disconnectOps = new Map<MemoryDb, Set<string>>();
  private lostAcks = 0;
  /** One-way delay in ms between a client and the server (0: a microtask) */
  latency: number;
  private keyCounter = 0;

  constructor(opts: { latency?: number; data?: unknown } = {}) {
    this.latency = opts.latency ?? 0;
    if (opts.data !== undefined) this.root = prune(opts.data, '');
  }

  /** The next `n` committed transactions are committed, but their clients see a conflict and run them again */
  loseAcks(n = 1): void {
    this.lostAcks += n;
  }

  /** Admin read (rules and latency don't apply) */
  read<T = unknown>(path = ''): T | null {
    return clone(readAt(this.root, segments(path))) as T | null;
  }

  /** @internal The stored value itself, not a copy. Safe to hold: writes copy the nodes they change. */
  peek(parts: string[]): Json {
    return readAt(this.root, parts);
  }

  /** Admin write: notifies every client */
  write(path: string, value: unknown): void {
    this.root = writeAt(this.root, segments(path), prune(value, path));
    this.changed(segments(path));
  }

  /** @internal */
  attach(c: MemoryDb): void {
    this.clients.add(c);
  }

  /** @internal Apply a multi-path update atomically */
  patch(path: string, patch: Record<string, unknown>): void {
    const base = segments(path);
    const touched: string[][] = [];
    for (const [k, v] of Object.entries(patch)) {
      const parts = [...base, ...segments(k)];
      this.root = writeAt(this.root, parts, prune(v, joinPath(parts)));
      touched.push(parts);
    }
    for (const t of touched) this.changed(t, false);
    this.flushChanges();
  }

  /** @internal */
  takeLostAck(): boolean {
    if (this.lostAcks <= 0) return false;
    this.lostAcks--;
    return true;
  }

  /** @internal */
  onDisconnect(c: MemoryDb, path: string, on: boolean): void {
    const set = this.disconnectOps.get(c) ?? new Set<string>();
    if (on) set.add(joinPath(segments(path)));
    else for (const p of [...set]) if (isPrefix(segments(path), segments(p))) set.delete(p);
    this.disconnectOps.set(c, set);
  }

  /** @internal The client's connection dropped: run its onDisconnect operations */
  dropped(c: MemoryDb): void {
    const ops = this.disconnectOps.get(c);
    this.disconnectOps.delete(c);
    if (ops?.size) this.patch('', Object.fromEntries([...ops].map((p) => [p, null])));
  }

  /** @internal */
  detach(c: MemoryDb): void {
    this.clients.delete(c);
  }

  /** @internal */
  nextKey(): string {
    return `-${Date.now().toString(36).padStart(9, '0')}${(this.keyCounter++).toString(36).padStart(5, '0')}`;
  }

  private pending: string[][] = [];

  private changed(parts: string[], flush = true): void {
    this.pending.push(parts);
    if (flush) this.flushChanges();
  }

  private flushChanges(): void {
    const changes = this.pending;
    this.pending = [];
    for (const c of this.clients) c.serverChanged(changes);
  }
}

export interface MemoryDbOptions {
  /** What serverOffset() reports */
  offset?: number;
  /** Overrides the server's latency for this client */
  latency?: number;
}

/** One client of a MemoryServer (a browser tab) */
export class MemoryDb implements Db {
  private readonly watches = new Set<Watch>();
  private readonly connWatchers = new Set<(up: boolean) => void>();
  private up = true;
  private dead = false;
  private online: Promise<void> = Promise.resolve();
  private goOnline: () => void = () => {};
  private readonly offset: number;
  private readonly latency: number | undefined;

  constructor(readonly server: MemoryServer = new MemoryServer(), opts: MemoryDbOptions = {}) {
    this.offset = opts.offset ?? 0;
    this.latency = opts.latency;
    server.attach(this);
  }

  /** The tab closed: the server runs its onDisconnect operations; everything it does from now on fails */
  kill(): void {
    if (this.dead) return;
    this.dead = true;
    this.up = false;
    this.server.dropped(this);
    this.server.detach(this);
    for (const w of this.watches) w.live = false;
    this.watches.clear();
    this.goOnline();
  }

  get alive(): boolean {
    return !this.dead;
  }

  /** A network blip: onDisconnect runs, nothing is delivered and writes wait until reconnect() */
  disconnect(): void {
    if (this.dead || !this.up) return;
    this.up = false;
    this.online = new Promise((resolve) => (this.goOnline = resolve));
    this.server.dropped(this);
    for (const cb of [...this.connWatchers]) this.deliver(() => cb(false), true);
  }

  reconnect(): void {
    if (this.dead || this.up) return;
    this.up = true;
    this.goOnline();
    for (const cb of [...this.connWatchers]) this.deliver(() => cb(true));
    for (const w of this.watches) this.refresh(w);
  }

  async get<T = unknown>(path: string): Promise<T | null> {
    await this.send();
    const v = this.server.read<T>(path);
    await this.receive();
    return v;
  }

  async set(path: string, value: unknown): Promise<void> {
    const v = prune(value, path);
    await this.send();
    this.server.write(path, v);
    await this.receive();
  }

  async update(path: string, patch: Record<string, unknown>): Promise<void> {
    for (const [k, v] of Object.entries(patch)) prune(v, `${path}/${k}`);
    await this.send();
    this.server.patch(path, patch);
    await this.receive();
  }

  remove(path: string): Promise<void> {
    return this.set(path, null);
  }

  async transact<T>(path: string, fn: (cur: T | null) => T | null | undefined): Promise<TransactResult<T>> {
    await this.ready();
    let cur = this.cached(segments(path));
    for (let attempt = 0; attempt < 25; attempt++) {
      const next = fn(clone(cur) as T | null);
      if (next === undefined) return { committed: false, value: clone(cur) as T | null };
      const value = prune(next, path);
      await this.send();
      const server = this.server.read<Json>(path);
      if (same(server, cur)) {
        this.server.write(path, value);
        const lost = this.server.takeLostAck();
        await this.receive();
        if (!lost) return { committed: true, value: clone(value) as T | null };
        // The commit landed but the ack didn't: the SDK runs the update again on the new value
        cur = this.server.read<Json>(path);
        continue;
      }
      cur = server;
      await this.receive();
    }
    throw new Error(`MemoryDb: transaction on ${path} gave up after 25 tries`);
  }

  watch<T = unknown>(path: string, cb: (value: T | null) => void): () => void {
    if (this.dead) return () => {};
    const w: Watch = { parts: segments(path), cb: cb as (v: unknown) => void, last: undefined, known: undefined, live: true };
    this.watches.add(w);
    this.refresh(w);
    return () => {
      w.live = false;
      this.watches.delete(w);
    };
  }

  async onDisconnectRemove(path: string): Promise<void> {
    await this.send();
    this.server.onDisconnect(this, path, true);
    await this.receive();
  }

  async cancelOnDisconnect(path: string): Promise<void> {
    await this.send();
    this.server.onDisconnect(this, path, false);
    await this.receive();
  }

  connected(cb: (up: boolean) => void): () => void {
    if (this.dead) return () => {};
    this.connWatchers.add(cb);
    const up = this.up;
    this.deliver(() => this.connWatchers.has(cb) && cb(up), true);
    return () => {
      this.connWatchers.delete(cb);
    };
  }

  serverOffset(cb: (ms: number) => void): () => void {
    let live = true;
    this.deliver(() => live && cb(this.offset), true);
    return () => {
      live = false;
    };
  }

  pushKey(_path: string): string {
    return this.server.nextKey();
  }

  /** @internal The server changed under these paths */
  serverChanged(changes: string[][]): void {
    if (!this.up) return;
    for (const w of this.watches) {
      if (changes.some((c) => isPrefix(c, w.parts) || isPrefix(w.parts, c))) this.refresh(w);
    }
  }

  private refresh(w: Watch): void {
    if (!this.up || !w.live) return;
    const v = this.server.peek(w.parts);
    const text = JSON.stringify(v);
    if (text === w.last) return;
    w.last = text;
    const value = clone(v);
    this.deliver(() => {
      if (!w.live || this.dead) return;
      w.known = value;
      w.cb(clone(value));
    });
  }

  /** What this client last heard about `parts` from a watch on it or an ancestor; null while cold */
  private cached(parts: string[]): Json {
    for (const w of this.watches) {
      if (w.known !== undefined && isPrefix(w.parts, parts)) return clone(readAt(w.known, parts.slice(w.parts.length)));
    }
    return null;
  }

  private queue: Array<() => void> = [];
  private flushing = false;

  /** Server-to-client messages arrive in order, after the latency */
  private deliver(fn: () => void, evenIfDown = false): void {
    this.queue.push(() => {
      if (this.dead || (!this.up && !evenIfDown)) return;
      fn();
    });
    if (this.flushing) return;
    this.flushing = true;
    void this.delay().then(() => {
      this.flushing = false;
      const q = this.queue;
      this.queue = [];
      for (const f of q) {
        try {
          f();
        } catch (err) {
          console.error('MemoryDb listener failed', err);
        }
      }
    });
  }

  private delay(): Promise<void> {
    const ms = this.latency ?? this.server.latency;
    return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
  }

  private async ready(): Promise<void> {
    if (this.dead) throw new Error('MemoryDb: this client is gone');
    if (!this.up) await this.online;
    if (this.dead) throw new Error('MemoryDb: this client is gone');
  }

  private async send(): Promise<void> {
    await this.ready();
    await this.delay();
    await this.ready();
  }

  private async receive(): Promise<void> {
    await this.delay();
    if (this.dead) throw new Error('MemoryDb: this client is gone');
  }
}

// ---------------------------------------------------------------------------------------------------------------
// FirebaseDb

type Rtdb = typeof import('firebase/database');

/**
 * Whether this build can go online (the same test as firebase.ts's isConfigured, without loading Firebase): the
 * emulator, or a database URL in the environment.
 */
export function onlineAvailable(): boolean {
  const env = import.meta.env as Record<string, string | undefined> | undefined;
  return env?.VITE_FIREBASE_EMULATOR === 'true' || Boolean(env?.VITE_FIREBASE_DATABASE_URL);
}

let shared: Promise<Db> | null = null;

/** The one FirebaseDb of this page (opened on first use; a failed open is retried on the next call) */
export function onlineDb(): Promise<Db> {
  shared ??= openFirebaseDb().catch((err: unknown) => {
    shared = null;
    throw err;
  });
  return shared;
}

/**
 * The Realtime Database. Firebase is imported here, on first use, so offline play never loads it (and never needs
 * it configured). Throws when Firebase is not configured.
 */
export async function openFirebaseDb(): Promise<Db> {
  const [rtdb, fb] = await Promise.all([import('firebase/database'), import('./firebase')]);
  if (!fb.isConfigured) throw new Error('Online play is not set up for this build');
  return new FirebaseDb(rtdb, fb.db());
}

class FirebaseDb implements Db {
  constructor(private readonly f: Rtdb, private readonly database: Database) {}

  private at(path: string) {
    return this.f.ref(this.database, path);
  }

  async get<T = unknown>(path: string): Promise<T | null> {
    return ((await this.f.get(this.at(path))).val() ?? null) as T | null;
  }

  set(path: string, value: unknown): Promise<void> {
    return this.f.set(this.at(path), value);
  }

  update(path: string, patch: Record<string, unknown>): Promise<void> {
    return this.f.update(this.at(path), patch);
  }

  remove(path: string): Promise<void> {
    return this.f.remove(this.at(path));
  }

  async transact<T>(path: string, fn: (cur: T | null) => T | null | undefined): Promise<TransactResult<T>> {
    const r = await this.f.runTransaction(this.at(path), (cur: T | null) => fn(cur ?? null), { applyLocally: false });
    return { committed: r.committed, value: (r.snapshot.val() ?? null) as T | null };
  }

  watch<T = unknown>(path: string, cb: (value: T | null) => void, onError?: (err: Error) => void): () => void {
    return this.f.onValue(this.at(path), (snap) => cb((snap.val() ?? null) as T | null), (err) => onError?.(err));
  }

  onDisconnectRemove(path: string): Promise<void> {
    return this.f.onDisconnect(this.at(path)).remove();
  }

  cancelOnDisconnect(path: string): Promise<void> {
    return this.f.onDisconnect(this.at(path)).cancel();
  }

  connected(cb: (up: boolean) => void): () => void {
    return this.f.onValue(this.at('.info/connected'), (snap) => cb(snap.val() === true));
  }

  serverOffset(cb: (ms: number) => void): () => void {
    return this.f.onValue(this.at('.info/serverTimeOffset'), (snap) => cb(Number(snap.val()) || 0));
  }

  pushKey(path: string): string {
    return this.f.push(this.at(path)).key as string;
  }
}
