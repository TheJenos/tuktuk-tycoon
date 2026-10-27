import { groupById, hotelCost, isStreet, stepCost } from './board';
import { type Ctx, emit, err, levelOf, player, prop } from './ctx';
import { isInt } from './handler';
import { transfer } from './money';
import type { BoardDef, BuildKind, GameState, GroupDef, Level, RuleError, SeatId, StreetDef } from './types';

/*
 * Houses and hotels. Building is checked one step at a time, always raising a lowest property first, and every
 * step takes a unit from the bank (a hotel step gives 4 houses back). So with a group at (4,4,3) and no houses
 * left, no hotel can go up: the housing shortage is a real strategy. Selling is one simultaneous exchange with the
 * bank, so a group of hotels can always be sold straight down to nothing.
 */

export interface LevelChange {
  space: number;
  from: Level;
  to: Level;
}

export interface BuildPlan {
  group: GroupDef;
  steps: LevelChange[];
  cost: number;
  /** Units taken from the bank, step by step (gross) */
  houses: number;
  hotels: number;
}

export interface SellPlan {
  group: GroupDef;
  changes: LevelChange[];
  refund: number;
  /** Bank supply after the exchange */
  bankHouses: number;
  bankHotels: number;
}

const streetsOf = (b: BoardDef, g: GroupDef): StreetDef[] =>
  g.spaces.map((space) => b.spaces[space]).filter(isStreet);

/** Groups a seat may build on: owns every space, all streets, none mortgaged */
export function buildableGroups(s: GameState, b: BoardDef, seat: SeatId): GroupDef[] {
  return b.groups.filter(
    (g) =>
      streetsOf(b, g).length === g.spaces.length &&
      g.spaces.every((space) => {
        const ps = prop(s, space);
        return ps?.owner === seat && !ps.mortgaged;
      }),
  );
}

export const groupLevels = (s: GameState, g: GroupDef): Level[] => g.spaces.map((space) => levelOf(s, space) as Level);

const even = (levels: number[]): boolean => Math.max(...levels) - Math.min(...levels) <= 1;

/** Hero League: no houses or hotels */
export const NO_BUILDINGS = err('heroes', 'There are no buildings on this board');

function checkTargets(
  s: GameState,
  b: BoardDef,
  seat: SeatId,
  groupId: unknown,
  levels: unknown,
): { g: GroupDef; target: Level[] } | RuleError {
  if (b.heroes) return NO_BUILDINGS;
  const g = typeof groupId === 'string' ? groupById(b, groupId) : undefined;
  if (!g) return err('badGroup', 'No such colour group');
  if (streetsOf(b, g).length !== g.spaces.length) return err('badGroup', 'Only streets take buildings');
  const valid = Array.isArray(levels) && levels.every((l) => isInt(l) && l >= 0 && l <= 5);
  if (!valid || levels.length !== g.spaces.length) {
    return err('badLevels', 'Give a level from 0 to 5 for every street of the group');
  }
  if (!g.spaces.every((space) => prop(s, space)?.owner === seat)) {
    return err('notOwner', 'You must own the whole group');
  }
  if (!even(levels)) return err('uneven', 'Build and sell evenly: no street more than one level from the others');
  return { g, target: levels as Level[] };
}

export function planBuild(
  s: GameState,
  b: BoardDef,
  seat: SeatId,
  groupId: unknown,
  levels: unknown,
): BuildPlan | RuleError {
  const t = checkTargets(s, b, seat, groupId, levels);
  if ('code' in t) return t;
  const { g, target } = t;
  if (g.spaces.some((space) => prop(s, space)?.mortgaged)) {
    return err('mortgaged', 'Lift every mortgage in the group first');
  }
  const cur = groupLevels(s, g);
  if (target.some((l, i) => l < (cur[i] ?? 0))) {
    return err('badLevels', 'Building only raises levels; sell to lower them');
  }
  if (target.every((l, i) => l === cur[i])) return err('noChange', 'Nothing to build');

  let houses = s.bank.houses;
  let hotels = s.bank.hotels;
  const plan: BuildPlan = { group: g, steps: [], cost: 0, houses: 0, hotels: 0 };
  for (;;) {
    const min = Math.min(...cur);
    // Always raise a lowest street that still has further to go; with an even target one always exists.
    const i = cur.findIndex((l, j) => l === min && (target[j] ?? 0) > l);
    if (i < 0) break;
    const space = g.spaces[i] as number;
    const from = cur[i] as Level;
    const to = (from + 1) as Level;
    if (to <= 4) {
      if (houses < 1) return err('noHouses', 'The bank has no houses left');
      houses--;
      plan.houses++;
    } else {
      if (hotels < 1) return err('noHotels', 'The bank has no hotels left');
      hotels--;
      houses += 4;
      plan.hotels++;
    }
    plan.cost += stepCost(b.spaces[space] as StreetDef, to);
    plan.steps.push({ space, from, to });
    cur[i] = to;
  }
  if (cur.some((l, i) => l !== target[i])) return err('uneven', 'Build evenly across the group');
  return plan;
}

