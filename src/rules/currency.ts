import { LANKA } from '../boards/lanka/rules';
import { getBoard } from './board';
import type { BoardDef, Currency } from './types';

/*
 * The display scale for money. The engine counts rulebook units (start 1500, prices 60..400, rents, fines, bids,
 * trade cash); everything a player sees or types is that amount times the board's `display.currency.scale`, with its
 * symbol: on the classic boards Sri Lankan rupees at x100 (1500 units read "Rs. 150,000"), on Hero League "Power" at
 * x1 after the number ("1,500 Power"). Only the edges (formatting and money inputs) convert; state, events, bots and
 * saves stay in units. Without a currency the helpers use All Island's.
 */

/** All Island's currency (the classic boards'): the default of every helper here */
export const DEFAULT_CURRENCY: Currency = LANKA.display.currency;
export const MONEY_SCALE: number = DEFAULT_CURRENCY.scale;

export interface MoneyOpts {
  /** "+Rs. 200" for gains (losses always read "−Rs. 350", zero "Rs. 0") */
  signed?: boolean;
  /** The amount without the symbol: "6,000" for Rs. 6,000, "60" for 60 Power (the sign as above) */
  bare?: boolean;
}

/** A board's currency */
export const currencyOf = (b: BoardDef): Currency => b.display.currency;

/**
 * Engine units as shown money: 1500 -> "Rs. 150,000" (or "1,500 Power" with Hero League's currency); negative amounts
 * read "−Rs. 35,000" / "−50 Power" (a real minus sign)
 */
export function formatMoney(units: number, opts: MoneyOpts = {}, currency: Currency = DEFAULT_CURRENCY): string {
  const abs = Math.abs(Math.round(units * currency.scale)).toLocaleString('en-US');
  const sign = units < 0 && abs !== '0' ? '−' : opts.signed && units > 0 ? '+' : '';
  if (opts.bare) return `${sign}${abs}`;
  return currency.after ? `${sign}${abs} ${currency.symbol}` : `${sign}${currency.symbol} ${abs}`;
}

/** Engine units in a board's currency (the board or its id): `boardMoney('heroes', 1500)` is "1,500 Power" */
export const boardMoney = (b: BoardDef | string, units: number, opts: MoneyOpts = {}): string =>
  formatMoney(units, opts, currencyOf(typeof b === 'string' ? getBoard(b) : b));

/** Money shown or typed -> engine units, rounded to the nearest unit (Rs. 6,049 -> 60) */
export const toUnits = (shown: number, currency: Currency = DEFAULT_CURRENCY): number => Math.round(shown / currency.scale);

/** Engine units -> shown money as a plain number (for inputs): 60 -> 6000 rupees */
export const toShown = (units: number, currency: Currency = DEFAULT_CURRENCY): number => units * currency.scale;

/** Engine units -> rupees as a plain number (All Island's currency; see toShown) */
export const toRupees = (units: number): number => toShown(units);
