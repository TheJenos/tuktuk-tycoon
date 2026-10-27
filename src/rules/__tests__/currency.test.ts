import { describe, expect, it } from 'vitest';
import { LANKA, MONEY_SCALE, formatMoney, toRupees, toUnits } from '..';

describe('currency display scale', () => {
  it('shows engine units as rupees x100', () => {
    expect(LANKA.display.currency).toEqual({ symbol: 'Rs.', scale: 100 });
    expect(MONEY_SCALE).toBe(100);
    expect(formatMoney(1500)).toBe('Rs. 150,000');
    expect(formatMoney(400)).toBe('Rs. 40,000');
    expect(formatMoney(83)).toBe('Rs. 8,300');
    expect(formatMoney(0)).toBe('Rs. 0');
    expect(formatMoney(-350)).toBe('−Rs. 35,000');
    expect(formatMoney(200, { signed: true })).toBe('+Rs. 20,000');
    expect(formatMoney(-50, { signed: true })).toBe('−Rs. 5,000');
    expect(formatMoney(0, { signed: true })).toBe('Rs. 0');
    expect(formatMoney(1500, { bare: true })).toBe('150,000');
    expect(formatMoney(200, { signed: true, bare: true })).toBe('+20,000');
  });

  it('converts typed rupees to the nearest unit', () => {
    expect(toUnits(6000)).toBe(60);
    expect(toUnits(6049)).toBe(60);
    expect(toUnits(6050)).toBe(61);
    expect(toUnits(0)).toBe(0);
    expect(toRupees(60)).toBe(6000);
  });
});
