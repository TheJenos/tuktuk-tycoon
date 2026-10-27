import { Color, type MeshStandardMaterial } from 'three';
import { uiStore } from '../state/ui';

/*
 * Things on the board that stand above the spotlight's dark overlay (the deck stacks, the dice) dim with it by
 * darkening their materials while a player is spotlighted (uiStore.spotlight), and get their colour back after.
 * The other players' pieces (tokens, owner bars, buildings) dim by the same amount, each where it is drawn.
 */

/** How much of their colour dimmed materials keep (linear: about a third of the brightness on screen, like the overlay) */
export const DIM = 0.1;

const registered = new Map<MeshStandardMaterial, Color>();
let dimmed = false;

function apply(): void {
  for (const [mat, base] of registered) {
    mat.color.copy(base);
    if (dimmed) mat.color.multiplyScalar(DIM);
  }
}

uiStore.subscribe(() => {
  const now = uiStore.get().spotlight !== null;
  if (now === dimmed) return;
  dimmed = now;
  apply();
});

/** Dim these materials with the spotlight (safe to call again with the same materials) */
export function dimWithSpotlight(mats: readonly MeshStandardMaterial[]): void {
  for (const m of mats) {
    if (registered.has(m)) continue;
    registered.set(m, m.color.clone());
    if (dimmed) m.color.multiplyScalar(DIM);
  }
}
