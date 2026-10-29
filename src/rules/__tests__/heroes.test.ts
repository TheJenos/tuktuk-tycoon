import { describe, expect, it } from 'vitest';
import {
  apply,
  buildOptions,
  canMortgage,
  canSellProperty,
  canUnmortgage,
  createGame,
  DEFAULT_RULES,
  decode,
  encode,
  HEROES,
  HEROES_FIXED,
  legalActions,
  maxRaise,
  normalizeConfig,
  score,
  timeoutCommand,
} from '..';
import type { Action } from '../types';
import { act, cash, ofType, own, pos, refused, rig, run, SEATS, setCash, setPos } from './helpers';
import { FACE, heroGame, jail, LOCATIONS, rigHero } from './heroesHelpers';

describe('Hero League: setup', () => {
  it('pins the fixed rules whatever the room asked for, and keeps the adjustable ones', () => {
    const asked = {
      board: 'heroes',
      speedDie: true,
      houses: 32,
      hotels: 12,
      auctions: true,
      auctionAll: true,
      jailRent: true,
      buyAfterFirstLap: true,
      dealProperties: 3,
      endMode: 'firstBankrupt',
      jackpot: true,
      trading: 'on',
      startCash: 600,
      goSalary: 300,
      jailFine: 80,
      doubleGoLanding: true,
      threeDoublesJail: false,
      turnLimit: 50,
    } as const;
    const cfg = normalizeConfig(asked);
    expect(cfg).toMatchObject(HEROES_FIXED);
    expect(cfg).toMatchObject({ startCash: 600, goSalary: 300, jailFine: 80, doubleGoLanding: true, threeDoublesJail: false, turnLimit: 50 });
    expect(HEROES_FIXED).toEqual({
      speedDie: false,
      houses: 0,
      hotels: 0,
      auctions: false,
      auctionAll: false,
      fixedAuctionCountdown: false,
      jailRent: false,
      buyAfterFirstLap: false,
      dealProperties: 0,
      endMode: 'lastStanding',
      jackpot: false,
      trading: 'off',
    });
    expect(HEROES.rules).toEqual(HEROES_FIXED);
    // The same request on a classic board is left alone
    expect(normalizeConfig({ ...asked, board: 'lanka' })).toMatchObject({ speedDie: true, houses: 32, trading: 'on', auctions: true });
    // A decoded state is pinned again
    const s = heroGame();
    const raw = JSON.parse(encode(s));
    raw.cfg.trading = 'on';
    expect(decode(JSON.stringify(raw)).cfg.trading).toBe('off');
  });

  it('starts everyone on 1,500 Power at Rally Point, one hero each', () => {
    const s = heroGame(['stormLord', 'starCaptain', 'sharpshot']);
    for (const seat of ['s0', 's1', 's2'] as const) {
      expect(cash(s, seat)).toBe(1500);
      expect(pos(s, seat)).toBe(0);
      expect(s.players[seat]?.powerUsed).toBeUndefined();
    }
    expect(s.order.map((seat) => s.players[seat]?.hero)).toEqual(['stormLord', 'starCaptain', 'sharpshot']);
    expect(s.bank).toEqual({ houses: 0, hotels: 0 });
  });

  it('assigns heroes in two passes: valid free requests in seat order, then the rest in list order', () => {
    const seats = (heroes: (string | undefined)[]) =>
      heroes.map((hero, i) => ({ id: SEATS[i]!, name: `P${i}`, ...(hero === undefined ? {} : { hero }) }));
    const heroesOf = (heroes: (string | undefined)[]) => {
      const { state } = createGame({ board: 'heroes' }, seats(heroes), 3);
      return SEATS.slice(0, heroes.length).map((seat) => state.players[seat]?.hero);
    };
    expect(heroesOf(['stormLord', 'stormLord', 'tuktuk', undefined])).toEqual(['stormLord', 'jadeTitan', 'starCaptain', 'steelAce']);
    // A later seat's valid request beats an earlier seat's bad one
    expect(heroesOf(['nobody', 'jadeTitan'])).toEqual(['starCaptain', 'jadeTitan']);
    expect(heroesOf([undefined, undefined, undefined, undefined, undefined, undefined])).toEqual([
      'jadeTitan',
      'starCaptain',
      'steelAce',
      'stormLord',
      'velvetViper',
      'sharpshot',
    ]);
    // No RNG: the decks, the opening roll and the seed's stream are the same whatever is asked for
    const a = createGame({ board: 'heroes' }, seats(['sharpshot', 'stormLord']), 9).state;
    const b = createGame({ board: 'heroes' }, seats([undefined, undefined]), 9).state;
    expect({ rng: a.rng, decks: a.decks, order: a.order }).toEqual({ rng: b.rng, decks: b.decks, order: b.order });
    // A classic board ignores the requests: no hero anywhere
    const classic = createGame({}, seats(['sharpshot', 'stormLord']), 9);
    expect(classic).toEqual(createGame({}, seats([undefined, undefined]), 9));
    expect(classic.state.players.s0?.hero).toBeUndefined();
  });

  it('seats 2 to 6', () => {
    const seats = SEATS.slice(0, 7).map((id, i) => ({ id, name: `P${i}` }));
    expect(() => createGame({ board: 'heroes' }, seats.slice(0, 6), 1)).not.toThrow();
    expect(() => createGame({ board: 'heroes' }, seats, 1)).toThrow(/at most 6/);
  });
});

