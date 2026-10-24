import { incomeTaxAmounts, maxRaise, type Action } from '../rules';
import { type BotCtx, pickOne } from './ctx';
import { raiseStep } from './debt';
import { twoDice } from './landingProb';
import { blocksSet, completesSet, danger, propAt, rentOwed, worthToMe } from './model';
import { rolloutWorth } from './rollout';

/*
 * The turn seat's own choices: jail, Bus, a triple's free move, buying, Income Tax.
 */

const bankLeft = (c: BotCtx): number => c.m.info.props.filter((x) => c.m.owner[x] === undefined).length;

const opponentsBuilt = (c: BotCtx): boolean =>
  c.m.info.props.some((x) => c.m.owner[x] !== undefined && c.m.owner[x] !== c.seat && (c.m.level[x] ?? 0) > 0);

/**
 * Jail is a safe place once the board is dangerous: Normal stays once few properties are left to buy or rivals have
 * built; Hard weighs the rent it would expect to pay per turn against what is still for sale.
 */
export function prefersJail(c: BotCtx): boolean {
  switch (c.prof.skill) {
    case 'easy':
      return false;
    case 'normal':
      return bankLeft(c) < 6 || opponentsBuilt(c);
    default: {
      const d = danger(c.m, c.seat, c.prof);
      const left = bankLeft(c);
      return d > 40 || (left <= 3 && d > 12) || (left === 0 && d > 5);
    }
  }
}

export function jailChoice(c: BotCtx): Action {
  const jail = c.me.jail;
  if (!jail) return { k: 'roll' };
  const leave = c.prof.skill === 'easy' ? c.me.cash > 300 : !prefersJail(c);
  if (!leave) return { k: 'roll' };
  if (c.me.goojf.length > 0) return { k: 'useCard', card: c.me.goojf[0] as string };
  const fine = c.s.cfg.jailFine;
  const keep = c.prof.skill === 'easy' ? 0 : c.reserve / 2;
  if (jail.tries < 2 && c.me.cash >= fine && c.me.cash - fine >= keep) return { k: 'payFine' };
  return { k: 'roll' };
}

/** How good it is to end a move on `to` coming from `from` (rupees, roughly) */
function targetScore(c: BotCtx, from: number, to: number, walk: boolean): number {
  const m = c.m;
  const b = m.info.b;
  if (to === b.goToJailIndex) return prefersJail(c) ? 60 : -120;
  // Walking forward onto or past GO pays the salary
  let score = walk && (to < from || to === 0) ? c.s.cfg.goSalary : 0;
  const cash = c.me.cash + score;
  const sp = b.spaces[to];
  const p = propAt(m, to);
  if (p) {
    const owner = m.owner[to];
    if (owner === undefined) {
      if (cash < p.price) return score + 5;
      const worth = worthToMe(m, c.seat, to, c.prof, c.prof.skill === 'normal' ? 0 : c.rivalShare / 2);
      const setBonus = c.prof.skill !== 'normal' && completesSet(m, c.seat, to) ? 150 : 0;
      return score + 20 + Math.max(0, worth - p.price) * 0.5 + setBonus;
    }
    return score + (owner === c.seat ? 5 : -rentOwed(m, c.seat, to));
  }
  if (sp?.k === 'tax') {
    if (sp.tax === 'luxury') return score - c.s.cfg.luxuryTax;
    const t = incomeTaxAmounts(c.s, c.seat);
    return score - Math.min(t.flat, t.percent);
  }
  if (sp?.k === 'chest') return score + 10;
  if (sp?.k === 'chance') return score - 5;
  return score;
}

/** Expected rent of the throw after landing on `at` (a triple rolls again) */
function nextThrowRisk(c: BotCtx, at: number): number {
  let r = 0;
  for (let d = 2; d <= 12; d++) r += twoDice(d) * rentOwed(c.m, c.seat, (at + d) % c.m.info.n);
  return r;
}

export function busChoice(c: BotCtx, opts: number[]): Action {
  const n = c.m.info.n;
  const pos = c.me.pos;
  if (c.prof.skill === 'easy') {
    const safe = opts.filter((o) => (pos + o) % n !== c.m.info.b.goToJailIndex);
    return { k: 'bus', n: pickOne(c.rnd, safe.length ? safe : opts) as number };
  }
  let best = opts[0] as number;
  let bestScore = -Infinity;
  for (const o of opts) {
    const score = targetScore(c, pos, (pos + o) % n, true);
    if (score > bestScore) [best, bestScore] = [o, score];
  }
  return { k: 'bus', n: best };
}

export function chooseSpaceChoice(c: BotCtx): Action {
  const n = c.m.info.n;
  const pos = c.me.pos;
  const again = c.s.cfg.triplesRollAgain;
  const targets = Array.from({ length: n }, (_, i) => i).filter((i) => i !== pos);
  if (c.prof.skill === 'easy') {
    const good = targets.filter((i) => targetScore(c, pos, i, true) >= 0 && i !== c.m.info.b.goToJailIndex);
    return { k: 'chooseSpace', space: pickOne(c.rnd, good.length ? good : targets) as number };
  }
  let best = targets[0] as number;
  let bestScore = -Infinity;
  for (const i of targets) {
    let score = targetScore(c, pos, i, true);
    if (again && i !== c.m.info.b.goToJailIndex && c.prof.weighted) score -= 0.5 * nextThrowRisk(c, i);
    if (score > bestScore) [best, bestScore] = [i, score];
  }
  return { k: 'chooseSpace', space: best };
}

/** The bot's limit for a property: what it is worth to it (Expert: checked by rollouts) */
export function propertyWorth(c: BotCtx, space: number): number {
  const w = worthToMe(c.m, c.seat, space, c.prof, c.prof.rivalWeight * c.rivalShare);
  if (c.prof.search <= 0) return w;
  const mc = rolloutWorth(c, space);
  return mc === null ? w : w + c.prof.rolloutWeight * (mc - w);
}

export function buyChoice(c: BotCtx, space: number): Action {
  const p = propAt(c.m, space);
  if (!p) return { k: 'decline' };
  const cash = c.me.cash;
  const price = p.price;
  switch (c.prof.skill) {
    case 'easy':
      return cash - price >= 100 && c.rnd() < 0.8 ? { k: 'buy' } : { k: 'decline' };
    case 'normal': {
      const key = completesSet(c.m, c.seat, space) || blocksSet(c.m, c.seat, space);
      if (cash >= price && (key || cash - price >= c.reserve)) return { k: 'buy' };
      return { k: 'decline' };
    }
    default: {
      const worth = propertyWorth(c, space);
      if (worth < price * 0.9) return { k: 'decline' };
      if (cash >= price && cash - price >= c.reserve) return { k: 'buy' };
      // Worth stretching for: dip below the reserve, or mortgage lone property to afford it
      const key = completesSet(c.m, c.seat, space) || worth > price * 2;
      if (!key) return { k: 'decline' };
      if (cash >= price) return { k: 'buy' };
      if (maxRaise(c.s, c.seat) - price >= c.reserve / 2) {
        const step = raiseStep(c, { loneOnly: true, keepGroup: c.m.info.groupAt[space]?.id });
        if (step) return step;
      }
      return { k: 'decline' };
    }
  }
}

export function incomeTaxChoice(c: BotCtx): Action {
  const t = incomeTaxAmounts(c.s, c.seat);
  if (c.prof.skill === 'easy' && c.rnd() < 0.25) return { k: 'incomeTax', pick: 'flat' };
  return { k: 'incomeTax', pick: t.percent < t.flat ? 'percent' : 'flat' };
}
