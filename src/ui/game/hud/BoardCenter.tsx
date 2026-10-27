import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import type { SeatId } from '../../../rules';
import { shallowEqual, useSelector } from '../../../state/store';
import { uiStore } from '../../../state/ui';
import { useBusy, useSend } from '../actions';
import { useGame } from '../context';
import { JailPanel } from '../decisions/JailPanel';
import { PowerButton, SmashPicker } from '../decisions/SmashPicker';
import { heroesOn, speedActive } from '../selectors';

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

/**
 * The turn's Roll (preRoll) or End turn (postRoll) for `seat`, or nothing in other phases. Big over the board; in
 * the action bar (`docked`) while the trade dialog would otherwise hide the board's middle behind it.
 */
export function TurnButton({ seat, docked = false }: { seat: SeatId; docked?: boolean }) {
  const s = useGame();
  const send = useSend();
  const busy = useBusy();
  const phase = s?.phase.k;
  const cls = docked ? 'primary big turn-button' : 'primary big';
  if (phase === 'preRoll') {
    return (
      <button type="button" className={cls} disabled={busy} onClick={() => void send(seat, { k: 'roll' })}>
        Roll <kbd>R</kbd>
        {s && speedActive(s, seat) && <span className="badge speed">+ Speed Die</span>}
      </button>
    );
  }
  if (phase === 'postRoll') {
    return (
      <button type="button" className={cls} disabled={busy} onClick={() => void send(seat, { k: 'endTurn' })}>
        End turn <kbd>E</kbd>
      </button>
    );
  }
  return null;
}

interface Props {
  /** My turn seat's preRoll / postRoll is up (and the board has caught up) */
  turnSeat: SeatId | null;
  /** Roll / End turn are in the action bar for now (the trade dialog is up): only the jail choices stay here */
  turnDocked?: boolean;
  /** The decision prompt to show over the board (null: none, or it is in the phone's bottom sheet) */
  children?: ReactNode;
}

/**
 * Over the middle of the board: the turn's Roll / End turn (or the jail choices) and my turn's decisions (buy or
 * auction, Income Tax, Bus, a triple's space, placing a building, received mortgages, a debt). On Hero League a
 * superpower used on its own (Titan Smash) sits beside Roll and opens its picker here. Centred in the area
 * the side panels, the top bar and the dock leave free (uiStore.insets), which is where the camera frames the
 * board, so it sits on the board's middle; not an inset itself, so the board never moves away from it.
 */
export function BoardCenter({ turnSeat, turnDocked = false, children }: Props) {
  const s = useGame();
  const insets = useSelector(uiStore, (u) => u.insets, shallowEqual);
  // The Titan Smash picker is open for this very moment of the turn (a new phase closes it)
  const moment = turnSeat && s ? `${turnSeat}:${s.since}` : null;
  const [smashAt, setSmashAt] = useState<string | null>(null);
  const phase = s?.phase.k;
  // A Hero League turn starts out of the Holding Cell (its fine is paid automatically): no jail choices there
  const jailed = !!(turnSeat && s?.players[turnSeat]?.jail) && !heroesOn(s);
  let turn: ReactNode = null;
  if (turnSeat && phase === 'preRoll' && jailed) {
    turn = (
      <div className="turn-center panel jail-center">
        <JailPanel seat={turnSeat} />
      </div>
    );
  } else if (turnSeat && phase === 'preRoll' && moment && smashAt === moment) {
    turn = <SmashPicker seat={turnSeat} onClose={() => setSmashAt(null)} />;
  } else if (turnSeat && !turnDocked && (phase === 'preRoll' || phase === 'postRoll')) {
    turn = (
      <div className="turn-center">
        <TurnButton seat={turnSeat} />
        {phase === 'preRoll' && <PowerButton seat={turnSeat} onUse={() => setSmashAt(moment)} />}
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
