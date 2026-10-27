import {
  apply,
  awaiting,
  defaultAction,
  legalActions,
  tradingClosed,
  type Action,
  type GameState,
  type SeatId,
} from '../rules';
import type { BotSkill } from '../net/types';
import { auctionChoice } from './auction';
import { claimChoice, placeChoice, postRollChoice, xferChoice } from './build';
import { type BotCtx, type BotTable, makeCtx } from './ctx';
import { debtChoice } from './debt';
import { profileOf } from './profile';
import { searchDebt, searchJail, searchPostRoll, searchProposal, searchRespond } from './search';
import { proposal, respond, staleOffer } from './trade';
import { buyChoice, busChoice, chooseSpaceChoice, incomeTaxChoice, jailChoice } from './turn';

/*
 * The bot's entry point. choose() picks an action from the policies; decide() checks it against the engine (a
 * throwaway apply) and falls back to the engine's safe default, so whatever a policy gets wrong, the driver is
 * only ever handed an action the engine accepts right now.
 */

/** Phases in which an offer may be accepted (mirrors the engine) */
const ACCEPT_PHASES = new Set(['preRoll', 'postRoll', 'buy', 'debt']);

/** The policies' choice, unchecked (null: nothing to do now) */
export function choose(c: BotCtx): Action | null {
  const s = c.s;
  // Expert searches where it matters (search.ts); every other choice is Hard's
  const deep = c.prof.search > 0;
  // Offers first: a reject is always allowed, an accept waits for a calm phase
  for (const id of Object.keys(s.trades).sort()) {
    const t = s.trades[id];
    if (!t || t.to !== c.seat) continue;
    // The trading rule would refuse it anyway (cannot normally happen: such offers are never made)
    if (tradingClosed(s, t.from, t.to)) return { k: 'reject', id };
    const calm = ACCEPT_PHASES.has(s.phase.k);
    if ((deep ? searchRespond(c, t, calm) : respond(c, t)) === 'reject') return { k: 'reject', id };
    if (calm) return { k: 'accept', id };
  }
  if (!awaiting(s).includes(c.seat)) return null;
  // Offers never expire: withdraw its own when it went stale (before proposing anything new)
  const stale = staleOffer(c);
  if (stale) return stale;
  const ph = s.phase;
  switch (ph.k) {
    case 'preRoll':
      return deep ? (searchProposal(c) ?? searchJail(c)) : (proposal(c) ?? jailChoice(c));
    case 'bus':
      return busChoice(c, ph.opts);
    case 'chooseSpace':
      return chooseSpaceChoice(c);
    case 'buy':
      return buyChoice(c, ph.space);
    case 'incomeTax':
      return incomeTaxChoice(c);
    case 'postRoll':
      return deep ? searchPostRoll(c) : postRollChoice(c);
    case 'auction':
      return auctionChoice(c, ph);
    case 'buildClaim':
      return claimChoice(c, ph);
    case 'place':
      return placeChoice(c, ph.kind);
    case 'mortgageXfer':
      return xferChoice(c, ph);
    case 'debt':
      return deep ? searchDebt(c, ph) : debtChoice(c, ph);
    default:
      return null;
  }
}

/** The engine would accept `a` from `seat` now */
export const accepted = (s: GameState, seat: SeatId, a: Action): boolean =>
  apply(s, { by: seat, a, basis: s.seq }, { check: false }).ok;

/** A safe action for an awaited seat when the policy's choice was refused */
export function fallback(s: GameState, seat: SeatId): Action | null {
  const d = defaultAction(s, seat);
  if (d && accepted(s, seat, d)) return d;
  if (!awaiting(s).includes(seat)) return null;
  return legalActions(s, seat).find((a) => a.k !== 'resign') ?? null;
}

export interface Decision {
  action: Action | null;
  /** The policy's own choice was refused (or threw) and a fallback was used instead */
  fellBack: boolean;
  /** What went wrong, for tests and the sim */
  problem?: string;
}

/** decide() with a report of whether the policy's own choice was used */
export function decideDetailed(s: GameState, seat: SeatId, skill: BotSkill, rnd: () => number, table: BotTable = {}): Decision {
  if (s.phase.k === 'over') return { action: null, fellBack: false };
  // Neither awaited nor offered anything: nothing to do (and no model to build)
  if (!awaiting(s).includes(seat) && !Object.values(s.trades).some((t) => t.to === seat)) {
    return { action: null, fellBack: false };
  }
  const c = makeCtx(s, seat, profileOf(skill), rnd, table);
  if (!c) return { action: null, fellBack: false };
  let a: Action | null;
  try {
    a = choose(c);
  } catch (e) {
    const problem = `threw: ${e instanceof Error ? e.message : String(e)}`;
    return { action: fallback(s, seat), fellBack: true, problem };
  }
  if (a === null) {
    // A seat the game waits for must always act
    if (!awaiting(s).includes(seat)) return { action: null, fellBack: false };
    return { action: fallback(s, seat), fellBack: true, problem: `no choice in ${s.phase.k}` };
  }
  const r = apply(s, { by: seat, a, basis: s.seq }, { check: false });
  if (r.ok) return { action: a, fellBack: false };
  // An offer that can no longer go through is simply declined
  if (a.k === 'accept') {
    const no: Action = { k: 'reject', id: a.id };
    if (accepted(s, seat, no)) return { action: no, fellBack: false };
  }
  const problem = `refused ${JSON.stringify(a)}: ${r.error.code} ${r.error.message}`;
  return { action: fallback(s, seat), fellBack: true, problem };
}
