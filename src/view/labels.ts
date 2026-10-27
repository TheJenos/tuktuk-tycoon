import { boardMoney, heroOf, owedTotal, type GameEvent, type GameState } from '../rules';

/*
 * What a floating label says over a token for Hero League's events (pure): a superpower used, one ready again, a
 * location nobody could save, a payment that fell short. `game` is the displayed state as the event starts.
 */

type Ev<T extends GameEvent['t']> = Extract<GameEvent, { t: T }>;

/** How many extra spaces a Viper Strike walks: its walk (the next move of that seat in the batch) past the dice */
function stingSteps(ev: Ev<'power'>, game: GameState | null, next: readonly GameEvent[]): number {
  const walk = next.find((e): e is Ev<'move'> => e.t === 'move' && e.seat === ev.seat);
  if (!walk || !game) return 0;
  const roll = game.turn.roll;
  const dice = game.phase.k === 'boost' ? game.phase.total : roll ? roll.w[0] + roll.w[1] : walk.path.length;
  return walk.path.length - dice;
}

/** "Re-roll!", "Shield!", "Smash!", "Sting +3", "Take aim"; `next`: the batch's events after this one */
export function powerLabel(ev: Ev<'power'>, game: GameState | null, next: readonly GameEvent[]): string {
  switch (ev.power) {
    case 'thunder':
      return 'Re-roll!';
    case 'shield':
      return 'Shield!';
    case 'smash':
      return 'Smash!';
    case 'aim':
      return 'Take aim';
    case 'sting': {
      const n = stingSteps(ev, game, next);
      return n > 0 ? `Sting +${n}` : 'Sting!';
    }
    case 'copy':
      return 'Suit Up!';
  }
}

/** "Thunder Call ready" */
export const readyLabel = (ev: Ev<'powerReady'>, game: GameState | null): string =>
  `${(game && heroOf(game, ev.seat)?.powerName) || 'Superpower'} ready`;

/** "40 Power short": what a payment could not cover (forgiven), in the board's money */
export const shortLabel = (ev: Ev<'short'>, game: GameState | null): string =>
  `${boardMoney(game?.cfg.board ?? 'lanka', Math.max(0, owedTotal(ev.owed) - owedTotal(ev.paid)))} short`;

/** Nobody could save the location: the villain keeps it */
export const NO_SAVE_LABEL = 'Not saved';
