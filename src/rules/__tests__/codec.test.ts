import { describe, expect, it } from 'vitest';
import { RULES_VERSION, apply, createGame, decode, encode } from '..';
import { randFrom, randomCommand } from '../randomPlayer';
import type { Command, GameState } from '../types';
import { SEATS, act, own, rig, scenario } from './helpers';

describe('codec', () => {
  it('round-trips a new game, a busy mid-game state and a finished one', () => {
    const fresh = scenario();
    expect(decode(encode(fresh))).toEqual(fresh);

    const mid = scenario({ n: 3, cfg: { speedDie: true } });
    own(mid, 's1', [12, 28], { mortgaged: true });
    mid.players.s2!.goojf = ['cc-goojf'];
    mid.decks.chest = mid.decks.chest.filter((id) => id !== 'cc-goojf');
    const offer = act(mid, 's1', { k: 'propose', to: 's2', give: { cash: 0, props: [12], cards: [] }, get: { cash: 20, props: [], cards: [] } }).state;
    rig(offer, [2, 4]);
    const buying = act(offer, 's0', { k: 'roll' }).state;
    expect(buying.pending.length).toBeGreaterThan(0);
    expect(decode(encode(buying))).toEqual(buying);

    const over = act(scenario(), 'system', { k: 'endGame' }, 0).state;
    expect(decode(encode(over))).toEqual(over);
  });

  it('refuses garbage and other versions, and fills in missing containers', () => {
    expect(() => decode('null')).toThrow();
    expect(() => decode('{"x":1}')).toThrow();
    const s = scenario();
    expect(() => decode(encode({ ...s, v: RULES_VERSION + 1 }))).toThrow(/version/);
    const bare = JSON.parse(encode(s)) as Partial<GameState>;
    delete bare.trades;
    delete bare.pending;
    delete bare.rig;
    const back = decode(JSON.stringify(bare));
    expect(back.trades).toEqual({});
    expect(back.pending).toEqual([]);
    expect(back.rig).toEqual([]);
  });
});

describe('determinism', () => {
  it('the same seed gives the same game; the opening roll picks who starts and keeps seat order', () => {
    const seats = SEATS.slice(0, 4).map((id, i) => ({ id, name: `P${i}` }));
    const a = createGame({}, seats, 77);
    expect(createGame({}, seats, 77)).toEqual(a);
    expect(createGame({}, seats, 78).state.decks).not.toEqual(a.state.decks);
    const order = a.state.order;
    const first = seats.findIndex((x) => x.id === order[0]);
    expect(order).toEqual([...seats.slice(first), ...seats.slice(0, first)].map((x) => x.id));
    const rolls = a.events.filter((e) => e.t === 'dice');
    expect(rolls.length).toBeGreaterThanOrEqual(4);
    expect(a.events.at(-1)).toEqual({ t: 'turn', seat: order[0], no: 1 });
  });

  it('replaying the command log reproduces the same state and events', () => {
    const seats = SEATS.slice(0, 3).map((id, i) => ({ id, name: `P${i}` }));
    const start = createGame({ speedDie: true }, seats, 5).state;
    const r = randFrom(99);
    const log: Command[] = [];
    let s = start;
    for (let i = 0; i < 1500 && s.phase.k !== 'over'; i++) {
      const cmd = randomCommand(s, r);
      if (!cmd) break;
      const res = apply(s, cmd);
      if (!res.ok) continue;
      log.push(cmd);
      s = res.state;
    }
    let replay = start;
    for (const cmd of log) {
      const res = apply(replay, cmd);
      if (!res.ok) throw new Error(res.error.message);
      replay = res.state;
    }
    expect(encode(replay)).toBe(encode(s));
  });

  it('refuses bad seat lists', () => {
    expect(() => createGame({}, [{ id: 's0', name: 'A' }], 1)).toThrow();
    expect(() => createGame({}, [{ id: 's0', name: 'A' }, { id: 's0', name: 'B' }], 1)).toThrow();
  });
});
