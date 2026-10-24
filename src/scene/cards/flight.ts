import { createStore } from '../../state/store';

/*
 * The 3D card's flight as the DOM sees it, without importing the scene: whether a drawn card is up in 3D right
 * now, and a way to send it back to its deck early (the DOM caption's OK). Cards fills both in while it flies.
 */

export const cardFlight = createStore<{ flying: boolean }>({ flying: false });

let skip: (() => void) | null = null;

/** Sends the flying card home now (nothing when none is up) */
export function finishCard(): void {
  skip?.();
}

/** Cards' hook while a card is up; returns the unregister function */
export function setCardSkip(fn: () => void): () => void {
  skip = fn;
  cardFlight.update({ flying: true });
  return () => {
    if (skip !== fn) return;
    skip = null;
    cardFlight.update({ flying: false });
  };
}
