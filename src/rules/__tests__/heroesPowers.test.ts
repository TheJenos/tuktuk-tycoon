import { describe, expect, it } from 'vitest';
import { awaiting, defaultAction, legalActions, smashPairs, timeoutCommand, timer, usablePowers } from '..';
import type { GameState, SeatId } from '../types';
import { act, cash, ofType, own, pos, refused, rig, scenario, setCash, setPos, stack } from './helpers';
import { FACE, heroGame, jail, rigHero, spend } from './heroesHelpers';

/** Makes `seat` the turn seat, in preRoll */
function turnOf(s: GameState, seat: SeatId): GameState {
  s.turn = { seat, no: 1, doubles: 0, again: false };
  return s;
}

describe('Thunder Call (Storm Lord)', () => {
  it('opens a reaction window after a move throw; passing lets the throw stand', () => {
    const s = heroGame(['jadeTitan', 'stormLord']);
    rig(s, [1, 3]);
    const w = act(s, 's0', { k: 'roll' }).state;
    expect(w.phase).toEqual({
      k: 'react',
      kind: 'thunder',
      seat: 's0',
      open: ['s1'],
      about: { k: 'move' },
      then: { k: 'throwDone', seat: 's0' },
      resume: { k: 'busy' },
    });
    expect(pos(w, 's0')).toBe(0);
    expect(w.turn.roll).toEqual({ w: [1, 3] });
    expect(awaiting(w)).toEqual(['s1']);
    expect(timer(w)).toEqual({ key: `react:${w.since}`, kind: 'reaction' });
    expect(defaultAction(w, 's1')).toEqual({ k: 'pass', at: w.since });
    expect(timeoutCommand(w)).toEqual({ by: 'system', a: { k: 'closeReact' }, basis: w.seq });
    expect(legalActions(w, 's1').map((a) => a.k)).toEqual(['reroll', 'pass', 'resign']);
    const { state } = act(w, 's1', { k: 'pass', at: w.since });
    expect(pos(state, 's0')).toBe(4);
    expect(state.phase.k).toBe('postRoll');
    expect(state.players.s1?.powerUsed).toBeUndefined();
  });

  it('a re-roll spends the power, throws again (a new dice event) and the move uses the final throw', () => {
    const s = heroGame(['jadeTitan', 'stormLord']);
    rig(s, [1, 3], [2, 4]);
    const w = act(s, 's0', { k: 'roll' }).state;
    const { state, events } = act(w, 's1', { k: 'reroll', at: w.since });
    expect(ofType(events, 'power')).toEqual([{ t: 'power', seat: 's1', power: 'thunder', target: 's0' }]);
    expect(ofType(events, 'dice')).toEqual([{ t: 'dice', seat: 's0', purpose: 'move', w: [2, 4], doubles: false, triples: false, total: 6 }]);
    expect(pos(state, 's0')).toBe(6);
    expect(state.players.s1?.powerUsed).toBe(1);
    expect(state.phase.k).toBe('postRoll');
  });

  it('doubles and the third-doubles capture are judged on the final throw', () => {
    const saved = heroGame(['jadeTitan', 'stormLord']);
    saved.turn.doubles = 2;
    rig(saved, [2, 2], [1, 3]);
    const w = act(saved, 's0', { k: 'roll' }).state;
    const freed = act(w, 's1', { k: 'reroll', at: w.since }).state;
    expect(freed.players.s0?.jail).toBeUndefined();
    expect(pos(freed, 's0')).toBe(4);
    expect(freed.phase.k).toBe('postRoll');

    const caught = heroGame(['jadeTitan', 'stormLord']);
    caught.turn.doubles = 2;
    rig(caught, [1, 3], [2, 2]);
    const w2 = act(caught, 's0', { k: 'roll' }).state;
    const jailed = act(w2, 's1', { k: 'reroll', at: w2.since });
    expect(ofType(jailed.events, 'jail')).toEqual([{ t: 'jail', seat: 's0', reason: 'doubles' }]);

    const again = heroGame(['jadeTitan', 'stormLord']);
    rig(again, [1, 3], [3, 3]);
    const w3 = act(again, 's0', { k: 'roll' }).state;
    const doubles = act(w3, 's1', { k: 'reroll', at: w3.since }).state;
    expect(doubles.turn).toMatchObject({ doubles: 1, again: true });
    expect(doubles.phase.k).toBe('preRoll');
  });

  it('after a re-roll every seat that can re-roll may (earlier passes forgotten), on a fresh countdown', () => {
    const s = heroGame(['jadeTitan', 'stormLord', 'steelAce']);
    rig(s, [1, 3], [2, 4], [4, 5]);
    const w = act(s, 's0', { k: 'roll' }).state;
    expect(w.phase).toMatchObject({ k: 'react', open: ['s1', 's2'] });
    const passed = act(w, 's1', { k: 'pass', at: w.since }).state;
    expect(passed.phase).toMatchObject({ open: ['s2'] });
    expect(passed.since).toBe(w.since);
    // Steel Ace copies Thunder Call: only Steel Ace's power is spent, and Storm Lord may answer the new throw
    const copied = act(passed, 's2', { k: 'reroll', at: passed.since });
    expect(ofType(copied.events, 'power')).toEqual([{ t: 'power', seat: 's2', power: 'thunder', copied: true, target: 's0' }]);
    expect(copied.state.phase).toMatchObject({ k: 'react', open: ['s1'] });
    expect(copied.state.since).toBe(copied.state.seq);
    expect(copied.state.players.s1?.powerUsed).toBeUndefined();
    expect(refused(copied.state, 's1', { k: 'pass', at: w.since })).toBe('stale');
    const last = act(copied.state, 's1', { k: 'reroll', at: copied.state.since });
    expect(pos(last.state, 's0')).toBe(9);
    expect(last.state.phase.k).not.toBe('react');
  });

  it('the thrower may re-roll its own throw; nobody able, no window', () => {
    const own = heroGame(['stormLord', 'jadeTitan']);
    rig(own, [1, 3]);
    const w = act(own, 's0', { k: 'roll' }).state;
    expect(w.phase).toMatchObject({ k: 'react', seat: 's0', open: ['s0'] });

    const used = heroGame(['jadeTitan', 'stormLord', 'steelAce']);
    spend(used, 's1');
    rig(used, [1, 3]);
    expect(act(used, 's0', { k: 'roll' }).state.phase.k).toBe('postRoll');

    // Steel Ace alone has nobody to copy
    const alone = heroGame(['jadeTitan', 'steelAce']);
    rig(alone, [1, 3]);
    expect(act(alone, 's0', { k: 'roll' }).state.phase.k).toBe('postRoll');
  });

  it('works on a card\'s Hero-die throw too', () => {
    const s = heroGame(['jadeTitan', 'stormLord']);
    stack(s, 'chance', 'ch-illusionist');
    rig(s, [2, 3]);
    rigHero(s, FACE.jadeTitan, FACE.starCaptain);
    let x = act(s, 's0', { k: 'roll' }).state;
    x = act(x, 's1', { k: 'pass', at: x.since }).state;
    expect(x.phase).toMatchObject({
      k: 'react',
      kind: 'thunder',
      seat: 's0',
      open: ['s1'],
      about: { k: 'hero', face: 1, purpose: 'card', card: 'ch-illusionist' },
    });
    const { state, events } = act(x, 's1', { k: 'reroll', at: x.since });
    expect(ofType(events, 'heroDie')).toEqual([{ t: 'heroDie', seat: 's0', face: 2, hero: 'starCaptain', purpose: 'card', card: 'ch-illusionist' }]);
    // Nobody plays Star Captain: the card does nothing
    expect(cash(state, 's0')).toBe(1500);
    expect(state.phase.k).toBe('postRoll');
  });

  it('a window that runs out: everyone still open passes (reactTimeout)', () => {
    const s = heroGame(['jadeTitan', 'stormLord', 'steelAce']);
    rig(s, [1, 3]);
    const w = act(s, 's0', { k: 'roll' }).state;
    const { state, events } = act(w, 'system', { k: 'closeReact' }, w.seq);
    expect(ofType(events, 'reactTimeout')).toEqual([{ t: 'reactTimeout', seats: ['s1', 's2'] }]);
    expect(pos(state, 's0')).toBe(4);
    expect(refused(w, 's1', { k: 'closeReact' })).toBe('badActor');
    expect(refused(scenario(), 'system', { k: 'closeReact' }, 0)).toBe('phase');
  });

  it('a re-roll used this turn is not brought back by a Rally Point salary the same turn; a later one is', () => {
    const s = heroGame(['stormLord', 'jadeTitan']);
    setPos(s, 's0', 25);
    rig(s, [1, 2], [2, 3]);
    const w = act(s, 's0', { k: 'roll' }).state;
    const passed = act(w, 's0', { k: 'reroll', at: w.since });
    expect(ofType(passed.events, 'salary')).toHaveLength(1);
    expect(ofType(passed.events, 'powerReady')).toEqual([]);
    expect(passed.state.players.s0?.powerUsed).toBe(1);

    const later = heroGame(['stormLord', 'jadeTitan']);
    later.players.s0!.powerUsed = 1;
    later.turn.no = 3;
    setPos(later, 's0', 26);
    rig(later, [1, 2]);
    const r = act(later, 's0', { k: 'roll' });
    expect(ofType(r.events, 'powerReady')).toEqual([{ t: 'powerReady', seat: 's0' }]);
    expect(r.events.findIndex((e) => e.t === 'powerReady')).toBeGreaterThan(r.events.findIndex((e) => e.t === 'salary'));
    expect(r.state.players.s0?.powerUsed).toBeUndefined();
  });
});

