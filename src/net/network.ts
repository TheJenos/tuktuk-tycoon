import { DEFAULT_RULES, RULES_VERSION, SEAT_IDS, type RulesConfig, type SeatId } from '../rules';
import { ONLINE_TIMERS, type TimerRules } from '../shared/timing';
import { SEAT_COLORS, TOKENS, isTokenId, type TokenId } from '../shared/tokens';
import type { Db } from './db';
import { cleanSeat, createDoc, encodeDoc, othersPlaying, seatsOf } from './doc';
import { envelopeId, gameId, isPlayerId, randomSeed, roomCode } from './ids';

export { inviteCode } from './ids';
import { forgetRoom, rememberRoom, releaseTab } from './rejoin';
import { Session, type StateRecord } from './session';
import type { BotSkill, DispatchResult, Doc, PlayerId, SeatInfo } from './types';

/*
 * Online rooms over a Db (FirebaseDb in the browser, MemoryDb in tests).
 *
 *   lobby/{code}               {name, host, hostId, createdAt, status, v, speedDie, maxSeats, seatsTaken, public,
 *                               lastMoveAt, members{pid: name}}   small: everyone in the lobby list downloads it
 *   rooms/{code}/setup         {rules, seats{seatId: SeatInfo}, locked: gid|'', op}   the waiting room (by transaction;
 *                               op is the last edit's id, so an edit run again after a lost ack sees it landed)
 *   rooms/{code}/state         {gid, seq, v, at, data}   the game (Session, by transaction only)
 *   rooms/{code}/driver        {pid, until}   the chore lease (Session)
 *   rooms/{code}/presence/{pid} {name, seat, vis, at}   connected players (onDisconnect remove)
 *   rooms/{code}/log/{gid}/m000123   {env, h}   write-once move history, per game
 *   rooms/{code}/kicked/{pid}  true
 *
 * Patterns from the reference: createRoomWithCode by transaction; presence arms onDisconnect first and registers
 * again on every reconnect; the owner (hostId) is settled only once members and hostId have both loaded, and only
 * the heir writes; rooms are deleted only after re-reading that nobody is in them.
 */

export type RoomStatus = 'waiting' | 'playing' | 'finished';

export interface LobbyRecord {
  name: string;
  host: string;
  hostId: PlayerId;
  createdAt: number;
  status: RoomStatus;
  /** RULES_VERSION of the client that made the room */
  v?: number;
  speedDie: boolean;
  maxSeats: number;
  seatsTaken: number;
  public: boolean;
  lastMoveAt?: number;
  /** Connected humans only (onDisconnect removes them) */
  members?: Record<PlayerId, string>;
}

/** rooms/{code}/setup/rules: the RulesConfig fields a room may change, plus its timers in seconds (0 = off) */
export interface RoomRules {
  speedDie: boolean;
  startCash: number;
  luxuryTax: number;
  triplesRollAgain: boolean;
  /** Total turns before the game ends ranked by worth (0 = no limit) */
  turnLimit: number;
  turnTimer: number;
  decisionTimer: number;
  auctionTimer: number;
  debtTimer: number;
  /** e2e only: set by admin seeding, refused from clients by the database rules */
  debug?: boolean;
}

export interface SetupRecord {
  rules: RoomRules;
  seats: Partial<Record<SeatId, SeatInfo>>;
  /** '' while waiting; the gid being started */
  locked: string;
  /** Id of the last edit made by transaction */
  op?: string;
}

export interface PresenceRecord {
  name: string;
  seat: SeatId | '';
  vis: boolean;
  at: number;
}

export interface RoomSummary {
  code: string;
  name: string;
  host: string;
  status: RoomStatus;
  speedDie: boolean;
  maxSeats: number;
  seatsTaken: number;
  /** Names of the connected players */
  players: string[];
  public: boolean;
  createdAt: number;
  lastMoveAt?: number;
  /** Made by another game version: joining is refused */
  otherVersion: boolean;
}

export type ClosedReason = 'deleted' | 'kicked' | 'version';

export interface RoomHandlers {
  onSetup?(setup: SetupRecord | null): void;
  onLobby?(lobby: LobbyRecord): void;
  onPresence?(presence: Record<PlayerId, PresenceRecord>): void;
  /** Who owns the room now */
  onOwner?(id: PlayerId, name: string): void;
  onConnection?(up: boolean): void;
  /** The room went away under us; the connection has shut itself down */
  onClosed?(why: ClosedReason): void;
  /** A game started (or a rematch did): session() now has a document */
  onSession?(session: Session): void;
}

export class RoomError extends Error {
  constructor(
    readonly code: 'closed' | 'version' | 'kicked' | 'full' | 'started' | 'token' | 'owner' | 'seats' | 'taken' | 'bad',
    message: string,
  ) {
    super(message);
  }
}

export const MIN_START_SEATS = 2;
/** An empty waiting room is deleted after this long */
export const EMPTY_GRACE_MS = 60_000;
/** An empty running game is kept this long after its last move */
export const IDLE_GAME_MS = 24 * 60 * 60 * 1000;
/** The driver refreshes lobby.lastMoveAt at most this often */
const LAST_MOVE_EVERY_MS = 60_000;

const BOT_NAMES = ['Ava', 'Max', 'Ivy', 'Leo', 'Zoe', 'Kai', 'Mia', 'Rex'];

export const DEFAULT_ROOM_RULES: RoomRules = {
  speedDie: DEFAULT_RULES.speedDie,
  startCash: DEFAULT_RULES.startCash,
  luxuryTax: DEFAULT_RULES.luxuryTax,
  triplesRollAgain: DEFAULT_RULES.triplesRollAgain,
  turnLimit: 0,
  turnTimer: ONLINE_TIMERS.turn,
  decisionTimer: ONLINE_TIMERS.decision,
  auctionTimer: ONLINE_TIMERS.auction,
  debtTimer: ONLINE_TIMERS.debt,
};

