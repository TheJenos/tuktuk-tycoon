import { describe, expect, it } from 'vitest';
import { installGameHooks, toRigRoll, toRigRolls } from '../../testHooks';

describe('test hooks', () => {
  it('reads rigged throws as the tests write them', () => {
    expect(toRigRoll([3, 4])).toEqual([3, 4]);
    expect(toRigRoll([3, 4, 'bus'])).toEqual([3, 4, 'bus']);
    expect(toRigRoll([2, 2, 'mr'])).toEqual([2, 2, 'uncle']);
    expect(toRigRoll(['1', '2', '3'])).toEqual([1, 2, 3]);
    expect(() => toRigRoll([1, 2, 'x'])).toThrow(/speed die face/);
    expect(toRigRolls([1, 2])).toEqual([[1, 2]]);
    expect(toRigRolls([[1, 1], [2, 3, 'uncle']])).toEqual([[1, 1], [2, 3, 'uncle']]);
  });

  it('installs nothing without a window', () => {
    const off = installGameHooks({} as never);
    expect(typeof off).toBe('function');
    off();
  });
});
