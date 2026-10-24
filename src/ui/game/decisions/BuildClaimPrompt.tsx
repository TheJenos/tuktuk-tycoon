import { useState } from 'react';
import { buildCapacity, type BuildClaimPhase, type SeatId } from '../../../rules';
import { useBusy, useSend } from '../actions';
import { useGame, useNames } from '../context';
import { plural } from '../format';
import { Prompt } from './Prompt';

/**
 * A building shortage: the bank has fewer houses (or hotels) than the builders want. Each builder states how many
 * they want; if the total fits, everyone gets theirs, otherwise the units are auctioned one at a time.
 */
export function BuildClaimPrompt({ seats }: { seats: SeatId[] }) {
  const s = useGame();
  const names = useNames();
  if (!s || s.phase.k !== 'buildClaim') return null;
  const ph = s.phase;
  const supply = ph.kind === 'house' ? s.bank.houses : s.bank.hotels;
  const asked = (Object.keys(ph.req) as SeatId[]).filter((seat) => (ph.req[seat] ?? 0) > 0);
  return (
    <Prompt title={`${ph.kind === 'house' ? 'Housing' : 'Hotel'} shortage`} className="claim-prompt">
      <p>
        The bank has only {plural(supply, ph.kind)} and {names.seat(ph.by)} wants to build. How many do you want? If the requests add
        up to more than the bank has, they are auctioned one at a time.
      </p>
      {asked.length > 0 && (
        <p className="muted small">
          Asked so far: {asked.map((seat) => `${names.seat(seat)} ${ph.req[seat]}`).join(', ')}
        </p>
      )}
      {seats.map((seat) => (
        <ClaimRow key={seat} seat={seat} ph={ph} many={seats.length > 1} />
      ))}
    </Prompt>
  );
}

function ClaimRow({ seat, ph, many }: { seat: SeatId; ph: BuildClaimPhase; many: boolean }) {
  const s = useGame();
  const names = useNames();
  const send = useSend();
  const busy = useBusy();
  const cap = s ? buildCapacity(s, seat, ph.kind) : 0;
  const [n, setN] = useState(Math.max(1, cap));
  const value = Math.max(1, Math.min(cap, n));
  return (
    <div className="claim-row" role="group" aria-label={many ? `Request for ${names.seat(seat)}` : 'Your request'}>
      {many && <strong>{names.seat(seat)}</strong>}
      <div className="stepper">
        <button type="button" className="icon-button" aria-label="One fewer" disabled={value <= 1} onClick={() => setN(value - 1)}>−</button>
        <output aria-live="polite">{value}</output>
        <button type="button" className="icon-button" aria-label="One more" disabled={value >= cap} onClick={() => setN(value + 1)}>+</button>
        <span className="muted small">up to {cap}</span>
      </div>
      <div className="action-row">
        <button type="button" className="primary" disabled={busy || cap < 1} onClick={() => void send(seat, { k: 'requestBuild', n: value })}>
          Ask for {plural(value, ph.kind)}
        </button>
        <button type="button" disabled={busy} onClick={() => void send(seat, { k: 'pass' })}>
          Pass
        </button>
      </div>
    </div>
  );
}
