import {
  apply,
  awaiting,
  createGame,
  decode,
  deepEqual,
  getBoard,
  normalizeConfig,
  RULES_VERSION,
  timer,
  UPGRADABLE_VERSIONS,
  type GameEvent,
  type GameState,
  type RulesConfig,
  type SeatId,
} from '../rules';
import { animBudget, AUCTION_BID_SECS, OFFLINE_TIMERS, phaseSecs, type TimerRules } from '../shared/timing';
import { seatToken, tokenOn, tokensOn } from '../shared/tokens';
import type { Batch, BotSkill, Doc, Envelope, PlayerId, SeatInfo } from './types';

/*
 * The transacted game document around the engine: who controls each seat, the envelope id ring, the last few
 * envelopes (replayed by every client for events and tamper checks), the running deadline, AFK strikes and the
 * reaction windows each seat let run out. Pure: the dispatch transaction and every client's replay run the same code.
 */

export const IDS_RING = 16;
export const RECENT_MAX = 8;
/** Timeouts in a row that hand a seat to the driver (the default; a room may pick another, or 0 = never) */
export const AFK_STRIKES = 2;
/**
 * Hero League reaction windows run out in a row (never AFK strikes) after which a seat is no longer waited for in
 * them: a window open only to such seats closes at once, until the seat's player acts again
 */
export const REACT_IDLE_AFTER = 3;
export const BOT_SKILLS: readonly BotSkill[] = ['easy', 'normal', 'hard', 'expert'];
export const BOT_PACES: readonly number[] = [0.5, 1, 2];

export interface NetError {
  code: string;
  message: string;
}

export type ApplyOutcome = { ok: true; doc: Doc; events: GameEvent[] } | ({ ok: false } & NetError);

const fail = (code: string, message: string): { ok: false } & NetError => ({ ok: false, code, message });

/** System commands that only make sense once the deadline has passed */
const TIMEOUT_ACTIONS = new Set(['forced', 'closeAuction', 'closeClaim', 'closeReact']);
/**
 * Test rigging (debug rooms only). Not a decision in the game, so it never counts as the player being back: an e2e
 * test rigging the dice from an absent player's page must not wipe the timeouts that player has run up.
 */
const DEBUG_ACTIONS = new Set(['debugRig', 'debugSetCash']);

export interface CreateDocOptions {
  gid: string;
  seats: SeatInfo[];
  rules?: Partial<RulesConfig>;
  timers?: TimerRules;
  seed: number;
  /** Server ms the game starts at (the first deadline runs from here); defaults to now */
  at?: number;
  /** Timeouts in a row before the driver plays a seat (0 = never; default AFK_STRIKES) */
  afkStrikes?: number;
  /** Bot thinking time multiplier (0.5, 1 or 2) */
  botPace?: number;
  /** Skill for seats played by the driver that name none */
  botSkill?: BotSkill;
  /** Minutes until the game ends ranked by net worth (0 / absent = no limit) */
  timeLimit?: number;
}

/** The room-level extras of a doc (what createDoc takes besides the engine rules), validated */
function docExtras(o: Pick<CreateDocOptions, 'afkStrikes' | 'botPace' | 'botSkill' | 'timeLimit'>, at: number): Partial<Doc> {
  const out: Partial<Doc> = {};
  if (typeof o.afkStrikes === 'number' && Number.isFinite(o.afkStrikes) && o.afkStrikes !== AFK_STRIKES) {
    out.afkStrikes = Math.max(0, Math.min(10, Math.round(o.afkStrikes)));
  }
  if (typeof o.botPace === 'number' && BOT_PACES.includes(o.botPace) && o.botPace !== 1) out.botPace = o.botPace;
  if (o.botSkill && BOT_SKILLS.includes(o.botSkill) && o.botSkill !== 'normal') out.botSkill = o.botSkill;
  if (typeof o.timeLimit === 'number' && Number.isFinite(o.timeLimit) && o.timeLimit > 0) {
    out.timeLimit = o.timeLimit;
    out.endsAt = at + Math.round(o.timeLimit * 60_000);
  }
  return out;
}

