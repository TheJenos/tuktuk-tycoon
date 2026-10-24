import { applyBuild, applySell, planBuild, planSell } from './buildings';
import { findContest, startClaim } from './claim';
import { err, player, rs } from './ctx';
import { type Handler, MANAGE_PHASES, RAISE_PHASES, seatAction } from './handler';
import { mortgageNow, mortgageProblem, unmortgageCost, unmortgageNow, unmortgageProblem } from './mortgage';

/*
 * Building, selling, mortgaging: open to every owner, not only the turn seat. Building and lifting mortgages
 * happen in calm phases (before or after a roll, or while the turn seat decides on a purchase); selling and
 * mortgaging, which raise cash, are also open during auctions, debts, Income Tax and mortgage settlements.
 * Buildings are always paid in cash and never open a debt.
 */

export const build: Handler<'build'> = seatAction(
  (s, b, seat, a) => {
    if (!MANAGE_PHASES.has(s.phase.k)) return err('phase', 'You can build before or after rolling');
    const plan = planBuild(s, b, seat, a.group, a.levels);
    if ('code' in plan) return plan;
    if (player(s, seat).cash < plan.cost) return err('cash', `Building costs ${rs(plan.cost)}`);
    return null;
  },
  (c, seat, a) => {
    const plan = planBuild(c.s, c.b, seat, a.group, a.levels);
    if ('code' in plan) return;
    const contest = findContest(c, seat, plan);
    if (contest) startClaim(c, seat, contest, { group: a.group, levels: [...a.levels] });
    else applyBuild(c, seat, plan);
  },
);

export const sell: Handler<'sell'> = seatAction(
  (s, b, seat, a) => {
    if (!RAISE_PHASES.has(s.phase.k)) return err('phase', 'You cannot sell buildings now');
    const plan = planSell(s, b, seat, a.group, a.levels);
    return 'code' in plan ? plan : null;
  },
  (c, seat, a) => {
    const plan = planSell(c.s, c.b, seat, a.group, a.levels);
    if (!('code' in plan)) applySell(c, seat, plan);
  },
);

export const mortgage: Handler<'mortgage'> = seatAction(
  (s, b, seat, a) =>
    RAISE_PHASES.has(s.phase.k) ? mortgageProblem(s, b, seat, a.space) : err('phase', 'You cannot mortgage now'),
  (c, seat, a) => mortgageNow(c, seat, a.space),
);

export const unmortgage: Handler<'unmortgage'> = seatAction(
  (s, b, seat, a) =>
    MANAGE_PHASES.has(s.phase.k)
      ? unmortgageProblem(s, b, seat, a.space)
      : err('phase', 'You can lift mortgages before or after rolling'),
  (c, seat, a) => unmortgageNow(c, seat, a.space, unmortgageCost(c.s, c.b, a.space)),
);
