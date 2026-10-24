import {
  boardOf,
  isProperty,
  isStreet,
  unmortgageCost,
  type Action,
  type BoardDef,
  type GameState,
  type GroupDef,
  type SeatId,
  type StreetDef,
} from '../../../rules';
import { money, plural } from '../format';

/*
 * Staged property changes for the Manage panel: target building levels per colour group and target mortgage
 * states per property, checked as the player stages them (even building, mortgages vs buildings, phases) and
 * turned into engine actions in a safe order on Apply. Plans hold targets, not steps, so after a partial apply
 * (one action refused) `normalizePlan` against the new state keeps exactly what is still to do.
 */

export interface Plan {
  /** Target levels per group id (GroupDef.spaces order); only groups that differ from the state */
  levels: Record<string, number[]>;
  /** Target mortgage state per space; only spaces that differ from the state */
  mortgage: Record<number, boolean>;
}

export const EMPTY_PLAN: Plan = { levels: {}, mortgage: {} };

/** The engine's phase sets (src/rules/handler.ts): building and lifting in calm phases; raising cash in more */
const MANAGE_PHASES = new Set(['preRoll', 'postRoll', 'buy']);
const RAISE_PHASES = new Set(['preRoll', 'postRoll', 'buy', 'incomeTax', 'auction', 'debt', 'mortgageXfer']);

export type ManageKind = 'build' | 'sell' | 'mortgage' | 'unmortgage';

export const phaseAllows = (s: GameState, kind: ManageKind): boolean =>
  (kind === 'build' || kind === 'unmortgage' ? MANAGE_PHASES : RAISE_PHASES).has(s.phase.k);

const PHASE_REASON: Record<ManageKind, string> = {
  build: 'You can build before or after rolling',
  sell: 'You cannot sell buildings now',
  mortgage: 'You cannot mortgage now',
  unmortgage: 'You can lift mortgages before or after rolling',
};

const levelOf = (s: GameState, space: number): number => s.props[`p${space}`]?.level ?? 0;
const mortgagedNow = (s: GameState, space: number): boolean => !!s.props[`p${space}`]?.mortgaged;
const ownerNow = (s: GameState, space: number): SeatId | undefined => s.props[`p${space}`]?.owner;

/** The street groups (railroads and utilities have no group in the data) */
const streetGroups = (b: BoardDef): GroupDef[] => b.groups.filter((g) => g.spaces.every((i) => isStreet(b.spaces[i])));

export function groupOfSpace(b: BoardDef, space: number): GroupDef | undefined {
  return streetGroups(b).find((g) => g.spaces.includes(space));
}

export const levelsNow = (s: GameState, g: GroupDef): number[] => g.spaces.map((i) => levelOf(s, i));

export const targetLevels = (s: GameState, plan: Plan, g: GroupDef): number[] => plan.levels[g.id] ?? levelsNow(s, g);

export const targetLevel = (s: GameState, plan: Plan, space: number): number => {
  const g = groupOfSpace(boardOf(s), space);
  if (!g) return levelOf(s, space);
  return targetLevels(s, plan, g)[g.spaces.indexOf(space)] ?? 0;
};

export const targetMortgaged = (s: GameState, plan: Plan, space: number): boolean =>
  plan.mortgage[space] ?? mortgagedNow(s, space);

const sameLevels = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Drops staged entries the state already matches, or that no longer belong to the seat */
export function normalizePlan(s: GameState, seat: SeatId, plan: Plan): Plan {
  const b = boardOf(s);
  const levels: Record<string, number[]> = {};
  for (const [id, target] of Object.entries(plan.levels)) {
    const g = streetGroups(b).find((x) => x.id === id);
    if (!g || !g.spaces.every((i) => ownerNow(s, i) === seat)) continue;
    if (!sameLevels(target, levelsNow(s, g))) levels[id] = [...target];
  }
  const mortgage: Record<number, boolean> = {};
  for (const [key, on] of Object.entries(plan.mortgage)) {
    const space = Number(key);
    if (ownerNow(s, space) !== seat) continue;
    if (on !== mortgagedNow(s, space)) mortgage[space] = on;
  }
  return { levels, mortgage };
}

export const planEmpty = (plan: Plan): boolean =>
  Object.keys(plan.levels).length === 0 && Object.keys(plan.mortgage).length === 0;

