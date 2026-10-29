import type { BoardView } from '../../ui/settings';

/*
 * The two board views, pure. 3D is the tilted table the camera swings round; 2D is the same scene seen straight
 * down with a long lens, so it reads as a flat printed board (perspective all but gone) and always the same way up.
 */

/** Vertical field of view, degrees */
export const VIEW_FOV: Record<BoardView, number> = { '3d': 40, '2d': 12 };

/**
 * Near and far clipping planes. 2D stands about 3.5 times farther off, so its near plane moves out with it: the depth
 * buffer's precision falls with the square of the distance over the near plane, and at 0.1 the printed board (a hair
 * above the slab) lost to the slab's top. Nothing is ever drawn closer than the 2D minimum distance (about 15).
 */
export const VIEW_CLIP: Record<BoardView, { near: number; far: number }> = { '3d': { near: 0.1, far: 200 }, '2d': { near: 2, far: 700 } };

/** Polar angle of every 2D shot: straight down */
export const TOP_DOWN = 0;

/**
 * How much farther the camera stands in a view than in 3D to show the same area: the ratio of the half-angle
 * tangents. The distance limits scale by this, so zooming feels the same in both.
 */
export const distanceScale = (view: BoardView): number =>
  Math.tan(((VIEW_FOV['3d'] / 2) * Math.PI) / 180) / Math.tan(((VIEW_FOV[view] / 2) * Math.PI) / 180);
