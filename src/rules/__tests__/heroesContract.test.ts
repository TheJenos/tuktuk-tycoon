import { describe, expect, it } from 'vitest';
import {
  apply,
  awaiting,
  boardMoney,
  checkInvariants,
  createGame,
  currencyOf,
  decode,
  DEFAULT_CURRENCY,
  defaultAction,
  encode,
  formatMoney,
  HEROES,
  heroesOf,
  heroOf,
  LANKA,
  powerReady,
  RULES_VERSION,
  toShown,
  toUnits,
  UPGRADABLE_VERSIONS,
} from '..';
import { ANIM, OFFLINE_TIMERS, ONLINE_TIMERS, animBudget, phaseSecs } from '../../shared/timing';
import type { Action, GameState } from '../types';
import { act, ofType, refused, rig, scenario, setPos, stack } from './helpers';
import { FACE, heroGame, rigHero, spend } from './heroesHelpers';

describe('Hero League windows: answers name the window', () => {
  it('every answer needs the window\'s `at` (state.since when it was entered)', () => {
    // react
    const t = heroGame(['jadeTitan', 'stormLord']);
    rig(t, [1, 3]);
    const w = act(t, 's0', { k: 'roll' }).state;
    for (const a of [
      { k: 'reroll', at: w.since - 1 },
      { k: 'pass', at: w.since + 1 },
      { k: 'pass' },
    ] as Action[]) {
      expect(refused(w, 's1', a), JSON.stringify(a)).toBe('stale');
    }
    // shield
    const sh = heroGame(['jadeTitan', 'starCaptain']);
    sh.turn.seat = 's1';
    setPos(sh, 's1', 2);
    stack(sh, 'chance', 'ch-drain');
    rig(sh, [1, 2]);
    const sw = act(sh, 's1', { k: 'roll' }).state;
    expect(refused(sw, 's1', { k: 'shield', at: 0 })).toBe('stale');
    // aim and pickCard
    const aim = heroGame(['sharpshot', 'jadeTitan']);
    setPos(aim, 's0', 3);
    rig(aim, [1, 1]);
    const a = act(aim, 's0', { k: 'roll' }).state;
    expect(refused(a, 's0', { k: 'aim', at: a.since - 1 })).toBe('stale');
    // boost
    const v = heroGame(['velvetViper', 'jadeTitan']);
    rig(v, [1, 2]);
    const b = act(v, 's0', { k: 'roll' }).state;
    expect(refused(b, 's0', { k: 'pass', at: b.since - 1 })).toBe('stale');
    expect(refused(b, 's0', { k: 'sting', n: 1, at: b.since - 1 })).toBe('stale');
  });

  it("a late answer for one throw never lands on the next throw's window", () => {
    const s = heroGame(['jadeTitan', 'stormLord']);
    setPos(s, 's0', 2);
    stack(s, 'chance', 'ch-swarm');
    rig(s, [1, 2]);
    let x = act(s, 's0', { k: 'roll' }).state;
    x = act(x, 's1', { k: 'pass', at: x.since }).state;
    const first = x;
    expect(first.phase).toMatchObject({ k: 'react', about: { k: 'hero', card: 'ch-swarm' } });
    const second = act(first, 's1', { k: 'pass', at: first.since }).state;
    expect(second.phase).toMatchObject({ k: 'react', about: { k: 'hero', card: 'ch-swarm' } });
    expect(second.since).not.toBe(first.since);
    expect(refused(second, 's1', { k: 'reroll', at: first.since })).toBe('stale');
    expect(refused(second, 's1', { k: 'pass', at: first.since })).toBe('stale');
  });

  it('a timeout plays the default: pass, or after the reveal the first card', () => {
    const v = heroGame(['velvetViper', 'jadeTitan']);
    rig(v, [1, 2]);
    const b = act(v, 's0', { k: 'roll' }).state;
    const forced = act(b, 'system', { k: 'forced', seat: 's0', a: { k: 'pass', at: b.since } }, b.seq);
    expect(ofType(forced.events, 'timeout')).toEqual([{ t: 'timeout', seat: 's0', a: { k: 'pass', at: b.since } }]);
    expect(refused(b, 'system', { k: 'forced', seat: 's0', a: { k: 'sting', n: 6, at: b.since } }, b.seq)).toBe('notDefault');

    const aim = heroGame(['sharpshot', 'jadeTitan']);
    setPos(aim, 's0', 3);
    stack(aim, 'chance', 'ch-mindtrap', 'ch-tribute');
    rig(aim, [1, 1]);
    const a = act(aim, 's0', { k: 'roll' }).state;
    const peeked = act(a, 's0', { k: 'aim', at: a.since }).state;
    const d = defaultAction(peeked, 's0');
    expect(d).toEqual({ k: 'pickCard', card: 'ch-mindtrap', at: peeked.since });
    const played = act(peeked, 'system', { k: 'forced', seat: 's0', a: d! }, peeked.seq).state;
    expect(played.players.s0?.cash).toBe(1450);
  });
});

