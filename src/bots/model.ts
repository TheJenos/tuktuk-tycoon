import {
  activeSeats,
  boardOf,
  isProperty,
  isStreet,
  type BoardDef,
  type Bundle,
  type GameState,
  type PropertyDef,
  type SeatId,
  type StreetDef,
} from '../rules';
import { landingTable, twoDice } from './landingProb';
import type { Profile } from './profile';

/*
 * The bots' picture of the game: a small mutable copy of ownership, levels and cash (so what-ifs such as "after
 * this trade" cost an array copy, not a state clone) and one valuation, value(), that every policy shares. Value is
 * in rupees: cash + property at its printed price + expected rent over a horizon + what a set is still worth
 * developing + the option of completing a set later. On Hero League the value is score-aware instead (heroesValue):
 * cash + the points per location + power-ups until every location is saved. Only public information is used.
 */

export interface GroupInfo {
  id: string;
  /** Position in BoardInfo.groups */
  idx: number;
  spaces: number[];
  house: number;
  /** Rent per turn of the whole set at DEV_LEVEL houses, weighted and flat landing */
  devRent: { weighted: number; flat: number };
  /** What taking every street to DEV_LEVEL houses costs */
  devCost: number;
}

export interface BoardInfo {
  b: BoardDef;
  n: number;
  /** Expected landings per turn: from the landing table, and flat (every square alike) */
  weighted: number[];
  flat: number[];
  props: number[];
  /** Colour group by space (streets only) */
  groupAt: (GroupInfo | undefined)[];
  groups: GroupInfo[];
}

/**
 * Opponent turns of rent a property is valued over: a discounted horizon that grows with the table (more rivals
 * pay rent each round, but a big table also ends sooner), cut short by a turn limit.
 */
const horizon = (opponents: number): number => 40 + 8 * (opponents - 1);
/** Rent counts at this share (uncertainty, and money later is worth less than money now) */
const INCOME_W = 0.6;
/** Share of a set's development profit counted before it is built */
const DEV_W = 0.8;
/** Share of a full set's development value counted for the chance of completing it later */
const OPTION_W = 0.5;
/** Development is valued up to this many houses per street (the best return per rupee) */
const DEV_LEVEL = 3;
/** Hero League: power-ups count at this share (the end is near and fairly well known, so less is discounted) */
const HEROES_INCOME_W = 0.8;
/** Hero League: share of a pair's doubling counted while its other half is villain-held (saved later, or never) */
const PAIR_W = 0.5;
/**
 * Hero League: locations are saved this much faster than landings alone would (Hero HQ's walks to the next villain-held
 * location, Viper Strike's extra spaces): bot games end after about 0.8 of the turns the landing rates give
 */
const SAVE_PACE = 1.25;

const infos = new Map<string, BoardInfo>();

export function boardInfo(b: BoardDef): BoardInfo {
  const hit = infos.get(b.id);
  if (hit) return hit;
  const table = landingTable(b);
  const n = b.spaces.length;
  const flat = new Array<number>(n).fill(table.rollsPerTurn / n);
  const devRent = (spaces: number[], land: number[]): number =>
    spaces.reduce((a, x) => a + ((b.spaces[x] as StreetDef).rent[DEV_LEVEL] ?? 0) * (land[x] ?? 0), 0);
  const groups: GroupInfo[] = b.groups
    .filter((g) => g.spaces.every((space) => isStreet(b.spaces[space])))
    .map((g, idx) => ({
      id: g.id,
      idx,
      spaces: [...g.spaces],
      house: (b.spaces[g.spaces[0] as number] as StreetDef).house,
      devRent: { weighted: devRent(g.spaces, table.perTurn), flat: devRent(g.spaces, flat) },
      devCost: g.spaces.reduce((a, x) => a + DEV_LEVEL * (b.spaces[x] as StreetDef).house, 0),
    }));
  const groupAt: (GroupInfo | undefined)[] = new Array(n).fill(undefined);
  for (const g of groups) for (const space of g.spaces) groupAt[space] = g;
  const info: BoardInfo = {
    b,
    n,
    weighted: table.perTurn,
    flat,
    props: b.spaces.flatMap((sp, i) => (isProperty(sp) ? [i] : [])),
    groupAt,
    groups,
  };
  infos.set(b.id, info);
  return info;
}