describe('Hero League: saving locations', () => {
  it('a lander with the cost saves an unowned location at once: no buy phase, no decline', () => {
    const s = heroGame();
    rig(s, [1, 3]);
    const { state, events } = act(s, 's0', { k: 'roll' });
    expect(state.props.p4).toEqual({ owner: 's0', level: 0 });
    expect(cash(state, 's0')).toBe(1380);
    expect(ofType(events, 'cash')).toEqual([{ t: 'cash', from: 's0', to: 'bank', amount: 120, why: 'buy', after: { s0: 1380 }, space: 4 }]);
    expect(ofType(events, 'owner')).toEqual([{ t: 'owner', space: 4, to: 's0', via: 'buy' }]);
    expect(state.phase.k).toBe('postRoll');
    expect(events.map((e) => e.t)).toEqual(['dice', 'move', 'land', 'cash', 'owner']);
  });

  it('nobody can save it: the villain keeps it and the lander keeps its Power', () => {
    const s = heroGame();
    setCash(s, 's0', 50);
    setCash(s, 's1', 119);
    rig(s, [1, 3]);
    const { state, events } = act(s, 's0', { k: 'roll' });
    expect(ofType(events, 'noSave')).toEqual([{ t: 'noSave', seat: 's0', space: 4 }]);
    expect(state.props.p4).toBeUndefined();
    expect(cash(state, 's0')).toBe(50);
    expect(ofType(events, 'heroDie')).toEqual([]);
  });

  it('exactly one hero can: it saves it at once, with no throw (and no RNG)', () => {
    const s = heroGame();
    setCash(s, 's0', 50);
    rig(s, [1, 3]);
    const { state, events } = act(s, 's0', { k: 'roll' });
    expect(ofType(events, 'owner')).toEqual([{ t: 'owner', space: 4, to: 's1', via: 'backup' }]);
    expect(ofType(events, 'cash')).toEqual([{ t: 'cash', from: 's1', to: 'bank', amount: 120, why: 'buy', after: { s1: 1380 }, space: 4 }]);
    expect(cash(state, 's0')).toBe(50);
    expect(ofType(events, 'heroDie')).toEqual([]);
    expect(state.rng).toBe(s.rng);
  });

  it('two or more can: one Hero-die throw among their heroes picks the back-up', () => {
    const s = heroGame(['jadeTitan', 'sharpshot', 'velvetViper']);
    setCash(s, 's0', 50);
    rig(s, [1, 3]);
    rigHero(s, FACE.sharpshot);
    const { state, events } = act(s, 's0', { k: 'roll' });
    expect(ofType(events, 'heroDie')).toEqual([{ t: 'heroDie', seat: 's0', face: 6, hero: 'sharpshot', purpose: 'backup' }]);
    expect(ofType(events, 'owner')).toEqual([{ t: 'owner', space: 4, to: 's1', via: 'backup' }]);
    expect(state.rigHero).toBeUndefined();
    expect(state.phase.k).toBe('postRoll');
  });

  it('a rigged face of a hero who cannot pay is not used: the throw is drawn among the eligible', () => {
    const s = heroGame(['jadeTitan', 'sharpshot', 'velvetViper']);
    setCash(s, 's0', 50);
    rig(s, [1, 3]);
    rigHero(s, FACE.jadeTitan);
    const { state, events } = act(s, 's0', { k: 'roll' });
    const face = ofType(events, 'heroDie')[0]?.face;
    expect([FACE.velvetViper, FACE.sharpshot]).toContain(face);
    expect(state.rng).not.toBe(s.rng);
    expect(state.rigHero).toBeUndefined();
    expect(state.props.p4?.owner).toBe(face === FACE.sharpshot ? 's1' : 's2');
  });

  it('the back-up throw is uniform over the eligible heroes', () => {
    const counts = { s1: 0, s2: 0 };
    for (let seed = 1; seed <= 200; seed++) {
      const s = heroGame(['jadeTitan', 'sharpshot', 'velvetViper'], {}, seed);
      setCash(s, 's0', 50);
      rig(s, [1, 3]);
      const owner = act(s, 's0', { k: 'roll' }).state.props.p4?.owner as 's1' | 's2';
      counts[owner]++;
    }
    expect(counts.s1).toBeGreaterThan(70);
    expect(counts.s2).toBeGreaterThan(70);
  });

  it('a back-up throw gets a Thunder window; a re-roll throws again among the eligible', () => {
    const s = heroGame(['jadeTitan', 'starCaptain', 'steelAce', 'stormLord']);
    setCash(s, 's0', 50);
    setCash(s, 's3', 100);
    rig(s, [1, 3]);
    rigHero(s, FACE.starCaptain, FACE.steelAce);
    // The move throw has its own window first (Storm Lord, and Steel Ace copying him)
    const moved = act(s, 's0', { k: 'roll' }).state;
    expect(moved.phase).toMatchObject({ k: 'react', kind: 'thunder', open: ['s2', 's3'], about: { k: 'move' } });
    const window = run(moved, ['s2', { k: 'pass', at: moved.since }], ['s3', { k: 'pass', at: moved.since }]).state;
    expect(window.phase).toMatchObject({
      k: 'react',
      kind: 'thunder',
      seat: 's0',
      open: ['s2', 's3'],
      about: { k: 'hero', face: 2, purpose: 'backup', space: 4 },
    });
    const { state, events } = act(window, 's3', { k: 'reroll', at: window.since });
    expect(ofType(events, 'power')).toEqual([{ t: 'power', seat: 's3', power: 'thunder', target: 's0' }]);
    expect(ofType(events, 'heroDie')).toEqual([{ t: 'heroDie', seat: 's0', face: 3, hero: 'steelAce', purpose: 'backup' }]);
    expect(ofType(events, 'owner')).toEqual([{ t: 'owner', space: 4, to: 's2', via: 'backup' }]);
    expect(state.phase.k).toBe('postRoll');
  });

  it('the picked hero out by the time it resolves: pick again among those who can (here one: no throw)', () => {
    const s = heroGame(['jadeTitan', 'starCaptain', 'steelAce', 'stormLord']);
    setCash(s, 's0', 50);
    setCash(s, 's3', 100);
    rig(s, [1, 3]);
    rigHero(s, FACE.starCaptain);
    let x = act(s, 's0', { k: 'roll' }).state;
    x = run(x, ['s2', { k: 'pass', at: x.since }], ['s3', { k: 'pass', at: x.since }]).state;
    expect(x.phase).toMatchObject({ k: 'react', about: { k: 'hero', purpose: 'backup', face: 2 } });
    // A re-roll that could not change the pick is refused (a hand-made state: the engine never rests in one)
    const poor = structuredClone(x);
    setCash(poor, 's1', 0);
    expect(refused(poor, 's3', { k: 'reroll', at: poor.since })).toBe('pointless');
    // Only one hero can pay once Star Captain leaves: a re-roll could not change anything, so the window closes at once
    // and that hero saves it (no throw)
    const { state, events } = act(x, 's1', { k: 'resign' });
    expect(ofType(events, 'heroDie')).toEqual([]);
    expect(ofType(events, 'owner')).toEqual([{ t: 'owner', space: 4, to: 's2', via: 'backup' }]);
    expect(state.phase.k).toBe('postRoll');
  });
});

