import { describe, expect, it } from 'vitest';
import {
  LANKA,
  apply,
  awaiting,
  createGame,
  defaultAction,
  isProperty,
  legalActions,
  maxRaise,
  timeoutCommand,
  timer,
  unmortgageCost,
} from '..';
import type { Action, Bundle, GameState, SeatId, TimerInfo } from '../types';
import { act, cash, cashDelta, ofType, own, pos, refused, rig, run, scenario, setCash, setPos, stack } from './helpers';

/*
 * Adversarial audit of the advanced rules against docs/rules.md: the Speed Die, timed open auctions, buildings and
 * the shortage contest, mortgages, trades, bankruptcy, the end of the game and the timeout contract. Each test names
 * the rule (or the Rules decision) it checks.
 */

const ALL_PROPS = LANKA.spaces.flatMap((sp, i) => (isProperty(sp) ? [i] : []));
const except = (...spaces: number[]): number[] => ALL_PROPS.filter((x) => !spaces.includes(x));
const bundle = (b: Partial<Bundle> = {}): Bundle => ({ cash: 0, props: [], cards: [], ...b });

/** Speed Die rules on (Rs. 2,500 each) and already unlocked for s0 */
function speedy(n = 2): GameState {
  const s = scenario({ n, cfg: { speedDie: true } });
  s.players.s0!.speed = true;
  return s;
}

/** s0 lands on Maradana Lane (3) and declines: an open auction among s0, s1, s2 */
function balticAuction(): GameState {
  const s = scenario({ n: 3 });
  rig(s, [1, 2]);
  return run(s, ['s0', { k: 'roll' }], ['s0', { k: 'decline' }]).state;
}

/** 4 houses in the bank; s0 owns the browns, s1 the light blues; s0 asks for a house on each brown */
function shortageClaim(s1Cash = 1500): GameState {
  const s = scenario({ cfg: { houses: 4 } });
  own(s, 's0', [1, 3]);
  own(s, 's1', [6, 8, 9]);
  setCash(s, 's1', s1Cash);
  return act(s, 's0', { k: 'build', group: 'brown', levels: [1, 1] }).state;
}

/** s0 gives s1 mortgaged Colombo Fort Station and Power Cut Board for Rs. 50 */
function tradedMortgages(): GameState {
  const s = scenario();
  own(s, 's0', [5, 12], { mortgaged: true });
  const offer = act(s, 's0', { k: 'propose', to: 's1', give: bundle({ props: [5, 12] }), get: bundle({ cash: 50 }) });
  const id = Object.keys(offer.state.trades)[0] as string;
  return act(offer.state, 's1', { k: 'accept', id }).state;
}

/** s0 (cash `left`, owning `props`) lands on s1's lone Galle Face Penthouse (Rs. 50 rent) in a 3-player game */
function penthouseDebt(left: number, props: number[]): GameState {
  const s = scenario({ n: 3 });
  own(s, 's1', [39]);
  own(s, 's0', props);
  setCash(s, 's0', left);
  setPos(s, 's0', 35);
  rig(s, [1, 3]);
  return act(s, 's0', { k: 'roll' }).state;
}

// ---------------------------------------------------------------------------------------------------------------

describe('audit: Speed Die unlock', () => {
  it('Speed rule 1: +Rs. 1,000 only with the Speed Die; with it off, GO salary never unlocks anything', () => {
    expect(cash(scenario({ n: 3, cfg: { speedDie: true } }), 's2')).toBe(2500);
    const off = scenario();
    expect(cash(off, 's0')).toBe(1500);
    setPos(off, 's0', 36);
    rig(off, [2, 3]);
    const r = act(off, 's0', { k: 'roll' });
    expect(ofType(r.events, 'salary')).toHaveLength(1);
    expect(ofType(r.events, 'speedOn')).toEqual([]);
    expect(r.state.players.s0?.speed).toBe(false);
  });

  it('Speed rule 2: before the first salary a rigged speed face is ignored (no Tuk-Tuk Uncle, no extra pips)', () => {
    const s = scenario({ cfg: { speedDie: true } });
    rig(s, [1, 2, 'uncle']);
    const { state, events } = act(s, 's0', { k: 'roll' });
    expect(ofType(events, 'dice')[0]?.s).toBeUndefined();
    expect(ofType(events, 'uncle')).toEqual([]);
    expect(state.phase).toEqual({ k: 'buy', space: 3 });
  });

  it('Speed rule 2 + decision "unlock": landing exactly on GO unlocks it for the doubles re-roll, for that seat only', () => {
    const s = scenario({ cfg: { speedDie: true } });
    setPos(s, 's0', 36);
    rig(s, [2, 2], [1, 2, 3]);
    const first = act(s, 's0', { k: 'roll' });
    expect(pos(first.state, 's0')).toBe(0);
    expect(ofType(first.events, 'dice')[0]?.s).toBeUndefined();
    expect(ofType(first.events, 'speedOn')).toEqual([{ t: 'speedOn', seat: 's0' }]);
    const second = act(first.state, 's0', { k: 'roll' });
    expect(ofType(second.events, 'dice')[0]).toMatchObject({ w: [1, 2], s: 3, total: 6 });
    expect(pos(second.state, 's0')).toBe(6);
    expect(second.state.players.s1?.speed).toBe(false);
  });

  it('decision "unlock": a card salary (Advance to GO) mid-turn takes effect on the doubles re-roll', () => {
    const s = scenario({ cfg: { speedDie: true } });
    setPos(s, 's0', 5);
    stack(s, 'chance', 'ch-go');
    rig(s, [1, 1], [2, 1, 'bus']);
    const first = act(s, 's0', { k: 'roll' }).state;
    expect(pos(first, 's0')).toBe(0);
    expect(first.players.s0?.speed).toBe(true);
    expect(first.phase.k).toBe('preRoll');
    expect(act(first, 's0', { k: 'roll' }).state.phase).toEqual({ k: 'bus', opts: [2, 1, 3] });
  });

  it('decision "Nearest Utility": before unlocking, the fresh throw is the white dice only', () => {
    const s = scenario({ cfg: { speedDie: true } });
    own(s, 's1', [12]);
    setPos(s, 's0', 4);
    stack(s, 'chance', 'ch-utility');
    rig(s, [1, 2], [3, 4, 2]);
    const { events } = act(s, 's0', { k: 'roll' });
    const fresh = ofType(events, 'dice')[1];
    expect(fresh).toMatchObject({ purpose: 'utility', w: [3, 4], total: 7 });
    expect(fresh?.s).toBeUndefined();
    expect(ofType(events, 'cash').find((e) => e.why === 'rent')?.amount).toBe(70);
  });
});

describe('audit: Speed Die faces and numbers', () => {
  it('Speed rule 3: the die is 1, 2, 3, Bus, Tuk-Tuk Uncle, Tuk-Tuk Uncle', () => {
    expect(LANKA.speedDie.faces).toEqual([1, 2, 3, 'bus', 'uncle', 'uncle']);
  });

  it('Speed rule 3: thrown faces follow that distribution (Tuk-Tuk Uncle twice as often as any other)', () => {
    const counts: Record<string, number> = {};
    const games = 1200;
    for (let seed = 1; seed <= games; seed++) {
      const { state } = createGame({ speedDie: true }, [{ id: 's0', name: 'A' }, { id: 's1', name: 'B' }], seed);
      state.players[state.turn.seat]!.speed = true;
      const r = apply(state, { by: state.turn.seat, a: { k: 'roll' } }, { check: false });
      if (!r.ok) throw new Error(r.error.message);
      const face = String(ofType(r.events, 'dice')[0]?.s);
      counts[face] = (counts[face] ?? 0) + 1;
    }
    expect(Object.keys(counts).sort()).toEqual(['1', '2', '3', 'bus', 'uncle']);
    for (const f of ['1', '2', '3', 'bus']) {
      expect(counts[f]).toBeGreaterThan(130);
      expect(counts[f]).toBeLessThan(270);
    }
    expect(counts.uncle).toBeGreaterThan(320);
    expect(counts.uncle).toBeLessThan(480);
  });

  it('Speed rules 3 + 4: a number face adds to the move (carrying past GO); white doubles still roll again', () => {
    const s = speedy();
    setPos(s, 's0', 36);
    rig(s, [1, 1, 3]);
    const { state, events } = act(s, 's0', { k: 'roll' });
    expect(pos(state, 's0')).toBe(1);
    expect(ofType(events, 'salary')).toHaveLength(1);
    expect(ofType(events, 'dice')[0]).toMatchObject({ doubles: true, triples: false, total: 5 });
    expect(act(state, 's0', { k: 'buy' }).state.phase.k).toBe('preRoll');
  });

  it('Speed rule 4: (3,3,1) is doubles on the white dice: move 7 and roll again', () => {
    const s = speedy();
    setPos(s, 's0', 13);
    rig(s, [3, 3, 1]);
    const { state } = act(s, 's0', { k: 'roll' });
    expect(pos(state, 's0')).toBe(20);
    expect(state.phase.k).toBe('preRoll');
    expect(state.turn.doubles).toBe(1);
  });

  it('decision "Nearest Utility": a fresh throw that shows doubles or a triple is only a rent throw (no re-roll, no space choice)', () => {
    const s = speedy();
    own(s, 's1', [12]);
    setPos(s, 's0', 3);
    stack(s, 'chance', 'ch-utility');
    rig(s, [1, 2, 1], [2, 2, 2]);
    const { state, events } = act(s, 's0', { k: 'roll' });
    expect(ofType(events, 'dice')[1]).toMatchObject({ purpose: 'utility', doubles: false, triples: false, total: 6 });
    expect(ofType(events, 'cash').find((e) => e.why === 'rent')?.amount).toBe(60);
    expect(state.phase.k).toBe('postRoll');
    expect(state.turn.doubles).toBe(0);
  });

  it('Speed rule 8: utility rent with a number face is all three dice x10 when both utilities are owned', () => {
    const s = speedy();
    own(s, 's1', [12, 28]);
    setPos(s, 's0', 6);
    rig(s, [1, 2, 3]);
    const { events } = act(s, 's0', { k: 'roll' });
    expect(ofType(events, 'cash').find((e) => e.why === 'rent')).toMatchObject({ to: 's1', amount: 60 });
  });
});

