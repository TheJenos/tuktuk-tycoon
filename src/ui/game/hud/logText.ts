/*
 * Splits a log line into plain text and money amounts ("Rs. 1,500", "+Rs. 200", "−Rs. 350"), so the log can
 * highlight prices. Pure, for tests.
 */

export type LogPart = { text: string; money?: 'plus' | 'minus' | 'plain' };

const MONEY = /([+−-]?Rs\. [\d,]+)/;

export function splitMoney(line: string): LogPart[] {
  return line
    .split(MONEY)
    .filter((t) => t !== '')
    .map((text) => {
      if (!MONEY.test(text) || !/^[+−-]?Rs\. [\d,]+$/.test(text)) return { text };
      const sign = text[0];
      return { text, money: sign === '+' ? 'plus' : sign === '−' || sign === '-' ? 'minus' : 'plain' };
    });
}
