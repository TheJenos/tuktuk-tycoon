import { describe, expect, it } from 'vitest';
import { LANKA, apply, awaiting, legalActions, type GameEvent, type GameState, type SeatId } from '../../../rules';
import { makeNames } from '../format';
import { diceText, eventSeats, formatEvent, moneyEvent, quietEvent } from '../hud/formatEvent';
import { game } from './helpers';

const names = makeNames(null, { seats: { s0: { seat: 's0', name: 'Ann', token: 'tuktuk', color: '#e8a33d', kind: 'human', ctrl: 'p_x' } } }, LANKA);
const trade = { id: 't1', from: 's0' as const, to: 's1' as const, give: { cash: 100, props: [39], cards: [] }, get: { cash: 0, props: [37], cards: ['ch-goojf'] } };

/** One event of every kind: the mapped type makes tsc fail when the engine adds a kind this test lacks */
const SAMPLES: { [K in GameEvent['t']]: Extract<GameEvent, { t: K }> } = {
  order: { t: 'order', order: ['s1', 's0'] },
  turn: { t: 'turn', seat: 's0', no: 3 },
  dice: { t: 'dice', seat: 's0', purpose: 'move', w: [4, 3], s: 'bus', doubles: false, triples: false, total: 7 },
  speedOn: { t: 'speedOn', seat: 's0' },
  move: { t: 'move', seat: 's0', from: 0, to: 7, path: [1, 2, 3, 4, 5, 6, 7], via: 'dice' },
  salary: { t: 'salary', seat: 's0', amount: 200 },
  land: { t: 'land', seat: 's0', space: 39 },
  cash: { t: 'cash', from: 's0', to: 's1', amount: 50, why: 'rent', after: { s0: 1450, s1: 1550 }, space: 39 },
  card: { t: 'card', seat: 's0', deck: 'chance', cardId: 'ch-go', text: 'Advance to Start. Collect Rs. 20,000.', kept: false },
  cardReturn: { t: 'cardReturn', deck: 'chest', cardId: 'cc-goojf', seat: 's1' },
  cardGive: { t: 'cardGive', cardId: 'cc-goojf', from: 's0', to: 's1' },
  jail: { t: 'jail', seat: 's0', reason: 'doubles' },
  jailStay: { t: 'jailStay', seat: 's0', tries: 2 },
  jailExit: { t: 'jailExit', seat: 's0', how: 'forced' },
  bus: { t: 'bus', seat: 's0', opts: [3, 4, 7] },
  chooseSpace: { t: 'chooseSpace', seat: 's0' },
  uncle: { t: 'uncle', seat: 's0', to: 11, target: 'bank' },
  owner: { t: 'owner', space: 39, to: 's0', via: 'buy' },
  level: { t: 'level', space: 39, from: 4, to: 5, bank: { houses: 32, hotels: 11 } },
  mortgage: { t: 'mortgage', space: 39, on: true },
  auctionStart: { t: 'auctionStart', lot: { k: 'prop', space: 39 }, eligible: ['s0', 's1'], queue: [] },
  bid: { t: 'bid', seat: 's1', amount: 120 },
  pass: { t: 'pass', seat: 's0', auto: true },
  auctionEnd: { t: 'auctionEnd', lot: { k: 'prop', space: 39 }, winner: 's1', amount: 120 },
  claimStart: { t: 'claimStart', kind: 'house', by: 's0', open: ['s1'], supply: 2 },
  claimRequest: { t: 'claimRequest', seat: 's1', n: 2 },
  claimEnd: { t: 'claimEnd', kind: 'house', outcome: 'auction' },
  placeStart: { t: 'placeStart', seat: 's1', kind: 'house', count: 2 },
  xferStart: { t: 'xferStart', seat: 's1', spaces: [37, 39] },
  tradeProposed: { t: 'tradeProposed', trade },
  tradeDone: { t: 'tradeDone', trade },
  tradeRejected: { t: 'tradeRejected', id: 't1' },
  tradeCancelled: { t: 'tradeCancelled', id: 't1', why: 'over' },
  debt: { t: 'debt', debtor: 's0', owed: { s1: 300, bank: 50 }, total: 350, why: 'rent' },
  debtPaid: { t: 'debtPaid', debtor: 's0' },
  bankrupt: { t: 'bankrupt', seat: 's0', to: 'bank', resigned: false },
  timeout: { t: 'timeout', seat: 's1', a: { k: 'decline' } },
  over: { t: 'over', winner: 's1', ranking: ['s1', 's0'], why: 'turnLimit' },
};

