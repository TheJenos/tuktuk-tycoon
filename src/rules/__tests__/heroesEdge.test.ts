import { describe, expect, it } from 'vitest';
import { apply, awaiting, checkInvariants, defaultAction, legalActions, timeoutCommand, timer } from '..';
import type { Action, Actor, GameEvent, GameState, SeatId } from '../types';
import { cash, ofType, own, pos, rig, setCash, setPos, stack } from './helpers';
import { FACE, LOCATIONS, heroGame, jail, rigHero } from './heroesHelpers';

/*
 * Adversarial Hero League paths. Every command goes through `go`, which also checks after it: seq + 1,
 * invariants, someone awaited (unless over), each awaited seat's defaultAction listed by legalActions and accepted,
 * timeoutCommand accepted, and a window's timer kind.
 */

const WINDOWS = new Set(['react', 'aim', 'boost']);

function probe(s: GameState): void {
  expect(checkInvariants(s)).toEqual([]);
  if (s.phase.k === 'over') {
    expect(awaiting(s)).toEqual([]);
    return;
  }
  expect(s.phase.k).not.toBe('busy');
  const aw = awaiting(s);
  expect(aw.length, `nobody awaited in ${s.phase.k}`).toBeGreaterThan(0);
  for (const seat of aw) {
    const d = defaultAction(s, seat);
    expect(d, `no default for ${seat} in ${s.phase.k}`).not.toBeNull();
    expect(legalActions(s, seat)).toContainEqual(d);
    const r = apply(s, { by: seat, a: d as Action }, { check: true });
    expect(r.ok ? 'ok' : `${r.error.code} ${r.error.message}`, `default for ${seat} in ${s.phase.k}`).toBe('ok');
  }
  const t = timeoutCommand(s);
  expect(t, `no timeout in ${s.phase.k}`).not.toBeNull();
  const r = apply(s, t as NonNullable<typeof t>, { check: true });
  expect(r.ok ? 'ok' : `${r.error.code} ${r.error.message}`, `timeout in ${s.phase.k}`).toBe('ok');
  if (WINDOWS.has(s.phase.k)) {
    expect(timer(s)).toEqual({ key: `${s.phase.k}:${s.since}`, kind: s.phase.k === 'react' ? 'reaction' : 'decision' });
  }
}

interface Out {
  state: GameState;
  events: GameEvent[];
}

function go(s: GameState, by: Actor, a: Action): Out {
  const r = apply(s, by === 'system' ? { by, a, basis: s.seq } : { by, a }, { check: true });
  if (!r.ok) throw new Error(`${by} ${JSON.stringify(a)}: ${r.error.code} ${r.error.message}`);
  expect(r.state.seq).toBe(s.seq + 1);
  probe(r.state);
  return { state: r.state, events: r.events };
}

function code(s: GameState, by: Actor, a: Action): string {
  const r = apply(s, { by, a }, { check: true });
  return r.ok ? 'ok' : r.error.code;
}

const pass = (s: GameState, seat: SeatId): Out => go(s, seat, { k: 'pass', at: s.since });
const sorted = (xs: string[]): string[] => [...xs].sort();

