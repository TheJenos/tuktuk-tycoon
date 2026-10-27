import {
  buildCapacity,
  placeSites,
  xferCost,
  type Action,
  type BuildClaimPhase,
  type BuildKind,
  type MortgageXferPhase,
} from '../rules';
import { type BotCtx, pickOne } from './ctx';
import { raiseStep } from './debt';
import { heroesBoard } from './heroes';
import {
  type GroupInfo,
  buildable,
  cashOf,
  landOf,
  liftCost,
  ownedBy,
  ownsGroup,
  propAt,
  rentAt,
  streetAt,
} from './model';

/*
 * Houses, hotels and mortgages on the bot's own turn, plus its answers in a building shortage contest. Building is
 * planned unit by unit (best rent gained per rupee first, every set to 3 houses before anything goes higher) and
 * sent as one `build` per group with the group's target levels.
 */

/** Easy only builds while it holds more than this */
const EASY_FLOOR = 500;

interface Plan {
  /** Target levels per group, in the order the plan first touched them */
  targets: Map<string, number[]>;
  units: number;
}

/** Opponents with a set they could still put houses on: Hard then stops at 4 houses to keep the bank short */
function rivalsCanBuild(c: BotCtx): boolean {
  const m = c.m;
  return m.active.some(
    (o) => o !== c.seat && m.info.groups.some((g) => buildable(m, o, g) && g.spaces.some((x) => (m.level[x] ?? 0) < 4)),
  );
}

function stepCost(c: BotCtx, space: number, to: number): number {
  const sp = streetAt(c.m, space);
  return sp ? (to === 5 ? (sp.hotel ?? sp.house) : sp.house) : Infinity;
}

/** Plans up to `maxUnits` units within `budget` (easy picks groups at random) */
export function planBuilds(c: BotCtx, budget: number, maxUnits = Infinity): Plan {
  const m = c.m;
  const land = landOf(m, c.prof);
  const cap = c.prof.holdAtFour && rivalsCanBuild(c) ? 4 : 5;
  const groups = m.info.groups.filter((g) => buildable(m, c.seat, g));
  const levels = new Map(groups.map((g) => [g.id, g.spaces.map((x) => m.level[x] ?? 0)]));
  let houses = m.bankHouses;
  let hotels = m.bankHotels;
  const targets = new Map<string, number[]>();
  let units = 0;

  type Cand = { g: GroupInfo; i: number; to: number; cost: number; tier: number; roi: number };
  const nextStep = (g: GroupInfo): Cand | null => {
    const lv = levels.get(g.id) as number[];
    const min = Math.min(...lv);
    if (min >= cap) return null;
    const to = min + 1;
    if (to <= 4 ? houses < 1 : hotels < 1) return null;
    let best: Cand | null = null;
    lv.forEach((l, i) => {
      if (l !== min) return;
      const space = g.spaces[i] as number;
      const sp = streetAt(m, space);
      if (!sp) return;
      const now = l === 0 ? rentAt(m, space, 0) : (sp.rent[l] ?? 0);
      const cost = stepCost(c, space, to);
      const roi = (((sp.rent[to] ?? 0) - now) * (land[space] ?? 0)) / cost;
      const cand = { g, i, to, cost, tier: to <= 3 ? 0 : 1, roi };
      if (!best || roi > best.roi) best = cand;
    });
    return best;
  };

  for (let guard = 0; guard < 200; guard++) {
    const cands = groups.map(nextStep).filter((x): x is Cand => x !== null);
    const affordable = cands.filter((x) => x.cost <= budget);
    if (affordable.length === 0 || units >= maxUnits) break;
    const pick =
      c.prof.skill === 'easy'
        ? (pickOne(c.rnd, affordable) as Cand)
        : affordable.sort((x, y) => x.tier - y.tier || y.roi - x.roi)[0] as Cand;
    const lv = levels.get(pick.g.id) as number[];
    lv[pick.i] = pick.to;
    if (pick.to <= 4) houses--;
    else {
      hotels--;
      houses += 4;
    }
    budget -= pick.cost;
    units++;
    targets.set(pick.g.id, [...lv]);
  }
  return { targets, units };
}

/**
 * The part of a group's target the bank can supply on its own, raising a lowest street first as the engine does.
 * A plan may count on houses that another group's hotel would hand back; each build goes up by itself.
 */
function reachable(c: BotCtx, g: GroupInfo, target: number[]): number[] | null {
  const cur = g.spaces.map((x) => c.m.level[x] ?? 0);
  let houses = c.m.bankHouses;
  let hotels = c.m.bankHotels;
  let moved = false;
  for (;;) {
    const min = Math.min(...cur);
    const i = cur.findIndex((l, j) => l === min && (target[j] ?? 0) > l);
    if (i < 0) break;
    const to = (cur[i] as number) + 1;
    if (to <= 4) {
      if (houses < 1) break;
      houses--;
    } else {
      if (hotels < 1) break;
      hotels--;
      houses += 4;
    }
    cur[i] = to;
    moved = true;
  }
  return moved ? cur : null;
}

function buildAction(c: BotCtx, plan: Plan): Action | null {
  for (const [id, target] of plan.targets) {
    const g = c.m.info.groups.find((x) => x.id === id);
    const levels = g ? reachable(c, g, target) : null;
    if (levels) return { k: 'build', group: id, levels };
  }
  return null;
}

