import { incomeTaxAmounts, type SeatId } from '../../../rules';
import { toast, useBusy, useSend } from '../actions';
import { useGame, useNames } from '../context';
import { money, taxName } from '../format';
import { Prompt } from './Prompt';

/**
 * Income Tax: the flat amount or a percentage of total worth. The rulebook has the player choose before adding
 * up their worth, so the percentage's amount is only revealed after the choice.
 */
export function IncomeTaxPrompt({ seat }: { seat: SeatId }) {
  const s = useGame();
  const send = useSend();
  const busy = useBusy();
  const names = useNames();
  if (!s) return null;
  const title = taxName(names.board, 'income');
  const { incomeFlat, incomePct } = s.cfg;
  const choose = async (pick: 'flat' | 'percent') => {
    // Worked out now, before the payment changes the state, and shown only once the choice is made
    const { flat, percent } = incomeTaxAmounts(s, seat);
    const cash = s.players[seat]?.cash ?? 0;
    const r = await send(seat, { k: 'incomeTax', pick });
    if (!r.ok) return;
    const amount = pick === 'flat' ? flat : percent;
    const other = pick === 'flat' ? `${incomePct}% of your worth was ${money(percent)}` : `the flat tax was ${money(flat)}`;
    // Short of cash, the choice opens a debt rather than paying
    toast(`${cash >= amount ? `You paid ${money(amount)}` : `You owe ${money(amount)} to ${title}`}; ${other}.`, 'info', 7000);
  };
  return (
    <Prompt title={title} className="tax-prompt">
      <p>
        Pay {money(incomeFlat)}, or {incomePct}% of your total worth (cash, printed prices and buildings). Choose before you add it
        up.
      </p>
      <div className="action-row">
        <button type="button" className="primary" disabled={busy} onClick={() => void choose('flat')}>
          Pay <span className="amt">{money(incomeFlat)}</span>
        </button>
        <button type="button" disabled={busy} onClick={() => void choose('percent')}>
          Pay {incomePct}%
        </button>
      </div>
    </Prompt>
  );
}
