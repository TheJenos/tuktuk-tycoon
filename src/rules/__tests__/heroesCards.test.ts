import { describe, expect, it } from 'vitest';
import { awaiting, timer } from '..';
import { ofType, act, cash, own, pos, rig, setCash, setPos, stack } from './helpers';
import { FACE, heroGame, jail, LOCATIONS, rigHero } from './heroesHelpers';

/** s0 (Jade Titan) rolls (a, b) from `from` onto a deck space whose top card is `card` */
function draw(heroes: Parameters<typeof heroGame>[0], from: number, dice: [number, number], deck: 'chance' | 'chest', ...cards: string[]) {
  const s = heroGame(heroes);
  setPos(s, 's0', from);
  stack(s, deck, ...cards);
  rig(s, dice);
  return s;
}

const TRIO = ['jadeTitan', 'sharpshot', 'velvetViper'] as const;

describe('Villain Strike: the Hero die', () => {
  it('throws every time first, then each hero rolled takes the hit, in throw order', () => {
    const s = draw([...TRIO], 2, [1, 2], 'chance', 'ch-swarm');
    rigHero(s, FACE.sharpshot, FACE.velvetViper);
    const { state, events } = act(s, 's0', { k: 'roll' });
    const kinds = events.filter((e) => e.t === 'heroDie' || e.t === 'cash').map((e) => (e.t === 'cash' ? `cash:${e.from}` : `die:${e.face}`));
    expect(kinds).toEqual(['die:6', 'die:5', 'cash:s1', 'cash:s2']);
    expect(ofType(events, 'heroDie')[0]).toEqual({ t: 'heroDie', seat: 's0', face: 6, hero: 'sharpshot', purpose: 'card', card: 'ch-swarm' });
    expect([cash(state, 's0'), cash(state, 's1'), cash(state, 's2')]).toEqual([1500, 1450, 1450]);
    expect(state.phase.k).toBe('postRoll');
  });

  it('a hero nobody plays does nothing, and a hero rolled again is not hit again', () => {
    const s = draw([...TRIO], 2, [1, 2], 'chance', 'ch-satellites');
    rigHero(s, FACE.starCaptain, FACE.jadeTitan, FACE.jadeTitan);
    const { state, events } = act(s, 's0', { k: 'roll' });
    expect(ofType(events, 'heroDie')).toHaveLength(3);
    expect(ofType(events, 'cash')).toEqual([{ t: 'cash', from: 's0', to: 'bank', amount: 30, why: 'card', after: { s0: 1470 } }]);
    expect(state.phase.k).toBe('postRoll');
  });

  it('uses the RNG for each throw, each with its event', () => {
    const s = draw([...TRIO], 2, [1, 2], 'chance', 'ch-satellites');
    const { state, events } = act(s, 's0', { k: 'roll' });
    expect(ofType(events, 'heroDie')).toHaveLength(3);
    expect(state.rng).not.toBe(s.rng);
  });

  it('go back 3: each hero rolled walks back and resolves its landing fully before the next', () => {
    const s = draw([...TRIO], 2, [1, 2], 'chance', 'ch-rewind');
    setPos(s, 's1', 13);
    setPos(s, 's2', 16);
    rigHero(s, FACE.sharpshot, FACE.velvetViper);
    const { state, events } = act(s, 's0', { k: 'roll' });
    const after = events.slice(events.findIndex((e) => e.t === 'heroDie'));
    expect(after.filter((e) => e.t !== 'cash').map((e) => e.t + ('seat' in e ? `:${e.seat}` : ''))).toEqual([
      'heroDie:s0',
      'heroDie:s0',
      'move:s1',
      'land:s1',
      'owner',
      'move:s2',
      'land:s2',
      'owner',
    ]);
    expect([pos(state, 's1'), pos(state, 's2')]).toEqual([10, 13]);
    expect(state.props.p10?.owner).toBe('s1');
    expect(state.props.p13?.owner).toBe('s2');
  });

  it("loses the hero's cheapest location (ties: the lowest index) back to its villain; it can be saved again", () => {
    const s = draw([...TRIO], 2, [1, 2], 'chance', 'ch-agents');
    own(s, 's1', [26, 2, 1]);
    rigHero(s, FACE.sharpshot);
    const { state, events } = act(s, 's0', { k: 'roll' });
    expect(ofType(events, 'owner')).toEqual([{ t: 'owner', space: 1, from: 's1', via: 'villain' }]);
    expect(state.props.p1).toBeUndefined();
    expect(state.props.p2?.owner).toBe('s1');
    // Reopened: the next hero landing there saves it
    state.turn = { seat: 's1', no: 2, doubles: 0, again: false };
    state.phase = { k: 'preRoll' };
    setPos(state, 's1', 27);
    rig(state, [1, 1]);
    const again = act(state, 's1', { k: 'roll' });
    expect(ofType(again.events, 'owner')).toEqual([{ t: 'owner', space: 1, to: 's1', via: 'buy' }]);
  });

  it('captures the hero rolled; the turn goes on when it is someone else', () => {
    const s = draw([...TRIO], 3, [1, 1], 'chance', 'ch-brute');
    rigHero(s, FACE.sharpshot);
    const { state, events } = act(s, 's0', { k: 'roll' });
    expect(ofType(events, 'jail')).toEqual([{ t: 'jail', seat: 's1', reason: 'card' }]);
    expect(state.players.s1?.jail).toEqual({ tries: 0 });
    // s0 threw doubles: its roll is still owed
    expect(state.phase.k).toBe('preRoll');
    expect(state.turn.again).toBe(true);
  });

  it('moving or capturing a hero already in the Holding Cell does nothing', () => {
    for (const card of ['ch-brute', 'ch-freeze']) {
      const s = draw([...TRIO], 2, [1, 2], 'chance', card);
      jail(s, 's1');
      rigHero(s, FACE.sharpshot);
      const { state, events } = act(s, 's0', { k: 'roll' });
      expect(ofType(events, 'move').filter((e) => e.seat === 's1'), card).toEqual([]);
      expect(ofType(events, 'jail'), card).toEqual([]);
      expect(state.players.s1?.jail, card).toEqual({ tries: 0 });
    }
  });

  it("capturing the turn seat ends its turn but keeps other heroes' queued hits", () => {
    // s0 lands on Villain Strike (doubles) and rolls itself then s1 for "go back 3": s0 goes back onto Villain Strike
    // and draws "Go to the Holding Cell"; s1's hit still happens.
    const s = draw(['jadeTitan', 'steelAce'], 9, [1, 1], 'chance', 'ch-rewind', 'ch-ambush');
    setPos(s, 's1', 15);
    rigHero(s, FACE.jadeTitan, FACE.steelAce);
    const { state, events } = act(s, 's0', { k: 'roll' });
    expect(ofType(events, 'jail')).toEqual([{ t: 'jail', seat: 's0', reason: 'card' }]);
    expect(pos(state, 's0')).toBe(7);
    expect(pos(state, 's1')).toBe(12);
    expect(state.props.p12?.owner).toBe('s1');
    expect(state.phase.k).toBe('postRoll');
    expect(state.turn.again).toBe(false);
    expect(state.pending).toEqual([]);
  });
});

