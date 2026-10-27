/*
 * mulberry32, with its whole state (one uint32) kept in the game state, so a replay of the same commands rolls the
 * same dice on every client. Integer arithmetic only, so every JS engine agrees.
 *
 * Only throws may call these: createGame (deck shuffles, the opening roll), `roll`, the Nearest Utility fresh throw, and
 * on Hero League the Hero die (a card's throws, a back-up throw) and Thunder Call re-rolls, each with its `dice` or
 * `heroDie` event. A player must not be able to change future dice by slipping in a free action (mortgage, trade, ...)
 * first; a Hero League answer that lets the next throw happen (a pass, a closed window) throws in deterministic order.
 */

export interface RngHolder {
  rng: number;
}

/** Scrambles any number into a non-zero uint32 starting state */
export function seedState(seed: number): number {
  let a = Math.imul((seed >>> 0) ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  a = Math.imul(a ^ (a >>> 13), 0xc2b2ae35) >>> 0;
  return (a ^ (a >>> 16)) >>> 0 || 0x6d2b79f5;
}

/** The next uint32 of the stream (advances holder.rng) */
export function nextU32(h: RngHolder): number {
  h.rng = (h.rng + 0x6d2b79f5) >>> 0;
  let t = h.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}

/** An integer 0 <= x < n, without modulo bias (rejection sampling) */
export function int(h: RngHolder, n: number): number {
  const limit = Math.floor(0x100000000 / n) * n;
  for (;;) {
    const x = nextU32(h);
    if (x < limit) return x % n;
  }
}

export const d6 = (h: RngHolder): number => int(h, 6) + 1;

/** Fisher-Yates, in place */
export function shuffle<T>(h: RngHolder, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = int(h, i + 1);
    const t = items[i] as T;
    items[i] = items[j] as T;
    items[j] = t;
  }
  return items;
}
