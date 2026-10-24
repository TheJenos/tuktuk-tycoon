/*
 * What sits in the middle of the board: the two card decks (drawn on the board texture as outlines, stacked in 3D)
 * and the area the dice are thrown into. Shared by the texture, the 3D decks and the dice simulation's colliders.
 */

export const CARD_W = 1.6;
export const CARD_H = 1;

export interface DeckSpot {
  x: number;
  z: number;
  /** Rotation about +Y */
  yaw: number;
}

/** Community Chest top-left, Chance bottom-right, both turned to the diagonal as on the classic board */
export const DECKS: Record<'chance' | 'chest', DeckSpot> = {
  chest: { x: -2.45, z: -2.45, yaw: Math.PI / 4 },
  chance: { x: 2.45, z: 2.45, yaw: Math.PI / 4 },
};

/** Half-width of the square the dice stay inside (walls of the physics throw) */
export const THROW_HALF = 4.2;