const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** Room rules from engine rules and timers (what the create wizard picked) */
export function toRoomRules(rules: Partial<RulesConfig> = {}, timers: TimerRules = ONLINE_TIMERS): RoomRules {
  return {
    speedDie: rules.speedDie ?? DEFAULT_ROOM_RULES.speedDie,
    startCash: rules.startCash ?? DEFAULT_ROOM_RULES.startCash,
    luxuryTax: rules.luxuryTax ?? DEFAULT_ROOM_RULES.luxuryTax,
    triplesRollAgain: rules.triplesRollAgain ?? DEFAULT_ROOM_RULES.triplesRollAgain,
    turnLimit: rules.turnLimit ?? 0,
    turnTimer: timers.turn,
    decisionTimer: timers.decision,
    auctionTimer: timers.auction,
    debtTimer: timers.debt,
  };
}

/**
 * Engine rules and timers from stored room rules (missing fields take defaults). A room seeded with only
 * `turnTimer: 0` has every human timer off; the auction always keeps one.
 */
export function roomConfig(raw?: Partial<RoomRules> | null): { rules: Partial<RulesConfig>; timers: TimerRules } {
  const r = (raw ?? {}) as Partial<Record<keyof RoomRules, unknown>>;
  const turn = num(r.turnTimer, DEFAULT_ROOM_RULES.turnTimer);
  const off = turn === 0;
  const rules: Partial<RulesConfig> = {
    speedDie: r.speedDie === true,
    startCash: num(r.startCash, DEFAULT_ROOM_RULES.startCash),
    luxuryTax: num(r.luxuryTax, DEFAULT_ROOM_RULES.luxuryTax),
    triplesRollAgain: r.triplesRollAgain !== false,
    turnLimit: num(r.turnLimit, 0),
  };
  if (r.debug === true) rules.debug = true;
  const timers: TimerRules = {
    turn,
    decision: num(r.decisionTimer, off ? 0 : DEFAULT_ROOM_RULES.decisionTimer),
    auction: num(r.auctionTimer, DEFAULT_ROOM_RULES.auctionTimer),
    debt: num(r.debtTimer, off ? 0 : DEFAULT_ROOM_RULES.debtTimer),
  };
  return { rules, timers };
}

/** The setup as stored, with its containers filled in (RTDB drops empty ones) */
export function readSetup(raw: Partial<SetupRecord> | null): SetupRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  return {
    rules: { ...DEFAULT_ROOM_RULES, ...raw.rules },
    seats: raw.seats && typeof raw.seats === 'object' ? raw.seats : {},
    locked: typeof raw.locked === 'string' ? raw.locked : '',
  };
}

/** The seats of a setup in seat order */
export const setupSeats = (s: SetupRecord): SeatInfo[] =>
  SEAT_IDS.map((id) => s.seats[id]).filter((x): x is SeatInfo => !!x).map(cleanSeat);

/**
 * The table for a rematch: the seats as the game ended (seats given away stay given). A seat whose player was
 * removed goes to a bot; one whose player is not in the room is played by a bot until they come back.
 */
export function rematchSeats(doc: Doc, here: ReadonlySet<PlayerId>): SetupRecord['seats'] {
  const out: SetupRecord['seats'] = {};
  for (const s of Object.values(doc.seats) as SeatInfo[]) {
    out[s.seat] = s.kind === 'bot' || !s.ctrl
      ? cleanSeat({ ...s, kind: 'bot', ctrl: '', skill: s.skill ?? 'normal', afk: false })
      : cleanSeat({ ...s, afk: !here.has(s.ctrl) });
  }
  return out;
}

function freeToken(seats: SeatInfo[], want?: TokenId): TokenId | null {
  const used = new Set(seats.map((s) => s.token));
  if (want && !used.has(want)) return want;
  return TOKENS.find((t) => !used.has(t.id))?.id ?? null;
}

const seatColor = (seat: SeatId): string => SEAT_COLORS[SEAT_IDS.indexOf(seat)] ?? SEAT_COLORS[0];

const roomPath = (code: string) => `rooms/${code}`;
const lobbyPath = (code: string) => `lobby/${code}`;

export function deleteRoom(db: Db, code: string): Promise<unknown> {
  return Promise.all([db.remove(lobbyPath(code)), db.remove(roomPath(code))]);
}

/** Server clock for one-off writes before a Session exists */
function serverClock(db: Db): Promise<() => number> {
  return new Promise((resolve) => {
    let done = false;
    let unsub: (() => void) | null = null;
    unsub = db.serverOffset((ms) => {
      if (done) return;
      done = true;
      resolve(() => Date.now() + ms);
      queueMicrotask(() => unsub?.());
    });
  });
}

/**
 * Someone has this room: a player is in it, or it holds a game that is still running (everyone may have closed the
 * tab; they come back to their seats), until that game has had no move for IDLE_GAME_MS.
 */
export function roomInUse(rec: Partial<LobbyRecord> | null | undefined, now: number): boolean {
  if (!rec || typeof rec !== 'object') return false;
  if (Object.keys(rec.members ?? {}).length > 0) return true;
  return rec.status === 'playing' && Math.max(num(rec.lastMoveAt, 0), num(rec.createdAt, 0)) + IDLE_GAME_MS > now;
}

/**
 * Create the lobby record `code` unless somebody has it. A leftover record nobody uses is taken over (Discord
 * rooms have a fixed code per voice channel). Resolves to whether we created it.
 */
export async function createRoomWithCode(db: Db, code: string, record: LobbyRecord): Promise<boolean> {
  const r = await db.transact<LobbyRecord>(lobbyPath(code), (cur) => {
    // Our own record, the transaction run again after a lost ack: it is ours
    if (cur && cur.hostId === record.hostId && cur.createdAt === record.createdAt) return cur;
    return roomInUse(cur, record.createdAt) ? undefined : record;
  });
  return r.committed;
}

/** Is an empty room due for deletion? (waiting: 60 s; running or finished: 24 h after the last move) */
function deleteDue(rec: Partial<LobbyRecord>, emptySince: number): number {
  if (rec.status === 'playing') return Math.max(num(rec.lastMoveAt, 0), num(rec.createdAt, 0)) + IDLE_GAME_MS;
  return Math.max(emptySince, num(rec.createdAt, 0)) + EMPTY_GRACE_MS;
}

/**
 * The public rooms with somebody in them, kept up to date. Also sweeps abandoned rooms: an empty one is deleted once
 * it has stayed empty past its grace time, and only after reading it again.
 */
