import { describe, expect, it } from 'vitest';
import { HEROES, LANKA, type GameState, type SeatId } from '../../../rules';
import { normalizeSettings } from '../../settings';
import { toHeroFaces } from '../../testHooks';
import { deedFor, spaceBlurb } from '../deeds/deed';
import { makeNames, money, myPropsTitle, ownedBy, pluralWord, powerLabel, signedMoney, termsOf, tokenOf } from '../format';
import { splitMoney } from '../hud/logText';
import { spaceActions } from '../manage/spaceActions';
import { askReaction, decisionKey, decisionSeat, heroesOn, phaseLabel, reactAbout, reactIsAbout, resignQuestion } from '../selectors';
import { act, game, heroesGame, own, rigged } from './helpers';

/*
 * Hero League in the game screen's pure parts: money in Power, the board's words, the reaction windows' labels and
 * who they ask, Dead Aim's secrecy in the labels, location deeds, and the test hooks' Hero-die rig.
 */

const active = (rows: { label: string; active?: boolean }[]) => rows.filter((r) => r.active).map((r) => r.label);

/** s0 rolls `dice` (rigged) from preRoll */
function roll(s: GameState, dice: [number, number], hero: number[] = []): GameState {
  return act(rigged(s, [dice], hero), s.turn.seat, { k: 'roll' }).state;
}

/** Puts a card on top of its deck */
function topCard(s: GameState, deck: 'chance' | 'chest', id: string): void {
  s.decks[deck] = [id, ...s.decks[deck].filter((c) => c !== id)];
}

describe('money and words', () => {
  it('shows each board in its own currency, and All Island\'s without one', () => {
    expect(money(1500)).toBe('Rs. 150,000');
    expect(money(1500, LANKA)).toBe('Rs. 150,000');
    expect(money(1500, HEROES)).toBe('1,500 Power');
    expect(signedMoney(200, HEROES)).toBe('+200 Power');
    expect(signedMoney(-50, HEROES)).toBe('−50 Power');
    expect(signedMoney(200)).toBe('+Rs. 20,000');
    const names = makeNames(heroesGame(), null);
    expect(names.money(140)).toBe('140 Power');
    expect(names.signedMoney(-35)).toBe('−35 Power');
  });

  it('uses the board\'s terms, the classic words elsewhere', () => {
    expect(termsOf(HEROES)).toEqual({ property: 'location', buy: 'save', bought: 'saved', owned: 'saved', rent: 'power-up', bank: 'the Power Broker', worth: 'score' });
    expect(termsOf(LANKA)).toEqual({ property: 'property', buy: 'buy', bought: 'bought', owned: 'owned', rent: 'rent', bank: 'the bank', worth: 'net worth' });
    expect(myPropsTitle(LANKA)).toBe('My properties');
    expect(myPropsTitle(HEROES)).toBe('My locations');
    expect(ownedBy(LANKA)).toBe('Owned by');
    expect(ownedBy(HEROES)).toBe('Saved by');
    expect(pluralWord('power-up')).toBe('power-ups');
  });

  it('names a superpower as used, with Suit Up when it was copied, and "superpower" on a board without it', () => {
    expect(powerLabel(HEROES, 'thunder')).toBe('Thunder Call');
    expect(powerLabel(HEROES, 'sting', true)).toBe('Viper Strike (Suit Up)');
    expect(powerLabel(LANKA, 'shield')).toBe('superpower');
  });

  it('shows the hero a seat plays as its token, the lobby token elsewhere', () => {
    const s = heroesGame(['sharpshot', 'stormLord']);
    expect(tokenOf(s, 's0', 'tuktuk')).toBe('sharpshot');
    expect(tokenOf(game(), 's0', 'elephant')).toBe('elephant');
    expect(tokenOf(null, 's0', undefined)).toBe('tuktuk');
  });

  it('highlights Power amounts in the log', () => {
    expect(splitMoney('Ann pays Bob 140 Power (Sky Carrier power-up)', HEROES.display.currency)).toEqual([
      { text: 'Ann pays Bob ' },
      { text: '140 Power', money: 'plain' },
      { text: ' (Sky Carrier power-up)' },
    ]);
    const parts = splitMoney('+200 Power and −1,500 Power to the Power Broker', HEROES.display.currency);
    expect(parts.filter((p) => p.money).map((p) => [p.text, p.money])).toEqual([['+200 Power', 'plus'], ['−1,500 Power', 'minus']]);
    expect(splitMoney('Ann pays Rs. 5,000', HEROES.display.currency)).toEqual([{ text: 'Ann pays Rs. 5,000' }]);
  });
});

