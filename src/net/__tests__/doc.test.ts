import { describe, expect, it } from 'vitest';
import { apply, awaiting, defaultAction, RULES_VERSION, timeoutCommand, timer, type Action, type SeatId } from '../../rules';
import { animBudget, AUCTION_BID_SECS, ONLINE_TIMERS } from '../../shared/timing';
import {
  applyEnvelope,
  decodeDoc,
  DocError,
  encodeDoc,
  IDS_RING,
  RECENT_MAX,
  seatsOf,
  seqOfEnvelope,
  verifyNext,
} from '../doc';
import type { Doc, Envelope } from '../types';
import { envelope, makeDoc, PIDS, T0 } from './helpers';

const turnSeat = (d: Doc): SeatId => d.game.turn.seat;
const pidOf = (d: Doc, seat: SeatId): string => d.seats[seat]?.ctrl ?? '';

function must(d: Doc, env: Envelope): Doc {
  const r = applyEnvelope(d, env);
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r.doc;
}

/** The turn seat's player sends `a` */
const act = (d: Doc, a: Action, at = T0 + 1_000): Doc => must(d, envelope({ by: turnSeat(d), a }, pidOf(d, turnSeat(d)), at));

describe('createDoc', () => {
  it('starts at seq 0 with the seats and a first deadline from the timers', () => {
    const d = makeDoc('hhb', { timers: ONLINE_TIMERS });
    expect(d.seq).toBe(0);
    expect(Object.keys(d.seats)).toEqual(['s0', 's1', 's2']);
    expect(d.deadline).toEqual({ key: timer(d.game)!.key, at: T0 + ONLINE_TIMERS.turn * 1000 });
    expect(seatsOf(d, PIDS[1])).toEqual(['s1']);
    // Offline: no turn timer
    expect(makeDoc('hb').deadline).toBeUndefined();
  });

  it('round-trips through encodeDoc / decodeDoc and refuses another version', () => {
    const d = makeDoc('hh', { timers: ONLINE_TIMERS });
    expect(decodeDoc(encodeDoc(d))).toEqual(d);
    const old = JSON.parse(encodeDoc(d)) as Doc;
    old.game.v = RULES_VERSION + 1;
    expect(() => decodeDoc(JSON.stringify(old))).toThrow(DocError);
    try {
      decodeDoc(JSON.stringify(old));
    } catch (err) {
      expect((err as DocError).code).toBe('version');
    }
    expect(() => decodeDoc('{nope')).toThrow(DocError);
  });

  it('a local save of the previous rules version is upgraded; a shared room of it is refused', () => {
    const d = makeDoc('hh', { timers: ONLINE_TIMERS });
    const prev = JSON.parse(encodeDoc(d)) as Doc;
    prev.game.v = 3;
    expect(() => decodeDoc(JSON.stringify(prev))).toThrow(DocError);
    expect(decodeDoc(JSON.stringify(prev), { upgrade: true }).game.v).toBe(RULES_VERSION);
    prev.game.v = 2;
    expect(() => decodeDoc(JSON.stringify(prev), { upgrade: true })).toThrow(DocError);
  });
});