describe('Hero League edges: leaving inside a window', () => {
  it('a reactor leaving so that nobody left in the window can re-roll closes the Thunder window', () => {
    const s = heroGame(['jadeTitan', 'stormLord', 'steelAce']);
    rig(s, [1, 3]);
    const w = go(s, 's0', { k: 'roll' }).state;
    expect(w.phase).toMatchObject({ k: 'react', kind: 'thunder', open: ['s1', 's2'] });
    // Storm Lord leaves: Steel Ace has nobody to copy, so nobody can re-roll the throw any more and it stands
    const { state, events } = go(w, 's1', { k: 'resign' });
    expect(ofType(events, 'move').map((e) => [e.seat, e.to])).toEqual([['s0', 4]]);
    expect(state.props.p4).toEqual({ owner: 's0', level: 0 });
    expect(state.phase.k).toBe('postRoll');
  });

  it('a reactor leaving keeps the window open to those who can still re-roll (without those who passed)', () => {
    const s = heroGame(['jadeTitan', 'stormLord', 'steelAce', 'sharpshot']);
    rig(s, [1, 3]);
    let w = go(s, 's0', { k: 'roll' }).state;
    expect(w.phase).toMatchObject({ k: 'react', kind: 'thunder', open: ['s1', 's2'] });
    // Steel Ace leaves: Storm Lord can still re-roll; the countdown runs on
    const at = w.since;
    w = go(w, 's2', { k: 'resign' }).state;
    expect(w.phase).toMatchObject({ k: 'react', kind: 'thunder', open: ['s1'] });
    expect(w.since).toBe(at);
    expect(legalActions(w, 's1').map((a) => a.k)).toContain('reroll');
  });

  it('the Star Captain a Steel Ace shield window copies leaving: the window closes and the hit lands', () => {
    // s0 draws a Hero-die card hitting Steel Ace (s1), who could copy Star Shield from s2
    const s = heroGame(['jadeTitan', 'steelAce', 'starCaptain']);
    rig(s, [2, 3]);
    stack(s, 'chance', 'ch-illusionist');
    rigHero(s, FACE.steelAce);
    const w = go(s, 's0', { k: 'roll' }).state;
    expect(w.phase).toMatchObject({ k: 'react', kind: 'shield', seat: 's1', open: ['s1'] });
    const { state } = go(w, 's2', { k: 'resign' });
    expect(cash(state, 's1')).toBe(1400);
    expect(state.phase.k).toBe('postRoll');
  });

  it('Velvet Viper leaving while Steel Ace decides a copied Viper Strike: the dice move as thrown', () => {
    const s = heroGame(['steelAce', 'velvetViper', 'jadeTitan']);
    rig(s, [1, 2]);
    stack(s, 'chest', 'cc-bonus');
    const w = go(s, 's0', { k: 'roll' }).state;
    expect(w.phase).toMatchObject({ k: 'boost', seat: 's0' });
    const { state, events } = go(w, 's1', { k: 'resign' });
    expect(ofType(events, 'move')).toEqual([{ t: 'move', seat: 's0', from: 0, to: 3, path: [1, 2, 3], via: 'dice' }]);
    expect(ofType(events, 'power')).toEqual([]);
    expect(state.players.s0?.powerUsed).toBeUndefined();
    expect(cash(state, 's0')).toBe(1600);
    expect(state.phase.k).toBe('postRoll');
  });

  it('Sharpshot leaving while Steel Ace decides a copied Dead Aim: the top card is drawn as usual', () => {
    const s = heroGame(['steelAce', 'sharpshot', 'jadeTitan']);
    rig(s, [2, 3]);
    stack(s, 'chance', 'ch-drain');
    const w = go(s, 's0', { k: 'roll' }).state;
    expect(w.phase).toMatchObject({ k: 'aim', seat: 's0' });
    const { state, events } = go(w, 's1', { k: 'resign' });
    expect(ofType(events, 'card').map((e) => e.cardId)).toEqual(['ch-drain']);
    expect(ofType(events, 'power')).toEqual([]);
    expect(cash(state, 's0')).toBe(1400);
    expect(state.phase.k).toBe('postRoll');
  });

  it('after the reveal the pick goes on even when the Sharpshot a Steel Ace copied leaves', () => {
    const s = heroGame(['steelAce', 'sharpshot', 'jadeTitan']);
    rig(s, [2, 3]);
    stack(s, 'chance', 'ch-drain', 'ch-mindtrap');
    let w = go(s, 's0', { k: 'roll' }).state;
    w = go(w, 's0', { k: 'aim', at: w.since }).state;
    const at = w.since;
    w = go(w, 's1', { k: 'resign' }).state;
    expect(w.phase).toMatchObject({ k: 'aim', seat: 's0', cards: ['ch-drain', 'ch-mindtrap'] });
    expect(w.since).toBe(at);
    const { state } = go(w, 's0', { k: 'pickCard', card: 'ch-mindtrap', at });
    expect(cash(state, 's0')).toBe(1450);
  });

  it('a non-turn shield target leaving drops the hit; the turn goes on', () => {
    const s = heroGame(['jadeTitan', 'starCaptain', 'velvetViper']);
    rig(s, [2, 3]);
    stack(s, 'chance', 'ch-swarm');
    rigHero(s, FACE.starCaptain, FACE.velvetViper);
    const w = go(s, 's0', { k: 'roll' }).state;
    expect(w.phase).toMatchObject({ k: 'react', kind: 'shield', seat: 's1' });
    const { state, events } = go(w, 's1', { k: 'resign' });
    expect(state.players.s1?.out).toBe('resigned');
    // Velvet Viper's hit (queued after Star Captain's) still happens
    expect(cash(state, 's2')).toBe(1450);
    expect(ofType(events, 'short')).toEqual([]);
    expect(state.phase.k).toBe('postRoll');
    expect(state.turn.seat).toBe('s0');
  });

  it('the turn seat leaving in the shield window of its own card: the turn passes on', () => {
    const s = heroGame(['starCaptain', 'jadeTitan', 'velvetViper']);
    rig(s, [2, 3]);
    stack(s, 'chance', 'ch-drain');
    const w = go(s, 's0', { k: 'roll' }).state;
    expect(w.phase).toMatchObject({ k: 'react', kind: 'shield', seat: 's0', about: { k: 'hit', card: 'ch-drain' } });
    const { state } = go(w, 's0', { k: 'resign' });
    expect(state.phase.k).toBe('preRoll');
    expect(state.turn.seat).toBe('s1');
  });

  it('the last reactor of a two-player game leaving ends it (lastStanding, with scores)', () => {
    const s = heroGame(['jadeTitan', 'stormLord']);
    own(s, 's0', [1]);
    rig(s, [1, 3]);
    const w = go(s, 's0', { k: 'roll' }).state;
    const { state } = go(w, 's1', { k: 'resign' });
    expect(state.phase).toMatchObject({ k: 'over', why: 'lastStanding', winner: 's0', scores: { s0: 1600, s1: 0 } });
  });

  it('a Dead Aim out of turn: the aimer leaving after the reveal keeps the deck whole; the turn goes on', () => {
    const s = heroGame(['jadeTitan', 'sharpshot']);
    setPos(s, 's1', 8);
    rig(s, [2, 3]);
    stack(s, 'chance', 'ch-freeze', 'ch-swarm', 'ch-drain');
    rigHero(s, FACE.sharpshot);
    const before = sorted(s.decks.chance);
    const w = go(s, 's0', { k: 'roll' }).state;
    expect(w.phase).toMatchObject({ k: 'aim', seat: 's1' });
    const revealed = go(w, 's1', { k: 'aim', at: w.since }).state;
    expect(revealed.phase).toMatchObject({ k: 'aim', cards: ['ch-swarm', 'ch-drain'] });
    // two players: s1 leaving ends the game; with three the turn goes on
    const three = heroGame(['jadeTitan', 'sharpshot', 'velvetViper']);
    setPos(three, 's1', 8);
    rig(three, [2, 3]);
    stack(three, 'chance', 'ch-freeze', 'ch-swarm', 'ch-drain');
    rigHero(three, FACE.sharpshot);
    let x = go(three, 's0', { k: 'roll' }).state;
    x = go(x, 's1', { k: 'aim', at: x.since }).state;
    const left = go(x, 's1', { k: 'resign' }).state;
    expect(left.phase.k).toBe('postRoll');
    expect(sorted(left.decks.chance)).toEqual(before);
    expect(left.decks.chance.slice(0, 2)).toEqual(['ch-swarm', 'ch-drain']);
  });

  it('the boost seat leaving: the move is dropped and the turn passes', () => {
    const s = heroGame(['velvetViper', 'jadeTitan', 'sharpshot']);
    rig(s, [1, 2]);
    const w = go(s, 's0', { k: 'roll' }).state;
    expect(w.phase).toMatchObject({ k: 'boost', seat: 's0', total: 3 });
    const { state } = go(w, 's0', { k: 'resign' });
    expect(state.turn.seat).toBe('s1');
    expect(state.phase.k).toBe('preRoll');
  });
});