describe('reaction windows', () => {
  it('a Thunder window after a move throw: its label, what it is about, and no hand-over in hot-seat', () => {
    const s = roll(heroesGame(['jadeTitan', 'stormLord']), [1, 3]);
    expect(s.phase.k).toBe('react');
    if (s.phase.k !== 'react') return;
    const names = makeNames(s, null);
    expect(phaseLabel(s, names, ['s1'])).toBe("Thunder Call: You may re-roll Ann's throw");
    expect(phaseLabel(s, names, ['s0'])).toBe("Thunder Call: Bob may re-roll your throw");
    expect(phaseLabel(s, names, [])).toBe("Thunder Call: Bob may re-roll Ann's throw");
    expect(reactAbout(s, names, s.phase).title).toBe('Ann rolled 1 + 3');
    const both: SeatId[] = ['s0', 's1'];
    const key = decisionKey(s, both);
    expect(key).toMatch(/^react:/);
    expect(decisionSeat(s, both, key)).toBeNull();
  });

  it('asks a seat per the Reactions setting: always, only about its own throw or hero, or never', () => {
    const s = roll(heroesGame(['jadeTitan', 'stormLord']), [1, 3]);
    expect(reactIsAbout(s, 's1')).toBe(false);
    expect(reactIsAbout(s, 's0')).toBe(true);
    expect(askReaction(s, 's1', 'all')).toBe(true);
    expect(askReaction(s, 's1', 'mine')).toBe(false);
    expect(askReaction(s, 's1', 'never')).toBe(false);
    // Storm Lord re-rolling their own throw is about them
    const own = roll(heroesGame(['stormLord', 'jadeTitan']), [1, 3]);
    expect(askReaction(own, 's0', 'mine')).toBe(true);
    expect(askReaction(game(), 's0', 'all')).toBe(true);
  });

  it('a Hero-die throw is about the hero it picks: the card and the face are named', () => {
    const start = heroesGame(['jadeTitan', 'stormLord']);
    topCard(start, 'chance', 'ch-illusionist');
    // Ann lands on Villain Strike (5): Bob's Thunder window on the dice, passed; then the Hero die rolls Bob's hero
    const w = roll(start, [2, 3], [4]);
    const s = act(w, 's1', { k: 'pass', at: w.since }).state;
    expect(s.phase.k).toBe('react');
    if (s.phase.k !== 'react') return;
    expect(s.phase.about).toMatchObject({ k: 'hero', face: 4, purpose: 'card' });
    const about = reactAbout(s, makeNames(s, null), s.phase);
    expect(about.title).toBe('Hero die: Storm Lord (Bob)');
    expect(about.detail).toMatch(/^The Illusionist casts a spell/);
    expect(reactIsAbout(s, 's1')).toBe(true);
    expect(askReaction(s, 's1', 'mine')).toBe(true);
  });

  it('a Star Shield window against a Titan Smash says who would be moved', () => {
    const s0 = heroesGame(['jadeTitan', 'starCaptain']);
    s0.players.s1!.pos = 4;
    const s = act(s0, 's0', { k: 'smash', a: 's0', b: 's1' }).state;
    expect(s.phase.k).toBe('react');
    if (s.phase.k !== 'react') return;
    const names = makeNames(s, null);
    expect(phaseLabel(s, names, ['s1'])).toBe('Star Shield: You may say no');
    expect(reactAbout(s, names, s.phase).title).toBe("Ann's Titan Smash would move Bob");
    expect(askReaction(s, 's1', 'mine')).toBe(true);
  });
});

describe('Dead Aim and Viper Strike labels', () => {
  it('only the aiming player is told to pick; everyone else reads that the hero takes aim', () => {
    const w = roll(heroesGame(['sharpshot', 'jadeTitan']), [2, 3]);
    expect(w.phase.k).toBe('aim');
    const names = makeNames(w, null);
    expect(phaseLabel(w, names, ['s0'])).toBe('You: take aim or draw');
    expect(phaseLabel(w, names, ['s1'])).toBe('Sharpshot may take aim (Dead Aim)');
    const s = act(w, 's0', { k: 'aim', at: w.since }).state;
    expect(s.phase.k === 'aim' && s.phase.cards?.length).toBe(2);
    expect(phaseLabel(s, names, ['s0'])).toBe('You: pick the card to play');
    const other = phaseLabel(s, names, ['s1']);
    expect(other).toBe('Sharpshot takes aim');
    // The revealed cards' texts never reach anyone else's label
    if (s.phase.k === 'aim') for (const id of s.phase.cards ?? []) expect(other).not.toContain(id);
  });

  it('Viper Strike offers the extra steps to its own player', () => {
    const s = roll(heroesGame(['velvetViper', 'jadeTitan']), [1, 3]);
    expect(s.phase).toMatchObject({ k: 'boost', seat: 's0', total: 4 });
    const names = makeNames(s, null);
    expect(phaseLabel(s, names, ['s0'])).toBe('You: move up to 6 extra spaces?');
    expect(phaseLabel(s, names, ['s1'])).toBe('Ann may move further (Viper Strike)');
  });
});