export function watchRooms(db: Db, cb: (rooms: RoomSummary[]) => void, onError?: (err: Error) => void): () => void {
  let offset = 0;
  let stopped = false;
  const now = () => Date.now() + offset;
  const emptySince = new Map<string, number>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const arm = (code: string, rec: Partial<LobbyRecord>) => {
    if (timers.has(code)) return;
    const since = emptySince.get(code) ?? now();
    timers.set(code, setTimeout(() => void sweep(code), Math.max(0, deleteDue(rec, since) - now())));
  };
  const sweep = async (code: string) => {
    timers.delete(code);
    if (stopped) return;
    const rec = await db.get<LobbyRecord>(lobbyPath(code)).catch(() => null);
    if (stopped || !rec) return;
    if (Object.keys(rec.members ?? {}).length) {
      emptySince.delete(code);
      return;
    }
    if (now() < deleteDue(rec, emptySince.get(code) ?? now())) {
      arm(code, rec);
      return;
    }
    await deleteRoom(db, code).catch(() => {});
  };

  const unsubOffset = db.serverOffset((ms) => (offset = ms));
  const unsub = db.watch<Record<string, Partial<LobbyRecord>>>('lobby', (all) => {
    const rooms: RoomSummary[] = [];
    const seen = new Set<string>();
    for (const [code, rec] of Object.entries(all ?? {})) {
      if (!rec || typeof rec !== 'object') continue;
      seen.add(code);
      const players = Object.values(rec.members ?? {});
      if (!players.length) {
        if (!emptySince.has(code)) emptySince.set(code, now());
        arm(code, rec);
        continue;
      }
      emptySince.delete(code);
      const t = timers.get(code);
      if (t) clearTimeout(t);
      timers.delete(code);
      if (rec.public === false || typeof rec.name !== 'string') continue;
      rooms.push({
        code,
        name: rec.name,
        host: String(rec.host ?? ''),
        status: rec.status ?? 'waiting',
        speedDie: rec.speedDie === true,
        maxSeats: num(rec.maxSeats, 8),
        seatsTaken: num(rec.seatsTaken, 0),
        players,
        public: true,
        createdAt: num(rec.createdAt, 0),
        ...(typeof rec.lastMoveAt === 'number' ? { lastMoveAt: rec.lastMoveAt } : {}),
        otherVersion: typeof rec.v === 'number' && rec.v !== RULES_VERSION,
      });
    }
    for (const code of [...emptySince.keys()]) if (!seen.has(code)) emptySince.delete(code);
    for (const [code, t] of timers) if (!seen.has(code)) (clearTimeout(t), timers.delete(code));
    cb(rooms.sort((a, b) => b.createdAt - a.createdAt));
  }, onError);
  return () => {
    stopped = true;
    unsub();
    unsubOffset();
    timers.forEach(clearTimeout);
    timers.clear();
  };
}

export interface CreateRoomOptions {
  me: PlayerId;
  /** The creator's display name */
  host: string;
  /** The room's name */
  name: string;
  rules?: Partial<RulesConfig>;
  timers?: TimerRules;
  maxSeats?: number;
  public?: boolean;
  bots?: Array<{ skill: BotSkill }>;
  /** The creator's token (default: the first) */
  token?: TokenId;
  /** A fixed code (Discord). Default: a new random one. */
  code?: string;
  visible?: () => boolean;
}

export interface JoinOptions {
  me: PlayerId;
  name: string;
  token?: TokenId;
  /** Take a free seat when the room is waiting (default true; a full room makes you a spectator) */
  seat?: boolean;
  visible?: () => boolean;
}

/** The previous leave(), which the next join waits for (so it can't remove us or the room just after we're back) */
let pendingLeave: Promise<void> = Promise.resolve();

export class RoomConnection {
  readonly code: string;
  readonly me: PlayerId;
  private name: string;
  private readonly db: Db;
  private readonly handlers: RoomHandlers;
  private readonly visible: () => boolean;
  private readonly game: Session;

  private lobbyRec: LobbyRecord | null = null;
  private setupRec: SetupRecord | null = null;
  private members: Record<PlayerId, string> = {};
  private presence: Record<PlayerId, PresenceRecord> = {};
  private ownerId: PlayerId | null = null;
  private unsubs: Array<() => void> = [];
  private left = false;
  private closed = false;
  private registered = false;
  private reRegistering = false;
  private writtenSeat: string | null = null;
  private lastGid: string | null = null;
  private starts = new Map<string, Promise<void>>();
  private rematching: Promise<void> | null = null;