describe('Hero League edges: nested windows and re-rolls', () => {
  it('a shield window inside a Hero-die chain right after a Thunder re-roll was used', () => {
    const s = heroGame(['jadeTitan', 'stormLord', 'starCaptain']);
    rig(s, [2, 3]);
    stack(s, 'chance', 'ch-swarm');
    // throw 1: Jade Titan, re-rolled to Storm Lord; throw 2: Star Captain
    rigHero(s, FACE.jadeTitan, FACE.stormLord, FACE.starCaptain);
    let x = go(s, 's0', { k: 'roll' }).state;
    expect(x.phase).toMatchObject({ k: 'react', kind: 'thunder', about: { k: 'move' } });
    x = pass(x, 's1').state;
    expect(x.phase).toMatchObject({ k: 'react', kind: 'thunder', about: { k: 'hero', face: FACE.jadeTitan, purpose: 'card' } });
    const firstAt = x.since;
    const r = go(x, 's1', { k: 'reroll', at: x.since });
    x = r.state;
    expect(ofType(r.events, 'heroDie').map((e) => e.face)).toEqual([FACE.stormLord, FACE.starCaptain]);
    expect(x.phase).toMatchObject({ k: 'react', kind: 'shield', seat: 's2', about: { k: 'hit', card: 'ch-swarm', by: 's0' } });
    // Storm Lord's hit has already happened (throw order), before Star Captain's window
    expect(cash(x, 's1')).toBe(1450);
    expect(code(x, 's1', { k: 'pass', at: firstAt })).toBe('stale');
    expect(code(x, 's2', { k: 'pass', at: firstAt })).toBe('stale');
    const done = go(x, 's2', { k: 'shield', at: x.since });
    expect(ofType(done.events, 'power')).toEqual([{ t: 'power', seat: 's2', power: 'shield' }]);
    expect(cash(done.state, 's2')).toBe(1500);
    expect(cash(done.state, 's0')).toBe(1500);
    expect(done.state.phase.k).toBe('postRoll');
    expect(code(done.state, 's2', { k: 'shield', at: x.since })).toBe('phase');
  });

  it("Steel Ace re-rolls a card's Hero-die throw, then Storm Lord re-rolls the new one; stale answers refused", () => {
    const s = heroGame(['jadeTitan', 'stormLord', 'steelAce']);
    rig(s, [2, 3]);
    stack(s, 'chance', 'ch-illusionist');
    rigHero(s, FACE.jadeTitan, FACE.stormLord, FACE.steelAce);
    let x = go(s, 's0', { k: 'roll' }).state;
    x = pass(x, 's1').state;
    x = pass(x, 's2').state;
    expect(x.phase).toMatchObject({ k: 'react', kind: 'thunder', open: ['s1', 's2'], about: { face: FACE.jadeTitan } });
    const w1 = x.since;
    const a = go(x, 's2', { k: 'reroll', at: w1 });
    expect(ofType(a.events, 'power')).toEqual([{ t: 'power', seat: 's2', power: 'thunder', copied: true, target: 's0' }]);
    x = a.state;
    expect(x.phase).toMatchObject({ k: 'react', open: ['s1'], about: { face: FACE.stormLord } });
    expect(x.since).not.toBe(w1);
    expect(code(x, 's1', { k: 'reroll', at: w1 })).toBe('stale');
    expect(code(x, 's2', { k: 'reroll', at: x.since })).toBe('notOpen');
    const w2 = x.since;
    const b = go(x, 's1', { k: 'reroll', at: w2 });
    expect(ofType(b.events, 'heroDie').map((e) => e.face)).toEqual([FACE.steelAce]);
    // Nobody can re-roll any more: Steel Ace takes the hit
    expect(cash(b.state, 's2')).toBe(1400);
    expect(cash(b.state, 's1')).toBe(1500);
    expect(b.state.phase.k).toBe('postRoll');
    expect(code(b.state, 's1', { k: 'pass', at: w2 })).not.toBe('ok');
  });

  it('a back-up throw re-rolled by Storm Lord, who could pay but would rather not', () => {
    const s = heroGame(['jadeTitan', 'stormLord', 'sharpshot']);
    setCash(s, 's0', 100);
    rig(s, [1, 3]);
    rigHero(s, FACE.stormLord, FACE.sharpshot);
    let x = go(s, 's0', { k: 'roll' }).state;
    x = pass(x, 's1').state;
    expect(x.phase).toMatchObject({ k: 'react', kind: 'thunder', seat: 's0', about: { k: 'hero', purpose: 'backup', space: 4, face: FACE.stormLord } });
    const r = go(x, 's1', { k: 'reroll', at: x.since });
    expect(r.state.props.p4).toEqual({ owner: 's2', level: 0 });
    expect(cash(r.state, 's2')).toBe(1380);
    expect(cash(r.state, 's1')).toBe(1500);
    expect(cash(r.state, 's0')).toBe(100);
  });
});

