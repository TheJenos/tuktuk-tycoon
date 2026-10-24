import { describe, expect, it } from 'vitest';

// Proves the runner finds and type-strips tests under src/**/__tests__; the real suites arrive
// with the rules engine.
describe('test runner', () => {
  it('runs TypeScript tests in Node', () => {
    const sides: readonly number[] = [10, 10, 10, 10];
    expect(sides.reduce((sum, n) => sum + n, 0)).toBe(40);
  });
});