describe('Star Shield (Star Captain)', () => {
  it("says no to a Villain Strike card aimed at its drawer", () => {
    const s = turnOf(heroGame(['jadeTitan', 'starCaptain']), 's1');
    setPos(s, 's1', 2);
    stack(s, 'chance', 'ch-drain');
    rig(s, [1, 2]);
    const w = act(s, 's1', { k: 'roll' }).state;
    expect(w.phase).toEqual({
      k: 'react',
      kind: 'shield',
      seat: 's1',
      open: ['s1'],
      about: { k: 'hit', fx: { k: 'cash', amount: -100 }, card: 'ch-drain' },
      then: { k: 'hit', seat: 's1', fx: { k: 'cash', amount: -100 }, card: 'ch-drain', asked: true },
      resume: { k: 'busy' },
    });
    expect(timer(w)?.kind).toBe('reaction');
    const shielded = act(w, 's1', { k: 'shield', at: w.since });
    expect(ofType(shielded.events, 'power')).toEqual([{ t: 'power', seat: 's1', power: 'shield' }]);
    expect(cash(shielded.state, 's1')).toBe(1500);
    expect(shielded.state.phase.k).toBe('postRoll');
    const taken = act(w, 's1', { k: 'pass', at: w.since });
    expect(cash(taken.state, 's1')).toBe(1400);
    expect(taken.state.players.s1?.powerUsed).toBeUndefined();
  });

  it('says no to a Hero-die hit (the hit names whose card it was)', () => {
    const s = heroGame(['jadeTitan', 'starCaptain']);
    setPos(s, 's0', 2);
    stack(s, 'chance', 'ch-illusionist');
    rig(s, [1, 2]);
    rigHero(s, FACE.starCaptain);
    const w = act(s, 's0', { k: 'roll' }).state;
    expect(w.phase).toMatchObject({
      k: 'react',
      kind: 'shield',
      seat: 's1',
      about: { k: 'hit', fx: { k: 'cash', amount: -100 }, card: 'ch-illusionist', by: 's0' },
    });
    expect(cash(act(w, 's1', { k: 'shield', at: w.since }).state, 's1')).toBe(1500);
    expect(refused(w, 's0', { k: 'shield', at: w.since })).toBe('notOpen');
  });

  it('Steel Ace can say no by copying it, while Star Captain is ready', () => {
    const s = heroGame(['jadeTitan', 'starCaptain', 'steelAce']);
    setPos(s, 's0', 2);
    stack(s, 'chance', 'ch-illusionist');
    rig(s, [1, 2]);
    rigHero(s, FACE.steelAce);
    const w = act(s, 's0', { k: 'roll' }).state;
    expect(w.phase).toMatchObject({ k: 'react', kind: 'shield', seat: 's2' });
    const { state, events } = act(w, 's2', { k: 'shield', at: w.since });
    expect(ofType(events, 'power')).toEqual([{ t: 'power', seat: 's2', power: 'shield', copied: true }]);
    expect(cash(state, 's2')).toBe(1500);
    expect(state.players.s1?.powerUsed).toBeUndefined();

    const used = heroGame(['jadeTitan', 'starCaptain', 'steelAce']);
    spend(used, 's1');
    setPos(used, 's0', 2);
    stack(used, 'chance', 'ch-illusionist');
    rig(used, [1, 2]);
    rigHero(used, FACE.steelAce);
    expect(cash(act(used, 's0', { k: 'roll' }).state, 's2')).toBe(1400);
  });

  it('no window for an effect that would do nothing', () => {
    // Losing Power with none left
    const broke = heroGame(['jadeTitan', 'starCaptain']);
    setCash(broke, 's1', 0);
    setPos(broke, 's0', 2);
    stack(broke, 'chance', 'ch-illusionist');
    rig(broke, [1, 2]);
    rigHero(broke, FACE.starCaptain);
    const b = act(broke, 's0', { k: 'roll' });
    expect(b.state.phase.k).toBe('postRoll');
    expect(ofType(b.events, 'short')).toEqual([{ t: 'short', seat: 's1', why: 'card', owed: { bank: 100 }, paid: { bank: 0 } }]);
    // Losing a location with none owned
    const none = heroGame(['jadeTitan', 'starCaptain']);
    setPos(none, 's0', 2);
    stack(none, 'chance', 'ch-agents');
    rig(none, [1, 2]);
    rigHero(none, FACE.starCaptain);
    expect(act(none, 's0', { k: 'roll' }).state.phase.k).toBe('postRoll');
    // Captured or moved while already in the Holding Cell: nothing at all
    const cell = heroGame(['jadeTitan', 'starCaptain']);
    jail(cell, 's1');
    setPos(cell, 's0', 2);
    stack(cell, 'chance', 'ch-freeze');
    rig(cell, [1, 2]);
    rigHero(cell, FACE.starCaptain);
    const c = act(cell, 's0', { k: 'roll' });
    expect(c.state.phase.k).toBe('postRoll');
    expect(pos(c.state, 's1')).toBe(7);
    expect(c.state.players.s1?.jail).toEqual({ tries: 0 });
    expect(ofType(c.events, 'move').filter((e) => e.seat === 's1')).toEqual([]);
  });

  it('covers every Villain Strike effect on its drawer, advances included', () => {
    const s = turnOf(heroGame(['jadeTitan', 'starCaptain']), 's1');
    setPos(s, 's1', 2);
    stack(s, 'chance', 'ch-alarm');
    rig(s, [1, 2]);
    const w = act(s, 's1', { k: 'roll' }).state;
    expect(w.phase).toMatchObject({ k: 'react', kind: 'shield', about: { fx: { k: 'advance', to: 27 } } });
    expect(pos(act(w, 's1', { k: 'shield', at: w.since }).state, 's1')).toBe(5);
    expect(pos(act(w, 's1', { k: 'pass', at: w.since }).state, 's1')).toBe(27);
  });

  it('does not cover Hero HQ cards, power-ups, Villain Ambush or back-up saves', () => {
    // Hero HQ: Star Captain chips in for the gear without a window
    const gear = heroGame(['jadeTitan', 'starCaptain']);
    setPos(gear, 's0', 1);
    stack(gear, 'chest', 'cc-gear');
    rig(gear, [1, 1]);
    const g = act(gear, 's0', { k: 'roll' });
    expect(g.state.phase.k).toBe('preRoll');
    expect(cash(g.state, 's1')).toBe(1480);
    // A power-up
    const rent = turnOf(heroGame(['jadeTitan', 'starCaptain']), 's1');
    own(rent, 's0', [4]);
    rig(rent, [1, 3]);
    expect(act(rent, 's1', { k: 'roll' }).state.phase.k).toBe('postRoll');
    // Villain Ambush
    const ambush = turnOf(heroGame(['jadeTitan', 'starCaptain']), 's1');
    setPos(ambush, 's1', 17);
    rig(ambush, [1, 3]);
    const a = act(ambush, 's1', { k: 'roll' }).state;
    expect(a.phase.k).toBe('postRoll');
    expect(a.players.s1?.jail).toBeDefined();
  });

  it('a hero rolled twice by one card is hit (and asked) once', () => {
    const s = heroGame(['jadeTitan', 'starCaptain']);
    setPos(s, 's0', 2);
    stack(s, 'chance', 'ch-swarm');
    rig(s, [1, 2]);
    rigHero(s, FACE.starCaptain, FACE.starCaptain);
    const w = act(s, 's0', { k: 'roll' });
    expect(ofType(w.events, 'heroDie').map((e) => e.face)).toEqual([2, 2]);
    expect(w.state.phase).toMatchObject({ k: 'react', kind: 'shield', seat: 's1' });
    const done = act(w.state, 's1', { k: 'pass', at: w.state.since });
    expect(cash(done.state, 's1')).toBe(1450);
    expect(done.state.phase.k).toBe('postRoll');
  });
});

