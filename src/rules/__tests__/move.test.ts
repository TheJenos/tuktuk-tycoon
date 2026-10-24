import { describe, expect, it } from 'vitest';
import { ofType, act, cash, pos, refused, rig, run, scenario, setPos, stack } from './helpers';

describe('moving round the board', () => {
  it('passes GO for Rs. 200 and resolves the space it lands on', () => {
    const s = scenario();
    setPos(s, 's0', 38);
    stack(s, 'chest', 'cc-contest');
    rig(s, [1, 3]);
    const { state, events } = act(s, 's0', { k: 'roll' });
    expect(pos(state, 's0')).toBe(2);
    expect(ofType(events, 'move')[0]).toMatchObject({ from: 38, to: 2, path: [39, 0, 1, 2], via: 'dice' });
    expect(ofType(events, 'salary')).toEqual([{ t: 'salary', seat: 's0', amount: 200 }]);
    expect(ofType(events, 'card')[0]).toMatchObject({ deck: 'chest', cardId: 'cc-contest' });
    expect(cash(state, 's0')).toBe(1500 + 200 + 10);
    expect(state.phase.k).toBe('postRoll');
  });

  it('pays salary once for landing exactly on GO', () => {
    const s = scenario();
    setPos(s, 's0', 35);
    rig(s, [2, 3]);
    const { state, events } = act(s, 's0', { k: 'roll' });
    expect(pos(state, 's0')).toBe(0);
    expect(ofType(events, 'salary')).toHaveLength(1);
    expect(cash(state, 's0')).toBe(1700);
  });

  it('rolls again after doubles and goes to jail on the third, without moving or salary', () => {
    let s = scenario();
    rig(s, [5, 5], [5, 5], [5, 5]);
    s = act(s, 's0', { k: 'roll' }).state;
    expect(pos(s, 's0')).toBe(10);
    expect(s.phase.k).toBe('preRoll');
    s = act(s, 's0', { k: 'roll' }).state;
    expect(pos(s, 's0')).toBe(20);
    expect(s.phase.k).toBe('preRoll');
    setPos(s, 's0', 35);
    const { state, events } = act(s, 's0', { k: 'roll' });
    expect(pos(state, 's0')).toBe(10);
    expect(state.players.s0?.jail).toEqual({ tries: 0 });
    expect(ofType(events, 'salary')).toHaveLength(0);
    expect(ofType(events, 'jail')).toEqual([{ t: 'jail', seat: 's0', reason: 'doubles' }]);
    expect(ofType(events, 'move')).toEqual([{ t: 'move', seat: 's0', from: 35, to: 10, path: [10], via: 'jail' }]);
    expect(state.phase.k).toBe('postRoll');
    expect(cash(state, 's0')).toBe(1500);
  });

  it('ends the turn on Go To Jail even after doubles', () => {
    const s = scenario();
    setPos(s, 's0', 20);
    rig(s, [5, 5]);
    const { state } = act(s, 's0', { k: 'roll' });
    expect(pos(state, 's0')).toBe(10);
    expect(state.players.s0?.jail).toBeDefined();
    expect(state.phase.k).toBe('postRoll');
    expect(state.turn.again).toBe(false);
  });

  it('passes the turn on in seat order', () => {
    const s = scenario({ n: 3 });
    rig(s, [4, 6]);
    const { state, events } = run(s, ['s0', { k: 'roll' }], ['s0', { k: 'endTurn' }]);
    expect(state.turn).toMatchObject({ seat: 's1', no: 2, doubles: 0 });
    expect(state.phase.k).toBe('preRoll');
    expect(ofType(events, 'turn')).toEqual([{ t: 'turn', seat: 's1', no: 2 }]);
  });

  it('refuses out-of-turn and out-of-phase actions, and stale bases', () => {
    const s = scenario();
    expect(refused(s, 's1', { k: 'roll' })).toBe('notYourTurn');
    expect(refused(s, 's0', { k: 'endTurn' })).toBe('phase');
    expect(refused(s, 's0', { k: 'roll' }, 5)).toBe('stale');
    expect(refused(s, 'system', { k: 'roll' }, 0)).toBe('badActor');
    expect(refused(s, 's0', { k: 'nope' } as never)).toBe('badAction');
    expect(act(s, 's0', { k: 'roll' }, 0).state.seq).toBe(1);
  });

  it('never mutates the input state', () => {
    const s = scenario();
    rig(s, [3, 4]);
    const before = JSON.stringify(s);
    act(s, 's0', { k: 'roll' });
    expect(JSON.stringify(s)).toBe(before);
  });
});
