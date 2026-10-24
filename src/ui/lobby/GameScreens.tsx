import { useEffect, useMemo, useRef } from 'react';
import { createLocalSession } from '../../net/local';
import { RoomError } from '../../net/network';
import type { Session } from '../../net/session';
import type { DispatchResult, SeatInfo } from '../../net/types';
import { SEAT_IDS, type SeatId } from '../../rules';
import { enterLocal, leaveLocal, leaveRoom, type Room } from '../../state/app';
import { useSelector, useStore } from '../../state/store';
import { friendlyError } from '../errors';
import { GameView, type OwnerActions } from '../game';
import { toast } from '../game/actions';
import { installGameHooks } from '../testHooks';
import { useDiscordActivity } from './discordActivity';
import { WaitingRoom } from './WaitingRoom';

/*
 * The game screen as each kind of game wires it: a local game (you own the table: Finish now and Rematch), and an
 * online room (its waiting room until the game starts, then the game with the owner's seat actions). A refusal from
 * an owner action shows as one of the game's toasts.
 */

/** Runs an owner action; a refusal (or a throw) becomes a toast */
function act(fn: () => Promise<DispatchResult | void>): void {
  let p: Promise<DispatchResult | void>;
  try {
    p = fn();
  } catch (err) {
    toast(err instanceof RoomError ? err.message : friendlyError(err));
    return;
  }
  p.then(
    (r) => {
      if (r && !r.ok) toast(r.message);
    },
    (err: unknown) => toast(err instanceof RoomError ? err.message : friendlyError(err)),
  );
}

/** A key per session, so a new local game gets a fresh game screen */
const sessionKeys = new WeakMap<Session, number>();
let nextKey = 1;
function keyOf(session: Session): number {
  let k = sessionKeys.get(session);
  if (k === undefined) sessionKeys.set(session, (k = nextKey++));
  return k;
}

export function LocalGame({ session, name }: { session: Session; name: string }) {
  const ownerActions = useMemo<OwnerActions>(() => ({
    finishNow: () => {
      const doc = session.current();
      if (doc) act(() => session.command({ by: 'system', a: { k: 'endGame' }, basis: doc.seq }));
    },
  }), [session]);
  // Same table and rules, a new game (once: a double click must not leave a second game running unseen)
  const rematched = useRef(false);
  const rematch = () => {
    const doc = session.current();
    if (!doc || rematched.current) return;
    rematched.current = true;
    const seats = SEAT_IDS.map((id) => doc.seats[id]).filter((s): s is SeatInfo => !!s);
    void session.dispose();
    enterLocal(createLocalSession({
      name,
      seats: seats.map((s) => ({ name: s.name, token: s.token, color: s.color, kind: s.kind, ...(s.kind === 'bot' ? { skill: s.skill ?? 'normal' } : {}) })),
      rules: doc.game.cfg,
      timers: doc.timers,
    }));
  };
  return <GameView key={keyOf(session)} session={session} onLeave={() => leaveLocal(session)} isOwner ownerActions={ownerActions} onRematch={rematch} />;
}

/** An online room: the waiting room, then the game */
export function RoomScreen({ room, name }: { room: Room; name: string }) {
  const game = useSelector(room.view, (v) => v.game);
  // window.game for the waiting room as well as the game (the game screen adds its own reference)
  useEffect(() => installGameHooks(room.conn.roomSession()), [room]);
  useDiscordActivity(room);
  return game ? <OnlineGame room={room} session={game} /> : <WaitingRoom room={room} name={name} />;
}

function OnlineGame({ room, session }: { room: Room; session: Session }) {
  const v = useStore(room.view);
  const conn = room.conn;
  const owner = v.owner?.id === conn.me;
  const spectators = useMemo(
    () => Object.entries(v.presence).filter(([pid, p]) => pid !== conn.me && !p.seat).map(([pid, p]) => ({ pid, name: p.name })),
    [v.presence, conn.me],
  );
  const ownerActions = useMemo<OwnerActions | undefined>(() => (owner ? {
    letBotPlay: (seat: SeatId) => act(() => conn.letBotPlay(seat)),
    giveSeat: (seat: SeatId, to: string) => act(() => conn.assignSeat(seat, to)),
    spectators,
    kick: (seat: SeatId) => {
      const pid = session.current()?.seats[seat]?.ctrl;
      if (pid) act(() => conn.kick(pid));
    },
    finishNow: () => act(() => conn.finishNow()),
  } : undefined), [owner, conn, session, spectators]);

  return (
    <GameView
      key={v.gid ?? ''}
      session={session}
      onLeave={() => leaveRoom(room)}
      isOwner={owner}
      {...(ownerActions ? { ownerActions } : {})}
      onTakeBack={(seat) => act(() => conn.takeBackControl(seat))}
      {...(owner ? { onRematch: () => act(() => conn.rematch()) } : {})}
    />
  );
}
