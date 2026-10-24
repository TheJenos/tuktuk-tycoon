import { describe, expect, it } from 'vitest';
import {
  apply,
  awaiting,
  createGame,
  decode,
  defaultAction,
  encode,
  legalActions,
  mayBuy,
  rentFor,
  tradeProblems,
  tradingClosed,
} from '..';
import type { Bundle, GameState, RulesConfig } from '../types';
import { SEATS, act, cash, ofType, own, pos, refused, rig, run, scenario, setCash, setPos, stack } from './helpers';

/*
 * The optional room rules, one block each, through real apply() calls. The defaults reproduce the classic rules
 * (every other suite runs with them).
 */

const roll = (s: GameState): ReturnType<typeof act> => act(s, 's0', { k: 'roll' });
const none: Bundle = { cash: 0, props: [], cards: [] };

describe('double salary on landing exactly on Start', () => {
  it('pays twice the salary on an exact landing, once when passing', () => {
    const on = scenario({ cfg: { doubleGoLanding: true } });
    setPos(on, 's0', 36);
    rig(on, [1, 3]);
    const landed = roll(on);
    expect(ofType(landed.events, 'salary')).toEqual([{ t: 'salary', seat: 's0', amount: 400 }]);
    expect(cash(landed.state, 's0')).toBe(1900);
    expect(landed.state.players.s0?.laps).toBe(1);

    const passing = scenario({ cfg: { doubleGoLanding: true } });
    setPos(passing, 's0', 35);
    rig(passing, [2, 4]);
    expect(cash(roll(passing).state, 's0')).toBe(1700);
  });

  it('is off by default', () => {
    const s = scenario();
    setPos(s, 's0', 36);
    rig(s, [1, 3]);
    expect(cash(roll(s).state, 's0')).toBe(1700);
  });
});

describe('Tuk-Tuk Stand jackpot', () => {
  /** s0 lands on the Wedding Gift Envelope (luxury tax 75) */
  const luxury = (cfg: Partial<RulesConfig>): GameState => {
    const s = scenario({ cfg });
    setPos(s, 's0', 35);
    rig(s, [1, 2]);
    return roll(s).state;
  };

  it('taxes go into the pot; landing on the Tuk-Tuk Stand wins it', () => {
    const s = luxury({ jackpot: true });
    expect(s.pot).toBe(75);
    const next = act(s, 's0', { k: 'endTurn' }).state;
    setPos(next, 's1', 15);
    rig(next, [2, 3]);
    const { state, events } = act(next, 's1', { k: 'roll' });
    expect(pos(state, 's1')).toBe(20);
    expect(ofType(events, 'cash')).toEqual([
      { t: 'cash', from: 'bank', to: 's1', amount: 75, why: 'jackpot', after: { s1: 1575 }, space: 20 },
    ]);
    expect(state.pot).toBe(0);
  });

  it('fines and card payments feed it too; rent and purchases do not', () => {
    let s = scenario({ cfg: { jackpot: true } });
    setPos(s, 's0', 10);
    s.players.s0!.jail = { tries: 0 };
    s = act(s, 's0', { k: 'payFine' }).state;
    expect(s.pot).toBe(50);
    stack(s, 'chest', 'cc-doctor');
    rig(s, [1, 6]);
    s = roll(s).state;
    expect(pos(s, 's0')).toBe(17);
    expect(s.pot).toBe(100);

    const t = scenario({ cfg: { jackpot: true } });
    own(t, 's1', [3]);
    setPos(t, 's0', 0);
    rig(t, [1, 2]);
    const rent = roll(t).state;
    expect(rent.pot).toBe(0);
  });

  it('a tax paid late, when the debt settles, still goes into the pot', () => {
    const s = scenario({ cfg: { jackpot: true } });
    setCash(s, 's0', 10);
    own(s, 's0', [5]);
    setPos(s, 's0', 35);
    rig(s, [1, 2]);
    const debt = roll(s).state;
    expect(debt.phase).toMatchObject({ k: 'debt', owed: { bank: 75 } });
    expect(debt.pot).toBe(0);
    const { state, events } = act(debt, 's0', { k: 'mortgage', space: 5 });
    expect(ofType(events, 'debtPaid')).toHaveLength(1);
    expect(state.pot).toBe(75);
  });

  it('is off by default: nothing collects and the stand pays nothing', () => {
    const s = luxury({});
    expect(s.pot).toBe(0);
    const next = act(s, 's0', { k: 'endTurn' }).state;
    setPos(next, 's1', 15);
    rig(next, [2, 3]);
    expect(ofType(act(next, 's1', { k: 'roll' }).events, 'cash')).toEqual([]);
  });
});