describe('Villain Strike: cards on the drawer', () => {
  it("lose: the drawer's cheapest location; none owned, nothing", () => {
    const s = draw([...TRIO], 2, [1, 2], 'chance', 'ch-overrun');
    own(s, 's0', [9, 4]);
    expect(ofType(act(s, 's0', { k: 'roll' }).events, 'owner')).toEqual([{ t: 'owner', space: 4, from: 's0', via: 'villain' }]);
    const none = draw([...TRIO], 2, [1, 2], 'chance', 'ch-overrun');
    const r = act(none, 's0', { k: 'roll' });
    expect(ofType(r.events, 'owner')).toEqual([]);
    expect(r.state.phase.k).toBe('postRoll');
  });

  it('pay each hero, go back, advance (with the salary)', () => {
    const each = act(draw([...TRIO], 2, [1, 2], 'chance', 'ch-ransom'), 's0', { k: 'roll' }).state;
    expect([cash(each, 's0'), cash(each, 's1'), cash(each, 's2')]).toEqual([1450, 1525, 1525]);
    const back = act(draw([...TRIO], 2, [1, 2], 'chance', 'ch-turnaround'), 's0', { k: 'roll' }).state;
    expect(pos(back, 's0')).toBe(2);
    expect(back.props.p2?.owner).toBe('s0');
    const chased = act(draw([...TRIO], 2, [1, 2], 'chance', 'ch-chased'), 's0', { k: 'roll' });
    expect(pos(chased.state, 's0')).toBe(0);
    expect(ofType(chased.events, 'salary')).toHaveLength(1);
    const alarm = act(draw([...TRIO], 2, [1, 2], 'chance', 'ch-alarm'), 's0', { k: 'roll' }).state;
    expect(pos(alarm, 's0')).toBe(27);
    expect(alarm.props.p27?.owner).toBe('s0');
  });
});

