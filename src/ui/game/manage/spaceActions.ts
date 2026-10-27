import {
  boardOf,
  buildOptions,
  canMortgage,
  canSellProperty,
  canUnmortgage,
  isProperty,
  isStreet,
  sellPropertyValue,
  unmortgageCost,
  type Action,
  type GameState,
  type SeatId,
  type StreetDef,
} from '../../../rules';
import { groupOfSpace, phaseAllows } from './buildPlan';

/*
 * The one-click property actions of the tile inspector (pure): for one space of one seat, the single-step build
 * and sale that change only this street by one level, its mortgage or lift, and selling it back to the bank, each
 * with the engine's action, the amount and why it can't be done now. Legality comes from the engine (buildOptions,
 * canMortgage, canUnmortgage, canSellProperty); the reasons name what to do first ("Build evenly: Hoppers Corner
 * first", "Sell the buildings in the Brown group first").
 */

export interface StepAction {
  /** The engine action to send for the seat; null when it can't be done now */
  action: Action | null;
  /** Why not (null when `action` is set) */
  reason: string | null;
  /** Rulebook units: what it costs (build, lift) or raises (sell, mortgage) */
  amount: number;
}

export interface SpaceActions {
  seat: SeatId;
  /** Streets below a hotel: the next house, or the hotel */
  build?: StepAction & { kind: 'house' | 'hotel' };
  /** Streets with buildings: the top one */
  sell?: StepAction & { kind: 'house' | 'hotel' };
  /** Mortgage it, or lift its mortgage */
  mortgage: StepAction & { kind: 'mortgage' | 'unmortgage' };
  /** Sell it back to the bank: 80% of the price, less the loan when it is mortgaged */
  sale: StepAction & { mortgaged: boolean };
}

const stepCost = (sp: StreetDef, level: number): number => (level === 5 ? sp.hotel ?? sp.house : sp.house);
const sameAction = (a: Action, b: Action): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * The property actions `seat` has on `space`; null when it is not the seat's property (or the seat is out), and on
 * Hero League, where a saved location is never built on, mortgaged or sold
 */
export function spaceActions(s: GameState, seat: SeatId, space: number): SpaceActions | null {
  const b = boardOf(s);
  const sp = b.spaces[space];
  const ps = s.props[`p${space}`];
  const p = s.players[seat];
  if (b.heroes || !isProperty(sp) || ps?.owner !== seat || !p || p.out || s.phase.k === 'over') return null;

  const mortgage: SpaceActions['mortgage'] = ps.mortgaged
    ? { kind: 'unmortgage', amount: unmortgageCost(s, space), ...verdict({ k: 'unmortgage', space }, canUnmortgage(s, seat, space)?.message) }
    : { kind: 'mortgage', amount: sp.mortgage, ...verdict({ k: 'mortgage', space }, canMortgage(s, seat, space)?.message) };
  const sale: SpaceActions['sale'] = {
    mortgaged: !!ps.mortgaged,
    amount: sellPropertyValue(s, space),
    ...verdict({ k: 'sellProperty', space }, canSellProperty(s, seat, space)?.message),
  };
  const out: SpaceActions = { seat, mortgage, sale };
  if (!isStreet(sp)) return out;

  const g = groupOfSpace(b, space);
  const opt = buildOptions(s, seat).find((o) => o.group === sp.group);
  if (!g || !opt) return out;
  const k = g.spaces.indexOf(space);
  const levels = opt.levels as number[];
  const level = levels[k] ?? 0;
  const name = (i: number) => b.spaces[i]?.name ?? '';
  const step = (d: number): Action => ({ k: d > 0 ? 'build' : 'sell', group: g.id, levels: levels.map((l, j) => (j === k ? l + d : l)) } as Action);

  if (level < 5) {
    const up = step(1);
    const legal = opt.build.some((x) => x.space === space && sameAction(x.action, up));
    let reason: string | null = null;
    if (!legal) {
      const min = Math.min(...levels);
      const mortgaged = g.spaces.some((i) => s.props[`p${i}`]?.mortgaged);
      if (!opt.complete) reason = 'Own the whole colour group to build';
      else if (!phaseAllows(s, 'build')) reason = 'You can build before or after rolling';
      else if (mortgaged) reason = 'Lift every mortgage in the group first';
      else if (level > min) reason = `Build evenly: ${name(g.spaces[levels.indexOf(min)] as number)} first`;
      else reason = opt.reason ?? 'You cannot build here now';
    }
    out.build = { kind: level === 4 ? 'hotel' : 'house', amount: stepCost(sp, level + 1), action: legal ? up : null, reason };
  }

  if (level > 0) {
    const down = step(-1);
    const legal = opt.sell.some((x) => x.space === space && sameAction(x.action, down));
    let reason: string | null = null;
    if (!legal) {
      const max = Math.max(...levels);
      if (!phaseAllows(s, 'sell')) reason = 'You cannot sell buildings now';
      else if (level < max) reason = `Sell evenly: ${name(g.spaces[levels.indexOf(max)] as number)} first`;
      else if (level === 5 && s.bank.houses < 4) reason = 'The bank has too few houses to break a hotel into houses';
      else reason = 'You cannot sell here now';
    }
    out.sell = { kind: level === 5 ? 'hotel' : 'house', amount: Math.floor(stepCost(sp, level) / 2), action: legal ? down : null, reason };
  }
  return out;
}

function verdict(a: Action, why: string | undefined): { action: Action | null; reason: string | null } {
  return why ? { action: null, reason: why } : { action: a, reason: null };
}