describe('Hero League edges: hits that move heroes', () => {
  it('a back hit onto Villain Strike: a nested Dead Aim for a non-turn seat; the deck is conserved', () => {
    const s = heroGame(['jadeTitan', 'sharpshot']);
    setPos(s, 's1', 8);
    rig(s, [2, 3]);
    stack(s, 'chance', 'ch-freeze', 'ch-swarm', 'ch-drain');
    rigHero(s, FACE.sharpshot, FACE.jadeTitan, FACE.sharpshot);
    const before = sorted(s.decks.chance);
    let x = go(s, 's0', { k: 'roll' }).state;
    expect(pos(x, 's1')).toBe(5);
    expect(x.phase).toMatchObject({ k: 'aim', seat: 's1', deck: 'chance' });
    expect(awaiting(x)).toEqual(['s1']);
    const aimAt = x.since;
    x = go(x, 's1', { k: 'aim', at: aimAt }).state;
    expect(x.since).not.toBe(aimAt);
    expect(code(x, 's1', { k: 'pickCard', card: 'ch-swarm', at: aimAt })).toBe('stale');
    expect(code(x, 's1', { k: 'pass', at: x.since })).toBe('aimed');
    expect(code(x, 's0', { k: 'pickCard', card: 'ch-swarm', at: x.since })).toBe('notOpen');
    const r = go(x, 's1', { k: 'pickCard', card: 'ch-swarm', at: x.since });
    expect(cash(r.state, 's0')).toBe(1450);
    expect(cash(r.state, 's1')).toBe(1450);
    expect(r.state.phase.k).toBe('postRoll');
    expect(r.state.decks.chance).toHaveLength(20);
    expect(sorted(r.state.decks.chance)).toEqual(before);
    expect(r.state.decks.chance.slice(-3)).toEqual(['ch-freeze', 'ch-drain', 'ch-swarm']);
  });

  it('a back hit onto Villain Ambush jails that hero without ending the turn seat\'s turn (doubles kept)', () => {
    const s = heroGame(['jadeTitan', 'velvetViper']);
    setPos(s, 's1', 24);
    rig(s, [4, 4]);
    stack(s, 'chance', 'ch-freeze');
    rigHero(s, FACE.velvetViper);
    const { state, events } = go(s, 's0', { k: 'roll' });
    expect(ofType(events, 'jail')).toEqual([{ t: 'jail', seat: 's1', reason: 'space' }]);
    expect(state.players.s1?.jail).toBeDefined();
    expect(state.turn).toMatchObject({ seat: 's0', again: true, doubles: 1 });
    expect(state.phase.k).toBe('preRoll');
  });

  it('back and jail hits on a jailed hero do nothing (no window, no move), others still resolve', () => {
    const s = heroGame(['jadeTitan', 'starCaptain', 'sharpshot']);
    jail(s, 's1');
    setPos(s, 's2', 12);
    rig(s, [3, 5]);
    stack(s, 'chance', 'ch-rewind');
    rigHero(s, FACE.starCaptain, FACE.sharpshot);
    const { state, events } = go(s, 's0', { k: 'roll' });
    expect(ofType(events, 'move').filter((e) => e.seat === 's1')).toEqual([]);
    expect(ofType(events, 'power')).toEqual([]);
    expect(pos(state, 's1')).toBe(7);
    expect(state.players.s1?.jail).toBeDefined();
    expect(pos(state, 's2')).toBe(9);
    expect(state.props.p9).toEqual({ owner: 's2', level: 0 });
    expect(state.phase.k).toBe('postRoll');

    const brute = heroGame(['jadeTitan', 'starCaptain']);
    jail(brute, 's1');
    rig(brute, [2, 3]);
    stack(brute, 'chance', 'ch-brute');
    rigHero(brute, FACE.starCaptain);
    const b = go(brute, 's0', { k: 'roll' });
    expect(ofType(b.events, 'jail')).toEqual([]);
    expect(b.state.phase.k).toBe('postRoll');
  });

  it("the turn seat jailed mid-card (its own nested card) keeps the other heroes' queued hits; doubles dropped", () => {
    const s = heroGame(['jadeTitan', 'velvetViper']);
    setPos(s, 's1', 15);
    rig(s, [4, 4]);
    stack(s, 'chance', 'ch-rewind', 'ch-ambush');
    rigHero(s, FACE.jadeTitan, FACE.velvetViper);
    const { state, events } = go(s, 's0', { k: 'roll' });
    expect(ofType(events, 'jail')).toEqual([{ t: 'jail', seat: 's0', reason: 'card' }]);
    expect(pos(state, 's0')).toBe(7);
    expect(pos(state, 's1')).toBe(12);
    expect(state.props.p12).toEqual({ owner: 's1', level: 0 });
    expect(state.turn.again).toBe(false);
    expect(state.phase.k).toBe('postRoll');
    // Next time round the fine is charged first, then s0 rolls
    let x = go(state, 's0', { k: 'endTurn' }).state;
    rig(x, [1, 2]);
    x = go(x, 's1', { k: 'roll' }).state;
    if (x.phase.k === 'boost') x = pass(x, 's1').state;
    const t = go(x, 's1', { k: 'endTurn' });
    expect(ofType(t.events, 'jailExit')).toEqual([{ t: 'jailExit', seat: 's0', how: 'fine' }]);
    expect(t.state.phase.k).toBe('preRoll');
  });

  it('the turn seat captured by another hero\'s nested card while its own back hit is still queued', () => {
    // s0 draws ch-rewind hitting s1 then s0; s1 walks back onto Villain Strike and draws ch-brute, which rolls s0
    const s = heroGame(['jadeTitan', 'velvetViper']);
    setPos(s, 's1', 11);
    rig(s, [4, 4]);
    stack(s, 'chance', 'ch-rewind', 'ch-brute');
    rigHero(s, FACE.velvetViper, FACE.jadeTitan, FACE.jadeTitan);
    const { state, events } = go(s, 's0', { k: 'roll' });
    expect(pos(state, 's1')).toBe(8);
    expect(ofType(events, 'jail')).toEqual([{ t: 'jail', seat: 's0', reason: 'card' }]);
    // its own back hit then does nothing (it is in the Holding Cell)
    expect(pos(state, 's0')).toBe(7);
    expect(state.turn.again).toBe(false);
    expect(state.phase.k).toBe('postRoll');
  });
});

