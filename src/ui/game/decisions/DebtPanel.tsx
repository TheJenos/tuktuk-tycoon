import { maxRaise, type Creditor, type SeatId } from '../../../rules';
import { ConfirmButton } from '../../ConfirmButton';
import { useBusy, useSend } from '../actions';
import { useGame, useMySeats, useNames } from '../context';
import { listText, money, partyName } from '../format';
import { debtTotal, tradeLock } from '../selectors';
import { Prompt } from './Prompt';

const WHY: Partial<Record<string, string>> = {
  rent: 'rent',
  tax: 'tax',
  card: 'a card',
  fine: 'the jail fine',
  interest: 'mortgage interest',
  auction: 'an auction bid',
};

/**
 * Owing more cash than you have: raise it by selling buildings, mortgaging or trading (the debt settles by itself
 * once the cash covers it), let the game do that (Auto-raise), or declare bankruptcy when even that can't cover it.
 */
export function DebtPanel({ seat, onManage, onTrade }: { seat: SeatId; onManage(): void; onTrade(): void }) {
  const s = useGame();
  const names = useNames();
  const send = useSend();
  const busy = useBusy();
  const many = useMySeats().length > 1;
  if (!s || s.phase.k !== 'debt') return null;
  const ph = s.phase;
  const total = debtTotal(s);
  const cash = s.players[seat]?.cash ?? 0;
  const most = maxRaise(s, seat);
  const short = Math.max(0, total - cash);
  const canCover = most >= total;
  const creditors = (Object.keys(ph.owed) as Creditor[]).filter((c) => (ph.owed[c] ?? 0) > 0);
  const lock = tradeLock(s, seat);
  const players = creditors.filter((c): c is SeatId => c !== 'bank' && !s.players[c]?.out);
  return (
    <Prompt title={`${many ? `${names.seat(seat)} owes` : 'You owe'} ${money(total)}`} className="debt-panel">
      <ul className="owed-list">
        {creditors.map((c) => (
          <li key={c}>
            {money(ph.owed[c] ?? 0)} to {partyName(names, c)}
          </li>
        ))}
      </ul>
      <p className="muted small">
        For {WHY[ph.why] ?? ph.why}. You have {money(cash)} and could raise up to {money(most)} by selling and mortgaging everything.
      </p>
      {short > 0 && <p className="shortfall">Raise {money(short)} more to pay.</p>}
      <div className="action-row">
        <button type="button" onClick={onManage}>Sell or mortgage</button>
        {!lock && <button type="button" onClick={onTrade}>Trade</button>}
        {/* Auto-raise goes bankrupt when even selling everything can't cover the debt: only offered when it can */}
        {canCover && (
          <button
            type="button"
            className="primary"
            disabled={busy}
            title="Sell buildings evenly, then mortgage the cheapest first, then pay"
            onClick={() => void send(seat, { k: 'autoRaise' })}
          >
            Auto-raise and pay
          </button>
        )}
      </div>
      {!canCover && (
        <p className="muted small bankrupt-note">
          {players.length
            ? `Bankruptcy: everything you own is sold to the bank and ${listText(players.map((c) => names.seat(c)))} get${players.length === 1 ? 's' : ''} the cash, up to what you owe.`
            : `Bankruptcy: everything you own goes to the bank${s.cfg.auctions ? ', which auctions your property' : ''}.`}
        </p>
      )}
      <div className="action-row">
        <ConfirmButton
          className="danger"
          disabled={busy || canCover}
          title={canCover ? 'You can still raise enough to pay' : undefined}
          question="Give up everything?"
          yes="Declare bankruptcy"
          no="Keep playing"
          onConfirm={() => void send(seat, { k: 'bankrupt' })}
        >
          Declare bankruptcy
        </ConfirmButton>
      </div>
    </Prompt>
  );
}
