import { hasBoard } from './board';
import type { RulesConfig } from './types';

/** Bumped whenever the state shape or a rule changes, so old saves and rooms are recognised */
export const RULES_VERSION = 4;
/**
 * Older versions whose states decode() upgrades as they are: version 3 has the same state shape (4 changed rules
 * only: offers no longer expire, fixed auction countdowns, selling property to the bank, bankruptcy to a player).
 */
export const UPGRADABLE_VERSIONS: readonly number[] = [3];

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
  doubleGoLanding: false,
  jackpot: false,
  incomeTaxMode: 'choice',
  auctions: true,
  buyAfterFirstLap: false,
  jailRent: true,
  threeDoublesJail: true,
  dealProperties: 0,
  endMode: 'lastStanding',
  trading: 'on',
  tradeAfterLap: 1,
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
  dealProperties: [0, 3],
  tradeAfterLap: [1, 20],
};

/** Boolean fields */
const BOOLS = [
  'speedDie',
  'triplesRollAgain',
  'doubleGoLanding',
  'jackpot',
  'auctions',
  'buyAfterFirstLap',
  'jailRent',
  'threeDoublesJail',
  'debug',
] as const satisfies readonly (keyof RulesConfig)[];

/** String enum fields and their allowed values */
const ENUMS = {
  incomeTaxMode: ['choice', 'flat', 'percent'],
  endMode: ['lastStanding', 'firstBankrupt'],
  trading: ['on', 'off', 'afterLap'],
} as const satisfies { [K in keyof RulesConfig]?: readonly RulesConfig[K][] };

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
  for (const key of BOOLS) out[key] = bool(r[key], DEFAULT_RULES[key]);
  for (const key of Object.keys(ENUMS) as (keyof typeof ENUMS)[]) {
    const v = r[key];
    (out as Record<string, unknown>)[key] = (ENUMS[key] as readonly unknown[]).includes(v) ? v : DEFAULT_RULES[key];
  }
  out.board = typeof r.board === 'string' && hasBoard(r.board) ? r.board : DEFAULT_RULES.board;
  return out;
}