export function planSell(
  s: GameState,
  b: BoardDef,
  seat: SeatId,
  groupId: unknown,
  levels: unknown,
): SellPlan | RuleError {
  const t = checkTargets(s, b, seat, groupId, levels);
  if ('code' in t) return t;
  const { g, target } = t;
  const cur = groupLevels(s, g);
  if (target.some((l, i) => l > (cur[i] ?? 0))) return err('badLevels', 'Selling only lowers levels');
  if (target.every((l, i) => l === cur[i])) return err('noChange', 'Nothing to sell');
  const housesOn = (ls: number[]): number => ls.reduce<number>((a, l) => a + (l <= 4 ? l : 0), 0);
  const hotelsOn = (ls: number[]): number => ls.filter((l) => l === 5).length;
  const bankHouses = s.bank.houses + housesOn(cur) - housesOn(target);
  const bankHotels = s.bank.hotels + hotelsOn(cur) - hotelsOn(target);
  if (bankHouses < 0) return err('noHouses', 'The bank has too few houses to break a hotel into houses');
  const plan: SellPlan = { group: g, changes: [], refund: 0, bankHouses, bankHotels };
  g.spaces.forEach((space, i) => {
    const from = cur[i] as Level;
    const to = target[i] as Level;
    if (from === to) return;
    const sp = b.spaces[space] as StreetDef;
    for (let l = from; l > to; l--) plan.refund += Math.floor(stepCost(sp, l) / 2);
    plan.changes.push({ space, from, to });
  });
  return plan;
}

function setLevel(c: Ctx, space: number, to: Level): void {
  const ps = prop(c.s, space);
  if (!ps) return;
  const from = ps.level;
  ps.level = to;
  emit(c, { t: 'level', space, from, to, bank: { ...c.s.bank } });
}

/** Puts up a planned build (the caller checked cash and the contest) */
export function applyBuild(c: Ctx, seat: SeatId, plan: BuildPlan): void {
  for (const st of plan.steps) {
    if (st.to === 5) {
      c.s.bank.hotels--;
      c.s.bank.houses += 4;
    } else c.s.bank.houses--;
    setLevel(c, st.space, st.to);
  }
  transfer(c, seat, 'bank', plan.cost, 'build');
}

export function applySell(c: Ctx, seat: SeatId, plan: SellPlan): void {
  c.s.bank.houses = plan.bankHouses;
  c.s.bank.hotels = plan.bankHotels;
  for (const ch of plan.changes) setLevel(c, ch.space, ch.to);
  transfer(c, 'bank', seat, plan.refund, 'sell');
}

/** Clears every building on these spaces, returning the units to the bank. Returns their half-price value. */
export function clearBuildings(c: Ctx, spaces: number[]): number {
  let value = 0;
  for (const space of spaces) {
    const ps = prop(c.s, space);
    const sp = c.b.spaces[space];
    if (!ps || !isStreet(sp) || ps.level === 0) continue;
    if (ps.level === 5) c.s.bank.hotels++;
    else c.s.bank.houses += ps.level;
    for (let l = ps.level; l > 0; l--) value += Math.floor(stepCost(sp, l) / 2);
    setLevel(c, space, 0);
  }
  return value;
}

/**
 * How many units of a kind a seat could want right now: houses up to 4 on every buildable street, or hotels on
 * streets whose whole group already has 4 houses; limited by cash (cheapest groups first), not by the bank.
 */
export function capacity(s: GameState, b: BoardDef, seat: SeatId, kind: BuildKind): number {
  if (b.heroes) return 0;
  let cash = player(s, seat).cash;
  let units = 0;
  const groups = buildableGroups(s, b, seat)
    .map((g) => ({ g, sp: b.spaces[g.spaces[0] as number] as StreetDef }))
    .sort((x, y) => x.sp.house - y.sp.house);
  for (const { g, sp } of groups) {
    const levels = groupLevels(s, g);
    const room =
      kind === 'house'
        ? levels.reduce<number>((a, l) => a + Math.max(0, 4 - l), 0)
        : Math.min(...levels) >= 4
          ? levels.filter((l) => l === 4).length
          : 0;
    const cost = kind === 'house' ? sp.house : hotelCost(sp);
    const take = Math.min(room, Math.floor(cash / cost));
    units += take;
    cash -= take * cost;
  }
  return units;
}

/** Streets where one unit of `kind` could go up now (even building, bank supply, and the price if `needCash`) */
export function placeSites(s: GameState, b: BoardDef, seat: SeatId, kind: BuildKind, needCash: boolean): number[] {
  if (kind === 'house' ? s.bank.houses < 1 : s.bank.hotels < 1) return [];
  const cash = player(s, seat).cash;
  const out: number[] = [];
  for (const g of buildableGroups(s, b, seat)) {
    const levels = groupLevels(s, g);
    const min = Math.min(...levels);
    g.spaces.forEach((space, i) => {
      const l = levels[i] as number;
      const ok = kind === 'house' ? l < 4 && l === min : l === 4 && min >= 4;
      if (ok && (!needCash || cash >= stepCost(b.spaces[space] as StreetDef, l + 1))) out.push(space);
    });
  }
  return out.sort((x, y) => x - y);
}

/** Puts one unit up on a site from placeSites(). `pay`: charge the normal price (granted, not auctioned, units). */
export function placeUnit(c: Ctx, seat: SeatId, space: number, pay: boolean): void {
  const level = levelOf(c.s, space);
  const to = (level + 1) as Level;
  if (to === 5) {
    c.s.bank.hotels--;
    c.s.bank.houses += 4;
  } else c.s.bank.houses--;
  setLevel(c, space, to);
  if (pay) transfer(c, seat, 'bank', stepCost(c.b.spaces[space] as StreetDef, to), 'build', space);
}
