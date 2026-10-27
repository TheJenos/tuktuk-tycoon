import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getBoard, type Command, type GameEvent, type SeatId } from '../../rules';
import { animBudget, ANIM, ONLINE_TIMERS, phaseSecs, type TimerRules } from '../../shared/timing';
import { boardTokens, type TokenId } from '../../shared/tokens';
import { MemoryDb, MemoryServer } from '../db';
import { applyEnvelope, createDoc, decodeDoc, encodeDoc, fullAnimBudget, nextDeadline, REACT_IDLE_AFTER, reactIdleOnly } from '../doc';
import { RoomConnection, rematchSeats, watchRooms, type LobbyRecord, type RoomSummary, type SetupRecord } from '../network';
import { REACT_AFTER_MS } from '../session';
import type { Doc, Envelope, SeatInfo } from '../types';
import { docOf, envelope, flush, memoryStorage, PIDS, seatList, table, T0, useClock } from './helpers';

/*
 * The net layer on Hero League (board `heroes`): a seat's token is its hero, the table moves between boards of six and
 * eight tokens, a room is capped at six, and reaction windows time out without AFK strikes (and stop waiting for a
 * seat that lets three in a row run out).
 */

beforeEach(() => {
  useClock();
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('sessionStorage', memoryStorage());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const HEROES = boardTokens('heroes');

function must(d: Doc, env: Envelope): Doc {
  const r = applyEnvelope(d, env);
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r.doc;
}

/** A Hero League doc: seats as in seatList(kinds), each with the token given */
function heroDoc(kinds: string, tokens: string[], timers: TimerRules = ONLINE_TIMERS): Doc {
  const seats = seatList(kinds).map((s, i) => ({ ...s, token: (tokens[i] ?? s.token) as TokenId }));
  return createDoc({ gid: 'g_TEST000001', seats, rules: { board: 'heroes' }, timers, seed: 7, at: T0 });
}

/**
 * Two seats where the one that does not start plays Storm Lord (so every roll of the other opens a Thunder window for
 * it alone) and the starter plays Jade Titan. `kinds`: the starter's kind, then Storm Lord's.
 */
function thunderTable(kinds: string): { doc: Doc; turn: SeatId; storm: SeatId } {
  const probe = heroDoc('hh', ['jadeTitan', 'stormLord']);
  const turn = probe.game.turn.seat;
  const storm: SeatId = turn === 's0' ? 's1' : 's0';
  const k = turn === 's0' ? kinds : [...kinds].reverse().join('');
  const tokens = turn === 's0' ? ['jadeTitan', 'stormLord'] : ['stormLord', 'jadeTitan'];
  const doc = heroDoc(k, tokens);
  expect(doc.game.turn.seat).toBe(turn);
  return { doc, turn, storm };
}

/** The turn seat rolls (its player sends it; a bot's move carries a basis) */
function roll(d: Doc, at = T0 + 1_000): { doc: Doc; events: GameEvent[] } {
  const seat = d.game.turn.seat;
  const info = d.seats[seat]!;
  const cmd: Command = info.kind === 'bot' ? { by: seat, a: { k: 'roll' }, basis: d.seq } : { by: seat, a: { k: 'roll' } };
  const r = applyEnvelope(d, envelope(cmd, info.ctrl, at));
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return { doc: r.doc, events: r.events };
}

const closeReact = (d: Doc, at: number): ReturnType<typeof applyEnvelope> =>
  applyEnvelope(d, envelope({ by: 'system', a: { k: 'closeReact' }, basis: d.seq }, '', at));

describe('Hero League: a seat plays the hero its token is', () => {
  it('createDoc asks the engine for each seat’s token as its hero, and the seat shows the hero it plays', () => {
    const d = heroDoc('hhb', ['stormLord', 'sharpshot', 'starCaptain']);
    expect(Object.values(d.game.players).map((p) => p!.hero)).toEqual(['stormLord', 'sharpshot', 'starCaptain']);
    for (const s of Object.values(d.seats) as SeatInfo[]) expect(s.token).toBe(d.game.players[s.seat]!.hero);
  });

  it('tokens kept from an eight-token board become heroes, none twice', () => {
    // The kite is slot 7, which Hero League has not got: it takes a free hero
    const d = heroDoc('hhb', ['kite', 'tuktuk', 'elephant']);
    const heroes = Object.values(d.game.players).map((p) => p!.hero);
    expect(heroes).toEqual(['steelAce', 'jadeTitan', 'starCaptain']);
    expect((Object.values(d.seats) as SeatInfo[]).map((s) => s.token)).toEqual(heroes);
    // Two seats on one slot: the second gets the next free hero
    const twice = heroDoc('hh', ['stormLord', 'stormLord']);
    expect(new Set(Object.values(twice.game.players).map((p) => p!.hero)).size).toBe(2);
  });

  it('a classic board gives no heroes and keeps the tokens as before', () => {
    const d = createDoc({ gid: 'g_TEST000001', seats: seatList('hhb'), rules: { board: 'colombo' }, seed: 7, at: T0 });
    expect(Object.values(d.game.players).some((p) => p!.hero !== undefined)).toBe(false);
    expect((Object.values(d.seats) as SeatInfo[]).map((s) => s.token)).toEqual(boardTokens('colombo').slice(0, 3));
  });

  it('a rematch keeps everyone’s hero', () => {
    const d = heroDoc('hhb', ['velvetViper', 'jadeTitan', 'sharpshot']);
    const seats = Object.values(rematchSeats(d, new Set([PIDS[0], PIDS[1]]))) as SeatInfo[];
    const again = createDoc({ gid: 'g_TEST000002', seats, rules: d.game.cfg, seed: 99, at: T0 });
    expect(Object.values(again.game.players).map((p) => p!.hero)).toEqual(['velvetViper', 'jadeTitan', 'sharpshot']);
  });
});

describe('Hero League: reaction windows', () => {
  it('a reaction window counts down from the end of the whole batch that opened it, however long', () => {
    const { doc } = thunderTable('hh');
    const r = roll(doc);
    expect(r.doc.game.phase.k).toBe('react');
    expect(r.doc.deadline).toEqual({
      key: `react:${r.doc.game.since}`,
      at: T0 + 1_000 + fullAnimBudget(r.events) + phaseSecs('reaction', ONLINE_TIMERS) * 1000,
    });
    // A batch past animBudget's cap still plays in full first
    const long: GameEvent[] = [
      { t: 'card', seat: 's0', deck: 'chance', cardId: 'ch-1', text: '', kept: false },
      { t: 'card', seat: 's0', deck: 'chance', cardId: 'ch-2', text: '', kept: false },
    ];
    expect(animBudget(long)).toBe(ANIM.batchMax);
    expect(fullAnimBudget(long)).toBe(2 * ANIM.card);
    expect(nextDeadline(undefined, r.doc.game, long, T0, ONLINE_TIMERS)?.at).toBe(T0 + 2 * ANIM.card + 8_000);
    // Other decisions keep the capped budget
    expect(nextDeadline(undefined, doc.game, long, T0, ONLINE_TIMERS)?.at).toBe(T0 + ANIM.batchMax + ONLINE_TIMERS.turn * 1000);
  });

  it('closeReact only once the deadline has passed, and running out is never an AFK strike', () => {
    const { doc, storm } = thunderTable('hh');
    const d = roll(doc).doc;
    expect(d.game.phase).toMatchObject({ k: 'react', open: [storm] });
    expect(closeReact(d, d.deadline!.at - 1)).toMatchObject({ ok: false, code: 'early' });
    const r = closeReact(d, d.deadline!.at);
    if (!r.ok) throw new Error(r.message);
    expect(r.events).toContainEqual({ t: 'reactTimeout', seats: [storm] });
    expect(r.doc.strikes).toEqual({});
    expect(r.doc.seats[storm]?.afk).toBeUndefined();
    expect(r.doc.reactIdle).toEqual({ [storm]: 1 });
    expect(decodeDoc(encodeDoc(r.doc)).reactIdle).toEqual({ [storm]: 1 });
  });

  it(`after ${REACT_IDLE_AFTER} windows run out in a row a seat is not waited for, until its player acts`, () => {
    const { doc, storm } = thunderTable('hh');
    let d = roll(doc).doc;
    // Counted up to REACT_IDLE_AFTER, never past it
    for (const n of [1, 2, 3, 3]) {
      const r = closeReact({ ...d, reactIdle: n === 1 ? undefined : { [storm]: n - 1 } }, d.deadline!.at);
      if (!r.ok) throw new Error(r.message);
      expect(r.doc.reactIdle?.[storm]).toBe(Math.min(n, REACT_IDLE_AFTER));
    }
    // Two: still waited for. Three: the window may close at once
    expect(reactIdleOnly({ ...d, reactIdle: { [storm]: REACT_IDLE_AFTER - 1 } })).toBe(false);
    expect(closeReact({ ...d, reactIdle: { [storm]: REACT_IDLE_AFTER - 1 } }, T0 + 1_001)).toMatchObject({ ok: false, code: 'early' });
    d = { ...d, reactIdle: { [storm]: REACT_IDLE_AFTER } };
    expect(reactIdleOnly(d)).toBe(true);
    const early = closeReact(d, T0 + 1_001);
    expect(early.ok).toBe(true);
    // Its player acting takes it back: their own answer in the window
    const own = must(d, envelope({ by: storm, a: { k: 'pass', at: d.game.since } }, d.seats[storm]!.ctrl, T0 + 1_001));
    expect(own.reactIdle).toBeUndefined();
  });

  it('a pass in a reaction window does not take an absent player’s seat back from the bot', () => {
    const { doc, storm } = thunderTable('hh');
    let d = roll(doc).doc;
    d = { ...d, strikes: { [storm]: 1 }, seats: { ...d.seats, [storm]: { ...d.seats[storm]!, afk: true } }, reactIdle: { [storm]: 2 } };
    // Their screen answering by itself (the reactions setting)
    const passed = must(d, envelope({ by: storm, a: { k: 'pass', at: d.game.since } }, d.seats[storm]!.ctrl, T0 + 1_001));
    expect(passed.seats[storm]?.afk).toBe(true);
    expect(passed.strikes[storm]).toBe(1);
    expect(passed.reactIdle).toBeUndefined();
  });

  it('the driver closes a window waiting only on such a seat once the throw has played, not at the deadline', async () => {
    const { doc, turn, storm } = thunderTable('hh');
    const t = table({ ...doc, reactIdle: { [storm]: REACT_IDLE_AFTER } }, [{ me: doc.seats[turn]!.ctrl, owner: true, alwaysDrive: true }]);
    await flush();
    const s = t.sessions[0]!;
    expect((await s.dispatch(turn, { k: 'roll' })).ok).toBe(true);
    await flush();
    const opened = docOf(s);
    expect(opened.game.phase.k).toBe('react');
    const rolledAt = opened.recent.at(-1)!.at;
    const rollEvents = (() => {
      const r = applyEnvelope({ ...doc, reactIdle: { [storm]: REACT_IDLE_AFTER } }, opened.recent.at(-1)!);
      return r.ok ? r.events : [];
    })();
    const due = rolledAt + fullAnimBudget(rollEvents) + REACT_AFTER_MS;
    await vi.advanceTimersByTimeAsync(due - Date.now() - 50);
    expect(docOf(s).seq).toBe(opened.seq);
    await vi.advanceTimersByTimeAsync(100);
    await flush();
    const closed = docOf(s).recent.find((e) => e.cmd.by === 'system' && (e.cmd.a as { k: string }).k === 'closeReact');
    expect(closed).toBeDefined();
    expect(closed!.at).toBeLessThan(opened.deadline!.at);
    await s.dispose();
  });

  it('a bot reactor answers once the throw has played (animBudget x pace + 300 ms), not after its thinking time', async () => {
    const { doc, turn, storm } = thunderTable('hb');
    expect(doc.seats[storm]?.kind).toBe('bot');
    const t = table(doc, [{ me: doc.seats[turn]!.ctrl, owner: true, alwaysDrive: true }]);
    await flush();
    const s = t.sessions[0]!;
    expect((await s.dispatch(turn, { k: 'roll' })).ok).toBe(true);
    await flush();
    const opened = docOf(s);
    expect(opened.game.phase).toMatchObject({ k: 'react', open: [storm] });
    const r = applyEnvelope(doc, opened.recent.at(-1)!);
    const due = opened.recent.at(-1)!.at + fullAnimBudget(r.ok ? r.events : []) * 1 + REACT_AFTER_MS;
    await vi.advanceTimersByTimeAsync(due - Date.now() - 50);
    expect(docOf(s).seq).toBe(opened.seq);
    await vi.advanceTimersByTimeAsync(100);
    await flush();
    const answer = docOf(s).recent[opened.recent.length];
    expect(answer?.cmd).toMatchObject({ by: storm, basis: opened.seq });
    expect(answer!.at).toBeGreaterThanOrEqual(due);
    expect(answer!.at).toBeLessThan(opened.deadline!.at);
    await s.dispose();
  });
});

describe('Hero League: a window open to several bots', () => {
  it('each answers once the throw has played, and the window never waits for its deadline', async () => {
    const probe = heroDoc('hhh', ['jadeTitan', 'starCaptain', 'sharpshot']);
    const turn = probe.game.turn.seat;
    const ids: SeatId[] = ['s0', 's1', 's2'];
    const [storm, ace] = ids.filter((x) => x !== turn) as [SeatId, SeatId];
    const doc = heroDoc(ids.map((x) => (x === turn ? 'h' : 'b')).join(''), ids.map((x) => (x === turn ? 'jadeTitan' : x === storm ? 'stormLord' : 'steelAce')));
    const t = table(doc, [{ me: doc.seats[turn]!.ctrl, owner: true, alwaysDrive: true }]);
    await flush();
    const s = t.sessions[0]!;
    const sent: Envelope[] = [];
    s.onBatch((b) => {
      const env = docOf(s).recent.at(-1);
      if (!b.snap && env) sent.push(env);
    });
    expect((await s.dispatch(turn, { k: 'roll' })).ok).toBe(true);
    await flush();
    const opened = docOf(s);
    // Steel Ace copies Thunder Call while Storm Lord's is ready: both may re-roll
    expect(opened.game.phase).toMatchObject({ k: 'react', open: [storm, ace].sort() });
    for (let i = 0; i < 100 && docOf(s).game.phase.k === 'react'; i++) await vi.advanceTimersByTimeAsync(100);
    expect(docOf(s).game.phase.k).not.toBe('react');
    expect(Date.now()).toBeLessThan(opened.deadline!.at);
    expect(sent.some((e) => (e.cmd.a as { k: string }).k === 'closeReact')).toBe(false);
    expect(sent.filter((e) => e.cmd.by === storm || e.cmd.by === ace).length).toBeGreaterThanOrEqual(1);
    await s.dispose();
  });
});

describe('Hero League rooms', () => {
  async function heroRoom(o: { bots?: number; token?: TokenId; board?: string; maxSeats?: number } = {}) {
    const server = new MemoryServer();
    const owner = await RoomConnection.create(new MemoryDb(server), {
      me: PIDS[0], host: 'Alice', name: 'Hero room', timers: ONLINE_TIMERS, rules: { board: o.board ?? 'heroes' },
      maxSeats: o.maxSeats ?? 8, bots: Array.from({ length: o.bots ?? 0 }, () => ({ skill: 'normal' as const })), ...(o.token ? { token: o.token } : {}),
    });
    await flush();
    return { server, owner, code: owner.code };
  }

  it('seats six at most; bots get random heroes nobody has', async () => {
    const { server, owner, code } = await heroRoom({ bots: 7 });
    expect(server.read<LobbyRecord>(`lobby/${code}`)?.maxSeats).toBe(6);
    const seats = Object.values(owner.setup()!.seats) as SeatInfo[];
    expect(seats).toHaveLength(6);
    expect(seats.map((s) => s.token).sort()).toEqual([...HEROES].sort());
    expect(owner.setup()!.seats.s0?.token).toBe('jadeTitan');
    await expect(owner.addBot()).rejects.toMatchObject({ code: 'full' });
    // The heroes the bots get are not always the same
    const firsts = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const r = await heroRoom({ bots: 1 });
      firsts.add(r.owner.setup()!.seats.s1!.token);
      await r.owner.leave();
    }
    expect(firsts.size).toBeGreaterThan(1);
    for (const t of firsts) expect(HEROES).toContain(t);
  });

  it('on start every player plays the hero their seat shows', async () => {
    const { owner } = await heroRoom({ bots: 3, token: 'stormLord' });
    const held = (Object.values(owner.setup()!.seats) as SeatInfo[]).map((s) => s.token);
    const free = HEROES.find((h) => !held.includes(h))!;
    await owner.setSeatToken(free, 's1');
    await flush();
    await owner.start();
    await flush();
    const d = owner.session()!.current()!;
    expect(d.game.cfg.board).toBe('heroes');
    expect(d.game.players.s0?.hero).toBe('stormLord');
    expect(d.game.players.s1?.hero).toBe(free);
    for (const s of Object.values(d.seats) as SeatInfo[]) expect(s.token).toBe(d.game.players[s.seat]!.hero);
    expect(d.timers.reaction).toBe(ONLINE_TIMERS.reaction);
  });

  it('a board change re-maps the stored tokens to the new set and caps the room’s seats', async () => {
    const { server, owner, code } = await heroRoom({ board: 'lanka', bots: 2, token: 'kite' });
    expect(server.read<LobbyRecord>(`lobby/${code}`)?.maxSeats).toBe(8);
    await owner.setRules({ board: 'heroes' });
    await flush();
    const tokens = (Object.values(owner.setup()!.seats) as SeatInfo[]).map((s) => s.token);
    expect(new Set(tokens).size).toBe(3);
    for (const t of tokens) expect(HEROES).toContain(t);
    expect(server.read<SetupRecord>(`rooms/${code}/setup`)?.rules.board).toBe('heroes');
    expect(server.read<LobbyRecord>(`lobby/${code}`)).toMatchObject({ board: 'heroes', maxSeats: 6 });
    // And back: the heroes become the same slots of All Island's set
    await owner.setRules({ board: 'lanka' });
    await flush();
    const back = (Object.values(owner.setup()!.seats) as SeatInfo[]).map((s) => s.token);
    expect(back).toEqual(tokens.map((t) => boardTokens('lanka')[HEROES.indexOf(t as TokenId)]));
    expect(server.read<LobbyRecord>(`lobby/${code}`)?.maxSeats).toBe(6);
  });

  it('a board too small for the table is refused, and nothing changes', async () => {
    const { server, owner, code } = await heroRoom({ board: 'lanka', bots: 6 });
    await expect(owner.setRules({ board: 'heroes', startCash: 2000 })).rejects.toMatchObject({ code: 'full' });
    await flush();
    expect(owner.setup()!.rules).toMatchObject({ board: 'lanka', startCash: 1500 });
    expect(server.read<LobbyRecord>(`lobby/${code}`)).toMatchObject({ board: 'lanka', maxSeats: 8 });
  });

  it('a start over the board’s cap is refused before the setup is locked', async () => {
    const { server, owner, code } = await heroRoom({ board: 'lanka', bots: 6 });
    // A table from before the cap was kept (written past setRules)
    server.write(`rooms/${code}/setup/rules/board`, 'heroes');
    await flush();
    await expect(owner.start()).rejects.toMatchObject({ code: 'seats', message: expect.stringContaining(`${getBoard('heroes').display.name} seats at most 6`) });
    await flush();
    expect(owner.setup()!.locked).toBe('');
    expect(owner.session()).toBeNull();
  });

  it('the Rooms list shows the Speed Die only where the room plays it (never on Hero League)', async () => {
    const { server, owner, code } = await heroRoom({ board: 'lanka' });
    await owner.setRules({ speedDie: true });
    await flush();
    expect(server.read<LobbyRecord>(`lobby/${code}`)?.speedDie).toBe(true);
    // To Hero League, which pins it off: the stored rule stays, the Rooms list stops showing it
    await owner.setRules({ board: 'heroes' });
    await flush();
    expect(server.read<LobbyRecord>(`lobby/${code}`)).toMatchObject({ board: 'heroes', speedDie: false });
    await owner.setRules({ speedDie: true });
    await flush();
    expect(server.read<LobbyRecord>(`lobby/${code}`)?.speedDie).toBe(false);
    // Back to All Island: the room plays it again
    await owner.setRules({ board: 'lanka' });
    await flush();
    expect(server.read<LobbyRecord>(`lobby/${code}`)).toMatchObject({ board: 'lanka', speedDie: true });
    // A Hero League room created asking for it never shows it
    const hero = await RoomConnection.create(new MemoryDb(server), {
      me: PIDS[1], host: 'Bob', name: 'Hero room 2', timers: ONLINE_TIMERS, rules: { board: 'heroes', speedDie: true }, maxSeats: 6,
    });
    await flush();
    expect(server.read<LobbyRecord>(`lobby/${hero.code}`)?.speedDie).toBe(false);
  });

  it('the Rooms list never shows more seats than the board has', async () => {
    const { server, code } = await heroRoom({ board: 'lanka' });
    server.write(`lobby/${code}/board`, 'heroes');
    let rooms: RoomSummary[] = [];
    const stop = watchRooms(new MemoryDb(server), (x) => (rooms = x));
    await flush();
    expect(rooms.find((r) => r.code === code)).toMatchObject({ board: 'heroes', maxSeats: 6 });
    stop();
  });
});
