import { useEffect, useRef } from 'react';
import { minBid, minRaise, type AuctionPhase, type GameState, type SeatId } from '../../../rules';
import { safeColor } from '../../colors';
import { useBusy, useSend } from '../actions';
import { useDoc, useGame, useMySeats, useNames } from '../context';
import { TitleDeed } from '../deeds/TitleDeed';
import { Dialog } from '../Dialog';
import { lotText, money, priceOf } from '../format';
import { TimerBar } from '../hud/TimerRing';
import { activeDeadline } from '../selectors';

/** The raises in engine units: +Rs. 100 / +Rs. 1,000 / +Rs. 10,000 as shown */
const RAISES = [1, 10, 100];

/**
 * Timed open bidding, by buttons only: the opening bid (70% of a property's price), then raises of Rs. 100, 1,000 or
 * 10,000; the smaller raises go grey as the bids come in (the engine's minimum raise grows: AUCTION_RAISES). anyone still in may raise at any time until the countdown runs out (each bid restarts it, unless
 * the table chose a fixed countdown: cfg.fixedAuctionCountdown). One bid row per
 * seat of mine still in (hot-seat), the high bid read out as it changes, and a way to raise cash meanwhile
 * (selling and mortgaging are open during an auction). Works for properties and for building units in a
 * shortage contest.
 */
export function AuctionModal({ seats, covered, onRaise }: { seats: SeatId[]; covered: boolean; onRaise(seat: SeatId): void }) {
  const s = useGame();
  const doc = useDoc();
  const names = useNames();
  const busy = useBusy();
  const ph0 = s?.phase.k === 'auction' ? s.phase : null;
  useFirstBidFocus(!!ph0 && !busy && !covered, ph0 ? `${JSON.stringify(ph0.lot)}:${ph0.queue.length}` : '');
  if (!s || s.phase.k !== 'auction') return null;
  const ph = s.phase;
  const deadline = activeDeadline(doc);
  const lot = lotText(names, ph.lot);
  const printed = ph.lot.k === 'prop' ? priceOf(names.board, ph.lot.space) : 0;
  return (
    <Dialog id="auction" className="auction" title={`Auction: ${lot}`} covered={covered}>
      {ph.lot.k === 'prop' ? (
        <TitleDeed board={names.board} space={ph.lot.space} s={s} compact />
      ) : (
        <p className="muted">The winner pays the bid and places the {ph.lot.k} on one of their streets.</p>
      )}
      <p className="high-bid" aria-live="polite" aria-atomic="true">
        {ph.high ? (
          <>
            High bid <strong className="money">{money(ph.high.amount)}</strong> by{' '}
            <strong style={{ color: safeColor(doc?.seats[ph.high.seat]?.color) }}>{names.seat(ph.high.seat)}</strong>
          </>
        ) : (
          <>No bids yet: bidding opens at {money(minBid(s) ?? 1)}{printed ? ` (printed price ${money(printed)})` : ''}</>
        )}
      </p>
      {deadline && <TimerBar deadline={deadline} label="Auction closes in" />}
      <div className="bid-rows">
        {seats.map((seat) => (
          <BidRow key={seat} seat={seat} s={s} ph={ph} many={seats.length > 1} onRaise={() => onRaise(seat)} />
        ))}
      </div>
      <Bidders s={s} ph={ph} />
    </Dialog>
  );
}

/**
 * Opening the auction, focus goes to the first bid button that can be pressed once the dialog can be used (Pass when
 * none can), unless the player has already picked a button. Once per auction (`lot` tells one from the next).
 */
function useFirstBidFocus(ready: boolean, lot: string): void {
  const placed = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || placed.current === lot) return;
    const box = document.getElementById('auction');
    if (!box) return;
    placed.current = lot;
    const at = document.activeElement;
    const chosen = at instanceof HTMLElement && box.contains(at) && at.tagName === 'BUTTON';
    if (chosen) return;
    const target =
      box.querySelector<HTMLButtonElement>('.bid-row .bid-buttons button:not([disabled])') ??
      box.querySelector<HTMLButtonElement>('.bid-row button.danger:not([disabled])');
    target?.focus();
  }, [ready, lot]);
}

function BidRow({ seat, s, ph, many, onRaise }: { seat: SeatId; s: GameState; ph: AuctionPhase; many: boolean; onRaise(): void }) {
  const names = useNames();
  const send = useSend();
  const busy = useBusy();
  const cash = s.players[seat]?.cash ?? 0;
  const isHigh = ph.high?.seat === seat;
  const min = minBid(s) ?? 1;
  const step = minRaise(s) ?? 1;
  const bid = (n: number) => void send(seat, { k: 'bid', amount: n });
  const label = many ? `${names.seat(seat)}: ` : '';
  return (
    <div className={isHigh ? 'bid-row high' : 'bid-row'} role="group" aria-label={many ? `Bids for ${names.seat(seat)}` : 'Your bid'}>
      <p className="bid-who">
        {many && <strong>{names.seat(seat)}</strong>}
        <span className="muted">Cash {money(cash)}</span>
        {isHigh && <span className="badge good">{many ? 'Holds the high bid' : 'You hold the high bid'}</span>}
        {cash < min && !isHigh && (
          <button type="button" className="link" onClick={onRaise}>
            Raise cash
          </button>
        )}
      </p>
      <div className="action-row bid-buttons">
        {ph.high ? (
          RAISES.map((inc) => {
            const n = ph.high!.amount + inc;
            const tooSmall = inc < step;
            return (
              <button
                key={inc}
                type="button"
                className={inc === step ? 'primary' : undefined}
                disabled={busy || isHigh || tooSmall || n > cash}
                title={tooSmall ? `Raises are at least ${money(step)} now` : undefined}
                aria-label={`${label}Bid ${money(n)}`}
                onClick={() => bid(n)}
              >
                +{money(inc)} <small className="amt">({money(n)})</small>
              </button>
            );
          })
        ) : (
          <button type="button" className="primary" disabled={busy || min > cash} aria-label={`${label}Bid ${money(min)}`} onClick={() => bid(min)}>
            Open at {money(min)}
          </button>
        )}
        <button type="button" className="danger" disabled={busy || isHigh} title={isHigh ? 'The high bidder cannot pass' : undefined} onClick={() => void send(seat, { k: 'pass' })}>
          Pass
        </button>
      </div>
    </div>
  );
}

/** Who is still in, who passed */
function Bidders({ s, ph }: { s: GameState; ph: AuctionPhase }) {
  const names = useNames();
  const mine = useMySeats();
  const doc = useDoc();
  return (
    <ul className="bidders" aria-label="Bidders">
      {ph.eligible.map((seat) => {
        const out = !!s.players[seat]?.out;
        const state = ph.high?.seat === seat ? 'high' : ph.passed.includes(seat) || out ? 'passed' : 'in';
        return (
          <li key={seat} className={`chip ${state === 'passed' ? 'dim' : state === 'high' ? 'selected' : ''}`}>
            <span className="dot" style={{ background: safeColor(doc?.seats[seat]?.color) }} aria-hidden="true" />
            {names.seat(seat)}
            {mine.includes(seat) && mine.length === 1 ? ' (you)' : ''}
            <span className="muted">{state === 'high' ? ' · high bid' : state === 'passed' ? ' · passed' : ' · bidding'}</span>
          </li>
        );
      })}
    </ul>
  );
}