/** The room-level fields a doc carries from one command to the next */
const carried = (doc: Doc): Partial<Doc> => {
  const out: Partial<Doc> = {};
  if (doc.afkStrikes !== undefined) out.afkStrikes = doc.afkStrikes;
  if (doc.botPace !== undefined) out.botPace = doc.botPace;
  if (doc.botSkill !== undefined) out.botSkill = doc.botSkill;
  if (doc.endsAt !== undefined) out.endsAt = doc.endsAt;
  if (doc.timeLimit !== undefined) out.timeLimit = doc.timeLimit;
  return out;
};

/** A new game document at seq 0. Throws on a bad seat list (2-8 unique seat ids, the board's cap), like createGame. */
export function createDoc(o: CreateDocOptions): Doc {
  const board = normalizeConfig(o.rules).board;
  const heroes = getBoard(board).heroes?.list ?? [];
  // Every seat plays the board's own token, none twice (one kept from another board's set is the same slot of this one's)
  const tokens = tokensOn(board, o.seats.map((s) => s.token));
  // On Hero League the token is the hero the seat asks for
  const setup = o.seats.map((s, i) => {
    const hero = tokens[i];
    return { id: s.seat, name: s.name, ...(hero && heroes.some((h) => h.id === hero) ? { hero } : {}) };
  });
  const { state, events } = createGame(o.rules, setup, o.seed);
  const seats: Partial<Record<SeatId, SeatInfo>> = {};
  // ...and from here on it shows the hero the seat plays
  o.seats.forEach((s, i) => {
    seats[s.seat] = cleanSeat({ ...s, token: tokenOn(board, seatToken(state, s.seat, tokens[i]) ?? s.token) });
  });
  const timers = { ...(o.timers ?? OFFLINE_TIMERS) };
  const at = o.at ?? Date.now();
  const doc: Doc = { gid: o.gid, seq: state.seq, game: state, seats, ids: [], recent: [], timers, strikes: {}, ...docExtras(o, at) };
  const deadline = nextDeadline(undefined, state, events, at, timers);
  if (deadline) doc.deadline = deadline;
  return doc;
}

/** A SeatInfo with no undefined fields (the database refuses them) */
export function cleanSeat(s: SeatInfo): SeatInfo {
  const out: SeatInfo = { seat: s.seat, name: s.name, token: s.token, color: s.color, kind: s.kind, ctrl: s.ctrl ?? '' };
  if (s.skill) out.skill = s.skill;
  if (s.afk) out.afk = true;
  return out;
}

/** The driver plays this seat: a bot, a human seat handed to a bot, or one nobody controls */
export const drivenSeat = (s: SeatInfo | undefined): boolean => !!s && (s.kind === 'bot' || s.afk === true || !s.ctrl);

/** Seats `pid` plays itself (more than one = hot-seat). AFK seats stay listed: acting takes them back. */
export function seatsOf(doc: Doc | null, pid: PlayerId): SeatId[] {
  if (!doc) return [];
  return (Object.values(doc.seats) as SeatInfo[])
    .filter((s) => s.kind === 'human' && s.ctrl !== '' && s.ctrl === pid)
    .map((s) => s.seat)
    .sort();
}

/**
 * Human seats someone other than `me` is still playing: in the game, controlled by a player who is here (`away`
 * says who isn't) and not handed to the driver. Finish now is only for a table with none of these.
 */
export function othersPlaying(doc: Doc, me: PlayerId, away: (seat: SeatId) => boolean = () => false): SeatId[] {
  return (Object.values(doc.seats) as SeatInfo[])
    .filter((s) => doc.game.players[s.seat] && !doc.game.players[s.seat]?.out)
    .filter((s) => !drivenSeat(s) && s.ctrl !== me && !away(s.seat))
    .map((s) => s.seat)
    .sort();
}

