import { describe, expect, it } from 'vitest';
import { awaiting, defaultAction, type Action, type GameState } from '../../rules';
import { decide, seatsToAsk } from '..';
import { SKILLS, act, bot, botStep, heroGame, own, rig, rigHero, setCash, setPos } from './helpers';

/*
 * Hero League (docs/heroes.md): one scenario per window and superpower, for every skill. The bot's own choice is legal
 * (bot() fails on any fallback or refusal) and sensible. Faces of the Hero die: 1 Jade Titan, 2 Star Captain, 3 Steel
 * Ace, 4 Storm Lord, 5 Velvet Viper, 6 Sharpshot. Board: 0 Rally Point, 7 Holding Cell, 14 Rooftop Lookout, 21 Villain
 * Ambush; Villain Strike on 5, 8, 11, 18, 20, 25; Hero HQ on 3, 23; locations 1, 2, 4, 6, 9, 10, 12, 13, 15, 16, 17,
 * 19, 22, 24, 26, 27 (pairs: 1-2, 4-6, 9-10, 12-13, 15-16, 17-19, 22-24, 26-27).
 */

const each = (name: string, fn: (skill: (typeof SKILLS)[number]) => void): void => {
  for (const skill of SKILLS) it(`${name} (${skill})`, () => fn(skill));
};

/** Every skill but Easy (which is sloppy now and then by design) */
const SOUND = ['normal', 'hard', 'expert'] as const;
const sound = (name: string, fn: (skill: (typeof SOUND)[number]) => void): void => {
  for (const skill of SOUND) it(`${name} (${skill})`, () => fn(skill));
};

/** s0 throws `w` from `from` (the turn's throw so far: `doubles`) */
function throwFrom(s: GameState, from: number, w: [number, number], doubles = 0): GameState {
  setPos(s, 's0', from);
  s.turn.doubles = doubles;
  rig(s, w);
  return act(s, 's0', { k: 'roll' });
}

/** Storm Lord (s1) lets s0's move throw stand */
const pastMove = (s: GameState): GameState => {
  expect(s.phase).toMatchObject({ k: 'react', kind: 'thunder', about: { k: 'move' } });
  return act(s, 's1', { k: 'pass', at: s.since });
};

/** The rest of the board's locations go to `seat` (so landings there pay it) */
const ownAllBut = (s: GameState, seat: 's0' | 's1' | 's2', keep: number[]): void =>
  own(s, seat, [1, 2, 4, 6, 9, 10, 12, 13, 15, 16, 17, 19, 22, 24, 26, 27].filter((x) => !keep.includes(x)));

describe('Hero League: the turn', () => {
  each('preRoll: rolls without a superpower to use there', (skill) => {
    const s = heroGame(['sharpshot', 'stormLord']);
    expect(bot(s, 's0', skill)).toEqual({ k: 'roll' });
  });

  each('preRoll: no Titan Smash while every hero shares Rally Point', (skill) => {
    const s = heroGame(['jadeTitan', 'sharpshot', 'stormLord']);
    expect(bot(s, 's0', skill)).toEqual({ k: 'roll' });
  });

  sound('preRoll: Titan Smash trades places with a rival when its own throw faces a wall of power-ups', (skill) => {
    const s = heroGame(['jadeTitan', 'sharpshot']);
    own(s, 's1', [15, 16, 17, 19, 22, 24, 26, 27]);
    setPos(s, 's0', 14);
    setPos(s, 's1', 0);
    expect(bot(s, 's0', skill)).toEqual({ k: 'smash', a: 's0', b: 's1' });
  });

  each('a captured hero has paid on its way out: it rolls', (skill) => {
    let s = heroGame(['sharpshot', 'jadeTitan']);
    s.players.s1!.pos = 7;
    s.players.s1!.jail = { tries: 0 };
    rig(s, [1, 2]);
    s = act(act(s, 's0', { k: 'roll' }), 's0', { k: 'endTurn' });
    expect(s.turn.seat).toBe('s1');
    expect(s.players.s1!.jail).toBeUndefined();
    expect(bot(s, 's1', skill)).toEqual({ k: 'roll' });
  });

  each('no buy choice: landing on a free location saves it, then the turn ends', (skill) => {
    let s = heroGame(['sharpshot', 'jadeTitan']);
    s = throwFrom(s, 0, [1, 3]);
    expect(s.props.p4?.owner).toBe('s0');
    expect(s.phase.k).toBe('postRoll');
    expect(bot(s, 's0', skill)).toEqual({ k: 'endTurn' });
  });
});