describe('Hero League screens', () => {
  it('knows the board, and that a turn ends with nothing to manage or trade', () => {
    const s = heroesGame();
    expect(heroesOn(s)).toBe(true);
    expect(heroesOn(game())).toBe(false);
    expect(heroesOn(null)).toBe(false);
    s.phase = { k: 'postRoll' };
    expect(phaseLabel(s, makeNames(s, null), ['s0'])).toBe('You: end the turn');
  });

  it('a resignation hands the locations back to their villains', () => {
    const s = heroesGame();
    expect(resignQuestion(s, 's0', makeNames(s, null), false)).toBe('Resign? Your locations go back to their villains.');
  });

  it('a saved location has no build, mortgage or sale actions', () => {
    const s = heroesGame();
    own(s, 's0', [16]);
    expect(spaceActions(s, 's0', 16)).toBeNull();
  });
});

describe('location deeds', () => {
  it('prints the power-up, doubled for the colour pair, and the villain: no houses, no mortgage', () => {
    const d = deedFor(HEROES, 16, null)!;
    expect(d.kind).toBe('street');
    expect(d.price).toBe(260);
    expect(d.villain).toBe('The Fang Legion');
    expect(d.rent.map((r) => [r.label, r.value])).toEqual([['Power-up', '150 Power'], ['With the colour pair', '300 Power']]);
    expect(d.costs).toEqual([]);
    expect(active(d.rent)).toEqual([]);
  });

  it('marks the power-up due now: none while the owner is in the Holding Cell', () => {
    const s = heroesGame();
    own(s, 's0', [16]);
    expect(active(deedFor(HEROES, 16, s)!.rent)).toEqual(['Power-up']);
    own(s, 's0', [15]);
    expect(active(deedFor(HEROES, 16, s)!.rent)).toEqual(['With the colour pair']);
    s.players.s0!.jail = { tries: 0 };
    s.players.s0!.pos = 7;
    expect(active(deedFor(HEROES, 16, s)!.rent)).toEqual([]);
  });

  it('describes Hero League\'s corners and card spaces', () => {
    const s = heroesGame();
    expect(spaceBlurb(HEROES, HEROES.spaces[0], s)).toBe('Collect 200 Power every time you land on or pass Rally Point, and your superpower is ready again.');
    expect(spaceBlurb(HEROES, HEROES.spaces[7], s)).toMatch(/^Just visiting, unless you were captured\. A captured hero pays the 50 Power fine/);
    expect(spaceBlurb(HEROES, HEROES.spaces[21], s)).toBe('Captured! Go directly to the Holding Cell. Do not pass Rally Point, do not collect 200 Power.');
    expect(spaceBlurb(HEROES, HEROES.spaces[5], s)).toMatch(/Villain Strike.*Dead Aim/);
    expect(spaceBlurb(HEROES, HEROES.spaces[14], s)).toBe('Rooftop Lookout: nothing happens here.');
  });
});

describe('settings and test hooks', () => {
  it('keeps a valid Reactions setting and drops anything else', () => {
    expect(normalizeSettings({}).reactions).toBe('all');
    expect(normalizeSettings({ reactions: 'mine' }).reactions).toBe('mine');
    expect(normalizeSettings({ reactions: 'never' }).reactions).toBe('never');
    expect(normalizeSettings({ reactions: 'sometimes' }).reactions).toBe('all');
  });

  it('reads rigged Hero-die faces by number, hero id or hero name', () => {
    expect(toHeroFaces(HEROES, [4, '2', 'stormLord', 'Sharpshot', 'velvet viper'])).toEqual([4, 2, 4, 6, 5]);
    expect(() => toHeroFaces(HEROES, [7])).toThrow(/Hero-die face/);
    expect(() => toHeroFaces(LANKA, [1])).toThrow(/Hero-die face/);
  });
});
