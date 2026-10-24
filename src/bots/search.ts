import { apply, type Action, type Command, type DebtPhase, type GameState, type Trade } from '../rules';
import { manageChoice, postRollChoice } from './build';
import { type BotCtx, makeCtx } from './ctx';
import { type RaiseOpts, debtChoice, hopeless } from './debt';
import { type Profile } from './profile';
import { type Option, ask, play, room, stateKey } from './rollout';
import { offerGain, pricedOffers, proposal, proposalRound, respond } from './trade';
import { jailChoice } from './turn';

/*
 * Expert's decisions by search: where Hard follows one rule of thumb, Expert lays out a few whole plans (Hard's own
 * first), plays each ahead on the same dice with rollout.ts and keeps the one that leaves it standing best. Hard's
 * choice wins ties and near-ties (another must beat it by a margin), so noise in a small sample costs little. A
 * question lays out only as many plans as the budget can compare (see room()); the alternatives come in order:
 * - building: a leaner reserve, all in (no reserve, mortgaging lone property for houses), hotels instead of holding at
 *   4, nothing at all this turn;
 * - jail: pay (or use a card) and walk out, or stay and roll;
 * - debt: other orders of raising the cash (biggest mortgage first, buildings first);
 * - trades: offers priced against the bots' own acceptance rules (trade.ts), made only when a rollout says the deal
 *   beats no deal; offers received, accepted only when a rollout says so.
 * Where the budget cannot compare even two (a big table), Expert plays Hard's choice.
 */

/**
 * Share of a decision's budget a building, jail or debt question spends. Trades swing games the most and get all of
 * it; the others did as well on half (measured: the same win rate against Hard in half the time).
 */
const PLAN_SHARE = 0.5;
/** A plan must beat Hard's by this much (rupees of standing) to be preferred */
const MARGIN = 15;
/** A trade must beat no trade by this much */
const TRADE_MARGIN = 40;
/** Commands at most in one laid-out plan */
const PLAN_STEPS = 16;
/** Offers compared by rollouts at most */
const OFFERS = 3;

interface Plan {
  cmds: Command[];
  end: GameState;
}

/** Plays `policy` for the bot from the real position while `more` holds; the commands come out of the budget */
function planOf(c: BotCtx, prof: Profile, policy: (cc: BotCtx) => Action | null, more: (s: GameState) => boolean): Plan {
  let s = c.s;
  const cmds: Command[] = [];
  const quiet: Profile = { ...prof, search: 0 };
  for (let i = 0; i < PLAN_STEPS && more(s); i++) {
    const cc = makeCtx(s, c.seat, quiet, () => 0.5);
    const a = cc ? policy(cc) : null;
    if (!a) break;
    const r = apply(s, { by: c.seat, a }, { check: false });
    c.budget.left--;
    if (!r.ok) break;
    cmds.push({ by: c.seat, a });
    s = r.state;
  }
  return { cmds, end: s };
}

/** What a plan leaves behind that matters (two plans with the same are the same plan) */
const outcome = (c: BotCtx, p: Plan): string => JSON.stringify([p.end.props, p.end.players[c.seat]?.cash, p.end.phase.k]);

/** `first`, then the alternatives (made in order) that differ from every plan before them: `fit` plans at most */
function distinct(c: BotCtx, first: Plan, alternatives: (() => Plan)[], fit: number): Plan[] {
  const plans = [first];
  const seen = new Set([outcome(c, first)]);
  for (const make of alternatives) {
    if (plans.length >= fit) break;
    const p = make();
    const key = outcome(c, p);
    if (seen.has(key)) continue;
    seen.add(key);
    plans.push(p);
  }
  return plans;
}

/** The index of the best option: 0 (the default) unless another beats it by `margin` */
function pick(scores: (number | null)[] | null, margin: number): number {
  const base = scores?.[0];
  if (!scores || base === null || base === undefined) return 0;
  let best = 0;
  let bestScore = base + margin;
  scores.forEach((x, i) => {
    if (i > 0 && x !== null && x > bestScore) [best, bestScore] = [i, x];
  });
  return best;
}

// ---------------------------------------------------------------------------------------------------------------
// Building and mortgages at the end of the turn

