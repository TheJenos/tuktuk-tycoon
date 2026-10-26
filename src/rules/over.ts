import { type Ctx, activeSeats, emit, err, setPhase } from './ctx';
import { type Handler, systemAction } from './handler';
import { netWorth } from './money';
import type { BoardDef, GameState, OverPhase, SeatId } from './types';

/** Best first: seats still in by net worth (ties in turn order), then the others, last out first */
export function ranking(s: GameState, b: BoardDef): SeatId[] {
  const active = activeSeats(s)
    .map((seat, i) => ({ seat, i, w: netWorth(s, b, seat) }))
    .sort((x, y) => y.w - x.w || x.i - y.i)
    .map((x) => x.seat);
  const out = s.order
    .filter((seat) => s.players[seat]?.out)
    .map((seat, i) => ({ seat, i, at: s.players[seat]?.outAt ?? 0 }))
    .sort((x, y) => y.at - x.at || x.i - y.i)
    .map((x) => x.seat);
  return [...active, ...out];
}

export function finish(c: Ctx, why: OverPhase['why']): void {
  const order = ranking(c.s, c.b);
  const winner = order[0] as SeatId;
  c.s.pending = [];
  for (const id of Object.keys(c.s.trades)) {
    delete c.s.trades[id];
    emit(c, { t: 'tradeCancelled', id, why: 'over' });
  }
  setPhase(c, { k: 'over', winner, ranking: order, why });
  emit(c, { t: 'over', winner, ranking: order, why });
}

/**
 * Ends the game when at most one player is left, or (cfg.endMode 'firstBankrupt') when a player just went bankrupt
 * (`bankrupt`: not a resignation). Called after the creditor has received the assets. Returns whether it ended.
 */
export function checkOver(c: Ctx, bankrupt = false): boolean {
  if (c.s.phase.k === 'over') return true;
  if (activeSeats(c.s).length <= 1) finish(c, 'lastStanding');
  else if (bankrupt && c.s.cfg.endMode === 'firstBankrupt') finish(c, 'firstBankrupt');
  else return false;
  return true;
}

/** The room owner's "Finish now": rank everyone by net worth */
export const endGame: Handler<'endGame'> = systemAction(
  () => null,
  (c) => finish(c, 'endGame'),
);

/** The room's time limit ran out (the driver sends it, like endGame): rank everyone by net worth */
export const timeUp: Handler<'timeUp'> = systemAction(
  () => null,
  (c) => finish(c, 'timeUp'),
);

export const overError = err('over', 'The game is over');
