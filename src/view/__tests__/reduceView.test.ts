import { describe, expect, it } from 'vitest';
import {
  activeSeats,
  apply,
  awaiting,
  createGame,
  defaultAction,
  groupOf,
  legalActions,
  minBid,
  timeoutCommand,
  type Action,
  type Command,
  type GameState,
  type SeatId,
} from '../../rules';
import { reduceView } from '../reduceView';

/*
 * The drift test: folding reduceView over every event of many random engine games must give the engine's own state
 * for everything the view draws, after every single command (not just at the end of a batch).
 */

const SEATS: SeatId[] = ['s0', 's1', 's2', 's3', 's4', 's5'];

function rand(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(r: () => number, xs: readonly T[]): T | undefined => xs[Math.floor(r() * xs.length)];

/** Weighted towards buying and building, so games reach complete colour groups, shortages, debts and bankruptcies */
const WEIGHT: Partial<Record<Action['k'], number>> = { buy: 5, build: 6, mortgage: 0.6, unmortgage: 0.4, accept: 3 };

function weighted(r: () => number, xs: readonly Action[]): Action {
  const total = xs.reduce((a, x) => a + (WEIGHT[x.k] ?? 1), 0);
  let roll = r() * total;
  for (const x of xs) {
    roll -= WEIGHT[x.k] ?? 1;
    if (roll < 0) return x;
  }
  return xs[xs.length - 1] as Action;
}

/** A random swap of tradable property (and sometimes cash or a Get Out of Jail Free card) */
function offer(s: GameState, r: () => number, from: SeatId): Action | null {
  const to = pick(r, activeSeats(s).filter((x) => x !== from));
  if (!to) return null;
  const tradable = (seat: SeatId) =>
    Object.entries(s.props).flatMap(([key, p]) => {
      const space = Number(key.slice(1));
      if (p?.owner !== seat) return [];
      const g = groupOf(s, space);
      return g && g.spaces.some((x) => (s.props[`p${x}`]?.level ?? 0) > 0) ? [] : [space];
    });
  const give = tradable(from).filter(() => r() < 0.4);
  const get = tradable(to).filter(() => r() < 0.4);
  const cards = s.players[from]?.goojf.filter(() => r() < 0.5) ?? [];
  const cash = r() < 0.3 ? Math.floor(r() * 100) : 0;
  if (give.length + cards.length === 0 || get.length === 0) return null;
  return { k: 'propose', to, give: { cash, props: give, cards }, get: { cash: 0, props: get, cards: [] } };
}

function randomCommand(s: GameState, r: () => number): Command | null {
  if (s.phase.k === 'over') return null;
  const waiting = awaiting(s);
  if (r() < 0.04) {
    const t = timeoutCommand(s);
    if (t) return t;
  }
  const seat = (r() < 0.85 ? pick(r, waiting) : undefined) ?? pick(r, activeSeats(s));
  if (!seat) return null;
  if (r() < 0.04) {
    const o = offer(s, r, seat);
    if (o) return { by: seat, a: o };
  }
  const legal = legalActions(s, seat).filter((a) => a.k !== 'resign' || r() < 0.002);
  if (legal.length === 0) {
    const first = waiting[0];
    const d = first && defaultAction(s, first);
    return first && d ? { by: first, a: d } : null;
  }
  let a = weighted(r, legal);
  if (a.k === 'bid') a = { k: 'bid', amount: (minBid(s) ?? 1) + Math.floor(r() * 60) };
  return { by: seat, a };
}

/** Everything the scene and the HUD draw from the displayed state */
function drawn(s: GameState) {
  const players = Object.fromEntries(
    Object.entries(s.players).map(([seat, p]) => [
      seat,
      {
        cash: p?.cash,
        pos: p?.pos,
        jail: p?.jail?.tries ?? null,
        goojf: [...(p?.goojf ?? [])].sort(),
        speed: p?.speed,
        out: p?.out ?? null,
        hero: p?.hero ?? null,
        powerUsed: p?.powerUsed ?? null,
      },
    ]),
  );
  const props = Object.fromEntries(
    Object.entries(s.props)
      .filter(([, p]) => p)
      .map(([key, p]) => [key, { owner: p?.owner, level: p?.level, mortgaged: !!p?.mortgaged }]),
  );
  const over = s.phase.k === 'over' ? { why: s.phase.why, scores: s.phase.scores ?? null } : null;
  return { players, props, bank: s.bank, turn: { seat: s.turn.seat, no: s.turn.no }, over };
}

/** Event types seen, with the owner change's `via`, so the test can prove it covered the interesting ones */
const seen = new Set<string>();

function play(seed: number, cfg: Parameters<typeof createGame>[0], steps: number): { events: number; overs: number } {
  const r = rand(seed);
  const n = 2 + (seed % 5);
  let { state } = createGame(cfg, SEATS.slice(0, n).map((id) => ({ id, name: id })), seed);
  let view = state; // the first batch is a snap: the view starts at the state
  let events = 0;
  let overs = 0;
  for (let step = 0; step < steps; step++) {
    if (state.phase.k === 'over') {
      overs++;
      state = createGame(cfg, SEATS.slice(0, n).map((id) => ({ id, name: id })), seed * 1000 + step).state;
      view = state;
      continue;
    }
    const cmd = randomCommand(state, r);
    if (!cmd) break;
    const res = apply(state, cmd, { check: false });
    if (!res.ok) continue; // random offers may be refused
    for (const ev of res.events) {
      view = reduceView(view, ev);
      seen.add(ev.t === 'owner' ? `owner:${ev.via}` : ev.t === 'move' && ev.via === 'swap' ? 'move:swap' : ev.t);
    }
    events += res.events.length;
    state = res.state;
    const want = drawn(state);
    const got = drawn(view);
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      expect(got, `seed ${seed} step ${step} after ${JSON.stringify(cmd)}: ${JSON.stringify(res.events)}`).toEqual(want);
    }
    // At the end of a batch the director takes the batch's state, so the next command starts from it.
    view = state;
  }
  return { events, overs };
}