describe('Hero League: Thunder Call', () => {
  sound('re-rolls its own third double rather than be captured far from the Holding Cell', (skill) => {
    const s = throwFrom(heroGame(['stormLord', 'sharpshot']), 19, [3, 3], 2);
    expect(s.phase).toMatchObject({ k: 'react', kind: 'thunder', about: { k: 'move' }, open: ['s0'] });
    expect(bot(s, 's0', skill)).toEqual({ k: 'reroll', at: s.since });
  });

  each('lets a good throw of its own stand', (skill) => {
    const s = heroGame(['stormLord', 'sharpshot']);
    own(s, 's0', [26]);
    // A throw onto the other half of its own pair
    const t = throwFrom(s, 20, [3, 4]);
    expect(t.phase).toMatchObject({ k: 'react', kind: 'thunder' });
    expect(bot(t, 's0', skill)).toEqual({ k: 'pass', at: t.since });
  });

  sound("re-rolls a rival's throw onto the location that completes the rival's pair", (skill) => {
    let s = heroGame(['sharpshot', 'stormLord']);
    own(s, 's0', [26]);
    s = throwFrom(s, 20, [3, 4]);
    expect(s.phase).toMatchObject({ k: 'react', kind: 'thunder', seat: 's0', open: ['s1'] });
    expect(seatsToAsk(s)).toEqual(['s1']);
    expect(bot(s, 's1', skill)).toEqual({ k: 'reroll', at: s.since });
  });

  each("lets a rival's throw onto its own pair stand", (skill) => {
    let s = heroGame(['sharpshot', 'stormLord']);
    own(s, 's1', [26, 27]);
    s = throwFrom(s, 20, [3, 4]);
    expect(bot(s, 's1', skill)).toEqual({ k: 'pass', at: s.since });
  });

  sound('re-rolls the Hero die that picked it to lose its location', (skill) => {
    let s = heroGame(['sharpshot', 'stormLord', 'jadeTitan']);
    s.players.s0!.powerUsed = 1; // no Dead Aim
    own(s, 's1', [9, 10]);
    s.decks.chance = ['ch-agents', ...s.decks.chance.filter((id) => id !== 'ch-agents')];
    rigHero(s, 4);
    s = pastMove(throwFrom(s, 0, [2, 3]));
    expect(s.phase).toMatchObject({ k: 'react', kind: 'thunder', about: { k: 'hero', face: 4, purpose: 'card' } });
    expect(awaiting(s)).toEqual(['s1']);
    expect(bot(s, 's1', skill)).toEqual({ k: 'reroll', at: s.since });
  });

  each('lets the Hero die that picked a rival stand', (skill) => {
    let s = heroGame(['sharpshot', 'stormLord', 'jadeTitan']);
    s.players.s0!.powerUsed = 1;
    own(s, 's2', [9, 10]);
    s.decks.chance = ['ch-agents', ...s.decks.chance.filter((id) => id !== 'ch-agents')];
    rigHero(s, 1);
    s = pastMove(throwFrom(s, 0, [2, 3]));
    expect(s.phase).toMatchObject({ k: 'react', kind: 'thunder', about: { k: 'hero', face: 1 } });
    expect(bot(s, 's1', skill)).toEqual({ k: 'pass', at: s.since });
  });

  sound("re-rolls a back-up throw that hands a rival the other half of its pair", (skill) => {
    let s = heroGame(['sharpshot', 'stormLord', 'jadeTitan']);
    own(s, 's2', [26]);
    setCash(s, 's0', 100);
    rigHero(s, 1);
    s = pastMove(throwFrom(s, 20, [3, 4]));
    expect(s.phase).toMatchObject({ k: 'react', kind: 'thunder', about: { k: 'hero', face: 1, purpose: 'backup', space: 27 } });
    expect(bot(s, 's1', skill)).toEqual({ k: 'reroll', at: s.since });
  });

  sound("re-rolls a Velvet Viper's throw that Viper Strike would carry onto the last location, ending the game ahead", (skill) => {
    let s = heroGame(['velvetViper', 'stormLord']);
    // 27 is the last location the villains hold; the Viper is ahead on score
    ownAllBut(s, 's1', [1, 2, 4, 6, 27]);
    own(s, 's0', [1, 2, 4, 6]);
    setCash(s, 's0', 3000);
    // The dice reach the rival's pair (24), 3 short of 27; a fresh throw reaches 27 only on 7 or less
    s = throwFrom(s, 20, [1, 3]);
    expect(s.phase).toMatchObject({ k: 'react', kind: 'thunder', seat: 's0', open: ['s1'] });
    expect(bot(s, 's1', skill)).toEqual({ k: 'reroll', at: s.since });
    // Left standing, the Viper does take it there
    const t = act(s, 's1', { k: 'pass', at: s.since });
    expect(t.phase).toMatchObject({ k: 'boost', seat: 's0', total: 4 });
    expect(bot(t, 's0', skill)).toEqual({ k: 'sting', n: 3, at: t.since });
  });

  each("lets a Velvet Viper's throw stand when Viper Strike would step past its power-ups on a fresh one anyway", (skill) => {
    let s = heroGame(['velvetViper', 'stormLord']);
    own(s, 's1', [22, 24, 26, 27]);
    // Rally Point; a fresh throw from 17 would mostly reach the two pairs, but no closer than a sting can step past
    s = throwFrom(s, 17, [5, 6]);
    expect(s.phase).toMatchObject({ k: 'react', kind: 'thunder', seat: 's0', open: ['s1'] });
    expect(bot(s, 's1', skill)).toEqual({ k: 'pass', at: s.since });
  });

  each("Steel Ace keeps Suit Up to sting off a rival's pair rather than re-roll its own throw onto it", (skill) => {
    let s = heroGame(['steelAce', 'stormLord', 'velvetViper']);
    own(s, 's1', [22, 24, 26, 27]);
    s = throwFrom(s, 17, [3, 4]);
    expect(s.phase).toMatchObject({ k: 'react', kind: 'thunder', seat: 's0', about: { k: 'move' } });
    expect(bot(s, 's0', skill)).toEqual({ k: 'pass', at: s.since });
    s = act(s, 's0', { k: 'pass', at: s.since });
    s = act(s, 's1', { k: 'pass', at: s.since });
    expect(s.phase).toMatchObject({ k: 'boost', seat: 's0', total: 7 });
    expect(bot(s, 's0', skill).k).toBe('sting');
  });
});

