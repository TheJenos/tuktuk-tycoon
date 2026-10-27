import { expect } from 'vitest';
import {
  apply,
  awaiting,
  createGame,
  decode,
  deepEqual,
  defaultAction,
  encode,
  HEROES,
  HEROES_FIXED,
  legalActions,
  owedTotal,
  timer,
} from '..';
import { isWindow } from '../react';
import { type RandomOpts, randFrom, randomCommand, variedRules } from '../randomPlayer';
import type { Command, GameEvent, GameState, SeatId } from '../types';
import { SEATS } from './helpers';
import { LOCATIONS } from './heroesHelpers';

/*
 * The fuzz driver shared by fuzz.test.ts (classic), fuzzSpeed.test.ts (Speed Die) and heroesFuzz.test.ts (Hero
 * League), split so they run in parallel. Each seed plays random commands for STEPS steps (starting a new game
 * whenever one ends) and checks after each that the command applied, invariants hold, the cash ledger matches the
 * events, the RNG moved only with dice (or the Hero die), the state stays small and round-trips through the codec,
 * someone is awaited, and the default move is legal; on Hero League also heroesChecks and heroesProblems.
 */

const STEPS = 3000;
export const SEEDS = 30;
const MAX_BYTES = 48 * 1024;

/**
 * 2-6 players; low starting cash and a scarce bank in some games, so debts, bankruptcies and shortages happen. Two
 * games in three also vary the optional rules (jackpot, auctions off, first lap, quick deal, end mode, trading...).
 */
function newGame(seed: number, speedDie: boolean, board: string): GameState {
  if (board === 'heroes') return newHeroesGame(seed);
  const r = randFrom(seed * 7919);
  const n = 2 + Math.floor(r() * 5);
  const seats = SEATS.slice(0, n).map((id, i) => ({ id, name: `Bot ${i}` }));
  const scarce = seed % 2 === 1;
  const cfg = {
    ...(seed % 3 === 0 ? {} : variedRules(seed)),
    speedDie,
    startCash: [1500, 600, 300][seed % 3],
    houses: scarce ? 6 : 32,
    hotels: scarce ? 2 : 12,
  };
  return createGame(cfg, seats, seed).state;
}

/** A hero requested by id now and then (sometimes taken twice, sometimes unknown) */
const HERO_REQUESTS = [...(HEROES.heroes?.list ?? []).map((h) => h.id), 'tuktuk', ''];

/**
 * Hero League: 2-6 seats asking for random heroes (repeats and unknown ids included: createGame sorts them out),
 * 1500 to start in half the games, 600 or 300 in the rest, and the classic options varied in some games (the pinned
 * ones must not leak through)
 */
function newHeroesGame(seed: number): GameState {
  const r = randFrom(seed * 6563 + 1);
  const n = 2 + Math.floor(r() * 5);
  const seats = SEATS.slice(0, n).map((id, i) => {
    const hero = r() < 0.6 ? HERO_REQUESTS[Math.floor(r() * HERO_REQUESTS.length)] : undefined;
    return { id, name: `Hero ${i}`, ...(hero === undefined ? {} : { hero }) };
  });
  const startCash = [1500, 600, 1500, 300][seed % 4];
  const cfg = { ...(seed % 3 === 0 ? variedRules(seed) : {}), board: 'heroes', startCash };
  return createGame(cfg, seats, seed).state;
}

/** Hero League's random play: resignations inside windows; odd seeds resign there and time out twice as often */
const heroesRandom = (seed: number): RandomOpts =>
  seed % 2 ? { windowResign: 0.02, timeout: 0.1 } : { windowResign: 0.01 };

/**
 * Hero League after every command: nobody owes (no debt) and nobody went bankrupt, a seat's cash only falls below a
 * payment through a `short` event, every window answer names the window it answers, the config stays pinned, and
 * heroesProblems finds nothing
 */
function heroesChecks(prev: GameState, cmd: Command, next: GameState, events: GameEvent[]): void {
  expect(next.phase.k).not.toBe('debt');
  for (const e of events) {
    if (e.t === 'bankrupt') expect(e.resigned, 'a bankruptcy on Hero League').toBe(true);
    if (e.t === 'short') expect(owedTotal(e.paid)).toBeLessThan(owedTotal(e.owed));
  }
  expect(next.cfg).toMatchObject(HEROES_FIXED);
  for (const seat of next.order) expect(next.players[seat]?.hero, `${seat} has no hero`).toBeDefined();
  // A stale answer (the window before) is always refused
  if (isWindow(next.phase) && next.since !== prev.since) {
    const seat = awaiting(next)[0] as SeatId;
    const stale = apply(next, { by: seat, a: { k: 'pass', at: prev.since } }, { check: false });
    expect(stale.ok ? 'ok' : stale.error.code).toBe('stale');
  }
  expect(heroesProblems(prev, cmd, next, events), JSON.stringify(cmd)).toEqual([]);
}

const CHANCE = HEROES.chance.map((c) => c.id).sort();
const CHEST = HEROES.chest.map((c) => c.id).sort();