describe('Inland Revenue mode', () => {
  const onIncomeTax = (cfg: Partial<RulesConfig>): ReturnType<typeof act> => {
    const s = scenario({ cfg });
    setPos(s, 's0', 1);
    rig(s, [1, 2]);
    return roll(s);
  };

  it('flat: pays the flat amount at once, with no choice', () => {
    const { state, events } = onIncomeTax({ incomeTaxMode: 'flat' });
    expect(state.phase.k).toBe('postRoll');
    expect(cash(state, 's0')).toBe(1300);
    expect(ofType(events, 'cash')[0]).toMatchObject({ why: 'tax', amount: 200, space: 4 });
  });

  it('percent: pays the percentage of worth at once', () => {
    const { state } = onIncomeTax({ incomeTaxMode: 'percent' });
    expect(state.phase.k).toBe('postRoll');
    expect(cash(state, 's0')).toBe(1500 - 150);
  });

  it('a pick the mode does not allow is refused; the default follows the mode', () => {
    const s = onIncomeTax({}).state;
    expect(s.phase.k).toBe('incomeTax');
    s.cfg.incomeTaxMode = 'flat';
    expect(refused(s, 's0', { k: 'incomeTax', pick: 'percent' })).toBe('badChoice');
    expect(defaultAction(s, 's0')).toEqual({ k: 'incomeTax', pick: 'flat' });
    expect(legalActions(s, 's0')).not.toContainEqual({ k: 'incomeTax', pick: 'percent' });
  });
});

describe('auctions off', () => {
  it('a declined property stays with the bank', () => {
    const s = scenario({ cfg: { auctions: false } });
    rig(s, [1, 2]);
    const { state, events } = act(roll(s).state, 's0', { k: 'decline' });
    expect(state.phase.k).toBe('postRoll');
    expect(state.props.p3).toBeUndefined();
    expect(ofType(events, 'auctionStart')).toEqual([]);
  });

  it('a bankruptcy to the bank returns the property without auctions', () => {
    const s = scenario({ n: 3, cfg: { auctions: false } });
    setCash(s, 's0', 10);
    own(s, 's0', [1, 3, 5], { mortgaged: true });
    setPos(s, 's0', 15);
    stack(s, 'chest', 'cc-school');
    rig(s, [1, 1]);
    const debt = roll(s).state;
    expect(debt.phase).toMatchObject({ k: 'debt', owed: { bank: 150 } });
    const { state, events } = act(debt, 's0', { k: 'bankrupt' });
    expect(ofType(events, 'auctionStart')).toEqual([]);
    expect([1, 3, 5].map((x) => state.props[`p${x}`])).toEqual([undefined, undefined, undefined]);
    expect(state.phase.k).toBe('preRoll');
    expect(state.turn.seat).toBe('s1');
  });

  it('a building shortage is granted in request order up to the supply', () => {
    const s = scenario({ n: 3, cfg: { auctions: false, houses: 4 } });
    own(s, 's0', [1, 3]);
    own(s, 's1', [6, 8, 9]);
    own(s, 's2', [11, 13, 14]);
    let t = act(s, 's0', { k: 'build', group: 'brown', levels: [1, 1] }).state;
    expect(t.phase).toMatchObject({ k: 'buildClaim', open: ['s1', 's2'] });
    t = act(t, 's2', { k: 'requestBuild', n: 2 }).state;
    const { state, events } = act(t, 's1', { k: 'requestBuild', n: 3 });
    // s0 (the starter) builds its 2, s2 asked before s1 and gets the last 2, s1 gets none
    expect(ofType(events, 'claimEnd')).toEqual([{ t: 'claimEnd', kind: 'house', outcome: 'granted' }]);
    expect(ofType(events, 'auctionStart')).toEqual([]);
    expect([1, 3].map((x) => state.props[`p${x}`]?.level)).toEqual([1, 1]);
    expect(state.phase).toMatchObject({ k: 'place', seat: 's2', count: 2, resume: { k: 'preRoll' } });
    const done = run(state, ['s2', { k: 'place', space: 11 }], ['s2', { k: 'place', space: 13 }]).state;
    expect(done.phase.k).toBe('preRoll');
    expect(done.bank.houses).toBe(0);
    expect([6, 8, 9].map((x) => done.props[`p${x}`]?.level)).toEqual([0, 0, 0]);
  });
});