/** May `env.pid` send this command? Humans play their own seats; driven seats and the system need a basis. */
export function controlProblem(seats: Doc['seats'], env: Envelope): NetError | null {
  const { by, basis } = env.cmd;
  if (by === 'system') return basis === undefined ? { code: 'basis', message: 'System commands must carry a basis' } : null;
  const info = seats[by];
  if (!info) return { code: 'badSeat', message: 'Nobody sits there' };
  if (info.kind === 'human' && info.ctrl !== '' && info.ctrl === env.pid) return null;
  if (drivenSeat(info)) return basis === undefined ? { code: 'basis', message: 'Moves for a bot must carry a basis' } : null;
  return { code: 'notYourSeat', message: 'That is not your seat' };
}

/** How long the events take to play at normal speed, however many there are (animBudget caps one batch) */
export const fullAnimBudget = (events: readonly GameEvent[]): number => events.reduce((ms, ev) => ms + animBudget([ev]), 0);

/**
 * Seats whose reaction windows ran out REACT_IDLE_AFTER times in a row (and who have not acted since) are the only
 * ones a Hero League reaction window still waits for: nobody need wait, so it may close before its deadline
 */
export function reactIdleOnly(doc: Doc): boolean {
  if (doc.game.phase.k !== 'react') return false;
  const open = awaiting(doc.game);
  return open.length > 0 && open.every((seat) => (doc.reactIdle?.[seat] ?? 0) >= REACT_IDLE_AFTER);
}

/**
 * The deadline after a command: kept while timer(game).key is unchanged, restarted when it changes. An auction's key
 * changes on every bid, which gives at least AUCTION_BID_SECS to answer; under cfg.fixedAuctionCountdown it changes
 * only when a lot is put up, so bids never add time. A reaction window's countdown
 * starts once the whole batch that opened it has played (a card, its Hero-die throws and their walks may take longer
 * than animBudget's cap), so nobody loses reaction time watching the throw land.
 */
export function nextDeadline(
  prev: Doc['deadline'],
  game: GameState,
  events: readonly GameEvent[],
  at: number,
  timers: TimerRules,
): Doc['deadline'] {
  const t = timer(game);
  if (!t) return undefined;
  if (prev && prev.key === t.key) return prev;
  const secs = phaseSecs(t.kind, timers);
  if (secs <= 0 && t.kind !== 'auction') return undefined;
  const anim = t.kind === 'reaction' ? fullAnimBudget(events) : animBudget(events);
  let due = at + anim + secs * 1000;
  if (t.kind === 'auction' && !game.cfg.fixedAuctionCountdown) due = Math.max(due, at + AUCTION_BID_SECS * 1000);
  return { key: t.key, at: due };
}

