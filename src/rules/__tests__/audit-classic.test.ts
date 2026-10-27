import { describe, expect, it } from 'vitest';
import { LANKA, checkInvariants, createGame, incomeTaxAmounts, rentFor, worth } from '..';
import type { Deck, GameEvent, GameState, SeatId } from '../types';
import {
  SEATS,
  act,
  cash,
  cashDelta,
  ofType,
  own,
  pos,
  refused,
  rig,
  run,
  scenario,
  setCash,
  setPos,
  stack,
  type Step,
} from './helpers';

/*
 * Adversarial audit of the Classic rules (docs/rules.md, "Classic rules" and "Rules decisions"). Every test names
 * the rule it checks. Scenarios use the debug rig and real commands only; state is edited only to set up a position.
 */

const seatsOf = (n: number): { id: SeatId; name: string }[] => SEATS.slice(0, n).map((id, i) => ({ id, name: `P${i}` }));

/** Puts a seat in jail with `tries` failed rolls so far */
function jail(s: GameState, seat: SeatId, tries = 0): void {
  const p = s.players[seat];
  if (!p) throw new Error(`no ${seat}`);
  p.pos = 10;
  p.jail = { tries };
}

/** A seat holds a Get Out of Jail Free card (taken out of its deck) */
function hold(s: GameState, seat: SeatId, id: string): void {
  s.decks.chance = s.decks.chance.filter((x) => x !== id);
  s.decks.chest = s.decks.chest.filter((x) => x !== id);
  s.players[seat]?.goojf.push(id);
}

/** The seat walks 4 -> Chance 7 or 14 -> Community Chest 17 with (1,2) and draws `card` */
function draw(s: GameState, deck: Deck, card: string, seat: SeatId = 's0'): Step {
  setPos(s, seat, deck === 'chance' ? 4 : 14);
  stack(s, deck, card);
  rig(s, [1, 2]);
  return act(s, seat, { k: 'roll' });
}

/** From `from`, roll `dice` (s0), optionally with a card on top of a deck */
function rollFrom(s: GameState, from: number, dice: [number, number], top?: [Deck, string]): Step {
  setPos(s, 's0', from);
  if (top) stack(s, top[0], top[1]);
  rig(s, dice);
  return act(s, 's0', { k: 'roll' });
}

const rentPaid = (events: GameEvent[], from: SeatId = 's0'): number =>
  ofType(events, 'cash')
    .filter((e) => e.why === 'rent' && e.from === from)
    .reduce((a, e) => a + e.amount, 0);

const salaries = (events: GameEvent[]): number => ofType(events, 'salary').length;

// ---------------------------------------------------------------------------------------------------------------