describe('first-lap rule', () => {
  it('no buying before the first salary; the property stays with the bank', () => {
    const s = scenario({ cfg: { buyAfterFirstLap: true } });
    expect(mayBuy(s, 's0')).toBe(false);
    rig(s, [1, 2]);
    const { state } = roll(s);
    expect(state.phase.k).toBe('postRoll');
    expect(state.props.p3).toBeUndefined();
    expect(refused(state, 's0', { k: 'buy' })).toBe('phase');
  });

  it('passing Start counts a lap and opens buying', () => {
    const s = scenario({ cfg: { buyAfterFirstLap: true } });
    setPos(s, 's0', 38);
    rig(s, [1, 2]);
    const { state } = roll(s);
    expect(state.players.s0?.laps).toBe(1);
    expect(state.phase).toEqual({ k: 'buy', space: 1 });
  });

  it('seats on their first lap cannot bid at auction', () => {
    const s = scenario({ n: 3, cfg: { buyAfterFirstLap: true } });
    s.players.s0!.laps = 1;
    s.players.s2!.laps = 2;
    rig(s, [1, 2]);
    const { state } = act(roll(s).state, 's0', { k: 'decline' });
    expect(state.phase).toMatchObject({ k: 'auction', eligible: ['s0', 's2'] });
    expect(awaiting(state)).toEqual(['s0', 's2']);
  });

  it('Tuk-Tuk Uncle on the first lap passes over the bank property without a buy', () => {
    const s = scenario({ cfg: { speedDie: true, buyAfterFirstLap: true } });
    s.players.s0!.speed = true;
    rig(s, [1, 2, 'uncle']);
    const { state, events } = roll(s);
    expect(ofType(events, 'uncle')).toEqual([{ t: 'uncle', seat: 's0', to: 5, target: 'bank' }]);
    expect(pos(state, 's0')).toBe(5);
    expect(state.phase.k).toBe('postRoll');
    expect(state.props.p3).toBeUndefined();
    expect(state.props.p5).toBeUndefined();
  });
});

describe('rent while jailed', () => {
  it('off: a jailed owner collects nothing', () => {
    const s = scenario({ cfg: { jailRent: false } });
    own(s, 's1', [3]);
    setPos(s, 's1', 10);
    s.players.s1!.jail = { tries: 0 };
    expect(rentFor(s, 3)).toBe(0);
    rig(s, [1, 2]);
    const { state, events } = roll(s);
    expect(ofType(events, 'cash')).toEqual([]);
    expect(cash(state, 's0')).toBe(1500);
  });

  it('on (default): rent is paid as usual', () => {
    const s = scenario();
    own(s, 's1', [3]);
    setPos(s, 's1', 10);
    s.players.s1!.jail = { tries: 0 };
    const rent = rentFor(s, 3);
    expect(rent).toBeGreaterThan(0);
    rig(s, [1, 2]);
    expect(cash(roll(s).state, 's0')).toBe(1500 - rent);
  });
});

