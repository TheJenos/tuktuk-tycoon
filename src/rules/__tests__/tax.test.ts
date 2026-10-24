import { describe, expect, it } from 'vitest';
import { defaultAction, incomeTaxAmounts, worth } from '..';
import type { GameState, RulesConfig } from '../types';
import { act, cash, own, rig, scenario, setCash, setPos } from './helpers';

function onIncomeTax(cfg: Partial<RulesConfig> = {}): GameState {
  const s = scenario({ cfg });
  setPos(s, 's0', 1);
  rig(s, [1, 2]);
  return act(s, 's0', { k: 'roll' }).state;
}

describe('taxes', () => {
  it('Income Tax asks first, then charges the flat Rs. 200', () => {
    const s = onIncomeTax();
    expect(s.phase.k).toBe('incomeTax');
    const after = act(s, 's0', { k: 'incomeTax', pick: 'flat' }).state;
    expect(cash(after, 's0')).toBe(1300);
    expect(after.phase.k).toBe('postRoll');
  });

  it('10% of worth counts mortgaged property at its price and a hotel as 5 houses, rounded down', () => {
    const s = onIncomeTax();
    setCash(s, 's0', 1005);
    own(s, 's0', [12], { mortgaged: true });
    own(s, 's0', [37, 39], { level: 5 });
    // 1005 cash + 150 + 350 + 400 printed + 2 hotels x 5 x 200
    expect(worth(s, 's0')).toBe(1005 + 150 + 350 + 400 + 2000);
    expect(incomeTaxAmounts(s, 's0')).toEqual({ flat: 200, percent: 390 });
    expect(cash(act(s, 's0', { k: 'incomeTax', pick: 'percent' }).state, 's0')).toBe(1005 - 390);
  });

  it('the timeout picks the cheaper option', () => {
    const s = onIncomeTax();
    setCash(s, 's0', 900);
    expect(defaultAction(s, 's0')).toEqual({ k: 'incomeTax', pick: 'percent' });
    setCash(s, 's0', 3000);
    expect(defaultAction(s, 's0')).toEqual({ k: 'incomeTax', pick: 'flat' });
  });

  it('Luxury Tax is Rs. 75, or Rs. 100 when configured', () => {
    for (const [luxuryTax, want] of [
      [undefined, 75],
      [100, 100],
    ] as const) {
      const s = scenario({ cfg: luxuryTax ? { luxuryTax } : {} });
      setPos(s, 's0', 35);
      rig(s, [1, 2]);
      const r = act(s, 's0', { k: 'roll' }).state;
      expect(cash(r, 's0')).toBe(1500 - want);
    }
  });
});
