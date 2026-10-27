import { useState } from 'react';
import { smashPairs, usablePowers, type SeatId } from '../../../rules';
import { useBusy, useSend } from '../actions';
import { useGame, useNames } from '../context';
import { powerLabel, powerName } from '../format';
import { Prompt } from './Prompt';
import '../heroes.css';

/**
 * Titan Smash, before the turn's first roll: pick two heroes (yourself included) and they trade places, without
 * passing Rally Point or landing. The pairs come from the engine (smashPairs), so only a swap it accepts can be sent.
 * Picked from a list rather than on the board, where several tokens may share a space.
 */
export function SmashPicker({ seat, onClose }: { seat: SeatId; onClose(): void }) {
  const s = useGame();
  const names = useNames();
  const send = useSend();
  const busy = useBusy();
  const [first, setFirst] = useState<SeatId | null>(null);
  const [second, setSecond] = useState<SeatId | null>(null);
  if (!s) return null;
  const pairs = smashPairs(s, seat);
  const use = usablePowers(s, seat).find((u) => u.power === 'smash');
  const heroes = s.order.filter((x) => pairs.some((p) => p.a === x || p.b === x));
  const a = first && heroes.includes(first) ? first : null;
  const partners = a ? heroes.filter((x) => x !== a && pairs.some((p) => (p.a === a && p.b === x) || (p.b === a && p.a === x))) : [];
  const b = second && partners.includes(second) ? second : null;
  const at = (x: SeatId) => names.space(s.players[x]?.pos ?? 0);
  const chip = (x: SeatId, picked: SeatId | null, pick: (x: SeatId) => void) => (
    <button key={x} type="button" role="radio" aria-checked={x === picked} className={x === picked ? 'chip selected' : 'chip'} onClick={() => pick(x)}>
      {names.seat(x)} <small>{names.hero(s.players[x]?.hero ?? '')} · {at(x)}</small>
    </button>
  );
  const name = powerLabel(names.board, 'smash', use?.copied);
  return (
    <Prompt title={name} className="smash-picker">
      <p className="muted small">Swap the places of any 2 heroes. They don't pass {names.space(0)} or do anything else.</p>
      <p className="smash-step" id="smash-first">Hero to move</p>
      <div className="choices" role="radiogroup" aria-labelledby="smash-first">
        {heroes.map((x) =>
          chip(x, a, (y) => {
            setFirst(y);
            setSecond(null);
          }),
        )}
      </div>
      {a && (
        <>
          <p className="smash-step" id="smash-second">Swap with</p>
          <div className="choices" role="radiogroup" aria-labelledby="smash-second">
            {partners.map((x) => chip(x, b, setSecond))}
          </div>
        </>
      )}
      {a && b && (
        <p className="smash-preview" aria-live="polite">
          {names.seat(a)} goes to {at(b)} and {names.seat(b)} to {at(a)}.
        </p>
      )}
      <div className="action-row">
        <button type="button" className="primary" disabled={busy || !a || !b || !use} onClick={() => a && b && void send(seat, { k: 'smash', a, b }).then((r) => r.ok && onClose())}>
          Swap them
        </button>
        <button type="button" disabled={busy} onClick={onClose}>
          Cancel
        </button>
      </div>
    </Prompt>
  );
}

/**
 * The superpower a player uses on their own, beside Roll: Titan Smash (its own, or Steel Ace's copy) before the
 * turn's first roll. The other superpowers answer a window of their own (re-roll, shield, Viper Strike, Dead Aim).
 */
export function PowerButton({ seat, onUse }: { seat: SeatId; onUse(): void }) {
  const s = useGame();
  const names = useNames();
  const busy = useBusy();
  const use = s?.phase.k === 'preRoll' ? usablePowers(s, seat).find((u) => u.power === 'smash') : undefined;
  if (!use) return null;
  return (
    <button type="button" className="power-button" disabled={busy} onClick={onUse} title="Swap the places of any 2 heroes before you roll">
      {powerName(names.board, 'smash')}
      {use.copied && <small>{powerName(names.board, 'copy')}</small>}
    </button>
  );
}
