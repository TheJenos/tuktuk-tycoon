import { useEffect, useId, useState, type CSSProperties } from 'react';
import { useSelector } from '../../../state/store';
import { uiStore } from '../../../state/ui';
import { MONEY_SCALE, isProperty, toRupees, toUnits, opponents, tradeProblems, unmortgageCost, type Bundle, type GameState, type SeatId } from '../../../rules';
import { DEFAULT_TOKEN } from '../../../shared/tokens';
import { safeColor } from '../../colors';
import { useBusy, useSend } from '../actions';
import { useDoc, useGame, useNames } from '../context';
import { Dialog } from '../Dialog';
import { jailCard, JAIL_CARD_NAME } from '../deeds/jailCard';
import { PreviewCard } from '../deeds/PreviewCard';
import { PropertyChip, previewHandlers, useClearPreviewOnUnmount } from '../deeds/PropertyChip';
import { money, type Names } from '../format';
import { clusters } from '../hud/PlayersPanel';
import { groupOfSpace } from '../manage/buildPlan';
import { TokenIcon } from '../tokenIcons';

export interface TradeDraft {
  to: SeatId;
  give: Bundle;
  get: Bundle;
  /** A counter-offer: the offer it answers, declined once the counter is sent */
  replaces?: string;
}

const EMPTY: Bundle = { cash: 0, props: [], cards: [] };

/** More holdings than this on either side: the Find box shows and the tiles get smaller */
const MANY = 8;

/** The quick-add buttons under the cash slider, in shown rupees (the slider snaps to the smallest) */
const CASH_STEPS = [1_000, 10_000, 50_000];

const toggled = <T,>(list: readonly T[], v: T, on: boolean): T[] => (on ? [...list.filter((x) => x !== v), v] : list.filter((x) => x !== v));

/** Why a property can't be in a trade now (its colour group has buildings), or null */
export function tradeBlock(s: GameState, names: Names, space: number): string | null {
  const g = groupOfSpace(names.board, space);
  if (g && g.spaces.some((i) => (s.props[`p${i}`]?.level ?? 0) > 0)) return `Sell the buildings in ${g.name} first`;
  return null;
}

/**
 * A trade offer to one other player, laid out as a deal table. The partner is picked from their tokens in the
 * header (with a Find box when there are many holdings). Below, the two sides face each other (what you give, what
 * you get): each its owner's cash (typed, slid or added in steps) and holdings as small title-deed tiles to tap in
 * or out, by colour set (then stations, boards and Get Out of Jail Free cards); with many holdings each side scrolls
 * on its own. The column on the right is the deal sheet: the deed of the property pointed at, the deal item by item,
 * what (if anything) stops it (checked live against the rules: no loans, no cash for cash, nothing from a group with
 * buildings) and the buttons. Opened empty from Trade, or prefilled (and swapped) to counter an offer.
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
  const [find, setFind] = useState('');
  const preview = useSelector(uiStore, (u) => u.preview);
  // Nothing stays previewed on the board once the builder is gone
  useEffect(() => () => uiStore.update({ preview: null }), []);
  if (!s) return null;
  const partner = to && partners.includes(to) ? to : undefined;
  const open = Object.values(s.trades).find((t) => t.from === seat);
  const offer = partner ? { from: seat, to: partner, give, get } : null;
  const problems = offer ? [...new Set(tradeProblems(s, offer).map((e) => e.message))] : ['Pick a player to trade with'];
  if (open) problems.unshift('You already have an open offer: cancel it first');
  const ok = problems.length === 0;
  const holdings = (x: SeatId) => Object.values(s.props).filter((p) => p?.owner === x).length + (s.players[x]?.goojf.length ?? 0);
  const many = !!partner && Math.max(holdings(seat), holdings(partner)) > MANY;

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
      aside={
        <div className="trade-partners" role="radiogroup" aria-label="Trade with">
          {partners.map((x) => (
            <PartnerChip key={x} seat={x} s={s} selected={x === partner} onPick={() => pickPartner(x)} />
          ))}
          {partners.length === 0 && <p className="muted">Nobody left to trade with.</p>}
          {many && (
            <input
              type="search"
              className="trade-find"
              aria-label="Find a property"
              placeholder="Find a property or set…"
              value={find}
              onChange={(e) => setFind(e.target.value)}
            />
          )}
        </div>
      }
    >
      <div className="trade-main">
        {partner && (
          <div className={many ? 'trade-table many' : 'trade-table'}>
            <Side title="You give" s={s} owner={seat} bundle={give} onChange={setGive} receiving={false} names={names} find={many ? find : ''} />
            <span className="trade-swap" aria-hidden="true">⇄</span>
            <Side title={`You get from ${names.seat(partner)}`} s={s} owner={partner} bundle={get} onChange={setGet} receiving names={names} find={many ? find : ''} />
          </div>
        )}
      </div>
      <section className="trade-sheet" aria-label="The deal">
        {/* The deal item by item; a property pointed at shows its deed here instead, for as long as it's pointed at */}
        <div className="trade-sheet-body">
          {preview !== null ? (
            <aside className="trade-preview" aria-label="Property preview">
              <PreviewCard space={preview} />
            </aside>
          ) : (
            <>
              <h3>The deal</h3>
              {partner && (
                <div className="trade-deal-sides">
                  <DealSide title="You give" bundle={give} names={names} />
                  <DealSide title="You get" bundle={get} names={names} />
                </div>
              )}
              <p className="muted small trade-preview-hint">Point at a property (or tap its <span className="info-glyph" aria-hidden="true">i</span>) to see it on the board and its deed here.</p>
            </>
          )}
        </div>
        <div className="trade-deal">
          <p className={ok ? 'trade-problems ok' : 'trade-problems'} role="status">
            {ok ? 'The offer is valid' : problems[0]}
          </p>
          {problems.length > 1 && (
            <ul className="problem-list">
              {problems.slice(1).map((p) => (
                <li key={p} className="muted small">{p}</li>
              ))}
            </ul>
          )}
          <div className="trade-deal-actions">
            <button type="button" onClick={onClose}>Cancel</button>
            <button type="button" className="primary" disabled={busy || !ok} onClick={() => void propose()}>
              Send offer
            </button>
          </div>
        </div>
      </section>
    </Dialog>
  );
}