/**
 * What else must hold on Hero League after a command (empty = all good): decks whole, no silent or jailed moves,
 * superpowers spent and readied in step, scores, the end, and every resting window worth answering, right after a
 * resignation too (tagged `afterResign:`)
 */
function heroesProblems(prev: GameState, cmd: Command, next: GameState, events: GameEvent[]): string[] {
  const out: string[] = [];
  const bad = (k: string, d: string): void => void out.push(`${k}: ${d}`);
  if ([...next.decks.chance].sort().join() !== CHANCE.join()) bad('deck', `chance deck ${next.decks.chance.length}`);
  if ([...next.decks.chest].sort().join() !== CHEST.join()) bad('deck', `chest deck ${next.decks.chest.length}`);
  const jailed = new Set(next.order.filter((x) => prev.players[x]?.jail));
  const posNow: Partial<Record<SeatId, number>> = {};
  for (const x of next.order) posNow[x] = prev.players[x]?.pos;
  let turnSeat = prev.turn.seat;
  for (const e of events) {
    if (e.t === 'jail') jailed.add(e.seat);
    if (e.t === 'jailExit') jailed.delete(e.seat);
    if (e.t === 'turn') turnSeat = e.seat;
    if (e.t === 'move') {
      if (e.via !== 'jail' && jailed.has(e.seat)) bad('jailedMoves', `${e.seat} ${e.via} while jailed`);
      if (e.via === 'dice' && e.seat !== turnSeat) bad('diceOutOfTurn', `${e.seat}`);
      if (posNow[e.seat] !== e.from) bad('moveFrom', `${e.seat} from ${e.from} but was at ${posNow[e.seat]}`);
      posNow[e.seat] = e.to;
    }
    if (e.t === 'land' && jailed.has(e.seat)) bad('jailedLands', `${e.seat}`);
    if (e.t === 'heroDie' && !(e.face >= 1 && e.face <= 6)) bad('face', `${e.face}`);
    if (e.t === 'powerReady' && prev.players[e.seat]?.powerUsed === undefined && !events.some((x) => x.t === 'power' && x.seat === e.seat)) {
      bad('readyNotUsed', e.seat);
    }
  }
  for (const x of next.order) {
    if (!next.players[x]?.out && posNow[x] !== next.players[x]?.pos) bad('silentMove', `${x}`);
    const p = next.players[x];
    if (p?.jail && p.pos !== HEROES.jailIndex) bad('jailPos', x);
  }
  for (const e of events) {
    if (e.t !== 'power') continue;
    const ready = events.some((y) => y.t === 'powerReady' && y.seat === e.seat);
    if (!ready && next.players[e.seat]?.powerUsed === undefined && !next.players[e.seat]?.out) bad('powerNotSpent', e.seat);
  }
  if (next.turn.seat !== prev.turn.seat && !events.some((e) => e.t === 'turn')) bad('turnSilent', '');
  const all = LOCATIONS.every((space) => next.props[`p${space}`]);
  if (all && next.phase.k !== 'over') bad('allOwnedNotOver', next.phase.k);
  if (next.phase.k === 'over' && next.phase.why === 'allSaved' && !all) bad('allSavedNotAll', '');
  // Windows worth opening, also right after a resignation (tagged, to tell the two apart)
  const ph = next.phase;
  const tag = cmd.a.k === 'resign' ? 'afterResign:' : '';
  if (ph.k === 'react' && ph.kind === 'thunder') {
    if (!ph.open.some((x) => legalActions(next, x).some((a) => a.k === 'reroll'))) bad(`${tag}deadThunder`, JSON.stringify(ph.about));
    if (ph.about.k === 'move' && (!next.turn.roll || ph.seat !== next.turn.seat)) bad('moveWindow', '');
  }
  if (ph.k === 'react' && ph.kind === 'shield' && !legalActions(next, ph.seat).some((a) => a.k === 'shield')) {
    bad(`${tag}deadShield`, JSON.stringify(ph.about));
  }
  if (ph.k === 'boost' && !legalActions(next, ph.seat).some((a) => a.k === 'sting')) bad(`${tag}deadBoost`, '');
  if (ph.k === 'aim' && !ph.cards && !legalActions(next, ph.seat).some((a) => a.k === 'aim')) bad(`${tag}deadAim`, '');
  if (ph.k === 'over' && ph.scores) {
    for (const x of next.order) {
      const want = (next.players[x]?.cash ?? 0) + 100 * LOCATIONS.filter((sp) => next.props[`p${sp}`]?.owner === x).length;
      if (ph.scores[x] !== want) bad('score', x);
    }
  }
  // The turn seat jailed: the turn cannot go on rolling
  if (next.phase.k === 'preRoll' && next.players[next.turn.seat]?.jail) bad('jailedPreRoll', '');
  if (awaiting(next).length === 0 && next.phase.k !== 'over') bad('noneAwaited', next.phase.k);
  return out;
}