export interface Model {
  info: BoardInfo;
  owner: (SeatId | undefined)[];
  level: number[];
  mort: boolean[];
  cash: Partial<Record<SeatId, number>>;
  active: SeatId[];
  bankHouses: number;
  bankHotels: number;
  /** Opponent turns of rent the valuation counts (shorter near a turn limit) */
  oppTurns: number;
  /** Turns (every seat's) the game is expected to last: to the turn limit, and on Hero League until every location is
   *  saved (Infinity without either) */
  turnsLeft: number;
  mortgagePct: number;
  /** Owners who collect no rent right now (jailed with the jailRent rule off) */
  noRent: SeatId[];
}

export function modelOf(s: GameState): Model {
  const info = boardInfo(boardOf(s));
  const owner: (SeatId | undefined)[] = new Array(info.n).fill(undefined);
  const level = new Array<number>(info.n).fill(0);
  const mort = new Array<boolean>(info.n).fill(false);
  for (const [key, ps] of Object.entries(s.props)) {
    if (!ps) continue;
    const space = Number(key.slice(1));
    owner[space] = ps.owner;
    level[space] = ps.level;
    mort[space] = !!ps.mortgaged;
  }
  const active = activeSeats(s);
  const cash: Partial<Record<SeatId, number>> = {};
  for (const seat of active) cash[seat] = s.players[seat]?.cash ?? 0;
  const opponents = Math.max(1, active.length - 1);
  // Of the turns left before a turn limit, all but the bot's own are opponents' turns
  const left = s.cfg.turnLimit > 0 ? ((s.cfg.turnLimit - s.turn.no) * opponents) / (opponents + 1) : Infinity;
  const limit = s.cfg.turnLimit > 0 ? s.cfg.turnLimit - s.turn.no : Infinity;
  const free = info.props.filter((x) => owner[x] === undefined);
  const turnsLeft = info.b.heroes ? Math.min(limit, turnsToSaveAll(info, free)) : limit;
  return {
    info,
    owner,
    level,
    mort,
    cash,
    active,
    bankHouses: s.bank.houses,
    bankHotels: s.bank.hotels,
    // Hero League: the game runs until the last location is saved
    oppTurns: info.b.heroes ? (turnsLeft * opponents) / (opponents + 1) : Math.max(1, Math.min(horizon(opponents), left)),
    turnsLeft,
    mortgagePct: s.cfg.mortgagePct,
    noRent: s.cfg.jailRent ? [] : active.filter((seat) => !!s.players[seat]?.jail),
  };
}

export const cloneModel = (m: Model): Model => ({
  ...m,
  owner: [...m.owner],
  level: [...m.level],
  mort: [...m.mort],
  cash: { ...m.cash },
});

export const landOf = (m: Model, prof: Profile): number[] => (prof.weighted ? m.info.weighted : m.info.flat);
export const propAt = (m: Model, space: number): PropertyDef | undefined => {
  const sp = m.info.b.spaces[space];
  return isProperty(sp) ? sp : undefined;
};
export const streetAt = (m: Model, space: number): StreetDef | undefined => {
  const sp = m.info.b.spaces[space];
  return isStreet(sp) ? sp : undefined;
};
export const cashOf = (m: Model, seat: SeatId): number => m.cash[seat] ?? 0;
export const interestOn = (m: Model, mortgage: number): number => Math.ceil((mortgage * m.mortgagePct) / 100);
export const liftCost = (m: Model, space: number): number => {
  const mv = propAt(m, space)?.mortgage ?? 0;
  return mv + interestOn(m, mv);
};
export const ownedBy = (m: Model, seat: SeatId): number[] => m.info.props.filter((x) => m.owner[x] === seat);
export const ownsGroup = (m: Model, seat: SeatId, g: GroupInfo): boolean => g.spaces.every((x) => m.owner[x] === seat);
export const groupBuilt = (m: Model, g: GroupInfo): boolean => g.spaces.some((x) => (m.level[x] ?? 0) > 0);
/** A complete set with no mortgages: houses can go up */
export const buildable = (m: Model, seat: SeatId, g: GroupInfo): boolean =>
  ownsGroup(m, seat, g) && g.spaces.every((x) => !m.mort[x]);

