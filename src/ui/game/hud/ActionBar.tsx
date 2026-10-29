import type { SeatId } from '../../../rules';
import { useSelector } from '../../../state/store';
import { settings } from '../../settings';
import { useGame } from '../context';
import { heroesOn, tradeLock } from '../selectors';
import { TurnButton } from './BoardCenter';

interface Props {
  /** The seat Manage and Trade act for; null for spectators */
  seat: SeatId | null;
  onManage(): void;
  onTrade(): void;
  /** Absent when there is no 3D camera to recenter (the 2D board only) */
  onRecenter?: () => void;
  /** Phones only: the log opens on demand there (wider screens always show it, and L folds it) */
  onLog?: () => void;
  onMenu(): void;
  /** Switch the board between the 3D and 2D views (absent without a 3D scene: the grid board is all there is) */
  onToggleView?: () => void;
  /** Roll / End turn for this seat sit at the bar's start (while the trade dialog covers the board's middle) */
  turnSeat?: SeatId | null;
}

/**
 * Manage, Trade, Recenter, the 2D / 3D switch, the log (phones) and the menu (bottom right; a bottom sheet on phones). The turn's Roll / End turn and the
 * jail choices are over the middle of the board (BoardCenter), but Roll / End turn move here while trading. Hero
 * League has nothing to manage (no buildings, mortgages or sales) and no trading: neither button is there.
 */
export function ActionBar({ seat, onManage, onTrade, onRecenter, onLog, onMenu, onToggleView, turnSeat }: Props) {
  const s = useGame();
  // The button names the view it switches to
  const other = useSelector(settings, (v) => (v.boardView === '2d' ? '3D' : '2D'));
  const lock = tradeLock(s, seat);
  return (
    <nav className="action-bar panel" aria-label="Actions">
      <div className="action-row tools">
        {turnSeat && <TurnButton seat={turnSeat} docked />}
        {!heroesOn(s) && (
          <button type="button" disabled={!seat} onClick={onManage} title="Build, sell and mortgage (M)">
            Manage <kbd>M</kbd>
          </button>
        )}
        {!lock?.off && (
          <button type="button" disabled={!seat || !!lock} onClick={onTrade} title={lock ? lock.message : 'Offer a trade (T)'}>
            Trade <kbd>T</kbd>
          </button>
        )}
        {onRecenter && (
          <button type="button" className="icon-button" onClick={onRecenter} aria-label="Recenter the camera" title="Recenter (C)">
            ⌖
          </button>
        )}
        {onToggleView && (
          <button type="button" className="icon-button view-button" onClick={onToggleView} aria-label={`Switch to the ${other} view`} title={`${other} view (V)`}>
            {other}
          </button>
        )}
        {onLog && (
          <button type="button" className="icon-button log-button" onClick={onLog} aria-label="Log" title="Log (L)">
            ☰
          </button>
        )}
        <button type="button" className="icon-button" onClick={onMenu} aria-label="Menu" title="Menu (Esc)">
          ⏸
        </button>
      </div>
    </nav>
  );
}
