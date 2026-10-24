import { useEffect, useRef, useState, type CSSProperties } from 'react';
// The 3D card's flight state only: it doesn't pull in the scene
import { cardFlight, finishCard } from '../../../scene/cards/flight';
import { shallowEqual, useSelector } from '../../../state/store';
import { uiStore } from '../../../state/ui';
import type { LogEntry, ViewState } from '../../../view';
import { useView } from '../../../view';
import { useEscape } from '../../useDialogFocus';
import { useNames } from '../context';
import { deckName } from '../format';

/** How long the 3D card's caption stays once the card has gone back to its deck */
const SHOW_MS = 6000;

/** The card drawn this turn, if any (scanning back no further than the turn's start) */
function recentCard(log: ViewState['log']): LogEntry | null {
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i]!;
    if (e.ev.t === 'card') return e;
    if (e.ev.t === 'turn') return null;
  }
  return null;
}

/**
 * The drawn Chance or Community Chest card in words. Not modal: play goes on under it.
 * - With the 3D board on screen (`threeD`), the card that flies up in front of the camera is the card; this is
 *   only a compact caption above the board, clear of it, for reading at leisure: it stays a few seconds after
 *   the 3D card has gone home, and its OK sends the 3D card home early too.
 * - Otherwise (no WebGL, or the 2D board shown) this is the card itself, over the middle of the board, until OK or
 *   the next turn.
 */
export function CardModal({ threeD }: { threeD: boolean }) {
  const names = useNames();
  const live = useView((v) => v.card);
  const entry = useView((v) => recentCard(v.log));
  const turnNo = useView((v) => v.game?.turn.no ?? 0);
  const insets = useSelector(uiStore, (u) => u.insets, shallowEqual);
  const flying = useSelector(cardFlight, (f) => f.flying);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const ev = entry?.ev.t === 'card' ? entry.ev : null;
  const card = live ?? (ev ? { seat: ev.seat, deck: ev.deck, text: ev.text } : null);
  const key = card ? `${card.seat}|${card.deck}|${card.text}|${turnNo}` : null;
  const open = key !== null && key !== dismissed;

  useEffect(() => {
    if (!open || !threeD || flying || !key) return;
    const t = setTimeout(() => setDismissed(key), SHOW_MS);
    return () => clearTimeout(t);
  }, [open, threeD, flying, key]);
  const dismiss = () => {
    setDismissed(key);
    finishCard();
  };
  useEscape(open ? dismiss : undefined, box);

  if (!open || !card) return null;
  const goojf = /get out of jail free/i.test(card.text);
  const titleId = 'card-modal-title';
  const deck = (
    <p className="card-deck" id={titleId}>
      {deckName(names.board, card.deck)} <span className="muted">· {names.seat(card.seat)}</span>
    </p>
  );
  const keepHint = goojf && <p className="muted small">Keep this card until you need it, or sell it to another player in a trade.</p>;
  if (threeD) {
    return (
      // The wrapper is placed in page pixels, under the top panels and centred between the side ones; the panel
      // inside scales with the UI size
      <div className="card-caption-wrap" style={{ '--top': `${insets.top}px`, '--left': `${insets.left}px`, '--right': `${insets.right}px` } as CSSProperties}>
        <div ref={box} className={`card-caption panel ${card.deck}`} role="dialog" aria-labelledby={titleId} data-testid="card-modal">
          {deck}
          <p className="card-text">{card.text}</p>
          {keepHint}
          <button type="button" className="primary" onClick={dismiss}>
            OK
          </button>
        </div>
      </div>
    );
  }
  return (
    <div ref={box} className={`card-modal panel ${card.deck}`} role="dialog" aria-labelledby={titleId} data-testid="card-modal">
      {deck}
      <p className="card-text">{card.text}</p>
      {keepHint}
      <button type="button" className="primary" onClick={dismiss}>
        OK
      </button>
    </div>
  );
}