describe('Hero League: Star Shield', () => {
  /** s0 (Star Captain) draws `card` from Villain Strike on 5 */
  function draws(card: string, setup: (s: GameState) => void = () => {}): GameState {
    const s = heroGame(['starCaptain', 'sharpshot']);
    setup(s);
    s.decks.chance = [card, ...s.decks.chance.filter((id) => id !== card)];
    return throwFrom(s, 0, [2, 3]);
  }

  each('says no to losing a location', (skill) => {
    const s = draws('ch-overrun', (x) => own(x, 's0', [9, 10]));
    expect(s.phase).toMatchObject({ k: 'react', kind: 'shield', seat: 's0', about: { k: 'hit', fx: { k: 'lose' } } });
    if (skill === 'easy') expect(['shield', 'pass']).toContain(bot(s, 's0', skill).k);
    else expect(bot(s, 's0', skill)).toEqual({ k: 'shield', at: s.since });
  });

  sound('Steel Ace says no to losing a location by copying a ready Star Captain', (skill) => {
    const s = heroGame(['steelAce', 'starCaptain']);
    own(s, 's0', [9, 10]);
    s.decks.chance = ['ch-overrun', ...s.decks.chance.filter((id) => id !== 'ch-overrun')];
    const t = throwFrom(s, 0, [2, 3]);
    expect(t.phase).toMatchObject({ k: 'react', kind: 'shield', seat: 's0', about: { k: 'hit', fx: { k: 'lose' } } });
    expect(bot(t, 's0', skill)).toEqual({ k: 'shield', at: t.since });
  });

  each('lets a card that helps it happen (Rally Point and its salary)', (skill) => {
    const s = draws('ch-chased');
    expect(s.phase).toMatchObject({ k: 'react', kind: 'shield', about: { k: 'hit', fx: { k: 'advance', to: 0 } } });
    expect(bot(s, 's0', skill)).toEqual({ k: 'pass', at: s.since });
  });

  sound('says no to a Titan Smash that puts it in front of a wall of power-ups', (skill) => {
    let s = heroGame(['jadeTitan', 'starCaptain']);
    own(s, 's0', [15, 16, 17, 19, 22, 24, 26, 27]);
    setPos(s, 's0', 14);
    setPos(s, 's1', 0);
    s = act(s, 's0', { k: 'smash', a: 's0', b: 's1' });
    expect(s.phase).toMatchObject({ k: 'react', kind: 'shield', seat: 's1', about: { k: 'smash', by: 's0' } });
    expect(bot(s, 's1', skill)).toEqual({ k: 'shield', at: s.since });
  });
});