describe('Viper Strike (Velvet Viper)', () => {
  it('after the move throw: sting {n} moves the dice total + n in one walk with one landing', () => {
    const s = heroGame(['velvetViper', 'jadeTitan']);
    rig(s, [1, 2]);
    const b = act(s, 's0', { k: 'roll' }).state;
    expect(b.phase).toEqual({
      k: 'boost',
      seat: 's0',
      total: 3,
      then: { k: 'move', seat: 's0', to: 3, via: 'dice' },
      resume: { k: 'busy' },
    });
    expect(awaiting(b)).toEqual(['s0']);
    expect(timer(b)?.kind).toBe('decision');
    expect(defaultAction(b, 's0')).toEqual({ k: 'pass', at: b.since });
    expect(timeoutCommand(b)?.a).toEqual({ k: 'forced', seat: 's0', a: { k: 'pass', at: b.since } });
    expect(legalActions(b, 's0').filter((a) => a.k === 'sting')).toHaveLength(6);
    const { state, events } = act(b, 's0', { k: 'sting', n: 3, at: b.since });
    expect(ofType(events, 'power')).toEqual([{ t: 'power', seat: 's0', power: 'sting' }]);
    expect(ofType(events, 'move')).toEqual([{ t: 'move', seat: 's0', from: 0, to: 6, path: [1, 2, 3, 4, 5, 6], via: 'dice' }]);
    expect(ofType(events, 'land')).toEqual([{ t: 'land', seat: 's0', space: 6 }]);
    expect(state.props.p6?.owner).toBe('s0');
    expect(state.phase.k).toBe('postRoll');
  });

  it('pass moves the dice total and keeps the power', () => {
    const s = heroGame(['velvetViper', 'jadeTitan']);
    stack(s, 'chest', 'cc-stash');
    rig(s, [1, 2]);
    const b = act(s, 's0', { k: 'roll' }).state;
    const { state } = act(b, 's0', { k: 'pass', at: b.since });
    expect(pos(state, 's0')).toBe(3);
    expect(cash(state, 's0')).toBe(1525);
    expect(state.players.s0?.powerUsed).toBeUndefined();
  });

  it('doubles are still judged on the dice; refuses bad lengths, stale answers and other seats', () => {
    const s = heroGame(['velvetViper', 'jadeTitan']);
    rig(s, [2, 2]);
    const b = act(s, 's0', { k: 'roll' }).state;
    for (const n of [0, 7, 1.5]) expect(refused(b, 's0', { k: 'sting', n, at: b.since })).toBe('badMove');
    expect(refused(b, 's0', { k: 'sting', n: 2, at: b.since - 1 })).toBe('stale');
    expect(refused(b, 's1', { k: 'sting', n: 2, at: b.since })).toBe('notOpen');
    expect(refused(b, 's1', { k: 'pass', at: b.since })).toBe('notOpen');
    const { state } = act(b, 's0', { k: 'sting', n: 2, at: b.since });
    expect(pos(state, 's0')).toBe(6);
    expect(state.turn.again).toBe(true);
    expect(state.phase.k).toBe('preRoll');
  });

  it('not on the way to the Holding Cell, and only after the Thunder window', () => {
    const jailed = heroGame(['velvetViper', 'jadeTitan']);
    jailed.turn.doubles = 2;
    rig(jailed, [2, 2]);
    expect(act(jailed, 's0', { k: 'roll' }).state.phase.k).toBe('postRoll');

    const s = heroGame(['velvetViper', 'stormLord']);
    rig(s, [1, 2]);
    const w = act(s, 's0', { k: 'roll' }).state;
    expect(w.phase.k).toBe('react');
    expect(act(w, 's1', { k: 'pass', at: w.since }).state.phase.k).toBe('boost');
  });

  it('a sting round Rally Point pays the salary but does not bring the power straight back', () => {
    const s = heroGame(['velvetViper', 'jadeTitan']);
    setPos(s, 's0', 24);
    rig(s, [1, 2]);
    const b = act(s, 's0', { k: 'roll' }).state;
    const { state, events } = act(b, 's0', { k: 'sting', n: 3, at: b.since });
    expect(pos(state, 's0')).toBe(2);
    expect(ofType(events, 'salary')).toHaveLength(1);
    expect(ofType(events, 'powerReady')).toEqual([]);
    expect(state.players.s0?.powerUsed).toBe(1);
  });

  it('Steel Ace can sting by copying it', () => {
    const s = heroGame(['steelAce', 'velvetViper']);
    rig(s, [1, 2]);
    const b = act(s, 's0', { k: 'roll' }).state;
    expect(b.phase.k).toBe('boost');
    expect(usablePowers(b, 's0')).toEqual([{ power: 'sting', copied: true, hero: 'velvetViper' }]);
    const { events } = act(b, 's0', { k: 'sting', n: 1, at: b.since });
    expect(ofType(events, 'power')).toEqual([{ t: 'power', seat: 's0', power: 'sting', copied: true }]);
  });
});

