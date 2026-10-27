import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../../rules';
import { saveTarget } from '../board/saveTarget';

const log = (...evs: GameEvent[]) => evs.map((ev, i) => ({ seq: i, ev }));
const land: GameEvent = { t: 'land', seat: 's0', space: 16 };
const thrown = (face: number, purpose: 'backup' | 'card' = 'backup'): GameEvent => ({ t: 'heroDie', seat: 's0', face, hero: 'stormLord', purpose });

describe("A back-up hero's location", () => {
  it('is marked from the Hero die until the save', () => {
    expect(saveTarget(log(land))).toBeNull();
    expect(saveTarget(log(land, thrown(4)))).toBe(16);
    // A Thunder Call re-roll, a window that timed out
    expect(saveTarget(log(land, thrown(4), { t: 'power', seat: 's2', power: 'thunder', target: 's0' }, thrown(2)))).toBe(16);
    expect(saveTarget(log(land, thrown(4), { t: 'reactTimeout', seats: ['s1'] }))).toBe(16);
    expect(saveTarget(log(land, thrown(4), { t: 'cash', from: 's1', to: 'bank', amount: 260, why: 'buy', after: { s1: 1240 } }))).toBeNull();
    expect(saveTarget(log(land, thrown(4), { t: 'noSave', seat: 's0', space: 16 }))).toBeNull();
  });

  it("marks nothing for a card's Hero die or on other boards", () => {
    expect(saveTarget(log(land, thrown(4, 'card')))).toBeNull();
    expect(saveTarget(log(land, { t: 'dice', seat: 's0', purpose: 'move', w: [3, 4], doubles: false, triples: false, total: 7 }))).toBeNull();
    expect(saveTarget([])).toBeNull();
  });
});