/** Mortgages worth lifting: streets of complete sets first (they block building), then by rent */
function liftChoice(c: BotCtx, roomToBuild: boolean): Action | null {
  const m = c.m;
  const land = landOf(m, c.prof);
  const mortgaged = ownedBy(m, c.seat).filter((x) => m.mort[x]);
  const inSet = (x: number): boolean => {
    const g = m.info.groupAt[x];
    return !!g && ownsGroup(m, c.seat, g);
  };
  const ranked = mortgaged.sort((x, y) => Number(inSet(y)) - Number(inSet(x)) || (land[y] ?? 0) - (land[x] ?? 0));
  for (const x of ranked) {
    // Lone property waits while the cash could still go into houses
    if (!inSet(x) && roomToBuild) continue;
    const margin = inSet(x) ? 0 : 100;
    if (cashOf(m, c.seat) - liftCost(m, x) >= c.reserve + margin) return { k: 'unmortgage', space: x };
  }
  return null;
}

/** The bot's own turn after rolling: lift, build, then end the turn (Hero League: nothing to build or lift) */
export function postRollChoice(c: BotCtx): Action {
  if (heroesBoard(c)) return { k: 'endTurn' };
  return manageChoice(c) ?? { k: 'endTurn' };
}

/** Building and mortgages on the bot's own turn (null when there is nothing worth doing) */
export function manageChoice(c: BotCtx): Action | null {
  const cash = c.me.cash;
  if (c.prof.skill === 'easy') {
    if (cash <= EASY_FLOOR) return null;
    return buildAction(c, planBuilds(c, cash - EASY_FLOOR, 1));
  }
  // Complete sets with a mortgage cannot be built on: lift those first
  const setLift = liftChoice(c, true);
  if (setLift) return setLift;
  const budget = cash - c.reserve;
  const plan = planBuilds(c, budget);
  const build = buildAction(c, plan);
  if (build) return build;
  // What the caps and the bank would still allow if cash were no object
  const full = planBuilds(c, Infinity);
  if (full.units > 0 && c.prof.fundBuilds) {
    // Budget-bound: mortgage lone property to get a set to 3 houses
    const below3 = c.m.info.groups.some(
      (g) => buildable(c.m, c.seat, g) && g.spaces.some((x) => (c.m.level[x] ?? 0) < 3),
    );
    const step = below3 ? raiseStep(c, { loneOnly: true }) : null;
    const raised = step?.k === 'mortgage' ? (propAt(c.m, step.space)?.mortgage ?? 0) : 0;
    if (step && buildAction(c, planBuilds(c, budget + raised, 1))) return step;
  }
  return liftChoice(c, full.units > 0);
}

/** Units of `kind` the bot would put up now if it could */
function wantedUnits(c: BotCtx, kind: BuildKind): number {
  const budget = c.prof.skill === 'easy' ? c.me.cash - EASY_FLOOR : c.me.cash - c.reserve;
  const plan = planBuilds(c, budget);
  let n = 0;
  for (const [id, lv] of plan.targets) {
    const g = c.m.info.groups.find((x) => x.id === id);
    if (!g) continue;
    lv.forEach((l, i) => {
      const from = c.m.level[g.spaces[i] as number] ?? 0;
      for (let step = from + 1; step <= l; step++) if ((step === 5) === (kind === 'hotel')) n++;
    });
  }
  return n;
}

export function claimChoice(c: BotCtx, ph: BuildClaimPhase): Action {
  const cap = buildCapacity(c.s, c.seat, ph.kind);
  let want = wantedUnits(c, ph.kind);
  // Hard plays the shortage: houses it takes are houses its rivals cannot have
  if (c.prof.holdAtFour && ph.kind === 'house' && cap > want) {
    const cheapest = Math.min(...c.m.info.groups.filter((g) => buildable(c.m, c.seat, g)).map((g) => g.house));
    const spare = Math.floor((c.me.cash - c.reserve / 2) / cheapest);
    want = Math.max(want, Math.min(cap, spare));
  }
  const n = Math.min(cap, want);
  return n >= 1 ? { k: 'requestBuild', n } : { k: 'pass' };
}

export function placeChoice(c: BotCtx, kind: BuildKind): Action | null {
  const land = landOf(c.m, c.prof);
  const sites = placeSites(c.s, c.seat, kind);
  let best: number | undefined;
  let bestRoi = -Infinity;
  for (const x of sites) {
    const sp = streetAt(c.m, x);
    if (!sp) continue;
    const l = c.m.level[x] ?? 0;
    const now = l === 0 ? rentAt(c.m, x, 0) : (sp.rent[l] ?? 0);
    const roi = (((sp.rent[l + 1] ?? 0) - now) * (land[x] ?? 0)) / stepCost(c, x, l + 1);
    if (roi > bestRoi) [best, bestRoi] = [x, roi];
  }
  return best === undefined ? null : { k: 'place', space: best };
}

/** Received mortgaged property: lift what the cash comfortably covers (sets first), keep the rest */
export function xferChoice(c: BotCtx, ph: MortgageXferPhase): Action {
  if (c.prof.skill === 'easy') return { k: 'settleMortgages', lift: [] };
  const m = c.m;
  const inSet = (x: number): number => {
    const g = m.info.groupAt[x];
    return g && ownsGroup(m, c.seat, g) ? 1 : 0;
  };
  const land = landOf(m, c.prof);
  const order = [...ph.spaces].sort((x, y) => inSet(y) - inSet(x) || (land[y] ?? 0) - (land[x] ?? 0));
  const lift: number[] = [];
  for (const x of order) {
    const next = [...lift, x];
    if (c.me.cash - xferCost(c.s, ph.spaces, next) >= c.reserve) lift.push(x);
  }
  return { k: 'settleMortgages', lift: lift.sort((x, y) => x - y) };
}