describe('Hero League edges: superpowers ready again', () => {
  it('a swap and then a roll round Rally Point in the same turn keep Titan Smash used; the next lap readies it', () => {
    const s = heroGame(['jadeTitan', 'velvetViper']);
    setPos(s, 's0', 2);
    setPos(s, 's1', 26);
    let r = go(s, 's0', { k: 'smash', a: 's0', b: 's1' });
    expect(ofType(r.events, 'move')).toEqual([
      { t: 'move', seat: 's0', from: 2, to: 26, path: [26], via: 'swap' },
      { t: 'move', seat: 's1', from: 26, to: 2, path: [2], via: 'swap' },
    ]);
    expect(ofType(r.events, 'salary')).toEqual([]);
    expect(r.state.phase.k).toBe('preRoll');
    rig(r.state, [1, 2]);
    r = go(r.state, 's0', { k: 'roll' });
    expect(ofType(r.events, 'salary')).toHaveLength(1);
    expect(ofType(r.events, 'powerReady')).toEqual([]);
    expect(r.state.players.s0?.powerUsed).toBe(1);
    let x = go(r.state, 's0', { k: 'endTurn' }).state;
    rig(x, [1, 2]);
    x = go(x, 's1', { k: 'roll' }).state;
    if (x.phase.k === 'boost') x = pass(x, 's1').state;
    x = go(x, 's1', { k: 'endTurn' }).state;
    // a later turn round Rally Point readies it
    setPos(x, 's0', 25);
    rig(x, [1, 3]);
    const y = go(x, 's0', { k: 'roll' });
    expect(ofType(y.events, 'powerReady')).toEqual([{ t: 'powerReady', seat: 's0' }]);
  });

  it('a Recharge card the same turn readies Titan Smash, but it still cannot be used after the roll', () => {
    const s = heroGame(['jadeTitan', 'velvetViper']);
    setPos(s, 's0', 1);
    setPos(s, 's1', 11);
    const x = go(s, 's0', { k: 'smash', a: 's0', b: 's1' }).state;
    expect(pos(x, 's0')).toBe(11);
    stack(x, 'chest', 'cc-recharge1');
    // 11 + 12 = 23 (Hero HQ), doubles
    rig(x, [6, 6]);
    const r = go(x, 's0', { k: 'roll' });
    expect(pos(r.state, 's0')).toBe(23);
    expect(ofType(r.events, 'powerReady')).toEqual([{ t: 'powerReady', seat: 's0' }]);
    expect(r.state.players.s0?.powerUsed).toBeUndefined();
    expect(r.state.phase.k).toBe('preRoll');
    expect(code(r.state, 's0', { k: 'smash', a: 's0', b: 's1' })).toBe('started');
  });
});

describe('Hero League edges: Viper Strike', () => {
  it('a sting onto Villain Ambush captures the hero: no landing beyond, doubles dropped', () => {
    const s = heroGame(['velvetViper', 'jadeTitan']);
    setPos(s, 's0', 14);
    rig(s, [2, 2]);
    let x = go(s, 's0', { k: 'roll' }).state;
    expect(x.phase).toMatchObject({ k: 'boost', total: 4 });
    expect(x.turn.again).toBe(true);
    const r = go(x, 's0', { k: 'sting', n: 3, at: x.since });
    expect(ofType(r.events, 'jail')).toEqual([{ t: 'jail', seat: 's0', reason: 'space' }]);
    expect(r.state.turn.again).toBe(false);
    expect(r.state.phase.k).toBe('postRoll');
    expect(r.state.players.s0?.powerUsed).toBe(1);
    x = r.state;
  });

  it('a boosted landing on a location: one walk, one landing, a compulsory save', () => {
    const s = heroGame(['velvetViper', 'jadeTitan']);
    rig(s, [1, 2]);
    const x = go(s, 's0', { k: 'roll' }).state;
    const r = go(x, 's0', { k: 'sting', n: 1, at: x.since });
    expect(ofType(r.events, 'move')).toEqual([{ t: 'move', seat: 's0', from: 0, to: 4, path: [1, 2, 3, 4], via: 'dice' }]);
    expect(ofType(r.events, 'land')).toEqual([{ t: 'land', seat: 's0', space: 4 }]);
    expect(r.state.props.p4).toEqual({ owner: 's0', level: 0 });
    expect(cash(r.state, 's0')).toBe(1380);
  });
});

