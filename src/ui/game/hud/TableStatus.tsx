import { useEffect, useState } from 'react';
import { useDoc, useServerNow } from '../context';
import { money } from '../format';
import { parkingOf } from '../selectors';
import '../options.css';

/** "1:05:09" / "12:34" / "0:09" */
export function clockText(ms: number): string {
  const t = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Re-renders once a second while `on` */
function useTick(on: boolean): void {
  const [, set] = useState(0);
  useEffect(() => {
    if (!on) return;
    const id = window.setInterval(() => set((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [on]);
}

/**
 * Small chips under the turn bar for the room options that run during the game: the time left when the room has a
 * time limit, and the jackpot waiting on the parking space.
 */
export function TableStatus() {
  const doc = useDoc();
  const now = useServerNow();
  const s = doc?.game;
  const over = s?.phase.k === 'over';
  const endsAt = doc?.endsAt;
  useTick(endsAt !== undefined && !over);
  if (!s || over) return null;
  const jackpot = s.cfg.jackpot;
  if (endsAt === undefined && !jackpot) return null;
  const left = endsAt !== undefined ? endsAt - now() : 0;
  return (
    <div className="table-status" data-testid="table-status">
      {endsAt !== undefined && (
        <span className={left <= 60_000 ? 'status-chip clock low' : 'status-chip clock'} role="timer" aria-label={`Time left: ${clockText(left)}`} title="Time left: then the richest by net worth wins">
          <span aria-hidden="true">⏱</span> {clockText(left)}
        </span>
      )}
      {jackpot && (
        <span className="status-chip jackpot" title={`Won by the next player to land on ${parkingOf(s)}`}>
          <span className="muted">{parkingOf(s)} jackpot</span> <strong>{money(s.pot)}</strong>
        </span>
      )}
    </div>
  );
}
