import { describe, expect, it } from 'vitest';
import type { GameState, RulesConfig } from '../types';
import { act, cash, ofType, own, pos, refused, rig, run, scenario, setCash, stack } from './helpers';

/** s0 starts its turn in jail after `tries` failed rolls */
function jailed(tries = 0, cfg: Partial<RulesConfig> = {}): GameState {
  const s = scenario({ cfg });
  s.players.s0!.pos = 10;
  s.players.s0!.jail = { tries };
  return s;
}

describe('jail', () => {
  it('pay the fine on the first turn, then roll normally (doubles roll again)', () => {
    let s = jailed(0);
    const paid = act(s, 's0', { k: 'payFine' });
    expect(cash(paid.state, 's0')).toBe(1450);
    expect(paid.state.players.s0?.jail).toBeUndefined();
    expect(ofType(paid.events, 'jailExit')).toEqual([{ t: 'jailExit', seat: 's0', how: 'fine' }]);
    expect(paid.state.phase.k).toBe('preRoll');
    s = paid.state;
    rig(s, [5, 5]);
    s = act(s, 's0', { k: 'roll' }).state;
    expect(pos(s, 's0')).toBe(20);
    expect(s.phase.k).toBe('preRoll');
  });

  it('may pay on the second turn but not the third; never without the cash', () => {
    expect(act(jailed(1), 's0', { k: 'payFine' }).state.players.s0?.jail).toBeUndefined();
    expect(refused(jailed(2), 's0', { k: 'payFine' })).toBe('mustRoll');
    const poor = jailed(0);
    setCash(poor, 's0', 49);
    expect(refused(poor, 's0', { k: 'payFine' })).toBe('cash');
  });

  it('doubles get you out and you move by that throw, with no extra roll', () => {
    const s = jailed(1);
    rig(s, [4, 4]);
    const { state, events } = act(s, 's0', { k: 'roll' });
    expect(ofType(events, 'dice')[0]).toMatchObject({ purpose: 'jail', doubles: true });
    expect(ofType(events, 'jailExit')[0]?.how).toBe('doubles');
    expect(pos(state, 's0')).toBe(18);
    expect(state.phase).toEqual({ k: 'buy', space: 18 });
    expect(act(state, 's0', { k: 'decline' }).state.phase.k).toBe('auction');
  });

  it('a failed roll keeps you in; the third failure charges the fine and moves you', () => {
    let s = jailed(0);
    rig(s, [1, 2]);
    const first = act(s, 's0', { k: 'roll' });
    expect(first.state.players.s0?.jail).toEqual({ tries: 1 });
    expect(pos(first.state, 's0')).toBe(10);
    expect(ofType(first.events, 'jailStay')).toEqual([{ t: 'jailStay', seat: 's0', tries: 1 }]);
    expect(first.state.phase.k).toBe('postRoll');

    s = jailed(2);
    rig(s, [3, 4]);
    stack(s, 'chest', 'cc-contest');
    const third = act(s, 's0', { k: 'roll' });
    expect(third.state.players.s0?.jail).toBeUndefined();
    expect(ofType(third.events, 'jailExit')[0]?.how).toBe('forced');
    expect(pos(third.state, 's0')).toBe(17);
    expect(cash(third.state, 's0')).toBe(1500 - 50 + 10);
    expect(third.state.phase.k).toBe('postRoll');
    expect(ofType(third.events, 'cash')[0]).toMatchObject({ from: 's0', to: 'bank', amount: 50, why: 'fine' });
  });

  it('with too little cash for the forced fine, the debt comes first, then the move', () => {
    const s = jailed(2);
    setCash(s, 's0', 20);
    own(s, 's0', [39]);
    rig(s, [1, 3]);
    const { state } = act(s, 's0', { k: 'roll' });
    expect(state.phase).toMatchObject({ k: 'debt', debtor: 's0', owed: { bank: 50 }, why: 'fine' });
    expect(pos(state, 's0')).toBe(10);
    const after = act(state, 's0', { k: 'mortgage', space: 39 });
    expect(pos(after.state, 's0')).toBe(14);
    expect(after.state.players.s0?.jail).toBeUndefined();
    expect(cash(after.state, 's0')).toBe(20 + 200 - 50);
  });

  it('a Get Out of Jail Free card frees you and returns to the bottom of its deck', () => {
    const s = jailed(0);
    s.decks.chest = s.decks.chest.filter((id) => id !== 'cc-goojf');
    s.players.s0!.goojf = ['cc-goojf'];
    const { state, events } = act(s, 's0', { k: 'useCard' });
    expect(state.players.s0?.jail).toBeUndefined();
    expect(state.players.s0?.goojf).toEqual([]);
    expect(state.decks.chest.at(-1)).toBe('cc-goojf');
    expect(ofType(events, 'cardReturn')).toEqual([{ t: 'cardReturn', deck: 'chest', cardId: 'cc-goojf', seat: 's0' }]);
    expect(refused(jailed(0), 's0', { k: 'useCard' })).toBe('noCard');
  });

  it('buy the card from another player and use it (exit route 3)', () => {
    const s = jailed(0, {});
    s.decks.chance = s.decks.chance.filter((id) => id !== 'ch-goojf');
    s.players.s1!.goojf = ['ch-goojf'];
    const offer = act(s, 's0', { k: 'propose', to: 's1', give: { cash: 60, props: [], cards: [] }, get: { cash: 0, props: [], cards: ['ch-goojf'] } });
    const id = Object.keys(offer.state.trades)[0] as string;
    const { state } = run(offer.state, ['s1', { k: 'accept', id }], ['s0', { k: 'useCard', card: 'ch-goojf' }]);
    expect(state.players.s0?.jail).toBeUndefined();
    expect(cash(state, 's1')).toBe(1560);
    expect(state.decks.chance.at(-1)).toBe('ch-goojf');
  });

  it('the roll out of jail never includes the Speed Die', () => {
    const s = jailed(0, { speedDie: true });
    s.players.s0!.speed = true;
    rig(s, [1, 2, 3]);
    const { events } = act(s, 's0', { k: 'roll' });
    expect(ofType(events, 'dice')[0]?.s).toBeUndefined();
  });

  it('jailed players still collect rent', () => {
    const s = scenario();
    own(s, 's0', [24]);
    s.players.s0!.pos = 10;
    s.players.s0!.jail = { tries: 1 };
    s.turn.seat = 's1';
    s.players.s1!.pos = 20;
    rig(s, [1, 3]);
    expect(cash(act(s, 's1', { k: 'roll' }).state, 's0')).toBe(1520);
  });
});
