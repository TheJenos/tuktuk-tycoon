import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import type { SeatId } from '../../../rules';
import { shallowEqual, useSelector } from '../../../state/store';
import { uiStore } from '../../../state/ui';
import { useBusy, useSend } from '../actions';
import { useGame } from '../context';
import { JailPanel } from '../decisions/JailPanel';
import { speedActive } from '../selectors';

/** The phone layout (style.css): decisions stay in the bottom sheet there, clear of the board */
const PHONE_QUERY = '(max-width: 640px)';

/** Whether the phone layout is on, following resizes */
export function usePhoneLayout(): boolean {
  const query = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(PHONE_QUERY) : null;
  const [phone, setPhone] = useState(() => query?.matches ?? false);
  useEffect(() => {
    if (!query) return;
    const on = () => setPhone(query.matches);
    on();
    query.addEventListener('change', on);
    return () => query.removeEventListener('change', on);
  }, [query?.media]);
  return phone;
}

interface Props {
  /** My turn seat's preRoll / postRoll is up (and the board has caught up) */
  turnSeat: SeatId | null;
  /** The decision prompt to show over the board (null: none, or it is in the phone's bottom sheet) */
  children?: ReactNode;
}

/**
 * Over the middle of the board: the turn's Roll / End turn (or the jail choices) and my turn's decisions (buy or
 * auction, Income Tax, Bus, a triple's space, placing a building, received mortgages, a debt). Centred in the area
 * the side panels, the top bar and the dock leave free (uiStore.insets), which is where the camera frames the
 * board, so it sits on the board's middle; not an inset itself, so the board never moves away from it.
 */
export function BoardCenter({ turnSeat, children }: Props) {
  const s = useGame();
  const send = useSend();
  const busy = useBusy();
  const insets = useSelector(uiStore, (u) => u.insets, shallowEqual);
  const phase = s?.phase.k;
  const jailed = !!(turnSeat && s?.players[turnSeat]?.jail);
  let turn: ReactNode = null;
  if (turnSeat && phase === 'preRoll' && jailed) {
    turn = (
      <div className="turn-center panel jail-center">
        <JailPanel seat={turnSeat} />
      </div>
    );
  } else if (turnSeat && phase === 'preRoll') {
    turn = (
      <div className="turn-center">
        <button type="button" className="primary big" disabled={busy} onClick={() => void send(turnSeat, { k: 'roll' })}>
          Roll <kbd>R</kbd>
          {s && speedActive(s, turnSeat) && <span className="badge speed">+ Speed Die</span>}
        </button>
      </div>
    );
  } else if (turnSeat && phase === 'postRoll') {
    turn = (
      <div className="turn-center">
        <button type="button" className="primary big" disabled={busy} onClick={() => void send(turnSeat, { k: 'endTurn' })}>
          End turn <kbd>E</kbd>
        </button>
      </div>
    );
  }
  if (!turn && !children) return null;
  const at = { '--top': `${insets.top}px`, '--bottom': `${insets.bottom}px`, '--left': `${insets.left}px`, '--right': `${insets.right}px` } as CSSProperties;
  return (
    <div className="board-center-wrap" style={at}>
      <div className="board-center">
        {children}
        {turn}
      </div>
    </div>
  );
}
