import { describe, expect, it } from 'vitest';
import { apply, awaiting, createGame, defaultAction, legalActions, timeoutCommand, timer } from '..';
import type { Action, Actor, GameState } from '../types';
import { act, cash, ofType, own, refused, rig, run, scenario } from './helpers';

describe('awaiting, defaults and timers', () => {
  it('waits for the turn seat, with a safe default for each choice', () => {
    let s = scenario();
    expect(awaiting(s)).toEqual(['s0']);
    expect(defaultAction(s, 's0')).toEqual({ k: 'roll' });
    expect(defaultAction(s, 's1')).toBeNull();
    expect(timer(s)).toEqual({ key: 'preRoll:0', kind: 'turn' });
    rig(s, [2, 4]);
    s = act(s, 's0', { k: 'roll' }).state;
    expect(defaultAction(s, 's0')).toEqual({ k: 'decline' });
    expect(timer(s)?.kind).toBe('decision');
    s = run(s, ['s0', { k: 'decline' }], ['s0', { k: 'pass' }], ['s1', { k: 'pass' }]).state;
    expect(defaultAction(s, 's0')).toEqual({ k: 'endTurn' });
    expect(timer(s)?.kind).toBe('turn');
  });

  it('restarts the timer key on a new phase, not when someone else acts meanwhile', () => {
    const s = scenario();
    own(s, 's1', [5]);
    const k0 = timer(s)?.key;
    const other = act(s, 's1', { k: 'mortgage', space: 5 }).state;
    expect(timer(other)?.key).toBe(k0);
    rig(other, [5, 5]);
    const again = act(other, 's0', { k: 'roll' }).state;
    expect(again.phase.k).toBe('preRoll');
    expect(timer(again)?.key).not.toBe(k0);
  });

  it('times out with a forced default the engine accepts only as the exact default', () => {
    const s = scenario();
    const t = timeoutCommand(s);
    expect(t).toEqual({ by: 'system', a: { k: 'forced', seat: 's0', a: { k: 'roll' } }, basis: 0 });
    const { events } = act(s, 'system', t!.a, t!.basis);
    expect(ofType(events, 'timeout')).toEqual([{ t: 'timeout', seat: 's0', a: { k: 'roll' } }]);
    expect(refused(s, 'system', { k: 'forced', seat: 's0', a: { k: 'roll' } })).toBe('basis');
    expect(refused(s, 'system', { k: 'forced', seat: 's1', a: { k: 'roll' } }, 0)).toBe('notAwaited');
    expect(refused(s, 'system', { k: 'forced', seat: 's0', a: { k: 'resign' } }, 0)).toBe('notDefault');
    expect(refused(s, 's1', { k: 'forced', seat: 's0', a: { k: 'roll' } })).toBe('badActor');
  });

  it('times a debt out with autoRaise', () => {
    const s = scenario();
    own(s, 's1', [39], { level: 1 });
    own(s, 's1', [37], { level: 1 });
    own(s, 's0', [5]);
    s.players.s0!.cash = 100;
    s.players.s0!.pos = 35;
    rig(s, [1, 3]);
    const debt = act(s, 's0', { k: 'roll' }).state;
    expect(timer(debt)?.kind).toBe('debt');
    expect(timeoutCommand(debt)?.a).toEqual({ k: 'forced', seat: 's0', a: { k: 'autoRaise' } });
    const { state } = act(debt, 'system', timeoutCommand(debt)!.a, debt.seq);
    expect(state.props.p5?.mortgaged).toBe(true);
    expect(cash(state, 's0')).toBe(100 + 120 - 200);
  });

  it('has nothing to wait for once the game is over', () => {
    const s = scenario();
    const over = act(s, 'system', { k: 'endGame' }, 0).state;
    expect(over.phase.k).toBe('over');
    expect(awaiting(over)).toEqual([]);
    expect(timer(over)).toBeNull();
    expect(timeoutCommand(over)).toBeNull();
    expect(legalActions(over, 's0')).toEqual([]);
  });
});