describe('Hero League edges: Titan Smash', () => {
  it('the smasher as one target: only the other target is asked; a shield stops it and the smash is spent', () => {
    const s = heroGame(['jadeTitan', 'starCaptain']);
    setPos(s, 's0', 4);
    setPos(s, 's1', 9);
    const w = go(s, 's0', { k: 'smash', a: 's1', b: 's0' }).state;
    expect(w.phase).toMatchObject({ k: 'react', kind: 'shield', seat: 's1', open: ['s1'], about: { k: 'smash', by: 's0' } });
    const r = go(w, 's1', { k: 'shield', at: w.since });
    expect(ofType(r.events, 'move')).toEqual([]);
    expect(pos(r.state, 's0')).toBe(4);
    expect(pos(r.state, 's1')).toBe(9);
    expect(r.state.phase.k).toBe('preRoll');
    expect(r.state.players.s0?.powerUsed).toBe(1);
    expect(code(r.state, 's0', { k: 'smash', a: 's0', b: 's1' })).toBe('power');
    rig(r.state, [1, 2]);
    expect(go(r.state, 's0', { k: 'roll' }).state.players.s0?.pos).toBe(7);

    const p = go(s, 's0', { k: 'smash', a: 's0', b: 's1' }).state;
    const moved = pass(p, 's1');
    expect(pos(moved.state, 's0')).toBe(9);
    expect(pos(moved.state, 's1')).toBe(4);
  });

  it('a target leaving in the second shield window: nothing moves, back to preRoll', () => {
    const s = heroGame(['jadeTitan', 'starCaptain', 'steelAce']);
    setPos(s, 's0', 12);
    setPos(s, 's1', 4);
    setPos(s, 's2', 9);
    let x = go(s, 's0', { k: 'smash', a: 's1', b: 's2' }).state;
    expect(x.phase).toMatchObject({ k: 'react', kind: 'shield', seat: 's1' });
    x = pass(x, 's1').state;
    expect(x.phase).toMatchObject({ k: 'react', kind: 'shield', seat: 's2' });
    const r = go(x, 's2', { k: 'resign' });
    expect(ofType(r.events, 'move')).toEqual([]);
    expect(pos(r.state, 's1')).toBe(4);
    expect(r.state.phase.k).toBe('preRoll');
    expect(r.state.turn.seat).toBe('s0');

    // the first-asked target leaving: the second is never asked
    let y = go(s, 's0', { k: 'smash', a: 's2', b: 's1' }).state;
    expect(y.phase).toMatchObject({ k: 'react', kind: 'shield', seat: 's2' });
    y = pass(y, 's2').state;
    expect(y.phase).toMatchObject({ seat: 's1' });
    const z = go(y, 's1', { k: 'resign' });
    expect(ofType(z.events, 'move')).toEqual([]);
    expect(pos(z.state, 's2')).toBe(9);
    expect(z.state.phase.k).toBe('preRoll');
  });

  it('the smasher leaving inside the shield window: the turn passes, nothing moves', () => {
    const s = heroGame(['jadeTitan', 'starCaptain', 'velvetViper']);
    setPos(s, 's1', 4);
    setPos(s, 's2', 9);
    const w = go(s, 's0', { k: 'smash', a: 's1', b: 's2' }).state;
    const r = go(w, 's0', { k: 'resign' });
    expect(pos(r.state, 's1')).toBe(4);
    expect(pos(r.state, 's2')).toBe(9);
    expect(r.state.turn.seat).toBe('s1');
    expect(r.state.phase.k).toBe('preRoll');
  });
});

describe('Hero League edges: back-up heroes', () => {
  it('a non-turn lander short after a back hit: two eligible, one Hero-die throw by the lander', () => {
    const s = heroGame(['jadeTitan', 'velvetViper', 'sharpshot']);
    setPos(s, 's1', 15);
    setCash(s, 's1', 50);
    rig(s, [3, 5]);
    stack(s, 'chance', 'ch-freeze');
    rigHero(s, FACE.velvetViper, FACE.jadeTitan);
    const { state, events } = go(s, 's0', { k: 'roll' });
    expect(pos(state, 's1')).toBe(12);
    expect(ofType(events, 'heroDie').map((e) => [e.seat, e.purpose, e.face])).toEqual([
      ['s0', 'card', FACE.velvetViper],
      ['s1', 'backup', FACE.jadeTitan],
    ]);
    expect(ofType(events, 'owner')).toContainEqual({ t: 'owner', space: 12, to: 's0', via: 'backup' });
    expect(cash(state, 's1')).toBe(50);
  });

  it('a rigged face of a hero who cannot pay is used up; the next rigged face serves the next throw', () => {
    const s = heroGame(['jadeTitan', 'velvetViper', 'sharpshot', 'starCaptain']);
    setCash(s, 's0', 100);
    setCash(s, 's1', 100);
    rig(s, [1, 3]);
    // Velvet Viper (s1) cannot pay 120: the face is used up and the draw is among Sharpshot and Star Captain
    rigHero(s, FACE.velvetViper, FACE.starCaptain);
    const { state, events } = go(s, 's0', { k: 'roll' });
    const die = ofType(events, 'heroDie');
    expect(die).toHaveLength(1);
    expect([FACE.sharpshot, FACE.starCaptain]).toContain(die[0]?.face);
    expect(state.rigHero).toEqual([FACE.starCaptain]);
  });

  it('nobody eligible: noSave; exactly one: no throw, saves at once', () => {
    const none = heroGame(['jadeTitan', 'velvetViper']);
    setCash(none, 's0', 100);
    setCash(none, 's1', 100);
    rig(none, [1, 3]);
    const n = go(none, 's0', { k: 'roll' });
    expect(ofType(n.events, 'noSave')).toEqual([{ t: 'noSave', seat: 's0', space: 4 }]);
    expect(n.state.props.p4).toBeUndefined();

    const one = heroGame(['jadeTitan', 'velvetViper', 'sharpshot']);
    setCash(one, 's0', 100);
    setCash(one, 's1', 100);
    rig(one, [1, 3]);
    const rngBefore = one.rng;
    const o = go(one, 's0', { k: 'roll' });
    expect(ofType(o.events, 'heroDie')).toEqual([]);
    expect(o.state.props.p4).toEqual({ owner: 's2', level: 0 });
    expect(o.state.rng).toBe(rngBefore);
  });
});

