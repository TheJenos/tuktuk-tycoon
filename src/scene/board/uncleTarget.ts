import type { LogEntry } from '../../view';

/*
 * Pure: the space Tuk-Tuk Uncle is sending a token to, from the director's log. The engine emits `uncle` (with `to`),
 * then the move there, salary and cash when it passes GO, then `land`; the target is marked from the first until
 * the last.
 */

export function uncleTarget(log: readonly LogEntry[]): number | null {
  for (let i = log.length - 1; i >= 0; i--) {
    const ev = log[i]!.ev;
    if (ev.t === 'uncle') return ev.to ?? null;
    if (!(ev.t === 'move' && ev.via === 'uncle') && ev.t !== 'salary' && ev.t !== 'cash') return null;
  }
  return null;
}