describe('Hero League windows: someone leaves', () => {
  it('a reactor leaving is taken off the window; with nobody left the throw stands', () => {
    const s = heroGame(['jadeTitan', 'stormLord', 'sharpshot']);
    rig(s, [1, 3]);
    const w = act(s, 's0', { k: 'roll' }).state;
    const { state } = act(w, 's1', { k: 'resign' });
    expect(state.phase.k).toBe('postRoll');
    expect(state.players.s0?.pos).toBe(4);
  });

  it('the turn seat leaving in its own window, boost or aim: the turn passes on', () => {
    const t = heroGame(['jadeTitan', 'stormLord', 'sharpshot']);
    rig(t, [1, 3]);
    const w = act(t, 's0', { k: 'roll' }).state;
    expect(act(w, 's0', { k: 'resign' }).state.turn).toMatchObject({ seat: 's1', no: 2 });

    const v = heroGame(['velvetViper', 'jadeTitan', 'sharpshot']);
    rig(v, [1, 2]);
    const b = act(v, 's0', { k: 'roll' }).state;
    const left = act(b, 's0', { k: 'resign' }).state;
    expect(left.phase.k).toBe('preRoll');
    expect(left.turn.seat).toBe('s1');

    const aim = heroGame(['sharpshot', 'jadeTitan', 'velvetViper']);
    setPos(aim, 's0', 3);
    rig(aim, [1, 1]);
    const a = act(aim, 's0', { k: 'roll' }).state;
    expect(act(a, 's0', { k: 'resign' }).state.turn.seat).toBe('s1');
  });

  it('a non-turn thrower leaving drops its window and what it held back; the turn goes on', () => {
    // s0 lands on Villain Strike: "go back 3" hits s2 (Velvet Viper), back onto Villain Strike, who draws a Hero-die
    // card: s2 throws, Storm Lord (s1) may re-roll, and s2 leaves.
    const s = heroGame(['jadeTitan', 'stormLord', 'velvetViper', 'sharpshot']);
    spend(s, 's3');
    setPos(s, 's0', 9);
    setPos(s, 's2', 8);
    stack(s, 'chance', 'ch-freeze', 'ch-illusionist');
    rig(s, [1, 1]);
    rigHero(s, FACE.velvetViper, FACE.jadeTitan);
    let x = act(s, 's0', { k: 'roll' }).state;
    // the move throw's window, then the card's throw's window
    x = act(x, 's1', { k: 'pass', at: x.since }).state;
    x = act(x, 's1', { k: 'pass', at: x.since }).state;
    expect(x.phase).toMatchObject({ k: 'react', seat: 's2', about: { k: 'hero', card: 'ch-illusionist', face: 1 } });
    const { state, events } = act(x, 's2', { k: 'resign' });
    expect(ofType(events, 'cash').filter((e) => e.why === 'card')).toEqual([]);
    expect(state.phase.k).toBe('preRoll');
    expect(state.turn).toMatchObject({ seat: 's0', again: true });
  });

  it('a hero aiming out of turn leaving drops the aim; the turn goes on', () => {
    const s = heroGame(['jadeTitan', 'sharpshot', 'velvetViper']);
    setPos(s, 's0', 6);
    setPos(s, 's1', 8);
    stack(s, 'chance', 'ch-freeze');
    rig(s, [2, 3]);
    rigHero(s, FACE.sharpshot);
    const a = act(s, 's0', { k: 'roll' }).state;
    expect(a.phase).toMatchObject({ k: 'aim', seat: 's1' });
    const { state } = act(a, 's1', { k: 'resign' });
    expect(state.phase.k).toBe('postRoll');
    expect(state.turn.seat).toBe('s0');
  });
});

