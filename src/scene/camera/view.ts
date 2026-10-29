import type { BoardView } from '../../ui/settings';

/*
 * The two board views, pure. 3D is the tilted table the camera swings round; 2D is the same scene seen straight
 * down with a long lens, so it reads as a flat printed board (perspective all but gone) and always the same way up.
 */

/** Vertical field of view, degrees */
export const VIEW_FOV: Record<BoardView, number> = { '3d': 40, '2d': 12 };

/** Polar angle of every 2D shot: straight down */
export const TOP_DOWN = 0;

/**
 * How much farther the camera stands in a view than in 3D to show the same area: the ratio of the half-angle
 * tangents. The distance limits scale by this, so zooming feels the same in both.
 */
export const distanceScale = (view: BoardView): number =>
  Math.tan(((VIEW_FOV['3d'] / 2) * Math.PI) / 180) / Math.tan(((VIEW_FOV[view] / 2) * Math.PI) / 180);
