import { tradeProblems, type Trade } from '../../../rules';
import { useBusy, useSend } from '../actions';
import { useGame, useMySeats, useNames } from '../context';
import { bundleText } from '../format';
import type { TradeDraft } from './TradeBuilder';

/** Phases in which an offer can be accepted (src/rules/handler.ts ACCEPT_PHASES) */
const ACCEPT_PHASES = new Set(['preRoll', 'postRoll', 'buy', 'debt']);

/**
 * Open offers that involve my seats: incoming ones to accept, decline or counter (a swapped, prefilled builder),
 * outgoing ones to cancel. Offers never block play; they expire when the turn passes.
 */
export function TradeOffers({ onCounter }: { onCounter(from: Trade['to'], draft: TradeDraft): void }) {
  const s = useGame();
  const mine = useMySeats();
  if (!s) return null;
  const offers = Object.values(s.trades).filter((t) => mine.includes(t.to) || mine.includes(t.from));
  if (offers.length === 0) return null;
  return (
    <section className="trade-offers" aria-label="Trade offers">
      {offers.map((t) => (
        <TradeOffer key={t.id} trade={t} onCounter={onCounter} />
      ))}
    </section>
  );
}

function TradeOffer({ trade, onCounter }: { trade: Trade; onCounter(from: Trade['to'], draft: TradeDraft): void }) {
  const s = useGame();
  const mine = useMySeats();
  const names = useNames();
  const send = useSend();
  const busy = useBusy();
  if (!s) return null;
  const incoming = mine.includes(trade.to);
  const problems = tradeProblems(s, trade);
  const phaseOk = ACCEPT_PHASES.has(s.phase.k);
  const why = problems[0]?.message ?? (phaseOk ? null : 'Offers can be accepted before or after a roll, or in a debt');
  const many = mine.length > 1;
  return (
    <article className={incoming ? 'trade-offer panel incoming' : 'trade-offer panel'} aria-label={incoming ? `Offer from ${names.seat(trade.from)}` : `Your offer to ${names.seat(trade.to)}`}>
      <p>
        {incoming ? (
          <>
            <strong>{names.seat(trade.from)}</strong> offers {many ? names.seat(trade.to) : 'you'}:
          </>
        ) : (
          <>
            {many ? `${names.seat(trade.from)}'s` : 'Your'} offer to <strong>{names.seat(trade.to)}</strong>:
          </>
        )}
      </p>
      <dl className="offer-terms">
        <dt>{incoming ? 'You get' : 'You give'}</dt>
        <dd>{bundleText(names, trade.give)}</dd>
        <dt>{incoming ? 'You give' : 'You get'}</dt>
        <dd>{bundleText(names, trade.get)}</dd>
      </dl>
      {incoming ? (
        <div className="action-row">
          <button type="button" className="primary" disabled={busy || !!why} title={why ?? undefined} onClick={() => void send(trade.to, { k: 'accept', id: trade.id })}>
            Accept
          </button>
          <button type="button" disabled={busy} onClick={() => void send(trade.to, { k: 'reject', id: trade.id })}>
            Decline
          </button>
          <button type="button" disabled={busy} onClick={() => onCounter(trade.to, { to: trade.from, give: trade.get, get: trade.give, replaces: trade.id })}>
            Counter
          </button>
        </div>
      ) : (
        <div className="action-row">
          <span className="muted small">Waiting for an answer</span>
          <button type="button" disabled={busy} onClick={() => void send(trade.from, { k: 'cancel', id: trade.id })}>
            Cancel offer
          </button>
        </div>
      )}
      {incoming && why && <p className="muted small">{why}</p>}
    </article>
  );
}
