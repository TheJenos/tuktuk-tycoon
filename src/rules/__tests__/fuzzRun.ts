import { expect } from 'vitest';
import {
  apply,
  awaiting,
  createGame,
  decode,
  deepEqual,
  defaultAction,
  encode,
  legalActions,
  timer,
} from '..';
import { randFrom, randomCommand } from '../randomPlayer';
import type { GameEvent, GameState, SeatId } from '../types';
import { SEATS } from './helpers';

/*
 * The fuzz driver shared by fuzz.test.ts (classic) and fuzzSpeed.test.ts (Speed Die), split so they run in parallel.
 * Each seed plays random commands for STEPS steps (starting a new game whenever one ends) and checks after each that
 * the command applied, invariants hold, the cash ledger matches the events, the RNG moved only with dice, the state
 * stays small and round-trips through the codec, someone is awaited, and the default move is legal.
 */

const STEPS = 3000;
export const SEEDS = 30;
const MAX_BYTES = 48 * 1024;

/** 2-6 players; low starting cash and a scarce bank in some games, so debts, bankruptcies and shortages happen */
function newGame(seed: number, speedDie: boolean): GameState {
  const r = randFrom(seed * 7919);
  const n = 2 + Math.floor(r() * 5);
  const seats = SEATS.slice(0, n).map((id, i) => ({ id, name: `Bot ${i}` }));
  const scarce = seed % 2 === 1;
  const cfg = {
    speedDie,
    startCash: [1500, 600, 300][seed % 3],
    houses: scarce ? 6 : 32,
    hotels: scarce ? 2 : 12,
  };
  return createGame(cfg, seats, seed).state;
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
  return null;
}

export function fuzz(seed: number, speedDie: boolean): { games: number; overs: number } {
  const r = randFrom(seed);
  let s = newGame(seed, speedDie);
  let games = 1;
  let overs = 0;
  for (let step = 0; step < STEPS; step++) {
    if (s.phase.k === 'over') {
      overs++;
      games++;
      s = newGame(seed * 1000 + games, speedDie);
      continue;
    }
    const waiting = awaiting(s);
    expect(waiting.length, `awaiting is empty in ${s.phase.k}`).toBeGreaterThan(0);
    expect(timer(s)).not.toBeNull();
    const first = waiting[0] as SeatId;
    const d = defaultAction(s, first);
    expect(d, `no default for ${first} in ${s.phase.k}`).not.toBeNull();
    const legal = legalActions(s, first);
    expect(legal.some((a) => deepEqual(a, d)), `default ${JSON.stringify(d)} not legal in ${s.phase.k}`).toBe(true);

    const cmd = randomCommand(s, r);
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
      expect(res.events.some((e) => e.t === 'dice'), `rng moved without dice: ${cmd.a.k}`).toBe(true);
    }
    const text = encode(next);
    expect(text.length).toBeLessThan(MAX_BYTES);
    if (step % 10 === 0) expect(decode(text)).toEqual(next);
    s = next;
  }
  return { games, overs };
}
