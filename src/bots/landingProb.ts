import type { BoardDef } from '../rules';

/*
 * Where tokens land in the long run: the steady state of a Markov chain with one transition per throw of the white
 * dice. Chain states are (space, doubles thrown so far this turn) plus three jail states (failed tries so far). It
 * includes Go To Jail, three doubles, the jail rules and the card moves of both decks (each card equally likely).
 * The Speed Die is ignored: it mostly speeds tokens up without changing where they come to rest much.
 *
 * Two jail strategies give two chains (leave at once by paying, or stay and roll for doubles); the table is their
 * average, since bots leave early in the opening and stay later. Computed once per board, on first use (~5 ms).
 */

export interface LandingTable {
  /** Chance that one throw ends on each space (a jail stay is not a landing) */
  perRoll: number[];
  /** Expected landings per turn on each space, counting every throw of the turn */
  perTurn: number[];
  /** Expected throws per turn */
  rollsPerTurn: number;
}

const JAIL = -1;
/** [space or JAIL, probability] */
type Outcome = [number, number];

interface Edge {
  to: number;
  p: number;
  /** The space the throw came to rest on, or -1 (sent to jail / stayed in jail) */
  land: number;
  /** The throw ends the turn */
  ends: boolean;
}

function nearest(b: BoardDef, from: number, kind: 'rail' | 'utility'): number {
  const n = b.spaces.length;
  for (let i = 1; i <= n; i++) if (b.spaces[(from + i) % n]?.k === kind) return (from + i) % n;
  return from;
}

/** Where a token that arrives on `t` comes to rest, following Go To Jail and card moves */
function resolve(b: BoardDef, t: number, depth = 0): Outcome[] {
  const n = b.spaces.length;
  const sp = b.spaces[t];
  if (t === b.goToJailIndex) return [[JAIL, 1]];
  if (depth > 2 || (sp?.k !== 'chance' && sp?.k !== 'chest')) return [[t, 1]];
  const deck = sp.k === 'chance' ? b.chance : b.chest;
  const out: Outcome[] = [];
  const each = 1 / deck.length;
  for (const card of deck) {
    const fx = card.fx;
    const next =
      fx.k === 'advance' ? resolve(b, fx.to, depth + 1)
      : fx.k === 'nearest' ? resolve(b, nearest(b, t, fx.kind), depth + 1)
      : fx.k === 'back' ? resolve(b, (((t - fx.n) % n) + n) % n, depth + 1)
      : fx.k === 'jail' ? [[JAIL, 1] as Outcome]
      : [[t, 1] as Outcome];
    for (const [q, p] of next) out.push([q, p * each]);
  }
  return out;
}

function buildChain(b: BoardDef, stay: boolean): Edge[][] {
  const n = b.spaces.length;
  const rest = Array.from({ length: n }, (_, t) => resolve(b, t));
  const idx = (pos: number, d: number): number => pos * 3 + d;
  const jailState = (tries: number): number => n * 3 + tries;
  const edges: Edge[][] = Array.from({ length: n * 3 + 3 }, () => []);
  const throwFrom = (pos: number, d: number, out: Edge[]): void => {
    for (let a = 1; a <= 6; a++) {
      for (let c = 1; c <= 6; c++) {
        const p = 1 / 36;
        const dbl = a === c;
        if (dbl && d === 2) {
          out.push({ to: jailState(0), p, land: -1, ends: true });
          continue;
        }
        for (const [q, pq] of rest[(pos + a + c) % n] as Outcome[]) {
          if (q === JAIL) out.push({ to: jailState(0), p: p * pq, land: -1, ends: true });
          else if (dbl) out.push({ to: idx(q, d + 1), p: p * pq, land: q, ends: false });
          else out.push({ to: idx(q, 0), p: p * pq, land: q, ends: true });
        }
      }
    }
  };
  for (let pos = 0; pos < n; pos++) for (let d = 0; d < 3; d++) throwFrom(pos, d, edges[idx(pos, d)] as Edge[]);
  for (let tries = 0; tries < 3; tries++) {
    const out = edges[jailState(tries)] as Edge[];
    if (!stay) {
      // Pay the fine and throw as from Just Visiting (doubles roll again)
      throwFrom(b.jailIndex, 0, out);
      continue;
    }
    for (let a = 1; a <= 6; a++) {
      for (let c = 1; c <= 6; c++) {
        const p = 1 / 36;
        if (a !== c && tries < 2) {
          out.push({ to: jailState(tries + 1), p, land: -1, ends: true });
          continue;
        }
        // Doubles free the player (no extra throw); the third failure pays and moves anyway
        for (const [q, pq] of rest[(b.jailIndex + a + c) % n] as Outcome[]) {
          if (q === JAIL) out.push({ to: jailState(0), p: p * pq, land: -1, ends: true });
          else out.push({ to: idx(q, 0), p: p * pq, land: q, ends: true });
        }
      }
    }
  }
  return edges;
}