/** Why the space cannot go one level up (dir 1) or down (dir -1) in the plan; null = it can */
export function stepProblem(s: GameState, seat: SeatId, plan: Plan, space: number, dir: 1 | -1): string | null {
  const b = boardOf(s);
  const g = groupOfSpace(b, space);
  if (!g) return 'Only streets take buildings';
  const name = (i: number) => b.spaces[i]?.name ?? '';
  if (!g.spaces.every((i) => ownerNow(s, i) === seat)) return dir > 0 ? 'Own the whole colour group to build' : 'No buildings to sell';
  const levels = targetLevels(s, plan, g);
  const k = g.spaces.indexOf(space);
  const l = levels[k] ?? 0;
  if (dir > 0) {
    if (!phaseAllows(s, 'build')) return PHASE_REASON.build;
    if (g.spaces.some((i) => targetMortgaged(s, plan, i))) return 'Lift every mortgage in the group first';
    if (l >= 5) return 'It already has a hotel';
    const min = Math.min(...levels);
    if (l > min) return `Build evenly: ${name(g.spaces[levels.indexOf(min)] as number)} first`;
    return null;
  }
  if (!phaseAllows(s, 'sell')) return PHASE_REASON.sell;
  if (l <= 0) return 'No buildings to sell';
  const max = Math.max(...levels);
  if (l < max) return `Sell evenly: ${name(g.spaces[levels.indexOf(max)] as number)} first`;
  return null;
}

/** The plan with one level more or less on `space` (call only when stepProblem is null) */
export function stepLevel(s: GameState, seat: SeatId, plan: Plan, space: number, dir: 1 | -1): Plan {
  const g = groupOfSpace(boardOf(s), space);
  if (!g) return plan;
  const levels = [...targetLevels(s, plan, g)];
  const k = g.spaces.indexOf(space);
  levels[k] = Math.max(0, Math.min(5, (levels[k] ?? 0) + dir));
  return normalizePlan(s, seat, { ...plan, levels: { ...plan.levels, [g.id]: levels } });
}

/** Why the space's mortgage cannot be toggled in the plan; null = it can (going back to now always can) */
export function mortgageProblem(s: GameState, seat: SeatId, plan: Plan, space: number): string | null {
  const b = boardOf(s);
  if (!isProperty(b.spaces[space])) return 'Not a property';
  if (ownerNow(s, space) !== seat) return 'You do not own it';
  const want = !targetMortgaged(s, plan, space);
  if (want === mortgagedNow(s, space)) return null;
  if (want) {
    if (!phaseAllows(s, 'mortgage')) return PHASE_REASON.mortgage;
    const g = groupOfSpace(b, space);
    if (g && targetLevels(s, plan, g).some((l) => l > 0)) return "Sell the group's buildings first";
    return null;
  }
  return phaseAllows(s, 'unmortgage') ? null : PHASE_REASON.unmortgage;
}

export function toggleMortgage(s: GameState, seat: SeatId, plan: Plan, space: number): Plan {
  const on = !targetMortgaged(s, plan, space);
  let next: Plan = { ...plan, mortgage: { ...plan.mortgage, [space]: on } };
  // Mortgaging again drops builds staged on the group: they would need the mortgage lifted.
  const g = groupOfSpace(boardOf(s), space);
  if (on && g && next.levels[g.id]) {
    const now = levelsNow(s, g);
    const capped = next.levels[g.id]!.map((l, i) => Math.min(l, now[i] ?? 0));
    next = { ...next, levels: { ...next.levels, [g.id]: capped } };
  }
  return normalizePlan(s, seat, next);
}

const stepCost = (sp: StreetDef, level: number): number => (level === 5 ? sp.hotel ?? sp.house : sp.house);
const houses = (l: number) => (l <= 4 ? l : 0);
const hotels = (l: number) => (l === 5 ? 1 : 0);

/**
 * A build's steps in the engine's order (src/rules/buildings.ts planBuild): always a lowest street that still has
 * further to go. Each step to 1-4 takes a house from the bank; a step to 5 takes a hotel and gives 4 houses back.
 */
function buildSteps(from: readonly number[], target: readonly number[]): number[] {
  const cur = [...from];
  const out: number[] = [];
  for (;;) {
    const min = Math.min(...cur);
    const i = cur.findIndex((l, j) => l === min && (target[j] ?? 0) > l);
    if (i < 0) return out;
    cur[i] = (cur[i] ?? 0) + 1;
    out.push(cur[i]!);
  }
}

/** Houses a build takes from the bank in all (negative: hotels give back more than it takes) */
const houseDemand = (from: readonly number[], target: readonly number[]): number =>
  buildSteps(from, target).reduce((n, to) => n + (to === 5 ? -4 : 1), 0);

interface PlannedBuild {
  action: Extract<Action, { k: 'build' }>;
  from: number[];
}

/** The plan's per-group sales (down to the lower of now and target) and builds (from there up to the target) */
function groupChanges(s: GameState, p: Plan): { sells: Extract<Action, { k: 'sell' }>[]; builds: PlannedBuild[] } {
  const sells: Extract<Action, { k: 'sell' }>[] = [];
  const builds: PlannedBuild[] = [];
  for (const g of streetGroups(boardOf(s)).filter((x) => p.levels[x.id])) {
    const now = levelsNow(s, g);
    const target = p.levels[g.id]!;
    const low = now.map((l, i) => Math.min(l, target[i] ?? 0));
    if (!sameLevels(low, now)) sells.push({ k: 'sell', group: g.id, levels: low });
    if (!sameLevels(low, target)) builds.push({ action: { k: 'build', group: g.id, levels: [...target] }, from: low });
  }
  // Builds that hand houses back (hotels going up) before builds that only take them: in a shortage, the houses a
  // hotel frees are what the other group's houses are built from
  builds.sort((x, y) => houseDemand(x.from, x.action.levels) - houseDemand(y.from, y.action.levels));
  return { sells, builds };
}