describe('Hero League: invariants', () => {
  const broken = (s: GameState): string => checkInvariants(s).join('; ');

  it('a hero exactly on a heroes board, each played once, powerUsed only with one', () => {
    const s = heroGame(['jadeTitan', 'sharpshot']);
    expect(checkInvariants(s)).toEqual([]);
    const missing = heroGame();
    delete missing.players.s1!.hero;
    expect(broken(missing)).toMatch(/s1 hero/);
    const twice = heroGame();
    twice.players.s1!.hero = 'jadeTitan';
    expect(broken(twice)).toMatch(/same hero/);
    const classic = scenario();
    classic.players.s0!.hero = 'jadeTitan';
    expect(broken(classic)).toMatch(/s0 hero/);
    const used = scenario();
    used.players.s0!.powerUsed = 1;
    expect(broken(used)).toMatch(/powerUsed/);
  });

  it('no debt, windows only over busy and only with someone to answer, a rigged Hero die only with debug', () => {
    const debt = heroGame();
    debt.phase = { k: 'debt', debtor: 's0', owed: { bank: 5000 }, why: 'card', resume: { k: 'postRoll' } };
    expect(broken(debt)).toMatch(/debt on a heroes board/);
    const empty = heroGame();
    empty.phase = { k: 'react', kind: 'thunder', seat: 's0', open: [], about: { k: 'move' }, then: { k: 'throwDone', seat: 's0' }, resume: { k: 'busy' } };
    expect(broken(empty)).toMatch(/nobody to answer/);
    const classic = scenario();
    classic.phase = { k: 'boost', seat: 's0', total: 3, then: { k: 'afterRoll' }, resume: { k: 'busy' } };
    expect(broken(classic)).toMatch(/boost off a heroes board/);
    const rigged = heroGame();
    rigged.cfg.debug = false;
    rigged.rigHero = [3];
    expect(broken(rigged)).toMatch(/Hero die without debug/);
  });
});

