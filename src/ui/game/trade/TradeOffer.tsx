import { Fragment, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { tradeProblems, type Bundle, type SeatId, type Trade } from '../../../rules';
import { useSelector } from '../../../state/store';
import { uiStore } from '../../../state/ui';
import { safeColor } from '../../colors';
import { useBusy, useSend } from '../actions';
import { useDoc, useGame, useMySeats, useNames } from '../context';
import { PreviewCard } from '../deeds/PreviewCard';
import { previewPlacement, type CardPlacement } from '../deeds/preview';
import { PropertyChip } from '../deeds/PropertyChip';
import { bundleParts, listSep, offerRole, openOffers } from './offers';
import type { TradeDraft } from './TradeBuilder';

/** Phases in which an offer can be accepted (src/rules/handler.ts ACCEPT_PHASES) */
const ACCEPT_PHASES = new Set(['preRoll', 'postRoll', 'buy', 'debt']);

/**
 * Every open offer, public to players and spectators alike. Ones to my seats can be accepted, declined or
 * countered (a swapped, prefilled builder), mine cancelled; offers between other players are read-only. More than
 * two scroll in a list of their own. A property in the terms previews on the board (and in a card beside the list)
 * under the pointer or focus. Offers never block play; they expire when the turn passes.
 */
export function TradeOffers({ onCounter }: { onCounter(from: Trade['to'], draft: TradeDraft): void }) {
  const s = useGame();
  const mine = useMySeats();
  const preview = useSelector(uiStore, (u) => u.preview);
  // The trade builder shows its own preview; so does the inspector (the full deed)
  const covered = useSelector(uiStore, (u) => u.panel === 'trade' || u.selected !== null);
  const list = useRef<HTMLDivElement>(null);
  if (!s) return null;
  const offers = openOffers(s.trades, mine);
  if (offers.length === 0) return null;
  const many = offers.length > 2;
  return (
    <section className={many ? 'trade-offers many' : 'trade-offers'} aria-label="Trade offers">
      {many && <h2 className="offers-head">Open trades ({offers.length})</h2>}
      <div className="offer-list" ref={list}>
        {offers.map((t) =>
          offerRole(t, mine) === 'other' ? <OtherOffer key={t.id} trade={t} /> : <TradeOffer key={t.id} trade={t} onCounter={onCounter} />,
        )}
      </div>
      {/* Only for a property in these offers (My properties previews on the board alone) */}
      {preview !== null && !covered && offers.some((t) => t.give.props.includes(preview) || t.get.props.includes(preview)) && (
        <FloatingPreview space={preview} anchor={list} />
      )}
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
        <dd><Terms bundle={trade.give} /></dd>
        <dt>{incoming ? 'You give' : 'You get'}</dt>
        <dd><Terms bundle={trade.get} /></dd>
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

/** An offer between two other players: what each gives, read-only */
function OtherOffer({ trade }: { trade: Trade }) {
  const names = useNames();
  const from = names.seat(trade.from);
  const to = names.seat(trade.to);
  return (
    <article className="trade-offer panel other" aria-label={`Offer from ${from} to ${to}`}>
      <p className="offer-who">
        <SeatDot seat={trade.from} />
        <strong>{from}</strong> offers{' '}
        <SeatDot seat={trade.to} />
        <strong>{to}</strong>:
      </p>
      <dl className="offer-terms">
        <dt>{from} gives</dt>
        <dd><Terms bundle={trade.give} /></dd>
        <dt>{to} gives</dt>
        <dd><Terms bundle={trade.get} /></dd>
      </dl>
      <p className="muted small">Waiting for {to}</p>
    </article>
  );
}

function SeatDot({ seat }: { seat: SeatId }) {
  const doc = useDoc();
  return <span className="dot" style={{ background: safeColor(doc?.seats[seat]?.color) }} aria-hidden="true" />;
}

/** A bundle as "Rs. 500, [Galle Face] and a Get Out of Jail Free card": cash and cards as text, properties as chips */
function Terms({ bundle }: { bundle: Bundle }) {
  const parts = bundleParts(bundle);
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={p.k === 'prop' ? `p${p.space}` : `t${i}`}>
          {listSep(i, parts.length)}
          {p.k === 'prop' ? <PropertyChip space={p.space} /> : p.text}
        </Fragment>
      ))}
    </>
  );
}

/**
 * The previewed property's card, floating beside the offers so it covers neither them nor the board's free part:
 * under the list (over the log), or beside the column, or above the bottom sheet on a phone. It is a data-inset
 * panel, so the camera frames the previewed tile clear of it.
 */
function FloatingPreview({ space, anchor }: { space: number; anchor: RefObject<HTMLDivElement | null> }) {
  const card = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<CardPlacement | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const list = anchor.current;
      const el = card.current;
      if (!list || !el) return;
      const phone = window.matchMedia('(max-width: 640px)').matches;
      // On a phone the offers are in the bottom sheet; elsewhere the list as seen in its scrolling panel
      const sheet = list.closest<HTMLElement>('.hud-decision');
      const r = list.getBoundingClientRect();
      const clip = sheet?.getBoundingClientRect();
      const box = phone && clip ? clip : { left: r.left, right: r.right, top: Math.max(r.top, clip?.top ?? r.top), bottom: Math.min(r.bottom, clip?.bottom ?? r.bottom) };
      const next = previewPlacement(box, el.offsetHeight, window.innerWidth, window.innerHeight, phone);
      setPlace((p) => (p && p.left === next.left && p.top === next.top && p.width === next.width && p.edge === next.edge ? p : next));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [anchor, space]);
  const style = {
    left: place?.left ?? 0,
    top: place?.top ?? 0,
    width: place?.width ?? 300,
    visibility: place ? 'visible' : 'hidden',
    '--edge': place?.edge ?? 'right',
  } as CSSProperties;
  // The attribute's value changes with the placement, so the HUD measures the insets again
  return (
    <div ref={card} className="offer-preview" style={style} data-inset={place ? `${place.edge}@${place.left},${place.top}` : undefined}>
      <PreviewCard space={space} />
    </div>
  );
}