/** Merges parallel edges (many throws lead to the same state) so the power iteration stays cheap */
function merge(list: Edge[]): Edge[] {
  const byKey = new Map<number, Edge>();
  for (const e of list) {
    const key = (e.to * 64 + e.land + 1) * 2 + (e.ends ? 1 : 0);
    const hit = byKey.get(key);
    if (hit) hit.p += e.p;
    else byKey.set(key, { ...e });
  }
  return [...byKey.values()];
}

function solve(b: BoardDef, stay: boolean): LandingTable {
  const n = b.spaces.length;
  const edges = buildChain(b, stay).map(merge);
  const from: number[] = [];
  const to: number[] = [];
  const prob: number[] = [];
  edges.forEach((list, i) => {
    for (const e of list) {
      from.push(i);
      to.push(e.to);
      prob.push(e.p);
    }
  });
  const src = Int32Array.from(from);
  const dst = Int32Array.from(to);
  const pr = Float64Array.from(prob);
  let pi = new Float64Array(edges.length).fill(1 / edges.length);
  let next = new Float64Array(edges.length);
  for (let iter = 0; iter < 1000; iter++) {
    next.fill(0);
    for (let k = 0; k < pr.length; k++) next[dst[k] as number]! += (pi[src[k] as number] as number) * (pr[k] as number);
    let delta = 0;
    for (let i = 0; i < next.length; i++) delta += Math.abs((next[i] as number) - (pi[i] as number));
    [pi, next] = [next, pi];
    if (delta < 1e-12) break;
  }
  const perRoll = new Array<number>(n).fill(0);
  let ends = 0;
  edges.forEach((list, i) => {
    const w = pi[i] as number;
    for (const e of list) {
      if (e.land >= 0) perRoll[e.land] = (perRoll[e.land] as number) + w * e.p;
      if (e.ends) ends += w * e.p;
    }
  });
  const rollsPerTurn = 1 / ends;
  return { perRoll, perTurn: perRoll.map((p) => p * rollsPerTurn), rollsPerTurn };
}

const cache = new Map<string, LandingTable>();

/** The landing table for a board (memoized per board id) */
export function landingTable(b: BoardDef): LandingTable {
  const hit = cache.get(b.id);
  if (hit) return hit;
  const leave = solve(b, false);
  const stay = solve(b, true);
  const avg = (x: number[], y: number[]): number[] => x.map((v, i) => (v + (y[i] as number)) / 2);
  const table: LandingTable = {
    perRoll: avg(leave.perRoll, stay.perRoll),
    perTurn: avg(leave.perTurn, stay.perTurn),
    rollsPerTurn: (leave.rollsPerTurn + stay.rollsPerTurn) / 2,
  };
  cache.set(b.id, table);
  return table;
}

/** Chance that two dice total d (2-12), ignoring doubles */
export const twoDice = (d: number): number => (d < 2 || d > 12 ? 0 : (6 - Math.abs(d - 7)) / 36);