describe('three doubles to jail', () => {
  /** s0 rolls four doubles and a plain throw, landing only on its own property */
  const doubles = (on: boolean): ReturnType<typeof run> => {
    const s = scenario({ cfg: { threeDoublesJail: on } });
    own(s, 's0', [5, 11, 19, 29, 32]);
    setPos(s, 's0', 1);
    rig(s, [2, 2], [3, 3], [4, 4], [5, 5], [1, 2]);
    const cmds: ['s0', { k: 'roll' }][] = [];
    for (let i = 0; i < (on ? 3 : 5); i++) cmds.push(['s0', { k: 'roll' }]);
    return run(s, ...cmds);
  };

  it('off: keeps rolling (the doubles count stops at 3)', () => {
    const { state, events } = doubles(false);
    expect(ofType(events, 'jail')).toEqual([]);
    expect(pos(state, 's0')).toBe(32);
    expect(state.turn.doubles).toBe(3);
    expect(state.phase.k).toBe('postRoll');
  });

  it('on (default): the third doubles goes to jail', () => {
    const { state, events } = doubles(true);
    expect(ofType(events, 'jail')).toEqual([{ t: 'jail', seat: 's0', reason: 'doubles' }]);
    expect(state.players.s0?.jail).toBeDefined();
  });
});

describe('quick-start deal', () => {
  const seats = (n: number) => SEATS.slice(0, n).map((id, i) => ({ id, name: `P${i}` }));

  it('deals N properties to each seat after the opening roll, round-robin in turn order', () => {
    const { state, events } = createGame({ dealProperties: 2 }, seats(3), 7);
    const deals = ofType(events, 'owner');
    expect(deals).toHaveLength(6);
    expect(deals.every((e) => e.via === 'deal' && e.from === undefined)).toBe(true);
    expect(deals.map((e) => e.to)).toEqual([...state.order, ...state.order]);
    expect(new Set(deals.map((e) => e.space)).size).toBe(6);
    for (const e of deals) expect(state.props[`p${e.space}`]).toEqual({ owner: e.to, level: 0 });
    // After the order, before the first turn
    const kinds = events.map((e) => e.t).filter((t) => t !== 'dice');
    expect(kinds).toEqual(['order', 'owner', 'owner', 'owner', 'owner', 'owner', 'owner', 'turn']);
    // Seeded: the same seed deals the same
    expect(createGame({ dealProperties: 2 }, seats(3), 7).state.props).toEqual(state.props);
  });

  it('never deals more than the board holds; 0 deals nothing and leaves the dice alone', () => {
    const big = createGame({ dealProperties: 3 }, seats(8), 3).state;
    expect(Object.keys(big.props)).toHaveLength(24);
    const plain = createGame({}, seats(3), 7);
    expect(ofType(plain.events, 'owner')).toEqual([]);
    expect(createGame({ dealProperties: 0 }, seats(3), 7).state).toEqual(plain.state);
  });
});