/** Applies one envelope to the document. Never throws. */
export function applyEnvelope(doc: Doc, env: Envelope): ApplyOutcome {
  if (doc.game.v !== RULES_VERSION) return fail('version', 'This game was made by another version');
  if (typeof env.id !== 'string' || !env.id) return fail('badEnvelope', 'Malformed move');
  if (doc.ids.includes(env.id)) return fail('duplicate', 'That move was already made');
  const control = controlProblem(doc.seats, env);
  if (control) return { ok: false, ...control };
  if (env.cmd.basis !== undefined && env.cmd.basis !== doc.game.seq) return fail('stale', 'The game moved on; decide again');
  const a = env.cmd.a as { k?: unknown } | undefined;
  if (env.cmd.by === 'system' && typeof a?.k === 'string' && TIMEOUT_ACTIONS.has(a.k)) {
    // A reaction window waiting only on seats that let their last ones run out need not wait for its deadline
    const early = a.k === 'closeReact' && reactIdleOnly(doc);
    if (!early && (!doc.deadline || env.at < doc.deadline.at)) return fail('early', 'Time is not up yet');
  }
  // The room's time limit: only once it has run out (a room without one never ends this way)
  if (env.cmd.by === 'system' && a?.k === 'timeUp' && (doc.endsAt === undefined || env.at < doc.endsAt)) {
    return fail('early', 'Time is not up yet');
  }

  const r = apply(doc.game, env.cmd);
  if (!r.ok) return fail(r.error.code, r.error.message);

  const seats = { ...doc.seats };
  const strikes = { ...doc.strikes };
  const idle = { ...doc.reactIdle };
  const by = env.cmd.by;
  const own = by !== 'system' ? seats[by] : undefined;
  // The seat's own player acted (humans send no basis; the driver playing its own AFK seat does): they are back. A
  // pass in a Hero League reaction window only says they answered it: their screen may send it by itself (the
  // reactions setting), even while they are away, so it neither clears their timeouts nor takes the seat back.
  const decision = !(typeof a?.k === 'string' && DEBUG_ACTIONS.has(a.k));
  if (by !== 'system' && own && own.kind === 'human' && own.ctrl !== '' && own.ctrl === env.pid && env.cmd.basis === undefined && decision) {
    delete idle[by];
    if (!(a?.k === 'pass' && doc.game.phase.k === 'react')) {
      delete strikes[by];
      if (own.afk) seats[by] = cleanSeat({ ...own, afk: false });
    }
  }
  const limit = doc.afkStrikes ?? AFK_STRIKES;
  for (const ev of r.events) {
    // A reaction window running out is never an AFK strike: it only counts towards not being waited for in them
    if (ev.t === 'reactTimeout') {
      for (const seat of ev.seats) if (seats[seat]?.kind === 'human') idle[seat] = Math.min(REACT_IDLE_AFTER, (idle[seat] ?? 0) + 1);
      continue;
    }
    if (ev.t !== 'timeout') continue;
    const n = (strikes[ev.seat] ?? 0) + 1;
    strikes[ev.seat] = n;
    const info = seats[ev.seat];
    if (limit > 0 && n >= limit && info && info.kind === 'human' && !info.afk) seats[ev.seat] = { ...info, afk: true };
  }

  const next: Doc = {
    gid: doc.gid,
    seq: r.state.seq,
    game: r.state,
    seats,
    ids: [...doc.ids, env.id].slice(-IDS_RING),
    recent: [...doc.recent, env].slice(-RECENT_MAX),
    timers: doc.timers,
    strikes,
    ...carried(doc),
  };
  const sv = deepEqual(seats, doc.seats) ? doc.sv : (doc.sv ?? 0) + 1;
  if (sv) next.sv = sv;
  if (Object.keys(idle).length) next.reactIdle = idle;
  const deadline = nextDeadline(doc.deadline, r.state, r.events, env.at, doc.timers);
  if (deadline) next.deadline = deadline;
  return { ok: true, doc: next, events: r.events };
}

/** The seq an envelope in doc.recent was committed at, or null when it has scrolled out */
export function seqOfEnvelope(doc: Doc, id: string): number | null {
  const i = doc.recent.findIndex((e) => e.id === id);
  return i < 0 ? null : doc.seq - (doc.recent.length - 1 - i);
}

export const encodeDoc = (doc: Doc): string => JSON.stringify(doc);

export class DocError extends Error {
  constructor(readonly code: 'version' | 'corrupt', message: string) {
    super(message);
  }
}

/**
 * Parses encodeDoc() output, filling containers an older writer left out. Throws DocError. `upgrade` (a local save,
 * which nobody else replays) also takes a game of one of the UPGRADABLE_VERSIONS and carries it on under the
 * current rules; a shared room never mixes rules versions.
 */
