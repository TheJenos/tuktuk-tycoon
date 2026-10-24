import type { BotSkill } from '../net/types';

/*
 * What separates the skill levels: a handful of numbers read by the policies. Easy is sloppy and greedy, Normal
 * plays sound rules of thumb, Hard values everything by landing probability and plays the housing shortage, Expert
 * plays Hard's rules wherever it does not search (search > 0: see search.ts).
 */

export interface Profile {
  skill: BotSkill;
  /** Value squares by the landing table (else every square is equally likely) */
  weighted: boolean;
  /** Cash kept back: base + share of the expected and of the worst rent one throw away */
  reserveBase: number;
  reserveExp: number;
  reserveMax: number;
  /** Hard and up: most it bids for a set or blocking piece, as a multiple of the price (other lots: 3/4 of it) */
  auctionCap: number;
  /** Bid increments as a share of the printed price, clamped to [stepMin, stepMax] */
  stepShare: number;
  stepMin: number;
  stepMax: number;
  /** Hold groups at 4 houses while an opponent has a set it could build on (keeps the bank short) */
  holdAtFour: boolean;
  /** Mortgage lone property to get sets to 3 houses quickly */
  fundBuilds: boolean;
  /** Trades: never propose, propose set-for-set swaps, or swaps with property and cash sweeteners */
  propose: 'never' | 'swap' | 'full';
  /** Propose on every n-th own turn at most */
  tradeEvery: number;
  /** Accept an offer when the gain is at least this share of what the bot gives up */
  acceptGain: number;
  /** Weight of an opponent's gain against the bot's own when judging a trade (Hard: zero-sum thinking) */
  rivalWeight: number;
  /** Engine commands of Monte-Carlo search per decision (0 = none; see search.ts and rollout.ts) */
  search: number;
  /** Weight of the rollout estimate of a bank property against the heuristic valuation */
  rolloutWeight: number;
}

export const PROFILES: Record<BotSkill, Profile> = {
  easy: {
    skill: 'easy',
    weighted: false,
    reserveBase: 0,
    reserveExp: 0,
    reserveMax: 0,
    auctionCap: 2,
    stepShare: 0.08,
    stepMin: 5,
    stepMax: 25,
    holdAtFour: false,
    fundBuilds: false,
    propose: 'never',
    tradeEvery: 1,
    acceptGain: 0.3,
    rivalWeight: 0,
    search: 0,
    rolloutWeight: 0,
  },
  normal: {
    skill: 'normal',
    weighted: false,
    reserveBase: 75,
    reserveExp: 1,
    reserveMax: 0.25,
    auctionCap: 2,
    stepShare: 0.05,
    stepMin: 5,
    stepMax: 10,
    holdAtFour: false,
    fundBuilds: false,
    propose: 'swap',
    tradeEvery: 4,
    acceptGain: 0.1,
    rivalWeight: 0.3,
    search: 0,
    rolloutWeight: 0,
  },
  hard: {
    skill: 'hard',
    weighted: true,
    reserveBase: 50,
    reserveExp: 1.5,
    reserveMax: 0.35,
    auctionCap: 2,
    stepShare: 0.03,
    stepMin: 1,
    stepMax: 10,
    holdAtFour: true,
    fundBuilds: true,
    propose: 'full',
    tradeEvery: 3,
    acceptGain: 0.02,
    rivalWeight: 1,
    search: 0,
    rolloutWeight: 0,
  },
  expert: {
    skill: 'expert',
    weighted: true,
    reserveBase: 50,
    reserveExp: 1.5,
    reserveMax: 0.35,
    auctionCap: 2,
    stepShare: 0.03,
    stepMin: 1,
    stepMax: 10,
    holdAtFour: true,
    fundBuilds: true,
    propose: 'full',
    tradeEvery: 3,
    acceptGain: 0.02,
    rivalWeight: 1,
    search: 400,
    rolloutWeight: 0.5,
  },
};

export const profileOf = (skill: BotSkill): Profile => PROFILES[skill] ?? PROFILES.normal;