describe('Hero League: the RNG and the rigged Hero die', () => {
  it('only throws consume it: the actions of the superpowers do not', () => {
    const v = heroGame(['velvetViper', 'jadeTitan']);
    rig(v, [1, 2]);
    const b = act(v, 's0', { k: 'roll' }).state;
    expect(act(b, 's0', { k: 'sting', n: 3, at: b.since }).state.rng).toBe(b.rng);
    const t = heroGame(['jadeTitan', 'sharpshot', 'velvetViper']);
    setPos(t, 's1', 4);
    expect(act(t, 's0', { k: 'smash', a: 's1', b: 's2' }).state.rng).toBe(t.rng);
  });

  it('a pass that lets the next Hero-die throw happen consumes it, with a heroDie event', () => {
    const s = heroGame(['jadeTitan', 'stormLord']);
    setPos(s, 's0', 2);
    stack(s, 'chance', 'ch-swarm');
    rig(s, [1, 2]);
    let x = act(s, 's0', { k: 'roll' }).state;
    x = act(x, 's1', { k: 'pass', at: x.since }).state;
    const r = act(x, 's1', { k: 'pass', at: x.since });
    expect(r.state.rng).not.toBe(x.rng);
    expect(ofType(r.events, 'heroDie')).toHaveLength(1);
  });

  it('debugRig queues Hero-die faces (both queues count to the cap); refused off a heroes board or malformed', () => {
    const s = heroGame();
    const q = act(s, 's1', { k: 'debugRig', dice: [[1, 2]], hero: [3, 4] }).state;
    expect(q.rigHero).toEqual([3, 4]);
    expect(q.rig).toEqual([[1, 2]]);
    expect(act(s, 's1', { k: 'debugRig', dice: [], hero: [] }).state.rigHero).toBeUndefined();
    expect(refused(s, 's1', { k: 'debugRig', dice: [], hero: [7] })).toBe('badRig');
    expect(refused(s, 's1', { k: 'debugRig', dice: [], hero: [1.5] })).toBe('badRig');
    expect(refused(s, 's1', { k: 'debugRig', dice: [], hero: Array.from({ length: 101 }, () => 1) })).toBe('badRig');
    const full = act(s, 's1', { k: 'debugRig', dice: [], hero: Array.from({ length: 60 }, () => 1) }).state;
    expect(refused(full, 's1', { k: 'debugRig', dice: Array.from({ length: 41 }, () => [1, 1] as [number, number]) })).toBe('badRig');
    expect(refused(scenario(), 's1', { k: 'debugRig', dice: [], hero: [1] })).toBe('badRig');
  });
});

describe('Hero League: state, versions and selectors', () => {
  it('round-trips through the codec, windows and rigs included', () => {
    const s = heroGame(['jadeTitan', 'stormLord']);
    rig(s, [1, 3]);
    rigHero(s, 2);
    const w = act(s, 's0', { k: 'roll' }).state;
    expect(w.phase.k).toBe('react');
    expect(decode(encode(w))).toEqual(w);
  });

  it('is version 10; version 7 to 9 states still decode', () => {
    expect(RULES_VERSION).toBe(10);
    expect(UPGRADABLE_VERSIONS).toEqual(expect.arrayContaining([7, 8, 9]));
    for (const v of [7, 8, 9]) expect(decode(encode({ ...scenario(), v })).v).toBe(10);
  });

  it('heroesOf, heroOf, powerReady', () => {
    expect(heroesOf(HEROES).map((h) => h.id)).toEqual(['jadeTitan', 'starCaptain', 'steelAce', 'stormLord', 'velvetViper', 'sharpshot']);
    expect(heroesOf(LANKA)).toEqual([]);
    const s = heroGame(['stormLord', 'jadeTitan']);
    expect(heroOf(s, 's0')?.powerName).toBe('Thunder Call');
    expect(heroOf(scenario(), 's0')).toBeUndefined();
    expect(powerReady(s, 's0')).toBe(true);
    spend(s, 's0');
    expect(powerReady(s, 's0')).toBe(false);
    expect(powerReady(scenario(), 's0')).toBe(false);
  });

  it('awaits the open reactors only, never someone out', () => {
    const s = heroGame(['jadeTitan', 'stormLord', 'steelAce', 'sharpshot']);
    rig(s, [1, 3]);
    const w = act(s, 's0', { k: 'roll' }).state;
    expect(awaiting(w)).toEqual(['s1', 's2']);
    const passed = act(w, 's2', { k: 'pass', at: w.since }).state;
    expect(awaiting(passed)).toEqual(['s1']);
  });
});