export function decodeDoc(text: string, opts: { upgrade?: boolean } = {}): Doc {
  let raw: Partial<Doc> & { game?: unknown };
  try {
    raw = JSON.parse(text) as Partial<Doc>;
  } catch {
    throw new DocError('corrupt', 'The game data is unreadable');
  }
  if (typeof raw !== 'object' || raw === null || typeof raw.gid !== 'string' || typeof raw.game !== 'object' || !raw.game) {
    throw new DocError('corrupt', 'The game data is unreadable');
  }
  const v = (raw.game as { v?: unknown }).v;
  const upgrade = !!opts.upgrade && typeof v === 'number' && UPGRADABLE_VERSIONS.includes(v);
  if (v !== RULES_VERSION && !upgrade) throw new DocError('version', `This game was made by another version (${String(v)})`);
  let game: GameState;
  try {
    game = decode(JSON.stringify(raw.game));
  } catch (err) {
    throw new DocError('corrupt', err instanceof Error ? err.message : 'The game data is unreadable');
  }
  const doc: Doc = {
    gid: raw.gid,
    seq: game.seq,
    game,
    seats: raw.seats ?? {},
    ids: Array.isArray(raw.ids) ? raw.ids : [],
    recent: Array.isArray(raw.recent) ? raw.recent : [],
    timers: { ...OFFLINE_TIMERS, ...raw.timers },
    strikes: raw.strikes ?? {},
  };
  if (typeof raw.sv === 'number' && raw.sv > 0) doc.sv = raw.sv;
  if (raw.reactIdle && typeof raw.reactIdle === 'object' && Object.keys(raw.reactIdle).length) doc.reactIdle = raw.reactIdle;
  // Room options (absent in older documents: the defaults)
  if (typeof raw.afkStrikes === 'number' && raw.afkStrikes >= 0) doc.afkStrikes = raw.afkStrikes;
  if (typeof raw.botPace === 'number' && BOT_PACES.includes(raw.botPace)) doc.botPace = raw.botPace;
  if (typeof raw.botSkill === 'string' && BOT_SKILLS.includes(raw.botSkill)) doc.botSkill = raw.botSkill;
  if (typeof raw.endsAt === 'number' && Number.isFinite(raw.endsAt)) doc.endsAt = raw.endsAt;
  if (typeof raw.timeLimit === 'number' && raw.timeLimit > 0) doc.timeLimit = raw.timeLimit;
  if (raw.deadline && typeof raw.deadline.at === 'number' && typeof raw.deadline.key === 'string') doc.deadline = raw.deadline;
  return doc;
}

export type Verify =
  /** One batch per seq after prev (none when only the seats changed) */
  | { batches: Batch[]; events: GameEvent[] }
  /** The replay disagreed with what was written */
  | { tamper: string }
  /** Too far behind to replay (more than recent holds): snap */
  | { gap: number };

const seatName = (doc: Doc, env: Envelope): string =>
  env.cmd.by === 'system' ? 'the table' : (doc.seats[env.cmd.by]?.name ?? doc.game.players[env.cmd.by]?.name ?? env.cmd.by);

/**
 * Checks `next` against `prev` by replaying the envelopes in between (from next.recent) through the engine, and
 * returns their events. Same gid is the caller's job (a new gid is a new game: snap).
 */
export function verifyNext(prev: Doc, next: Doc): Verify {
  const n = next.seq - prev.seq;
  if (n < 0) return { tamper: `The game went back from move ${prev.seq} to ${next.seq}` };
  if (n === 0) return deepEqual(prev.game, next.game) ? { batches: [], events: [] } : { tamper: `Move ${next.seq} was rewritten` };
  if (n > next.recent.length) return { gap: n };

  let game = prev.game;
  const batches: Batch[] = [];
  const events: GameEvent[] = [];
  // Seats edited in the gap (a seat handed to a bot and taken back): the seats each move was checked against were
  // never seen here, so only the rules are checked
  const seatsKnown = (prev.sv ?? 0) === (next.sv ?? 0);
  for (const env of next.recent.slice(next.recent.length - n)) {
    const who = seatName(next, env);
    const seq = game.seq + 1;
    if (seatsKnown && controlProblem(prev.seats, env) && controlProblem(next.seats, env)) {
      return { tamper: `Move ${seq} by ${who} came from someone else` };
    }
    const r = apply(game, env.cmd);
    if (!r.ok) return { tamper: `Move ${seq} by ${who} broke the rules (${r.error.message})` };
    game = r.state;
    batches.push({ seq: game.seq, events: r.events, state: game });
    events.push(...r.events);
  }
  if (!deepEqual(game, next.game)) return { tamper: `Move ${next.seq} by ${seatName(next, next.recent.at(-1)!)} broke the rules` };
  // Hand out the written state for the last step, so later identity checks see the stored value
  const last = batches.at(-1);
  if (last) last.state = next.game;
  return { batches, events };
}

/** A batch that jumps straight to `doc` */
export const snapBatch = (doc: Doc): Batch => ({ seq: doc.seq, events: [], state: doc.game, snap: true });