describe('Hero League edges: the end mid-chain', () => {
  const allBut = (s: GameState, free: number, seat: SeatId = 's0'): void =>
    own(s, seat, LOCATIONS.filter((x) => x !== free));

  it('the last location saved by a back-walked hero ends the game; later hits and the doubles are dropped', () => {
    const s = heroGame(['jadeTitan', 'velvetViper', 'sharpshot']);
    allBut(s, 12);
    setPos(s, 's1', 15);
    setPos(s, 's2', 25);
    rig(s, [4, 4]);
    stack(s, 'chance', 'ch-rewind');
    rigHero(s, FACE.velvetViper, FACE.sharpshot);
    const { state, events } = go(s, 's0', { k: 'roll' });
    expect(state.phase).toMatchObject({ k: 'over', why: 'allSaved' });
    expect(state.pending).toEqual([]);
    expect(pos(state, 's2')).toBe(25);
    expect(ofType(events, 'move').filter((e) => e.seat === 's2')).toEqual([]);
    if (state.phase.k === 'over') {
      expect(state.phase.scores).toEqual({ s0: 1500 + 1500, s1: 1300 + 100, s2: 1500 });
      expect(state.phase.ranking[0]).toBe('s0');
    }
  });

  it('the last location saved by a back-up after a Thunder window ends it', () => {
    const s = heroGame(['jadeTitan', 'stormLord', 'sharpshot']);
    allBut(s, 4, 's2');
    setCash(s, 's0', 100);
    rig(s, [1, 3]);
    rigHero(s, FACE.stormLord);
    let x = go(s, 's0', { k: 'roll' }).state;
    x = pass(x, 's1').state;
    expect(x.phase).toMatchObject({ k: 'react', about: { k: 'hero', purpose: 'backup' } });
    const r = go(x, 's1', { k: 'pass', at: x.since });
    expect(r.state.phase).toMatchObject({ k: 'over', why: 'allSaved' });
    expect(r.state.props.p4).toEqual({ owner: 's1', level: 0 });
  });

  it('a Strike team free save of the last location ends it', () => {
    const s = heroGame(['jadeTitan', 'velvetViper']);
    allBut(s, 27, 's1');
    rig(s, [1, 2]);
    stack(s, 'chest', 'cc-strike1');
    const { state } = go(s, 's0', { k: 'roll' });
    expect(state.phase).toMatchObject({ k: 'over', why: 'allSaved' });
    expect(state.props.p27).toEqual({ owner: 's0', level: 0 });
  });
});

describe('Hero League edges: short payments', () => {
  it('pay each hero with 0 Power: no window, no cash events, one short event listing every creditor at 0', () => {
    const s = heroGame(['starCaptain', 'jadeTitan', 'velvetViper', 'sharpshot']);
    setCash(s, 's0', 0);
    rig(s, [2, 3]);
    stack(s, 'chance', 'ch-ransom');
    const { state, events } = go(s, 's0', { k: 'roll' });
    expect(ofType(events, 'power')).toEqual([]);
    expect(ofType(events, 'cash')).toEqual([]);
    expect(ofType(events, 'short')).toEqual([
      { t: 'short', seat: 's0', why: 'card', owed: { s1: 25, s2: 25, s3: 25 }, paid: { s1: 0, s2: 0, s3: 0 } },
    ]);
    expect(state.phase.k).toBe('postRoll');
  });

  it('pay each hero short (after a shield pass): creditors paid in seat order as far as it goes', () => {
    const s = heroGame(['starCaptain', 'jadeTitan', 'velvetViper', 'sharpshot']);
    setCash(s, 's0', 30);
    rig(s, [2, 3]);
    stack(s, 'chance', 'ch-ransom');
    const w = go(s, 's0', { k: 'roll' }).state;
    expect(w.phase).toMatchObject({ k: 'react', kind: 'shield', seat: 's0' });
    const { state, events } = pass(w, 's0');
    expect(ofType(events, 'short')).toEqual([
      { t: 'short', seat: 's0', why: 'card', owed: { s1: 25, s2: 25, s3: 25 }, paid: { s1: 25, s2: 5, s3: 0 } },
    ]);
    expect([cash(state, 's0'), cash(state, 's1'), cash(state, 's2'), cash(state, 's3')]).toEqual([0, 1525, 1505, 1500]);
  });

  it('a jailed hero with 0 Power: the fine is short, it still leaves and rolls', () => {
    const s = heroGame(['jadeTitan', 'velvetViper']);
    jail(s, 's1');
    setCash(s, 's1', 0);
    rig(s, [1, 2]);
    let x = go(s, 's0', { k: 'roll' }).state;
    const r = go(x, 's0', { k: 'endTurn' });
    expect(ofType(r.events, 'short')).toEqual([{ t: 'short', seat: 's1', why: 'fine', owed: { bank: 50 }, paid: { bank: 0 } }]);
    expect(r.state.players.s1?.jail).toBeUndefined();
    expect(r.state.phase.k).toBe('preRoll');
    x = r.state;
  });
});

describe('Hero League edges: closing windows by timeout', () => {
  it('closeReact on a shield window lets the effect happen; on a thunder window the throw stands', () => {
    const s = heroGame(['jadeTitan', 'starCaptain', 'stormLord']);
    rig(s, [2, 3]);
    stack(s, 'chance', 'ch-illusionist');
    rigHero(s, FACE.starCaptain);
    let x = go(s, 's0', { k: 'roll' }).state;
    const t1 = timeoutCommand(x);
    expect(t1).toEqual({ by: 'system', a: { k: 'closeReact' }, basis: x.seq });
    let r = go(x, 'system', { k: 'closeReact' });
    x = r.state;
    expect(ofType(r.events, 'reactTimeout')).toEqual([{ t: 'reactTimeout', seats: ['s2'] }]);
    expect(x.phase).toMatchObject({ k: 'react', kind: 'thunder', about: { k: 'hero', face: FACE.starCaptain } });
    r = go(x, 'system', { k: 'closeReact' });
    x = r.state;
    expect(x.phase).toMatchObject({ k: 'react', kind: 'shield', seat: 's1' });
    r = go(x, 'system', { k: 'closeReact' });
    expect(cash(r.state, 's1')).toBe(1400);
    expect(r.state.phase.k).toBe('postRoll');
  });
});

