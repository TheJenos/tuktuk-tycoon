import { hasBoard } from './board';
import type { RulesConfig } from './types';

/** Bumped whenever the state shape or a rule changes, so old saves and rooms are recognised */
export const RULES_VERSION = 2;

export const DEFAULT_RULES: RulesConfig = {
  board: 'lanka',
  speedDie: false,
  startCash: 1500,
  speedBonus: 1000,
  goSalary: 200,
  incomeFlat: 200,
  incomePct: 10,
  luxuryTax: 75,
  jailFine: 50,
  houses: 32,
  hotels: 12,
  mortgagePct: 10,
  triplesRollAgain: true,
  turnLimit: 0,
  debug: false,
};

/** Integer fields and their [min, max] */
const RANGES: { [K in keyof RulesConfig]?: [number, number] } = {
  startCash: [0, 100_000],
  speedBonus: [0, 100_000],
  goSalary: [0, 10_000],
  incomeFlat: [0, 10_000],
  incomePct: [0, 100],
  luxuryTax: [0, 10_000],
  jailFine: [0, 10_000],
  houses: [0, 200],
  hotels: [0, 100],
  mortgagePct: [0, 100],
  turnLimit: [0, 100_000],
};

const int = (v: unknown, fallback: number, [min, max]: [number, number]): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;

const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

/** A complete, clamped config from anything (a lobby record, an old save, a partial override) */
export function normalizeConfig(raw?: Partial<RulesConfig> | null): RulesConfig {
  const r = (raw ?? {}) as Record<string, unknown>;
  const out = { ...DEFAULT_RULES };
  for (const key of Object.keys(RANGES) as (keyof RulesConfig)[]) {
    const range = RANGES[key];
    if (range) (out as Record<string, unknown>)[key] = int(r[key], DEFAULT_RULES[key] as number, range);
  }
  out.speedDie = bool(r.speedDie, DEFAULT_RULES.speedDie);
  out.triplesRollAgain = bool(r.triplesRollAgain, DEFAULT_RULES.triplesRollAgain);
  out.debug = bool(r.debug, DEFAULT_RULES.debug);
  out.board = typeof r.board === 'string' && hasBoard(r.board) ? r.board : DEFAULT_RULES.board;
  return out;
}