describe('Titan Smash (Jade Titan)', () => {
  function spread(heroes: Parameters<typeof heroGame>[0]) {
    const s = heroGame(heroes);
    s.order.forEach((seat, i) => setPos(s, seat, i * 5));
    return s;
  }

  it('swaps two heroes before the first roll: jumps, no salary, no landing, back to preRoll', () => {
    const s = spread(['jadeTitan', 'sharpshot', 'velvetViper']);
    setPos(s, 's1', 25);
    setPos(s, 's2', 3);
    const { state, events } = act(s, 's0', { k: 'smash', a: 's1', b: 's2' });
    expect(events).toEqual([
      { t: 'power', seat: 's0', power: 'smash' },
      { t: 'move', seat: 's1', from: 25, to: 3, path: [3], via: 'swap' },
      { t: 'move', seat: 's2', from: 3, to: 25, path: [25], via: 'swap' },
    ]);
    expect(state.phase.k).toBe('preRoll');
    expect(state.pending).toEqual([]);
    expect(state.turn.roll).toBeUndefined();
    rig(state, [1, 3]);
    expect(pos(act(state, 's0', { k: 'roll' }).state, 's0')).toBe(4);
    // The smasher may be one of the two
    expect(pos(act(s, 's0', { k: 'smash', a: 's0', b: 's1' }).state, 's0')).toBe(25);
  });

  it('only at the start of its own turn, with the power ready, on two heroes it can swap', () => {
    const s = spread(['jadeTitan', 'sharpshot', 'velvetViper']);
    expect(refused(s, 's0', { k: 'smash', a: 's1', b: 's1' })).toBe('badTargets');
    expect(refused(s, 's0', { k: 'smash', a: 's1', b: 's7' as SeatId })).toBe('badTargets');
    expect(refused(s, 's0', { k: 'smash', a: 's1', b: 'toString' as SeatId })).toBe('badTargets');
    expect(refused(s, 's1', { k: 'smash', a: 's0', b: 's2' })).toBe('notYourTurn');
    const cell = spread(['jadeTitan', 'sharpshot', 'velvetViper']);
    jail(cell, 's2');
    expect(refused(cell, 's0', { k: 'smash', a: 's1', b: 's2' })).toBe('badTargets');
    const used = spread(['jadeTitan', 'sharpshot', 'velvetViper']);
    spend(used, 's0');
    expect(refused(used, 's0', { k: 'smash', a: 's1', b: 's2' })).toBe('power');
    const rolled = spread(['jadeTitan', 'sharpshot', 'velvetViper']);
    rig(rolled, [1, 1]);
    const again = act(rolled, 's0', { k: 'roll' }).state;
    expect(again.phase.k).toBe('preRoll');
    expect(refused(again, 's0', { k: 'smash', a: 's1', b: 's2' })).toBe('started');
    expect(refused(scenario(), 's0', { k: 'smash', a: 's0', b: 's1' })).toBe('noPowers');
  });

  it('lists every pair it can swap (15 at most), skipping the Holding Cell (heroes sharing a space included)', () => {
    const s = spread(['jadeTitan', 'starCaptain', 'steelAce', 'stormLord', 'velvetViper', 'sharpshot']);
    expect(smashPairs(s, 's0')).toHaveLength(15);
    expect(smashPairs(s, 's1')).toEqual([]);
    expect(legalActions(s, 's0').filter((a) => a.k === 'smash')).toHaveLength(15);
    jail(s, 's5');
    setPos(s, 's4', 5);
    // s5 out of play (5 pairs); s1 and s4 sharing a space are still a pair
    expect(smashPairs(s, 's0')).toHaveLength(15 - 5);
    expect(smashPairs(s, 's0')).toContainEqual({ a: 's1', b: 's4' });
    expect(smashPairs(s, 's0')[0]).toEqual({ a: 's0', b: 's1' });
  });

  it('two heroes on one space may be swapped (turn 1 too): no Star Shield window, both jump in place', () => {
    const s = heroGame(['jadeTitan', 'starCaptain', 'sharpshot']);
    expect(smashPairs(s, 's0')).toEqual([
      { a: 's0', b: 's1' },
      { a: 's0', b: 's2' },
      { a: 's1', b: 's2' },
    ]);
    const { state, events } = act(s, 's0', { k: 'smash', a: 's1', b: 's2' });
    expect(events).toEqual([
      { t: 'power', seat: 's0', power: 'smash' },
      { t: 'move', seat: 's1', from: 0, to: 0, path: [0], via: 'swap' },
      { t: 'move', seat: 's2', from: 0, to: 0, path: [0], via: 'swap' },
    ]);
    expect(state.phase.k).toBe('preRoll');
    expect(state.players.s0?.powerUsed).toBe(1);
    expect(cash(state, 's1')).toBe(1500);
  });

  it('Star Shield (or Steel Ace copying it) can say no; then nothing moves, the smash is still spent', () => {
    const s = spread(['jadeTitan', 'starCaptain', 'steelAce']);
    const w = act(s, 's0', { k: 'smash', a: 's1', b: 's2' }).state;
    expect(w.phase).toMatchObject({ k: 'react', kind: 'shield', seat: 's1', open: ['s1'], about: { k: 'smash', by: 's0' } });
    const no = act(w, 's1', { k: 'shield', at: w.since });
    expect(ofType(no.events, 'move')).toEqual([]);
    expect(no.state.phase.k).toBe('preRoll');
    expect(no.state.players.s0?.powerUsed).toBe(1);
    // Star Captain lets it be: Steel Ace is asked next (copying Star Shield)
    const next = act(w, 's1', { k: 'pass', at: w.since }).state;
    expect(next.phase).toMatchObject({ k: 'react', kind: 'shield', seat: 's2' });
    expect(ofType(act(next, 's2', { k: 'shield', at: next.since }).events, 'move')).toEqual([]);
    const done = act(next, 's2', { k: 'pass', at: next.since });
    expect(ofType(done.events, 'move').map((e) => [e.seat, e.to])).toEqual([
      ['s1', 10],
      ['s2', 5],
    ]);
  });

  it('a target leaving during a window: nothing moves', () => {
    const s = spread(['jadeTitan', 'starCaptain', 'steelAce']);
    const w = act(s, 's0', { k: 'smash', a: 's1', b: 's2' }).state;
    // The other hero leaving: the swap would move nobody, so Star Captain's window closes at once
    const left = act(w, 's2', { k: 'resign' });
    expect(ofType(left.events, 'move')).toEqual([]);
    expect(left.state.phase.k).toBe('preRoll');
    expect(left.state.players.s1?.powerUsed).toBeUndefined();
    // The window's own target leaving drops it (and the swap)
    const gone = act(w, 's1', { k: 'resign' });
    expect(ofType(gone.events, 'move')).toEqual([]);
    expect(gone.state.phase.k).toBe('preRoll');
  });
});