describe('Hero League edges: more corners', () => {
  it('Star Captain shielding first leaves Steel Ace nothing to copy; Steel Ace first leaves Star Captain its own', () => {
    const a = heroGame(['jadeTitan', 'starCaptain', 'steelAce']);
    rig(a, [2, 3]);
    stack(a, 'chance', 'ch-swarm');
    rigHero(a, FACE.starCaptain, FACE.steelAce);
    let x = go(a, 's0', { k: 'roll' }).state;
    expect(x.phase).toMatchObject({ k: 'react', kind: 'shield', seat: 's1' });
    const r = go(x, 's1', { k: 'shield', at: x.since });
    expect(cash(r.state, 's2')).toBe(1450);
    expect(r.state.phase.k).toBe('postRoll');

    const b = heroGame(['jadeTitan', 'starCaptain', 'steelAce']);
    rig(b, [2, 3]);
    stack(b, 'chance', 'ch-swarm');
    rigHero(b, FACE.steelAce, FACE.starCaptain);
    x = go(b, 's0', { k: 'roll' }).state;
    expect(x.phase).toMatchObject({ k: 'react', kind: 'shield', seat: 's2' });
    const c1 = go(x, 's2', { k: 'shield', at: x.since });
    expect(ofType(c1.events, 'power')).toEqual([{ t: 'power', seat: 's2', power: 'shield', copied: true }]);
    expect(c1.state.phase).toMatchObject({ k: 'react', kind: 'shield', seat: 's1' });
    const c2 = go(c1.state, 's1', { k: 'shield', at: c1.state.since });
    expect([cash(c2.state, 's1'), cash(c2.state, 's2')]).toEqual([1500, 1500]);
  });

  it('Steel Ace smashes by copying Titan Smash: Jade Titan keeps its own, and may be a target', () => {
    const s = heroGame(['steelAce', 'jadeTitan', 'velvetViper']);
    setPos(s, 's1', 4);
    setPos(s, 's2', 9);
    const r = go(s, 's0', { k: 'smash', a: 's1', b: 's2' });
    expect(ofType(r.events, 'power')).toEqual([{ t: 'power', seat: 's0', power: 'smash', copied: true }]);
    expect([pos(r.state, 's1'), pos(r.state, 's2')]).toEqual([9, 4]);
    expect(r.state.players.s1?.powerUsed).toBeUndefined();
    expect(r.state.players.s0?.powerUsed).toBe(1);
  });

  it('a forced default in a window is accepted, any other forced action refused', () => {
    const s = heroGame(['jadeTitan', 'stormLord']);
    rig(s, [1, 3]);
    const w = go(s, 's0', { k: 'roll' }).state;
    const f = apply(w, { by: 'system', a: { k: 'forced', seat: 's1', a: { k: 'pass', at: w.since } }, basis: w.seq }, { check: true });
    expect(f.ok).toBe(true);
    const g = apply(w, { by: 'system', a: { k: 'forced', seat: 's1', a: { k: 'reroll', at: w.since } }, basis: w.seq }, { check: true });
    expect(g.ok ? 'ok' : g.error.code).toBe('notDefault');
    expect(code(w, 's1', { k: 'pass' })).toBe('stale');
    expect(code(w, 's1', { k: 'pass', at: w.since + 1 })).toBe('stale');
    expect(code(w, 's1', { k: 'pass', at: String(w.since) as unknown as number })).toBe('stale');
  });

  it('a Recharge drawn out of turn (a back hit onto Hero HQ) readies a superpower used this very turn', () => {
    const s = heroGame(['jadeTitan', 'stormLord']);
    setPos(s, 's1', 26);
    rig(s, [2, 3], [2, 3]);
    stack(s, 'chance', 'ch-freeze');
    stack(s, 'chest', 'cc-recharge1');
    rigHero(s, FACE.stormLord);
    let x = go(s, 's0', { k: 'roll' }).state;
    // Storm Lord re-rolls s0's throw (same 2+3), spending its power on turn 1
    const r = go(x, 's1', { k: 'reroll', at: x.since });
    x = r.state;
    expect(pos(x, 's1')).toBe(23);
    expect(ofType(r.events, 'powerReady')).toEqual([{ t: 'powerReady', seat: 's1' }]);
    expect(x.players.s1?.powerUsed).toBeUndefined();
  });

  it('the turn seat shielding its own advance card on a doubles roll keeps its turn going', () => {
    const s = heroGame(['starCaptain', 'jadeTitan']);
    rig(s, [4, 4]);
    stack(s, 'chance', 'ch-chased');
    const w = go(s, 's0', { k: 'roll' }).state;
    expect(w.phase).toMatchObject({ k: 'react', kind: 'shield', seat: 's0', about: { k: 'hit', fx: { k: 'advance', to: 0 } } });
    const r = go(w, 's0', { k: 'shield', at: w.since });
    expect(pos(r.state, 's0')).toBe(8);
    expect(r.state.phase.k).toBe('preRoll');
    expect(r.state.turn.again).toBe(true);
  });

  it('a back hit onto an owned location: the power-up is paid, short when needed (naming the space)', () => {
    const s = heroGame(['jadeTitan', 'velvetViper']);
    own(s, 's0', [12, 13]);
    setPos(s, 's1', 15);
    setCash(s, 's1', 100);
    rig(s, [3, 5]);
    stack(s, 'chance', 'ch-freeze');
    rigHero(s, FACE.velvetViper);
    const { state, events } = go(s, 's0', { k: 'roll' });
    expect(ofType(events, 'short')).toEqual([{ t: 'short', seat: 's1', why: 'rent', space: 12, owed: { s0: 240 }, paid: { s0: 100 } }]);
    expect([cash(state, 's0'), cash(state, 's1')]).toEqual([1600, 0]);
  });
});
