import { onlineDb, type Db } from '../../net/db';
import { RoomConnection, RoomError, type CreateRoomOptions, type RoomHandlers } from '../../net/network';
import { freeRoomPlayerId } from '../../net/rejoin';
import { enterRoom, roomView, setJoining } from '../../state/app';
import { friendlyError } from '../errors';

/*
 * Getting into a room: the connecting overlay while it happens (with a way out), then the room screen. A join that
 * finishes after it was cancelled or timed out leaves again at once, unless the player has meanwhile started
 * another join to the same room as the same player: then it only lets go of its listeners, because leaving would
 * remove that player (and their seat) from under the newer join.
 */

/** The player backed out of joining */
export class JoinCancelled extends Error {
  constructor() {
    super('Cancelled');
  }
}

const JOIN_TIMEOUT_MS = 25_000;

/** The latest attempt per room code and player id ('ABCDE p_…' → its number) */
const latest = new Map<string, number>();
let attempts = 0;
const attemptKey = (code: string, me: string) => `${code} ${me}`;

function connect(label: string, open: (db: Db, handlers: RoomHandlers, n: number) => Promise<RoomConnection>, discord: boolean): Promise<void> {
  const { view, handlers } = roomView();
  const n = ++attempts;
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      setJoining(null);
      reject(err);
    };
    const timer = setTimeout(() => fail(new Error('The server took too long to answer. Check your connection and try again.')), JOIN_TIMEOUT_MS);
    setJoining({ label, cancel: () => fail(new JoinCancelled()) });
    onlineDb()
      .then((db) => open(db, handlers, n))
      .then((conn) => {
        if (settled) {
          if ((latest.get(attemptKey(conn.code, conn.me)) ?? n) > n) conn.abandon();
          else void conn.leave();
          return;
        }
        settled = true;
        clearTimeout(timer);
        enterRoom({ conn, view, discord });
        resolve();
      }, fail);
  });
}

/** Attempt `n` is the newest for this room and player: an older one that finishes late must not leave */
function claim(code: string, me: string, n: number): void {
  latest.set(attemptKey(code, me), Math.max(n, latest.get(attemptKey(code, me)) ?? 0));
}

/** Join room `code` as the player this browser was in it before (or a new one) */
export function joinRoom(code: string, name: string, o: { pid?: string; label?: string } = {}): Promise<void> {
  return connect(o.label ?? `Joining room ${code}…`, async (db, h, n) => {
    const me = await freeRoomPlayerId(code, o.pid);
    claim(code, me, n);
    return RoomConnection.join(db, code, { me, name }, h);
  }, false);
}

export function createRoom(o: CreateRoomOptions): Promise<void> {
  return connect('Opening your room…', (db, h) => RoomConnection.create(db, o, h), false);
}

/** Discord: the voice channel's room, made by the first player in and joined by everyone after */
export function joinOrCreateRoom(code: string, o: CreateRoomOptions): Promise<void> {
  return connect('Joining the table…', (db, h, n) => {
    claim(code, o.me, n);
    return RoomConnection.joinOrCreate(db, code, o, h);
  }, true);
}

/** What to tell the player when getting in failed (null: they cancelled, say nothing) */
export function joinErrorText(err: unknown): string | null {
  if (err instanceof JoinCancelled) return null;
  if (err instanceof RoomError) return err.message;
  return friendlyError(err);
}

export const isClosedError = (err: unknown): boolean => err instanceof RoomError && err.code === 'closed';