describe('Villain Strike: chains across heroes', () => {
  it('allSaved inside a multi-hit card drops the rest of the chain, a doubles roll included', () => {
    const s = heroGame(['jadeTitan', 'velvetViper', 'sharpshot']);
    // Every location saved but Mystic Sanctum (10)
    own(s, 's0', LOCATIONS.filter((x) => x !== 10 && x !== 13));
    own(s, 's2', [13]);
    setPos(s, 's0', 3);
    setPos(s, 's1', 13);
    setPos(s, 's2', 16);
    stack(s, 'chance', 'ch-rewind');
    rig(s, [1, 1]);
    rigHero(s, FACE.velvetViper, FACE.sharpshot);
    const { state } = act(s, 's0', { k: 'roll' });
    expect(state.phase.k).toBe('over');
    if (state.phase.k === 'over') expect(state.phase.why).toBe('allSaved');
    expect(pos(state, 's1')).toBe(10);
    // s2's hit never happens
    expect(pos(state, 's2')).toBe(16);
    expect(state.pending).toEqual([]);
  });

  it("the turn seat captured by another hero's card ends its turn; doubles dropped", () => {
    const s = heroGame(['jadeTitan', 'velvetViper']);
    setPos(s, 's0', 3);
    setPos(s, 's1', 11);
    stack(s, 'chance', 'ch-freeze', 'ch-brute');
    rig(s, [1, 1]);
    rigHero(s, FACE.velvetViper, FACE.jadeTitan);
    const { state, events } = act(s, 's0', { k: 'roll' });
    expect(ofType(events, 'jail')).toEqual([{ t: 'jail', seat: 's0', reason: 'card' }]);
    expect(pos(state, 's1')).toBe(8);
    expect(state.phase.k).toBe('postRoll');
    expect(state.turn.again).toBe(false);
  });

  it('a hero knocked back onto Villain Strike out of turn gets its own Dead Aim decision', () => {
    const s = heroGame(['jadeTitan', 'sharpshot']);
    setPos(s, 's0', 3);
    setPos(s, 's1', 11);
    stack(s, 'chance', 'ch-freeze');
    rig(s, [1, 1]);
    rigHero(s, FACE.sharpshot);
    const { state } = act(s, 's0', { k: 'roll' });
    expect(state.phase.k).toBe('aim');
    expect(awaiting(state)).toEqual(['s1']);
    expect(timer(state)?.kind).toBe('decision');
  });
});

describe('Hero HQ', () => {
  it('Strike team: advance to the nearest villain-held location and save it for free', () => {
    const s = draw([...TRIO], 1, [1, 1], 'chest', 'cc-strike1');
    own(s, 's1', [4, 6]);
    const { state, events } = act(s, 's0', { k: 'roll' });
    expect(pos(state, 's0')).toBe(9);
    expect(ofType(events, 'owner')).toEqual([{ t: 'owner', space: 9, to: 's0', via: 'free' }]);
    expect(cash(state, 's0')).toBe(1500);
  });

  it('round Rally Point to the next villain-held location (with the salary)', () => {
    const s = draw([...TRIO], 20, [1, 2], 'chest', 'cc-strike2');
    own(s, 's1', [24, 26, 27]);
    const { state, events } = act(s, 's0', { k: 'roll' });
    expect(ofType(events, 'move').at(-1)).toMatchObject({ from: 23, to: 1, via: 'card' });
    expect(ofType(events, 'salary')).toHaveLength(1);
    expect(state.props.p1).toEqual({ owner: 's0', level: 0 });
    expect(cash(state, 's0')).toBe(1700);
  });

  it('Hunt down a villain: advance and save it if you have the power (a back-up if not)', () => {
    const paid = act(draw([...TRIO], 1, [1, 1], 'chest', 'cc-hunt'), 's0', { k: 'roll' }).state;
    expect(paid.props.p4?.owner).toBe('s0');
    expect(cash(paid, 's0')).toBe(1380);
    const short = draw(['jadeTitan', 'sharpshot'], 1, [1, 1], 'chest', 'cc-track');
    setCash(short, 's0', 10);
    const backed = act(short, 's0', { k: 'roll' });
    expect(ofType(backed.events, 'owner')).toEqual([{ t: 'owner', space: 4, to: 's1', via: 'backup' }]);
  });

  it('collect from each hero: each pays what it can', () => {
    const s = draw([...TRIO], 1, [1, 1], 'chest', 'cc-gear');
    setCash(s, 's1', 10);
    const { state, events } = act(s, 's0', { k: 'roll' });
    expect(cash(state, 's0')).toBe(1500 + 10 + 20);
    expect(ofType(events, 'short')).toEqual([{ t: 'short', seat: 's1', why: 'card', owed: { s0: 20 }, paid: { s0: 10 } }]);
  });
});
