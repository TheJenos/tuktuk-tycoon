import { DEFAULT_CURRENCY, type Currency } from '../../../rules';

/*
 * Splits a log line into plain text and money amounts ("Rs. 1,500", "+Rs. 200", "−Rs. 350", or with Hero League's
 * currency "1,500 Power", "+200 Power"), so the log can highlight prices. Pure, for tests.
 */

export type LogPart = { text: string; money?: 'plus' | 'minus' | 'plain' };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** An amount in this currency, its sign included: the symbol before the number, or after it */
function amountPattern(c: Currency): string {
  const symbol = escape(c.symbol);
  return c.after ? `[+−-]?[\\d,]+ ${symbol}` : `[+−-]?${symbol} [\\d,]+`;
}

export function splitMoney(line: string, currency: Currency = DEFAULT_CURRENCY): LogPart[] {
  const amount = amountPattern(currency);
  const split = new RegExp(`(${amount})`);
  const whole = new RegExp(`^${amount}$`);
  return line
    .split(split)
    .filter((t) => t !== '')
    .map((text) => {
      if (!whole.test(text)) return { text };
      const sign = text[0];
      return { text, money: sign === '+' ? 'plus' : sign === '−' || sign === '-' ? 'minus' : 'plain' };
    });
}
