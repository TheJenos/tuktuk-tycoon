import type { LogEntry } from '../../view';

/*
 * Pure: on Hero League, the location a back-up hero is being picked for, from the director's log. The engine emits
 * `land` on it, then the Hero die (`heroDie` for a back-up, each re-roll a `power` and another throw, a window may
 * time out); the location is marked from the first throw until the save or until nobody can save it.
 */

export function saveTarget(log: readonly LogEntry[]): number | null {
  let thrown = false;
  for (let i = log.length - 1; i >= 0; i--) {
    const ev = log[i]!.ev;
    if (ev.t === 'land') return thrown ? ev.space : null;
    if (ev.t === 'heroDie' && ev.purpose === 'backup') thrown = true;
    else if (!(ev.t === 'power' && ev.power === 'thunder') && ev.t !== 'reactTimeout') return null;
  }
  return null;
}
