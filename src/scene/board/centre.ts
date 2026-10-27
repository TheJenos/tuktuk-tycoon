import { CENTRE } from './layout';

/*
 * What sits in the middle of the board: the two card decks (drawn on the board texture as outlines, stacked in 3D)
 * and the area the dice are thrown into. Shared by the texture, the 3D decks and the dice simulation's colliders.
 * Placed for All Island's middle and scaled with the board in play's (layout CENTRE); the cards keep their size.
 */

export const CARD_W = 1.6;
export const CARD_H = 1;

export interface DeckSpot {
  x: number;
  z: number;
  /** Rotation about +Y */
  yaw: number;
}

/** Where a deck sits: Community Chest top-left, Chance bottom-right, both turned to the diagonal as on the classic board */
export function deckSpot(deck: 'chance' | 'chest'): DeckSpot {
  const d = 2.45 * CENTRE;
  return deck === 'chest' ? { x: -d, z: -d, yaw: Math.PI / 4 } : { x: d, z: d, yaw: Math.PI / 4 };
}

/** Half-width of the square the dice stay inside (walls of the physics throw) */
export const throwHalf = (): number => 4.2 * CENTRE;
