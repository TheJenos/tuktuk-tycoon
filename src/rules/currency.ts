import { LANKA } from '../boards/lanka/rules';

/*
 * The display scale for money. The engine counts rulebook units (start 1500, prices 60..400, rents, fines, bids,
 * trade cash); everything a player sees or types is that amount times MONEY_SCALE, in Sri Lankan rupees: 1500 units
 * read "Rs. 150,000". Only the edges (formatting and money inputs) convert; state, events, bots and saves stay in
 * units.
 */

export const MONEY_SYMBOL: string = LANKA.display.currency.symbol;
export const MONEY_SCALE: number = LANKA.display.currency.scale;

export interface MoneyOpts {
  /** "+Rs. 200" for gains (losses always read "−Rs. 350", zero "Rs. 0") */
  signed?: boolean;
}

/** Engine units as shown rupees: 1500 -> "Rs. 150,000"; negative amounts read "−Rs. 35,000" (a real minus sign) */
export function formatMoney(units: number, opts: MoneyOpts = {}): string {
  const abs = Math.abs(Math.round(units * MONEY_SCALE)).toLocaleString('en-US');
  if (units < 0 && abs !== '0') return `−${MONEY_SYMBOL} ${abs}`;
  return `${opts.signed && units > 0 ? '+' : ''}${MONEY_SYMBOL} ${abs}`;
}

/** Rupees shown or typed -> engine units, rounded to the nearest unit (Rs. 6,049 -> 60) */
export const toUnits = (rupees: number): number => Math.round(rupees / MONEY_SCALE);

/** Engine units -> rupees as a plain number (for inputs): 60 -> 6000 */
export const toRupees = (units: number): number => units * MONEY_SCALE;
