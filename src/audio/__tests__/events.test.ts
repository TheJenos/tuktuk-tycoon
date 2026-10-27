import { describe, expect, it } from 'vitest';
import { createGame, type GameEvent, type GameState, type SeatId } from '../../rules';
import { ANIM, hopMs } from '../../shared/timing';
import { cuesFor, pickInstant, reactionCue, type CueCtx } from '../events';

const ctx: CueCtx = { mine: ['s0'], tokens: true, dice: true, ownerOf: (space) => (space === 1 ? 's0' : 's1') };
const names = (ev: GameEvent, phase: 'start' | 'done' | 'instant', c = ctx, speed = 1) => cuesFor(ev, phase, speed, c).map((q) => q.name);

const dice = (seat: SeatId, purpose: 'order' | 'move' = 'move'): GameEvent => ({ t: 'dice', seat, purpose, w: [2, 3], doubles: false, triples: false, total: 5 });
const move = (seat: SeatId, n: number, via: 'roll' | 'jail' = 'roll'): GameEvent =>
  ({ t: 'move', seat, from: 0, to: n, path: Array.from({ length: n }, (_, i) => i + 1), via }) as GameEvent;

describe('cuesFor', () => {
  it('rolls the dice as they are thrown and lands them when they settle', () => {
    expect(names(dice('s0'), 'start')).toEqual(['dice-roll']);
    expect(names(dice('s0'), 'done')).toEqual(['dice-land']);
    expect(names(dice('s0', 'order'), 'start')).toEqual([]);
    // No 3D dice: only the landing
    expect(names(dice('s0'), 'start', { ...ctx, dice: false })).toEqual([]);
  });

  it("plays others' events quieter than mine", () => {
    const mine = cuesFor(dice('s0'), 'done', 1, ctx)[0]!;
    const theirs = cuesFor(dice('s1'), 'done', 1, ctx)[0]!;
    expect(theirs.gain).toBeLessThan(mine.gain ?? 1);
  });

  it('taps once per hop, timed with the walk, and quieter when fast', () => {
    const cues = cuesFor(move('s0', 5), 'start', 1, ctx);
    expect(cues).toHaveLength(5);
    const total = (hopMs(5) * 5) / 1000;
    expect(cues.at(-1)!.delay).toBeLessThan(total);
    expect(cues.at(-1)!.delay).toBeGreaterThan(total * 0.8);
    expect(cues[0]!.delay).toBeLessThan(cues[1]!.delay!);
    const fast = cuesFor(move('s0', 5), 'start', 2, ctx);
    expect(fast.at(-1)!.delay).toBeCloseTo(cues.at(-1)!.delay! / 2);
    expect(fast[0]!.gain).toBeLessThan(cues[0]!.gain!);
  });

  it('makes no hops without the 3D tokens, for the jump to jail, or when folded', () => {
    expect(names(move('s0', 5), 'start', { ...ctx, tokens: false })).toEqual([]);
    expect(names(move('s0', 5, 'jail'), 'start')).toEqual([]);
    expect(names(move('s0', 5), 'instant')).toEqual([]);
  });

  it('sounds money in and out for my seat, and softly between others', () => {
    const cash = (from: SeatId | 'bank', to: SeatId | 'bank', why = 'rent'): GameEvent => ({ t: 'cash', from, to, amount: 50, why, after: {} }) as GameEvent;
    expect(names(cash('s1', 's0'), 'done')).toEqual(['cash-in']);
    expect(names(cash('s0', 's1'), 'done')).toEqual(['cash-out']);
    expect(names(cash('bank', 's0', 'salary'), 'done')).toEqual(['cash-in']);
    expect(names(cash('bank', 's0', 'jackpot'), 'done')).toEqual(['jackpot']);
    expect(cuesFor(cash('s1', 's2'), 'done', 1, ctx)[0]!.gain).toBeLessThan(0.5);
    // The purchase itself sounds on the owner event
    expect(names(cash('s0', 'bank', 'buy'), 'done')).toEqual([]);
    expect(names(cash('s1', 's0'), 'start')).toEqual([]);
  });

  it('draws and flips a card, buys, builds, sells and mortgages', () => {
    expect(names({ t: 'card', seat: 's0', deck: 'chance', cardId: 'c1', text: 'x', kept: false }, 'start')).toEqual(['card-draw', 'card-flip']);
    expect(names({ t: 'owner', space: 1, to: 's0', via: 'buy' }, 'done')).toEqual(['buy']);
    expect(names({ t: 'owner', space: 1, to: 's0', via: 'auction' }, 'done')).toEqual([]);
    expect(names({ t: 'level', space: 1, from: 0, to: 1, bank: { houses: 31, hotels: 12 } }, 'done')).toEqual(['build']);
    expect(names({ t: 'level', space: 1, from: 2, to: 1, bank: { houses: 31, hotels: 12 } }, 'done')).toEqual(['sell']);
    expect(names({ t: 'mortgage', space: 3, on: true }, 'done')).toEqual(['mortgage']);
    // Someone else's building is quieter
    expect(cuesFor({ t: 'level', space: 3, from: 0, to: 1, bank: { houses: 31, hotels: 12 } }, 'done', 1, ctx)[0]!.gain).toBeLessThan(1);
  });

  it('covers the auction, jail, bankruptcy, my turn and the end', () => {
    expect(names({ t: 'auctionStart', lot: { k: 'prop', space: 1 }, eligible: [], queue: [] } as unknown as GameEvent, 'done')).toEqual(['auction-start']);
    expect(names({ t: 'bid', seat: 's1', amount: 10 }, 'done')).toEqual(['auction-bid']);
    expect(names({ t: 'auctionEnd', lot: { k: 'prop', space: 1 }, winner: 's1', amount: 10 } as unknown as GameEvent, 'done')).toEqual(['auction-sold']);
    expect(names({ t: 'jail', seat: 's0', reason: 'space' }, 'done')).toEqual(['jail']);
    expect(names({ t: 'jailExit', seat: 's0', how: 'doubles' }, 'done')).toEqual(['jail-free']);
    expect(names({ t: 'bankrupt', seat: 's1', to: 'bank', resigned: false }, 'done')).toEqual(['bankrupt']);
    expect(names({ t: 'turn', seat: 's0', no: 3 }, 'done')).toEqual(['turn']);
    expect(names({ t: 'turn', seat: 's1', no: 3 }, 'done')).toEqual([]);
    const over = (winner: SeatId): GameEvent => ({ t: 'over', winner, ranking: [], why: 'last' }) as unknown as GameEvent;
    expect(names(over('s0'), 'done')).toEqual(['win']);
    expect(names(over('s1'), 'done')).toEqual(['lose']);
    expect(names(over('s1'), 'done', { ...ctx, mine: [] })).toEqual(['win']);
  });
});

