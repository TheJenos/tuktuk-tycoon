import { isPlayerId, playerId } from './ids';
import type { PlayerId } from './types';

/*
 * Coming back to a room as the same player. Seats are keyed by player id, so the id is what must survive:
 *   - sessionStorage 'tuktuk-session' {code, pid}: this tab's room, for a refresh (dies with the tab);
 *   - localStorage 'tuktuk-seats' {code: {pid, at}}: every room this browser holds a seat in, for 7 days, so closing
 *     the tab and opening the invite link again reclaims the seat.
 * A remembered id is only reused when no other open tab of this browser is in the room as that player (they are
 * asked over a BroadcastChannel): a second tab opening the invite link is a second player, not the first one again.
 * Inside Discord the id is 'd_<discord user id>', which already works across devices.
 */

const SESSION_KEY = 'tuktuk-session';
const SEATS_KEY = 'tuktuk-seats';
const CHANNEL = 'tuktuk-tabs';
export const SEAT_MEMORY_MS = 7 * 24 * 60 * 60 * 1000;
/** How long a tab waits for another tab to say it is using an id */
export const TAB_ANSWER_MS = 250;

export interface SavedSeat {
  code: string;
  pid: PlayerId;
  at: number;
}

interface SeatMemory {
  pid: PlayerId;
  at: number;
  /** Removed from the room: the id is kept so the kick still applies, but there is nothing to rejoin */
  kicked?: true;
}

function read<T>(store: () => Storage | undefined, key: string): T | null {
  try {
    const raw = store()?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(store: () => Storage | undefined, key: string, value: unknown): void {
  try {
    const s = store();
    if (value === null) s?.removeItem(key);
    else s?.setItem(key, JSON.stringify(value));
  } catch {
    // No storage: a refresh starts over
  }
}

const sessionStore = (): Storage | undefined => (typeof sessionStorage === 'undefined' ? undefined : sessionStorage);
const localStore = (): Storage | undefined => (typeof localStorage === 'undefined' ? undefined : localStorage);

function seats(now = Date.now()): Record<string, SeatMemory> {
  const all = read<Record<string, { pid?: unknown; at?: unknown; kicked?: unknown }>>(localStore, SEATS_KEY) ?? {};
  const out: Record<string, SeatMemory> = {};
  for (const [code, s] of Object.entries(all)) {
    if (isPlayerId(s?.pid) && typeof s.at === 'number' && now - s.at < SEAT_MEMORY_MS) {
      out[code] = { pid: s.pid, at: s.at, ...(s.kicked === true ? { kicked: true as const } : {}) };
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ open tabs

/** Rooms this page is in right now, and as whom */
const held = new Map<string, PlayerId>();
let channel: BroadcastChannel | null | undefined;

interface TabMessage {
  q?: 'who';
  a?: 'mine';
  pid?: unknown;
  id?: unknown;
}

function tabs(): BroadcastChannel | null {
  if (channel !== undefined) return channel;
  channel = null;
  if (typeof BroadcastChannel === 'undefined') return null;
  try {
    const ch = new BroadcastChannel(CHANNEL);
    // Node (tests): an open channel would keep the process alive
    (ch as unknown as { unref?: () => void }).unref?.();
    ch.addEventListener('message', (e: MessageEvent<TabMessage>) => {
      const m = e.data;
      if (m?.q === 'who' && typeof m.pid === 'string' && [...held.values()].includes(m.pid)) ch.postMessage({ a: 'mine', pid: m.pid, id: m.id });
    });
    channel = ch;
  } catch {
    // No channel: every tab reuses the remembered id, as before
  }
  return channel;
}

/** Is another open tab of this browser in a room as `pid`? (Silence within `ms` means no.) */
export function pidInUse(pid: PlayerId, ms = TAB_ANSWER_MS): Promise<boolean> {
  const ch = tabs();
  if (!ch) return Promise.resolve(false);
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve) => {
    const done = (v: boolean) => {
      clearTimeout(timer);
      ch.removeEventListener('message', onAnswer);
      resolve(v);
    };
    const onAnswer = (e: MessageEvent<TabMessage>) => {
      if (e.data?.a === 'mine' && e.data.id === id) done(true);
    };
    const timer = setTimeout(() => done(false), ms);
    ch.addEventListener('message', onAnswer);
    ch.postMessage({ q: 'who', pid, id });
  });
}

/** This page no longer plays in `code` (it left, or the room closed) */
export function releaseTab(code: string): void {
  held.delete(code);
}

// ------------------------------------------------------------------------------------------------ memory

/** This tab is in `code` as `pid`; remembered for a refresh and, for 7 days, for the invite link */
export function rememberRoom(code: string, pid: PlayerId): void {
  held.set(code, pid);
  tabs();
  write(sessionStore, SESSION_KEY, { code, pid });
  write(localStore, SEATS_KEY, { ...seats(), [code]: { pid, at: Date.now() } });
}

/** The id this browser last used in `code`: this tab's first, then the 7-day seat memory */
export function rememberedPid(code: string): PlayerId | null {
  const s = read<{ code?: unknown; pid?: unknown }>(sessionStore, SESSION_KEY);
  if (s?.code === code && isPlayerId(s.pid)) return s.pid;
  return seats()[code]?.pid ?? null;
}

/** The id to enter `code` with: the remembered one, else `fresh()` */
export const roomPlayerId = (code: string, fresh: () => PlayerId = playerId): PlayerId => rememberedPid(code) ?? fresh();

/**
 * The id to join `code` with: `want` (a refresh's own id) or the remembered one, unless another open tab is in
 * the room as that player right now (a second tab, or a duplicated one); then a new player.
 */
export async function freeRoomPlayerId(code: string, want?: PlayerId, fresh: () => PlayerId = playerId): Promise<PlayerId> {
  const pid = want ?? rememberedPid(code);
  if (!pid || held.get(code) === pid) return pid ?? fresh();
  return (await pidInUse(pid)) ? fresh() : pid;
}

/** The room this tab was in (for a refresh straight back into it) */
export function tabRoom(): { code: string; pid: PlayerId } | null {
  const s = read<{ code?: unknown; pid?: unknown }>(sessionStore, SESSION_KEY);
  return s && typeof s.code === 'string' && isPlayerId(s.pid) ? { code: s.code, pid: s.pid } : null;
}

/**
 * Left through the menu: a refresh no longer goes back. `seat` also forgets the 7-day memory; `kicked` keeps the
 * id but no longer offers a rejoin.
 */
export function forgetRoom(code: string, { seat = false, kicked = false }: { seat?: boolean; kicked?: boolean } = {}): void {
  releaseTab(code);
  if (tabRoom()?.code === code) write(sessionStore, SESSION_KEY, null);
  if (seat || kicked) {
    const all = seats();
    const was = all[code];
    if (kicked && was) all[code] = { ...was, kicked: true };
    else delete all[code];
    write(localStore, SEATS_KEY, all);
  }
}

/** Rooms this browser holds a seat in, newest first ("Your game in ABCDE is still running — Rejoin") */
export function savedSeats(): SavedSeat[] {
  return Object.entries(seats())
    .filter(([, s]) => !s.kicked)
    .map(([code, s]) => ({ code, pid: s.pid, at: s.at }))
    .sort((a, b) => b.at - a.at);
}