export function searchPostRoll(c: BotCtx): Action {
  const fit = room(c, 3, PLAN_SHARE);
  if (fit < 2) return postRollChoice(c);
  const p = c.prof;
  const inPost = (s: GameState): boolean => s.phase.k === 'postRoll';
  const plan = (prof: Profile) => (): Plan => planOf(c, prof, manageChoice, inPost);
  const plans = distinct(
    c,
    plan(p)(),
    [
      plan({ ...p, reserveBase: 0, reserveExp: p.reserveExp / 3, reserveMax: p.reserveMax / 3 }),
      plan({ ...p, reserveBase: 0, reserveExp: 0, reserveMax: 0 }),
      plan({ ...p, holdAtFour: false }),
      () => ({ cmds: [], end: c.s }),
    ],
    fit,
  );
  let best = 0;
  if (plans.length > 1) {
    const options = plans.map((pl) => play(inPost(pl.end) ? [...pl.cmds, { by: c.seat, a: { k: 'endTurn' } }] : pl.cmds));
    best = pick(ask(c, { key: `build|${stateKey(c.s)}`, options, rounds: 3, share: PLAN_SHARE }), MARGIN);
  }
  return plans[best]?.cmds[0]?.a ?? { k: 'endTurn' };
}

// ---------------------------------------------------------------------------------------------------------------
// Jail

export function searchJail(c: BotCtx): Action {
  const h = jailChoice(c);
  const jail = c.me.jail;
  if (!jail || room(c, 3, PLAN_SHARE) < 2) return h;
  const card = c.me.goojf[0];
  const leave: Action | null = card
    ? { k: 'useCard', card }
    : jail.tries < 2 && c.me.cash >= c.s.cfg.jailFine
      ? { k: 'payFine' }
      : null;
  if (!leave) return h;
  const stay: Action = { k: 'roll' };
  const order = h.k === 'roll' ? [stay, leave] : [leave, stay];
  const options = order.map((a) => play([{ by: c.seat, a }]));
  return order[pick(ask(c, { key: `jail|${stateKey(c.s)}`, options, rounds: 3, share: PLAN_SHARE }), MARGIN)] as Action;
}

// ---------------------------------------------------------------------------------------------------------------
// Debt

export function searchDebt(c: BotCtx, ph: DebtPhase): Action {
  const fit = room(c, 2, PLAN_SHARE);
  if (hopeless(c, ph) || fit < 2) return debtChoice(c, ph);
  const inDebt = (s: GameState): boolean => s.phase.k === 'debt' && s.phase.debtor === c.seat;
  const plan = (order: RaiseOpts['order']) => (): Plan =>
    planOf(c, c.prof, (cc) => (cc.s.phase.k === 'debt' ? debtChoice(cc, cc.s.phase, order) : null), inDebt);
  const plans = distinct(c, plan('rent')(), [plan('big'), plan('houses')], fit);
  let best = 0;
  if (plans.length > 1) {
    const options = plans.map((pl) => play(pl.cmds));
    best = pick(ask(c, { key: `debt|${stateKey(c.s)}`, options, rounds: 2, share: PLAN_SHARE }), MARGIN);
  }
  return plans[best]?.cmds[0]?.a ?? debtChoice(c, ph);
}

// ---------------------------------------------------------------------------------------------------------------
// Trades

/** Expert's proposal at the start of its turn: the best priced offer, if a rollout says it beats no deal */
export function searchProposal(c: BotCtx): Action | null {
  const round = proposalRound(c);
  if (!round) return null;
  const fit = room(c, 3);
  if (fit < 2) return proposal(c);
  const offers = pricedOffers(c, round.generous, Math.min(OFFERS, fit - 1));
  if (offers.length === 0) return null;
  const options: Option[] = [
    play([]),
    ...offers.map((o) =>
      play([
        { by: c.seat, a: { k: 'propose', to: o.to, give: o.give, get: o.get } },
        (s) => {
          const t = Object.values(s.trades).find((x) => x.from === c.seat);
          return t ? { by: o.to, a: { k: 'accept', id: t.id } } : null;
        },
      ]),
    ),
  ];
  const best = pick(ask(c, { key: `offer|${stateKey(c.s)}`, options, rounds: 3 }), TRADE_MARGIN);
  const o = offers[best - 1];
  return o ? { k: 'propose', to: o.to, give: o.give, get: o.get } : null;
}

/**
 * Expert's answer to an offer. Where it cannot accept now it turns down only what loses it value outright and holds
 * the rest for a calm phase; there a rollout decides.
 */
export function searchRespond(c: BotCtx, t: Trade, canAccept: boolean): 'accept' | 'reject' {
  if (!canAccept) return offerGain(c, t) < 0 ? 'reject' : 'accept';
  if (room(c, 3) < 2) return respond(c, t);
  const options = [play([{ by: c.seat, a: { k: 'reject', id: t.id } }]), play([{ by: c.seat, a: { k: 'accept', id: t.id } }])];
  return pick(ask(c, { key: `answer|${stateKey(c.s)}`, options, rounds: 3 }), TRADE_MARGIN) === 1 ? 'accept' : 'reject';
}
