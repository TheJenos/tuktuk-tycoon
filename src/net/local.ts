import { RULES_VERSION, SEAT_IDS, timer, type RulesConfig } from '../rules';
import { OFFLINE_TIMERS, phaseSecs, type TimerRules } from '../shared/timing';
import type { TokenId } from '../shared/tokens';
import { MemoryDb, MemoryServer } from './db';
import { createDoc, decodeDoc, encodeDoc } from './doc';
import { gameId, randomSeed } from './ids';
import { Session, type StateRecord } from './session';
import type { BotSkill, Doc, PlayerId, SeatInfo } from './types';

/*
 * Offline play ("Play now vs bots", hot-seat): the same Session, driver and transaction code as online, over a
 * private MemoryDb. Firebase is never loaded. The game is saved to localStorage after every move.
 */

export const SOLO_SAVE_KEY = 'tuktuk-solo-save';
/** The local player: controls every human seat (more than one = hot-seat) */
export const LOCAL_PLAYER: PlayerId = 'p_LOCALPLAYER';
const ROOM_PATH = 'rooms/LOCAL';

export interface LocalSeat {
  name: string;
  token: TokenId;
  color: string;
  kind: 'human' | 'bot';
  skill?: BotSkill;
}

export interface LocalOptions {
  /** A label for the save (e.g. the player's name) */
  name?: string;
  seats: LocalSeat[];
  rules?: Partial<RulesConfig>;
  timers?: TimerRules;
  seed?: number;
  /** Continue the saved game when there is one (otherwise a new game from `seats`) */
  resume?: boolean;
  /** Multiplies bot thinking time (1 = normal) */
  pace?: number;
}

interface SaveRecord {
  v: number;
  name: string;
  at: number;
  doc: string;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function readSave(): { name: string; doc: Doc } | null {
  try {
    const raw = storage()?.getItem(SOLO_SAVE_KEY);
    if (!raw) return null;
    const rec = JSON.parse(raw) as Partial<SaveRecord>;
    if (rec.v !== RULES_VERSION || typeof rec.doc !== 'string') return null;
    const doc = decodeDoc(rec.doc);
    return doc.game.phase.k === 'over' ? null : { name: String(rec.name ?? ''), doc };
  } catch {
    return null;
  }
}

function writeSave(name: string, doc: Doc): void {
  try {
    if (doc.game.phase.k === 'over') {
      storage()?.removeItem(SOLO_SAVE_KEY);
      return;
    }
    const rec: SaveRecord = { v: RULES_VERSION, name, at: Date.now(), doc: encodeDoc(doc) };
    storage()?.setItem(SOLO_SAVE_KEY, JSON.stringify(rec));
  } catch {
    // Storage full or unavailable: the game goes on unsaved
  }
}

/** A solo game that is still running is saved */
export const hasSoloSave = (): boolean => readSave() !== null;

export function clearSoloSave(): void {
  try {
    storage()?.removeItem(SOLO_SAVE_KEY);
  } catch {
    // nothing to clear
  }
}

/** The seats of a new local game: s0, s1, ... in the order given */
export function localSeats(seats: LocalSeat[], me: PlayerId = LOCAL_PLAYER): SeatInfo[] {
  return seats.map((s, i): SeatInfo => {
    const seat = SEAT_IDS[i];
    if (!seat) throw new Error('At most 8 seats');
    const info: SeatInfo = { seat, name: s.name, token: s.token, color: s.color, kind: s.kind, ctrl: s.kind === 'human' ? me : '' };
    if (s.kind === 'bot') info.skill = s.skill ?? 'normal';
    return info;
  });
}

export function createLocalSession(o: LocalOptions): Session {
  const saved = o.resume ? readSave() : null;
  const name = saved?.name ?? o.name ?? '';
  const now = Date.now();
  const doc = saved?.doc ?? createDoc({
    gid: gameId(),
    seats: localSeats(o.seats),
    rules: o.rules,
    timers: o.timers ?? OFFLINE_TIMERS,
    seed: o.seed ?? randomSeed(),
    at: now,
  });
  if (saved) {
    // Deadlines were in the old session's time: restart the running one from now
    const t = timer(doc.game);
    if (doc.deadline && t) doc.deadline = { key: doc.deadline.key, at: now + phaseSecs(t.kind, doc.timers) * 1000 };
  } else {
    writeSave(name, doc);
  }
  const record: StateRecord = { gid: doc.gid, seq: doc.seq, v: RULES_VERSION, at: now, data: encodeDoc(doc) };
  const server = new MemoryServer({ data: { rooms: { LOCAL: { state: record } } } });
  return new Session({
    db: new MemoryDb(server),
    roomPath: ROOM_PATH,
    me: LOCAL_PLAYER,
    code: null,
    online: false,
    alwaysDrive: true,
    log: false,
    pace: o.pace,
    onCommit: (d) => writeSave(name, d),
  });
}
