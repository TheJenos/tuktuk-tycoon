import { isProperty, pathBack, pathForward } from './board';
import { type Ctx, collectsRent, emit, isActive, player, prop, setPhase } from './ctx';
import { recharge } from './heroes';
import { transfer } from './money';
import type { JailReason, MoveVia, SeatId, Step } from './types';

/**
 * GO salary (`mul` 2: landing exactly on GO with cfg.doubleGoLanding). Counts a lap; the first unlocks the Speed Die.
 * Hero League: it also makes a used superpower ready again (not one used during this turn).
 */
export function paySalary(c: Ctx, seat: SeatId, mul = 1): void {
  const amount = c.s.cfg.goSalary * mul;
  emit(c, { t: 'salary', seat, amount });
  transfer(c, 'bank', seat, amount, 'salary');
  const p = player(c.s, seat);
  p.laps++;
  if (c.s.cfg.speedDie && !p.speed) {
    p.speed = true;
    emit(c, { t: 'speedOn', seat });
  }
  if (c.b.heroes) recharge(c, seat, true);
}

/** Walk forward to `to`, collecting salary when passing or landing on GO */
export function moveForward(c: Ctx, seat: SeatId, to: number, via: MoveVia): void {
  const p = player(c.s, seat);
  const from = p.pos;
  const path = pathForward(c.b, from, to);
  p.pos = to;
  emit(c, { t: 'move', seat, from, to, path, via });
  if (path.includes(0)) paySalary(c, seat, to === 0 && c.s.cfg.doubleGoLanding ? 2 : 1);
}

/** Walk back (Go Back 3): never collects salary */
export function moveBack(c: Ctx, seat: SeatId, n: number): void {
  const p = player(c.s, seat);
  const from = p.pos;
  const path = pathBack(c.b, from, n);
  const to = path[path.length - 1] ?? from;
  p.pos = to;
  emit(c, { t: 'move', seat, from, to, path, via: 'back' });
}

/** Straight to jail: no salary, the doubles chain and the rest of the turn (Speed Die moves too) are dropped */
export function sendToJail(c: Ctx, seat: SeatId, reason: JailReason): void {
  const p = player(c.s, seat);
  const from = p.pos;
  const to = c.b.jailIndex;
  p.pos = to;
  p.jail = { tries: 0 };
  emit(c, { t: 'move', seat, from, to, path: [to], via: 'jail' });
  emit(c, { t: 'jail', seat, reason });
  if (c.s.turn.seat !== seat) return;
  c.s.turn.again = false;
  if (c.b.heroes) {
    // Hero League: other heroes' queued work (Hero-die hits, their landings) goes on; only the turn seat's own
    // continuation is dropped, and the turn ends once the queue runs dry.
    c.s.pending = c.s.pending.filter((st) => !ownContinuation(st, seat));
    if (c.s.pending.length > 0) {
      if (c.s.phase.k !== 'busy') setPhase(c, { k: 'busy' });
      return;
    }
  } else c.s.pending = [];
  setPhase(c, { k: 'postRoll' });
}

/** The turn seat's own moves and landings and the end of its roll (what jail drops on a heroes board) */
function ownContinuation(st: Step, seat: SeatId): boolean {
  switch (st.k) {
    case 'move':
    case 'back':
    case 'land':
    case 'uncle':
    case 'throwDone':
      return st.seat === seat;
    case 'afterRoll':
    case 'beforeRoll':
      return true;
    default:
      return false;
  }
}

/** The next space of a kind strictly ahead of `from` */
export function nearest(c: Ctx, from: number, kind: 'rail' | 'utility'): number {
  const n = c.b.spaces.length;
  for (let i = 1; i <= n; i++) {
    const space = (from + i) % n;
    if (c.b.spaces[space]?.k === kind) return space;
  }
  return from;
}

/**
 * Tuk-Tuk Uncle: the next property the bank still owns, strictly ahead (wrapping). `from` itself is checked last, so
 * undefined really means the bank owns none (a property just declined with no bids still counts).
 */
export function nextBankOwned(c: Ctx, from: number): number | undefined {
  const n = c.b.spaces.length;
  for (let i = 1; i <= n; i++) {
    const space = (from + i) % n;
    if (isProperty(c.b.spaces[space]) && !prop(c.s, space)) return space;
  }
  return undefined;
}

/** Tuk-Tuk Uncle when the bank owns nothing: the next property where `seat` would owe another player rent */
export function nextRentOwed(c: Ctx, seat: SeatId, from: number): number | undefined {
  const n = c.b.spaces.length;
  for (let i = 1; i < n; i++) {
    const space = (from + i) % n;
    const ps = prop(c.s, space);
    if (ps && ps.owner !== seat && !ps.mortgaged && isActive(c.s, ps.owner) && collectsRent(c.s, ps.owner)) return space;
  }
  return undefined;
}
