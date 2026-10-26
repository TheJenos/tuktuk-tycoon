import { useRef, useState } from 'react';
import type { LogEntry, ViewState } from '../../../view';
import { useView } from '../../../view';
import { useEscape } from '../../useDialogFocus';
import { useNames } from '../context';
import { deckName } from '../format';

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
 * The drawn Chance or Community Chest card in words, when there is no 3D card to show it: no WebGL, or the 2D board
 * shown (`threeD` false). Then this is the card itself, over the middle of the board, until OK or the next turn.
 * Not modal: play goes on under it. With the 3D board on screen the card that flies up in front of the camera is
 * all there is (the log keeps its text).
 */
export function CardModal({ threeD }: { threeD: boolean }) {
  const names = useNames();
  const live = useView((v) => v.card);
  const entry = useView((v) => recentCard(v.log));
  const turnNo = useView((v) => v.game?.turn.no ?? 0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const ev = entry?.ev.t === 'card' ? entry.ev : null;
  const card = live ?? (ev ? { seat: ev.seat, deck: ev.deck, text: ev.text } : null);
  const key = card ? `${card.seat}|${card.deck}|${card.text}|${turnNo}` : null;
  const open = !threeD && key !== null && key !== dismissed;
  const dismiss = () => setDismissed(key);
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