describe('reduceView drift', () => {
  it('matches the engine after every command of random classic games', () => {
    let events = 0;
    let overs = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const res = play(seed, { startCash: [1500, 500, 250][seed % 3], houses: seed % 2 ? 8 : 32, hotels: seed % 2 ? 3 : 12 }, 1200);
      events += res.events;
      overs += res.overs;
    }
    expect(events).toBeGreaterThan(8_000);
    expect(overs).toBeGreaterThan(0);
    for (const t of ['cash', 'move', 'jail', 'jailStay', 'jailExit', 'card', 'cardReturn', 'level', 'mortgage', 'bankrupt']) {
      expect(seen, t).toContain(t);
    }
    for (const via of ['buy', 'auction', 'trade', 'bankrupt']) expect(seen, via).toContain(`owner:${via}`);
  });

  it('matches the engine with the Speed Die', () => {
    let events = 0;
    for (let seed = 101; seed <= 108; seed++) events += play(seed, { speedDie: true, startCash: [1500, 400][seed % 2] }, 1200).events;
    expect(events).toBeGreaterThan(5_000);
    expect(seen).toContain('speedOn');
  });

  it('matches the engine on Hero League: superpowers used and ready again, swaps, saves, the score at the end', () => {
    let events = 0;
    let overs = 0;
    for (let seed = 201; seed <= 212; seed++) {
      const res = play(seed, { board: 'heroes', startCash: [1500, 600][seed % 2] }, 1500);
      events += res.events;
      overs += res.overs;
    }
    expect(events).toBeGreaterThan(8_000);
    expect(overs).toBeGreaterThan(0);
    for (const t of ['heroDie', 'power', 'powerReady', 'aimPeek', 'move:swap', 'short', 'noSave', 'jail', 'jailExit']) expect(seen, t).toContain(t);
    for (const via of ['buy', 'backup', 'free', 'villain']) expect(seen, via).toContain(`owner:${via}`);
  });

  it('marks a superpower used in the turn it is used, and ready again', () => {
    const { state } = createGame({ board: 'heroes' }, [{ id: 's0', name: 'A' }, { id: 's1', name: 'B' }], 7);
    const g = { ...state, turn: { ...state.turn, no: 4 } };
    const used = reduceView(g, { t: 'power', seat: 's1', power: 'thunder', target: 's0' });
    expect(used.players.s1?.powerUsed).toBe(4);
    expect(used.players.s0).toBe(g.players.s0);
    const ready = reduceView(used, { t: 'powerReady', seat: 's1' });
    expect(ready.players.s1?.powerUsed).toBeUndefined();
    expect('powerUsed' in (ready.players.s1 ?? {})).toBe(false);
    expect(reduceView(ready, { t: 'powerReady', seat: 's1' })).toBe(ready);
    // The Hero die and the events that only say something leave the state alone
    expect(reduceView(g, { t: 'heroDie', seat: 's0', face: 2, hero: 'starCaptain', purpose: 'card' })).toBe(g);
    expect(reduceView(g, { t: 'noSave', seat: 's0', space: 4 })).toBe(g);
  });

  it('keeps the identity of what an event does not touch', () => {
    const { state } = createGame({}, [{ id: 's0', name: 'A' }, { id: 's1', name: 'B' }], 7);
    const next = reduceView(state, { t: 'move', seat: 's0', from: 0, to: 5, path: [1, 2, 3, 4, 5], via: 'dice' });
    expect(next).not.toBe(state);
    expect(next.players.s0?.pos).toBe(5);
    expect(next.players.s1).toBe(state.players.s1);
    expect(next.props).toBe(state.props);
    expect(state.players.s0?.pos).toBe(0);
    expect(reduceView(state, { t: 'bid', seat: 's0', amount: 10 })).toBe(state);
  });
});
