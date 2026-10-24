import { describe, expect, it } from 'vitest';
import { rentFor } from '..';
import type { GameState } from '../types';
import { act, cash, ofType, own, rig, scenario, setCash, setPos } from './helpers';

/** s0 rolls onto `space` from 4 spaces before it (no doubles) and pays whatever is due */
function visit(s: GameState, space: number): ReturnType<typeof act> {
  setPos(s, 's0', (space - 4 + 40) % 40);
  rig(s, [1, 3]);
  return act(s, 's0', { k: 'roll' });
}
const rentPaid = (r: ReturnType<typeof act>): number =>
  ofType(r.events, 'cash')
    .filter((e) => e.why === 'rent')
    .reduce((a, e) => a + e.amount, 0);

describe('rent', () => {
  it('charges the base rent, doubled for a complete group', () => {
    const s = scenario();
    own(s, 's1', [1]);
    expect(rentFor(s, 1)).toBe(2);
    own(s, 's1', [3]);
    expect(rentFor(s, 1)).toBe(4);
    expect(rentPaid(visit(s, 1))).toBe(4);
  });

  it('still doubles with a mortgaged sibling; a mortgaged property charges nothing', () => {
    const s = scenario();
    own(s, 's1', [1]);
    own(s, 's1', [3], { mortgaged: true });
    expect(rentFor(s, 1)).toBe(4);
    expect(rentFor(s, 3)).toBe(0);
    expect(rentPaid(visit(structuredClone(s), 3))).toBe(0);
  });

  it('doubles an unimproved street whose siblings have houses', () => {
    const s = scenario();
    own(s, 's1', [16, 18], { level: 1 });
    own(s, 's1', [19]);
    expect(rentFor(s, 19)).toBe(32);
    expect(rentFor(s, 16)).toBe(70);
  });

  it('charges the house and hotel rents', () => {
    const s = scenario();
    own(s, 's1', [37, 39], { level: 4 });
    expect(rentFor(s, 39)).toBe(1700);
    s.props.p37!.level = 5;
    s.props.p39!.level = 5;
    s.bank.hotels -= 2;
    s.bank.houses += 8;
    expect(rentFor(s, 39)).toBe(2000);
    for (const [level, want] of [
      [1, 200],
      [2, 600],
      [3, 1400],
    ] as const) {
      s.props.p39!.level = level;
      expect(rentFor(s, 39)).toBe(want);
    }
  });

  it('charges railroads 25/50/100/200, mortgaged ones counted', () => {
    const s = scenario();
    own(s, 's1', [5]);
    expect(rentFor(s, 5)).toBe(25);
    own(s, 's1', [15], { mortgaged: true });
    expect(rentFor(s, 5)).toBe(50);
    own(s, 's1', [25]);
    expect(rentFor(s, 5)).toBe(100);
    own(s, 's1', [35]);
    expect(rentFor(s, 35)).toBe(200);
  });

  it('charges utilities 4x or 10x the dice', () => {
    const s = scenario();
    own(s, 's1', [12]);
    expect(rentFor(s, 12, { dice: 7 })).toBe(28);
    own(s, 's1', [28]);
    expect(rentFor(s, 12, { dice: 7 })).toBe(70);
    setPos(s, 's0', 8);
    rig(s, [1, 3]);
    expect(rentPaid(act(s, 's0', { k: 'roll' }))).toBe(40);
  });

  it('pays an owner who is in jail; nothing on your own property', () => {
    const s = scenario();
    own(s, 's1', [21]);
    s.players.s1!.jail = { tries: 1 };
    s.players.s1!.pos = 10;
    const r = visit(s, 21);
    expect(rentPaid(r)).toBe(18);
    expect(cash(r.state, 's1')).toBe(1518);
    const mine = scenario();
    own(mine, 's0', [21]);
    expect(rentPaid(visit(mine, 21))).toBe(0);
  });

  it('opens a debt when the rent cannot be paid', () => {
    const s = scenario();
    own(s, 's1', [39], { level: 1 });
    own(s, 's1', [37], { level: 1 });
    setCash(s, 's0', 50);
    own(s, 's0', [1]);
    const r = visit(s, 39);
    expect(r.state.phase).toMatchObject({ k: 'debt', debtor: 's0', owed: { s1: 200 }, why: 'rent' });
  });
});
