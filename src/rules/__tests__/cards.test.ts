import { describe, expect, it } from 'vitest';
import type { GameState } from '../types';
import { act, cash, ofType, own, pos, rig, run, scenario, setCash, setPos, stack } from './helpers';

/** s0 on `from`, rolls (a, b) and draws `card` from the deck it lands on */
function drawFrom(s: GameState, from: number, dice: [number, number], deck: 'chance' | 'chest', card: string) {
  setPos(s, 's0', from);
  stack(s, deck, card);
  rig(s, dice);
  return act(s, 's0', { k: 'roll' });
}

describe('Chance and Community Chest', () => {
  it('Nearest Railroad: advances (collecting GO) and pays twice the rent', () => {
    const s = scenario();
    own(s, 's1', [5, 15]);
    const { state, events } = drawFrom(s, 33, [1, 2], 'chance', 'ch-rail1');
    expect(pos(state, 's0')).toBe(5);
    expect(ofType(events, 'salary')).toHaveLength(1);
    expect(ofType(events, 'cash').find((e) => e.why === 'rent')).toMatchObject({ from: 's0', to: 's1', amount: 100, space: 5 });
    expect(cash(state, 's0')).toBe(1500 + 200 - 100);
  });

  it('Nearest Railroad when unowned offers it for sale', () => {
    const { state } = drawFrom(scenario(), 3, [2, 2], 'chance', 'ch-rail2');
    expect(pos(state, 's0')).toBe(15);
    expect(state.phase).toEqual({ k: 'buy', space: 15 });
  });

  it('Nearest Utility when owned: a fresh throw x10, whatever the number owned', () => {
    const s = scenario();
    own(s, 's1', [28]);
    setPos(s, 's0', 15);
    stack(s, 'chance', 'ch-utility');
    rig(s, [3, 4], [2, 3]);
    const { state, events } = act(s, 's0', { k: 'roll' });
    expect(pos(state, 's0')).toBe(28);
    const dice = ofType(events, 'dice');
    expect(dice.map((d) => d.purpose)).toEqual(['move', 'utility']);
    expect(dice[1]).toMatchObject({ w: [2, 3], doubles: false, total: 5 });
    expect(ofType(events, 'cash').find((e) => e.why === 'rent')?.amount).toBe(50);
  });

  it('Nearest Utility when unowned offers it for sale', () => {
    const { state } = drawFrom(scenario(), 33, [2, 1], 'chance', 'ch-utility');
    expect(pos(state, 's0')).toBe(12);
    expect(state.phase).toEqual({ k: 'buy', space: 12 });
  });

  it('Go Back 3 resolves the new space: 36 -> 33 draws Community Chest, 7 -> 4 is Income Tax', () => {
    const s = scenario();
    stack(s, 'chest', 'cc-dubai');
    const a = drawFrom(s, 33, [1, 2], 'chance', 'ch-back3');
    expect(pos(a.state, 's0')).toBe(33);
    expect(ofType(a.events, 'move').map((m) => m.via)).toEqual(['dice', 'back']);
    expect(ofType(a.events, 'card').map((c) => c.cardId)).toEqual(['ch-back3', 'cc-dubai']);
    expect(cash(a.state, 's0')).toBe(1600);

    const b = drawFrom(scenario(), 4, [1, 2], 'chance', 'ch-back3');
    expect(pos(b.state, 's0')).toBe(4);
    expect(b.state.phase.k).toBe('incomeTax');
  });

  it('passing GO then drawing Advance to GO pays twice', () => {
    const { state, events } = drawFrom(scenario(), 39, [3, 5], 'chance', 'ch-go');
    expect(pos(state, 's0')).toBe(0);
    expect(ofType(events, 'salary')).toHaveLength(2);
    expect(cash(state, 's0')).toBe(1900);
  });

  it('pays salary on advance cards only when they pass GO', () => {
    const passes = (from: number, card: string): number => {
      const s = scenario();
      setPos(s, 's0', from - 3);
      stack(s, 'chance', card);
      rig(s, [1, 2]);
      return ofType(act(s, 's0', { k: 'roll' }).events, 'salary').length;
    };
    expect(passes(7, 'ch-negombo')).toBe(0);
    expect(passes(22, 'ch-negombo')).toBe(1);
    expect(passes(36, 'ch-negombo')).toBe(1);
    expect(passes(7, 'ch-galle')).toBe(0);
    expect(passes(22, 'ch-galle')).toBe(0);
    expect(passes(36, 'ch-galle')).toBe(1);
    expect(passes(22, 'ch-fort')).toBe(1);
    expect(passes(36, 'ch-fort')).toBe(1);
    for (const from of [7, 22, 36]) expect(passes(from, 'ch-penthouse')).toBe(0);
  });

  it('Go to Jail card: straight to jail, no salary even from 36', () => {
    const { state, events } = drawFrom(scenario(), 33, [1, 2], 'chance', 'ch-jail');
    expect(pos(state, 's0')).toBe(10);
    expect(state.players.s0?.jail).toEqual({ tries: 0 });
    expect(ofType(events, 'salary')).toHaveLength(0);
    expect(ofType(events, 'jail')[0]?.reason).toBe('card');
    expect(state.phase.k).toBe('postRoll');
  });

  it('puts a drawn card at the bottom; Get Out of Jail Free is kept, then returns to its own deck', () => {
    const s = scenario();
    const a = drawFrom(s, 4, [1, 2], 'chance', 'ch-dividend');
    expect(a.state.decks.chance.at(-1)).toBe('ch-dividend');
    expect(ofType(a.events, 'cardReturn')).toEqual([{ t: 'cardReturn', deck: 'chance', cardId: 'ch-dividend' }]);

    const b = drawFrom(scenario(), 4, [1, 2], 'chance', 'ch-goojf');
    expect(b.state.players.s0?.goojf).toEqual(['ch-goojf']);
    expect(b.state.decks.chance).not.toContain('ch-goojf');
    expect(ofType(b.events, 'card')[0]?.kept).toBe(true);
    expect(b.state.decks.chance).toHaveLength(15);
  });

  it('charges repairs per house and per hotel', () => {
    const s = scenario();
    own(s, 's0', [6, 8, 9], { level: 1 });
    own(s, 's0', [37, 39], { level: 5 });
    const a = drawFrom(s, 4, [1, 2], 'chance', 'ch-repairs');
    expect(cash(a.state, 's0')).toBe(1500 - (3 * 25 + 2 * 100));
    const s2 = scenario();
    own(s2, 's0', [6, 8, 9], { level: 1 });
    own(s2, 's0', [37, 39], { level: 5 });
    const b = drawFrom(s2, 14, [1, 2], 'chest', 'cc-repairs');
    expect(cash(b.state, 's0')).toBe(1500 - (3 * 40 + 2 * 115));
  });

  it('Chairman of the Board with too little cash opens a debt to every other player', () => {
    const s = scenario({ n: 3 });
    setCash(s, 's0', 80);
    own(s, 's0', [1]);
    const { state, events } = drawFrom(s, 4, [1, 2], 'chance', 'ch-chairman');
    expect(state.phase).toMatchObject({ k: 'debt', debtor: 's0', owed: { s1: 50, s2: 50 }, why: 'card' });
    expect(ofType(events, 'debt')[0]?.total).toBe(100);
    // Mortgaging Pettah Pavement (+Rs. 36) covers it: the debt settles by itself and the turn goes on.
    const after = act(state, 's0', { k: 'mortgage', space: 1 });
    expect(after.state.phase.k).toBe('postRoll');
    expect(ofType(after.events, 'debtPaid')).toHaveLength(1);
    expect([cash(after.state, 's0'), cash(after.state, 's1'), cash(after.state, 's2')]).toEqual([80 + 36 - 100, 1550, 1550]);
  });

  it('Wedding Gifts: a poor non-turn player becomes the debtor, the others pay in turn, then play goes on', () => {
    const s = scenario({ n: 3 });
    setCash(s, 's1', 20);
    own(s, 's1', [3]);
    const { state } = drawFrom(s, 14, [1, 2], 'chest', 'cc-wedding');
    expect(state.phase).toMatchObject({ k: 'debt', debtor: 's1', owed: { s0: 50 } });
    expect(cash(state, 's2')).toBe(1500);
    expect(state.pending.map((st) => st.k)).toEqual(['pay', 'afterRoll']);
    const { state: done } = run(state, ['s1', { k: 'mortgage', space: 3 }]);
    expect(done.phase.k).toBe('postRoll');
    expect([cash(done, 's0'), cash(done, 's1'), cash(done, 's2')]).toEqual([1600, 20 + 36 - 50, 1450]);
  });
});