describe('audit: Speed Die Bus', () => {
  it('Speed rule 3 Bus: (5,5) offers 5 or 10 (deduplicated); a one-die move keeps the doubles re-roll', () => {
    const s = speedy();
    setPos(s, 's0', 20);
    rig(s, [5, 5, 'bus']);
    const bus = act(s, 's0', { k: 'roll' }).state;
    expect(bus.phase).toEqual({ k: 'bus', opts: [5, 10] });
    expect(refused(bus, 's0', { k: 'bus', n: 15 })).toBe('badMove');
    expect(refused(bus, 's1', { k: 'bus', n: 5 })).toBe('notYourTurn');
    const moved = act(bus, 's0', { k: 'bus', n: 5 }).state;
    expect(moved.phase).toEqual({ k: 'buy', space: 25 });
    const after = run(moved, ['s0', { k: 'decline' }], ['s0', { k: 'pass' }], ['s1', { k: 'pass' }]).state;
    expect(after.phase.k).toBe('preRoll');
  });

  it('Speed rule 8: moving one die by Bus onto a utility still charges rent on all three dice (Bus = 0)', () => {
    const s = speedy();
    own(s, 's1', [12]);
    setPos(s, 's0', 10);
    rig(s, [2, 5, 'bus']);
    const bus = act(s, 's0', { k: 'roll' }).state;
    const { events } = act(bus, 's0', { k: 'bus', n: 2 });
    expect(ofType(events, 'cash').find((e) => e.why === 'rent')).toMatchObject({ to: 's1', amount: 28 });
  });

  it('Speed rule 6: Bus on the third doubles goes straight to jail, with no Bus choice', () => {
    const s = speedy();
    s.turn.doubles = 2;
    rig(s, [2, 2, 'bus']);
    const { state, events } = act(s, 's0', { k: 'roll' });
    expect(ofType(events, 'bus')).toEqual([]);
    expect(state.players.s0?.jail).toEqual({ tries: 0 });
    expect(state.phase.k).toBe('postRoll');
  });

  it('Speed rule 6: a Bus move onto Go To Jail ends the turn even on doubles', () => {
    const s = speedy();
    setPos(s, 's0', 26);
    rig(s, [2, 2, 'bus']);
    const bus = act(s, 's0', { k: 'roll' }).state;
    const { state, events } = act(bus, 's0', { k: 'bus', n: 4 });
    expect(pos(state, 's0')).toBe(10);
    expect(ofType(events, 'salary')).toEqual([]);
    expect(state.phase.k).toBe('postRoll');
  });
});

describe('audit: Speed Die Tuk-Tuk Uncle', () => {
  it('Speed rule 3 Uncle: moves the white sum, pays the rent there first, then advances to the next bank property', () => {
    const s = speedy();
    own(s, 's1', [6]);
    rig(s, [2, 4, 'uncle']);
    const { state, events } = act(s, 's0', { k: 'roll' });
    const rent = events.findIndex((e) => e.t === 'cash' && e.why === 'rent');
    const uncle = events.findIndex((e) => e.t === 'uncle');
    expect(rent).toBeGreaterThanOrEqual(0);
    expect(rent).toBeLessThan(uncle);
    expect(ofType(events, 'uncle')[0]).toEqual({ t: 'uncle', seat: 's0', to: 8, target: 'bank' });
    expect(state.phase).toEqual({ k: 'buy', space: 8 });
    expect(cash(state, 's1')).toBe(2506);
  });

  it('Speed rule 3 Uncle after a card move (Advance to Galle Fort Ramparts): buy there first, then advance from Galle Fort Ramparts', () => {
    const s = speedy();
    setPos(s, 's0', 3);
    stack(s, 'chance', 'ch-galle');
    rig(s, [1, 3, 'uncle']);
    const card = act(s, 's0', { k: 'roll' }).state;
    expect(card.phase).toEqual({ k: 'buy', space: 24 });
    const { state, events } = act(card, 's0', { k: 'buy' });
    expect(ofType(events, 'uncle')[0]).toMatchObject({ to: 25, target: 'bank' });
    expect(state.phase).toEqual({ k: 'buy', space: 25 });
  });

  it('Speed rule 3 Uncle after Advance to GO: salary, then the advance starts from GO', () => {
    const s = speedy();
    setPos(s, 's0', 3);
    stack(s, 'chance', 'ch-go');
    rig(s, [1, 3, 'uncle']);
    const { state, events } = act(s, 's0', { k: 'roll' });
    expect(ofType(events, 'salary')).toHaveLength(1);
    expect(ofType(events, 'uncle')[0]).toMatchObject({ to: 1, target: 'bank' });
    expect(state.phase).toEqual({ k: 'buy', space: 1 });
  });

  it('Speed rule 6: Uncle is dropped when the first landing draws Go to Jail', () => {
    const s = speedy();
    setPos(s, 's0', 3);
    stack(s, 'chance', 'ch-jail');
    rig(s, [1, 3, 'uncle']);
    const { state, events } = act(s, 's0', { k: 'roll' });
    expect(ofType(events, 'uncle')).toEqual([]);
    expect(pos(state, 's0')).toBe(10);
    expect(state.phase.k).toBe('postRoll');
  });

  it('Speed rule 6: Uncle on the third doubles goes to jail without moving or advancing', () => {
    const s = speedy();
    s.turn.doubles = 2;
    setPos(s, 's0', 20);
    rig(s, [1, 1, 'uncle']);
    const { state, events } = act(s, 's0', { k: 'roll' });
    expect(ofType(events, 'uncle')).toEqual([]);
    expect(ofType(events, 'move').map((e) => e.via)).toEqual(['jail']);
    expect(pos(state, 's0')).toBe(10);
  });

  it('Speed rules 3 + 4 Uncle with doubles: Income Tax first, then the advance (declined = auction), then roll again', () => {
    const s = speedy();
    rig(s, [2, 2, 'uncle']);
    const tax = act(s, 's0', { k: 'roll' }).state;
    expect(tax.phase.k).toBe('incomeTax');
    const adv = act(tax, 's0', { k: 'incomeTax', pick: 'flat' }).state;
    expect(adv.phase).toEqual({ k: 'buy', space: 5 });
    const auction = act(adv, 's0', { k: 'decline' }).state;
    expect(auction.phase).toMatchObject({ k: 'auction', lot: { k: 'prop', space: 5 } });
    const after = run(auction, ['s1', { k: 'pass' }], ['s0', { k: 'pass' }]).state;
    expect(pos(after, 's0')).toBe(5);
    expect(after.props.p5).toBeUndefined();
    expect(after.phase.k).toBe('preRoll');
  });

  it('Speed rule 3 Uncle, bank owns none: skips own and mortgaged property to the next rent owed (double rent, mortgaged sibling)', () => {
    const s = speedy();
    own(s, 's0', [1, 3, 5]);
    own(s, 's1', except(1, 3, 5));
    s.props.p6!.mortgaged = true;
    rig(s, [1, 2, 'uncle']);
    const { state, events } = act(s, 's0', { k: 'roll' });
    expect(ofType(events, 'uncle')[0]).toEqual({ t: 'uncle', seat: 's0', to: 8, target: 'rent' });
    expect(ofType(events, 'cash').find((e) => e.why === 'rent')).toMatchObject({ from: 's0', to: 's1', amount: 12 });
    expect(pos(state, 's0')).toBe(8);
  });

  it('Speed rules 3 + 8 Uncle, bank owns none: on a utility the rent is the white dice only (Uncle = 0)', () => {
    const s = speedy();
    own(s, 's0', except(12, 28));
    own(s, 's1', [12, 28]);
    setPos(s, 's0', 5);
    rig(s, [1, 3, 'uncle']);
    const { events } = act(s, 's0', { k: 'roll' });
    expect(ofType(events, 'uncle')[0]).toMatchObject({ to: 12, target: 'rent' });
    expect(ofType(events, 'cash').find((e) => e.why === 'rent')).toMatchObject({ to: 's1', amount: 40 });
  });

  it('Speed rule 3 Uncle, bank owns none after a card move: the rent search starts where Go Back 3 left the player', () => {
    const s = speedy();
    own(s, 's0', except(5, 15));
    own(s, 's1', [5, 15]);
    setPos(s, 's0', 3);
    stack(s, 'chance', 'ch-back3');
    rig(s, [1, 3, 'uncle']);
    const tax = act(s, 's0', { k: 'roll' }).state;
    expect(tax.phase.k).toBe('incomeTax');
    const { state, events } = act(tax, 's0', { k: 'incomeTax', pick: 'flat' });
    expect(ofType(events, 'uncle')[0]).toMatchObject({ to: 5, target: 'rent' });
    expect(ofType(events, 'cash').find((e) => e.why === 'rent')).toMatchObject({ to: 's1', amount: 50 });
    expect(pos(state, 's0')).toBe(5);
  });

  it('Speed rule 3 Uncle: someone else winning the auction for the last bank property switches to the rent branch', () => {
    const s = speedy();
    own(s, 's1', except(3));
    rig(s, [1, 2, 'uncle']);
    const buy = act(s, 's0', { k: 'roll' }).state;
    const { state, events } = run(buy, ['s0', { k: 'decline' }], ['s1', { k: 'bid', amount: 1 }], ['s0', { k: 'pass' }]);
    expect(state.props.p3?.owner).toBe('s1');
    expect(ofType(events, 'uncle')[0]).toMatchObject({ to: 5, target: 'rent' });
    expect(ofType(events, 'cash').find((e) => e.why === 'rent')).toMatchObject({ to: 's1', amount: 200 });
  });

  it('Speed rule 3 Uncle: the bank still owns the property just declined with no bids, so the "bank owns none" rent branch must not run', () => {
    const s = speedy();
    own(s, 's1', except(3));
    rig(s, [1, 2, 'uncle']);
    const buy = act(s, 's0', { k: 'roll' }).state;
    expect(buy.phase).toEqual({ k: 'buy', space: 3 });
    const { state, events } = run(buy, ['s0', { k: 'decline' }], ['s0', { k: 'pass' }], ['s1', { k: 'pass' }]);
    // The bank kept Baltic: it still owns a property, so "advance to the next property where you owe rent" is wrong.
    expect(state.props.p3).toBeUndefined();
    expect(ofType(events, 'uncle')[0]?.target).not.toBe('rent');
    expect(ofType(events, 'cash').filter((e) => e.why === 'rent')).toEqual([]);
  });

  it('Speed rule 3 Uncle: going bankrupt on the first landing drops the advance and passes the turn', () => {
    const s = speedy(3);
    own(s, 's1', [37, 39], { level: 5 });
    setCash(s, 's0', 10);
    setPos(s, 's0', 35);
    rig(s, [1, 3, 'uncle']);
    const debt = act(s, 's0', { k: 'roll' }).state;
    expect(debt.phase).toMatchObject({ k: 'debt', debtor: 's0' });
    const { state, events } = act(debt, 's0', { k: 'bankrupt' });
    expect(ofType(events, 'uncle')).toEqual([]);
    expect(state.turn.seat).toBe('s1');
    expect(state.phase.k).toBe('preRoll');
  });
});