describe('applyEnvelope', () => {
  it('lets a player act for their own seat only', () => {
    const d = makeDoc('hh');
    const seat = turnSeat(d);
    const other = seat === 's0' ? PIDS[1] : PIDS[0];
    const refused = applyEnvelope(d, envelope({ by: seat, a: { k: 'roll' } }, other));
    expect(refused).toMatchObject({ ok: false, code: 'notYourSeat' });
    const ok = applyEnvelope(d, envelope({ by: seat, a: { k: 'roll' } }, pidOf(d, seat)));
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.doc.seq).toBe(1);
      expect(ok.doc.recent).toHaveLength(1);
      expect(ok.events.some((e) => e.t === 'dice')).toBe(true);
    }
  });

  it('returns the engine message for an illegal action', () => {
    const d = makeDoc('hh');
    const r = applyEnvelope(d, envelope({ by: turnSeat(d), a: { k: 'endTurn' } }, pidOf(d, turnSeat(d))));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message.length).toBeGreaterThan(0);
  });

  it('drops a duplicate envelope id and keeps the id ring and recent bounded', () => {
    let d = makeDoc('hh', { rules: { debug: true } });
    const e = envelope({ by: turnSeat(d), a: { k: 'debugSetCash', seat: 's0', cash: 1 } }, pidOf(d, turnSeat(d)));
    d = must(d, e);
    expect(applyEnvelope(d, e)).toMatchObject({ ok: false, code: 'duplicate' });
    expect(seqOfEnvelope(d, e.id)).toBe(1);
    for (let i = 0; i < 20; i++) d = act(d, { k: 'debugSetCash', seat: 's0', cash: 100 + i });
    expect(d.ids).toHaveLength(IDS_RING);
    expect(d.recent).toHaveLength(RECENT_MAX);
    expect(d.seq).toBe(21);
    expect(seqOfEnvelope(d, d.recent[0]!.id)).toBe(21 - RECENT_MAX + 1);
  });

  it('needs a basis for bot seats and for system commands, and refuses a stale one', () => {
    let d = makeDoc('bb');
    const seat = turnSeat(d);
    expect(applyEnvelope(d, envelope({ by: seat, a: { k: 'roll' } }, PIDS[0]))).toMatchObject({ ok: false, code: 'basis' });
    expect(applyEnvelope(d, envelope({ by: seat, a: { k: 'roll' }, basis: 5 }, PIDS[0]))).toMatchObject({ ok: false, code: 'stale' });
    d = must(d, envelope({ by: seat, a: { k: 'roll' }, basis: 0 }, PIDS[0]));
    expect(d.seq).toBe(1);
    expect(applyEnvelope(d, envelope({ by: 'system', a: { k: 'endGame' } }, PIDS[0]))).toMatchObject({ ok: false, code: 'basis' });
  });

  it('accepts a timeout only once its deadline has passed, and only once', () => {
    const d = makeDoc('hh', { timers: ONLINE_TIMERS });
    const cmd = timeoutCommand(d.game)!;
    const due = d.deadline!.at;
    expect(applyEnvelope(d, envelope(cmd, PIDS[0], due - 1))).toMatchObject({ ok: false, code: 'early' });
    const r = applyEnvelope(d, envelope(cmd, PIDS[0], due));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.events.some((e) => e.t === 'timeout')).toBe(true);
    // The same timeout from a second driver: stale
    expect(applyEnvelope(r.doc, envelope(cmd, PIDS[1], due + 10))).toMatchObject({ ok: false, code: 'stale' });
  });

  it('marks a seat AFK after two timeouts in a row; its player acting takes it back', () => {
    let d = makeDoc('hh', { timers: ONLINE_TIMERS, rules: { debug: true } });
    const seat = turnSeat(d);
    const timeoutNow = (x: Doc): Doc => must(x, envelope(timeoutCommand(x.game)!, PIDS[1], x.deadline!.at));
    // 1st timeout: the forced roll
    d = timeoutNow(d);
    expect(d.strikes[seat]).toBe(1);
    expect(d.seats[seat]?.afk).toBeUndefined();
    // Play on until the same seat times out again
    while (!d.seats[seat]?.afk) {
      expect(d.game.phase.k).not.toBe('over');
      d = timeoutNow(d);
    }
    expect(d.strikes[seat]).toBeGreaterThanOrEqual(2);
    // Now the driver may play it (with a basis) ...
    expect(seatsOf(d, pidOf(d, seat))).toContain(seat);
    // ... and its player's own move clears the strikes
    for (let i = 0; i < 20 && !awaiting(d.game).includes(seat); i++) d = timeoutNow(d);
    const move = defaultAction(d.game, seat)!;
    const back = must(d, envelope({ by: seat, a: move }, pidOf(d, seat), d.deadline?.at ?? T0));
    expect(back.seats[seat]?.afk).toBeUndefined();
    expect(back.strikes[seat]).toBeUndefined();
  });

  it('a debug command from the seat\'s own page (e2e rigging) is not a move: the strikes and AFK stand', () => {
    let d = makeDoc('hh', { timers: ONLINE_TIMERS, rules: { debug: true } });
    const seat = turnSeat(d);
    const pid = pidOf(d, seat);
    const timeoutNow = (x: Doc): Doc => must(x, envelope(timeoutCommand(x.game)!, PIDS[1], x.deadline!.at));
    const rig = (x: Doc): Doc => must(x, envelope({ by: seat, a: { k: 'debugRig', dice: [[4, 6]] } }, pid, x.deadline?.at ?? T0));
    d = timeoutNow(d);
    expect(d.strikes[seat]).toBe(1);
    // The test rigs the next throw from the absent player's page after the first timeout has already landed
    d = rig(d);
    d = must(d, envelope({ by: seat, a: { k: 'debugSetCash', seat, cash: 1_234 } }, pid, d.deadline?.at ?? T0));
    expect(d.strikes[seat]).toBe(1);
    // The next timeout of that seat is the second in a row
    for (let i = 0; i < 20 && d.strikes[seat] === 1; i++) d = timeoutNow(d);
    expect(d.strikes[seat]).toBe(2);
    expect(d.seats[seat]?.afk).toBe(true);
    // ... and rigging while a bot plays the seat doesn't take it back either
    expect(rig(d).seats[seat]?.afk).toBe(true);
  });

  it('keeps the deadline while timer(game).key holds and restarts it when the key changes', () => {
    let d = makeDoc('hhh', { timers: ONLINE_TIMERS, rules: { debug: true } });
    const first = d.deadline!;
    // A debug action does not change the phase: same key, same deadline
    d = act(d, { k: 'debugRig', dice: [[1, 2]] }, T0 + 5_000);
    expect(d.deadline).toEqual(first);
    // Rolling 3 lands on Maradana Lane: a buy decision, a new key, deadline = at + animation + decision time
    const at = T0 + 6_000;
    const before = d;
    d = act(d, { k: 'roll' }, at);
    expect(d.game.phase.k).toBe('buy');
    const rolled = apply(before.game, { by: turnSeat(before), a: { k: 'roll' } });
    if (!rolled.ok) throw new Error('roll refused');
    expect(d.deadline).toEqual({ key: timer(d.game)!.key, at: at + animBudget(rolled.events) + ONLINE_TIMERS.decision * 1000 });
    // Declining opens the auction; each bid restarts the clock and gives at least AUCTION_BID_SECS
    d = act(d, { k: 'decline' }, at + 1_000);
    expect(d.game.phase.k).toBe('auction');
    const auctionKey = d.deadline!.key;
    const bidder = (['s0', 's1', 's2'] as SeatId[]).find((s) => s !== turnSeat(d))!;
    const bidAt = at + 2_000;
    d = must(d, envelope({ by: bidder, a: { k: 'bid', amount: 42 } }, pidOf(d, bidder), bidAt));
    expect(d.deadline!.key).not.toBe(auctionKey);
    expect(d.deadline!.at).toBeGreaterThanOrEqual(bidAt + AUCTION_BID_SECS * 1000);
    expect(d.deadline!.at).toBe(bidAt + ONLINE_TIMERS.auction * 1000);
  });

  it('fixedAuctionCountdown: the auction deadline runs from the decline; bids never restart or extend it', () => {
    let d = makeDoc('hhh', { timers: ONLINE_TIMERS, rules: { debug: true, fixedAuctionCountdown: true } });
    d = act(d, { k: 'debugRig', dice: [[1, 2]] }, T0 + 5_000);
    d = act(d, { k: 'roll' }, T0 + 6_000);
    expect(d.game.phase.k).toBe('buy');
    const declineAt = T0 + 7_000;
    const pre = d;
    d = act(d, { k: 'decline' }, declineAt);
    expect(d.game.phase.k).toBe('auction');
    const declined = apply(pre.game, { by: turnSeat(pre), a: { k: 'decline' } });
    if (!declined.ok) throw new Error('decline refused');
    const auction = d.deadline!;
    expect(auction).toEqual({ key: timer(d.game)!.key, at: declineAt + animBudget(declined.events) + ONLINE_TIMERS.auction * 1000 });
    const bidders = (['s0', 's1', 's2'] as SeatId[]).filter((s) => s !== turnSeat(d));
    d = must(d, envelope({ by: bidders[0]!, a: { k: 'bid', amount: 42 } }, pidOf(d, bidders[0]!), declineAt + 2_000));
    expect(d.deadline).toEqual(auction);
    // A bid in the last moment adds no time either
    d = must(d, envelope({ by: bidders[1]!, a: { k: 'bid', amount: 43 } }, pidOf(d, bidders[1]!), auction.at - 100));
    expect(d.deadline).toEqual(auction);
  });
});