function countKind(m: Model, seat: SeatId, kind: 'rail' | 'utility'): number {
  let k = 0;
  for (const x of m.info.props) if (m.owner[x] === seat && m.info.b.spaces[x]?.k === kind) k++;
  return k;
}

/** Rent a visitor pays on `space` now (utilities at an average throw of 7); `level` overrides for what-ifs */
export function rentAt(m: Model, space: number, level = m.level[space] ?? 0): number {
  const o = m.owner[space];
  const sp = propAt(m, space);
  if (!o || !sp || m.mort[space]) return 0;
  const b = m.info.b;
  if (sp.k === 'street') {
    if (level > 0) return sp.rent[level] ?? 0;
    const g = m.info.groupAt[space];
    const base = sp.rent[0] ?? 0;
    return g && ownsGroup(m, o, g) ? base * 2 : base;
  }
  const count = countKind(m, o, sp.k);
  return sp.k === 'rail' ? (b.railRent[count - 1] ?? 0) : 7 * (b.utilityMul[count - 1] ?? 0);
}

/** Rupees per unit of (rent x landings per turn): the opponent turns counted, discounted */
const flow = (m: Model): number => m.oppTurns * (m.info.b.heroes ? HEROES_INCOME_W : INCOME_W);

const saveWaits = new Map<string, number>();

/**
 * Hero League: the turns (every seat's) until every one of `free` (villain-held locations) is saved. Each is saved
 * about the first time anyone lands on it, so this is the expected wait for the last of them: the integral of
 * P(some still free) = 1 - prod(1 - e^(-rate t)) over t, with the landing rates per turn (sped up by SAVE_PACE).
 * Memoized per board and set.
 */
function turnsToSaveAll(info: BoardInfo, free: number[]): number {
  if (free.length === 0) return 0;
  const key = `${info.b.id}:${free.join(',')}`;
  const hit = saveWaits.get(key);
  if (hit !== undefined) return hit;
  const rates = free.map((x) => info.weighted[x] ?? 0).filter((r) => r > 0);
  let wait = 0;
  const dt = 0.5;
  for (let t = dt / 2; rates.length > 0 && t < 5000; t += dt) {
    let allSaved = 1;
    for (const r of rates) allSaved *= 1 - Math.exp(-r * t);
    const tail = 1 - allSaved;
    wait += tail * dt;
    if (tail < 1e-5) break;
  }
  wait /= SAVE_PACE;
  saveWaits.set(key, wait);
  return wait;
}

function buildingCost(sp: StreetDef, level: number): number {
  let total = 0;
  for (let l = 1; l <= level; l++) total += l === 5 ? (sp.hotel ?? sp.house) : sp.house;
  return total;
}

/** Cash a seat could still raise by mortgaging property outside its complete sets (funding for houses) */
function looseMortgage(m: Model, seat: SeatId): number {
  let total = 0;
  for (const x of ownedBy(m, seat)) {
    const g = m.info.groupAt[x];
    if (m.mort[x] || (g && ownsGroup(m, seat, g))) continue;
    total += propAt(m, x)?.mortgage ?? 0;
  }
  return total;
}

/** What developing a complete set up to DEV_LEVEL is still worth (profit over the horizon, net of the houses) */
function devValue(m: Model, seat: SeatId, g: GroupInfo, land: number[]): number {
  let gain = 0;
  let cost = 0;
  for (const x of g.spaces) {
    const sp = streetAt(m, x);
    const l = m.level[x] ?? 0;
    if (!sp || l >= DEV_LEVEL) continue;
    const now = l > 0 ? (sp.rent[l] ?? 0) : 2 * (sp.rent[0] ?? 0);
    gain += ((sp.rent[DEV_LEVEL] ?? 0) - now) * (land[x] ?? 0);
    cost += (DEV_LEVEL - l) * sp.house;
  }
  if (cost === 0) return 0;
  const profit = gain * flow(m) - cost;
  if (profit <= 0) return 0;
  const funds = cashOf(m, seat) + 0.5 * looseMortgage(m, seat);
  const fundable = Math.max(0.25, Math.min(1, funds / cost));
  const mortgaged = g.spaces.some((x) => m.mort[x]) ? 0.7 : 1;
  return profit * DEV_W * fundable * mortgaged;
}

