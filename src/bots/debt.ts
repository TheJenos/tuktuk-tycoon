import { buildOptions, maxRaise, type Action, type DebtPhase } from '../rules';
import type { BotCtx } from './ctx';
import { type GroupInfo, groupBuilt, landOf, ownedBy, ownsGroup, propAt, rentAt } from './model';

/*
 * Raising cash, the same order for every skill: mortgage lone property first (cheapest rent lost first), then sell
 * houses evenly from the weakest set, then mortgage the streets of sets (Expert also plays out two other orders and
 * keeps the best, see RaiseOpts.order). Bankrupt only when even everything sold and mortgaged (maxRaise) cannot
 * cover the debt. A debt settles by itself once cash covers it.
 * Bots never sell property back to the bank (sellProperty): it brings exactly what mortgaging it does (nothing for
 * a mortgaged one) and loses the deed, so once nothing is left to mortgage, selling could not raise anything more.
 */

export interface RaiseOpts {
  /** Only mortgage property outside complete sets (raising cash to buy or build, not to survive) */
  loneOnly?: boolean;
  /** Never touch this colour group (the one the cash is for) */
  keepGroup?: string;
  /**
   * Which lone property goes first and when buildings are sold (Expert compares these by rollouts):
   * 'rent' (default) mortgages lone property by least rent lost, then sells buildings, then mortgages sets;
   * 'big' mortgages the lone property with the largest mortgage value first (fewest titles turned over);
   * 'houses' sells buildings from the weakest set before mortgaging any lone property.
   */
  order?: 'rent' | 'big' | 'houses';
}

/** Rent per turn a property brings in now (what mortgaging it would lose) */
function income(c: BotCtx, space: number): number {
  return rentAt(c.m, space) * (landOf(c.m, c.prof)[space] ?? 0);
}

/** Total rent per turn of a set as it stands */
function setIncome(c: BotCtx, g: GroupInfo): number {
  return g.spaces.reduce((a, x) => a + income(c, x), 0);
}

/** Lone = not part of a complete set the seat owns */
function isLone(c: BotCtx, space: number): boolean {
  const g = c.m.info.groupAt[space];
  return !g || !ownsGroup(c.m, c.seat, g);
}

/** Streets of a group the bot holds most of are worth keeping a little longer */
function holdBias(c: BotCtx, space: number): number {
  const g = c.m.info.groupAt[space];
  if (!g) return 0;
  const mine = g.spaces.filter((x) => c.m.owner[x] === c.seat).length;
  return mine >= g.spaces.length - 1 ? 5 : 0;
}

/** The next cash-raising action, or null when nothing is left to raise (under `opts`) */
export function raiseStep(c: BotCtx, opts: RaiseOpts = {}): Action | null {
  const m = c.m;
  const keep = (space: number): boolean => !!opts.keepGroup && m.info.groupAt[space]?.id === opts.keepGroup;
  const mine = ownedBy(m, c.seat).filter((x) => !keep(x));

  const mortgageValue = (x: number): number => propAt(m, x)?.mortgage ?? 0;
  const lone = mine
    .filter((x) => !m.mort[x] && isLone(c, x))
    .sort((x, y) =>
      opts.order === 'big'
        ? mortgageValue(y) - mortgageValue(x) || income(c, x) - income(c, y) || x - y
        : income(c, x) + holdBias(c, x) - (income(c, y) + holdBias(c, y)) || mortgageValue(y) - mortgageValue(x) || x - y,
    );
  const sets = m.info.groups
    .filter((g) => ownsGroup(m, c.seat, g) && g.id !== opts.keepGroup)
    .sort((x, y) => setIncome(c, x) - setIncome(c, y));
  const sellStep = (): Action | null => {
    const built = sets.filter((g) => groupBuilt(m, g));
    if (built.length === 0) return null;
    const options = buildOptions(c.s, c.seat);
    for (const g of built) {
      const opt = options.find((o) => o.group === g.id);
      if (!opt) continue;
      // Sell from the highest street (the engine keeps it even); a hotel that cannot be broken goes all at once
      const sell = [...opt.sell].sort((x, y) => (m.level[y.space] ?? 0) - (m.level[x.space] ?? 0))[0];
      if (sell) return sell.action;
      if (opt.sellAll) return opt.sellAll;
    }
    return null;
  };

  if (opts.order === 'houses' && !opts.loneOnly) {
    const sell = sellStep();
    if (sell) return sell;
  }
  if (lone[0] !== undefined) return { k: 'mortgage', space: lone[0] };
  if (opts.loneOnly) return null;
  const sell = sellStep();
  if (sell) return sell;

  for (const g of sets) {
    if (groupBuilt(m, g)) continue;
    const street = g.spaces.filter((x) => !m.mort[x]).sort((x, y) => income(c, x) - income(c, y) || x - y)[0];
    if (street !== undefined) return { k: 'mortgage', space: street };
  }
  return null;
}

/** Total still owed to creditors who can receive it */
function owedTotal(c: BotCtx, ph: DebtPhase): number {
  let total = 0;
  for (const [to, n] of Object.entries(ph.owed)) {
    if (!n || n <= 0) continue;
    if (to === 'bank' || (to !== c.seat && c.m.active.includes(to as never))) total += n;
  }
  return total;
}

/** Nothing can save the seat: even everything sold and mortgaged cannot cover the debt */
export const hopeless = (c: BotCtx, ph: DebtPhase): boolean => maxRaise(c.s, c.seat) < owedTotal(c, ph);

export function debtChoice(c: BotCtx, ph: DebtPhase, order?: RaiseOpts['order']): Action {
  if (hopeless(c, ph)) return { k: 'bankrupt' };
  return raiseStep(c, { order }) ?? { k: 'autoRaise' };
}
