import type { SeatId } from '../../../rules';
import { useGame } from '../context';
import { tradeLock } from '../selectors';
import { TurnButton } from './BoardCenter';

interface Props {
  /** The seat Manage and Trade act for; null for spectators */
  seat: SeatId | null;
  onManage(): void;
  onTrade(): void;
  /** Absent when there is no 3D camera to recenter (the 2D board only) */
  onRecenter?: () => void;
  onLog(): void;
  onMenu(): void;
  /** Show / hide the 2D board (absent when it is the only board) */
  onMiniBoard?: () => void;
  miniBoard: boolean;
  /** Roll / End turn for this seat sit at the bar's start (while the trade dialog covers the board's middle) */
  turnSeat?: SeatId | null;
}

/**
 * Bottom centre: Manage, Trade, Recenter, the 2D board, the log and the menu. The turn's Roll / End turn and the
 * jail choices are over the middle of the board (BoardCenter), but Roll / End turn move here while trading.
 */
export function ActionBar({ seat, onManage, onTrade, onRecenter, onLog, onMenu, onMiniBoard, miniBoard, turnSeat }: Props) {
  const s = useGame();
  const lock = tradeLock(s, seat);
  return (
    <nav className="action-bar panel" aria-label="Actions">
      <div className="action-row tools">
        {turnSeat && <TurnButton seat={turnSeat} docked />}
        <button type="button" disabled={!seat} onClick={onManage} title="Build, sell and mortgage (M)">
          Manage <kbd>M</kbd>
        </button>
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
        {onMiniBoard && (
          <button type="button" className="icon-button" onClick={onMiniBoard} aria-pressed={miniBoard} aria-label="2D board" title="2D board">
            ▦
          </button>
        )}
        <button type="button" className="icon-button log-button" onClick={onLog} aria-label="Log" title="Log (L)">
          ☰
        </button>
        <button type="button" className="icon-button" onClick={onMenu} aria-label="Menu" title="Menu (Esc)">
          ⏸
        </button>
      </div>
    </nav>
  );
}