describe('Dead Aim (Sharpshot)', () => {
  function landed(heroes: Parameters<typeof heroGame>[0] = ['sharpshot', 'jadeTitan']) {
    const s = heroGame(heroes);
    setPos(s, 's0', 3);
    stack(s, 'chance', 'ch-drain', 'ch-chased');
    rig(s, [1, 1]);
    return act(s, 's0', { k: 'roll' });
  }

  it('landing on Villain Strike able to aim: take aim or draw normally', () => {
    const { state: a, events } = landed();
    expect(ofType(events, 'card')).toEqual([]);
    expect(a.phase).toEqual({ k: 'aim', seat: 's0', deck: 'chance', resume: { k: 'busy' } });
    expect(awaiting(a)).toEqual(['s0']);
    expect(timer(a)?.kind).toBe('decision');
    expect(defaultAction(a, 's0')).toEqual({ k: 'pass', at: a.since });
    expect(legalActions(a, 's0').map((x) => x.k)).toEqual(['aim', 'pass', 'resign']);
    const drawn = act(a, 's0', { k: 'pass', at: a.since });
    expect(ofType(drawn.events, 'card')[0]?.cardId).toBe('ch-drain');
    expect(cash(drawn.state, 's0')).toBe(1400);
    expect(drawn.state.players.s0?.powerUsed).toBeUndefined();
  });

  it('aim reveals the top 2 (a fresh timer); the pick plays one, the other goes under first', () => {
    const { state: a } = landed();
    const peek = act(a, 's0', { k: 'aim', at: a.since });
    expect(peek.events).toEqual([
      { t: 'power', seat: 's0', power: 'aim' },
      { t: 'aimPeek', seat: 's0', deck: 'chance', cards: ['ch-drain', 'ch-chased'] },
    ]);
    const r = peek.state;
    expect(r.phase).toMatchObject({ k: 'aim', cards: ['ch-drain', 'ch-chased'] });
    expect(r.since).toBe(r.seq);
    expect(r.decks.chance.slice(0, 2)).toEqual(['ch-drain', 'ch-chased']);
    expect(defaultAction(r, 's0')).toEqual({ k: 'pickCard', card: 'ch-drain', at: r.since });
    expect(refused(r, 's0', { k: 'pass', at: r.since })).toBe('aimed');
    expect(refused(r, 's0', { k: 'aim', at: r.since })).toBe('aimed');
    expect(refused(r, 's0', { k: 'pickCard', card: 'ch-ransom', at: r.since })).toBe('badCard');
    expect(refused(r, 's0', { k: 'pickCard', card: 'ch-chased', at: a.since })).toBe('stale');
    expect(refused(a, 's0', { k: 'pickCard', card: 'ch-chased', at: a.since })).toBe('notAimed');
    const { state, events } = act(r, 's0', { k: 'pickCard', card: 'ch-chased', at: r.since });
    expect(events.slice(0, 3)).toEqual([
      { t: 'cardReturn', deck: 'chance', cardId: 'ch-drain' },
      { t: 'card', seat: 's0', deck: 'chance', cardId: 'ch-chased', text: expect.stringContaining('Rally Point'), kept: false },
      { t: 'cardReturn', deck: 'chance', cardId: 'ch-chased' },
    ]);
    expect(state.decks.chance.slice(-2)).toEqual(['ch-drain', 'ch-chased']);
    expect(state.decks.chance).toHaveLength(20);
    expect(pos(state, 's0')).toBe(0);
    // Advanced to Rally Point: the salary, but Dead Aim was used this turn
    expect(cash(state, 's0')).toBe(1700);
    expect(state.players.s0?.powerUsed).toBe(1);
  });

  it('a hero moved onto Villain Strike out of turn aims too (the game waits for it)', () => {
    const s = heroGame(['jadeTitan', 'sharpshot']);
    setPos(s, 's0', 6);
    setPos(s, 's1', 8);
    stack(s, 'chance', 'ch-freeze');
    rig(s, [2, 3]);
    rigHero(s, FACE.sharpshot);
    const { state } = act(s, 's0', { k: 'roll' });
    expect(pos(state, 's1')).toBe(5);
    expect(state.phase).toMatchObject({ k: 'aim', seat: 's1' });
    expect(awaiting(state)).toEqual(['s1']);
    expect(refused(state, 's0', { k: 'pass', at: state.since })).toBe('notOpen');
    const drawn = act(state, 's1', { k: 'pass', at: state.since }).state;
    expect(drawn.phase.k).toBe('postRoll');
  });

  it('Steel Ace aims by copying it', () => {
    const { state: a } = landed(['steelAce', 'sharpshot']);
    expect(a.phase.k).toBe('aim');
    const { events } = act(a, 's0', { k: 'aim', at: a.since });
    expect(ofType(events, 'power')).toEqual([{ t: 'power', seat: 's0', power: 'aim', copied: true }]);
  });
});