describe('game end', () => {
  /** s0 owes s1 a hotel rent it cannot raise; s2 is richer than s1 before the creditor takes s0's assets */
  const hotelDebt = (cfg: Partial<RulesConfig>): GameState => {
    const s = scenario({ n: 3, cfg });
    own(s, 's1', [37, 39], { level: 5 });
    setCash(s, 's0', 300);
    own(s, 's0', [5]);
    setCash(s, 's1', 0);
    setCash(s, 's2', 3000);
    setPos(s, 's0', 35);
    rig(s, [1, 3]);
    return roll(s).state;
  };

  it('firstBankrupt: the first bankruptcy ends the game, ranked after the creditor got the assets', () => {
    const debt = hotelDebt({ endMode: 'firstBankrupt' });
    expect(debt.phase).toMatchObject({ k: 'debt', debtor: 's0' });
    const { state, events } = act(debt, 's0', { k: 'bankrupt' });
    expect(state.props.p5?.owner).toBe('s1');
    // s1 was worth 2750 (the dark blues with hotels), behind s2's 3000; with s0's 300 cash and railway it is 3250
    expect(state.phase).toMatchObject({ k: 'over', why: 'firstBankrupt', winner: 's1', ranking: ['s1', 's2', 's0'] });
    expect(ofType(events, 'over')).toHaveLength(1);
    expect(ofType(events, 'xferStart')).toEqual([]);
  });

  it('lastStanding (default): play goes on', () => {
    const { state } = act(hotelDebt({}), 's0', { k: 'bankrupt' });
    expect(state.phase.k).not.toBe('over');
  });

  it('firstBankrupt: a plain resignation does not end the game', () => {
    const s = scenario({ n: 3, cfg: { endMode: 'firstBankrupt' } });
    expect(act(s, 's2', { k: 'resign' }).state.phase.k).toBe('preRoll');
  });

  it('timeUp: only the system, with a basis, ends the game ranked by net worth', () => {
    const s = scenario({ n: 3 });
    setCash(s, 's2', 2000);
    expect(refused(s, 's0', { k: 'timeUp' })).toBe('badActor');
    expect(apply(s, { by: 'system', a: { k: 'timeUp' } }).ok).toBe(false);
    expect(refused(s, 'system', { k: 'timeUp' }, s.seq + 1)).toBe('stale');
    const { state, events } = act(s, 'system', { k: 'timeUp' }, s.seq);
    expect(state.phase).toMatchObject({ k: 'over', why: 'timeUp', winner: 's2' });
    expect(ofType(events, 'over')[0]?.why).toBe('timeUp');
  });
});

describe('trading', () => {
  const offer = { from: 's0' as const, to: 's1' as const, give: { cash: 0, props: [1], cards: [] }, get: none };
  const withProps = (cfg: Partial<RulesConfig>): GameState => {
    const s = scenario({ cfg });
    own(s, 's0', [1]);
    return s;
  };

  it('off: every offer is refused with a reason', () => {
    const s = withProps({ trading: 'off' });
    expect(tradeProblems(s, offer).map((e) => e.message)).toEqual(['Trading is off in this game']);
    expect(refused(s, 's0', { k: 'propose', to: 's1', give: offer.give, get: none })).toBe('tradingOff');
  });

  it('afterLap: opens once both players have collected N salaries', () => {
    const s = withProps({ trading: 'afterLap', tradeAfterLap: 2 });
    s.players.s0!.laps = 2;
    s.players.s1!.laps = 1;
    expect(tradingClosed(s, 's0', 's1')?.message).toBe('Trading opens after lap 2');
    expect(tradeProblems(s, offer).map((e) => e.code)).toEqual(['tradingLater']);
    expect(refused(s, 's0', { k: 'propose', to: 's1', give: offer.give, get: none })).toBe('tradingLater');
    s.players.s1!.laps = 2;
    expect(tradeProblems(s, offer)).toEqual([]);
    expect(act(s, 's0', { k: 'propose', to: 's1', give: offer.give, get: none }).state.trades).not.toEqual({});
  });

  it('accept is checked again; reject always works', () => {
    const s = act(withProps({}), 's0', { k: 'propose', to: 's1', give: offer.give, get: none }).state;
    const id = Object.keys(s.trades)[0] as string;
    s.cfg.trading = 'off';
    expect(refused(s, 's1', { k: 'accept', id })).toBe('tradingOff');
    expect(act(s, 's1', { k: 'reject', id }).state.trades).toEqual({});
  });
});

describe('state fields', () => {
  it('decode fills pot and laps missing from a hand-written save', () => {
    const s = scenario();
    const raw = JSON.parse(encode(s)) as Record<string, unknown> & { players: Record<string, Record<string, unknown>> };
    delete raw.pot;
    for (const p of Object.values(raw.players)) delete p.laps;
    const back = decode(JSON.stringify(raw));
    expect(back.pot).toBe(0);
    expect(back.players.s0?.laps).toBe(0);
  });
});