describe('audit: Speed Die triples', () => {
  it('decision "Triples": a triple counts toward three doubles (doubles, triple, doubles = jail)', () => {
    const s = speedy();
    own(s, 's0', ALL_PROPS);
    setPos(s, 's0', 20);
    rig(s, [1, 1, 2], [2, 2, 2], [3, 3, 1]);
    let st = act(s, 's0', { k: 'roll' }).state;
    expect(pos(st, 's0')).toBe(24);
    st = act(st, 's0', { k: 'roll' }).state;
    expect(st.phase.k).toBe('chooseSpace');
    st = act(st, 's0', { k: 'chooseSpace', space: 26 }).state;
    expect(st.phase.k).toBe('preRoll');
    expect(st.turn.doubles).toBe(2);
    const { state, events } = act(st, 's0', { k: 'roll' });
    expect(ofType(events, 'jail')).toEqual([{ t: 'jail', seat: 's0', reason: 'doubles' }]);
    expect(pos(state, 's0')).toBe(10);
  });

  it('Speed rule 6 + decision "Triples": choosing Go To Jail jails with no salary and no re-roll', () => {
    const s = speedy();
    setPos(s, 's0', 35);
    rig(s, [2, 2, 2]);
    const choose = act(s, 's0', { k: 'roll' }).state;
    const { state, events } = act(choose, 's0', { k: 'chooseSpace', space: 30 });
    expect(pos(state, 's0')).toBe(10);
    expect(state.players.s0?.jail).toEqual({ tries: 0 });
    expect(ofType(events, 'salary')).toEqual([]);
    expect(state.phase.k).toBe('postRoll');
  });

  it('decision "Triples": choosing GO pays Rs. 200 once; choosing Jail is Just Visiting and still rolls again', () => {
    const s = speedy();
    setPos(s, 's0', 25);
    rig(s, [1, 1, 1]);
    const choose = act(s, 's0', { k: 'roll' }).state;
    const go = act(choose, 's0', { k: 'chooseSpace', space: 0 });
    expect(cashDelta(go.events, 's0')).toBe(200);
    expect(go.state.phase.k).toBe('preRoll');
    const visit = act(choose, 's0', { k: 'chooseSpace', space: 10 }).state;
    expect(visit.players.s0?.jail).toBeUndefined();
    expect(visit.phase.k).toBe('preRoll');
  });

  it('Speed rule 5: chooseSpace offers the 39 other spaces, only to the roller', () => {
    const s = speedy();
    setPos(s, 's0', 7);
    rig(s, [1, 1, 1]);
    const choose = act(s, 's0', { k: 'roll' }).state;
    expect(refused(choose, 's1', { k: 'chooseSpace', space: 3 })).toBe('notYourTurn');
    expect(refused(choose, 's0', { k: 'chooseSpace', space: 40 })).toBe('badSpace');
    expect(refused(choose, 's0', { k: 'chooseSpace', space: 7 })).toBe('badSpace');
    expect(legalActions(choose, 's0').filter((a) => a.k === 'chooseSpace')).toHaveLength(39);
  });

  it('Speed rule 8: utility rent after a triple is the sum of all three dice', () => {
    const s = speedy();
    own(s, 's1', [12]);
    rig(s, [3, 3, 3]);
    const choose = act(s, 's0', { k: 'roll' }).state;
    const { events } = act(choose, 's0', { k: 'chooseSpace', space: 12 });
    expect(ofType(events, 'cash').find((e) => e.why === 'rent')?.amount).toBe(36);
  });

  it('GO rule + decision "Triples": a triple past GO onto Chance that draws Advance to GO pays Rs. 200 twice', () => {
    const s = speedy();
    setPos(s, 's0', 25);
    stack(s, 'chance', 'ch-go');
    rig(s, [1, 1, 1]);
    const choose = act(s, 's0', { k: 'roll' }).state;
    const { state, events } = act(choose, 's0', { k: 'chooseSpace', space: 7 });
    expect(ofType(events, 'salary')).toHaveLength(2);
    expect(pos(state, 's0')).toBe(0);
    expect(state.phase.k).toBe('preRoll');
  });
});