describe('Hero League: power-ups and short payments', () => {
  it('pays the power-up automatically, doubled for the colour pair', () => {
    const s = heroGame();
    own(s, 's1', [4]);
    rig(s, [1, 3]);
    const one = act(s, 's0', { k: 'roll' });
    expect(ofType(one.events, 'cash')).toEqual([{ t: 'cash', from: 's0', to: 's1', amount: 70, why: 'rent', after: { s0: 1430, s1: 1570 }, space: 4 }]);
    const pair = heroGame();
    own(pair, 's1', [4, 6]);
    rig(pair, [1, 3]);
    expect(cash(act(pair, 's0', { k: 'roll' }).state, 's1')).toBe(1640);
  });

  it('no power-up while the owner is in the Holding Cell', () => {
    const s = heroGame();
    own(s, 's1', [4]);
    jail(s, 's1');
    rig(s, [1, 3]);
    const { state, events } = act(s, 's0', { k: 'roll' });
    expect(ofType(events, 'cash')).toEqual([]);
    expect(cash(state, 's0')).toBe(1500);
  });

  it('short of Power: pays what it has, the rest is forgiven (no debt, no bankruptcy)', () => {
    const s = heroGame();
    own(s, 's1', [4]);
    setCash(s, 's0', 30);
    rig(s, [1, 3]);
    const { state, events } = act(s, 's0', { k: 'roll' });
    expect(ofType(events, 'cash')).toEqual([{ t: 'cash', from: 's0', to: 's1', amount: 30, why: 'rent', after: { s0: 0, s1: 1530 }, space: 4 }]);
    expect(ofType(events, 'short')).toEqual([{ t: 'short', seat: 's0', why: 'rent', space: 4, owed: { s1: 70 }, paid: { s1: 30 } }]);
    expect(state.phase.k).toBe('postRoll');
    expect(state.players.s0?.out).toBeUndefined();
    // With nothing left, nothing moves but the short is still told
    const broke = heroGame();
    own(broke, 's1', [4]);
    setCash(broke, 's0', 0);
    rig(broke, [1, 3]);
    const b = act(broke, 's0', { k: 'roll' });
    expect(ofType(b.events, 'cash')).toEqual([]);
    expect(ofType(b.events, 'short')).toEqual([{ t: 'short', seat: 's0', why: 'rent', space: 4, owed: { s1: 70 }, paid: { s1: 0 } }]);
  });

  it('several creditors short: paid in seat order from the payer\'s left', () => {
    const s = heroGame(['jadeTitan', 'sharpshot', 'velvetViper', 'steelAce']);
    s.decks.chance = ['ch-ransom', ...s.decks.chance.filter((id) => id !== 'ch-ransom')];
    setCash(s, 's0', 40);
    setPos(s, 's0', 3);
    rig(s, [1, 1]);
    const { events } = act(s, 's0', { k: 'roll' });
    expect(ofType(events, 'cash').map((e) => [e.to, e.amount])).toEqual([
      ['s1', 25],
      ['s2', 15],
    ]);
    expect(ofType(events, 'short')).toEqual([
      { t: 'short', seat: 's0', why: 'card', owed: { s1: 25, s2: 25, s3: 25 }, paid: { s1: 25, s2: 15, s3: 0 } },
    ]);
  });
});