/** One side of the deal on the sheet, item by item: the cash, each property with its band, the cards */
function DealSide({ title, bundle, names }: { title: string; bundle: Bundle; names: Names }) {
  const empty = bundle.cash === 0 && bundle.props.length === 0 && bundle.cards.length === 0;
  return (
    <div className="trade-deal-side">
      <h4>{title}</h4>
      {empty ? (
        <p className="muted small">Nothing yet</p>
      ) : (
        <ul>
          {bundle.cash > 0 && (
            <li className="cash">
              <span className="band" aria-hidden="true" />
              {money(bundle.cash)}
            </li>
          )}
          {bundle.props.map((i) => {
            const sp = names.board.spaces[i];
            const colour = sp?.k === 'street' ? safeColor(names.board.display.groupColours[sp.group]) : undefined;
            return (
              <li key={i}>
                <span className="band" style={colour ? { background: colour } : undefined} aria-hidden="true" />
                {names.space(i)}
              </li>
            );
          })}
          {bundle.cards.map((id) => (
            <li key={id}>
              <span className="band jail-card" style={{ background: jailCard(names.board, id).colour }} aria-hidden="true" />
              {JAIL_CARD_NAME} card
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A player to trade with: their token in their colour and name (their cash on hover; it shows on their side too) */
function PartnerChip({ seat, s, selected, onPick }: { seat: SeatId; s: GameState; selected: boolean; onPick(): void }) {
  const doc = useDoc();
  const names = useNames();
  const info = doc?.seats[seat];
  return (
    <button type="button" role="radio" aria-checked={selected} className={selected ? 'trade-partner selected' : 'trade-partner'} onClick={onPick}>
      <TokenIcon token={info?.token ?? DEFAULT_TOKEN} color={info?.color} size={22} />
      <strong className="trade-partner-name" title={`${names.seat(seat)}: ${money(s.players[seat]?.cash ?? 0)}`}>{names.seat(seat)}</strong>
    </button>
  );
}

/**
 * One side of the deal: its owner, their cash and their holdings to tap in or out, by colour set (with how much of
 * the set they hold). `find` keeps the holdings whose name or set matches; ones already in the deal always show.
 */
function Side({ title, s, owner, bundle, onChange, receiving, names, find }: {
  title: string; s: GameState; owner: SeatId; bundle: Bundle; onChange(b: Bundle): void; receiving: boolean; names: Names; find: string;
}) {
  const doc = useDoc();
  const info = doc?.seats[owner];
  const p = s.players[owner];
  const q = find.trim().toLowerCase();
  const matches = (...texts: string[]) => !q || texts.some((t) => t.toLowerCase().includes(q));
  const sets = clusters(names.board)
    .map((c) => {
      const owned = c.spaces.filter((i) => isProperty(names.board.spaces[i]) && s.props[`p${i}`]?.owner === owner);
      return { ...c, owned, shown: owned.filter((i) => bundle.props.includes(i) || matches(names.space(i), c.label)) };
    })
    .filter((c) => c.owned.length > 0);
  const allCards = p?.goojf ?? [];
  const cards = allCards.filter((id) => bundle.cards.includes(id) || matches(JAIL_CARD_NAME, 'card', jailCard(names.board, id).deck));
  const total = sets.reduce((n, c) => n + c.owned.length, 0) + allCards.length;
  const shown = sets.reduce((n, c) => n + c.shown.length, 0) + cards.length;
  return (
    <fieldset className={receiving ? 'trade-side get' : 'trade-side give'} style={{ '--seat': safeColor(info?.color) } as CSSProperties}>
      <legend className="trade-side-head">
        <TokenIcon token={info?.token ?? DEFAULT_TOKEN} color={info?.color} size={20} />
        <span className="trade-side-title">{title}</span>
      </legend>
      <div className="trade-side-body">
        <CashBox owner={owner} max={p?.cash ?? 0} bundle={bundle} onChange={onChange} receiving={receiving} />
        <div className="trade-holdings">
          {total === 0 && <p className="muted small trade-none">No property or cards</p>}
          {total > 0 && shown === 0 && <p className="muted small trade-none">Nothing called “{find.trim()}”</p>}
          {sets.map(
            (c) =>
              c.shown.length > 0 && (
                <section key={c.id} className="trade-set" aria-label={c.label} style={{ '--n': c.shown.length } as CSSProperties}>
                  <h4>
                    <span className="band" style={{ background: safeColor(c.colour) }} aria-hidden="true" />
                    <span className="trade-set-name">{c.label}</span>
                    <span className="trade-set-count" title={`${c.owned.length} of the ${c.spaces.length}`}>
                      {c.owned.length}/{c.spaces.length}
                    </span>
                  </h4>
                  <ul className="trade-tiles">
                    {c.shown.map((i) => (
                      <DeedTile
                        key={i}
                        space={i}
                        s={s}
                        names={names}
                        checked={bundle.props.includes(i)}
                        receiving={receiving}
                        onToggle={(on) => onChange({ ...bundle, props: toggled(bundle.props, i, on) })}
                      />
                    ))}
                  </ul>
                </section>
              ),
          )}
          {cards.length > 0 && (
            <section className="trade-set" aria-label="Cards" style={{ '--n': cards.length } as CSSProperties}>
              <h4>
                <span className="band" aria-hidden="true" />
                <span className="trade-set-name">Cards</span>
              </h4>
              <ul className="trade-tiles">
                {cards.map((id) => {
                  const card = jailCard(names.board, id);
                  const checked = bundle.cards.includes(id);
                  return (
                    <li key={id} className={['trade-tile', 'jail', checked && 'selected'].filter(Boolean).join(' ')}>
                      <label title={`${JAIL_CARD_NAME} card from ${card.deck}`}>
                        <input type="checkbox" checked={checked} aria-label={`${JAIL_CARD_NAME} card`} onChange={(e) => onChange({ ...bundle, cards: toggled(bundle.cards, id, e.target.checked) })} />
                        <span className="trade-tile-band jail-card" style={{ background: card.colour }} aria-hidden="true" />
                        <span className="trade-tile-name">{JAIL_CARD_NAME}</span>
                        <span className="trade-tile-meta">{card.deck}</span>
                        <span className="trade-tile-check" aria-hidden="true" />
                      </label>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
      </div>
    </fieldset>
  );
}

/**
 * A side's cash: the amount (typed in shown rupees, step Rs. 100), a slider from nothing to all they have, and
 * quick adds. The bundle holds engine units, rounded to the nearest unit; the typed text is kept as typed and only
 * replaced when the bundle's cash changes from outside (the slider, a step, a reset or a counter-offer).
 */
function CashBox({ owner, max, bundle, onChange, receiving }: { owner: SeatId; max: number; bundle: Bundle; onChange(b: Bundle): void; receiving: boolean }) {
  const cashId = `trade-cash-${owner}-${receiving ? 'get' : 'give'}`;
  const [cashText, setCashText] = useState(bundle.cash ? String(toRupees(bundle.cash)) : '');
  const typedUnits = Math.max(0, toUnits(Number(cashText) || 0));
  useEffect(() => {
    if (typedUnits !== bundle.cash) setCashText(bundle.cash ? String(toRupees(bundle.cash)) : '');
  }, [bundle.cash, typedUnits]);
  const rounded = cashText !== '' && Number.isFinite(Number(cashText)) && toRupees(typedUnits) !== Number(cashText);
  const setCash = (units: number) => {
    setCashText(units ? String(toRupees(units)) : '');
    onChange({ ...bundle, cash: units });
  };
  return (
    <div className={bundle.cash > 0 ? 'trade-cash-box on' : 'trade-cash-box'}>
      <div className="trade-cash">
        <label htmlFor={cashId}>Cash</label>
        <span className="trade-cash-field">
          <span className="trade-cash-unit" aria-hidden="true">Rs.</span>
          <input
            id={cashId}
            type="number"
            inputMode="numeric"
            min={0}
            max={toRupees(max)}
            step={MONEY_SCALE}
            value={cashText}
            placeholder="0"
            onChange={(e) => {
              setCashText(e.target.value);
              onChange({ ...bundle, cash: Math.max(0, toUnits(Number(e.target.value) || 0)) });
            }}
          />
        </span>
        <small className="muted trade-cash-of">
          {rounded ? `counts as ${money(typedUnits)} ` : ''}of {money(max)}
        </small>
      </div>
      <input
        type="range"
        className="trade-cash-range"
        aria-label={receiving ? 'Cash you get' : 'Cash you give'}
        aria-valuetext={money(Math.min(bundle.cash, max))}
        min={0}
        max={max}
        step={toUnits(CASH_STEPS[0]!)}
        value={Math.min(bundle.cash, max)}
        disabled={max === 0}
        onChange={(e) => setCash(Number(e.target.value))}
      />
      <div className="trade-cash-steps">
        {CASH_STEPS.map((r) => (
          <button key={r} type="button" aria-label={`Add ${money(toUnits(r))}`} disabled={bundle.cash >= max} onClick={() => setCash(Math.min(max, bundle.cash + toUnits(r)))}>
            +{r.toLocaleString('en-US')}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * A property as a small title deed to tap in or out of the deal: its colour band, name and price (or Mortgaged),
 * a tick when it's in. Locked while its group has buildings. Pointing at it previews it; the ⓘ shows it on touch.
 */
function DeedTile({ space, s, names, checked, receiving, onToggle }: {
  space: number; s: GameState; names: Names; checked: boolean; receiving: boolean; onToggle(on: boolean): void;
}) {
  useClearPreviewOnUnmount(space);
  const previewing = useSelector(uiStore, (u) => u.preview === space);
  const metaId = useId();
  const sp = names.board.spaces[space];
  if (!sp || !isProperty(sp)) return null;
  const block = tradeBlock(s, names, space);
  const mortgaged = !!s.props[`p${space}`]?.mortgaged;
  const colour = sp.k === 'street' ? safeColor(names.board.display.groupColours[sp.group]) : undefined;
  const interest = mortgaged ? unmortgageCost(s, space) - sp.mortgage : 0;
  const meta = block
    ? 'Has buildings'
    : mortgaged && receiving && checked
      ? `Pay ${money(interest)} interest`
      : mortgaged
        ? 'Mortgaged'
        : money(sp.price);
  const classes = ['trade-tile', checked && 'selected', block && 'blocked', mortgaged && 'mortgaged', previewing && 'on', !colour && 'plain'].filter(Boolean).join(' ');
  return (
    <li className={classes} {...previewHandlers(space)}>
      <label title={block ?? (mortgaged && receiving ? `Mortgaged: you pay ${money(interest)} interest now, or lift it for ${money(unmortgageCost(s, space))}` : undefined)}>
        <input type="checkbox" checked={checked} disabled={!!block && !checked} aria-label={names.space(space)} aria-describedby={metaId} onChange={(e) => onToggle(e.target.checked)} />
        <span className="trade-tile-band" style={colour ? { background: colour } : undefined} aria-hidden="true" />
        <span className="trade-tile-name">{names.space(space)}</span>
        <span className="trade-tile-meta" id={metaId}>{meta}</span>
        <span className="trade-tile-check" aria-hidden="true" />
      </label>
      <PropertyChip space={space} info />
    </li>
  );
}
