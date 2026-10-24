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
      doubleGoLanding: false,
      jackpot: false,
      incomeTaxMode: 'choice',
      auctions: true,
      buyAfterFirstLap: false,
      jailRent: true,
      threeDoublesJail: true,
      dealProperties: 0,
      endMode: 'lastStanding',
      trading: 'on',
      tradeAfterLap: 1,
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

  it('keeps the optional rules, clamps their numbers and drops unknown enum values', () => {
    const all = {
      doubleGoLanding: true,
      jackpot: true,
      incomeTaxMode: 'percent',
      auctions: false,
      buyAfterFirstLap: true,
      jailRent: false,
      threeDoublesJail: false,
      dealProperties: 2,
      endMode: 'firstBankrupt',
      trading: 'afterLap',
      tradeAfterLap: 3,
    } as const;
    expect(normalizeConfig(all)).toMatchObject(all);
    expect(normalizeConfig({ dealProperties: 9 }).dealProperties).toBe(3);
    expect(normalizeConfig({ dealProperties: -1 }).dealProperties).toBe(0);
    expect(normalizeConfig({ tradeAfterLap: 0 }).tradeAfterLap).toBe(1);
    expect(normalizeConfig({ tradeAfterLap: 99 }).tradeAfterLap).toBe(20);
    const junk = { incomeTaxMode: 'half', endMode: 'never', trading: true, jackpot: 'yes', auctions: 0 } as unknown as Partial<
      typeof DEFAULT_RULES
    >;
    expect(normalizeConfig(junk)).toMatchObject({
      incomeTaxMode: 'choice',
      endMode: 'lastStanding',
      trading: 'on',
      jackpot: false,
      auctions: true,
    });
  });
});