/**
 * The engine actions for the plan, in an order where each one can succeed: sales first (raising cash and
 * clearing groups for mortgaging), then mortgages, then lifts (which need the cash), then builds (which need
 * the group unmortgaged; those freeing houses first). A group with some streets up and some down sells to the
 * lower of each first.
 */
export function planActions(s: GameState, seat: SeatId, plan: Plan): Action[] {
  const p = normalizePlan(s, seat, plan);
  const { sells, builds } = groupChanges(s, p);
  const spaces = Object.keys(p.mortgage).map(Number).sort((x, y) => x - y);
  const mortgages: Action[] = spaces.filter((i) => p.mortgage[i]).map((space) => ({ k: 'mortgage', space }));
  const lifts: Action[] = spaces.filter((i) => !p.mortgage[i]).map((space) => ({ k: 'unmortgage', space }));
  return [...sells, ...mortgages, ...lifts, ...builds.map((x) => x.action)];
}

export interface PlanSummary {
  /** Cash change: + raised (sales, mortgages), − spent (lifts, buildings) */
  cash: number;
  /** The bank's stock once the plan is done */
  bankHouses: number;
  bankHotels: number;
  /** Why Apply would fail as staged (cash, bank stock) */
  problems: string[];
  actions: Action[];
}

export function planSummary(s: GameState, seat: SeatId, plan: Plan): PlanSummary {
  const p = normalizePlan(s, seat, plan);
  const b = boardOf(s);
  let cash = 0;
  let bankHouses = s.bank.houses;
  let bankHotels = s.bank.hotels;
  for (const g of streetGroups(b)) {
    const target = p.levels[g.id];
    if (!target) continue;
    g.spaces.forEach((space, i) => {
      const sp = b.spaces[space] as StreetDef;
      const from = levelOf(s, space);
      const to = target[i] ?? from;
      for (let l = from; l > to; l--) cash += Math.floor(stepCost(sp, l) / 2);
      for (let l = from + 1; l <= to; l++) cash -= stepCost(sp, l);
      bankHouses += houses(from) - houses(to);
      bankHotels += hotels(from) - hotels(to);
    });
  }
  for (const [key, on] of Object.entries(p.mortgage)) {
    const space = Number(key);
    const sp = b.spaces[space];
    if (!isProperty(sp)) continue;
    cash += on ? sp.mortgage : -unmortgageCost(s, space);
  }
  const problems: string[] = [];
  const have = s.players[seat]?.cash ?? 0;
  if (have + cash < 0) problems.push(`You need ${money(-(have + cash))} more`);
  const stock = bankShortfall(s, p);
  if (bankHouses < 0 || stock === 'houses') problems.push(`The bank has only ${plural(s.bank.houses, 'house')}`);
  if (bankHotels < 0 || stock === 'hotels') problems.push(`The bank has only ${plural(s.bank.hotels, 'hotel')}`);
  return { cash, bankHouses, bankHotels, problems, actions: planActions(s, seat, p) };
}

/**
 * Plays the plan's sales and builds against the bank's stock the way the engine checks them: a sale is one
 * exchange (breaking a hotel needs the houses at once), a build goes step by step. So a group at (3,3,3) going to
 * (4,4,5) needs 3 houses before its hotel gives 4 back, even though it ends up taking only one.
 */
function bankShortfall(s: GameState, p: Plan): 'houses' | 'hotels' | null {
  const { sells, builds } = groupChanges(s, p);
  const b = boardOf(s);
  let housesLeft = s.bank.houses;
  let hotelsLeft = s.bank.hotels;
  for (const sell of sells) {
    const g = streetGroups(b).find((x) => x.id === sell.group)!;
    const now = levelsNow(s, g);
    housesLeft += now.reduce((n, l, i) => n + houses(l) - houses(sell.levels[i] ?? 0), 0);
    hotelsLeft += now.reduce((n, l, i) => n + hotels(l) - hotels(sell.levels[i] ?? 0), 0);
    if (housesLeft < 0) return 'houses';
  }
  for (const build of builds) {
    for (const to of buildSteps(build.from, build.action.levels)) {
      if (to === 5) {
        if (hotelsLeft < 1) return 'hotels';
        hotelsLeft--;
        housesLeft += 4;
      } else {
        if (housesLeft < 1) return 'houses';
        housesLeft--;
      }
    }
  }
  return null;
}
