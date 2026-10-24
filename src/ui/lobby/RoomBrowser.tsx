import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { onlineDb } from '../../net/db';
import { ROOM_CODE_MAX } from '../../net/ids';
import { watchRooms, type RoomSummary } from '../../net/network';
import { savedSeats } from '../../net/rejoin';
import { boardName } from '../../rules';
import { friendlyError } from '../errors';

/*
 * The open rooms, live: each as a card (name, code, board, host, seats taken, Speed Die, waiting or playing) with the way
 * in: Join a waiting room, Watch a running game, or Rejoin one this browser holds a seat in. Plus joining by code.
 */

/** How long the list may stay on "Looking for rooms…" before it counts as a failure */
const ROOMS_TIMEOUT_MS = 8_000;

/** The public rooms, kept up to date while `enabled` (null while loading); `failed` offers a retry */
export function useRooms(enabled: boolean): { rooms: RoomSummary[] | null; failed: string | null; retry(): void } {
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    let got = false;
    const timer = setTimeout(() => {
      if (!got) setFailed("Couldn't reach the server.");
    }, ROOMS_TIMEOUT_MS);
    onlineDb().then((db) => {
      if (cancelled) return;
      stop = watchRooms(db, (list) => {
        got = true;
        clearTimeout(timer);
        setFailed(null);
        setRooms(list);
      }, (err) => setFailed(friendlyError(err)));
    }, (err: unknown) => setFailed(friendlyError(err)));
    return () => {
      cancelled = true;
      clearTimeout(timer);
      stop?.();
    };
  }, [enabled, attempt]);
  const retry = () => {
    setRooms(null);
    setFailed(null);
    setAttempt((a) => a + 1);
  };
  return { rooms, failed, retry };
}

/** The search box (it sits in the panel's header) */
export function RoomSearch({ value, onChange }: { value: string; onChange(v: string): void }) {
  return (
    <input
      type="search"
      className="room-search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Search rooms, codes, players…"
      aria-label="Search rooms"
    />
  );
}

const matches = (r: RoomSummary, q: string): boolean =>
  [r.name, r.code, r.host, ...r.players].some((f) => f.toLowerCase().includes(q));

const STATUS: Record<RoomSummary['status'], string> = { waiting: 'Waiting to start', playing: 'Playing', finished: 'Game over' };

export function RoomList({ rooms, failed, retry, search, onClearSearch, joining, disabled, onJoin, onCreate }: {
  rooms: RoomSummary[] | null;
  failed: string | null;
  retry(): void;
  search: string;
  onClearSearch(): void;
  /** The room being joined (its button spins) */
  joining: string;
  disabled: boolean;
  onJoin(code: string): void;
  onCreate(): void;
}) {
  const mine = useMemo(() => new Set(savedSeats().map((s) => s.code)), [rooms]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rooms && q ? rooms.filter((r) => matches(r, q)) : rooms;
  }, [rooms, search]);

  return (
    <ul id="room-list" aria-busy={rooms === null && !failed}>
      {failed ? (
        <li className="empty">{failed} <button type="button" onClick={retry}>Retry</button></li>
      ) : shown === null ? (
        <li className="empty"><span className="spinner" aria-hidden="true" />Looking for rooms…</li>
      ) : rooms && rooms.length === 0 ? (
        <li className="empty big">
          <strong>No open rooms right now</strong>
          <span className="muted">Open one and send your friends the code, or play the bots while you wait.</span>
          <span className="row">
            <button type="button" className="primary" onClick={onCreate}>＋ Create the first room</button>
          </span>
        </li>
      ) : shown.length === 0 ? (
        <li className="empty">No rooms match “{search.trim()}”. <button type="button" onClick={onClearSearch}>Clear search</button></li>
      ) : (
        shown.map((room) => {
          const rejoin = mine.has(room.code);
          const full = room.seatsTaken >= room.maxSeats;
          // Late join: a running game's bot seats can be taken over (from the spectators' seats)
          const action = rejoin ? 'Rejoin'
            : room.status === 'waiting' && !full ? 'Join'
            : room.status === 'playing' && room.lateJoin ? 'Join'
            : room.spectators ? 'Watch' : null;
          const busy = joining === room.code;
          return (
            <li key={room.code} className={`room-card ${room.status}`}>
              <div className="info">
                <div className="name">
                  {room.speedDie && <span className="badge speed" title="Speed Die rules">Speed Die</span>}
                  <span className="room-name">{room.name}</span>
                </div>
                <div className="meta">
                  <span className="line">
                    <span className="code" title="Room code">{room.code}</span>
                    <span className="room-board" title="Board">{boardName(room.board)}</span>
                    <span>Host: {room.host || '—'}</span>
                    <span className="seats" title="Seats taken">{room.seatsTaken}/{room.maxSeats} seats</span>
                    <span className={`room-status ${room.status}`}>{STATUS[room.status]}</span>
                  </span>
                  {room.players.length > 0 && (
                    <span className="line">
                      <span className="playing"><span className="dot" aria-hidden="true" />{room.players.length} here</span>
                      <span className="names">{room.players.slice(0, 4).join(', ')}{room.players.length > 4 ? '…' : ''}</span>
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                className="join"
                disabled={disabled || room.otherVersion || !action}
                title={room.otherVersion ? 'That room runs another version of the game' : !action ? "This room doesn't allow spectators" : undefined}
                aria-label={`${action ?? 'No spectators in'} ${room.name} (${room.code})`}
                onClick={() => onJoin(room.code)}
              >
                {busy ? <><span className="spinner" aria-hidden="true" />Joining…</> : room.otherVersion ? 'Other version' : (action ?? 'Full')}
              </button>
            </li>
          );
        })
      )}
    </ul>
  );
}

/** Joining a room by its code (a friend sent it), in the menu rail */
export function CodeJoin({ initialCode = '', busy, disabled, error, onJoin }: {
  initialCode?: string;
  busy: boolean;
  disabled: boolean;
  error: string;
  onJoin(code: string): void;
}) {
  const [code, setCode] = useState(initialCode);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (code.trim()) onJoin(code.trim());
  };
  return (
    <div className="code-join-box">
      <span className="code-join-title">Have a room code?</span>
      <form className="code-join" onSubmit={submit}>
        <input
          id="code-input"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
          maxLength={ROOM_CODE_MAX}
          placeholder="Room code"
          aria-label="Room code"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="go"
        />
        <button type="submit" disabled={disabled || !code.trim()}>
          {busy ? <><span className="spinner" aria-hidden="true" />Joining…</> : 'Join'}
        </button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