describe('Hero League: the Holding Cell', () => {
  /** s1's turn is over and s0 waits in the Holding Cell */
  function jailedNext(cashLeft = 1500) {
    const s = heroGame();
    jail(s, 's0');
    setCash(s, 's0', cashLeft);
    s.turn = { seat: 's1', no: 2, doubles: 0, again: false };
    s.phase = { k: 'postRoll' };
    return s;
  }

  it('Villain Ambush captures the hero and ends the turn, doubles and all', () => {
    const s = heroGame();
    setPos(s, 's0', 15);
    rig(s, [3, 3]);
    const { state, events } = act(s, 's0', { k: 'roll' });
    expect(pos(state, 's0')).toBe(7);
    expect(state.players.s0?.jail).toEqual({ tries: 0 });
    expect(ofType(events, 'jail')).toEqual([{ t: 'jail', seat: 's0', reason: 'space' }]);
    expect(state.phase.k).toBe('postRoll');
    expect(state.turn.again).toBe(false);
  });

  it('the fine is charged at the start of the next turn, then the hero rolls as usual', () => {
    const { state, events } = act(jailedNext(), 's1', { k: 'endTurn' });
    expect(events.map((e) => e.t)).toEqual(['turn', 'cash', 'jailExit']);
    expect(ofType(events, 'cash')[0]).toMatchObject({ from: 's0', to: 'bank', amount: 50, why: 'fine' });
    expect(ofType(events, 'jailExit')).toEqual([{ t: 'jailExit', seat: 's0', how: 'fine' }]);
    expect(state.players.s0?.jail).toBeUndefined();
    expect(state.phase.k).toBe('preRoll');
    expect(refused(state, 's0', { k: 'payFine' })).toBe('notJailed');
    expect(refused(state, 's0', { k: 'useCard' })).toBe('notJailed');
    rig(state, [2, 3]);
    const rolled = act(state, 's0', { k: 'roll' });
    expect(ofType(rolled.events, 'dice')[0]?.purpose).toBe('move');
    expect(pos(rolled.state, 's0')).toBe(12);
  });

  it('short of the fine: pays what it has and still leaves', () => {
    const some = act(jailedNext(20), 's1', { k: 'endTurn' });
    expect(ofType(some.events, 'short')).toEqual([{ t: 'short', seat: 's0', why: 'fine', owed: { bank: 50 }, paid: { bank: 20 } }]);
    expect(some.state.players.s0?.jail).toBeUndefined();
    const none = act(jailedNext(0), 's1', { k: 'endTurn' });
    expect(ofType(none.events, 'cash')).toEqual([]);
    expect(ofType(none.events, 'short')).toEqual([{ t: 'short', seat: 's0', why: 'fine', owed: { bank: 50 }, paid: { bank: 0 } }]);
    expect(none.state.players.s0?.jail).toBeUndefined();
  });

  it('three doubles capture the hero, on the final throw', () => {
    const s = heroGame();
    s.turn.doubles = 2;
    rig(s, [2, 2]);
    const { state, events } = act(s, 's0', { k: 'roll' });
    expect(ofType(events, 'jail')).toEqual([{ t: 'jail', seat: 's0', reason: 'doubles' }]);
    expect(state.phase.k).toBe('postRoll');
  });
});