describe('audit: Speed Die and jail', () => {
  it('Speed rule 7: the jail roll uses the white dice only; doubles free the player with no extra roll', () => {
    const s = speedy();
    setPos(s, 's0', 10);
    s.players.s0!.jail = { tries: 0 };
    rig(s, [2, 2, 3]);
    const { state, events } = act(s, 's0', { k: 'roll' });
    expect(ofType(events, 'dice')[0]).toMatchObject({ purpose: 'jail', w: [2, 2] });
    expect(ofType(events, 'dice')[0]?.s).toBeUndefined();
    expect(pos(state, 's0')).toBe(14);
    expect(act(state, 's0', { k: 'buy' }).state.phase.k).toBe('postRoll');
  });

  it('Speed rule 7: on the third failed try the fine is forced and the move uses the white dice only', () => {
    const s = speedy();
    setPos(s, 's0', 10);
    s.players.s0!.jail = { tries: 2 };
    rig(s, [1, 2, 3]);
    const { state, events } = act(s, 's0', { k: 'roll' });
    expect(ofType(events, 'dice')[0]?.s).toBeUndefined();
    expect(cashDelta(events, 's0')).toBe(-50);
    expect(pos(state, 's0')).toBe(13);
  });

  it('Speed rule 7: after paying the fine the roll is a normal one, Speed Die included', () => {
    const s = speedy();
    setPos(s, 's0', 10);
    s.players.s0!.jail = { tries: 0 };
    rig(s, [1, 2, 3]);
    const { state, events } = run(s, ['s0', { k: 'payFine' }], ['s0', { k: 'roll' }]);
    expect(ofType(events, 'dice')[0]?.s).toBe(3);
    expect(pos(state, 's0')).toBe(16);
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('audit: timed open auctions', () => {
  it('decision "Auctions": anyone bids at any time in any order; closes early once everyone else has passed', () => {
    const a = balticAuction();
    expect(a.phase).toMatchObject({ k: 'auction', eligible: ['s0', 's1', 's2'] });
    const { state, events } = run(
      a,
      ['s2', { k: 'bid', amount: 10 }],
      ['s0', { k: 'bid', amount: 20 }],
      ['s2', { k: 'bid', amount: 30 }],
      ['s1', { k: 'bid', amount: 40 }],
      ['s0', { k: 'pass' }],
      ['s2', { k: 'pass' }],
    );
    expect(state.props.p3).toEqual({ owner: 's1', level: 0 });
    expect(cash(state, 's1')).toBe(1460);
    expect(ofType(events, 'auctionEnd')).toEqual([
      { t: 'auctionEnd', lot: { k: 'prop', space: 3 }, winner: 's1', amount: 40 },
    ]);
    expect(state.phase.k).toBe('postRoll');
  });

  it('decision "Auctions": minimum bid Rs. 1, each bid beats the high bid; a pass is final', () => {
    const a = balticAuction();
    expect(refused(a, 's1', { k: 'bid', amount: 0 })).toBe('low');
    const b = act(a, 's1', { k: 'bid', amount: 1 }).state;
    expect(refused(b, 's2', { k: 'bid', amount: 1 })).toBe('low');
    const c = act(b, 's2', { k: 'pass' }).state;
    expect(refused(c, 's2', { k: 'bid', amount: 5 })).toBe('passed');
  });

  it('Buying rule: with no bids the bank keeps the property and the turn goes on', () => {
    const { state } = run(balticAuction(), ['s0', { k: 'pass' }], ['s1', { k: 'pass' }], ['s2', { k: 'pass' }]);
    expect(state.props.p3).toBeUndefined();
    expect(state.phase.k).toBe('postRoll');
  });

  it('Buying rule "pays in cash": a bid over cash is refused (all of it is fine); mortgaging mid-auction makes it affordable', () => {
    const a = balticAuction();
    setCash(a, 's1', 50);
    own(a, 's1', [39]);
    expect(refused(a, 's1', { k: 'bid', amount: 51 })).toBe('cash');
    const key = timer(a)?.key;
    const m = act(a, 's1', { k: 'mortgage', space: 39 }).state;
    expect(m.phase.k).toBe('auction');
    expect(timer(m)?.key).toBe(key);
    const { state } = run(m, ['s1', { k: 'bid', amount: 250 }], ['s0', { k: 'pass' }], ['s2', { k: 'pass' }]);
    expect(state.props.p3?.owner).toBe('s1');
    expect(cash(state, 's1')).toBe(0);
  });

  it('Selling rule "at any time": selling houses back to the bank mid-auction raises the cash for a bid', () => {
    const a = balticAuction();
    own(a, 's2', [6, 8, 9], { level: 2 });
    setCash(a, 's2', 10);
    expect(refused(a, 's2', { k: 'bid', amount: 100 })).toBe('cash');
    expect(refused(a, 's2', { k: 'build', group: 'lightBlue', levels: [3, 2, 2] })).toBe('phase');
    const sold = act(a, 's2', { k: 'sell', group: 'lightBlue', levels: [0, 0, 0] });
    expect(cashDelta(sold.events, 's2')).toBe(150);
    const { state } = run(sold.state, ['s2', { k: 'bid', amount: 160 }], ['s0', { k: 'pass' }], ['s1', { k: 'pass' }]);
    expect(state.props.p3?.owner).toBe('s2');
    expect(cash(state, 's2')).toBe(0);
  });

  it('decision "Auctions": only the system closes one, with the current basis; the high bidder then wins', () => {
    const a = act(balticAuction(), 's2', { k: 'bid', amount: 25 }).state;
    expect(refused(a, 's0', { k: 'closeAuction' })).toBe('badActor');
    expect(refused(a, 'system', { k: 'closeAuction' })).toBe('basis');
    expect(refused(a, 'system', { k: 'closeAuction' }, a.seq - 1)).toBe('stale');
    expect(timeoutCommand(a)).toEqual({ by: 'system', a: { k: 'closeAuction' }, basis: a.seq });
    const { state } = act(a, 'system', { k: 'closeAuction' }, a.seq);
    expect(state.props.p3?.owner).toBe('s2');
    expect(cash(state, 's2')).toBe(1475);
  });

  it('decision "Auctions": the countdown restarts on each bid, not on a pass', () => {
    const a = balticAuction();
    const k0 = timer(a);
    expect(k0?.kind).toBe('auction');
    const b = act(a, 's1', { k: 'bid', amount: 5 }).state;
    expect(timer(b)?.key).not.toBe(k0?.key);
    const c = act(b, 's2', { k: 'pass' }).state;
    expect(timer(c)?.key).toBe(timer(b)?.key);
  });

  it('decision "Auctions" (countdown resets on each bid) + README timer: a bidder leaving the game is not a bid and keeps the countdown', () => {
    const a = act(balticAuction(), 's1', { k: 'bid', amount: 5 }).state;
    const key = timer(a)?.key;
    const left = act(a, 's2', { k: 'resign' }).state;
    expect(left.phase).toMatchObject({ k: 'auction', high: { seat: 's1', amount: 5 } });
    expect(timer(left)?.key).toBe(key);
  });

  it('decision "Auctions": a seat that could not raise more than the high bid is passed; one that could mortgage is not', () => {
    const s = scenario({ n: 3 });
    setCash(s, 's2', 5);
    rig(s, [1, 2]);
    const a = run(s, ['s0', { k: 'roll' }], ['s0', { k: 'decline' }]).state;
    expect(ofType(act(a, 's1', { k: 'bid', amount: 10 }).events, 'pass')).toEqual([{ t: 'pass', seat: 's2', auto: true }]);

    const t = scenario({ n: 3 });
    setCash(t, 's2', 5);
    own(t, 's2', [39]);
    rig(t, [1, 2]);
    const b = run(t, ['s0', { k: 'roll' }], ['s0', { k: 'decline' }]).state;
    const after = act(b, 's1', { k: 'bid', amount: 10 }).state;
    expect(awaiting(after)).toContain('s2');
  });

  it('Buying rule: the decliner and a jailed player may bid; a doubles roll still rolls again after the auction', () => {
    const s = scenario({ n: 3 });
    setPos(s, 's0', 1);
    setPos(s, 's1', 10);
    s.players.s1!.jail = { tries: 1 };
    rig(s, [1, 1]);
    const a = run(s, ['s0', { k: 'roll' }], ['s0', { k: 'decline' }]).state;
    const { state } = run(
      a,
      ['s1', { k: 'bid', amount: 7 }],
      ['s0', { k: 'bid', amount: 8 }],
      ['s1', { k: 'pass' }],
      ['s2', { k: 'pass' }],
    );
    expect(state.props.p3?.owner).toBe('s0');
    expect(state.phase.k).toBe('preRoll');
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('audit: houses and hotels', () => {
  it('Bank rule: the bank starts with 32 houses and 12 hotels', () => {
    expect(scenario().bank).toEqual({ houses: 32, hotels: 12 });
  });

  it('Houses rule: build evenly, no street more than one house ahead of the others', () => {
    const s = scenario();
    own(s, 's0', [6, 8, 9]);
    const one = act(s, 's0', { k: 'build', group: 'lightBlue', levels: [1, 0, 0] }).state;
    expect(refused(one, 's0', { k: 'build', group: 'lightBlue', levels: [2, 0, 0] })).toBe('uneven');
    expect(refused(one, 's0', { k: 'build', group: 'lightBlue', levels: [2, 1, 0] })).toBe('uneven');
    const { state, events } = act(one, 's0', { k: 'build', group: 'lightBlue', levels: [2, 2, 1] });
    expect(cashDelta(events, 's0')).toBe(-200);
    expect(state.bank.houses).toBe(27);
  });

  it('Houses rule: only with the whole group, and never on a group with a mortgaged street', () => {
    const s = scenario();
    own(s, 's0', [6, 8]);
    expect(refused(s, 's0', { k: 'build', group: 'lightBlue', levels: [1, 1, 0] })).toBe('notOwner');
    const t = scenario();
    own(t, 's0', [6, 8, 9]);
    t.props.p6!.mortgaged = true;
    expect(refused(t, 's0', { k: 'build', group: 'lightBlue', levels: [1, 1, 1] })).toBe('mortgaged');
    const lifted = act(t, 's0', { k: 'unmortgage', space: 6 });
    expect(cashDelta(lifted.events, 's0')).toBe(-55);
    const built = act(lifted.state, 's0', { k: 'build', group: 'lightBlue', levels: [1, 1, 1] });
    expect(cashDelta(built.events, 's0')).toBe(-150);
  });

  it('Hotels rule: 4 houses on every street, the hotel returns its 4 houses, costs the house price, one per street', () => {
    const s = scenario();
    own(s, 's0', [6, 8, 9], { level: 4 });
    expect(s.bank.houses).toBe(20);
    const { state, events } = act(s, 's0', { k: 'build', group: 'lightBlue', levels: [5, 4, 4] });
    expect(state.bank).toEqual({ houses: 24, hotels: 11 });
    expect(cashDelta(events, 's0')).toBe(-50);
    const full = act(state, 's0', { k: 'build', group: 'lightBlue', levels: [5, 5, 5] }).state;
    expect(refused(full, 's0', { k: 'build', group: 'lightBlue', levels: [6, 5, 5] })).toBe('badLevels');

    const t = scenario();
    own(t, 's0', [6, 8], { level: 4 });
    own(t, 's0', [9], { level: 3 });
    expect(refused(t, 's0', { k: 'build', group: 'lightBlue', levels: [5, 4, 3] })).toBe('uneven');
    expect(cashDelta(act(t, 's0', { k: 'build', group: 'lightBlue', levels: [5, 4, 4] }).events, 's0')).toBe(-100);
  });

  it('Shortage rule: with no houses in the bank players wait; a hotel needs no house and frees 4 for others', () => {
    const s = scenario({ cfg: { houses: 12 } });
    own(s, 's0', [6, 8, 9], { level: 4 });
    own(s, 's1', [1, 3]);
    expect(refused(s, 's1', { k: 'build', group: 'brown', levels: [1, 0] })).toBe('noHouses');
    const hotel = act(s, 's0', { k: 'build', group: 'lightBlue', levels: [5, 4, 4] }).state;
    expect(hotel.bank.houses).toBe(4);
    const { state } = act(hotel, 's1', { k: 'build', group: 'brown', levels: [1, 1] });
    expect(state.props.p1?.level).toBe(1);
    expect(state.bank.houses).toBe(2);
  });

  it('Bank rule: 12 hotels at most (here 1): the next hotel is refused', () => {
    const s = scenario({ cfg: { hotels: 1 } });
    own(s, 's0', [6, 8, 9], { level: 4 });
    const one = act(s, 's0', { k: 'build', group: 'lightBlue', levels: [5, 4, 4] }).state;
    expect(one.bank.hotels).toBe(0);
    expect(refused(one, 's0', { k: 'build', group: 'lightBlue', levels: [5, 5, 4] })).toBe('noHotels');
  });

  it('Selling rule: evenly, at half price', () => {
    const s = scenario();
    own(s, 's0', [6, 8, 9], { level: 3 });
    expect(refused(s, 's0', { k: 'sell', group: 'lightBlue', levels: [3, 3, 1] })).toBe('uneven');
    const { state, events } = act(s, 's0', { k: 'sell', group: 'lightBlue', levels: [2, 2, 2] });
    expect(cashDelta(events, 's0')).toBe(75);
    expect(state.bank.houses).toBe(26);
  });

  it('Selling rule: a hotel back to houses needs 4 houses in the bank; (5,5,5) -> (0,0,0) works with an empty bank', () => {
    const s = scenario({ cfg: { houses: 0 } });
    own(s, 's0', [6, 8, 9], { level: 5 });
    expect(refused(s, 's0', { k: 'sell', group: 'lightBlue', levels: [4, 5, 5] })).toBe('noHouses');
    const { state, events } = act(s, 's0', { k: 'sell', group: 'lightBlue', levels: [0, 0, 0] });
    expect(cashDelta(events, 's0')).toBe(375);
    expect(state.bank).toEqual({ houses: 0, hotels: 12 });
    expect([6, 8, 9].map((x) => state.props[`p${x}`]?.level)).toEqual([0, 0, 0]);
  });

  it('Selling rule: breaking hotels takes the houses the target needs: (5,5,5)->(4,4,4) needs 12, (4,5,5) needs 4', () => {
    const s = scenario({ cfg: { houses: 11 } });
    own(s, 's0', [6, 8, 9], { level: 5 });
    expect(refused(s, 's0', { k: 'sell', group: 'lightBlue', levels: [4, 4, 4] })).toBe('noHouses');
    const { state, events } = act(s, 's0', { k: 'sell', group: 'lightBlue', levels: [4, 5, 5] });
    expect(state.bank).toEqual({ houses: 7, hotels: 10 });
    expect(cashDelta(events, 's0')).toBe(25);
  });

  it('Mortgages rule: no mortgage while any street of the group has buildings (even an unimproved one)', () => {
    const s = scenario();
    own(s, 's0', [6, 8, 9]);
    const built = act(s, 's0', { k: 'build', group: 'lightBlue', levels: [1, 1, 0] }).state;
    expect(refused(built, 's0', { k: 'mortgage', space: 9 })).toBe('buildings');
    const sold = act(built, 's0', { k: 'sell', group: 'lightBlue', levels: [0, 0, 0] }).state;
    expect(cashDelta(act(sold, 's0', { k: 'mortgage', space: 9 }).events, 's0')).toBe(60);
  });
});

describe('audit: building shortage contest', () => {
  it('decision "Shortage auction": a build that would leave a rival short opens a window; requests that fit are all granted', () => {
    const claim = shortageClaim();
    expect(claim.phase).toMatchObject({ k: 'buildClaim', kind: 'house', by: 's0', open: ['s1'] });
    expect(awaiting(claim)).toEqual(['s1']);
    expect(timer(claim)?.kind).toBe('decision');
    const granted = act(claim, 's1', { k: 'requestBuild', n: 2 }).state;
    expect([granted.props.p1?.level, granted.props.p3?.level]).toEqual([1, 1]);
    expect(granted.phase).toMatchObject({ k: 'place', seat: 's1', count: 2 });
    const { state } = run(granted, ['s1', { k: 'place', space: 6 }], ['s1', { k: 'place', space: 8 }]);
    expect(state.bank.houses).toBe(0);
    expect(cash(state, 's0')).toBe(1400);
    expect(cash(state, 's1')).toBe(1400);
    expect(state.phase.k).toBe('preRoll');
  });

  it('decision "Shortage auction": more wanted than the bank has: units auctioned one at a time; a unit nobody bids on ends it', () => {
    const claim = shortageClaim();
    const auc = act(claim, 's1', { k: 'requestBuild', n: 3 }).state;
    expect(auc.phase).toMatchObject({ k: 'auction', lot: { k: 'house' }, eligible: ['s0', 's1'] });
    const won = run(auc, ['s1', { k: 'bid', amount: 60 }], ['s0', { k: 'pass' }]).state;
    expect(won.phase).toMatchObject({ k: 'place', seat: 's1', count: 1, bid: 60 });
    const placed = act(won, 's1', { k: 'place', space: 9 });
    expect(cashDelta(placed.events, 's1')).toBe(0);
    expect(placed.state.phase).toMatchObject({ k: 'auction', lot: { k: 'house' } });
    const { state } = run(placed.state, ['s0', { k: 'pass' }], ['s1', { k: 'pass' }]);
    expect(state.phase.k).toBe('preRoll');
    expect(state.bank.houses).toBe(3);
    expect(cash(state, 's1')).toBe(1440);
    expect(cash(state, 's0')).toBe(1500);
  });

  it('decision "Shortage auction": the window freezes building and is closed by the system only', () => {
    const claim = shortageClaim();
    expect(refused(claim, 's1', { k: 'build', group: 'lightBlue', levels: [1, 0, 0] })).toBe('phase');
    expect(refused(claim, 's1', { k: 'closeClaim' })).toBe('badActor');
    expect(timeoutCommand(claim)).toEqual({ by: 'system', a: { k: 'closeClaim' }, basis: claim.seq });
    const { state } = act(claim, 'system', { k: 'closeClaim' }, claim.seq);
    expect([state.props.p1?.level, state.props.p3?.level]).toEqual([1, 1]);
    expect(state.phase.k).toBe('preRoll');
  });

  it('decision "Shortage auction": a request is capped by what the seat could build now', () => {
    const claim = shortageClaim(150);
    expect(claim.phase.k).toBe('buildClaim');
    expect(refused(claim, 's1', { k: 'requestBuild', n: 4 })).toBe('badCount');
    expect(refused(claim, 's1', { k: 'requestBuild', n: 0 })).toBe('badCount');
  });

  it('decision "Shortage auction": hotels too: one hotel left and a rival ready for two, it is auctioned and placed free', () => {
    const s = scenario({ cfg: { hotels: 1 } });
    own(s, 's0', [6, 8, 9], { level: 4 });
    own(s, 's1', [1, 3], { level: 4 });
    const claim = act(s, 's0', { k: 'build', group: 'lightBlue', levels: [5, 4, 4] }).state;
    expect(claim.phase).toMatchObject({ k: 'buildClaim', kind: 'hotel', open: ['s1'] });
    const auc = act(claim, 's1', { k: 'requestBuild', n: 1 }).state;
    expect(auc.phase).toMatchObject({ k: 'auction', lot: { k: 'hotel' }, eligible: ['s0', 's1'] });
    const won = run(auc, ['s0', { k: 'bid', amount: 10 }], ['s1', { k: 'bid', amount: 11 }], ['s0', { k: 'pass' }]).state;
    expect(won.phase).toMatchObject({ k: 'place', seat: 's1', kind: 'hotel', bid: 11 });
    const { state, events } = act(won, 's1', { k: 'place', space: 3 });
    expect(cashDelta(events, 's1')).toBe(0);
    expect(state.props.p3?.level).toBe(5);
    expect(state.bank).toEqual({ houses: 32 - 12 - 8 + 4, hotels: 0 });
    expect(state.phase.k).toBe('preRoll');
  });

  it('README shortage: a won unit that can no longer be placed (its group mortgaged meanwhile) is refunded', () => {
    const auc = act(shortageClaim(), 's1', { k: 'requestBuild', n: 3 }).state;
    const bid = act(auc, 's1', { k: 'bid', amount: 60 }).state;
    const mortgaged = act(bid, 's1', { k: 'mortgage', space: 9 }).state;
    const { state, events } = act(mortgaged, 's0', { k: 'pass' });
    expect(ofType(events, 'cash').filter((e) => e.why === 'refund')).toEqual([
      expect.objectContaining({ from: 'bank', to: 's1', amount: 60 }),
    ]);
    expect(state.props.p9?.level).toBe(0);
    // s1 can no longer build, so s0's two houses fit the supply: granted at the normal price.
    expect(state.phase).toMatchObject({ k: 'place', seat: 's0', kind: 'house', count: 2 });
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('audit: mortgages', () => {
  it('decision "Unmortgage cost": mortgage + ceil(10%): Power Cut Board Rs. 83, Pettah Pavement Rs. 33, Galle Face Penthouse Rs. 220', () => {
    const s = scenario();
    own(s, 's0', [1, 12, 39], { mortgaged: true });
    expect([1, 12, 39].map((x) => unmortgageCost(s, x))).toEqual([33, 83, 220]);
    const { events } = run(
      s,
      ['s0', { k: 'unmortgage', space: 12 }],
      ['s0', { k: 'unmortgage', space: 1 }],
      ['s0', { k: 'unmortgage', space: 39 }],
    );
    expect(cashDelta(events, 's0')).toBe(-(83 + 33 + 220));
  });

  it('Mortgages rule: the owner keeps it; nobody else may lift it', () => {
    const s = scenario();
    own(s, 's0', [39], { mortgaged: true });
    expect(refused(s, 's1', { k: 'unmortgage', space: 39 })).toBe('notOwner');
  });

  it('decision "Mortgaged property changing hands": after a trade, lift now (m + 10%) or 10% now and m + 10% later', () => {
    const xfer = tradedMortgages();
    expect(xfer.phase).toMatchObject({ k: 'mortgageXfer', seat: 's1', spaces: [5, 12] });
    expect(awaiting(xfer)).toEqual(['s1']);
    const settled = act(xfer, 's1', { k: 'settleMortgages', lift: [5] });
    expect(cashDelta(settled.events, 's1')).toBe(-(110 + 8));
    expect(settled.state.props.p5?.mortgaged).toBeUndefined();
    expect(settled.state.props.p12?.mortgaged).toBe(true);
    expect(settled.state.phase.k).toBe('preRoll');
    expect(cashDelta(act(settled.state, 's1', { k: 'unmortgage', space: 12 }).events, 's1')).toBe(-83);
  });

  it('decision "Mortgaged property changing hands": lifting is refused when the cash does not cover it', () => {
    const xfer = tradedMortgages();
    setCash(xfer, 's1', 100);
    expect(refused(xfer, 's1', { k: 'settleMortgages', lift: [5] })).toBe('cash');
    expect(refused(xfer, 's1', { k: 'settleMortgages', lift: [39] })).toBe('badLift');
    expect(cashDelta(act(xfer, 's1', { k: 'settleMortgages', lift: [] }).events, 's1')).toBe(-18);
  });

  it('decision "Mortgaged property changing hands": both sides receive mortgages: the proposer settles first, then the receiver', () => {
    const s = scenario();
    own(s, 's0', [5], { mortgaged: true });
    own(s, 's1', [15], { mortgaged: true });
    const offer = act(s, 's0', { k: 'propose', to: 's1', give: bundle({ props: [5] }), get: bundle({ props: [15] }) });
    const id = Object.keys(offer.state.trades)[0] as string;
    const x1 = act(offer.state, 's1', { k: 'accept', id }).state;
    expect(x1.phase).toMatchObject({ k: 'mortgageXfer', seat: 's0', spaces: [15] });
    const x2 = act(x1, 's0', { k: 'settleMortgages', lift: [] }).state;
    expect(x2.phase).toMatchObject({ k: 'mortgageXfer', seat: 's1', spaces: [5] });
    const done = act(x2, 's1', { k: 'settleMortgages', lift: [] });
    expect(cashDelta(done.events, 's1')).toBe(-10);
    expect(done.state.phase.k).toBe('preRoll');
  });
});

describe('audit: trades', () => {
  it('Selling rule: no property from a colour group with buildings, even its unimproved street, on either side', () => {
    const s = scenario();
    own(s, 's0', [6, 8, 9]);
    const built = act(s, 's0', { k: 'build', group: 'lightBlue', levels: [1, 1, 0] }).state;
    expect(
      refused(built, 's0', { k: 'propose', to: 's1', give: bundle({ props: [9] }), get: bundle({ cash: 100 }) }),
    ).toBe('buildings');
    expect(
      refused(built, 's1', { k: 'propose', to: 's0', give: bundle({ cash: 100 }), get: bundle({ props: [9] }) }),
    ).toBe('buildings');
  });

  it('Selling rule: re-validated on accept: building after the offer, or spending the offered cash, makes it fail', () => {
    const s = scenario();
    own(s, 's0', [6, 8, 9]);
    own(s, 's1', [39]);
    const offer = act(s, 's0', { k: 'propose', to: 's1', give: bundle({ cash: 1400, props: [9] }), get: bundle({ props: [39] }) });
    const id = Object.keys(offer.state.trades)[0] as string;
    const built = act(offer.state, 's0', { k: 'build', group: 'lightBlue', levels: [1, 1, 1] }).state;
    expect(refused(built, 's1', { k: 'accept', id })).toBe('cash');
    const sold = act(built, 's0', { k: 'sell', group: 'lightBlue', levels: [0, 0, 0] }).state;
    // Selling back refunds half: 1500 - 150 + 75 = 1425 still covers 1400, and the group is bare again.
    expect(act(sold, 's1', { k: 'accept', id }).state.props.p39?.owner).toBe('s0');
    const b2 = act(offer.state, 's0', { k: 'build', group: 'lightBlue', levels: [1, 0, 0] }).state;
    expect(refused(b2, 's1', { k: 'accept', id })).toBe('buildings');
  });

  it('Jail exit 3 / Cards rule: a jailed player buys a Get Out of Jail Free card, uses it, and it returns to its own deck', () => {
    const s = scenario();
    s.decks.chest = s.decks.chest.filter((id) => id !== 'cc-goojf');
    s.players.s1!.goojf = ['cc-goojf'];
    setPos(s, 's0', 10);
    s.players.s0!.jail = { tries: 0 };
    const offer = act(s, 's0', { k: 'propose', to: 's1', give: bundle({ cash: 50 }), get: bundle({ cards: ['cc-goojf'] }) });
    const id = Object.keys(offer.state.trades)[0] as string;
    const bought = act(offer.state, 's1', { k: 'accept', id }).state;
    expect(bought.players.s0?.goojf).toEqual(['cc-goojf']);
    expect(cash(bought, 's1')).toBe(1550);
    const used = act(bought, 's0', { k: 'useCard' }).state;
    expect(used.players.s0?.jail).toBeUndefined();
    expect(used.decks.chest.at(-1)).toBe('cc-goojf');
    expect(used.phase.k).toBe('preRoll');
  });

  it('Cards rule (card sale) re-validated on accept: a card used after it was offered can no longer be sold', () => {
    const s = scenario();
    s.decks.chance = s.decks.chance.filter((id) => id !== 'ch-goojf');
    s.players.s0!.goojf = ['ch-goojf'];
    setPos(s, 's0', 10);
    s.players.s0!.jail = { tries: 0 };
    const offer = act(s, 's0', { k: 'propose', to: 's1', give: bundle({ cards: ['ch-goojf'] }), get: bundle({ cash: 50 }) });
    const id = Object.keys(offer.state.trades)[0] as string;
    const used = act(offer.state, 's0', { k: 'useCard', card: 'ch-goojf' }).state;
    expect(used.decks.chance.at(-1)).toBe('ch-goojf');
    expect(refused(used, 's1', { k: 'accept', id })).toBe('noCard');
  });

  it('Miscellaneous rule: no player-to-player loans (cash for nothing, nothing for cash, cash for cash)', () => {
    const s = scenario();
    const offer = (give: number, get: number) => ({
      k: 'propose' as const,
      to: 's1' as const,
      give: bundle({ cash: give }),
      get: bundle({ cash: get }),
    });
    expect(refused(s, 's0', offer(100, 0))).toBe('loan');
    expect(refused(s, 's0', offer(0, 100))).toBe('loan');
    expect(refused(s, 's0', offer(100, 150))).toBe('loan');
    expect(refused(s, 's0', offer(0, 0))).toBe('empty');
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('audit: bankruptcy to a player', () => {
  /** s0 (cash 100; light blues with a house each, mortgaged Reading, a Get Out of Jail Free card) hits s1's Galle Face Penthouse hotel */
  function broke(): GameState {
    const s = scenario({ n: 3 });
    own(s, 's1', [37, 39], { level: 5 });
    own(s, 's0', [6, 8, 9], { level: 1 });
    own(s, 's0', [5], { mortgaged: true });
    s.decks.chest = s.decks.chest.filter((id) => id !== 'cc-goojf');
    s.players.s0!.goojf = ['cc-goojf'];
    setCash(s, 's0', 100);
    setPos(s, 's0', 35);
    rig(s, [1, 3]);
    return act(s, 's0', { k: 'roll' }).state;
  }

  it('Bankruptcy rule: bankrupt only when owing more than selling and mortgaging everything could raise', () => {
    const d = broke();
    expect(d.phase).toMatchObject({ k: 'debt', debtor: 's0', owed: { s1: 2000 } });
    expect(maxRaise(d, 's0')).toBe(100 + 75 + 160);
    const ok = penthouseDebt(10, [37]);
    expect(refused(ok, 's0', { k: 'bankrupt' })).toBe('canPay');
  });

  it('Bankruptcy to a player: buildings back to the bank at half price paid to the creditor; cash, deeds and cards follow', () => {
    const { state, events } = act(broke(), 's0', { k: 'bankrupt' });
    expect(cash(state, 's1')).toBe(1500 + 75 + 100);
    expect(state.bank.houses).toBe(32);
    for (const x of [5, 6, 8, 9]) expect(state.props[`p${x}`]).toMatchObject({ owner: 's1', level: 0 });
    expect(state.props.p5?.mortgaged).toBe(true);
    expect(state.players.s1?.goojf).toEqual(['cc-goojf']);
    expect(state.players.s0).toMatchObject({ out: 'bankrupt', cash: 0, goojf: [] });
    expect(ofType(events, 'bankrupt')).toEqual([{ t: 'bankrupt', seat: 's0', to: 's1', resigned: false }]);
    expect(state.phase).toMatchObject({ k: 'mortgageXfer', seat: 's1', spaces: [5] });
  });

  it('Bankruptcy to a player: the creditor pays 10% on a received mortgage at once (or lifts it at m + 10%), then the next seat plays', () => {
    const xfer = act(broke(), 's0', { k: 'bankrupt' }).state;
    const keep = act(xfer, 's1', { k: 'settleMortgages', lift: [] });
    expect(cashDelta(keep.events, 's1')).toBe(-10);
    expect(keep.state.turn).toMatchObject({ seat: 's1', no: 2 });
    expect(keep.state.phase.k).toBe('preRoll');
    expect(cashDelta(act(keep.state, 's1', { k: 'unmortgage', space: 5 }).events, 's1')).toBe(-110);
    expect(cashDelta(act(xfer, 's1', { k: 'settleMortgages', lift: [5] }).events, 's1')).toBe(-110);
  });

  it('Bankruptcy to a player: a broke non-turn payer of "collect from every player" goes out; the others still pay; turns skip it', () => {
    const s = scenario({ n: 3 });
    own(s, 's0', [9]);
    stack(s, 'chest', 'cc-wedding');
    setCash(s, 's1', 10);
    rig(s, [1, 1], [3, 4]);
    const debt = act(s, 's0', { k: 'roll' }).state;
    expect(debt.phase).toMatchObject({ k: 'debt', debtor: 's1', owed: { s0: 50 } });
    const after = act(debt, 's1', { k: 'bankrupt' }).state;
    expect(after.players.s1?.out).toBe('bankrupt');
    expect(cash(after, 's0')).toBe(1500 + 10 + 50);
    expect(cash(after, 's2')).toBe(1450);
    expect(after.phase.k).toBe('preRoll');
    const { state } = run(after, ['s0', { k: 'roll' }], ['s0', { k: 'endTurn' }]);
    expect(state.turn).toMatchObject({ seat: 's2', no: 2 });
  });
});

describe('audit: bankruptcy to the bank', () => {
  /** s1 (turn seat, mid-doubles, no cash, mortgaged browns, a Chance card) lands on Luxury Tax */
  function taxed(cfgLux?: number, built = false): GameState {
    const s = scenario({ n: 3, cfg: cfgLux ? { luxuryTax: cfgLux } : {} });
    s.turn = { seat: 's1', no: 2, doubles: 0, again: false };
    if (built) own(s, 's1', [1, 3], { level: 2 });
    else own(s, 's1', [1, 3], { mortgaged: true });
    s.decks.chance = s.decks.chance.filter((id) => id !== 'ch-goojf');
    s.players.s1!.goojf = ['ch-goojf'];
    setCash(s, 's1', 0);
    setPos(s, 's1', 36);
    rig(s, [1, 1]);
    return act(s, 's1', { k: 'roll' }).state;
  }

  it('Bankruptcy to the Bank + decision: mortgages cleared, card returned, property auctioned in turn, then the next seat', () => {
    const d = taxed();
    expect(d.phase).toMatchObject({ k: 'debt', debtor: 's1', owed: { bank: 75 } });
    const b = act(d, 's1', { k: 'bankrupt' });
    expect(ofType(b.events, 'mortgage')).toEqual([
      { t: 'mortgage', space: 1, on: false },
      { t: 'mortgage', space: 3, on: false },
    ]);
    expect(b.state.decks.chance.at(-1)).toBe('ch-goojf');
    expect(b.state.phase).toMatchObject({ k: 'auction', lot: { k: 'prop', space: 1 }, eligible: ['s0', 's2'], queue: [3] });
    const won = run(b.state, ['s2', { k: 'bid', amount: 10 }], ['s0', { k: 'pass' }]).state;
    expect(won.props.p1).toEqual({ owner: 's2', level: 0 });
    expect(won.phase).toMatchObject({ k: 'auction', lot: { k: 'prop', space: 3 } });
    const { state } = run(won, ['s0', { k: 'pass' }], ['s2', { k: 'pass' }]);
    expect(state.props.p3).toBeUndefined();
    // s1 rolled doubles, but it is out: the turn goes to the next seat.
    expect(state.turn).toMatchObject({ seat: 's2', no: 3 });
    expect(state.phase.k).toBe('preRoll');
  });

  it('Bankruptcy to the Bank: buildings go back to the bank (not auctioned); only the deeds are auctioned', () => {
    const d = taxed(2000, true);
    expect(d.phase).toMatchObject({ k: 'debt', debtor: 's1', owed: { bank: 2000 } });
    const { state } = act(d, 's1', { k: 'bankrupt' });
    expect(state.bank.houses).toBe(32);
    expect(state.phase).toMatchObject({ k: 'auction', lot: { k: 'prop', space: 1 }, queue: [3] });
    const won = run(state, ['s0', { k: 'bid', amount: 5 }], ['s2', { k: 'pass' }]).state;
    expect(won.props.p1).toEqual({ owner: 's0', level: 0 });
  });
});

describe('audit: several creditors', () => {
  /** s0 (cash `left`, owning `props`) draws Chairman of the Board: pay s1 and s2 Rs. 50 each */
  function chairman(left: number, props: number[]): GameState {
    const s = scenario({ n: 3 });
    own(s, 's0', props);
    setCash(s, 's0', left);
    setPos(s, 's0', 4);
    stack(s, 'chance', 'ch-chairman');
    rig(s, [1, 2]);
    return act(s, 's0', { k: 'roll' }).state;
  }

  it('decision "Several creditors": raises what it can, pays in seat order, the rest is a bankruptcy to the bank', () => {
    const d = chairman(20, [1]);
    expect(d.phase).toMatchObject({ k: 'debt', debtor: 's0', owed: { s1: 50, s2: 50 } });
    const { state, events } = act(d, 's0', { k: 'bankrupt' });
    expect(cash(state, 's1')).toBe(1550);
    expect(cash(state, 's2')).toBe(1500);
    expect(ofType(events, 'bankrupt')).toEqual([{ t: 'bankrupt', seat: 's0', to: 'bank', resigned: false }]);
    expect(state.phase).toMatchObject({ k: 'auction', lot: { k: 'prop', space: 1 }, eligible: ['s1', 's2'] });
  });

  it('decision "Several creditors": when selling and mortgaging covers it, bankruptcy is refused and autoRaise pays all', () => {
    const d = chairman(20, [39]);
    expect(refused(d, 's0', { k: 'bankrupt' })).toBe('canPay');
    const { state } = act(d, 's0', { k: 'autoRaise' });
    expect([cash(state, 's0'), cash(state, 's1'), cash(state, 's2')]).toEqual([120, 1550, 1550]);
    expect(state.props.p39?.mortgaged).toBe(true);
    expect(state.phase.k).toBe('postRoll');
  });
});

describe('audit: resigning', () => {
  it('README resign decision: in a debt the assets cover, the creditor is paid in full; the rest goes to the bank and is auctioned', () => {
    const d = penthouseDebt(10, [37]);
    expect(d.phase).toMatchObject({ k: 'debt', debtor: 's0', owed: { s1: 50 } });
    const { state, events } = act(d, 's0', { k: 'resign' });
    expect(cash(state, 's1')).toBe(1550);
    expect(state.players.s0).toMatchObject({ out: 'resigned', cash: 0 });
    expect(ofType(events, 'bankrupt')).toEqual([{ t: 'bankrupt', seat: 's0', to: 'bank', resigned: true }]);
    expect(state.phase).toMatchObject({ k: 'auction', lot: { k: 'prop', space: 37 }, eligible: ['s1', 's2'] });
    const after = run(state, ['s1', { k: 'pass' }], ['s2', { k: 'pass' }]).state;
    expect(after.turn.seat).toBe('s1');
    expect(after.phase.k).toBe('preRoll');
  });

  it('README resign decision: in a debt the assets cannot cover, it is a bankruptcy to the creditor', () => {
    const d = penthouseDebt(10, [1]);
    const { state, events } = act(d, 's0', { k: 'resign' });
    expect(ofType(events, 'bankrupt')).toEqual([{ t: 'bankrupt', seat: 's0', to: 's1', resigned: true }]);
    expect(state.props.p1?.owner).toBe('s1');
    expect(cash(state, 's1')).toBe(1510);
    expect(state.turn.seat).toBe('s1');
  });

  it('README bankruptcy: a creditor who resigns mid-debt leaves its share to the bank, so the debtor then goes bankrupt to the bank', () => {
    const d = penthouseDebt(10, [1]);
    const resigned = act(d, 's1', { k: 'resign' }).state;
    // s1's Galle Face Penthouse is auctioned first, then the debt resumes.
    expect(resigned.phase).toMatchObject({ k: 'auction', lot: { k: 'prop', space: 39 }, resume: { k: 'debt' } });
    const gone = run(resigned, ['s0', { k: 'pass' }], ['s2', { k: 'pass' }]).state;
    expect(gone.phase).toMatchObject({ k: 'debt', debtor: 's0', owed: { bank: 50 } });
    const { state, events } = act(gone, 's0', { k: 'bankrupt' });
    expect(ofType(events, 'bankrupt')).toEqual([{ t: 'bankrupt', seat: 's0', to: 'bank', resigned: false }]);
    expect(state.phase).toEqual(expect.objectContaining({ k: 'over', winner: 's2' }));
  });

  it('README resign: outside a debt everything goes to the bank (buildings back, deeds auctioned) and the turn passes on', () => {
    const s = scenario({ n: 3 });
    own(s, 's0', [1, 3], { level: 1 });
    own(s, 's0', [5], { mortgaged: true });
    const { state } = act(s, 's0', { k: 'resign' });
    expect(state.players.s0).toMatchObject({ out: 'resigned', cash: 0 });
    expect(state.bank.houses).toBe(32);
    expect(state.phase).toMatchObject({ k: 'auction', lot: { k: 'prop', space: 1 }, eligible: ['s1', 's2'], queue: [3, 5] });
    const pass2: [SeatId, Action][] = [['s1', { k: 'pass' }], ['s2', { k: 'pass' }]];
    const after = run(state, ...pass2, ...pass2, ...pass2).state;
    expect([1, 3, 5].map((x) => after.props[`p${x}`])).toEqual([undefined, undefined, undefined]);
    expect(after.turn).toMatchObject({ seat: 's1', no: 2 });
    expect(after.phase.k).toBe('preRoll');
  });
});

describe('audit: end of the game', () => {
  it('Object rule: the last player left wins (no mortgage settlement once the game is over)', () => {
    const s = scenario();
    own(s, 's1', [39]);
    own(s, 's0', [5], { mortgaged: true });
    setCash(s, 's0', 10);
    setPos(s, 's0', 35);
    rig(s, [1, 3]);
    const d = act(s, 's0', { k: 'roll' }).state;
    const { state } = act(d, 's0', { k: 'bankrupt' });
    expect(state.phase).toEqual({ k: 'over', winner: 's1', ranking: ['s1', 's0'], why: 'lastStanding' });
    expect(refused(state, 's1', { k: 'roll' })).toBe('over');
    expect(timer(state)).toBeNull();
    expect(timeoutCommand(state)).toBeNull();
    expect(awaiting(state)).toEqual([]);
  });

  it('Object rule: resignations end the game only when one player is left; ranking is last out first', () => {
    const s = scenario({ n: 3 });
    const one = act(s, 's2', { k: 'resign' }).state;
    expect(one.phase.k).toBe('preRoll');
    const two = act(one, 's1', { k: 'resign' }).state;
    expect(two.phase).toEqual({ k: 'over', winner: 's0', ranking: ['s0', 's1', 's2'], why: 'lastStanding' });
  });

  it('decision "Turn limit": the game ends when turn N ends, ranked by net worth (ties in turn order)', () => {
    const s = scenario({ n: 3, cfg: { turnLimit: 2 } });
    setCash(s, 's2', 2000);
    setPos(s, 's1', 17);
    rig(s, [1, 2], [1, 2]);
    const t1 = run(s, ['s0', { k: 'roll' }], ['s0', { k: 'buy' }], ['s0', { k: 'endTurn' }]).state;
    expect(t1.phase.k).toBe('preRoll');
    expect(t1.turn).toMatchObject({ seat: 's1', no: 2 });
    const { state } = run(t1, ['s1', { k: 'roll' }], ['s1', { k: 'endTurn' }]);
    expect(state.phase).toEqual({ k: 'over', winner: 's2', ranking: ['s2', 's0', 's1'], why: 'turnLimit' });
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('audit: timers and timeouts', () => {
  const waiting: [string, TimerInfo['kind'], () => GameState][] = [
    ['preRoll', 'turn', () => scenario({ n: 3 })],
    [
      'preRoll in jail, third try, short of the fine',
      'turn',
      () => {
        const s = scenario({ n: 3 });
        setPos(s, 's0', 10);
        s.players.s0!.jail = { tries: 2 };
        setCash(s, 's0', 20);
        rig(s, [1, 2]);
        return s;
      },
    ],
    [
      'bus',
      'decision',
      () => {
        const s = speedy(3);
        rig(s, [3, 4, 'bus']);
        return act(s, 's0', { k: 'roll' }).state;
      },
    ],
    [
      'chooseSpace',
      'decision',
      () => {
        const s = speedy(3);
        setPos(s, 's0', 33);
        rig(s, [2, 2, 2]);
        return act(s, 's0', { k: 'roll' }).state;
      },
    ],
    [
      'chooseSpace on GO with nothing left to buy',
      'decision',
      () => {
        const s = speedy(3);
        own(s, 's1', ALL_PROPS);
        rig(s, [1, 1, 1]);
        return act(s, 's0', { k: 'roll' }).state;
      },
    ],
    [
      'buy',
      'decision',
      () => {
        const s = scenario({ n: 3 });
        rig(s, [1, 2]);
        return act(s, 's0', { k: 'roll' }).state;
      },
    ],
    [
      'incomeTax',
      'decision',
      () => {
        const s = scenario({ n: 3 });
        rig(s, [1, 3]);
        return act(s, 's0', { k: 'roll' }).state;
      },
    ],
    [
      'postRoll',
      'turn',
      () => {
        const s = scenario({ n: 3 });
        setPos(s, 's0', 17);
        rig(s, [1, 2]);
        return act(s, 's0', { k: 'roll' }).state;
      },
    ],
    ['auction', 'auction', () => act(balticAuction(), 's1', { k: 'bid', amount: 10 }).state],
    ['buildClaim', 'decision', () => shortageClaim()],
    ['place', 'decision', () => act(shortageClaim(), 's1', { k: 'requestBuild', n: 2 }).state],
    ['mortgageXfer', 'decision', () => tradedMortgages()],
    ['debt that can be raised', 'debt', () => penthouseDebt(10, [37])],
    ['debt that cannot be raised', 'debt', () => penthouseDebt(10, [1])],
  ];

  for (const [name, kind, build] of waiting) {
    it(`timer/timeoutCommand/defaultAction contract in ${name}: kind ${kind}, default legal, timeout applies`, () => {
      const s = build();
      expect(timer(s)?.kind).toBe(kind);
      const seats = awaiting(s);
      expect(seats.length).toBeGreaterThan(0);
      for (const seat of seats) {
        const d = defaultAction(s, seat);
        expect(d).not.toBeNull();
        expect(legalActions(s, seat)).toContainEqual(d);
      }
      const cmd = timeoutCommand(s);
      expect(cmd?.basis).toBe(s.seq);
      const r = apply(s, cmd!, { check: true });
      if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
      expect(r.state.seq).toBe(s.seq + 1);
      // A duplicate timeout from a second driver is stale.
      expect(apply(r.state, cmd!).ok).toBe(false);
    });
  }

  it('README defaultAction: a triple times out to the next bank property ahead, else GO, or Free Parking when on GO', () => {
    const s = speedy();
    setPos(s, 's0', 33);
    rig(s, [2, 2, 2]);
    expect(defaultAction(act(s, 's0', { k: 'roll' }).state, 's0')).toEqual({ k: 'chooseSpace', space: 34 });
    const t = speedy();
    own(t, 's1', ALL_PROPS);
    setPos(t, 's0', 33);
    rig(t, [2, 2, 2]);
    expect(defaultAction(act(t, 's0', { k: 'roll' }).state, 's0')).toEqual({ k: 'chooseSpace', space: 0 });
    const u = speedy();
    own(u, 's1', ALL_PROPS);
    rig(u, [1, 1, 1]);
    expect(defaultAction(act(u, 's0', { k: 'roll' }).state, 's0')).toEqual({ k: 'chooseSpace', space: 20 });
  });

  it('README forced: only the awaited seat\'s default move, sent by the system with the current basis', () => {
    const s = scenario({ n: 3 });
    rig(s, [1, 2]);
    const buy = act(s, 's0', { k: 'roll' }).state;
    expect(refused(buy, 'system', { k: 'forced', seat: 's0', a: { k: 'buy' } }, buy.seq)).toBe('notDefault');
    expect(refused(buy, 'system', { k: 'forced', seat: 's1', a: { k: 'decline' } }, buy.seq)).toBe('notAwaited');
    expect(refused(buy, 'system', { k: 'forced', seat: 's0', a: { k: 'decline' } }, buy.seq - 1)).toBe('stale');
    expect(refused(buy, 's1', { k: 'forced', seat: 's0', a: { k: 'decline' } })).toBe('badActor');
    const { state, events } = act(buy, 'system', { k: 'forced', seat: 's0', a: { k: 'decline' } }, buy.seq);
    expect(ofType(events, 'timeout')).toEqual([{ t: 'timeout', seat: 's0', a: { k: 'decline' } }]);
    expect(state.phase.k).toBe('auction');
  });

  it('README timer: the turn timer restarts when preRoll is re-entered after doubles, not when another seat mortgages', () => {
    const s = scenario();
    own(s, 's1', [39]);
    setPos(s, 's0', 18);
    const k0 = timer(s);
    const m = act(s, 's1', { k: 'mortgage', space: 39 }).state;
    expect(timer(m)).toEqual(k0);
    rig(m, [1, 1]);
    const again = act(m, 's0', { k: 'roll' }).state;
    expect(again.phase.k).toBe('preRoll');
    expect(timer(again)?.key).not.toBe(k0?.key);
  });
});
