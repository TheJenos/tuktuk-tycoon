import { describe, expect, it } from 'vitest';
import { apply, createGame, type Action, type GameEvent, type GameState, type SeatId } from '../../rules';
import { ANIM } from '../../shared/timing';
import { handlerFor, moveMode, type PlayCtx } from '../handlers';
import { NO_SAVE_LABEL, powerLabel, readyLabel, shortLabel } from '../labels';
import type { SceneApis } from '../types';

/** A Hero League game, s0 to roll first; seat i plays heroes[i] */
function heroGame(heroes: string[]): GameState {
  const seats = heroes.map((hero, i) => ({ id: `s${i}` as SeatId, name: `P${i}`, hero }));
  const { state } = createGame({ board: 'heroes', debug: true }, seats, 1);
  state.order = seats.map((s) => s.id);
  state.turn = { seat: 's0', no: 1, doubles: 0, again: false };
  return state;
}

function run(s: GameState, seat: SeatId, a: Action): { state: GameState; events: GameEvent[] } {
  const r = apply(s, { by: seat, a }, { check: false });
  if (!r.ok) throw new Error(`${a.k}: ${r.error.message}`);
  return { state: r.state, events: r.events };
}

const ctxFor = (apis: Partial<SceneApis>, game: GameState | null, events: GameEvent[] = [], index = 0): PlayCtx => ({
  apis,
  signal: new AbortController().signal,
  speed: 2,
  seed: 77,
  game,
  events,
  index,
});

describe('handlers', () => {
  it('moves by walking, backwards, a jump into jail, and a leap for a Titan Smash swap', () => {
    expect(moveMode('dice')).toBe('walk');
    expect(moveMode('card')).toBe('walk');
    expect(moveMode('triple')).toBe('walk');
    expect(moveMode('back')).toBe('back');
    expect(moveMode('jail')).toBe('jump');
    expect(moveMode('swap')).toBe('leap');
    const modes: string[] = [];
    const tokens: SceneApis['tokens'] = { move: (_s, _p, mode) => (modes.push(mode), Promise.resolve()) };
    const ev: Extract<GameEvent, { t: 'move' }> = { t: 'move', seat: 's1', from: 3, to: 17, path: [17], via: 'swap' };
    void handlerFor(ev)?.before?.(ev, ctxFor({ tokens }, null));
    expect(modes).toEqual(['leap']);
  });

  it('throws the Hero die on its own, with the event seed', async () => {
    const ev: Extract<GameEvent, { t: 'heroDie' }> = { t: 'heroDie', seat: 's0', face: 4, hero: 'stormLord', purpose: 'backup' };
    const thrown: [number, number | undefined][] = [];
    const dice: SceneApis['dice'] = {
      roll: () => Promise.resolve(),
      hero: (e, _signal, speed, seed) => (thrown.push([e.face, seed]), expect(speed).toBe(2), Promise.resolve()),
    };
    await handlerFor(ev)?.before?.(ev, ctxFor({ dice }, null));
    expect(thrown).toEqual([[4, 77]]);
    // A scene without a Hero die (or none at all) plays it at once
    expect(handlerFor(ev)?.before?.(ev, ctxFor({ dice: { roll: () => Promise.resolve() } }, null))).toBeUndefined();
    expect(handlerFor(ev)?.before?.(ev, ctxFor({}, null))).toBeUndefined();
  });

  it('says a superpower over its token and holds the queue for it', async () => {
    const said: string[] = [];
    const fx: SceneApis['fx'] = { money: () => {}, say: (seat, text) => void said.push(`${seat}:${text}`) };
    const ev: Extract<GameEvent, { t: 'power' }> = { t: 'power', seat: 's2', power: 'thunder', target: 's0' };
    const t0 = Date.now();
    await handlerFor(ev)?.before?.(ev, ctxFor({ fx }, null));
    expect(said).toEqual(['s2:Re-roll!']);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(ANIM.power / 2 - 20);
    // DOM only: nothing to say, nothing to wait for
    expect(handlerFor(ev)?.before?.(ev, ctxFor({ fx: { money: () => {} } }, null))).toBeUndefined();
    const game = heroGame(['stormLord', 'sharpshot']);
    const ready: GameEvent = { t: 'powerReady', seat: 's0' };
    void handlerFor(ready)?.after?.(ready, ctxFor({ fx }, game));
    expect(said.at(-1)).toBe('s0:Thunder Call ready');
  });
});

describe('labels', () => {
  it('names each superpower as it is used', () => {
    const say = (power: 'thunder' | 'shield' | 'smash' | 'aim' | 'sting') => powerLabel({ t: 'power', seat: 's0', power }, null, []);
    expect(['thunder', 'shield', 'smash', 'aim'].map((p) => say(p as 'thunder'))).toEqual(['Re-roll!', 'Shield!', 'Smash!', 'Take aim']);
    expect(say('sting')).toBe('Sting!');
  });

  it("counts a Viper Strike's extra spaces from its walk", () => {
    let s = heroGame(['velvetViper', 'jadeTitan']);
    s = run(s, 's0', { k: 'debugRig', dice: [[2, 3]] }).state;
    s = run(s, 's0', { k: 'roll' }).state;
    expect(s.phase).toMatchObject({ k: 'boost', total: 5 });
    const { events } = run(s, 's0', { k: 'sting', n: 4, at: s.since });
    const i = events.findIndex((e) => e.t === 'power');
    const power = events[i] as Extract<GameEvent, { t: 'power' }>;
    expect(powerLabel(power, s, events.slice(i + 1))).toBe('Sting +4');
    // Without the boost phase on show, the throw on the table tells the dice's part
    expect(powerLabel(power, { ...s, phase: { k: 'busy' } }, events.slice(i + 1))).toBe('Sting +4');
  });

  it('says which superpower is ready, what a short payment missed, and a location nobody saved', () => {
    const s = heroGame(['jadeTitan', 'sharpshot', 'stormLord']);
    expect(readyLabel({ t: 'powerReady', seat: 's1' }, s)).toBe('Dead Aim ready');
    expect(readyLabel({ t: 'powerReady', seat: 's1' }, null)).toBe('Superpower ready');
    const short: Extract<GameEvent, { t: 'short' }> = { t: 'short', seat: 's0', why: 'rent', space: 16, owed: { s1: 150 }, paid: { s1: 110 } };
    expect(shortLabel(short, s)).toBe('40 Power short');
    expect(shortLabel({ ...short, owed: { s1: 25, s2: 25 }, paid: { s1: 10, s2: 0 } }, s)).toBe('40 Power short');
    expect(NO_SAVE_LABEL).toBe('Not saved');
  });
});