describe('Hero League: the end', () => {
  /** Every location but `left` is s1's */
  function allBut(left: number) {
    const s = heroGame();
    own(s, 's1', LOCATIONS.filter((x) => x !== left));
    return s;
  }

  it('saving the last location ends the game at once (a roll still owed is dropped), ranked by score', () => {
    const s = allBut(4);
    rig(s, [2, 2]);
    const { state, events } = act(s, 's0', { k: 'roll' });
    expect(state.phase).toEqual({
      k: 'over',
      winner: 's1',
      ranking: ['s1', 's0'],
      why: 'allSaved',
      scores: { s0: 1380 + 100, s1: 1500 + 1500 },
    });
    expect(ofType(events, 'over')).toEqual([{ t: 'over', winner: 's1', ranking: ['s1', 's0'], why: 'allSaved' }]);
    expect(state.pending).toEqual([]);
    expect(score(state, 's1')).toBe(3000);
  });

  it('a back-up save of the last location ends it too', () => {
    const s = allBut(4);
    setCash(s, 's0', 10);
    rig(s, [1, 3]);
    const { state } = act(s, 's0', { k: 'roll' });
    expect(state.phase).toMatchObject({ k: 'over', why: 'allSaved' });
    expect(state.props.p4?.owner).toBe('s1');
  });

  it('Finish now, time up and the turn limit rank by score (ties: turn order)', () => {
    const s = heroGame(['jadeTitan', 'sharpshot', 'velvetViper']);
    own(s, 's0', [1, 2, 4]);
    own(s, 's1', [26]);
    setCash(s, 's0', 1000);
    setCash(s, 's1', 1200);
    setCash(s, 's2', 1250);
    for (const k of ['endGame', 'timeUp'] as const) {
      const over = act(s, 'system', { k }, 0).state;
      expect(over.phase).toEqual({ k: 'over', winner: 's0', ranking: ['s0', 's1', 's2'], why: k, scores: { s0: 1300, s1: 1300, s2: 1250 } });
    }
    const t = heroGame(['jadeTitan', 'sharpshot'], { turnLimit: 1 });
    rig(t, [1, 3]);
    const ended = run(t, ['s0', { k: 'roll' }], ['s0', { k: 'endTurn' }]).state;
    expect(ended.phase).toMatchObject({ k: 'over', why: 'turnLimit', winner: 's1', scores: { s0: 1480, s1: 1500 } });
  });

  it('a resignation hands the locations back and reopens the board', () => {
    const s = heroGame(['jadeTitan', 'sharpshot', 'velvetViper']);
    own(s, 's1', [4, 6]);
    const { state, events } = act(s, 's1', { k: 'resign' });
    expect(ofType(events, 'owner').map((e) => [e.space, e.via])).toEqual([
      [4, 'bankrupt'],
      [6, 'bankrupt'],
    ]);
    expect(state.props).toEqual({});
    expect(state.phase.k).toBe('preRoll');
  });
});

