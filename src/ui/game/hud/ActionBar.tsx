import type { SeatId } from '../../../rules';
import { useBusy, useSend } from '../actions';
import { useGame } from '../context';
import { JailPanel } from '../decisions/JailPanel';
import { speedActive, tradeLock } from '../selectors';

interface Props {
  /** My turn seat's preRoll / postRoll is up (and the board has caught up) */
  turnSeat: SeatId | null;
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
}

/** Bottom centre: Roll / End turn (or the jail choices), then Manage, Trade, Recenter, the log and the menu */
export function ActionBar({ turnSeat, seat, onManage, onTrade, onRecenter, onLog, onMenu, onMiniBoard, miniBoard }: Props) {
  const s = useGame();
  const send = useSend();
  const busy = useBusy();
  const phase = s?.phase.k;
  const jailed = !!(turnSeat && s?.players[turnSeat]?.jail);
  const lock = tradeLock(s, seat);
  return (
    <nav className="action-bar panel" aria-label="Actions">
      {turnSeat && phase === 'preRoll' && jailed && <JailPanel seat={turnSeat} />}
      {turnSeat && phase === 'preRoll' && !jailed && (
        <button type="button" className="primary big" disabled={busy} onClick={() => void send(turnSeat, { k: 'roll' })}>
          Roll <kbd>R</kbd>
          {s && speedActive(s, turnSeat) && <span className="badge speed">+ Speed Die</span>}
        </button>
      )}
      {turnSeat && phase === 'postRoll' && (
        <button type="button" className="primary big" disabled={busy} onClick={() => void send(turnSeat, { k: 'endTurn' })}>
          End turn <kbd>E</kbd>
        </button>
      )}
      <div className="action-row tools">
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
