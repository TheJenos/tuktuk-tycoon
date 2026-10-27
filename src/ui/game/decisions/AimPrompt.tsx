import type { CSSProperties } from 'react';
import { cardOf, usablePowers, type SeatId } from '../../../rules';
import { DECK_STYLE } from '../../../scene/cards/drawCard';
import { useBusy, useSend } from '../actions';
import { useGame, useMySeats, useNames } from '../context';
import { deckName, plural, powerName } from '../format';
import { Prompt } from './Prompt';
import '../heroes.css';

/**
 * Dead Aim: landed on Villain Strike able to aim, take the top cards and play one (the other goes under the deck),
 * or draw as usual and keep the superpower. The revealed cards are this seat's alone: the prompt only comes up for
 * its own player (hot-seat: after the device is passed to them); everyone else reads that the hero takes aim.
 */
export function AimPrompt({ seat }: { seat: SeatId }) {
  const s = useGame();
  const names = useNames();
  const mine = useMySeats();
  const send = useSend();
  const busy = useBusy();
  if (!s || s.phase.k !== 'aim' || s.phase.seat !== seat) return null;
  const ph = s.phase;
  const at = s.since;
  const deck = deckName(names.board, ph.deck);
  const aim = powerName(names.board, 'aim');
  if (!ph.cards) {
    const use = usablePowers(s, seat).find((u) => u.power === 'aim');
    const n = names.board.heroes?.aimCards ?? 2;
    return (
      <Prompt title={aim} className="aim-prompt">
        <p>
          {mine.length > 1 ? `${names.seat(seat)} landed` : 'You landed'} on {deck}. Take the top {plural(n, 'card')} and play the one you choose, or
          draw as usual and keep the superpower for later.
        </p>
        <div className="action-row">
          <button type="button" className="primary" disabled={busy || !use} onClick={() => void send(seat, { k: 'aim', at })}>
            Take aim{use?.copied ? ` (${powerName(names.board, 'copy')})` : ''}
          </button>
          <button type="button" disabled={busy} onClick={() => void send(seat, { k: 'pass', at })}>
            Draw normally
          </button>
        </div>
      </Prompt>
    );
  }
  const style = { '--deck': DECK_STYLE[ph.deck].back } as CSSProperties;
  return (
    <Prompt title="Pick a card" className="aim-prompt">
      <p className="muted small">
        {mine.length > 1 ? `For ${names.seat(seat)}'s eyes only. ` : ''}Both go under the deck afterwards.
      </p>
      <div className="aim-cards" style={style}>
        {ph.cards.map((id) => {
          const text = cardOf(s, id)?.text ?? id;
          return (
            <button key={id} type="button" className="aim-card" disabled={busy} aria-label={`Play: ${text}`} onClick={() => void send(seat, { k: 'pickCard', card: id, at })}>
              <span className="card-deck" aria-hidden="true">{deck}</span>
              <span className="card-text" aria-hidden="true">{text}</span>
            </button>
          );
        })}
      </div>
    </Prompt>
  );
}