  private constructor(db: Db, code: string, me: PlayerId, name: string, handlers: RoomHandlers, visible?: () => boolean) {
    this.db = db;
    this.code = code;
    this.me = me;
    this.name = name;
    this.handlers = handlers;
    this.visible = visible ?? (() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
    // Watch the state from the start, so the cache is warm before any dispatch
    this.game = new Session({
      db,
      roomPath: roomPath(code),
      me,
      code,
      online: true,
      isOwner: () => this.isOwner(),
      visible: this.visible,
      rank: () => this.rank(),
      onVersion: () => this.close('version'),
    });
  }

  // ------------------------------------------------------------------------------------------------ create / join

  static async create(db: Db, o: CreateRoomOptions, handlers: RoomHandlers = {}): Promise<RoomConnection> {
    await pendingLeave;
    const clock = await serverClock(db);
    const maxSeats = Math.min(8, Math.max(2, Math.round(o.maxSeats ?? 8)));
    const bots = (o.bots ?? []).slice(0, maxSeats - 1);
    const roomRules = toRoomRules(o.rules, o.timers);
    let code = o.code ?? '';
    const record = (): LobbyRecord => ({
      name: o.name.slice(0, 24),
      host: o.host,
      hostId: o.me,
      createdAt: clock(),
      status: 'waiting',
      v: RULES_VERSION,
      speedDie: roomRules.speedDie,
      maxSeats,
      seatsTaken: 1 + bots.length,
      public: o.public !== false,
      members: { [o.me]: o.host },
    });
    for (let tries = 0; ; tries++) {
      if (!o.code) code = roomCode();
      // Armed first: if this tab dies before presence is up, the room is still seen as empty and swept
      await db.onDisconnectRemove(`${lobbyPath(code)}/members/${o.me}`);
      if (await createRoomWithCode(db, code, record())) break;
      await db.cancelOnDisconnect(`${lobbyPath(code)}/members/${o.me}`);
      if (o.code) throw new RoomError('taken', 'That room is already open');
      if (tries > 20) throw new RoomError('taken', 'Could not find a free room code');
    }

    const seats: Partial<Record<SeatId, SeatInfo>> = {};
    const creator: SeatInfo = { seat: 's0', name: o.host, token: o.token ?? TOKENS[0].id, color: seatColor('s0'), kind: 'human', ctrl: o.me };
    seats.s0 = creator;
    bots.forEach((b, i) => {
      const seat = SEAT_IDS[i + 1] as SeatId;
      const token = freeToken(Object.values(seats) as SeatInfo[]) ?? TOKENS[0].id;
      seats[seat] = { seat, name: BOT_NAMES[i] ?? `Bot ${i + 1}`, token, color: seatColor(seat), kind: 'bot', ctrl: '', skill: b.skill };
    });
    // A leftover from an abandoned room with this code goes first
    await db.remove(roomPath(code));
    await db.set(`${roomPath(code)}/setup`, { rules: roomRules, seats, locked: '' });

    const conn = new RoomConnection(db, code, o.me, o.host, handlers, o.visible);
    conn.lobbyRec = record();
    await conn.openOrClean();
    rememberRoom(code, o.me);
    return conn;
  }

  static async join(db: Db, code: string, o: JoinOptions, handlers: RoomHandlers = {}): Promise<RoomConnection> {
    await pendingLeave;
    const lobby = await db.get<LobbyRecord>(lobbyPath(code));
    if (!lobby || typeof lobby.name !== 'string') throw new RoomError('closed', 'That room has closed.');
    if (typeof lobby.v === 'number' && lobby.v !== RULES_VERSION) {
      throw new RoomError('version', 'That room is running a different version of the game. Reload to update.');
    }
    if (await db.get<boolean>(`${roomPath(code)}/kicked/${o.me}`)) throw new RoomError('kicked', 'You were removed from that room.');

    const conn = new RoomConnection(db, code, o.me, o.name, handlers, o.visible);
    conn.lobbyRec = lobby;
    await conn.openOrClean();
    if (conn.closed) throw new RoomError('closed', 'That room has closed.');
    if (o.seat !== false && lobby.status === 'waiting') {
      try {
        await conn.claimSeat(o.token);
      } catch (err) {
        // A full or just-started room: watch instead
        if (!(err instanceof RoomError) || (err.code !== 'full' && err.code !== 'started')) throw err;
      }
    }
    rememberRoom(code, o.me);
    return conn;
  }

  /** Discord: create the room with this fixed code, or join it when someone already has */
  static async joinOrCreate(db: Db, code: string, o: CreateRoomOptions, handlers: RoomHandlers = {}): Promise<RoomConnection> {
    try {
      return await RoomConnection.create(db, { ...o, code }, handlers);
    } catch (err) {
      if (!(err instanceof RoomError) || err.code !== 'taken') throw err;
      return RoomConnection.join(db, code, { me: o.me, name: o.host, token: o.token, visible: o.visible }, handlers);
    }
  }

  static watchRooms = watchRooms;

  private async openOrClean(): Promise<void> {
    try {
      await this.open();
    } catch (err) {
      this.left = true;
      this.teardown();
      await this.game.dispose();
      throw err;
    }
  }

  private async open(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let first = true;
      this.unsubs.push(
        this.db.connected((up) => {
          this.handlers.onConnection?.(up);
          if (!up || this.left) return;
          this.registerPresence().then(
            () => {
              if (!first) return;
              first = false;
              resolve();
            },
            (err: unknown) => {
              if (!first) return console.warn('Could not register presence', err);
              first = false;
              reject(err);
            },
          );
        }),
      );
    });
    if (this.left) return;