/** The development profit of a whole set for whoever completes it */
const fullSetValue = (m: Model, g: GroupInfo, weighted: boolean): number =>
  Math.max(0, (weighted ? g.devRent.weighted : g.devRent.flat) * flow(m) - g.devCost);

/** The chance-weighted value of completing a set the seat holds part of */
function optionValue(m: Model, seat: SeatId, g: GroupInfo, weighted: boolean): number {
  let p = 1;
  const holders = new Set<SeatId>();
  for (const x of g.spaces) {
    const o = m.owner[x];
    if (o === seat) continue;
    if (o === undefined) p *= 0.35;
    else {
      p *= 0.12;
      holders.add(o);
    }
  }
  // Pieces spread over several rivals are much harder to collect
  if (holders.size > 1) p *= 0.5;
  return p * fullSetValue(m, g, weighted) * OPTION_W;
}

/** The bot's worth of a seat's position, in rupees (Hero League: in Power, score-aware) */
export function value(m: Model, seat: SeatId, prof: Profile): number {
  if (m.info.b.heroes) return heroesValue(m, seat, prof);
  const info = m.info;
  const b = info.b;
  const land = landOf(m, prof);
  const f = flow(m);
  let rails = 0;
  let utils = 0;
  for (const x of info.props) {
    if (m.owner[x] !== seat) continue;
    const k = b.spaces[x]?.k;
    if (k === 'rail') rails++;
    else if (k === 'utility') utils++;
  }
  let v = cashOf(m, seat);
  const complete: boolean[] = [];
  for (const g of info.groups) {
    let k = 0;
    for (const x of g.spaces) if (m.owner[x] === seat) k++;
    complete[g.idx] = k === g.spaces.length;
    if (k === g.spaces.length) v += devValue(m, seat, g, land);
    else if (k > 0) v += optionValue(m, seat, g, prof.weighted);
  }
  for (const x of info.props) {
    if (m.owner[x] !== seat) continue;
    const sp = b.spaces[x] as PropertyDef;
    let rent: number;
    if (sp.k === 'street') {
      const l = m.level[x] ?? 0;
      const g = info.groupAt[x];
      rent = l > 0 ? (sp.rent[l] ?? 0) : (sp.rent[0] ?? 0) * (g && complete[g.idx] ? 2 : 1);
      v += 0.6 * buildingCost(sp, l);
    } else if (sp.k === 'rail') rent = b.railRent[rails - 1] ?? 0;
    else rent = 7 * (b.utilityMul[utils - 1] ?? 0);
    // Mortgaged: worth its lifted value, and half its rent (it can be lifted later)
    if (m.mort[x]) v += sp.price - liftCost(m, x) + 0.5 * rent * (land[x] ?? 0) * f;
    else v += sp.price + rent * (land[x] ?? 0) * f;
  }
  return v;
}

/**
 * Hero League: what the seat would score now (cash + locationPoints per location) plus the power-ups its locations
 * should bring in until every location is saved (doubled for a pair), plus a share of a pair's doubling while its
 * other half is still villain-held (whoever lands there first saves it, so about one chance in the table's size).
 * Nothing can be built, mortgaged or sold, so a location is worth its points, not its cost. Once every location is
 * saved this is the final score.
 */
function heroesValue(m: Model, seat: SeatId, prof: Profile): number {
  const land = landOf(m, prof);
  const f = flow(m);
  const points = m.info.b.heroes?.locationPoints ?? 0;
  const base = (x: number): number => (streetAt(m, x)?.rent[0] ?? 0) * (land[x] ?? 0);
  let v = cashOf(m, seat);
  for (const g of m.info.groups) {
    let mine = 0;
    let free = 0;
    for (const x of g.spaces) {
      if (m.owner[x] === seat) mine++;
      else if (m.owner[x] === undefined) free++;
    }
    if (mine === 0) continue;
    const pair = mine === g.spaces.length;
    for (const x of g.spaces) if (m.owner[x] === seat) v += points + base(x) * (pair ? 2 : 1) * f;
    if (!pair && mine + free === g.spaces.length) {
      const doubling = g.spaces.reduce((a, x) => a + base(x), 0);
      v += (PAIR_W * doubling * f) / Math.max(1, m.active.length);
    }
  }
  return v;
}

