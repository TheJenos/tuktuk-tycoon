/*
 * The bank's rates, as shares of a property's printed price (every board's): a mortgage pays out 60% (lifting it
 * repays that plus interest), and the bank buys a property back for 80%. Selling therefore raises more than
 * mortgaging, at the cost of the deed.
 */

/** What a mortgage pays out */
export const MORTGAGE_RATE = 0.6;
/** What the bank pays for a property sold back to it */
export const SALE_RATE = 0.8;

/** A property's mortgage value (board data) */
export const mortgageOf = (price: number): number => Math.round(price * MORTGAGE_RATE);
/** What the bank pays for an unmortgaged property */
export const saleOf = (price: number): number => Math.round(price * SALE_RATE);
