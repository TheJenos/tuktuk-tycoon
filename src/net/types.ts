import type { Action, Command, GameEvent, GameState, SeatId } from '../rules';
import type { TokenId } from '../shared/tokens';
import type { TimerRules } from '../shared/timing';
import type { Store } from '../state/store';

/*
 * The session contract between the net layer and everything that shows or plays the game (view, HUD, bots driver).
 * Offline play (createLocalSession) and online rooms (RoomConnection) implement the same GameSession.
 */

/** A network identity: 'p_' + 12 chars on the web, 'd_' + Discord user id inside Discord. Bots have none. */
export type PlayerId = string;
export type BotSkill = 'easy' | 'normal' | 'hard' | 'expert';

/** Who sits in a seat. Lives in the transacted Doc so seat handovers are atomic with moves. */
export interface SeatInfo {
  seat: SeatId;
  name: string;
  token: TokenId;
  /** One of SEAT_COLORS */
  color: string;
  kind: 'human' | 'bot';
  /** The player controlling a human seat ('' for bots and for a seat whose player left for good) */
  ctrl: PlayerId;
  /** Bot skill; also used when a human seat is played by a bot (afk) */
  skill?: BotSkill;
  /** Timed out twice in a row (or the owner handed it to a bot): the driver plays it until its player acts */
  afk?: boolean;
}

/** One committed command, as stored in Doc.recent and the move log */
export interface Envelope {
  /** 8 random chars: drops duplicates when the SDK re-runs a transaction after a lost ack */
  id: string;
  /** Who sent it ('' for driver chores sent on behalf of nobody in particular) */
  pid: PlayerId;
  /** serverNow() when it was sent */
  at: number;
  cmd: Command;
}

/** The whole transacted game document, stored as a JSON string at rooms/{code}/state/data */
export interface Doc {
  /** Game id: a new one per start / rematch */
  gid: string;
  /** Mirrors game.seq */
  seq: number;
  game: GameState;
  seats: Partial<Record<SeatId, SeatInfo>>;
  /** Ring of the last 16 envelope ids */
  ids: string[];
  /** The last <= 8 envelopes, oldest first; clients replay them to get events and verify the state */
  recent: Envelope[];
  /** The one running deadline (server ms); `key` is timer(game).key when it was set */
  deadline?: { key: string; at: number };
  timers: TimerRules;
  /** Consecutive timeouts per seat (two make it afk) */
  strikes: Partial<Record<SeatId, number>>;
  /**
   * Bumped whenever `seats` changes (a seat handed over, AFK on or off). A client replaying a gap checks who sent
   * each move against the seats only when this is unchanged: in between, the seats were others it never saw.
   */
  sv?: number;
  /** Timeouts in a row that hand a seat to the driver (0 = never); absent = AFK_STRIKES */
  afkStrikes?: number;
  /** Multiplies bot thinking time (0.5 quick, 1, 2 slow); absent = the session's own pace */
  botPace?: number;
  /** The skill the driver plays a seat with when the seat names none (an AFK human); absent = 'normal' */
  botSkill?: BotSkill;
  /** Server ms the room's time limit runs out: the driver then sends the system `timeUp` (absent = no limit) */
  endsAt?: number;
  /** The time limit in minutes that set endsAt (for the rules view and a local rematch) */
  timeLimit?: number;
}

/** What the view plays: the events of one committed command and the state after it, strictly in seq order */
export interface Batch {
  seq: number;
  events: GameEvent[];
  state: GameState;
  /** No events available (late join, gap, rejoin): jump straight to `state` */
  snap?: boolean;
  /** A snap into a different game than the last batch's (a rematch): nothing shown before it belongs to this one */
  fresh?: boolean;
}

export type DispatchResult = { ok: true; seq: number } | { ok: false; code: string; message: string };

export interface SessionView {
  /** Latest committed document (null until loaded / started) */
  doc: Doc | null;
  /** Seats this client controls (more than one = hot-seat) */
  mySeats: SeatId[];
  connected: boolean;
  /** This client runs the chores (bots, timeouts) */
  driver: boolean;
  /** A replay check failed: "Move 123 by Bob broke the rules" */
  tamper: string | null;
  /** Online only: whether each human seat's controller is connected (absent offline and for bots) */
  presence?: Partial<Record<SeatId, 'online' | 'offline'>>;
}

export interface GameSession {
  readonly online: boolean;
  readonly me: PlayerId;
  /** Room code online; null offline */
  readonly code: string | null;
  readonly view: Store<SessionView>;
  /**
   * Batches in seq order from now on. The first batch a new subscriber receives is a snap of the current state, so
   * the director never needs to read view.doc itself.
   */
  onBatch(cb: (b: Batch) => void): () => void;
  /** Commit an action for one of my seats. Resolves once committed or refused (never throws). */
  dispatch(seat: SeatId, a: Action): Promise<DispatchResult>;
  /** Server-clock ms (Date.now() offline) */
  serverNow(): number;
  dispose(): Promise<void>;
}
