import { vi } from 'vitest';
import type { RulesConfig, SeatId } from '../../rules';
import { SEAT_COLORS, TOKENS } from '../../shared/tokens';
import type { TimerRules } from '../../shared/timing';
import { MemoryDb, MemoryServer } from '../db';
import { createDoc, encodeDoc } from '../doc';
import { Session, type StateRecord } from '../session';
import type { Doc, Envelope, PlayerId, SeatInfo } from '../types';

export const PIDS = ['p_ALICE0000001', 'p_BOBBY0000002', 'p_CAROL0000003', 'p_DAVID0000004'] as const;
export const SEATS: SeatId[] = ['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7'];
export const T0 = 1_700_000_000_000;

/** Fake timers and clock (microtasks and setImmediate stay real, so promise chains run between timers) */
export function useClock(): void {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'], now: T0 });
}

/** Let every queued microtask and delivery run */
export async function flush(times = 3): Promise<void> {
  for (let i = 0; i < times; i++) {
    await vi.advanceTimersByTimeAsync(0);
    await new Promise<void>((r) => setImmediate(r));
  }
}

/** Advance fake time in steps until `done()` (or the budget runs out); returns done() */
export async function runUntil(done: () => boolean, budgetMs = 600_000, stepMs = 250): Promise<boolean> {
  for (let t = 0; t < budgetMs && !done(); t += stepMs) await vi.advanceTimersByTimeAsync(stepMs);
  await flush();
  return done();
}

/** Seats: 'h' = a human seat played by PIDS[i], 'b' = a bot */
export function seatList(kinds: string): SeatInfo[] {
  return [...kinds].map((k, i): SeatInfo => {
    const seat = SEATS[i] as SeatId;
    const base = { seat, name: `P${i}`, token: TOKENS[i]!.id, color: SEAT_COLORS[i]! };
    return k === 'b' ? { ...base, kind: 'bot', ctrl: '', skill: 'normal' } : { ...base, kind: 'human', ctrl: PIDS[i]! };
  });
}

export function makeDoc(kinds: string, o: { rules?: Partial<RulesConfig>; timers?: TimerRules; seed?: number; at?: number } = {}): Doc {
  return createDoc({ gid: 'g_TEST000001', seats: seatList(kinds), rules: o.rules, timers: o.timers, seed: o.seed ?? 7, at: o.at ?? T0 });
}

export const record = (doc: Doc, at = T0): StateRecord => ({ gid: doc.gid, seq: doc.seq, v: doc.game.v, at, data: encodeDoc(doc) });

let n = 0;
export function envelope(cmd: Envelope['cmd'], pid: PlayerId, at = T0 + 1_000): Envelope {
  n++;
  return { id: `E${String(n).padStart(7, '0')}`, pid, at, cmd };
}

/** A room state on a fresh server, and a Session per client */
export interface Table {
  server: MemoryServer;
  dbs: MemoryDb[];
  sessions: Session[];
}

export function table(
  doc: Doc,
  clients: Array<{ me: PlayerId; owner?: boolean; alwaysDrive?: boolean; visible?: () => boolean }>,
): Table {
  const server = new MemoryServer({ data: { rooms: { ROOM1: { state: record(doc) } } } });
  const dbs = clients.map(() => new MemoryDb(server));
  const sessions = clients.map((c, i) => new Session({
    db: dbs[i]!,
    roomPath: 'rooms/ROOM1',
    me: c.me,
    code: 'ROOM1',
    online: true,
    alwaysDrive: c.alwaysDrive,
    isOwner: () => c.owner === true,
    visible: c.visible,
    rank: () => i,
  }));
  return { server, dbs, sessions };
}

export const docOf = (s: Session): Doc => {
  const d = s.current();
  if (!d) throw new Error('no doc');
  return d;
};

/** A Storage stand-in for localStorage / sessionStorage in Node */
export function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}
