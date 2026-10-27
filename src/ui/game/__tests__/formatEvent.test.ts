import { describe, expect, it } from 'vitest';
import { LANKA, apply, awaiting, legalActions, type GameEvent, type GameState, type SeatId } from '../../../rules';
import { makeNames } from '../format';
import { diceText, eventSeats, formatEvent, moneyEvent, quietEvent } from '../hud/formatEvent';
import { game, heroesGame } from './helpers';

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
  heroDie: { t: 'heroDie', seat: 's0', face: 4, hero: 'stormLord', purpose: 'card', card: 'ch-illusionist' },
  power: { t: 'power', seat: 's1', power: 'thunder', target: 's0' },
  powerReady: { t: 'powerReady', seat: 's0' },
  aimPeek: { t: 'aimPeek', seat: 's0', deck: 'chance', cards: ['ch-drain', 'ch-tribute'] },
  noSave: { t: 'noSave', seat: 's0', space: 16 },
  short: { t: 'short', seat: 's0', why: 'rent', space: 16, owed: { s1: 150 }, paid: { s1: 60 } },
  reactTimeout: { t: 'reactTimeout', seats: ['s1'] },
};

/** Hero League's lines, with Ann (s0) playing Jade Titan and Bob (s1) Storm Lord */
const heroNames = makeNames(heroesGame(['jadeTitan', 'stormLord']), null);
const hero = (ev: GameEvent) => formatEvent(ev, heroNames);

/** Franchise names that must never appear in what the game prints */
const TRADEMARKS = /marvel|avenger|S\.H\.I\.E\.L\.D|monopoly|hasbro|\bhulk\b|\bthor\b|captain america|iron man|black widow|hawkeye|\bstark\b/i;
/** A hero's ability is its superpower's name or "superpower": never a bare "power" (the currency is "Power") */
const BARE_POWER = /(?<![\w-])power(?!-up)\b/;

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
    for (const via of ['dice', 'card', 'uncle', 'triple', 'bus', 'jail', 'back', 'swap', 'power'] as const) clean(formatEvent({ ...SAMPLES.move, via }, names));
    for (const via of ['buy', 'auction', 'trade', 'bankrupt', 'deal', 'sold', 'backup', 'villain', 'free'] as const) {
      clean(formatEvent({ ...SAMPLES.owner, via }, names));
      clean(formatEvent({ t: 'owner', space: 39, from: 's0', via }, names));
    }
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
    expect(over('allSaved')).toBe('Every property bought: Ann wins on net worth');
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
    expect(eventSeats(SAMPLES.power)).toEqual(['s1', 's0']);
    expect(eventSeats(SAMPLES.short)).toEqual(['s0', 's1']);
    expect(eventSeats(SAMPLES.reactTimeout)).toEqual(['s1']);
    expect(moneyEvent(SAMPLES.short)).toBe(true);
    // A save by the back-up hero or for free has no cash line, so its owner line is not quiet
    expect(quietEvent({ t: 'owner', space: 16, to: 's1', via: 'backup' })).toBe(false);
    expect(quietEvent({ t: 'owner', space: 16, to: 's1', via: 'free' })).toBe(false);
    expect(quietEvent({ t: 'owner', space: 16, to: 's1', via: 'buy' })).toBe(true);
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