describe('audit: preparation and turn order', () => {
  it('Preparation: everyone starts with Rs. 1,500 on GO, no cards, no jail; the bank holds 32 houses and 12 hotels', () => {
    const { state } = createGame(undefined, seatsOf(4), 11);
    for (const seat of SEATS.slice(0, 4)) {
      const p = state.players[seat];
      expect(p).toMatchObject({ cash: 1500, pos: 0, goojf: [], speed: false });
      expect(p?.jail).toBeUndefined();
      expect(p?.out).toBeUndefined();
    }
    expect(state.bank).toEqual({ houses: 32, hotels: 12 });
    expect(state.props).toEqual({});
    expect(state.phase).toEqual({ k: 'preRoll' });
    expect(state.turn).toEqual({ seat: state.order[0], no: 1, doubles: 0, again: false });
    expect(checkInvariants(state)).toEqual([]);
  });

  it('Preparation: Chance and Community Chest are the full 16-card decks, shuffled', () => {
    const printed = { chance: LANKA.chance.map((c) => c.id), chest: LANKA.chest.map((c) => c.id) };
    const seen = { chance: new Set<string>(), chest: new Set<string>() };
    for (let seed = 1; seed <= 8; seed++) {
      const { state } = createGame(undefined, seatsOf(2), seed);
      for (const deck of ['chance', 'chest'] as const) {
        expect(state.decks[deck]).toHaveLength(16);
        expect([...state.decks[deck]].sort()).toEqual([...printed[deck]].sort());
        seen[deck].add(state.decks[deck].join());
      }
    }
    for (const deck of ['chance', 'chest'] as const) {
      expect(seen[deck].size).toBeGreaterThan(1);
      expect([...seen[deck]].some((order) => order !== printed[deck].join())).toBe(true);
    }
  });

  it('Play / Turn order ties: the highest opening roll starts, only the tied leaders re-roll, play passes left', () => {
    const ids = SEATS.slice(0, 4);
    let reRolls = 0;
    const firsts = new Set<SeatId>();
    for (let seed = 1; seed <= 300; seed++) {
      const { state, events } = createGame(undefined, seatsOf(4), seed);
      const dice = ofType(events, 'dice');
      expect(dice.every((d) => d.purpose === 'order')).toBe(true);
      let tied: SeatId[] = [...ids];
      let i = 0;
      while (tied.length > 1) {
        const round = dice.slice(i, i + tied.length);
        i += tied.length;
        expect(round.map((d) => d.seat)).toEqual(tied);
        const best = Math.max(...round.map((d) => d.total));
        tied = round.filter((d) => d.total === best).map((d) => d.seat);
        if (tied.length > 1) reRolls++;
      }
      expect(i).toBe(dice.length);
      const first = tied[0] as SeatId;
      firsts.add(first);
      const at = ids.indexOf(first);
      expect(state.order).toEqual([...ids.slice(at), ...ids.slice(0, at)]);
      expect(state.turn.seat).toBe(first);
      expect(ofType(events, 'order')[0]?.order).toEqual(state.order);
    }
    expect(reRolls).toBeGreaterThan(0);
    expect(firsts.size).toBe(4);
  });

  it('Play: turns pass to the left from the opening winner, round and round', () => {
    let seed = 1;
    while (createGame({ debug: true }, seatsOf(4), seed).state.order[0] !== 's2') seed++;
    let s = createGame({ debug: true }, seatsOf(4), seed).state;
    const seen: SeatId[] = [];
    for (let k = 0; k < 5; k++) {
      seen.push(s.turn.seat);
      // 0 -> 10 (Just Visiting) -> 20 (Free Parking): nothing to resolve
      rig(s, [4, 6]);
      s = run(s, [s.turn.seat, { k: 'roll' }], [s.turn.seat, { k: 'endTurn' }]).state;
    }
    expect(seen).toEqual(['s2', 's3', 's0', 's1', 's2']);
    expect(s.turn.no).toBe(6);
  });

  it('Play: a player who is out is skipped', () => {
    let s = scenario({ n: 4 });
    s = act(s, 's2', { k: 'resign' }).state;
    rig(s, [4, 6], [4, 6]);
    s = run(s, ['s0', { k: 'roll' }], ['s0', { k: 'endTurn' }], ['s1', { k: 'roll' }], ['s1', { k: 'endTurn' }]).state;
    expect(s.turn.seat).toBe('s3');
  });

  it('Play: several tokens may share a space', () => {
    const s = scenario();
    setPos(s, 's1', 10);
    const { state, events } = rollFrom(s, 7, [1, 2]);
    expect([pos(state, 's0'), pos(state, 's1')]).toEqual([10, 10]);
    expect(ofType(events, 'cash')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('audit: doubles', () => {
  it('Doubles: move, resolve the space fully (decline -> auction), then roll again', () => {
    const s = scenario();
    rig(s, [3, 3]);
    let st = act(s, 's0', { k: 'roll' }).state;
    expect(st.phase).toEqual({ k: 'buy', space: 6 });
    st = run(st, ['s0', { k: 'decline' }], ['s1', { k: 'bid', amount: 10 }], ['s0', { k: 'pass' }]).state;
    expect(st.props.p6?.owner).toBe('s1');
    expect(st.phase.k).toBe('preRoll');
    expect(st.turn).toMatchObject({ seat: 's0', doubles: 1 });
    rig(st, [1, 2]);
    st = run(st, ['s0', { k: 'roll' }], ['s0', { k: 'buy' }]).state;
    expect(st.props.p9?.owner).toBe('s0');
    expect(st.phase.k).toBe('postRoll');
  });

  it('Doubles: after doubles the turn cannot be ended; the player must roll again', () => {
    const { state } = rollFrom(scenario(), 0, [5, 5]);
    expect(state.phase.k).toBe('preRoll');
    expect(state.turn.seat).toBe('s0');
    expect(refused(state, 's0', { k: 'endTurn' })).toBe('phase');
  });

  it('Doubles: the double re-roll survives a debt the roller settles by mortgaging', () => {
    const s = scenario();
    setCash(s, 's0', 0);
    own(s, 's0', [39]);
    own(s, 's1', [6]);
    rig(s, [3, 3]);
    const r = act(s, 's0', { k: 'roll' });
    expect(r.state.phase).toMatchObject({ k: 'debt', debtor: 's0', owed: { s1: 6 } });
    const after = act(r.state, 's0', { k: 'mortgage', space: 39 }).state;
    expect(after.phase.k).toBe('preRoll');
    expect(cash(after, 's0')).toBe(240 - 6);
  });

  it('Doubles: the three-doubles count is per turn (2 doubles on each of two turns is no jail)', () => {
    let s = scenario();
    own(s, 's0', [23, 35]);
    stack(s, 'chest', 'cc-contest');
    rig(s, [5, 5], [5, 5], [1, 2], [4, 6], [5, 5], [1, 1], [1, 2]);
    s = run(s, ['s0', { k: 'roll' }], ['s0', { k: 'roll' }], ['s0', { k: 'roll' }]).state;
    expect([pos(s, 's0'), s.phase.k, s.turn.doubles]).toEqual([23, 'postRoll', 2]);
    s = run(s, ['s0', { k: 'endTurn' }], ['s1', { k: 'roll' }], ['s1', { k: 'endTurn' }]).state;
    s = run(s, ['s0', { k: 'roll' }], ['s0', { k: 'roll' }], ['s0', { k: 'roll' }]).state;
    expect(s.players.s0?.jail).toBeUndefined();
    expect(pos(s, 's0')).toBe(38);
    expect(s.phase.k).toBe('postRoll');
    expect(cash(s, 's0')).toBe(1500 + 10 - 75);
  });

  it('Doubles: the third doubles goes straight to jail without moving, landing or salary', () => {
    let s = scenario();
    stack(s, 'chest', 'cc-contest');
    rig(s, [1, 1], [2, 2]);
    s = run(s, ['s0', { k: 'roll' }], ['s0', { k: 'roll' }], ['s0', { k: 'buy' }]).state;
    expect([pos(s, 's0'), s.phase.k, s.turn.doubles]).toEqual([6, 'preRoll', 2]);
    setPos(s, 's0', 37);
    rig(s, [3, 3]);
    const { state, events } = act(s, 's0', { k: 'roll' });
    expect(pos(state, 's0')).toBe(10);
    expect(state.players.s0?.jail).toEqual({ tries: 0 });
    expect(ofType(events, 'land')).toEqual([]);
    expect(salaries(events)).toBe(0);
    expect(ofType(events, 'jail')).toEqual([{ t: 'jail', seat: 's0', reason: 'doubles' }]);
    expect(state.phase.k).toBe('postRoll');
    expect(state.turn.again).toBe(false);
    expect(cash(state, 's0')).toBe(1500 + 10 - 100);
  });

  it('Doubles: a Go to Jail card after doubles ends the turn (no re-roll)', () => {
    const { state } = rollFrom(scenario(), 3, [2, 2], ['chance', 'ch-jail']);
    expect(state.players.s0?.jail).toEqual({ tries: 0 });
    expect(state.phase.k).toBe('postRoll');
    expect(state.turn.again).toBe(false);
    expect(refused(state, 's0', { k: 'roll' })).toBe('phase');
  });

  it('Doubles / Jail: after paying the fine doubles roll again, and a third doubles sends you back to jail', () => {
    let s = scenario();
    jail(s, 's0', 0);
    own(s, 's0', [12, 16]);
    s = act(s, 's0', { k: 'payFine' }).state;
    rig(s, [1, 1], [2, 2], [3, 3]);
    s = act(s, 's0', { k: 'roll' }).state;
    expect([pos(s, 's0'), s.phase.k]).toEqual([12, 'preRoll']);
    s = act(s, 's0', { k: 'roll' }).state;
    expect([pos(s, 's0'), s.phase.k]).toEqual([16, 'preRoll']);
    const { state, events } = act(s, 's0', { k: 'roll' });
    expect(pos(state, 's0')).toBe(10);
    expect(state.players.s0?.jail).toEqual({ tries: 0 });
    expect(ofType(events, 'jail')[0]?.reason).toBe('doubles');
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('audit: GO salary', () => {
  it('GO: passing or landing on GO pays Rs. 200; standing on GO at the start does not', () => {
    const a = rollFrom(scenario(), 0, [1, 2]);
    expect(salaries(a.events)).toBe(0);
    const b = rollFrom(scenario(), 39, [1, 2], ['chest', 'cc-contest']);
    expect(salaries(b.events)).toBe(1);
    expect(cash(b.state, 's0')).toBe(1500 + 200 + 10);
  });

  it('GO: passing GO then drawing Advance to GO on Community Chest 2 pays Rs. 200 twice', () => {
    const { state, events } = rollFrom(scenario(), 38, [1, 3], ['chest', 'cc-go']);
    expect(pos(state, 's0')).toBe(0);
    expect(salaries(events)).toBe(2);
    expect(cash(state, 's0')).toBe(1900);
    expect(state.phase.k).toBe('postRoll');
  });

  it('GO: passing GO then drawing Advance to GO on Chance 7 (with doubles) pays twice and still rolls again', () => {
    const { state, events } = rollFrom(scenario(), 35, [6, 6], ['chance', 'ch-go']);
    expect(pos(state, 's0')).toBe(0);
    expect(salaries(events)).toBe(2);
    expect(cash(state, 's0')).toBe(1900);
    expect(state.phase.k).toBe('preRoll');
  });

  it('GO: card advances that pass GO pay salary (Reading from 7; nearest railroad and utility from 36)', () => {
    const reading = draw(scenario(), 'chance', 'ch-fort');
    expect([pos(reading.state, 's0'), salaries(reading.events), cash(reading.state, 's0')]).toEqual([5, 1, 1700]);
    expect(reading.state.phase).toEqual({ k: 'buy', space: 5 });

    const rail = rollFrom(scenario(), 33, [1, 2], ['chance', 'ch-rail1']);
    expect([pos(rail.state, 's0'), salaries(rail.events)]).toEqual([5, 1]);
    expect(rail.state.phase).toEqual({ k: 'buy', space: 5 });

    const util = rollFrom(scenario(), 33, [1, 2], ['chance', 'ch-utility']);
    expect([pos(util.state, 's0'), salaries(util.events)]).toEqual([12, 1]);
    expect(util.state.phase).toEqual({ k: 'buy', space: 12 });
  });

  it('GO / Jail: no salary on any trip to jail, even from past the far side of the board', () => {
    const chest = rollFrom(scenario(), 30, [1, 2], ['chest', 'cc-jail']);
    expect([pos(chest.state, 's0'), salaries(chest.events), cash(chest.state, 's0')]).toEqual([10, 0, 1500]);
    const chance = rollFrom(scenario(), 33, [1, 2], ['chance', 'ch-jail']);
    expect([pos(chance.state, 's0'), salaries(chance.events), cash(chance.state, 's0')]).toEqual([10, 0, 1500]);
  });

  it('GO / Jail: salary earned by the dice passing GO is kept when the card then sends you to jail', () => {
    const { state, events } = rollFrom(scenario(), 38, [1, 3], ['chest', 'cc-jail']);
    expect(salaries(events)).toBe(1);
    expect(cash(state, 's0')).toBe(1700);
    expect(state.players.s0?.jail).toEqual({ tries: 0 });
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('audit: every Chance and Community Chest card', () => {
  const cashCards: [Deck, string, number][] = [
    ['chance', 'ch-dividend', 50],
    ['chance', 'ch-poortax', -15],
    ['chance', 'ch-loan', 150],
    ['chest', 'cc-bankerror', 200],
    ['chest', 'cc-doctor', -50],
    ['chest', 'cc-stock', 45],
    ['chest', 'cc-avurudu', 100],
    ['chest', 'cc-taxrefund', 20],
    ['chest', 'cc-deposit', 100],
    ['chest', 'cc-hospital', -100],
    ['chest', 'cc-school', -150],
    ['chest', 'cc-services', 25],
    ['chest', 'cc-contest', 10],
    ['chest', 'cc-dubai', 100],
  ];
  for (const [deck, id, amount] of cashCards) {
    it(`Cards: ${id} moves $${amount} with the bank and goes to the bottom of its deck`, () => {
      const { state, events } = draw(scenario(), deck, id);
      expect(cashDelta(events, 's0')).toBe(amount);
      expect(cash(state, 's0')).toBe(1500 + amount);
      expect(state.decks[deck].at(-1)).toBe(id);
      expect(state.decks[deck]).toHaveLength(16);
      expect(state.phase.k).toBe('postRoll');
    });
  }

  it('Cards: Advance to GO (both decks) moves to GO and pays Rs. 200', () => {
    for (const [deck, id] of [
      ['chance', 'ch-go'],
      ['chest', 'cc-go'],
    ] as const) {
      const { state, events } = draw(scenario(), deck, id);
      expect([pos(state, 's0'), salaries(events), cash(state, 's0')]).toEqual([0, 1, 1700]);
    }
  });

  it('Cards: Take a trip to Colombo Fort Station charges the normal (not doubled) railroad rent', () => {
    const s = scenario();
    own(s, 's1', [5, 15]);
    const { state, events } = draw(s, 'chance', 'ch-fort');
    expect(rentPaid(events)).toBe(50);
    expect(cash(state, 's0')).toBe(1500 + 200 - 50);
  });

  it('Cards: Advance to Negombo Fish Market resolves it (3-house rent), Galle Face Penthouse unowned is offered for sale', () => {
    const s = scenario();
    own(s, 's1', [11, 13, 14], { level: 3 });
    const a = draw(s, 'chance', 'ch-negombo');
    expect(pos(a.state, 's0')).toBe(11);
    expect(rentPaid(a.events)).toBe(450);
    expect(salaries(a.events)).toBe(0);

    const b = draw(scenario(), 'chance', 'ch-penthouse');
    expect(b.state.phase).toEqual({ k: 'buy', space: 39 });
    const c = draw(scenario(), 'chance', 'ch-galle');
    expect(c.state.phase).toEqual({ k: 'buy', space: 24 });
  });

  it('Cards: Nearest Railroad pays twice the rent, a mortgaged railroad of the owner still counted', () => {
    const s = scenario();
    own(s, 's1', [5], { mortgaged: true });
    own(s, 's1', [15]);
    const { state, events } = draw(s, 'chance', 'ch-rail1');
    expect(pos(state, 's0')).toBe(15);
    expect(rentPaid(events)).toBe(100);
  });

  it('Cards: Nearest Railroad from Chance 36 wraps to Reading: salary, then twice the 4-railroad rent', () => {
    const s = scenario();
    own(s, 's1', [5, 15, 25, 35]);
    const { state, events } = rollFrom(s, 33, [1, 2], ['chance', 'ch-rail2']);
    expect(pos(state, 's0')).toBe(5);
    expect(rentPaid(events)).toBe(400);
    expect(cash(state, 's0')).toBe(1500 + 200 - 400);
  });

  it('Cards: Nearest Railroad charges nothing on a mortgaged railroad or on your own', () => {
    const s = scenario();
    own(s, 's1', [25], { mortgaged: true });
    const a = rollFrom(s, 19, [1, 2], ['chance', 'ch-rail1']);
    expect([pos(a.state, 's0'), rentPaid(a.events)]).toEqual([25, 0]);
    const t = scenario();
    own(t, 's0', [15]);
    const b = draw(t, 'chance', 'ch-rail2');
    expect([pos(b.state, 's0'), cashDelta(b.events, 's0'), b.state.phase.k]).toEqual([15, 0, 'postRoll']);
  });

  it('Cards / Jail: Nearest Railroad owned by a jailed player still pays double', () => {
    const s = scenario();
    jail(s, 's1');
    own(s, 's1', [25]);
    const { state, events } = rollFrom(s, 19, [1, 2], ['chance', 'ch-rail1']);
    expect(rentPaid(events)).toBe(50);
    expect(cash(state, 's1')).toBe(1550);
  });

  it('Cards: Nearest Railroad doubled rent that cannot be paid opens a debt for the doubled amount', () => {
    const s = scenario();
    setCash(s, 's0', 50);
    own(s, 's0', [1]);
    own(s, 's1', [15, 25]);
    const { state } = draw(s, 'chance', 'ch-rail1');
    expect(state.phase).toMatchObject({ k: 'debt', debtor: 's0', owed: { s1: 100 }, why: 'rent' });
  });

  it('Cards / Buying: Nearest Railroad and Nearest Utility, unowned: decline sends them to auction', () => {
    const a = draw(scenario(), 'chance', 'ch-rail1');
    const ra = act(a.state, 's0', { k: 'decline' }).state;
    expect(ra.phase).toMatchObject({ k: 'auction', lot: { k: 'prop', space: 15 }, eligible: ['s0', 's1'] });
    const b = draw(scenario(), 'chance', 'ch-utility');
    const rb = act(b.state, 's0', { k: 'decline' }).state;
    expect(rb.phase).toMatchObject({ k: 'auction', lot: { k: 'prop', space: 12 } });
  });

  it('Cards: Nearest Utility, owner holds one utility: 10x a fresh throw (not 4x)', () => {
    const s = scenario();
    own(s, 's1', [12]);
    setPos(s, 's0', 4);
    stack(s, 'chance', 'ch-utility');
    rig(s, [1, 2], [2, 3]);
    const { state, events } = act(s, 's0', { k: 'roll' });
    expect(pos(state, 's0')).toBe(12);
    expect(ofType(events, 'dice').map((d) => d.purpose)).toEqual(['move', 'utility']);
    expect(rentPaid(events)).toBe(50);
  });

  it('Cards: Nearest Utility, owner holds both (one mortgaged): still exactly 10x the fresh throw', () => {
    const s = scenario();
    own(s, 's1', [12], { mortgaged: true });
    own(s, 's1', [28]);
    setPos(s, 's0', 19);
    stack(s, 'chance', 'ch-utility');
    rig(s, [1, 2], [6, 5]);
    const { state, events } = act(s, 's0', { k: 'roll' });
    expect(pos(state, 's0')).toBe(28);
    expect(rentPaid(events)).toBe(110);
  });

  it('Cards: Nearest Utility on a mortgaged utility charges nothing and throws no dice', () => {
    const s = scenario();
    own(s, 's1', [12], { mortgaged: true });
    own(s, 's1', [28]);
    const { state, events } = draw(s, 'chance', 'ch-utility');
    expect(pos(state, 's0')).toBe(12);
    expect(ofType(events, 'dice').map((d) => d.purpose)).toEqual(['move']);
    expect(rentPaid(events)).toBe(0);
    expect(state.rng).toBe(s.rng);
  });

  it('Cards / Doubles: the Nearest Utility throw never counts as doubles (no re-roll, no jail count)', () => {
    const s = scenario();
    own(s, 's1', [12]);
    setPos(s, 's0', 4);
    stack(s, 'chance', 'ch-utility');
    rig(s, [1, 2], [4, 4]);
    const plain = act(s, 's0', { k: 'roll' });
    expect(rentPaid(plain.events)).toBe(80);
    expect(plain.state.phase.k).toBe('postRoll');

    let t = scenario();
    own(t, 's1', [12]);
    own(t, 's0', [14, 23]);
    setPos(t, 's0', 3);
    stack(t, 'chance', 'ch-utility');
    stack(t, 'chest', 'cc-contest');
    rig(t, [2, 2], [3, 3], [1, 1], [5, 5]);
    t = act(t, 's0', { k: 'roll' }).state;
    expect([pos(t, 's0'), t.phase.k, t.turn.doubles]).toEqual([12, 'preRoll', 1]);
    t = act(t, 's0', { k: 'roll' }).state;
    expect([pos(t, 's0'), t.phase.k, t.turn.doubles]).toEqual([14, 'preRoll', 2]);
    // Third doubles of the turn: jail. (Had the utility throw counted, this would already have been the fourth.)
    t = act(t, 's0', { k: 'roll' }).state;
    expect(t.players.s0?.jail).toEqual({ tries: 0 });
  });

  it('Cards / Income Tax: Go Back 3 from Chance 7 lands on Income Tax: choose first; 10% counts the salary passed', () => {
    const { state } = rollFrom(scenario(), 39, [3, 5], ['chance', 'ch-back3']);
    expect(pos(state, 's0')).toBe(4);
    expect(state.phase.k).toBe('incomeTax');
    expect(incomeTaxAmounts(state, 's0')).toEqual({ flat: 200, percent: 170 });
    const after = act(state, 's0', { k: 'incomeTax', pick: 'percent' }).state;
    expect(cash(after, 's0')).toBe(1700 - 170);
    expect(after.phase.k).toBe('postRoll');
  });

  it('Cards / Doubles: Go Back 3 into Income Tax on doubles keeps the doubles re-roll after the tax', () => {
    const { state } = rollFrom(scenario(), 5, [1, 1], ['chance', 'ch-back3']);
    expect(state.phase.k).toBe('incomeTax');
    const after = act(state, 's0', { k: 'incomeTax', pick: 'flat' }).state;
    expect(after.phase.k).toBe('preRoll');
    expect(cash(after, 's0')).toBe(1300);
  });

  it('Cards: Go Back 3 from Chance 36 lands on Community Chest 33 and draws it (Go to Jail: no salary)', () => {
    const s = scenario();
    stack(s, 'chest', 'cc-jail');
    const { state, events } = rollFrom(s, 33, [1, 2], ['chance', 'ch-back3']);
    expect(ofType(events, 'card').map((c) => c.cardId)).toEqual(['ch-back3', 'cc-jail']);
    expect(pos(state, 's0')).toBe(10);
    expect(state.players.s0?.jail).toEqual({ tries: 0 });
    expect(salaries(events)).toBe(0);
    expect(state.decks.chance.at(-1)).toBe('ch-back3');
    expect(state.decks.chest.at(-1)).toBe('cc-jail');
  });

  it('Cards / Rent: Go Back 3 from Chance 22 lands on Horton Plains Viewpoint and pays the group-doubled rent', () => {
    const s = scenario();
    own(s, 's1', [16, 18, 19]);
    const { state, events } = rollFrom(s, 19, [1, 2], ['chance', 'ch-back3']);
    expect(pos(state, 's0')).toBe(19);
    expect(ofType(events, 'move').map((m) => m.via)).toEqual(['dice', 'back']);
    expect(rentPaid(events)).toBe(32);
  });

  it('Cards: Get Out of Jail Free (each deck) is kept, then used and returned to the bottom of its own deck', () => {
    for (const [deck, id] of [
      ['chance', 'ch-goojf'],
      ['chest', 'cc-goojf'],
    ] as const) {
      const { state, events } = draw(scenario(), deck, id);
      expect(state.players.s0?.goojf).toEqual([id]);
      expect(state.decks[deck]).toHaveLength(15);
      expect(ofType(events, 'card')[0]).toMatchObject({ cardId: id, kept: true });
      expect(ofType(events, 'cardReturn')).toEqual([]);
      const s = structuredClone(state);
      jail(s, 's0', 1);
      s.phase = { k: 'preRoll' };
      const used = act(s, 's0', { k: 'useCard' }).state;
      expect(used.players.s0?.jail).toBeUndefined();
      expect(used.players.s0?.goojf).toEqual([]);
      expect(used.decks[deck]).toHaveLength(16);
      expect(used.decks[deck].at(-1)).toBe(id);
    }
  });

  it('Cards / Bankruptcy to the bank: held Get Out of Jail Free cards return to the bottom of their own decks', () => {
    const s = scenario({ n: 3 });
    setCash(s, 's0', 10);
    hold(s, 's0', 'ch-goojf');
    hold(s, 's0', 'cc-goojf');
    const st = rollFrom(s, 35, [1, 2]).state;
    expect(st.phase).toMatchObject({ k: 'debt', debtor: 's0', owed: { bank: 75 } });
    const after = act(st, 's0', { k: 'bankrupt' }).state;
    expect(after.decks.chance.at(-1)).toBe('ch-goojf');
    expect(after.decks.chest.at(-1)).toBe('cc-goojf');
    expect([after.decks.chance.length, after.decks.chest.length]).toEqual([16, 16]);
  });

  it('Cards: repairs count levels 1-4 as houses and a hotel as one hotel (no houses), own buildings only', () => {
    const setup = (): GameState => {
      const s = scenario();
      own(s, 's0', [6, 8], { level: 4 });
      own(s, 's0', [9], { level: 5 });
      own(s, 's0', [1, 3], { level: 1 });
      own(s, 's0', [5], { mortgaged: true });
      own(s, 's1', [37, 39], { level: 5 });
      return s;
    };
    // 10 houses, 1 hotel
    const a = draw(setup(), 'chance', 'ch-repairs');
    expect(cashDelta(a.events, 's0')).toBe(-(10 * 25 + 100));
    const b = draw(setup(), 'chest', 'cc-repairs');
    expect(cashDelta(b.events, 's0')).toBe(-(10 * 40 + 115));
    expect(cashDelta(b.events, 's1')).toBe(0);
  });

  it('Cards: repairs with no buildings cost nothing', () => {
    const s = scenario();
    own(s, 's0', [1, 3]);
    const { state, events } = draw(s, 'chest', 'cc-repairs');
    expect(ofType(events, 'cash')).toEqual([]);
    expect(state.phase.k).toBe('postRoll');
  });

  it('Cards: Chairman of the Board pays every active player, jailed ones included, out ones not', () => {
    let s = scenario({ n: 4 });
    s = act(s, 's3', { k: 'resign' }).state;
    jail(s, 's2');
    const { state } = draw(s, 'chance', 'ch-chairman');
    expect([cash(state, 's0'), cash(state, 's1'), cash(state, 's2'), cash(state, 's3')]).toEqual([1400, 1550, 1550, 0]);
  });

  it('Cards / Several creditors: a broke Chairman sells everything to the bank and pays in seat order as far as it goes', () => {
    const s = scenario({ n: 4 });
    setCash(s, 's0', 90);
    own(s, 's0', [1]);
    const { state } = draw(s, 'chance', 'ch-chairman');
    expect(state.phase).toMatchObject({ k: 'debt', debtor: 's0', owed: { s1: 50, s2: 50, s3: 50 } });
    expect(refused(state, 's0', { k: 'endTurn' })).toBe('phase');
    const broke = act(state, 's0', { k: 'bankrupt' });
    // 90 cash + 48 for Pettah Pavement = 138 of the 150: s3, last in seat order, gets the 38 left
    expect([cash(broke.state, 's1'), cash(broke.state, 's2'), cash(broke.state, 's3')]).toEqual([1550, 1550, 1538]);
    expect(broke.state.players.s0?.out).toBe('bankrupt');
    expect(ofType(broke.events, 'bankrupt')[0]).toMatchObject({ seat: 's0', to: 'bank' });
    // Pettah Pavement was sold to the bank (Rs. 4,800 of the cash paid out): it is the bank's again, not auctioned.
    expect(ofType(broke.events, 'cash').find((e) => e.why === 'sale')).toMatchObject({ from: 'bank', to: 's0', amount: 48, space: 1 });
    expect(broke.state.props.p1).toBeUndefined();
    expect(ofType(broke.events, 'auctionStart')).toEqual([]);
    expect(broke.state.turn.seat).toBe('s1');
    expect(broke.state.phase.k).toBe('preRoll');
  });

  it('Cards / Several creditors: a broke Chairman pays in seat order from the debtor (not from the opening-roll winner)', () => {
    // Turn order [s2, s3, s0, s1]: s2 won the opening roll. s3 draws Chairman with Rs. 120 and nothing else.
    // Seat order from s3's left is s0, s1, s2 (plain lobby order agrees), the same order the engine queues
    // Wedding Gifts payers in; the Rs. 20 shortfall must fall on s2.
    const s = scenario({ n: 4 });
    s.order = ['s2', 's3', 's0', 's1'];
    s.turn = { seat: 's3', no: 1, doubles: 0, again: false };
    setCash(s, 's3', 120);
    const { state } = draw(s, 'chance', 'ch-chairman', 's3');
    expect(state.phase).toMatchObject({ k: 'debt', debtor: 's3' });
    const broke = act(state, 's3', { k: 'bankrupt' }).state;
    expect([cash(broke, 's0'), cash(broke, 's1'), cash(broke, 's2')]).toEqual([1550, 1550, 1520]);
  });

  it('Cards / Collect each: Wedding Gifts payers settle in seat order from the drawer\'s left', () => {
    const s = scenario({ n: 4 });
    s.order = ['s2', 's3', 's0', 's1'];
    s.turn = { seat: 's3', no: 1, doubles: 0, again: false };
    const { events } = draw(s, 'chest', 'cc-wedding', 's3');
    expect(ofType(events, 'cash').map((e) => e.from)).toEqual(['s0', 's1', 's2']);
  });

  it('Cards / Jail: a jailed player who cannot pay Wedding Gifts raises the cash and stays in jail with the same tries', () => {
    const s = scenario({ n: 3 });
    jail(s, 's1', 1);
    setCash(s, 's1', 20);
    own(s, 's1', [3]);
    const { state } = draw(s, 'chest', 'cc-wedding');
    expect(state.phase).toMatchObject({ k: 'debt', debtor: 's1', owed: { s0: 50 } });
    const after = act(state, 's1', { k: 'mortgage', space: 3 }).state;
    expect(after.players.s1?.jail).toEqual({ tries: 1 });
    expect([cash(after, 's0'), cash(after, 's1'), cash(after, 's2')]).toEqual([1600, 20 + 36 - 50, 1450]);
    expect(after.phase.k).toBe('postRoll');
  });

  it('Cards: Chairman with exactly enough cash pays everyone and is left with Rs. 0', () => {
    const s = scenario({ n: 3 });
    setCash(s, 's0', 100);
    const { state } = draw(s, 'chance', 'ch-chairman');
    expect([cash(state, 's0'), cash(state, 's1'), cash(state, 's2')]).toEqual([0, 1550, 1550]);
    expect(state.phase.k).toBe('postRoll');
  });

  it('Cards: an advance card only lands on its target (Galle Face Penthouse from 22 passes Go To Jail harmlessly)', () => {
    const { state, events } = rollFrom(scenario(), 19, [1, 2], ['chance', 'ch-penthouse']);
    expect(pos(state, 's0')).toBe(39);
    expect(state.players.s0?.jail).toBeUndefined();
    expect(ofType(events, 'land').map((e) => e.space)).toEqual([22, 39]);
    expect(state.phase).toEqual({ k: 'buy', space: 39 });
  });

  it('Cards / Doubles / Bankruptcy: doubles onto an Advance card whose rent bankrupts you ends the turn for the next seat', () => {
    const s = scenario({ n: 3 });
    setCash(s, 's0', 100);
    own(s, 's1', [37], { level: 5 });
    own(s, 's1', [39], { level: 5 });
    const st = rollFrom(s, 3, [2, 2], ['chance', 'ch-penthouse']).state;
    expect(st.phase).toMatchObject({ k: 'debt', debtor: 's0', owed: { s1: 2000 } });
    const after = act(st, 's0', { k: 'bankrupt' }).state;
    expect(after.players.s0?.out).toBe('bankrupt');
    expect(cash(after, 's1')).toBe(1600);
    expect(after.turn.seat).toBe('s1');
    expect(after.phase.k).toBe('preRoll');
  });

  it('Cards: Advance to Galle Fort Ramparts from Chance 36 collects GO and pays a jailed owner the house rent', () => {
    const s = scenario();
    jail(s, 's1', 0);
    own(s, 's1', [21, 23, 24], { level: 2 });
    const { state, events } = rollFrom(s, 33, [1, 2], ['chance', 'ch-galle']);
    expect(salaries(events)).toBe(1);
    expect(rentPaid(events)).toBe(300);
    expect(cash(state, 's0')).toBe(1500 + 200 - 300);
  });

  it('Cards: Wedding Gifts collects from every active player, jailed ones included', () => {
    const s = scenario({ n: 3 });
    jail(s, 's2', 1);
    const { state } = draw(s, 'chest', 'cc-wedding');
    expect([cash(state, 's0'), cash(state, 's1'), cash(state, 's2')]).toEqual([1600, 1450, 1450]);
    expect(state.phase.k).toBe('postRoll');
  });

  it('Cards / Bankruptcy: a Wedding Gifts payer who cannot pay goes bankrupt to the drawer; the others still pay', () => {
    const s = scenario({ n: 3 });
    setCash(s, 's1', 20);
    const { state } = draw(s, 'chest', 'cc-wedding');
    expect(state.phase).toMatchObject({ k: 'debt', debtor: 's1', owed: { s0: 50 } });
    const after = act(state, 's1', { k: 'bankrupt' }).state;
    expect(after.players.s1?.out).toBe('bankrupt');
    expect([cash(after, 's0'), cash(after, 's2')]).toEqual([1570, 1450]);
    expect(after.phase.k).toBe('postRoll');
    expect(after.turn.seat).toBe('s0');
  });

  it("Cards / Bankruptcy: a broke Wedding Gifts payer's mortgaged property goes back to the bank (its sale value less the loan); then the rest pay", () => {
    const s = scenario({ n: 3 });
    setCash(s, 's1', 20);
    own(s, 's1', [3], { mortgaged: true });
    const { state } = draw(s, 'chest', 'cc-wedding');
    const { state: st, events } = act(state, 's1', { k: 'bankrupt' });
    expect(ofType(events, 'xferStart')).toEqual([]);
    expect(st.props.p3).toBeUndefined();
    // s1's 20 cash + 12 for Maradana Lane (48, less its 36 loan), then s2's 50
    expect([cash(st, 's0'), cash(st, 's2')]).toEqual([1500 + 20 + 12 + 50, 1450]);
    expect(st.phase.k).toBe('postRoll');
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('audit: buying and auctions', () => {
  it('Buying: an unowned property is bought at its printed price', () => {
    const s = scenario();
    rig(s, [2, 4]);
    const { state } = run(s, ['s0', { k: 'roll' }], ['s0', { k: 'buy' }]);
    expect(state.props.p6).toEqual({ owner: 's0', level: 0 });
    expect(cash(state, 's0')).toBe(1400);
  });

  it('Buying: too little cash refuses buy, but the lander may mortgage first and then buy', () => {
    const s = scenario();
    setCash(s, 's0', 50);
    own(s, 's0', [5]);
    rig(s, [2, 4]);
    const st = act(s, 's0', { k: 'roll' }).state;
    expect(refused(st, 's0', { k: 'buy' })).toBe('cash');
    const { state } = run(st, ['s0', { k: 'mortgage', space: 5 }], ['s0', { k: 'buy' }]);
    expect(state.props.p6?.owner).toBe('s0');
    expect(cash(state, 's0')).toBe(50 + 120 - 100);
  });

  it('Buying / Auctions: the player who declined may bid, and Rs. 1 is a valid opening bid', () => {
    const s = scenario();
    rig(s, [2, 4]);
    setPos(s, 's0', 33);
    const st = run(s, ['s0', { k: 'roll' }], ['s0', { k: 'decline' }]).state;
    expect(st.phase).toMatchObject({ k: 'auction', lot: { k: 'prop', space: 39 }, eligible: ['s0', 's1'] });
    const { state } = run(st, ['s0', { k: 'bid', amount: 1 }], ['s1', { k: 'pass' }]);
    expect(state.props.p39?.owner).toBe('s0');
    expect(cash(state, 's0')).toBe(1499);
    expect(state.phase.k).toBe('postRoll');
  });

  it('Buying / Auctions: a decliner who could not afford the price may still win it below the price', () => {
    const s = scenario();
    setCash(s, 's0', 50);
    rig(s, [2, 4]);
    const st = act(s, 's0', { k: 'roll' }).state;
    expect(refused(st, 's0', { k: 'buy' })).toBe('cash');
    const { state } = run(st, ['s0', { k: 'decline' }], ['s0', { k: 'bid', amount: 40 }], ['s1', { k: 'pass' }]);
    expect(state.props.p6?.owner).toBe('s0');
    expect(cash(state, 's0')).toBe(10);
  });

  it('Buying / Jail: a jailed player may bid and win an auction (paying cash) and stays in jail', () => {
    const s = scenario();
    jail(s, 's1', 1);
    rig(s, [2, 4]);
    const st = run(s, ['s0', { k: 'roll' }], ['s0', { k: 'decline' }]).state;
    expect(refused(st, 's1', { k: 'bid', amount: 1501 })).toBe('cash');
    const { state } = run(st, ['s1', { k: 'bid', amount: 7 }], ['s0', { k: 'pass' }]);
    expect(state.props.p6?.owner).toBe('s1');
    expect(cash(state, 's1')).toBe(1493);
    expect(state.players.s1?.jail).toEqual({ tries: 1 });
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('audit: rent', () => {
  it('Rent: a complete group doubles the unimproved rent even with a mortgaged sibling; the mortgaged one charges nothing', () => {
    const s = scenario();
    own(s, 's1', [1], { mortgaged: true });
    own(s, 's1', [3]);
    expect(rentFor(s, 3)).toBe(8);
    expect(rentFor(s, 1)).toBe(0);
    const { events } = rollFrom(s, 0, [1, 2]);
    expect(rentPaid(events)).toBe(8);
  });

  it('Rent: with group levels (1,1,0) the unimproved street still pays double base rent', () => {
    const s = scenario();
    own(s, 's1', [6, 8], { level: 1 });
    own(s, 's1', [9]);
    expect(rentFor(s, 6)).toBe(30);
    const { events } = rollFrom(s, 4, [2, 3]);
    expect(rentPaid(events)).toBe(16);
  });

  it('Rent: house and hotel rents per the Title Deed', () => {
    const s = scenario();
    own(s, 's1', [37], { level: 4 });
    own(s, 's1', [39], { level: 5 });
    setCash(s, 's0', 3000);
    expect(rentFor(s, 37)).toBe(1300);
    expect(rentPaid(rollFrom(s, 34, [2, 3]).events)).toBe(2000);
  });

  it('Rent / Mortgaged railroads: three mortgaged railroads still count, the fourth charges Rs. 200', () => {
    const s = scenario();
    own(s, 's1', [5, 15, 25], { mortgaged: true });
    own(s, 's1', [35]);
    expect(rentPaid(rollFrom(s, 32, [1, 2]).events)).toBe(200);
  });

  it('Rent: railroads 25/50/100/200 by the number the owner holds', () => {
    const want = [25, 50, 100, 200];
    for (let n = 1; n <= 4; n++) {
      const s = scenario();
      own(s, 's1', [35, 5, 15, 25].slice(0, n));
      expect(rentPaid(rollFrom(s, 32, [1, 2]).events)).toBe(want[n - 1]);
    }
  });

  it('Rent: utilities charge 4x the dice with one owned, 10x with both (a mortgaged one counted)', () => {
    const one = scenario();
    own(one, 's1', [28]);
    expect(rentPaid(rollFrom(one, 21, [3, 4]).events)).toBe(28);
    const both = scenario();
    own(both, 's1', [12], { mortgaged: true });
    own(both, 's1', [28]);
    expect(rentPaid(rollFrom(both, 21, [3, 4]).events)).toBe(70);
  });

  it('Rent: nothing on your own property', () => {
    const s = scenario();
    own(s, 's0', [6]);
    const { events } = rollFrom(s, 0, [2, 4]);
    expect(ofType(events, 'cash')).toEqual([]);
  });

  it('Rent: a payment that cannot be made opens a debt to the owner, settled by itself once mortgaging covers it', () => {
    const s = scenario();
    setCash(s, 's0', 10);
    own(s, 's0', [1, 24]);
    own(s, 's1', [37, 39]);
    const { state } = rollFrom(s, 34, [2, 3]);
    expect(state.phase).toMatchObject({ k: 'debt', debtor: 's0', owed: { s1: 100 }, why: 'rent' });
    const partly = act(state, 's0', { k: 'mortgage', space: 1 }).state;
    expect(partly.phase.k).toBe('debt');
    const paid = act(partly, 's0', { k: 'mortgage', space: 24 }).state;
    expect(paid.phase.k).toBe('postRoll');
    expect([cash(paid, 's0'), cash(paid, 's1')]).toEqual([10 + 36 + 144 - 100, 1600]);
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('audit: taxes', () => {
  it('Income Tax: 10% of worth = cash + printed prices (mortgaged too) + building cost (hotel = 5 houses), rounded down', () => {
    const s = scenario();
    setCash(s, 's0', 1009);
    own(s, 's0', [1, 3], { level: 5 });
    own(s, 's0', [5], { mortgaged: true });
    own(s, 's0', [12]);
    const st = rollFrom(s, 1, [1, 2]).state;
    expect(st.phase.k).toBe('incomeTax');
    // 1009 + 60 + 60 + 2 x 5 x 50 + 200 + 150 = 1979 -> 197
    expect(worth(st, 's0')).toBe(1979);
    expect(incomeTaxAmounts(st, 's0')).toEqual({ flat: 200, percent: 197 });
    expect(cash(act(st, 's0', { k: 'incomeTax', pick: 'percent' }).state, 's0')).toBe(1009 - 197);
  });

  it('Income Tax: the player chooses; flat is Rs. 200 even when 10% would be less', () => {
    const s = scenario();
    setCash(s, 's0', 500);
    const st = rollFrom(s, 1, [1, 2]).state;
    expect(st.phase.k).toBe('incomeTax');
    expect(refused(st, 's0', { k: 'endTurn' })).toBe('phase');
    expect(cash(act(st, 's0', { k: 'incomeTax', pick: 'flat' }).state, 's0')).toBe(300);
    expect(cash(act(st, 's0', { k: 'incomeTax', pick: 'percent' }).state, 's0')).toBe(450);
  });

  it('Luxury Tax: Rs. 75 by default and Rs. 100 when configured, paid on landing', () => {
    const a = rollFrom(scenario(), 35, [1, 2]);
    expect([cash(a.state, 's0'), a.state.phase.k]).toEqual([1425, 'postRoll']);
    const b = rollFrom(scenario({ cfg: { luxuryTax: 100 } }), 35, [1, 2]);
    expect(cash(b.state, 's0')).toBe(1400);
  });

  it('Free Parking: nothing happens (with or without doubles)', () => {
    const a = rollFrom(scenario(), 17, [1, 2]);
    expect(pos(a.state, 's0')).toBe(20);
    expect(ofType(a.events, 'cash')).toEqual([]);
    expect(a.state.phase.k).toBe('postRoll');
    const b = rollFrom(scenario(), 10, [5, 5]);
    expect(ofType(b.events, 'cash')).toEqual([]);
    expect(b.state.phase.k).toBe('preRoll');
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('audit: jail', () => {
  it('Jail entry 1: landing on Go To Jail sends you to jail; the turn ends', () => {
    const { state, events } = rollFrom(scenario(), 27, [1, 2]);
    expect(pos(state, 's0')).toBe(10);
    expect(state.players.s0?.jail).toEqual({ tries: 0 });
    expect(ofType(events, 'jail')).toEqual([{ t: 'jail', seat: 's0', reason: 'space' }]);
    expect(salaries(events)).toBe(0);
    expect(state.phase.k).toBe('postRoll');
    // Sent to jail this turn: no fine to pay now, and no roll.
    expect(refused(state, 's0', { k: 'payFine' })).toBe('phase');
    expect(refused(state, 's0', { k: 'roll' })).toBe('phase');
  });

  it('Jail entry 2: a Go to Jail card from either deck', () => {
    for (const [deck, id] of [
      ['chance', 'ch-jail'],
      ['chest', 'cc-jail'],
    ] as const) {
      const { state, events } = draw(scenario(), deck, id);
      expect(pos(state, 's0')).toBe(10);
      expect(state.players.s0?.jail).toEqual({ tries: 0 });
      expect(ofType(events, 'jail')[0]?.reason).toBe('card');
      expect(state.phase.k).toBe('postRoll');
      expect(state.decks[deck].at(-1)).toBe(id);
    }
  });

  it('Jail: landing on Jail normally is Just Visiting (no penalty, next turn rolls normally)', () => {
    let s = rollFrom(scenario(), 7, [1, 2]).state;
    expect(pos(s, 's0')).toBe(10);
    expect(s.players.s0?.jail).toBeUndefined();
    rig(s, [4, 6], [2, 3]);
    s = run(s, ['s0', { k: 'endTurn' }], ['s1', { k: 'roll' }], ['s1', { k: 'endTurn' }]).state;
    expect(refused(s, 's0', { k: 'payFine' })).toBe('notJailed');
    const { state, events } = act(s, 's0', { k: 'roll' });
    expect(ofType(events, 'dice')[0]?.purpose).toBe('move');
    expect(pos(state, 's0')).toBe(15);
  });

  it('Jail: three failed rolls over three turns, the fine is forced on the third, then you move by that throw', () => {
    let s = scenario();
    own(s, 's1', [31]);
    setPos(s, 's0', 27);
    rig(s, [1, 2], [4, 6], [1, 2], [4, 6], [2, 3], [5, 6], [1, 3]);
    s = run(s, ['s0', { k: 'roll' }], ['s0', { k: 'endTurn' }], ['s1', { k: 'roll' }], ['s1', { k: 'endTurn' }]).state;
    expect(s.players.s0?.jail).toEqual({ tries: 0 });
    // Turn 1 in jail
    s = act(s, 's0', { k: 'roll' }).state;
    expect([pos(s, 's0'), s.players.s0?.jail?.tries, s.phase.k]).toEqual([10, 1, 'postRoll']);
    s = run(s, ['s0', { k: 'endTurn' }], ['s1', { k: 'roll' }], ['s1', { k: 'endTurn' }]).state;
    // Turn 2 in jail
    s = act(s, 's0', { k: 'roll' }).state;
    expect(s.players.s0?.jail?.tries).toBe(2);
    s = run(s, ['s0', { k: 'endTurn' }], ['s1', { k: 'roll' }], ['s1', { k: 'endTurn' }]).state;
    // Turn 3: no voluntary fine; the failed roll forces it, then the move
    expect(refused(s, 's0', { k: 'payFine' })).toBe('mustRoll');
    const { state, events } = act(s, 's0', { k: 'roll' });
    expect(state.players.s0?.jail).toBeUndefined();
    expect(ofType(events, 'jailExit')[0]?.how).toBe('forced');
    expect(ofType(events, 'cash')[0]).toMatchObject({ from: 's0', to: 'bank', amount: 50, why: 'fine' });
    expect(pos(state, 's0')).toBe(14);
    expect(state.phase).toEqual({ k: 'buy', space: 14 });
    expect(cash(state, 's0')).toBe(1450);
  });

  it('Jail exit 1: doubles on any of the three turns free you, no fine, move by that throw, no extra roll', () => {
    for (const tries of [0, 1, 2]) {
      const s = scenario();
      jail(s, 's0', tries);
      rig(s, [2, 2]);
      const { state, events } = act(s, 's0', { k: 'roll' });
      expect(ofType(events, 'jailExit')).toEqual([{ t: 'jailExit', seat: 's0', how: 'doubles' }]);
      expect(ofType(events, 'cash')).toEqual([]);
      expect(pos(state, 's0')).toBe(14);
      const bought = act(state, 's0', { k: 'buy' }).state;
      expect(bought.phase.k).toBe('postRoll');
      expect(bought.turn.again).toBe(false);
    }
  });

  it('Jail exit 1 / Rent: the doubles that free you are the dice for utility rent', () => {
    const s = scenario();
    jail(s, 's0', 0);
    own(s, 's1', [12]);
    rig(s, [1, 1]);
    const { state, events } = act(s, 's0', { k: 'roll' });
    expect(rentPaid(events)).toBe(8);
    expect(state.phase.k).toBe('postRoll');
  });

  it('Jail exit 2: a Get Out of Jail Free card before rolling on any of the three turns, the third included', () => {
    for (const tries of [0, 1, 2]) {
      const s = scenario();
      jail(s, 's0', tries);
      hold(s, 's0', 'cc-goojf');
      rig(s, [1, 2]);
      const { state, events } = run(s, ['s0', { k: 'useCard' }], ['s0', { k: 'roll' }]);
      expect(ofType(events, 'jailExit')).toEqual([{ t: 'jailExit', seat: 's0', how: 'card' }]);
      expect(ofType(events, 'cash').filter((e) => e.why === 'fine')).toEqual([]);
      expect(pos(state, 's0')).toBe(13);
      expect(state.decks.chest.at(-1)).toBe('cc-goojf');
    }
  });

  it('Jail: after a third failed roll the fine is forced even while holding a card (the card is kept)', () => {
    const s = scenario();
    jail(s, 's0', 2);
    hold(s, 's0', 'ch-goojf');
    rig(s, [1, 2]);
    const { state, events } = act(s, 's0', { k: 'roll' });
    expect(ofType(events, 'jailExit')[0]?.how).toBe('forced');
    expect(cash(state, 's0')).toBe(1450);
    expect(state.players.s0?.goojf).toEqual(['ch-goojf']);
  });

  it('Jail exit 3: buy the card from another player during their turn, then use it on your own', () => {
    let s = scenario();
    jail(s, 's0', 0);
    hold(s, 's1', 'cc-goojf');
    s.turn = { seat: 's1', no: 1, doubles: 0, again: false };
    const offer = act(s, 's0', {
      k: 'propose',
      to: 's1',
      give: { cash: 25, props: [], cards: [] },
      get: { cash: 0, props: [], cards: ['cc-goojf'] },
    });
    const id = Object.keys(offer.state.trades)[0] as string;
    rig(offer.state, [4, 6], [1, 2]);
    s = run(offer.state, ['s1', { k: 'accept', id }], ['s1', { k: 'roll' }], ['s1', { k: 'endTurn' }]).state;
    expect(s.players.s0?.goojf).toEqual(['cc-goojf']);
    expect([cash(s, 's0'), cash(s, 's1')]).toEqual([1475, 1525]);
    const { state } = run(s, ['s0', { k: 'useCard', card: 'cc-goojf' }], ['s0', { k: 'roll' }]);
    expect(state.players.s0?.jail).toBeUndefined();
    expect(pos(state, 's0')).toBe(13);
    expect(state.decks.chest.at(-1)).toBe('cc-goojf');
  });

  it('Jail exit 4: pay Rs. 50 before rolling on turn 1 or 2 (mortgaging first to find the cash)', () => {
    const s = scenario();
    jail(s, 's0', 1);
    setCash(s, 's0', 20);
    own(s, 's0', [3]);
    expect(refused(s, 's0', { k: 'payFine' })).toBe('cash');
    const { state, events } = run(s, ['s0', { k: 'mortgage', space: 3 }], ['s0', { k: 'payFine' }]);
    expect(state.players.s0?.jail).toBeUndefined();
    expect(ofType(events, 'jailExit')).toEqual([{ t: 'jailExit', seat: 's0', how: 'fine' }]);
    expect(cash(state, 's0')).toBe(20 + 36 - 50);
    expect(state.phase.k).toBe('preRoll');
  });

  it('Jail: a forced third-turn fine that cannot be raised is a bankruptcy to the bank; the turn passes', () => {
    const s = scenario({ n: 3 });
    jail(s, 's0', 2);
    setCash(s, 's0', 20);
    rig(s, [1, 2]);
    const st = act(s, 's0', { k: 'roll' }).state;
    expect(st.phase).toMatchObject({ k: 'debt', debtor: 's0', owed: { bank: 50 }, why: 'fine' });
    const after = act(st, 's0', { k: 'bankrupt' }).state;
    expect(after.players.s0?.out).toBe('bankrupt');
    expect(after.turn.seat).toBe('s1');
    expect(after.phase.k).toBe('preRoll');
  });

  it('Jail: the forced third-turn move can land on Go to Jail again (fresh tries, no re-roll)', () => {
    const s = scenario();
    jail(s, 's0', 2);
    stack(s, 'chest', 'cc-jail');
    rig(s, [3, 4]);
    const { state, events } = act(s, 's0', { k: 'roll' });
    expect(ofType(events, 'jailExit')[0]?.how).toBe('forced');
    expect(ofType(events, 'jail')[0]?.reason).toBe('card');
    expect(state.players.s0?.jail).toEqual({ tries: 0 });
    expect(cash(state, 's0')).toBe(1450);
    expect(state.phase.k).toBe('postRoll');
  });

  it('Jail: a jailed player who goes bankrupt during another player\'s turn leaves jail and the game', () => {
    const s = scenario({ n: 3 });
    jail(s, 's1', 1);
    setCash(s, 's1', 10);
    const { state } = draw(s, 'chest', 'cc-wedding');
    const after = act(state, 's1', { k: 'bankrupt' }).state;
    expect(after.players.s1).toMatchObject({ out: 'bankrupt', cash: 0 });
    expect(after.players.s1?.jail).toBeUndefined();
    expect(cash(after, 's0')).toBe(1500 + 10 + 50);
  });

  it('Jail: jailed players still collect rent', () => {
    const s = scenario();
    jail(s, 's1', 1);
    own(s, 's1', [21]);
    const { events } = rollFrom(s, 18, [1, 2]);
    expect(rentPaid(events)).toBe(18);
  });

  it('Jail: jailed players may build, sell and mortgage, on their own turn or anyone else\'s', () => {
    let s = scenario();
    jail(s, 's1', 0);
    own(s, 's1', [1, 3]);
    own(s, 's1', [5]);
    // s0's turn
    s = act(s, 's1', { k: 'build', group: 'brown', levels: [1, 0] }).state;
    expect(s.props.p1?.level).toBe(1);
    s = act(s, 's1', { k: 'mortgage', space: 5 }).state;
    rig(s, [4, 6]);
    s = run(s, ['s0', { k: 'roll' }], ['s0', { k: 'endTurn' }]).state;
    // s1's own turn, still jailed
    expect(s.turn.seat).toBe('s1');
    s = act(s, 's1', { k: 'build', group: 'brown', levels: [1, 1] }).state;
    s = act(s, 's1', { k: 'sell', group: 'brown', levels: [1, 0] }).state;
    expect(s.players.s1?.jail).toEqual({ tries: 0 });
    expect(cash(s, 's1')).toBe(1500 - 50 + 120 - 50 + 25);
  });

  it('Jail: after a failed jail roll the player may still build before ending the turn', () => {
    const s = scenario();
    jail(s, 's0', 0);
    own(s, 's0', [1, 3]);
    rig(s, [1, 2]);
    let st = act(s, 's0', { k: 'roll' }).state;
    expect(st.phase.k).toBe('postRoll');
    st = act(st, 's0', { k: 'build', group: 'brown', levels: [1, 1] }).state;
    expect([st.props.p1?.level, st.props.p3?.level, cash(st, 's0')]).toEqual([1, 1, 1400]);
    expect(st.players.s0?.jail).toEqual({ tries: 1 });
  });

  it('Jail: jailed players may trade property', () => {
    const s = scenario();
    jail(s, 's1', 0);
    own(s, 's1', [3]);
    const offer = act(s, 's0', {
      k: 'propose',
      to: 's1',
      give: { cash: 100, props: [], cards: [] },
      get: { cash: 0, props: [3], cards: [] },
    });
    const id = Object.keys(offer.state.trades)[0] as string;
    const { state } = act(offer.state, 's1', { k: 'accept', id });
    expect(state.props.p3?.owner).toBe('s0');
    expect(cash(state, 's1')).toBe(1600);
    // And propose one themselves
    const back = act(state, 's1', {
      k: 'propose',
      to: 's0',
      give: { cash: 120, props: [], cards: [] },
      get: { cash: 0, props: [3], cards: [] },
    });
    expect(Object.keys(back.state.trades)).toHaveLength(1);
  });
});