const clean = (text: string) => {
  expect(text.trim().length).toBeGreaterThan(3);
  expect(text).not.toMatch(/undefined|NaN|\[object|null/);
};

describe('formatEvent', () => {
  it('covers every event kind with a readable line', () => {
    for (const ev of Object.values(SAMPLES) as GameEvent[]) clean(formatEvent(ev, names));
  });

  it('uses the room seat names, the engine names and the board names', () => {
    expect(formatEvent(SAMPLES.cash, names)).toBe('Ann pays s1 Rs. 5,000 rent for Galle Face Penthouse');
    const withGame = makeNames(game(), null);
    expect(formatEvent(SAMPLES.bid, withGame)).toBe('Bob bids Rs. 12,000');
    expect(formatEvent(SAMPLES.auctionEnd, withGame)).toBe('Bob wins Galle Face Penthouse for Rs. 12,000');
    expect(formatEvent(SAMPLES.tradeDone, withGame)).toBe(
      'Ann and Bob trade: Rs. 10,000 and Galle Face Penthouse for Cinnamon Gardens and a Get Out of Jail Free card',
    );
    expect(formatEvent(SAMPLES.debt, withGame)).toBe('Ann owes Bob and the bank Rs. 35,000 and must raise cash');
    expect(formatEvent(SAMPLES.bus, withGame)).toBe('Ann takes the bus: move 3, 4 or 7');
    expect(formatEvent(SAMPLES.timeout, withGame)).toBe("Time's up: Bob declines to buy");
    expect(formatEvent(SAMPLES.level, withGame)).toBe('Hotel built on Galle Face Penthouse');
  });

  it('formats the dice as the readout does', () => {
    expect(diceText(names, SAMPLES.dice)).toBe('4 + 3, speed: Bus');
    expect(diceText(names, { ...SAMPLES.dice, s: 'uncle' })).toBe('4 + 3, speed: Tuk-Tuk Uncle');
    expect(diceText(names, { ...SAMPLES.dice, s: undefined } as Extract<GameEvent, { t: 'dice' }>)).toBe('4 + 3');
  });

  it('every cash reason and move kind reads cleanly', () => {
    const whys = ['salary', 'rent', 'buy', 'auction', 'tax', 'card', 'fine', 'build', 'sell', 'mortgage', 'unmortgage', 'interest', 'trade', 'bankrupt', 'refund', 'jackpot', 'debug', 'sale'] as const;
    for (const why of whys) {
      clean(formatEvent({ ...SAMPLES.cash, why }, names));
      clean(formatEvent({ ...SAMPLES.cash, why, from: 'bank', to: 's0', space: undefined } as GameEvent, names));
    }
    for (const via of ['dice', 'card', 'uncle', 'triple', 'bus', 'jail', 'back'] as const) clean(formatEvent({ ...SAMPLES.move, via }, names));
  });

  it('names events of the room options: the jackpot, the quick-start deal and every way a game ends', () => {
    expect(formatEvent({ ...SAMPLES.cash, why: 'jackpot', from: 'bank', to: 's0', amount: 125, space: 20 } as GameEvent, names))
      .toBe('Ann wins the Rs. 12,500 jackpot on Tuk-Tuk Stand!');
    expect(formatEvent({ t: 'owner', space: 39, to: 's0', via: 'deal' }, names)).toBe(`Ann is dealt ${names.space(39)}`);
    const over = (why: Extract<GameEvent, { t: 'over' }>['why']) => formatEvent({ ...SAMPLES.over, winner: 's0', why }, names);
    expect(over('lastStanding')).toBe('Ann wins the game!');
    expect(over('turnLimit')).toBe('Turn limit reached: Ann wins on net worth');
    expect(over('endGame')).toBe('Game finished: Ann wins on net worth');
    expect(over('firstBankrupt')).toBe('First bankruptcy: Ann wins on net worth');
    expect(over('timeUp')).toBe("Time's up: Ann wins on net worth");
  });

  it('knows the quiet, money and per-seat events', () => {
    expect(quietEvent(SAMPLES.land)).toBe(true);
    expect(quietEvent(SAMPLES.bid)).toBe(false);
    expect(quietEvent({ ...SAMPLES.cash, why: 'salary' })).toBe(true);
    // The jail event right after it says why: one line, not two
    expect(quietEvent({ ...SAMPLES.move, via: 'jail' })).toBe(true);
    expect(quietEvent(SAMPLES.move)).toBe(false);
    expect(moneyEvent(SAMPLES.cash)).toBe(true);
    expect(moneyEvent(SAMPLES.move)).toBe(false);
    expect(eventSeats(SAMPLES.cash)).toEqual(['s0', 's1']);
    expect(eventSeats(SAMPLES.debt)).toEqual(['s0', 's1']);
    expect(eventSeats(SAMPLES.tradeDone)).toEqual(['s0', 's1']);
    expect(eventSeats(SAMPLES.level)).toEqual([]);
  });

  it('formats everything a real game produces', () => {
    let s: GameState = game(3, { speedDie: true });
    const real = makeNames(s, null);
    let rnd = 12345;
    const next = () => ((rnd = (rnd * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const seen = new Set<string>();
    for (let step = 0; step < 1500 && s.phase.k !== 'over'; step++) {
      const seat = awaiting(s)[0] as SeatId;
      const moves = legalActions(s, seat).filter((a) => a.k !== 'resign');
      const a = moves[Math.floor(next() * moves.length)];
      if (!a) break;
      const r = apply(s, { by: seat, a }, { check: false });
      if (!r.ok) continue;
      s = r.state;
      for (const ev of r.events) {
        seen.add(ev.t);
        clean(formatEvent(ev, real));
      }
    }
    expect(seen.size).toBeGreaterThan(10);
  });
});