describe('game endings without a winner by bankruptcy', () => {
  it('Finish now (endGame) ranks by net worth', () => {
    const s = scenario({ n: 3 });
    s.players.s2!.cash = 2000;
    own(s, 's1', [39]);
    own(s, 's0', [37], { mortgaged: true });
    const { state, events } = act(s, 'system', { k: 'endGame' }, 0);
    // s1: 1500 + 400; s0: 1500 + 350 - 175 - 18; s2: 2000
    expect(state.phase).toEqual({ k: 'over', winner: 's2', ranking: ['s2', 's1', 's0'], why: 'endGame' });
    expect(ofType(events, 'over')).toHaveLength(1);
    expect(refused(s, 's0', { k: 'endGame' })).toBe('badActor');
  });

  it('a turn limit ends the game after that many turns', () => {
    let s = scenario({ cfg: { turnLimit: 2 } });
    rig(s, [4, 6], [4, 6]);
    s = run(s, ['s0', { k: 'roll' }], ['s0', { k: 'endTurn' }]).state;
    expect(s.turn.seat).toBe('s1');
    s = run(s, ['s1', { k: 'roll' }], ['s1', { k: 'endTurn' }]).state;
    expect(s.phase).toMatchObject({ k: 'over', why: 'turnLimit' });
  });
});

describe('dice randomness is used only by rolls', () => {
  /** A state where most actions are available: s0 owns a buildable group, an open trade, debug on */
  function rich(): GameState {
    const s = scenario({ n: 3 });
    own(s, 's0', [37, 39]);
    own(s, 's0', [5], { mortgaged: true });
    own(s, 's1', [12]);
    s.players.s0!.goojf = [];
    return s;
  }

  it('leaves state.rng unchanged for every non-roll action', () => {
    const s = rich();
    const offer = act(s, 's1', {
      k: 'propose',
      to: 's0',
      give: { cash: 0, props: [12], cards: [] },
      get: { cash: 50, props: [], cards: [] },
    }).state;
    const id = Object.keys(offer.trades)[0] as string;
    const cases: [Actor, Action][] = [
      ['s0', { k: 'build', group: 'darkBlue', levels: [1, 1] }],
      ['s0', { k: 'mortgage', space: 39 }],
      ['s0', { k: 'unmortgage', space: 5 }],
      ['s0', { k: 'accept', id }],
      ['s0', { k: 'reject', id }],
      ['s1', { k: 'cancel', id }],
      ['s2', { k: 'resign' }],
      ['system', { k: 'endGame' }],
    ];
    for (const [by, a] of cases) {
      const r = apply(offer, by === 'system' ? { by, a, basis: offer.seq } : { by, a }, { check: true });
      expect(r.ok, `${by} ${a.k}`).toBe(true);
      if (r.ok) expect(r.state.rng, `${by} ${a.k}`).toBe(offer.rng);
    }
    // A roll does consume it.
    const rolled = act(rich(), 's0', { k: 'roll' }).state;
    expect(rolled.rng).not.toBe(rich().rng);
  });

  it('a rigged roll does not consume it either', () => {
    const s = scenario();
    rig(s, [1, 2]);
    expect(act(s, 's0', { k: 'roll' }).state.rng).toBe(s.rng);
  });

  it('accepts debug actions only with cfg.debug', () => {
    const { state } = createGame({}, [
      { id: 's0', name: 'A' },
      { id: 's1', name: 'B' },
    ], 1);
    expect(refused(state, 's0', { k: 'debugRig', dice: [[1, 2]] })).toBe('debugOff');
    expect(refused(state, 's0', { k: 'debugSetCash', seat: 's0', cash: 5 })).toBe('debugOff');
    const s = scenario();
    expect(refused(s, 's0', { k: 'debugRig', dice: [[7, 2]] })).toBe('badRig');
    const rigged = act(s, 's0', { k: 'debugRig', dice: [[3, 4, 'bus']] }).state;
    expect(rigged.rig).toEqual([[3, 4, 'bus']]);
    const set = act(s, 's1', { k: 'debugSetCash', seat: 's0', cash: 5 });
    expect(cash(set.state, 's0')).toBe(5);
    expect(ofType(set.events, 'cash')[0]).toMatchObject({ from: 's0', to: 'bank', amount: 1495, why: 'debug' });
  });
});