describe('money on Hero League', () => {
  const POWER = currencyOf(HEROES);

  it('reads "<n> Power"', () => {
    expect(POWER).toEqual({ symbol: 'Power', scale: 1, after: true });
    expect(formatMoney(1500, {}, POWER)).toBe('1,500 Power');
    expect(formatMoney(200, { signed: true }, POWER)).toBe('+200 Power');
    expect(formatMoney(-50, {}, POWER)).toBe('−50 Power');
    expect(formatMoney(0, { signed: true }, POWER)).toBe('0 Power');
    expect(toUnits(1500, POWER)).toBe(1500);
    expect(toShown(60, POWER)).toBe(60);
    // The classic default is unchanged
    expect(DEFAULT_CURRENCY).toEqual(LANKA.display.currency);
    expect(formatMoney(1500)).toBe('Rs. 150,000');
    expect(toShown(60)).toBe(6000);
  });

  it('boardMoney reads a board (or its id) in its currency; bare drops the symbol', () => {
    expect(boardMoney(HEROES, 1500)).toBe('1,500 Power');
    expect(boardMoney('heroes', 200, { signed: true })).toBe('+200 Power');
    expect(boardMoney('heroes', 1500, { bare: true })).toBe('1,500');
    expect(boardMoney('heroes', -50, { bare: true })).toBe('−50');
    expect(boardMoney('lanka', 60)).toBe('Rs. 6,000');
    expect(boardMoney(LANKA, 60, { bare: true })).toBe('6,000');
    // An unknown id reads like the default board
    expect(boardMoney('nowhere', 60)).toBe('Rs. 6,000');
  });

  it('engine messages print the board\'s currency', () => {
    const { state } = createGame({}, [
      { id: 's0', name: 'A' },
      { id: 's1', name: 'B' },
    ], 1);
    state.players.s0!.pos = 10;
    state.players.s0!.jail = { tries: 0 };
    state.players.s0!.cash = 10;
    state.turn.seat = 's0';
    const r = apply(state, { by: 's0', a: { k: 'payFine' } });
    expect(r.ok ? '' : r.error.message).toBe('The fine is Rs. 5,000');
  });
});

describe('timing for Hero League', () => {
  it('reaction windows always have a countdown', () => {
    expect(phaseSecs('reaction', ONLINE_TIMERS)).toBe(8);
    expect(phaseSecs('reaction', OFFLINE_TIMERS)).toBe(6);
    expect(phaseSecs('reaction', { turn: 0, decision: 0, auction: 8, debt: 0 })).toBe(6);
    expect(phaseSecs('reaction', { turn: 0, decision: 0, auction: 8, debt: 0, reaction: 1 })).toBe(3);
  });

  it('counts the Hero die, a swap and a superpower label in the animation budget', () => {
    expect(animBudget([{ t: 'heroDie', seat: 's0', face: 1, hero: 'jadeTitan', purpose: 'card', card: 'ch-swarm' }])).toBe(ANIM.dice);
    expect(animBudget([{ t: 'move', seat: 's0', from: 3, to: 25, path: [25], via: 'swap' }])).toBe(ANIM.jump);
    expect(animBudget([{ t: 'power', seat: 's0', power: 'smash' }])).toBe(400);
  });
});

describe('a played-out Hero League game replays exactly', () => {
  it('the same commands give the same state', () => {
    const seats = (['s0', 's1', 's2', 's3'] as const).map((id, i) => ({ id, name: `P${i}` }));
    const start = createGame({ board: 'heroes' }, seats, 12).state;
    let s = start;
    const log = [];
    for (let i = 0; i < 400 && s.phase.k !== 'over'; i++) {
      const seat = awaiting(s)[0]!;
      const a = defaultAction(s, seat)!;
      const cmd = { by: seat, a };
      const r = apply(s, cmd);
      if (!r.ok) throw new Error(r.error.message);
      log.push(cmd);
      s = r.state;
    }
    let replay = start;
    for (const cmd of log) {
      const r = apply(replay, cmd);
      if (!r.ok) throw new Error(r.error.message);
      replay = r.state;
    }
    expect(encode(replay)).toBe(encode(s));
  });
});