    let lobbyLoaded: () => void = () => {};
    let setupLoaded: () => void = () => {};
    const loaded = Promise.all([
      new Promise<void>((r) => (lobbyLoaded = r)),
      new Promise<void>((r) => (setupLoaded = r)),
      this.game.loaded,
    ]);
    this.unsubs.push(
      // First: the game may already be loaded (the Session watched it while presence registered), and a watch below
      // can answer synchronously from the SDK's cache (the Rooms list keeps all of lobby/ cached); its view change
      // would be missed if this came later
      this.game.view.subscribe(() => this.onGameView()),
      this.db.watch<LobbyRecord>(lobbyPath(this.code), (rec) => (this.onLobby(rec), lobbyLoaded()), () => lobbyLoaded()),
      this.db.watch<Partial<SetupRecord>>(`${roomPath(this.code)}/setup`, (rec) => (this.onSetup(rec), setupLoaded()), () => setupLoaded()),
      this.db.watch<Record<PlayerId, PresenceRecord>>(`${roomPath(this.code)}/presence`, (rec) => {
        this.presence = rec ?? {};
        this.publishPresence();
        this.handlers.onPresence?.(this.presence);
      }),
      this.db.watch<boolean>(`${roomPath(this.code)}/kicked/${this.me}`, (v) => {
        if (v === true) this.close('kicked');
      }),
    );
    if (typeof document !== 'undefined') {
      const onVis = () => void this.writePresence();
      document.addEventListener('visibilitychange', onVis);
      this.unsubs.push(() => document.removeEventListener('visibilitychange', onVis));
    }
    // Ready to use once the room has been read: setup(), isOwner() and session() mean something from here on
    await loaded;
    // A game that was already running when we came in is announced (onSession) even if its view never changes
    // again: a spectator of a quiet table would otherwise stay on the waiting room
    this.onGameView();
  }

  // ------------------------------------------------------------------------------------------------ reading

  isOwner(): boolean {
    return this.ownerId === this.me;
  }

  /** The room's owner once known */
  owner(): PlayerId | null {
    return this.ownerId;
  }

  lobby(): LobbyRecord | null {
    return this.lobbyRec;
  }

  setup(): SetupRecord | null {
    return this.setupRec;
  }

  /** The game, once one has started (spectators get a read-only one: no seats of their own) */
  session(): Session | null {
    return this.game.current() ? this.game : null;
  }

  /** The room's Session even before a game starts (its view says whether we are connected; window.game uses it) */
  roomSession(): Session {
    return this.game;
  }

  /** My seat in the waiting room, or my first seat in the game */
  mySeat(): SeatId | null {
    const doc = this.game.current();
    if (doc && this.lobbyRec?.status !== 'waiting') return seatsOf(doc, this.me)[0] ?? null;
    return (Object.values(this.setupRec?.seats ?? {}) as SeatInfo[]).find((s) => s.kind === 'human' && s.ctrl === this.me)?.seat ?? null;
  }

  inviteUrl(): string {
    const base = typeof location === 'undefined' ? '' : `${location.origin}${location.pathname}`;
    return `${base}?room=${this.code}`;
  }

  // ------------------------------------------------------------------------------------------------ waiting room

  /** Take a seat (or change my token): the seat cap and unique tokens are enforced by transaction */
  claimSeat(token?: TokenId): Promise<SeatId> {
    const max = this.lobbyRec?.maxSeats ?? 8;
    return this.editSetup<SeatId>((s) => {
      if (s.locked) return { error: new RoomError('started', 'The game has already started.') };
      const seats = Object.values(s.seats) as SeatInfo[];
      const mine = seats.find((x) => x.kind === 'human' && x.ctrl === this.me);
      const others = seats.filter((x) => x !== mine);
      if (token && others.some((x) => x.token === token)) return { error: new RoomError('token', 'Someone already has that token.') };
      if (mine) {
        const want = token ?? mine.token;
        if (want === mine.token && mine.name === this.name) return { result: mine.seat };
        return { result: mine.seat, seats: { ...s.seats, [mine.seat]: { ...mine, token: want, name: this.name } } };
      }
      if (seats.length >= max) return { error: new RoomError('full', 'Every seat is taken.') };
      const seat = SEAT_IDS.find((id) => !s.seats[id]);
      const pick = freeToken(others, token);
      if (!seat || !pick) return { error: new RoomError('full', 'Every seat is taken.') };
      const info: SeatInfo = { seat, name: this.name, token: pick, color: seatColor(seat), kind: 'human', ctrl: this.me };
      return { result: seat, seats: { ...s.seats, [seat]: info } };
    });
  }

  /** Give up my seat and watch instead */
  async leaveSeat(): Promise<void> {
    await this.editSetup<void>((s) => {
      if (s.locked) return { error: new RoomError('started', 'The game has already started.') };
      const seats = { ...s.seats };
      let changed = false;
      for (const x of Object.values(seats) as SeatInfo[]) {
        if (x.kind === 'human' && x.ctrl === this.me) (delete seats[x.seat], (changed = true));
      }
      return changed ? { seats } : {};
    });
  }

  /** Change a seat's token: my own, or (owner) a bot's */
  setSeatToken(token: TokenId, seat?: SeatId): Promise<void> {
    if (!isTokenId(token)) return Promise.reject(new RoomError('bad', 'Unknown token'));
    return this.editSetup<void>((s) => {
      if (s.locked) return { error: new RoomError('started', 'The game has already started.') };
      const target = seat ? s.seats[seat] : (Object.values(s.seats) as SeatInfo[]).find((x) => x.kind === 'human' && x.ctrl === this.me);
      if (!target) return { error: new RoomError('bad', 'Nobody sits there') };
      const mine = target.kind === 'human' && target.ctrl === this.me;
      if (!mine && !(target.kind === 'bot' && this.isOwner())) return { error: new RoomError('owner', 'That is not your seat') };
      if ((Object.values(s.seats) as SeatInfo[]).some((x) => x.seat !== target.seat && x.token === token)) {
        return { error: new RoomError('token', 'Someone already has that token.') };
      }
      return { seats: { ...s.seats, [target.seat]: { ...target, token } } };
    });
  }

  /** Owner: change the rules while waiting */
  async setRules(patch: Partial<RoomRules>): Promise<void> {
    this.requireOwner();
    if (this.setupRec?.locked) throw new RoomError('started', 'The game has already started.');
    const clean: Record<string, unknown> = {};
    for (const key of Object.keys(DEFAULT_ROOM_RULES) as (keyof RoomRules)[]) {
      const v = patch[key];
      if (v !== undefined && typeof v === typeof DEFAULT_ROOM_RULES[key]) clean[key] = v;
    }
    if (!Object.keys(clean).length) return;
    await this.db.update(`${roomPath(this.code)}/setup/rules`, clean);
    if (typeof clean.speedDie === 'boolean') await this.db.update(lobbyPath(this.code), { speedDie: clean.speedDie });
  }

  /** Owner: put a bot in the first free seat */
  addBot(skill: BotSkill = 'normal'): Promise<SeatId> {
    this.requireOwner();
    const max = this.lobbyRec?.maxSeats ?? 8;
    return this.editSetup<SeatId>((s) => {
      if (s.locked) return { error: new RoomError('started', 'The game has already started.') };
      const seats = Object.values(s.seats) as SeatInfo[];
      const seat = SEAT_IDS.find((id) => !s.seats[id]);
      const token = freeToken(seats);
      if (seats.length >= max || !seat || !token) return { error: new RoomError('full', 'Every seat is taken.') };
      const names = new Set(seats.map((x) => x.name));
      const name = BOT_NAMES.find((n) => !names.has(n)) ?? `Bot ${seat.slice(1)}`;
      const info: SeatInfo = { seat, name, token, color: seatColor(seat), kind: 'bot', ctrl: '', skill };
      return { result: seat, seats: { ...s.seats, [seat]: info } };
    });
  }

  editBot(seat: SeatId, skill: BotSkill): Promise<void> {
    this.requireOwner();
    return this.editSetup<void>((s) => {
      const bot = s.seats[seat];
      if (s.locked) return { error: new RoomError('started', 'The game has already started.') };
      if (!bot || bot.kind !== 'bot') return { error: new RoomError('bad', 'No bot sits there') };
      return { seats: { ...s.seats, [seat]: { ...bot, skill } } };
    });
  }

  removeBot(seat: SeatId): Promise<void> {
    this.requireOwner();
    return this.editSetup<void>((s) => {
      const bot = s.seats[seat];
      if (s.locked) return { error: new RoomError('started', 'The game has already started.') };
      if (!bot || bot.kind !== 'bot') return { error: new RoomError('bad', 'No bot sits there') };
      const seats = { ...s.seats };
      delete seats[seat];
      return { seats };
    });
  }

  /** Owner: remove a player (their waiting-room seat goes; a seat in a running game passes to a bot) */
  async kick(pid: PlayerId): Promise<void> {
    this.requireOwner();
    if (pid === this.me || !isPlayerId(pid)) throw new RoomError('bad', 'You cannot remove that player');
    await this.db.set(`${roomPath(this.code)}/kicked/${pid}`, true);
    await Promise.all([this.db.remove(`${lobbyPath(this.code)}/members/${pid}`), this.db.remove(`${roomPath(this.code)}/presence/${pid}`)]);
    if (!this.setupRec?.locked) {
      await this.editSetup<void>((s) => {
        const seats = { ...s.seats };
        for (const x of Object.values(seats) as SeatInfo[]) if (x.kind === 'human' && x.ctrl === pid) delete seats[x.seat];
        return { seats };
      });
    } else if (this.game.current()) {
      await this.game.editSeats((seats) => {
        for (const x of Object.values(seats) as SeatInfo[]) {
          if (x.kind === 'human' && x.ctrl === pid) seats[x.seat] = { ...x, ctrl: '', afk: true };
        }
        return null;
      });
    }
  }

  // ------------------------------------------------------------------------------------------------ start

  /** Owner: start the game. Idempotent per gid: lock the setup, create the state once, then mark the room playing. */
  async start(): Promise<void> {
    this.requireOwner();
    const fresh = gameId();
    const gid = await this.editSetup<string>((s) => {
      if (s.locked) return { result: s.locked };
      if (Object.keys(s.seats).length < MIN_START_SEATS) {
        return { error: new RoomError('seats', `At least ${MIN_START_SEATS} seats are needed to start.`) };
      }
      return { result: fresh, locked: fresh };
    });
    await this.finishStart(gid);
  }

  /** Owner, after a game: back to waiting with the table as it ended (rematchSeats), then start a new game */
  rematch(): Promise<void> {
    this.requireOwner();
    // A second click joins the first: two would undo each other's unlock and start
    this.rematching ??= this.doRematch().finally(() => (this.rematching = null));
    return this.rematching;
  }

  private async doRematch(): Promise<void> {
    const doc = this.game.current();
    if (!doc || doc.game.phase.k !== 'over') throw new RoomError('started', 'The game is still running.');
    const here = new Set([...Object.keys(this.members), ...Object.keys(this.presence)]);
    // Unlock before going back to waiting (a waiting room locked to the old gid looks like an unfinished start),
    // unless the next game has started already
    const go = await this.editSetup<boolean>((s) =>
      s.locked && s.locked !== doc.gid ? { result: false } : { result: true, locked: '', seats: rematchSeats(doc, here) });
    if (!go) return;
    await this.db.update(lobbyPath(this.code), { status: 'waiting' });
    await this.start();
  }

  /** Steps 2 and 3 of start: anyone who owns the room may finish a start the previous owner began */
  private finishStart(gid: string): Promise<void> {
    let p = this.starts.get(gid);
    if (!p) {
      p = this.createGame(gid).finally(() => this.starts.delete(gid));
      this.starts.set(gid, p);
    }
    return p;
  }

  private async createGame(gid: string): Promise<void> {
    const raw = await this.db.get<Partial<SetupRecord>>(`${roomPath(this.code)}/setup`);
    const setup = readSetup(raw);
    if (!setup || setup.locked !== gid) return;
    const seats = setupSeats(setup);
    if (seats.length < MIN_START_SEATS) return;
    // The rules as stored: readSetup's defaults would switch on timers that a room seeded with turnTimer 0 has off
    const { rules, timers } = roomConfig(raw?.rules);
    const at = this.game.serverNow();
    const doc = createDoc({ gid, seats, rules, timers, seed: randomSeed(), at });
    const record: StateRecord = { gid, seq: 0, v: RULES_VERSION, at, data: encodeDoc(doc) };
    await this.db.transact<StateRecord>(`${roomPath(this.code)}/state`, (cur) => (cur && cur.gid === gid ? undefined : record));
    // Only a waiting room becomes playing (never a finished one, nor one a rematch is resetting)
    await this.db.transact<RoomStatus>(`${lobbyPath(this.code)}/status`, (cur) => (cur === null ? null : cur === 'waiting' ? 'playing' : undefined));
    await this.db.update(lobbyPath(this.code), { seatsTaken: seats.length, lastMoveAt: at });
  }

  /** A start the owner began but did not finish (it crashed between steps) */
  private checkStart(): void {
    const locked = this.setupRec?.locked;
    if (!locked || !this.isOwner() || this.left) return;
    const doc = this.game.current();
    if (doc && doc.gid === locked && this.lobbyRec?.status !== 'waiting') return;
    void this.finishStart(locked).catch((err: unknown) => console.warn('Could not finish starting the game', err));
  }

  // ------------------------------------------------------------------------------------------------ in game

  /** Owner: give a seat to another player, or to a bot for good */
  assignSeat(seat: SeatId, to: PlayerId | 'bot'): Promise<DispatchResult> {
    this.requireOwner();
    if (to !== 'bot' && !isPlayerId(to)) return Promise.resolve({ ok: false, code: 'bad', message: 'Unknown player' });
    const name = to === 'bot' ? null : (this.members[to] ?? this.presence[to]?.name ?? null);
    return this.game.editSeats((seats) => {
      const s = seats[seat];
      if (!s) return { code: 'badSeat', message: 'Nobody sits there' };
      seats[seat] = to === 'bot'
        ? cleanSeat({ ...s, kind: 'bot', ctrl: '', skill: s.skill ?? 'normal', afk: false })
        : cleanSeat({ ...s, kind: 'human', ctrl: to, afk: false, name: name ?? s.name });
      return null;
    });
  }

  /** Owner: the driver plays this seat until its player acts or takes it back */
  letBotPlay(seat: SeatId): Promise<DispatchResult> {
    this.requireOwner();
    return this.game.setAfk(seat, true);
  }

  /** The seat's player (or the owner): stop the bot playing it */
  takeBackControl(seat: SeatId): Promise<DispatchResult> {
    const s = this.game.current()?.seats[seat];
    if (!this.isOwner() && s?.ctrl !== this.me) return Promise.resolve({ ok: false, code: 'notYourSeat', message: 'That is not your seat' });
    return this.game.setAfk(seat, false);
  }

  /** Human seats other players are still playing (Finish now waits until there are none) */
  othersPlaying(): SeatId[] {
    const doc = this.game.current();
    const presence = this.game.view.get().presence ?? {};
    return doc ? othersPlaying(doc, this.me, (seat) => presence[seat] === 'offline') : [];
  }

  /** Owner, once only bots (and players who have left) are still in: end the game now, ranked by net worth */
  async finishNow(): Promise<DispatchResult> {
    this.requireOwner();
    let r: DispatchResult = { ok: false, code: 'closed', message: 'No game is running' };
    for (let i = 0; i < 3; i++) {
      const doc = this.game.current();
      if (!doc) return r;
      if (this.othersPlaying().length) return { ok: false, code: 'playing', message: 'Other players are still in the game.' };
      r = await this.game.command({ by: 'system', a: { k: 'endGame' }, basis: doc.seq });
      if (r.ok || r.code !== 'stale') return r;
    }
    return r;
  }

  // ------------------------------------------------------------------------------------------------ leaving

  /** Safe to call more than once. The next join waits for it. */
  leave(): Promise<void> {
    if (this.left) return pendingLeave;
    this.left = true;
    const p = this.doLeave();
    pendingLeave = p.catch((err: unknown) => console.warn('Leaving the room failed', err));
    return pendingLeave;
  }

  /**
   * Drop this connection without touching the room: for a join that finished after the player gave up on it, when
   * a newer join as the same player is under way (a full leave would take that one's member entry and seat away).
   */
  abandon(): void {
    if (this.left) return;
    this.left = true;
    this.teardown();
    void this.game.dispose({ keepLease: true });
  }

  private async doLeave(): Promise<void> {
    const waiting = !this.setupRec?.locked;
    const seated = this.mySeat() !== null;
    await this.handToDriver();
    this.teardown();
    await this.game.dispose();
    const member = `${lobbyPath(this.code)}/members/${this.me}`;
    const presence = `${roomPath(this.code)}/presence/${this.me}`;
    await Promise.all([this.db.cancelOnDisconnect(member), this.db.cancelOnDisconnect(presence)]).catch(() => {});
    await Promise.all([this.db.remove(member), this.db.remove(presence)]);
    if (waiting && seated) {
      await this.editSetup<void>((s) => {
        if (s.locked) return {};
        const seats = { ...s.seats };
        for (const x of Object.values(seats) as SeatInfo[]) if (x.kind === 'human' && x.ctrl === this.me) delete seats[x.seat];
        return { seats };
      }).catch(() => {});
    }
    forgetRoom(this.code, { seat: waiting });
    // Never from a guess that we were alone: read again
    const members = await this.db.get<Record<string, string>>(`${lobbyPath(this.code)}/members`);
    const status = await this.db.get<RoomStatus>(`${lobbyPath(this.code)}/status`);
    if (!members && status !== 'playing') await deleteRoom(this.db, this.code);
  }

  /** Leaving a running game: the driver plays my seats until I come back (my next move takes them back) */
  private async handToDriver(): Promise<void> {
    const doc = this.game.current();
    if (!doc || doc.game.phase.k === 'over' || this.lobbyRec?.status === 'waiting') return;
    const mine = seatsOf(doc, this.me).filter((seat) => !doc.seats[seat]?.afk && !doc.game.players[seat]?.out);
    if (!mine.length) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Offline, the transaction would wait for the connection: leaving must not
    await Promise.race([
      this.game.editSeats((seats) => {
        for (const seat of mine) {
          const s = seats[seat];
          if (s?.kind === 'human' && s.ctrl === this.me) seats[seat] = { ...s, afk: true };
        }
        return null;
      }),
      new Promise<void>((r) => (timer = setTimeout(r, 2_000))),
    ]);
    clearTimeout(timer);
  }

  private teardown(): void {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
  }

  private close(why: ClosedReason): void {
    if (this.closed) return;
    this.closed = true;
    this.left = true;
    this.teardown();
    void this.game.dispose();
    releaseTab(this.code);
    // Kicked: the id is kept (marked), so the invite link meets the kick again instead of handing out a new player
    if (why === 'kicked') forgetRoom(this.code, { kicked: true });
    else if (why === 'deleted') forgetRoom(this.code, { seat: true });
    this.handlers.onClosed?.(why);
  }

  // ------------------------------------------------------------------------------------------------ internals

  private requireOwner(): void {
    if (!this.isOwner()) throw new RoomError('owner', 'Only the room owner can do that.');
  }

  private rank(): number {
    const ids = Object.keys(this.members).sort();
    const i = ids.indexOf(this.me);
    return i < 0 ? ids.length : i;
  }

  private onLobby(rec: LobbyRecord | null): void {
    if (this.left) return;
    if (!rec) {
      this.lobbyRec = null;
      this.close('deleted');
      return;
    }
    if (typeof rec.v === 'number' && rec.v !== RULES_VERSION) {
      this.close('version');
      return;
    }
    this.lobbyRec = rec;
    this.members = rec.members ?? {};
    this.publishPresence();
    this.handlers.onLobby?.(rec);
    this.updateOwner();
    this.checkSelf();
    this.mirror();
    this.checkStart();
  }

  private onSetup(raw: Partial<SetupRecord> | null): void {
    if (this.left) return;
    this.setupRec = readSetup(raw);
    this.handlers.onSetup?.(this.setupRec);
    this.updateOwner();
    this.checkStart();
    void this.writePresence();
  }

  private onGameView(): void {
    if (this.left) return;
    this.publishPresence();
    const doc = this.game.current();
    if (doc && doc.gid !== this.lastGid) {
      this.lastGid = doc.gid;
      this.handlers.onSession?.(this.game);
    }
    this.mirror();
    void this.writePresence();
  }

  /**
   * SessionView.presence: each human seat of the game is online while its player is in the room (their presence or
   * member entry is there; onDisconnect removes both). Published only when it changes.
   */
  private publishPresence(): void {
    if (this.left) return;
    const doc = this.game.current();
    const next: Partial<Record<SeatId, 'online' | 'offline'>> = {};
    for (const s of doc ? (Object.values(doc.seats) as SeatInfo[]) : []) {
      if (s.kind !== 'human') continue;
      next[s.seat] = s.ctrl && (this.presence[s.ctrl] || this.members[s.ctrl] !== undefined) ? 'online' : 'offline';
    }
    const cur = this.game.view.get().presence ?? {};
    const keys = Object.keys(next) as SeatId[];
    if (keys.length === Object.keys(cur).length && keys.every((k) => cur[k] === next[k])) return;
    this.game.view.update({ presence: next });
  }

  /** Humans who hold a seat: they inherit the room before spectators */
  private seatedPids(): Set<PlayerId> {
    const doc = this.game.current();
    const seats = doc ? (Object.values(doc.seats) as SeatInfo[]) : (Object.values(this.setupRec?.seats ?? {}) as SeatInfo[]);
    return new Set(seats.filter((s) => s.kind === 'human' && s.ctrl).map((s) => s.ctrl));
  }

  /**
   * The owner is hostId while they are here. Otherwise the heir (seated humans first, then the lowest id) takes
   * over and records it, so ownership doesn't move again when someone joins. Only the heir writes.
   */
  private updateOwner(): void {
    if (!this.lobbyRec) return;
    const members = this.members;
    const ids = Object.keys(members).filter(isPlayerId);
    if (!ids.length) return;
    const hostId = this.lobbyRec.hostId;
    if (hostId && members[hostId] !== undefined) {
      if (this.ownerId !== hostId) {
        this.ownerId = hostId;
        this.handlers.onOwner?.(hostId, members[hostId] ?? '');
        this.checkStart();
      }
      return;
    }
    const seated = this.seatedPids();
    const heir = [...ids].sort((a, b) => Number(seated.has(b)) - Number(seated.has(a)) || (a < b ? -1 : a > b ? 1 : 0))[0];
    if (heir === this.me) {
      this.db.update(lobbyPath(this.code), { hostId: this.me, host: this.name }).catch((err: unknown) => console.warn('Could not take over the room', err));
    }
  }

  /** Arm the removals first, then write: runs again after every reconnect (the server removed us meanwhile) */
  private async registerPresence(): Promise<void> {
    if (this.left) return;
    const member = `${lobbyPath(this.code)}/members/${this.me}`;
    const presence = `${roomPath(this.code)}/presence/${this.me}`;
    await Promise.all([this.db.onDisconnectRemove(member), this.db.onDisconnectRemove(presence)]);
    if (this.left) return;
    this.writtenSeat = null;
    await this.writePresence(true);
    // A deleted room is not brought back by our member entry (the rules refuse it online, too)
    if (this.left || (this.registered && !this.lobbyRec)) return;
    await this.db.set(member, this.name);
    this.registered = true;
  }

  private presenceRecord(): PresenceRecord {
    return { name: this.name, seat: this.mySeat() ?? '', vis: this.visible(), at: this.game.serverNow() };
  }

  private async writePresence(force = false): Promise<void> {
    if (this.left) return;
    const rec = this.presenceRecord();
    const key = `${rec.seat}:${rec.vis}`;
    if (!force && (key === this.writtenSeat || !this.registered)) return;
    this.writtenSeat = key;
    await this.db.set(`${roomPath(this.code)}/presence/${this.me}`, rec).catch(() => {});
  }

  /** Our member entry vanished while connected (a refreshed tab's old socket closing late): write it again */
  private checkSelf(): void {
    if (!this.registered || this.reRegistering || this.left || this.members[this.me] !== undefined) return;
    this.reRegistering = true;
    void (async () => {
      try {
        if (await this.db.get<boolean>(`${roomPath(this.code)}/kicked/${this.me}`)) return this.close('kicked');
        await this.registerPresence();
      } catch (err) {
        console.warn('Could not register again', err);
      } finally {
        this.reRegistering = false;
      }
    })();
  }

  /** The driver keeps the lobby's status and lastMoveAt up to date */
  private mirror(): void {
    const doc = this.game.current();
    const lobby = this.lobbyRec;
    // (a game seeded straight into the state, as e2e tests do, has no lock)
    const locked = this.setupRec?.locked;
    if (!doc || !lobby || !this.game.isDriver() || (locked && locked !== doc.gid) || lobby.status !== 'playing') return;
    const now = this.game.serverNow();
    if (doc.game.phase.k === 'over') {
      this.db.update(lobbyPath(this.code), { status: 'finished', lastMoveAt: now }).catch(() => {});
    } else if (now - (lobby.lastMoveAt ?? 0) > LAST_MOVE_EVERY_MS) {
      this.lobbyRec = { ...lobby, lastMoveAt: now };
      this.db.update(lobbyPath(this.code), { lastMoveAt: now }).catch(() => {});
    }
  }

  /**
   * Edit the setup by transaction. `edit` sees the setup with its containers filled in and returns new seats and/or
   * lock (the stored rules are written back untouched), a result, or an error.
   */
  private async editSetup<R>(
    edit: (s: SetupRecord) => { seats?: SetupRecord['seats']; locked?: string; result?: R; error?: RoomError },
  ): Promise<R> {
    const out = { result: undefined as R | undefined, error: null as RoomError | null };
    const op = envelopeId();
    const r = await this.db.transact<Partial<SetupRecord>>(`${roomPath(this.code)}/setup`, (cur) => {
      // Run again on our own write (its ack was lost): it landed, with the result of the run that wrote it
      if (cur?.op === op) return undefined;
      out.result = undefined;
      out.error = null;
      if (cur === null) return null;
      const s = readSetup(cur);
      if (!s) return undefined;
      const e = edit(s);
      out.result = e.result;
      out.error = e.error ?? null;
      if (e.error || (e.seats === undefined && e.locked === undefined)) return undefined;
      const seats: SetupRecord['seats'] = {};
      for (const x of Object.values(e.seats ?? s.seats) as SeatInfo[]) seats[x.seat] = cleanSeat(x);
      return { ...cur, seats, locked: e.locked ?? s.locked, op };
    });
    if (out.error) throw out.error;
    if (r.committed && r.value === null) throw new RoomError('closed', 'That room has closed.');
    if (r.committed && r.value) {
      const n = Object.keys(r.value.seats ?? {}).length;
      if (this.lobbyRec && this.lobbyRec.seatsTaken !== n && !r.value.locked) {
        this.db.update(lobbyPath(this.code), { seatsTaken: n }).catch(() => {});
      }
    }
    return out.result as R;
  }
}
