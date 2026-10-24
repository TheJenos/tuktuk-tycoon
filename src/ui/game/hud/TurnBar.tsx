import { useIdle, useView } from '../../../view';
import { safeColor } from '../../colors';
import { useDoc, useMySeats, useNames } from '../context';
import { activeDeadline, phaseLabel, speedActive } from '../selectors';
import { TokenIcon } from '../tokenIcons';
import { TimerRing } from './TimerRing';
import { DEFAULT_TOKEN } from '../../../shared/tokens';

/**
 * Top centre: whose turn it is, what the game waits for, the turn timer and the Speed Die badge. It reads what the
 * board shows: while a roll plays out it must not tell the outcome before the token gets there (decision prompts
 * wait the same way), so the timer, too, only shows once the board has caught up.
 */
export function TurnBar() {
  const doc = useDoc();
  const mine = useMySeats();
  const names = useNames();
  const shown = useView((v) => v.game);
  const idle = useIdle();
  if (!doc) return null;
  const s = idle || !shown ? doc.game : shown;
  const seat = s.turn.seat;
  const info = doc.seats[seat];
  const deadline = idle ? activeDeadline(doc) : null;
  const over = s.phase.k === 'over';
  const yours = !over && mine.includes(seat);
  const label = phaseLabel(s, names, mine);
  const title = over ? 'Game over' : yours ? (mine.length > 1 ? `${names.seat(seat)}'s turn` : 'Your turn') : `${names.seat(seat)}'s turn`;
  return (
    <div className={yours ? 'turn-bar panel yours' : 'turn-bar panel'} data-testid="turn-bar">
      <span className="turn-who" style={{ color: safeColor(info?.color) }}>
        <TokenIcon token={info?.token ?? DEFAULT_TOKEN} color={info?.color} size={22} />
      </span>
      <div className="turn-text">
        <strong>{title}</strong>
        <span className="muted turn-phase">{label}</span>
      </div>
      {!over && speedActive(s, seat) && <span className="badge speed" title="This player rolls the red Speed Die">Speed Die</span>}
      <span className="badge" title="Turns played, all players together">Turn {s.turn.no}</span>
      {deadline && <TimerRing deadline={deadline} label={deadline.kind === 'auction' ? 'Auction closes in' : 'Time to decide'} />}
    </div>
  );
}