/** Counts what a Hero League command reached (HeroesLog.seen) */
function countSeen(seen: Record<string, number>, cmd: Command, next: GameState, events: GameEvent[]): void {
  const add = (k: string): void => void (seen[k] = (seen[k] ?? 0) + 1);
  const ph = next.phase;
  add(ph.k === 'react' ? `react:${ph.kind}:${ph.about.k}` : ph.k);
  for (const e of events) add(`ev:${e.t}`);
  if (ph.k === 'over') add(`over:${ph.why}`);
  if (cmd.a.k === 'resign' && isWindow(ph)) add(`afterResign:${ph.k}`);
}

function ledgerOk(prev: GameState, next: GameState, events: GameEvent[]): string | null {
  const delta: Partial<Record<SeatId, number>> = {};
  for (const e of events) {
    if (e.t !== 'cash') continue;
    if (e.from !== 'bank') delta[e.from] = (delta[e.from] ?? 0) - e.amount;
    if (e.to !== 'bank') delta[e.to] = (delta[e.to] ?? 0) + e.amount;
  }
  for (const seat of next.order) {
    const want = (next.players[seat]?.cash ?? 0) - (prev.players[seat]?.cash ?? 0);
    if ((delta[seat] ?? 0) !== want) return `${seat} cash moved ${want} but events say ${delta[seat] ?? 0}`;
  }
  // The jackpot: taxes, fines and card payments to the bank go in, a win empties it
  let pot = 0;
  for (const e of events) {
    if (e.t !== 'cash') continue;
    if (next.cfg.jackpot && e.to === 'bank' && e.from !== 'bank' && ['tax', 'fine', 'card'].includes(e.why)) pot += e.amount;
    if (e.why === 'jackpot') pot -= e.amount;
  }
  if (next.pot - prev.pot !== pot) return `pot moved ${next.pot - prev.pot} but events say ${pot}`;
  return null;
}

/** Hero League runs: how its games ended, and how often each phase and event came up */
export interface HeroesLog {
  whys: string[];
  /** Resting phases (`react:<kind>:<about>`, `aim`, `boost`...), `ev:<event>`, `over:<why>`, `afterResign:<window>` */
  seen: Record<string, number>;
}

export function fuzz(seed: number, speedDie: boolean, board = 'lanka', log?: HeroesLog): { games: number; overs: number } {
  const r = randFrom(seed);
  const heroes = board === 'heroes';
  let s = newGame(seed, speedDie, board);
  let games = 1;
  let overs = 0;
  for (let step = 0; step < STEPS; step++) {
    if (s.phase.k === 'over') {
      overs++;
      games++;
      if (log) log.whys.push(s.phase.why);
      s = newGame(seed * 1000 + games, speedDie, board);
      continue;
    }
    const waiting = awaiting(s);
    expect(waiting.length, `awaiting is empty in ${s.phase.k}`).toBeGreaterThan(0);
    expect(timer(s)).not.toBeNull();
    if (s.phase.k === 'react') expect(timer(s)?.kind).toBe('reaction');
    const first = waiting[0] as SeatId;
    const d = defaultAction(s, first);
    expect(d, `no default for ${first} in ${s.phase.k}`).not.toBeNull();
    const legal = legalActions(s, first);
    expect(legal.some((a) => deepEqual(a, d)), `default ${JSON.stringify(d)} not legal in ${s.phase.k}`).toBe(true);

    const cmd = randomCommand(s, r, heroes ? heroesRandom(seed) : {});
    if (!cmd) throw new Error(`no command in ${s.phase.k}`);
    const res = apply(s, cmd, { check: true });
    if (!res.ok) {
      // Only random trade offers may be refused; anything taken from legalActions/defaults/timeouts must apply.
      if (cmd.a.k === 'propose') continue;
      const dbg = apply(s, cmd, { check: false });
      const lines = [
        `seed ${seed} step ${step}: ${JSON.stringify(cmd)} -> ${res.error.code}: ${res.error.message}`,
        `before: ${JSON.stringify({ phase: s.phase, pending: s.pending, turn: s.turn })}`,
        dbg.ok ? `after: ${JSON.stringify({ phase: dbg.state.phase, pending: dbg.state.pending, turn: dbg.state.turn })}` : '',
        dbg.ok ? `events: ${JSON.stringify(dbg.events)}` : '',
      ];
      throw new Error(lines.join('\n'));
    }
    const next = res.state;
    // apply() with check: true has already run checkInvariants.
    expect(next.seq).toBe(s.seq + 1);
    const ledger = ledgerOk(s, next, res.events);
    if (ledger) throw new Error(`seed ${seed} step ${step} ${JSON.stringify(cmd)}: ${ledger}`);
    if (next.rng !== s.rng) {
      expect(res.events.some((e) => e.t === 'dice' || e.t === 'heroDie'), `rng moved without dice: ${cmd.a.k}`).toBe(true);
    }
    if (heroes) {
      heroesChecks(s, cmd, next, res.events);
      if (log) countSeen(log.seen, cmd, next, res.events);
    }
    const text = encode(next);
    expect(text.length).toBeLessThan(MAX_BYTES);
    if (step % 10 === 0) expect(decode(text)).toEqual(next);
    s = next;
  }
  return { games, overs };
}
