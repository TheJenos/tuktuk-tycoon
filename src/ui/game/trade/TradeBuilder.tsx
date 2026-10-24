import { useEffect, useState } from 'react';
import { useSelector } from '../../../state/store';
import { uiStore } from '../../../state/ui';
import { MONEY_SCALE, deckOf, isProperty, toRupees, toUnits, opponents, tradeProblems, unmortgageCost, type Bundle, type GameState, type SeatId } from '../../../rules';
import { safeColor } from '../../colors';
import { useBusy, useSend } from '../actions';
import { useDoc, useGame, useNames } from '../context';
import { Dialog } from '../Dialog';
import { PreviewCard } from '../deeds/PreviewCard';
import { PropertyChip, previewHandlers } from '../deeds/PropertyChip';
import { deckName, money, type Names } from '../format';
import { groupOfSpace } from '../manage/buildPlan';

export interface TradeDraft {
  to: SeatId;
  give: Bundle;
  get: Bundle;
  /** A counter-offer: the offer it answers, declined once the counter is sent */
  replaces?: string;
}

const EMPTY: Bundle = { cash: 0, props: [], cards: [] };

const toggled = <T,>(list: readonly T[], v: T, on: boolean): T[] => (on ? [...list.filter((x) => x !== v), v] : list.filter((x) => x !== v));

/** Why a property can't be in a trade now (its colour group has buildings), or null */
export function tradeBlock(s: GameState, names: Names, space: number): string | null {
  const g = groupOfSpace(names.board, space);
  if (g && g.spaces.some((i) => (s.props[`p${i}`]?.level ?? 0) > 0)) return `Sell the buildings in ${g.name} first`;
  return null;
}

/**
 * A trade offer to one other player: what you give and what you get (property, cash, Get Out of Jail Free
 * cards), checked live against the rules (no loans, no cash for cash, nothing from a group with buildings).
 * Opened empty from Trade, or prefilled (and swapped) to counter an offer.
 */
export function TradeBuilder({ seat, initial, onClose, covered }: { seat: SeatId; initial?: TradeDraft; onClose(): void; covered: boolean }) {
  const s = useGame();
  const names = useNames();
  const send = useSend();
  const busy = useBusy();
  const partners = s ? opponents(s, seat) : [];
  const [to, setTo] = useState<SeatId | undefined>(initial?.to ?? partners[0]);
  const [give, setGive] = useState<Bundle>(initial?.give ?? EMPTY);
  const [get, setGet] = useState<Bundle>(initial?.get ?? EMPTY);
  const preview = useSelector(uiStore, (u) => u.preview);
  // Nothing stays previewed on the board once the builder is gone
  useEffect(() => () => uiStore.update({ preview: null }), []);
  if (!s) return null;
  const partner = to && partners.includes(to) ? to : undefined;
  const open = Object.values(s.trades).find((t) => t.from === seat);
  const offer = partner ? { from: seat, to: partner, give, get } : null;
  const problems = offer ? [...new Set(tradeProblems(s, offer).map((e) => e.message))] : ['Pick a player to trade with'];
  if (open) problems.unshift('You already have an open offer: cancel it first');

  const propose = async () => {
    if (!partner) return;
    const r = await send(seat, { k: 'propose', to: partner, give, get });
    if (!r.ok) return;
    if (initial?.replaces && s.trades[initial.replaces]) await send(seat, { k: 'reject', id: initial.replaces });
    onClose();
  };
  const pickPartner = (x: SeatId) => {
    setTo(x);
    setGet(EMPTY);
  };

  return (
    <Dialog
      id="trade"
      className="trade"
      title="Propose a trade"
      onClose={onClose}
      covered={covered}
      inset
      footer={
        <>
          <span className="trade-problems" role="status">
            {problems.length > 0 ? problems[0] : <span className="good">The offer is valid</span>}
          </span>
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" className="primary" disabled={busy || problems.length > 0} onClick={() => void propose()}>
            Send offer
          </button>
        </>
      }
    >
      <div className="trade-main">
      <div className="choices partner-pick" role="radiogroup" aria-label="Trade with">
        {partners.map((x) => (
          <PartnerChip key={x} seat={x} selected={x === partner} onPick={() => pickPartner(x)} />
        ))}
        {partners.length === 0 && <p className="muted">Nobody left to trade with.</p>}
      </div>
      {partner && (
        <div className="trade-columns">
          <Side title="You give" s={s} owner={seat} bundle={give} onChange={setGive} receiving={false} names={names} />
          <Side title={`You get from ${names.seat(partner)}`} s={s} owner={partner} bundle={get} onChange={setGet} receiving names={names} />
        </div>
      )}
      {problems.length > 1 && (
        <ul className="problem-list">
          {problems.slice(1).map((p) => (
            <li key={p} className="muted small">{p}</li>
          ))}
        </ul>
      )}
      </div>
      <aside className={preview !== null ? 'trade-preview on' : 'trade-preview'} aria-label="Property preview">
        {preview !== null ? (
          <PreviewCard space={preview} />
        ) : (
          <p className="muted small trade-preview-hint">Point at a property (or tap its <span className="info-glyph" aria-hidden="true">i</span>) to see it on the board and its deed here.</p>
        )}
      </aside>
    </Dialog>
  );
}

