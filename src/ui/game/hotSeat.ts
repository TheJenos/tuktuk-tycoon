import { createStore } from '../../state/store';

/*
 * Hot-seat (several local seats on one device): whether a "Pass to <name>" card goes up between two players'
 * decisions. Saved in this browser; on unless turned off.
 */

const KEY = 'tuktuk-hotseat';

function load(): boolean {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}

export const hotSeatCards = createStore<boolean>(load());

export function setHotSeatCards(on: boolean): void {
  hotSeatCards.set(on);
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    // not saved: still applies to this tab
  }
}
