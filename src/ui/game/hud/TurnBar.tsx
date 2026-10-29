import { useIdle, useView } from '../../../view';
import { safeColor } from '../../colors';
import { useDoc, useMySeats, useNames } from '../context';
import { tokenOf } from '../format';
import { activeDeadline, phaseLabel, speedActive } from '../selectors';
import { TokenIcon } from '../tokenIcons';
import { TimerRing } from './TimerRing';

/**
 * The turn as the board shows it: while a roll plays out the HUD must not tell the outcome before the token gets
 * there (decision prompts wait the same way), so the timer, too, only shows once the board has caught up.
 */
function useTurn() {
  const doc = useDoc();
  const shown = useView((v) => v.game);
  const idle = useIdle();
  if (!doc) return null;
  const s = idle || !shown ? doc.game : shown;
  return { doc, s, seat: s.turn.seat, deadline: idle ? activeDeadline(doc) : null, over: s.phase.k === 'over' };
}

/** The Speed Die badge, the turn number and the timer (the turn bar's end, and the players panel's header on desktop) */
export function TurnStatus() {
  const t = useTurn();
  if (!t) return null;
  const { s, seat, deadline, over } = t;
  return (
    <>
      {!over && speedActive(s, seat) && <span className="badge speed" title="This player rolls the red Speed Die">Speed Die</span>}
      <span className="badge" title="Turns played, all players together">Turn {s.turn.no}</span>
      {deadline && <TimerRing deadline={deadline} label={deadline.kind === 'auction' ? 'Auction closes in' : deadline.kind === 'reaction' ? 'Time to react' : 'Time to decide'} />}
    </>
  );
}

/**
 * Whose turn it is, what the game waits for, the turn timer and the Speed Die badge: on tablets and phones, over the
 * board (desktop shows whose turn it is in the players panel, with TurnStatus in its header)
 */
export function TurnBar() {
  const mine = useMySeats();
  const names = useNames();
  const t = useTurn();
  if (!t) return null;
  const { doc, s, seat, over } = t;
  const info = doc.seats[seat];
  const yours = !over && mine.includes(seat);
  const label = phaseLabel(s, names, mine);
  const title = over ? 'Game over' : yours ? (mine.length > 1 ? `${names.seat(seat)}'s turn` : 'Your turn') : `${names.seat(seat)}'s turn`;
  return (
    <div className={yours ? 'turn-bar panel yours' : 'turn-bar panel'} data-testid="turn-bar">
      <span className="turn-who" style={{ color: safeColor(info?.color) }}>
        <TokenIcon token={tokenOf(s, seat, info?.token)} color={info?.color} size={22} />
      </span>
      <div className="turn-text">
        <strong>{title}</strong>
        <span className="muted turn-phase">{label}</span>
      </div>
      <TurnStatus />
    </div>
  );
}
