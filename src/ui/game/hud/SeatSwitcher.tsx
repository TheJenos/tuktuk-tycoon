import type { GameState, SeatId } from '../../../rules';
import { useSelector } from '../../../state/store';
import { uiStore, type UiState } from '../../../state/ui';
import { useMySeats } from '../context';
import type { Names } from '../format';
import { shownSeat } from '../selectors';

/*
 * Hot-seat: the local seat the context column's panels show (My properties and the hero card), and their switcher
 * between my seats. The pick lives in uiStore, so a seat picked in either panel shows in both.
 */

export interface ShownSeat {
  seat: SeatId;
  /** My seats still in: the switcher's choices */
  live: SeatId[];
  pick(seat: SeatId): void;
}

const pickedOf = (u: UiState) => u.shownSeat;

/** The local seat to show in `s` (see shownSeat), or null when none of mine is still in */
export function useShownSeat(s: GameState | null): ShownSeat | null {
  const mine = useMySeats();
  const picked = useSelector(uiStore, pickedOf);
  const shown = s && shownSeat(s, mine, picked);
  if (!s || !shown) return null;
  const turn = s.turn.seat;
  return { ...shown, pick: (seat) => uiStore.update({ shownSeat: { seat, turn } }) };
}

/** The switcher between my seats still in: nothing while there is only one */
export function SeatSwitcher({ shown, names, className }: { shown: ShownSeat; names: Names; className: string }) {
  if (shown.live.length < 2) return null;
  return (
    <span className={className} role="radiogroup" aria-label="Player">
      {shown.live.map((x) => (
        <button key={x} type="button" role="radio" aria-checked={x === shown.seat} className={x === shown.seat ? 'chip selected' : 'chip'} onClick={() => shown.pick(x)}>
          {names.seat(x)}
        </button>
      ))}
    </span>
  );
}
