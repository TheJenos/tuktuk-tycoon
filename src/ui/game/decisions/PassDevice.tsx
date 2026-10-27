import type { CSSProperties } from 'react';
import type { SeatId } from '../../../rules';
import { safeColor } from '../../colors';
import { useDoc, useNames } from '../context';
import { Dialog } from '../Dialog';
import { tokenOf } from '../format';
import { TokenIcon } from '../tokenIcons';

/**
 * Hot-seat: the device goes to another player before their decision shows, so nobody sees (or taps) the next
 * player's choices by accident. It must be answered (no Esc); Enter presses the focused button.
 */
export function PassDevice({ seat, onReady, covered }: { seat: SeatId; onReady(): void; covered: boolean }) {
  const doc = useDoc();
  const names = useNames();
  const info = doc?.seats[seat];
  const name = names.seat(seat);
  return (
    <Dialog
      title={`Pass to ${name}`}
      className="pass-device"
      covered={covered}
      restoreFocus={false}
      footer={
        <button type="button" className="primary" onClick={onReady} autoFocus>
          I'm {name}: show my turn
        </button>
      }
    >
      <div className="pass-who" style={{ '--seat': safeColor(info?.color) } as CSSProperties}>
        <span className="player-token">
          <TokenIcon token={tokenOf(doc?.game, seat, info?.token)} color={info?.color} size={40} label={true} />
        </span>
        <p>
          Hand the device to <strong>{name}</strong>. Their choices stay hidden until they are ready.
        </p>
      </div>
      <p className="muted small">You can turn this card off in Menu, Settings.</p>
    </Dialog>
  );
}
