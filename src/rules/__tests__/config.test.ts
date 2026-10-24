import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, normalizeConfig } from '..';

describe('normalizeConfig', () => {
  it('fills defaults', () => {
    expect(normalizeConfig()).toEqual(DEFAULT_RULES);
    expect(normalizeConfig(null)).toEqual(DEFAULT_RULES);
    expect(DEFAULT_RULES).toMatchObject({
      startCash: 1500,
      speedBonus: 1000,
      goSalary: 200,
      incomeFlat: 200,
      incomePct: 10,
      luxuryTax: 75,
      jailFine: 50,
      houses: 32,
      hotels: 12,
      mortgagePct: 10,
      triplesRollAgain: true,
      turnLimit: 0,
      debug: false,
      speedDie: false,
    });
  });

  it('accepts any number in range and clamps the rest', () => {
    expect(normalizeConfig({ luxuryTax: 100 }).luxuryTax).toBe(100);
    expect(normalizeConfig({ startCash: 2000 }).startCash).toBe(2000);
    expect(normalizeConfig({ startCash: -5 }).startCash).toBe(0);
    expect(normalizeConfig({ incomePct: 250 }).incomePct).toBe(100);
    expect(normalizeConfig({ houses: 12.6 }).houses).toBe(13);
    expect(normalizeConfig({ jailFine: Number.NaN }).jailFine).toBe(50);
    expect(normalizeConfig({ turnLimit: 'x' as unknown as number }).turnLimit).toBe(0);
  });

  it('keeps booleans and known boards only', () => {
    expect(normalizeConfig({ speedDie: true, triplesRollAgain: false, debug: true })).toMatchObject({
      speedDie: true,
      triplesRollAgain: false,
      debug: true,
    });
    expect(normalizeConfig({ speedDie: 'yes' as unknown as boolean }).speedDie).toBe(false);
    expect(normalizeConfig({ board: 'mars' }).board).toBe('lanka');
  });
});