function PartnerChip({ seat, selected, onPick }: { seat: SeatId; selected: boolean; onPick(): void }) {
  const doc = useDoc();
  const names = useNames();
  return (
    <button type="button" role="radio" aria-checked={selected} className={selected ? 'chip selected' : 'chip'} onClick={onPick}>
      <span className="dot" style={{ background: safeColor(doc?.seats[seat]?.color) }} aria-hidden="true" />
      {names.seat(seat)}
    </button>
  );
}

function Side({ title, s, owner, bundle, onChange, receiving, names }: {
  title: string; s: GameState; owner: SeatId; bundle: Bundle; onChange(b: Bundle): void; receiving: boolean; names: Names;
}) {
  const p = s.players[owner];
  const props = names.board.spaces.flatMap((sp, i) => (isProperty(sp) && s.props[`p${i}`]?.owner === owner ? [i] : []));
  const cashId = `trade-cash-${owner}-${receiving ? 'get' : 'give'}`;
  // The box takes shown rupees (step Rs. 100); the bundle holds engine units, rounded to the nearest unit. The typed
  // text is kept as typed and only replaced when the bundle's cash changes from outside (a reset or a counter-offer).
  const [cashText, setCashText] = useState(bundle.cash ? String(toRupees(bundle.cash)) : '');
  const typedUnits = Math.max(0, toUnits(Number(cashText) || 0));
  useEffect(() => {
    if (typedUnits !== bundle.cash) setCashText(bundle.cash ? String(toRupees(bundle.cash)) : '');
  }, [bundle.cash, typedUnits]);
  const rounded = cashText !== '' && Number.isFinite(Number(cashText)) && toRupees(typedUnits) !== Number(cashText);
  return (
    <fieldset className="trade-side">
      <legend>{title}</legend>
      <label className="trade-cash" htmlFor={cashId}>
        <span>Cash</span>
        <input
          id={cashId}
          type="number"
          inputMode="numeric"
          min={0}
          max={toRupees(p?.cash ?? 0)}
          step={MONEY_SCALE}
          value={cashText}
          placeholder="0"
          onChange={(e) => {
            setCashText(e.target.value);
            onChange({ ...bundle, cash: Math.max(0, toUnits(Number(e.target.value) || 0)) });
          }}
        />
        <small className="muted">
          {rounded ? `counts as ${money(typedUnits)} ` : ''}of {money(p?.cash ?? 0)}
        </small>
      </label>
      {props.length === 0 && <p className="muted small">No property</p>}
      <ul className="trade-props">
        {props.map((i) => {
          const block = tradeBlock(s, names, i);
          const mortgaged = !!s.props[`p${i}`]?.mortgaged;
          const sp = names.board.spaces[i];
          const colour = sp?.k === 'street' ? safeColor(names.board.display.groupColours[sp.group]) : undefined;
          const checked = bundle.props.includes(i);
          const interest = mortgaged ? unmortgageCost(s, i) - (isProperty(sp) ? sp.mortgage : 0) : 0;
          return (
            <li key={i} className={block ? 'dim' : undefined} {...previewHandlers(i)}>
              <div className="trade-prop-row">
                <label title={block ?? undefined}>
                  <input type="checkbox" checked={checked} disabled={!!block && !checked} onChange={(e) => onChange({ ...bundle, props: toggled(bundle.props, i, e.target.checked) })} />
                  <span className="band" style={colour ? { background: colour } : undefined} aria-hidden="true" />
                  {names.space(i)}
                  {mortgaged && <span className="badge danger">Mortgaged</span>}
                </label>
                <PropertyChip space={i} info />
              </div>
              {block && <small className="muted">{block}</small>}
              {mortgaged && receiving && checked && (
                <small className="muted">You pay {money(interest)} interest now, or lift it for {money(unmortgageCost(s, i))}</small>
              )}
            </li>
          );
        })}
      </ul>
      {(p?.goojf ?? []).map((id) => (
        <label key={id} className="trade-card">
          <input type="checkbox" checked={bundle.cards.includes(id)} onChange={(e) => onChange({ ...bundle, cards: toggled(bundle.cards, id, e.target.checked) })} />
          Get Out of Jail Free <small className="muted">({deckName(names.board, deckOf(names.board, id))})</small>
        </label>
      ))}
    </fieldset>
  );
}