describe('Hero League: what the engine refuses', () => {
  it('no building, selling, mortgaging, lifting or selling to the bank; no trades or auctions', () => {
    const s = heroGame();
    own(s, 's0', [1, 2]);
    const manage: Action[] = [
      { k: 'build', group: 'brown', levels: [1, 0] },
      { k: 'sell', group: 'brown', levels: [0, 0] },
      { k: 'mortgage', space: 1 },
      { k: 'unmortgage', space: 1 },
      { k: 'sellProperty', space: 1 },
    ];
    for (const a of manage) {
      expect(refused(s, 's0', a), a.k).toBe('heroes');
    }
    expect(canMortgage(s, 's0', 1)?.code).toBe('heroes');
    expect(canUnmortgage(s, 's0', 1)?.code).toBe('heroes');
    expect(canSellProperty(s, 's0', 1)?.code).toBe('heroes');
    expect(buildOptions(s, 's0')).toEqual([]);
    expect(maxRaise(s, 's0')).toBe(1500);
    const kinds = legalActions(s, 's0').map((a) => a.k);
    expect(kinds.filter((k) => ['build', 'sell', 'mortgage', 'unmortgage', 'sellProperty'].includes(k))).toEqual([]);
    const offer: Action = { k: 'propose', to: 's1', give: { cash: 0, props: [1], cards: [] }, get: { cash: 50, props: [], cards: [] } };
    expect(refused(s, 's0', offer)).toBe('tradingOff');
    expect(DEFAULT_RULES.trading).toBe('on');
  });

  it('never opens a debt, a buy phase or an auction, nor makes anyone bankrupt: a whole game played by timeouts', () => {
    let x = heroGame(['stormLord', 'starCaptain', 'steelAce']);
    for (const seat of ['s0', 's1', 's2'] as const) setCash(x, seat, 100);
    for (let i = 0; i < 20_000 && x.phase.k !== 'over'; i++) {
      const cmd = timeoutCommand(x);
      if (!cmd) throw new Error(`no timeout in ${x.phase.k}`);
      const r = apply(x, cmd, { check: true });
      if (!r.ok) throw new Error(r.error.message);
      expect(['debt', 'buy', 'auction']).not.toContain(r.state.phase.k);
      expect(r.events.some((e) => e.t === 'bankrupt' || e.t === 'debt')).toBe(false);
      x = r.state;
    }
    expect(x.phase).toMatchObject({ k: 'over', why: 'allSaved' });
  });
});