describe('formatEvent on Hero League', () => {
  it('says Power, power-ups, saves and the Power Broker', () => {
    expect(hero({ ...SAMPLES.cash, space: 16, amount: 140 })).toBe('Ann pays Bob 140 Power (Sky Carrier power-up)');
    expect(hero({ t: 'cash', from: 's0', to: 'bank', amount: 260, why: 'buy', after: {}, space: 16 })).toBe('Ann saves Sky Carrier for 260 Power');
    expect(hero({ t: 'cash', from: 's0', to: 'bank', amount: 50, why: 'card', after: {} })).toBe('Ann pays 50 Power');
    expect(hero({ t: 'salary', seat: 's0', amount: 200 })).toBe('Ann passes Rally Point and collects 200 Power');
    expect(hero({ t: 'bid', seat: 's0', amount: 12 })).toBe('Ann bids 12 Power');
  });

  it('says what each superpower does, by its name', () => {
    expect(hero(SAMPLES.power)).toBe("Bob re-rolls Ann's throw: Thunder Call");
    expect(hero({ t: 'power', seat: 's1', power: 'thunder', target: 's1' })).toBe('Bob re-rolls their own throw: Thunder Call');
    expect(hero({ t: 'power', seat: 's0', power: 'thunder', copied: true, target: 's1' })).toBe("Ann re-rolls Bob's throw: Thunder Call (Suit Up)");
    expect(hero({ t: 'power', seat: 's1', power: 'shield' })).toBe('Bob says no: Star Shield');
    expect(hero({ t: 'power', seat: 's0', power: 'smash' })).toBe('Ann swaps two heroes: Titan Smash');
    expect(hero({ t: 'power', seat: 's0', power: 'sting' })).toBe('Ann moves further: Viper Strike');
    expect(hero({ t: 'power', seat: 's0', power: 'aim' })).toBe('Ann takes aim: Dead Aim');
    expect(hero(SAMPLES.powerReady)).toBe("Ann's superpower is ready again");
    expect(hero({ t: 'move', seat: 's0', from: 0, to: 4, path: [4], via: 'swap' })).toBe('Ann swaps places to The Iron Raft (Titan Smash)');
    expect(hero({ t: 'move', seat: 's0', from: 4, to: 4, path: [4], via: 'swap' })).toBe('Ann stays on The Iron Raft (Titan Smash)');
  });

  it('names the hero the Hero die picks, and who plays it', () => {
    expect(hero(SAMPLES.heroDie)).toBe('Ann throws the Hero die: Storm Lord (Bob)');
    expect(hero({ ...SAMPLES.heroDie, face: 6, hero: 'sharpshot' })).toBe("Ann throws the Hero die: Sharpshot, nobody's hero");
    expect(hero({ ...SAMPLES.heroDie, purpose: 'backup', card: undefined } as GameEvent)).toBe('Ann throws the Hero die for a back-up hero: Storm Lord (Bob)');
  });

  it('says who saves a location and who loses one, short payments and the end', () => {
    expect(hero({ t: 'owner', space: 16, to: 's1', via: 'backup' })).toBe('Bob steps in as the back-up hero for Sky Carrier');
    expect(hero({ t: 'owner', space: 16, to: 's0', via: 'free' })).toBe('Ann saves Sky Carrier for free');
    expect(hero({ t: 'owner', space: 16, to: 's0', via: 'buy' })).toBe('Ann has saved Sky Carrier');
    expect(hero({ t: 'owner', space: 16, from: 's0', via: 'villain' })).toBe('Ann loses Sky Carrier to The Fang Legion');
    expect(hero({ t: 'owner', space: 16, from: 's0', via: 'bankrupt' })).toBe('Sky Carrier goes back to The Fang Legion');
    expect(hero(SAMPLES.noSave)).toBe('Nobody can save Sky Carrier: The Fang Legion keeps it');
    expect(hero(SAMPLES.short)).toBe('Ann could pay Bob only 60 of 150 Power (Sky Carrier power-up): the rest is forgiven');
    expect(hero({ t: 'short', seat: 's0', why: 'fine', owed: { bank: 50 }, paid: { bank: 20 } })).toBe('Ann could pay the Power Broker only 20 of 50 Power (the fine): the rest is forgiven');
    expect(hero({ ...SAMPLES.over, winner: 's0', why: 'allSaved' })).toBe('Every location saved: Ann wins on score');
    expect(hero({ ...SAMPLES.over, winner: 's0', why: 'turnLimit' })).toBe('Turn limit reached: Ann wins on score');
    expect(hero(SAMPLES.reactTimeout)).toBe("Time's up: Bob passes");
    expect(hero({ t: 'reactTimeout', seats: ['s0', 's1'] })).toBe("Time's up: Ann and Bob pass");
  });

  it('never names the cards Dead Aim reveals', () => {
    const line = hero(SAMPLES.aimPeek);
    expect(line).toBe('Ann looks at the top 2 cards of Villain Strike');
    expect(line).not.toMatch(/mind-trap|drains|tribute/i);
  });

  it('formats everything a real Hero League game produces, in its own wording', () => {
    let s: GameState = heroesGame(['jadeTitan', 'stormLord', 'starCaptain', 'steelAce', 'velvetViper', 'sharpshot'], { startCash: 600 });
    const real = makeNames(s, null);
    let rnd = 777;
    const next = () => ((rnd = (rnd * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const seen = new Set<string>();
    for (let step = 0; step < 4000 && s.phase.k !== 'over'; step++) {
      const seat = awaiting(s)[0] as SeatId;
      const moves = legalActions(s, seat).filter((a) => a.k !== 'resign');
      const a = moves[Math.floor(next() * moves.length)];
      if (!a) break;
      const r = apply(s, { by: seat, a }, { check: false });
      if (!r.ok) continue;
      s = r.state;
      for (const ev of r.events) {
        seen.add(ev.t);
        const line = formatEvent(ev, real);
        clean(line);
        expect(line).not.toMatch(/Rs\.|rent|net worth|the bank/);
        expect(line).not.toMatch(BARE_POWER);
        expect(line).not.toMatch(TRADEMARKS);
      }
    }
    for (const t of ['heroDie', 'power', 'powerReady', 'short', 'owner']) expect(seen.has(t)).toBe(true);
  });
});