/** `seat`'s value with `space` handed to `to` (undefined = the bank) */
export function valueWith(m: Model, seat: SeatId, space: number, to: SeatId | undefined, prof: Profile): number {
  const before = m.owner[space];
  const mort = m.mort[space] ?? false;
  m.owner[space] = to;
  if (before === undefined) m.mort[space] = false;
  const v = value(m, seat, prof);
  m.owner[space] = before;
  m.mort[space] = mort;
  return v;
}

/** The set `space` belongs to would be complete for `seat` if it owned `space` */
export function completesSet(m: Model, seat: SeatId, space: number): boolean {
  const g = m.info.groupAt[space];
  return !!g && g.spaces.every((x) => x === space || m.owner[x] === seat);
}

/** Some opponent owns every other street of the group */
export function blocksSet(m: Model, seat: SeatId, space: number): boolean {
  const g = m.info.groupAt[space];
  if (!g) return false;
  const others = g.spaces.filter((x) => x !== space).map((x) => m.owner[x]);
  const first = others[0];
  return first !== undefined && first !== seat && others.every((o) => o === first);
}

/**
 * What owning a bank property is worth to `seat`: its own gain, plus (scaled by `blockW`) the most any rival
 * would gain from it beyond the price, since a property the bot passes on usually ends up with someone else.
 */
export function worthToMe(m: Model, seat: SeatId, space: number, prof: Profile, blockW: number): number {
  const base = value(m, seat, prof);
  const mine = valueWith(m, seat, space, seat, prof) - base;
  if (blockW <= 0) return mine;
  const price = propAt(m, space)?.price ?? 0;
  let rival = 0;
  for (const o of m.active) {
    if (o === seat) continue;
    const gain = valueWith(m, o, space, o, prof) - value(m, o, prof) - price;
    rival = Math.max(rival, gain);
  }
  return mine + blockW * rival;
}

/** Expected rent per turn `seat` pays walking the board as it stands */
export function danger(m: Model, seat: SeatId, prof: Profile): number {
  const land = landOf(m, prof);
  let d = 0;
  for (const x of m.info.props) {
    const o = m.owner[x];
    if (o && o !== seat) d += rentAt(m, x) * (land[x] ?? 0);
  }
  return d;
}

/** Rent owed on landing at `space` (0 on own, bank or mortgaged property, or an owner jailed with jailRent off) */
export const rentOwed = (m: Model, seat: SeatId, space: number): number => {
  const o = m.owner[space];
  return o && o !== seat && !m.noRent.includes(o) ? rentAt(m, space) : 0;
};

/** Cash the bot keeps back: a base, the rent one throw away (expected and worst), two turns of expected rent */
export function reserve(m: Model, seat: SeatId, pos: number, prof: Profile): number {
  if (prof.reserveBase === 0 && prof.reserveExp === 0 && prof.reserveMax === 0) return 0;
  let exp = 0;
  let worst = 0;
  for (let d = 2; d <= 12; d++) {
    const r = rentOwed(m, seat, (pos + d) % m.info.n);
    exp += twoDice(d) * r;
    worst = Math.max(worst, r);
  }
  return Math.round(prof.reserveBase + prof.reserveExp * (exp + 2 * danger(m, seat, prof)) + prof.reserveMax * worst);
}

/** The model after a trade between two seats (mortgaged property received pays its 10% at once) */
export function afterTrade(m: Model, from: SeatId, to: SeatId, give: Bundle, get: Bundle): Model {
  const next = cloneModel(m);
  const move = (a: SeatId, z: SeatId, bd: Bundle): void => {
    next.cash[a] = cashOf(next, a) - bd.cash;
    next.cash[z] = cashOf(next, z) + bd.cash;
    for (const x of bd.props) {
      next.owner[x] = z;
      if (next.mort[x]) next.cash[z] = cashOf(next, z) - interestOn(next, propAt(next, x)?.mortgage ?? 0);
    }
  };
  move(from, to, give);
  move(to, from, get);
  return next;
}

/** A Get Out of Jail Free card, in rupees (it saves the fine, and can be sold) */
export const CARD_VALUE = 40;