describe('superpowers: ready, used, copied', () => {
  it('a Recharge card makes it ready again, even when used this very turn', () => {
    const s = heroGame(['jadeTitan', 'sharpshot']);
    spend(s, 's0');
    setPos(s, 's0', 1);
    stack(s, 'chest', 'cc-recharge1');
    rig(s, [1, 1]);
    const { state, events } = act(s, 's0', { k: 'roll' });
    expect(ofType(events, 'powerReady')).toEqual([{ t: 'powerReady', seat: 's0' }]);
    expect(state.players.s0?.powerUsed).toBeUndefined();
    // Ready already: nothing to say
    const ready = heroGame(['jadeTitan', 'sharpshot']);
    setPos(ready, 's0', 1);
    stack(ready, 'chest', 'cc-recharge1');
    rig(ready, [1, 1]);
    expect(ofType(act(ready, 's0', { k: 'roll' }).events, 'powerReady')).toEqual([]);
  });

  it('Steel Ace copies only an active hero who is ready; its own power wins over a copy', () => {
    const s = heroGame(['steelAce', 'jadeTitan', 'stormLord']);
    s.order.forEach((seat, i) => setPos(s, seat, i * 3));
    // Thunder Call needs a throw to answer: in preRoll only Titan Smash can be copied
    expect(usablePowers(s, 's0')).toEqual([{ power: 'smash', copied: true, hero: 'jadeTitan' }]);
    expect(usablePowers(s, 's2')).toEqual([]);
    const titan = turnOf(heroGame(['jadeTitan', 'steelAce']), 's1');
    titan.order.forEach((seat, i) => setPos(titan, seat, i * 3));
    expect(usablePowers(titan, 's1')).toEqual([{ power: 'smash', copied: true, hero: 'jadeTitan' }]);
    spend(titan, 's0');
    expect(usablePowers(titan, 's1')).toEqual([]);
    const own = heroGame(['jadeTitan', 'steelAce']);
    own.order.forEach((seat, i) => setPos(own, seat, i * 3));
    expect(usablePowers(own, 's0')).toEqual([{ power: 'smash', copied: false, hero: 'jadeTitan' }]);
    // The copied hero out of the game: nothing to copy
    const out = turnOf(heroGame(['jadeTitan', 'steelAce', 'sharpshot']), 's1');
    out.order.forEach((seat, i) => setPos(out, seat, i * 3));
    const gone = act(out, 's0', { k: 'resign' }).state;
    expect(usablePowers(gone, 's1')).toEqual([]);
  });
});
