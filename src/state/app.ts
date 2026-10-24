import { inviteCode } from '../net/ids';
import type { ClosedReason, LobbyRecord, PresenceRecord, RoomConnection, RoomHandlers, SetupRecord } from '../net/network';
import { tabRoom } from '../net/rejoin';
import type { Session } from '../net/session';
import type { PlayerId } from '../net/types';
import { sessionStore } from './session';
import { createStore, type Store } from './store';

/*
 * Which screen the app shows (there is no router): the lobby, a local game, or an online room (its waiting room,
 * then its game). Moving between them keeps the 3D stage (sessionStore) and the address bar (#CODE while in a
 * room, so a reload or a copied link comes back to it) in step.
 */

/** What the room screens draw from: kept current by the RoomConnection's handlers */
export interface RoomView {
  lobby: LobbyRecord | null;
  setup: SetupRecord | null;
  presence: Record<PlayerId, PresenceRecord>;
  owner: { id: PlayerId; name: string } | null;
  connected: boolean;
  closed: ClosedReason | null;
  /** The game once one has started (the same Session for every game in the room) */
  game: Session | null;
  /** The game on screen: a rematch gets a new one */
  gid: string | null;
}

export interface Room {
  conn: RoomConnection;
  view: Store<RoomView>;
  /** Opened inside a Discord Activity: the voice channel is the room, so there are no invite links */
  discord: boolean;
}

/** A room's view store, and the handlers to give RoomConnection.create / join so it stays current */
export function roomView(): { view: Store<RoomView>; handlers: RoomHandlers } {
  const view = createStore<RoomView>({
    lobby: null,
    setup: null,
    presence: {},
    owner: null,
    connected: true,
    closed: null,
    game: null,
    gid: null,
  });
  const handlers: RoomHandlers = {
    onLobby: (lobby) => view.update({ lobby }),
    onSetup: (setup) => view.update({ setup }),
    onPresence: (presence) => view.update({ presence }),
    onOwner: (id, name) => view.update({ owner: { id, name } }),
    onConnection: (connected) => view.update({ connected }),
    onClosed: (closed) => view.update({ closed }),
    onSession: (game) => view.update({ game, gid: game.current()?.gid ?? null }),
  };
  return { view, handlers };
}

export type Screen =
  | { k: 'lobby'; notice: string | null }
  | { k: 'local'; session: Session }
  | { k: 'room'; room: Room };

export interface Joining {
  /** "Joining room ABCDE…" */
  label: string;
  cancel(): void;
}

export interface AppState {
  screen: Screen;
  /** A room is being joined or created: the connecting overlay is up */
  joining: Joining | null;
}

export const appStore = createStore<AppState>({ screen: { k: 'lobby', notice: null }, joining: null });

const CLOSED_TEXT: Record<ClosedReason, string> = {
  deleted: 'That room has closed.',
  kicked: 'You were removed from that room.',
  version: 'That room is running a different version of the game. Reload the page to update.',
};

/** The address without an invite in it (the query string stays: inside Discord it carries the Activity's ids) */
function plainUrl(): string {
  if (typeof location === 'undefined') return '';
  const q = new URLSearchParams(location.search);
  q.delete('room');
  const search = q.toString();
  return `${location.pathname}${search ? `?${search}` : ''}`;
}

function setUrl(url: string): void {
  if (typeof history !== 'undefined') history.replaceState(null, '', url);
}

/** Forget the invite in the address bar (the player stayed in the lobby, or the room is gone) */
export const clearInvite = (): void => setUrl(plainUrl());

/** Undoes what the current screen set up (its room subscription) */
let teardown: (() => void) | null = null;

function leaveScreen(): void {
  teardown?.();
  teardown = null;
}

export function showLobby(notice: string | null = null): void {
  const wasRoom = appStore.get().screen.k === 'room';
  leaveScreen();
  sessionStore.update({ session: null });
  if (wasRoom) setUrl(plainUrl());
  appStore.update({ screen: { k: 'lobby', notice }, joining: null });
}

export function enterLocal(session: Session): void {
  leaveScreen();
  sessionStore.update({ session });
  appStore.update({ screen: { k: 'local', session }, joining: null });
}

/** Leave a local game (its autosave stays for Continue) */
export function leaveLocal(session: Session): void {
  const s = appStore.get().screen;
  if (s.k !== 'local' || s.session !== session) return;
  void session.dispose();
  showLobby();
}

export function enterRoom(room: Room): void {
  leaveScreen();
  setUrl(`${plainUrl()}#${room.conn.code}`);
  // The stage shows the board once a game exists; back in the lobby when the room goes away
  const sync = () => {
    const v = room.view.get();
    if (v.closed) {
      leaveRoom(room, CLOSED_TEXT[v.closed]);
      return;
    }
    if (sessionStore.get().session !== v.game) sessionStore.update({ session: v.game });
  };
  const unsub = room.view.subscribe(sync);
  teardown = unsub;
  appStore.update({ screen: { k: 'room', room }, joining: null });
  sync();
}

/** Leave the room for the lobby. Leaving finishes in the background; the next join waits for it. */
export function leaveRoom(room: Room, notice: string | null = null): void {
  const s = appStore.get().screen;
  if (s.k !== 'room' || s.room !== room) return;
  void room.conn.leave();
  showLobby(notice);
}

export function setJoining(joining: Joining | null): void {
  appStore.update({ joining });
}

export interface Launch {
  /** The room an invite link points at (?room=CODE or #CODE) */
  invite: string | null;
  /** The room this tab was in before a reload */
  rejoin: { code: string; pid: PlayerId } | null;
}

let launch: Launch | null = null;

/** How the page was opened: read once, at the first look */
export function launchIntent(): Launch {
  launch ??= { invite: inviteCode(), rejoin: tabRoom() };
  return launch;
}

/** The launch intent, once: the lobby acts on it the first time it opens, never again */
export function takeLaunch(): Launch {
  const l = launchIntent();
  launch = { invite: null, rejoin: null };
  return l;
}
