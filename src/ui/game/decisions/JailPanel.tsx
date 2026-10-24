import type { SeatId } from '../../../rules';
import { useBusy, useSend } from '../actions';
import { useGame } from '../context';
import { money } from '../format';

/** Turn start in jail: pay the fine, use a card, or roll for doubles (try k of 3) */
export function JailPanel({ seat }: { seat: SeatId }) {
  const s = useGame();
  const send = useSend();
  const busy = useBusy();
  const p = s?.players[seat];
  if (!s || !p?.jail) return null;
  const attempt = p.jail.tries + 1;
  const fine = s.cfg.jailFine;
  const last = p.jail.tries >= 2;
  const cards = p.goojf.length;
  return (
    <div className="jail-panel" role="group" aria-labelledby="jail-title">
      <p id="jail-title" className="jail-title">
        <strong>In jail</strong> <span className="muted">· try {attempt} of 3</span>
      </p>
      {last && <p className="muted small">Last try: without doubles you pay {money(fine)} and move by this roll.</p>}
      <div className="action-row">
        <button type="button" className="primary" disabled={busy} onClick={() => void send(seat, { k: 'roll' })}>
          Roll for doubles <kbd>R</kbd>
        </button>
        <button
          type="button"
          disabled={busy || last || p.cash < fine}
          title={last ? 'On your third try you must roll' : p.cash < fine ? `The fine is ${money(fine)}` : undefined}
          onClick={() => void send(seat, { k: 'payFine' })}
        >
          Pay <span className="amt">{money(fine)}</span>
        </button>
        <button
          type="button"
          disabled={busy || cards === 0}
          title={cards === 0 ? 'You have no Get Out of Jail Free card' : undefined}
          onClick={() => void send(seat, { k: 'useCard' })}
        >
          Use card{cards > 1 ? ` (${cards})` : ''}
        </button>
      </div>
    </div>
  );
}