describe('verifyNext', () => {
  function played(): { prev: Doc; next: Doc } {
    const prev = makeDoc('hh', { rules: { debug: true } });
    let next = act(prev, { k: 'debugRig', dice: [[2, 3]] });
    next = act(next, { k: 'roll' });
    return { prev, next };
  }

  it('replays the new envelopes into one batch per seq with the engine events', () => {
    const { prev, next } = played();
    const v = verifyNext(prev, next);
    if (!('batches' in v)) throw new Error(JSON.stringify(v));
    expect(v.batches.map((b) => b.seq)).toEqual([1, 2]);
    expect(v.batches[1]!.state).toBe(next.game);
    expect(v.events.some((e) => e.t === 'move')).toBe(true);
  });

  it('flags a forged cash or rng value', () => {
    const { prev, next } = played();
    const cash = structuredClone(next);
    cash.game.players.s0!.cash += 500;
    expect(verifyNext(prev, cash)).toHaveProperty('tamper');
    const rng = structuredClone(next);
    rng.game.rng = (rng.game.rng + 1) >>> 0;
    expect(verifyNext(prev, rng)).toHaveProperty('tamper');
  });

  it('flags a move sent for someone else\'s seat', () => {
    const prev = makeDoc('hh', { rules: { debug: true } });
    const seat = turnSeat(prev);
    const r = apply(prev.game, { by: seat, a: { k: 'roll' } });
    if (!r.ok) throw new Error('roll refused');
    const forged: Doc = { ...prev, seq: 1, game: r.state, recent: [envelope({ by: seat, a: { k: 'roll' } }, 'p_MALLORY00001')] };
    expect(verifyNext(prev, forged)).toHaveProperty('tamper');
  });

  it('asks for a snap when the gap is larger than recent holds', () => {
    let d = makeDoc('hh', { rules: { debug: true } });
    const prev = d;
    for (let i = 0; i < RECENT_MAX + 1; i++) d = act(d, { k: 'debugSetCash', seat: 's0', cash: i });
    expect(verifyNext(prev, d)).toEqual({ gap: RECENT_MAX + 1 });
  });

  it('does not cry tamper over seats edited in a gap this client missed (bot played a seat, then taken back)', () => {
    const prev = makeDoc('hh', { rules: { debug: true } });
    const seat = turnSeat(prev);
    // The owner lets a bot play the seat (a seats-only edit bumps sv), the driver rolls for it, the player takes it back
    const away: Doc = { ...prev, seats: { ...prev.seats, [seat]: { ...prev.seats[seat]!, afk: true } }, sv: 1 };
    const rolled = must(away, envelope({ by: seat, a: { k: 'roll' }, basis: away.seq }, PIDS[1]));
    const back: Doc = { ...rolled, seats: { ...rolled.seats, [seat]: { ...rolled.seats[seat]!, afk: false } }, sv: 2 };
    const v = verifyNext(prev, back);
    expect(v).toHaveProperty('batches');
    // With no seat edit in between, the same move from someone else is still caught
    expect(verifyNext(prev, { ...back, sv: undefined })).toHaveProperty('tamper');
  });

  it('bumps the seat version when a move changes the seats (AFK on a second timeout)', () => {
    let d = makeDoc('hh', { timers: { ...ONLINE_TIMERS, turn: 1 } });
    const at = (x: Doc) => x.deadline!.at + 1;
    d = must(d, envelope(timeoutCommand(d.game)!, '', at(d)));
    expect(d.sv).toBeUndefined();
    d = must(d, envelope({ by: turnSeat(d), a: { k: 'endTurn' } }, pidOf(d, turnSeat(d))));
    d = must(d, envelope(timeoutCommand(d.game)!, '', at(d)));
    d = must(d, envelope({ by: turnSeat(d), a: { k: 'endTurn' } }, pidOf(d, turnSeat(d))));
    for (let i = 0; i < 4 && !(Object.values(d.seats).some((x) => x?.afk)); i++) d = must(d, envelope(timeoutCommand(d.game)!, '', at(d)));
    expect(Object.values(d.seats).some((x) => x?.afk)).toBe(true);
    expect(d.sv).toBe(1);
    expect(decodeDoc(encodeDoc(d)).sv).toBe(1);
  });

  it('accepts a seats-only change at the same seq, but not a rewritten game', () => {
    const prev = makeDoc('hh');
    const seats = structuredClone(prev);
    seats.seats.s1 = { ...seats.seats.s1!, afk: true };
    expect(verifyNext(prev, seats)).toEqual({ batches: [], events: [] });
    const game = structuredClone(prev);
    game.game.players.s1!.cash = 1;
    expect(verifyNext(prev, game)).toHaveProperty('tamper');
  });
});