describe('Hero League cues', () => {
  const heroDie = (seat: SeatId): GameEvent => ({ t: 'heroDie', seat, face: 4, hero: 'stormLord', purpose: 'card', card: 'ch-swarm' });

  it('throws and lands the Hero die like the dice', () => {
    expect(names(heroDie('s0'), 'start')).toEqual(['dice-roll']);
    expect(names(heroDie('s0'), 'done')).toEqual(['dice-land']);
    expect(names(heroDie('s0'), 'start', { ...ctx, dice: false })).toEqual([]);
    expect(cuesFor(heroDie('s1'), 'done', 1, ctx)[0]!.gain).toBeLessThan(1);
  });

  it('plays a superpower as a jingle, and a ready one only for my seat', () => {
    expect(names({ t: 'power', seat: 's1', power: 'thunder', target: 's0' }, 'done')).toEqual(['jackpot']);
    expect(names({ t: 'power', seat: 's0', power: 'smash' }, 'start')).toEqual([]);
    expect(names({ t: 'powerReady', seat: 's0' }, 'done')).toEqual(['jail-free']);
    expect(names({ t: 'powerReady', seat: 's1' }, 'done')).toEqual([]);
  });

  it('taps once as a swapped hero lands, not per space', () => {
    const swap: GameEvent = { t: 'move', seat: 's0', from: 3, to: 17, path: [17], via: 'swap' };
    const cues = cuesFor(swap, 'start', 1, ctx);
    expect(cues.map((q) => q.name)).toEqual(['token-hop']);
    expect(cues[0]!.delay).toBeCloseTo((0.95 * ANIM.jump) / 1000);
    expect(cuesFor(swap, 'start', 2, ctx)[0]!.delay).toBeCloseTo((0.95 * ANIM.jump) / 2000);
    expect(names(swap, 'start', { ...ctx, tokens: false })).toEqual([]);
    expect(names(swap, 'done')).toEqual([]);
  });

  it('sounds every save as a purchase and a location lost to a villain as a sale', () => {
    for (const via of ['backup', 'free'] as const) expect(names({ t: 'owner', space: 4, to: 's1', via }, 'done')).toEqual(['buy']);
    expect(names({ t: 'owner', space: 4, from: 's0', via: 'villain' }, 'done')).toEqual(['sell']);
    expect(cuesFor({ t: 'owner', space: 4, from: 's1', via: 'villain' }, 'done', 1, ctx)[0]!.gain).toBeLessThan(1);
    expect(names({ t: 'owner', space: 4, from: 's0', via: 'bankrupt' }, 'done')).toEqual([]);
  });

  it('rings the bell when a reaction window opens (or opens again) for one of my seats', () => {
    const base = createGame({ board: 'heroes' }, [{ id: 's0', name: 'A' }, { id: 's1', name: 'B' }, { id: 's2', name: 'C' }], 1).state;
    const at = (since: number, open: SeatId[]): GameState => ({
      ...base,
      since,
      phase: { k: 'react', kind: 'thunder', seat: 's1', open, about: { k: 'move' }, then: { k: 'throwDone', seat: 's1' }, resume: { k: 'busy' } },
    });
    expect(reactionCue(base, at(5, ['s0', 's2']), ['s0'])).toMatchObject({ name: 'auction-start' });
    // Not mine, the same window still open (someone passed), or no window
    expect(reactionCue(base, at(5, ['s2']), ['s0'])).toBeNull();
    expect(reactionCue(at(5, ['s0', 's2']), at(5, ['s0']), ['s0'])).toBeNull();
    expect(reactionCue(at(5, ['s0']), base, ['s0'])).toBeNull();
    expect(reactionCue(null, null, ['s0'])).toBeNull();
    // A re-roll re-enters the window: asked again
    expect(reactionCue(at(5, ['s0']), at(9, ['s0']), ['s0'])).not.toBeNull();
  });
});

describe('pickInstant', () => {
  it('keeps the two most telling sounds of a folded batch, once each, with no delays', () => {
    const cues = [
      ...cuesFor(dice('s0'), 'instant', 1, ctx),
      ...cuesFor({ t: 'cash', from: 's0', to: 's1', amount: 5, why: 'rent', after: {} }, 'instant', 1, ctx),
      ...cuesFor({ t: 'cash', from: 's0', to: 's1', amount: 5, why: 'rent', after: {} }, 'instant', 1, ctx),
      ...cuesFor({ t: 'jail', seat: 's0', reason: 'space' }, 'instant', 1, ctx),
    ];
    const kept = pickInstant(cues);
    expect(kept.map((q) => q.name)).toEqual(['jail', 'cash-out']);
    expect(kept.every((q) => q.delay === undefined)).toBe(true);
    expect(pickInstant([])).toEqual([]);
  });
});
