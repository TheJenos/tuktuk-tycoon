import { useState } from 'react';
import { unmortgageCost, xferCost, type SeatId } from '../../../rules';
import { useBusy, useSend } from '../actions';
import { useGame, useNames } from '../context';
import { money } from '../format';
import { Prompt } from './Prompt';

/**
 * Mortgaged property received in a trade: per property, lift the mortgage now (mortgage + interest)
 * or pay just the interest now and keep it mortgaged (lifting later costs the full price again).
 */
export function MortgageXferPrompt({ seat, spaces }: { seat: SeatId; spaces: number[] }) {
  const s = useGame();
  const names = useNames();
  const send = useSend();
  const busy = useBusy();
  const [lift, setLift] = useState<number[]>([]);
  if (!s) return null;
  const chosen = lift.filter((i) => spaces.includes(i));
  const total = xferCost(s, spaces, chosen);
  const cash = s.players[seat]?.cash ?? 0;
  const toggle = (i: number, on: boolean) => setLift((l) => (on ? [...l.filter((x) => x !== i), i] : l.filter((x) => x !== i)));
  return (
    <Prompt title="Mortgaged property received" className="xfer-prompt">
      <p className="muted small">For each one: lift the mortgage now, or pay the interest now and keep it mortgaged.</p>
      <ul className="xfer-list">
        {spaces.map((i) => {
          const lifted = unmortgageCost(s, i);
          const interest = xferCost(s, [i], []);
          const on = chosen.includes(i);
          return (
            <li key={i} role="radiogroup" aria-label={names.space(i)}>
              <strong>{names.space(i)}</strong>
              <span className="choices">
                <button type="button" role="radio" aria-checked={!on} className={!on ? 'choice selected' : 'choice'} onClick={() => toggle(i, false)}>
                  Keep: pay {money(interest)}
                </button>
                <button type="button" role="radio" aria-checked={on} className={on ? 'choice selected' : 'choice'} onClick={() => toggle(i, true)}>
                  Lift now: {money(lifted)}
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      <p className={total > cash ? 'shortfall' : 'muted small'}>{total > cash && chosen.length === 0 && 'Short of cash: the interest becomes a debt to the bank. '}
        Total {money(total)} · you have {money(cash)}
      </p>
      <div className="action-row">
        <button type="button" className="primary" disabled={busy || (chosen.length > 0 && total > cash)} onClick={() => void send(seat, { k: 'settleMortgages', lift: chosen })}>
          Pay {money(total)}
        </button>
      </div>
    </Prompt>
  );
}
