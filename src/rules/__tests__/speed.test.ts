import { describe, expect, it } from 'vitest';
import { defaultAction, isProperty } from '..';
import { LANKA } from '../data/lanka';
import type { GameState, SeatId } from '../types';
import { act, cash, ofType, own, pos, refused, rig, run, scenario, setPos, stack } from './helpers';

/** Speed Die rules on and already unlocked for s0 */
function speedy(n = 2): GameState {
  const s = scenario({ n, cfg: { speedDie: true } });
  s.players.s0!.speed = true;
  return s;
}

const ALL_PROPS = LANKA.spaces.flatMap((sp, i) => (isProperty(sp) ? [i] : []));
const ownAllBut = (s: GameState, seat: SeatId, except: number[]): void =>
  own(s, seat, ALL_PROPS.filter((x) => !except.includes(x)));

describe('Speed Die', () => {
  it('adds Rs. 1000 to the starting cash', () => {
    expect(cash(scenario({ cfg: { speedDie: true } }), 's0')).toBe(2500);
  });

  it('is not rolled until the first GO salary, then from the very next roll (a doubles re-roll too)', () => {
    let s = scenario({ cfg: { speedDie: true } });
    setPos(s, 's0', 36);
    rig(s, [2, 2], [1, 2, 3]);
    const first = act(s, 's0', { k: 'roll' });
    expect(ofType(first.events, 'dice')[0]?.s).toBeUndefined();
    expect(ofType(first.events, 'speedOn')).toEqual([{ t: 'speedOn', seat: 's0' }]);
    s = first.state;
    expect(s.phase.k).toBe('preRoll');
    const second = act(s, 's0', { k: 'roll' });
    expect(ofType(second.events, 'dice')[0]).toMatchObject({ w: [1, 2], s: 3, total: 6 });
    expect(pos(second.state, 's0')).toBe(6);
  });

  it('is unlocked by the salary from an Advance to GO card', () => {
    const s = scenario({ cfg: { speedDie: true } });
    setPos(s, 's0', 4);
    stack(s, 'chance', 'ch-go');
    rig(s, [1, 2]);
    expect(act(s, 's0', { k: 'roll' }).state.players.s0?.speed).toBe(true);
  });

  it('a player jailed before ever reaching GO still has no Speed Die after release', () => {
    const s = scenario({ cfg: { speedDie: true } });
    s.players.s0!.pos = 10;
    s.players.s0!.jail = { tries: 0 };
    rig(s, [1, 2, 3]);
    const { events } = run(s, ['s0', { k: 'payFine' }], ['s0', { k: 'roll' }]);
    expect(ofType(events, 'dice')[0]?.s).toBeUndefined();
  });

  it('number faces add to the move; only the white dice make doubles', () => {
    const s = speedy();
    rig(s, [3, 4, 2]);
    const a = act(s, 's0', { k: 'roll' });
    expect(pos(a.state, 's0')).toBe(9);
    const b = speedy();
    rig(b, [3, 4, 3]);
    const r = act(b, 's0', { k: 'roll' });
    expect(ofType(r.events, 'dice')[0]).toMatchObject({ doubles: false, triples: false, total: 10 });
    expect(pos(r.state, 's0')).toBe(10);
    expect(r.state.phase.k).toBe('postRoll');
  });

  it('Bus: move by either die or the sum, duplicates removed; doubles still roll again', () => {
    const s = speedy();
    rig(s, [3, 4, 'bus']);
    const bus = act(s, 's0', { k: 'roll' }).state;
    expect(bus.phase).toEqual({ k: 'bus', opts: [3, 4, 7] });
    expect(defaultAction(bus, 's0')).toEqual({ k: 'bus', n: 7 });
    expect(refused(bus, 's0', { k: 'bus', n: 5 })).toBe('badMove');
    const moved = act(bus, 's0', { k: 'bus', n: 3 });
    expect(pos(moved.state, 's0')).toBe(3);
    expect(ofType(moved.events, 'move')[0]?.via).toBe('bus');

    const d = speedy();
    setPos(d, 's0', 7);
    rig(d, [3, 3, 'bus']);
    const dbus = act(d, 's0', { k: 'roll' }).state;
    expect(dbus.phase).toEqual({ k: 'bus', opts: [3, 6] });
    const after = act(dbus, 's0', { k: 'bus', n: 3 }).state;
    expect(pos(after, 's0')).toBe(10);
    expect(after.phase.k).toBe('preRoll');
  });

  it('Tuk-Tuk Uncle: after the first landing, on to the next bank-owned property (buy or auction)', () => {
    const s = speedy();
    rig(s, [1, 2, 'uncle']);
    const first = act(s, 's0', { k: 'roll' }).state;
    expect(first.phase).toEqual({ k: 'buy', space: 3 });
    const { state, events } = act(first, 's0', { k: 'buy' });
    expect(ofType(events, 'uncle')).toEqual([{ t: 'uncle', seat: 's0', to: 5, target: 'bank' }]);
    expect(ofType(events, 'move')[0]?.via).toBe('uncle');
    expect(state.phase).toEqual({ k: 'buy', space: 5 });
    const auction = act(state, 's0', { k: 'decline' }).state;
    expect(auction.phase).toMatchObject({ k: 'auction', lot: { k: 'prop', space: 5 } });
  });

  it('Tuk-Tuk Uncle collects GO when the advance passes it', () => {
    const s = speedy();
    own(s, 's1', [39]);
    setPos(s, 's0', 34);
    rig(s, [1, 3, 'uncle']);
    const { state, events } = act(s, 's0', { k: 'roll' });
    expect(pos(state, 's0')).toBe(1);
    expect(ofType(events, 'salary')).toHaveLength(1);
    expect(cash(state, 's0')).toBe(2500 - 75 + 200);
  });

  it('Tuk-Tuk Uncle: once the bank owns nothing, on to the next property where rent is owed', () => {
    const s = speedy();
    ownAllBut(s, 's1', [3]);
    s.props.p5!.mortgaged = true;
    rig(s, [1, 2, 'uncle']);
    const first = act(s, 's0', { k: 'roll' }).state;
    // Buying Baltic leaves the bank with nothing, so the advance looks for rent instead (mortgaged Reading is skipped).
    const { state, events } = act(first, 's0', { k: 'buy' });
    expect(ofType(events, 'uncle')).toEqual([{ t: 'uncle', seat: 's0', to: 6, target: 'rent' }]);
    expect(ofType(events, 'cash').find((e) => e.why === 'rent')).toMatchObject({ to: 's1', amount: 12 });
    expect(pos(state, 's0')).toBe(6);
  });

  it('Tuk-Tuk Uncle stays put when there is no bank property and no rent to pay', () => {
    const s = speedy();
    ownAllBut(s, 's0', []);
    rig(s, [1, 2, 'uncle']);
    const { state, events } = act(s, 's0', { k: 'roll' });
    expect(ofType(events, 'uncle')).toEqual([{ t: 'uncle', seat: 's0' }]);
    expect(pos(state, 's0')).toBe(3);
  });

  it('Tuk-Tuk Uncle is dropped when the first move ends in jail', () => {
    const s = speedy();
    setPos(s, 's0', 27);
    rig(s, [1, 2, 'uncle']);
    const { state, events } = act(s, 's0', { k: 'roll' });
    expect(ofType(events, 'uncle')).toHaveLength(0);
    expect(pos(state, 's0')).toBe(10);
    expect(state.pending).toEqual([]);
  });

  it('Tuk-Tuk Uncle starts from where a card left the player', () => {
    const s = speedy();
    setPos(s, 's0', 3);
    stack(s, 'chance', 'ch-back3');
    rig(s, [1, 3, 'uncle']);
    const tax = act(s, 's0', { k: 'roll' }).state;
    expect(tax.phase.k).toBe('incomeTax');
    const { state } = act(tax, 's0', { k: 'incomeTax', pick: 'flat' });
    expect(state.phase).toEqual({ k: 'buy', space: 5 });
  });

  it('triples: move to any other space, collecting GO when passing it, then roll again', () => {
    const s = speedy();
    setPos(s, 's0', 25);
    rig(s, [2, 2, 2]);
    const choose = act(s, 's0', { k: 'roll' });
    expect(ofType(choose.events, 'dice')[0]).toMatchObject({ doubles: true, triples: true });
    expect(choose.state.phase).toEqual({ k: 'chooseSpace' });
    expect(refused(choose.state, 's0', { k: 'chooseSpace', space: 25 })).toBe('badSpace');
    const { state, events } = act(choose.state, 's0', { k: 'chooseSpace', space: 20 });
    expect(pos(state, 's0')).toBe(20);
    expect(ofType(events, 'move')[0]).toMatchObject({ via: 'triple', from: 25, to: 20 });
    expect(ofType(events, 'salary')).toHaveLength(1);
    expect(state.phase.k).toBe('preRoll');
  });

  it('triples without the re-roll when configured; choosing Go To Jail goes to jail with no salary', () => {
    const s = scenario({ cfg: { speedDie: true, triplesRollAgain: false } });
    s.players.s0!.speed = true;
    rig(s, [4, 4, 'bus'], [1, 1, 1]);
    // (4,4,bus) is not a triple: a Bus face never matches a number.
    expect(act(s, 's0', { k: 'roll' }).state.phase.k).toBe('bus');
    const t = scenario({ cfg: { speedDie: true, triplesRollAgain: false } });
    t.players.s0!.speed = true;
    rig(t, [1, 1, 1]);
    const choose = act(t, 's0', { k: 'roll' }).state;
    expect(act(choose, 's0', { k: 'chooseSpace', space: 20 }).state.phase.k).toBe('postRoll');
    setPos(choose, 's0', 35);
    const jail = act(choose, 's0', { k: 'chooseSpace', space: 30 });
    expect(pos(jail.state, 's0')).toBe(10);
    expect(ofType(jail.events, 'salary')).toHaveLength(0);
  });

  it('a triple that is the third doubles goes to jail', () => {
    const s = speedy();
    s.turn.doubles = 2;
    rig(s, [3, 3, 3]);
    const { state } = act(s, 's0', { k: 'roll' });
    expect(state.players.s0?.jail).toBeDefined();
    expect(state.phase.k).toBe('postRoll');
  });

  it('utility rent uses all three dice, Bus and Tuk-Tuk Uncle counting 0', () => {
    const a = speedy();
    own(a, 's1', [12]);
    setPos(a, 's0', 5);
    rig(a, [2, 5, 'bus']);
    const bus = act(a, 's0', { k: 'roll' }).state;
    const paid = act(bus, 's0', { k: 'bus', n: 7 });
    expect(ofType(paid.events, 'cash').find((e) => e.why === 'rent')?.amount).toBe(28);

    const b = speedy();
    own(b, 's1', [12]);
    setPos(b, 's0', 2);
    rig(b, [2, 5, 3]);
    expect(ofType(act(b, 's0', { k: 'roll' }).events, 'cash').find((e) => e.why === 'rent')?.amount).toBe(40);
  });

  it("the Nearest Utility card's fresh throw includes the Speed Die when the player has it", () => {
    const s = speedy();
    own(s, 's1', [12]);
    setPos(s, 's0', 3);
    stack(s, 'chance', 'ch-utility');
    rig(s, [1, 2, 1], [2, 3, 'uncle']);
    const { events } = act(s, 's0', { k: 'roll' });
    const fresh = ofType(events, 'dice')[1];
    expect(fresh).toMatchObject({ purpose: 'utility', s: 'uncle', total: 5 });
    expect(ofType(events, 'cash').find((e) => e.why === 'rent')?.amount).toBe(50);
  });
});
