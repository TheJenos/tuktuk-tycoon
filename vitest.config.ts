import { defineConfig } from 'vitest/config';

// Unit tests: pure code (rules engine, bots, net over MemoryDb) in Node. The game itself is tested
// end to end (e2e/).
export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
  },
});
