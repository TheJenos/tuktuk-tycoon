import { describe, expect, it } from 'vitest';
import { splitMoney } from '../hud/logText';

describe('splitMoney', () => {
  it('picks out every amount, with its sign', () => {
    expect(splitMoney('Ann pays Bob Rs. 5,000 rent for Maradana Lane')).toEqual([
      { text: 'Ann pays Bob ' },
      { text: 'Rs. 5,000', money: 'plain' },
      { text: ' rent for Maradana Lane' },
    ]);
    expect(splitMoney('+Rs. 20,000 and −Rs. 350').filter((p) => p.money).map((p) => p.money)).toEqual(['plus', 'minus']);
  });

  it('leaves lines without money alone', () => {
    expect(splitMoney('Ann rolls 3 + 4')).toEqual([{ text: 'Ann rolls 3 + 4' }]);
  });
});
