import { RULES_VERSION } from '../../src/rules';

/*
 * The Realtime Database emulator's REST API, as an admin (rules don't apply). Tests use it to set rooms
 * up (including `debug` rules, which only admin seeding may set), to put a game in a chosen position,
 * and to check what the game wrote. The layout is the one src/net/network.ts describes at its top.
 */

const HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST ?? '127.0.0.1:9000';
const NS = 'demo-tuktuk';

async function request(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`http://${HOST}/${path}.json?ns=${NS}`, {
    method,
    headers: { Authorization: 'Bearer owner' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

export const db = {
  get: <T = any>(path: string) => request('GET', path) as Promise<T | null>,
  put: (path: string, value: unknown) => request('PUT', path, value),
  patch: (path: string, value: Record<string, unknown>) => request('PATCH', path, value),
  del: (path: string) => request('DELETE', path),
  /** A value with a fresh push-style key, as the game's push() makes */
  push: async (path: string, value: unknown) => ((await request('POST', path, value)) as { name: string }).name,
};

/** The server's clock, which deadlines and `at` stamps run on (the emulator runs on this machine). */
export const serverNow = () => Date.now();

/** Room rules as `rooms/{code}/setup/rules` holds them. The engine's RulesConfig decides the full set. */
export type RoomRules = Record<string, unknown> & { speedDie?: boolean; debug?: boolean };

/**
 * Rules for a test room: `debug` on, so `game.test.rig()` and `setCash()` are accepted, and no timer on
 * anyone's decisions, so nothing moves on while a test is between steps (the auction keeps its countdown).
 * Each timer is spelled out: the game fills a missing one with its online default, not with "off".
 */
export function rules(over: RoomRules = {}): RoomRules {
  return { speedDie: false, turnTimer: 0, decisionTimer: 0, debtTimer: 0, debug: true, ...over };
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/**
 * A room placeholder member, so the lobby doesn't sweep the room away as empty before anyone joins.
 * Shaped like a browser player's id, so the game treats it as an ordinary member.
 */
export const PLACEHOLDER = 'p_E2EPLACEHOLDER';

/** `T` and 4 characters: a valid 5-character room code that real rooms (random 5) rarely start with. */
export function randomCode(): string {
  let s = 'T';
  for (let i = 0; i < 4; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

export interface SeedOptions {
  name?: string;
  /** The owner's display name and player id (the placeholder by default, so the first to join takes over) */
  host?: string;
  hostId?: string;
  maxSeats?: number;
  public?: boolean;
}

/** A waiting room as creating one makes it, written straight to the database. Returns its code. */
export async function seedRoom(r: RoomRules = rules(), opts: SeedOptions = {}): Promise<string> {
  const code = randomCode();
  const now = serverNow();
  const host = opts.host ?? 'E2E';
  await db.put(`lobby/${code}`, {
    name: opts.name ?? `E2E ${code}`,
    host,
    hostId: opts.hostId ?? PLACEHOLDER,
    createdAt: now,
    status: 'waiting',
    speedDie: r.speedDie === true,
    maxSeats: opts.maxSeats ?? 8,
    seatsTaken: 0,
    public: opts.public ?? true,
    members: { [PLACEHOLDER]: host },
  });
  await db.put(`rooms/${code}/setup`, { rules: r, locked: '' });
  return code;
}

/**
 * Put a game in a chosen position: `doc` (the room's whole transacted document, as src/net/doc.ts
 * builds it) written at `rooms/{code}/state` the way a committed transaction would leave it.
 */
export async function seedState(code: string, doc: unknown, meta: { gid?: string; seq?: number; v?: number } = {}): Promise<void> {
  const now = serverNow();
  await db.put(`rooms/${code}/state`, { gid: meta.gid ?? `g_${code}`, seq: meta.seq ?? 0, v: meta.v ?? RULES_VERSION, at: now, data: JSON.stringify(doc) });
  await db.patch(`lobby/${code}`, { status: 'playing', lastMoveAt: now });
}

/** The room's transacted document, decoded (null before the game starts). */
export async function readState<T = any>(code: string): Promise<{ seq: number; doc: T } | null> {
  const state = await db.get<{ seq: number; data: string }>(`rooms/${code}/state`);
  return state ? { seq: state.seq, doc: JSON.parse(state.data) as T } : null;
}

export async function deleteRoom(code: string): Promise<void> {
  await Promise.all([db.del(`lobby/${code}`), db.del(`rooms/${code}`)]);
}

export const dropPlaceholder = (code: string) => db.del(`lobby/${code}/members/${PLACEHOLDER}`);

/** Poll the database until `check` passes on the value at `path`. */
export async function waitForValue<T = any>(path: string, check: (v: T | null) => boolean, timeout = 15_000): Promise<T | null> {
  const end = Date.now() + timeout;
  let last: T | null = null;
  while (Date.now() < end) {
    last = await db.get<T>(path);
    if (check(last)) return last;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timed out waiting on ${path}; last value: ${JSON.stringify(last)}`);
}