describe('Hero League: Dead Aim and Viper Strike', () => {
  each('takes aim on Villain Strike, then plays the better card shown', (skill) => {
    let s = heroGame(['sharpshot', 'stormLord']);
    s.players.s1!.powerUsed = 1;
    s.decks.chance = ['ch-drain', 'ch-chased', ...s.decks.chance.filter((id) => id !== 'ch-drain' && id !== 'ch-chased')];
    s = throwFrom(s, 0, [2, 3]);
    expect(s.phase).toMatchObject({ k: 'aim', seat: 's0' });
    expect(seatsToAsk(s)).toEqual(['s0']);
    const a = bot(s, 's0', skill);
    if (skill === 'easy' && a.k === 'pass') return;
    expect(a).toEqual({ k: 'aim', at: s.since });
    s = act(s, 's0', a);
    expect(s.phase).toMatchObject({ k: 'aim', cards: ['ch-drain', 'ch-chased'] });
    expect(bot(s, 's0', skill)).toEqual({ k: 'pickCard', card: 'ch-chased', at: s.since });
  });

  sound('Viper Strike: extra spaces onto a free location rather than a rival pair', (skill) => {
    let s = heroGame(['velvetViper', 'sharpshot']);
    own(s, 's1', [15, 16]);
    s = throwFrom(s, 10, [2, 3]);
    expect(s.phase).toMatchObject({ k: 'boost', seat: 's0', total: 5 });
    expect(seatsToAsk(s)).toEqual(['s0']);
    const a = bot(s, 's0', skill);
    expect(a.k).toBe('sting');
    // 15 is the rival's pair; 17 and 19 are free
    if (a.k === 'sting') expect([2, 4]).toContain(a.n);
  });

  each('Viper Strike: keeps it when the dice already land well', (skill) => {
    let s = heroGame(['velvetViper', 'sharpshot']);
    // The dice reach the half of a pair it holds; every space a sting could reach is the rival's or empty
    ownAllBut(s, 's1', [1, 2, 13]);
    own(s, 's0', [12]);
    s = throwFrom(s, 10, [1, 2]);
    expect(s.phase).toMatchObject({ k: 'boost', total: 3 });
    expect(bot(s, 's0', skill)).toEqual({ k: 'pass', at: s.since });
  });
});

describe('Hero League: drivers', () => {
  it('asks every bot seat open in a reaction window, and only those', () => {
    let s = heroGame(['sharpshot', 'stormLord', 'steelAce', 'jadeTitan']);
    s = throwFrom(s, 0, [1, 3]);
    expect(s.phase).toMatchObject({ k: 'react', kind: 'thunder', open: ['s1', 's2'] });
    expect(seatsToAsk(s)).toEqual(['s1', 's2']);
    for (const skill of SKILLS) {
      expect(decide(s, 's0', skill, () => 0.5)).toBeNull();
      expect(decide(s, 's3', skill, () => 0.5)).toBeNull();
    }
  });

  it('every answer to a window carries its id', () => {
    for (const skill of SKILLS) {
      let s = heroGame(['velvetViper', 'stormLord']);
      s = throwFrom(s, 0, [1, 3]);
      while (s.phase.k === 'react' || s.phase.k === 'boost') {
        const seat = awaiting(s)[0]!;
        const a = bot(s, seat, skill) as Action & { at?: number };
        expect(a.at).toBe(s.since);
        s = act(s, seat, a);
      }
    }
  });

  it('plays a whole turn of windows with every skill, never falling back', () => {
    for (const skill of SKILLS) {
      let s = heroGame(['jadeTitan', 'starCaptain', 'steelAce', 'stormLord', 'velvetViper', 'sharpshot']);
      for (let i = 0; i < 400 && s.phase.k !== 'over' && s.turn.no < 30; i++) {
        const seat = awaiting(s)[0] ?? s.turn.seat;
        s = botStep(s, seat, skill);
      }
      expect(s.turn.no).toBeGreaterThan(1);
      expect(defaultAction(s, s.turn.seat)).not.toBeNull();
    }
  });
});
