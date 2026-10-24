import { useEffect, useRef } from 'react';
import { isStreet, placeSites, type BuildKind, type SeatId } from '../../../rules';
import { uiStore } from '../../../state/ui';
import { inflight, useBusy, useSend } from '../actions';
import { useGame, useNames } from '../context';
import { levelText, money } from '../format';
import { Prompt } from './Prompt';

/** A building won at auction (or granted in a shortage) goes on one of the seat's streets: pick which */
export function PlacePrompt({ seat, kind, count, bid }: { seat: SeatId; kind: BuildKind; count: number; bid?: number }) {
  const s = useGame();
  const names = useNames();
  const send = useSend();
  const busy = useBusy();
  const sites = s ? placeSites(s, seat, kind) : [];
  const key = sites.join(',');
  const place = (space: number) => {
    if (inflight.get() === 0) void send(seat, { k: 'place', space });
  };
  const placeRef = useRef(place);
  placeRef.current = place;

  useEffect(() => {
    const legal = key ? key.split(',').map(Number) : [];
    uiStore.update({ picker: { kind: 'space', legal, ghost: null, onPick: (i) => placeRef.current(i) } });
    return () => {
      if (uiStore.get().picker?.kind === 'space') uiStore.update({ picker: null });
    };
  }, [key]);

  // The normal price of the chosen street (granted units are paid for; streets in different groups cost differently)
  const priceAt = (space: number): number => {
    const sp = names.board.spaces[space];
    return isStreet(sp) ? (kind === 'hotel' ? sp.hotel ?? sp.house : sp.house) : 0;
  };
  const paid = bid === undefined;
  return (
    <Prompt title={`Place your ${kind}${count > 1 ? ` (${count} to go)` : ''}`} className="place-prompt">
      <p className="muted small">
        {paid ? `You pay the street's normal ${kind} price.` : `Won at auction for ${money(bid)}: it goes up free.`} Pick a street on the board or
        here.
      </p>
      <div className="site-list">
        {sites.map((i) => (
          <button
            key={i}
            type="button"
            disabled={busy}
            onMouseEnter={() => ghost(i)}
            onFocus={() => ghost(i)}
            onClick={() => place(i)}
          >
            {names.space(i)}{' '}
            <small className="muted">({levelText(s?.props[`p${i}`]?.level ?? 0)}{paid ? `, ${money(priceAt(i))}` : ''})</small>
          </button>
        ))}
        {sites.length === 0 && <p className="muted">No street can take it now.</p>}
      </div>
    </Prompt>
  );
}

function ghost(space: number) {
  const p = uiStore.get().picker;
  if (p) uiStore.update({ picker: { ...p, ghost: space } });
}

