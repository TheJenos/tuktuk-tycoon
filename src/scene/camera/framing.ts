import { FRAME, HALF, isCorner, sideOf, sideRotation, TILES, tileBounds, tileCenter } from '../board/layout';

/*
 * Camera framing, pure: where to put the camera so a box on the board fills the part of the screen the HUD leaves
 * free. The canvas is full-bleed behind the panels, so the box is fitted to the free rectangle and the view is
 * shifted onto it with camera-controls' focal offset (a sideways move of the camera in its own plane).
 */

export interface Area {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Fractions (0-1) of the canvas covered by HUD panels on each side */
export interface Insets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface Framing {
  target: [number, number, number];
  distance: number;
  /** camera-controls focal offset: +x moves the camera right, +y moves it down */
  offset: [number, number];
}

export interface Lens {
  /** Vertical field of view, degrees */
  fov: number;
  aspect: number;
  minDistance: number;
  maxDistance: number;
}

/** Height of everything on the board that should stay in frame (tokens, houses) */
const CONTENT_H = 0.6;

export const BOARD_AREA: Area = { minX: -HALF - FRAME, maxX: HALF + FRAME, minZ: -HALF - FRAME, maxZ: HALF + FRAME };

/** The tiles of a path, padded, at least `min` across so a one-tile step doesn't zoom right in */
export function pathArea(path: readonly number[], pad = 1, min = 5.5): Area {
  const a: Area = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const i of path) {
    const b = tileBounds(i);
    a.minX = Math.min(a.minX, b.minX);
    a.maxX = Math.max(a.maxX, b.maxX);
    a.minZ = Math.min(a.minZ, b.minZ);
    a.maxZ = Math.max(a.maxZ, b.maxZ);
  }
  if (!Number.isFinite(a.minX)) return BOARD_AREA;
  const grow = (lo: number, hi: number): [number, number] => {
    const c = (lo + hi) / 2;
    const half = Math.max(min / 2, (hi - lo) / 2 + pad);
    return [c - half, c + half];
  };
  const [minX, maxX] = grow(a.minX, a.maxX);
  const [minZ, maxZ] = grow(a.minZ, a.maxZ);
  return { minX, maxX, minZ, maxZ };
}

/**
 * The camera azimuth that looks at the lane (board side) a path ends on from outside it, so that row is nearest
 * and its names read the right way up. A path ending on a corner belongs to the side it came along (a step from
 * the neighbouring tile); a jump onto a corner takes the corner's own side.
 */
export function laneAzimuth(path: readonly number[]): number {
  const end = path[path.length - 1] ?? 0;
  const prev = path[path.length - 2];
  const stepped = prev !== undefined && Math.abs(((end - prev + TILES + TILES / 2) % TILES) - TILES / 2) === 1;
  return sideRotation(isCorner(end) && stepped ? sideOf(prev) : sideOf(end));
}

/** `from` turned to face `to` the short way round (camera-controls' azimuth isn't wrapped) */
export function nearestAzimuth(from: number, to: number): number {
  return from + Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

/** A square of side `size` around a tile */
export function tileArea(i: number, size = 4.5): Area {
  const [x, z] = tileCenter(i);
  return { minX: x - size / 2, maxX: x + size / 2, minZ: z - size / 2, maxZ: z + size / 2 };
}

/**
 * The free span of one screen axis in NDC (-1..1) between the panels on its two sides, never less than a third of
 * it (a huge panel can't squeeze the board to nothing: the panels then give up room in proportion).
 */
function freeSpan(lo: number, hi: number): [number, number] {
  let a = Math.max(0, lo);
  let b = Math.max(0, hi);
  if (a + b > 2 / 3) {
    const k = 2 / 3 / (a + b);
    a *= k;
    b *= k;
  }
  return [-1 + 2 * a, 1 - 2 * b];
}

/** A box corner relative to the target: `a` along one screen axis, `c` towards the camera */
interface Pt {
  a: number;
  c: number;
}

/*
 * Exact perspective fit on one screen axis. With the camera `d` from the target along the view direction and moved
 * `o` sideways along the axis, a point projects to (a - o) / ((d - c) t) in NDC, t = tan(half the field of view on
 * that axis). Keeping it in lo..hi bounds o from both sides, linearly in d; the board fits once every lower bound
 * is under every upper bound, which gives the least d pair by pair.
 */
function axisDistance(pts: readonly Pt[], t: number, [lo, hi]: [number, number]): number {
  let d = 0;
  for (const p of pts) for (const q of pts) d = Math.max(d, (p.a - q.a + t * (hi * p.c - lo * q.c)) / (t * (hi - lo)));
  return d;
}

/** The sideways moves at distance d that keep every point in lo..hi: [min, max] (min > max when they can't all fit) */
function shiftRange(pts: readonly Pt[], t: number, [lo, hi]: [number, number], d: number): [number, number] {
  let min = -Infinity;
  let max = Infinity;
  for (const p of pts) {
    min = Math.max(min, p.a - hi * t * (d - p.c));
    max = Math.min(max, p.a - lo * t * (d - p.c));
  }
  return [min, max];
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/*
 * The sideways move on one axis: the area's points centred in lo..hi, then slid towards the board (`bounds`) as far
 * as the area allows, so the free part of the screen never shows bare table beside the board while the board could
 * fill it. Where the board fits on the axis it is centred; where it is larger, it keeps covering the whole span. The
 * shift range that keeps every board point inside lo..hi is [bMin, bMax] when it fits; when it doesn't, the same two
 * bounds reversed, [bMax, bMin], are the shifts that leave a board point beyond each end of the span.
 */
function axisShift(area: readonly Pt[], bounds: readonly Pt[] | null, t: number, span: [number, number], d: number): number {
  const [aMin, aMax] = shiftRange(area, t, span, d);
  const mid = (aMin + aMax) / 2;
  // The area doesn't fit (the distance hit its limit): centre it as well as can be
  if (!bounds || !(aMin <= aMax)) return mid;
  const [bMin, bMax] = shiftRange(bounds, t, span, d);
  const want = bMin <= bMax ? (bMin + bMax) / 2 : clamp(mid, bMax, bMin);
  return clamp(want, aMin, aMax);
}

/**
 * Frame `area` seen from spherical angles (camera-controls': azimuth from +Z towards +X, polar from +Y): the least
 * distance at which the box's corners (tokens' height included) fit the rectangle the HUD leaves free, on both
 * the vertical and the horizontal field of view, perspective included; then the focal offset that centres them
 * in it, slid towards `bounds` (the board) so the free rectangle shows as much board as it can: on a portrait phone,
 * where the board's width sets the distance of every shot, a move along the top row frames the whole board rather
 * than leaving an empty band above it and pushing its near half under the bottom sheet.
 */
export function frameArea(area: Area, azimuth: number, polar: number, lens: Lens, insets: Insets, bounds: Area | null = BOARD_AREA): Framing {
  const sp = Math.sin(polar);
  const dir: [number, number, number] = [sp * Math.sin(azimuth), Math.cos(polar), sp * Math.cos(azimuth)];
  const right: [number, number, number] = [Math.cos(azimuth), 0, -Math.sin(azimuth)];
  // up = dir x right
  const up: [number, number, number] = [
    dir[1] * right[2] - dir[2] * right[1],
    dir[2] * right[0] - dir[0] * right[2],
    dir[0] * right[1] - dir[1] * right[0],
  ];
  const cx = (area.minX + area.maxX) / 2;
  const cz = (area.minZ + area.maxZ) / 2;
  const cy = CONTENT_H / 2;
  /** A box's corners on the two screen axes, relative to the target */
  const project = (box: Area): { xs: Pt[]; ys: Pt[] } => {
    const xs: Pt[] = [];
    const ys: Pt[] = [];
    for (const x of [box.minX, box.maxX]) {
      for (const y of [0, CONTENT_H]) {
        for (const z of [box.minZ, box.maxZ]) {
          const d: [number, number, number] = [x - cx, y - cy, z - cz];
          const dot = (v: [number, number, number]) => d[0] * v[0] + d[1] * v[1] + d[2] * v[2];
          const c = dot(dir);
          xs.push({ a: dot(right), c });
          ys.push({ a: dot(up), c });
        }
      }
    }
    return { xs, ys };
  };
  const { xs, ys } = project(area);
  const board = bounds ? project(bounds) : null;
  const ty = Math.tan(((lens.fov / 2) * Math.PI) / 180);
  const tx = ty * lens.aspect;
  const spanX = freeSpan(insets.left, insets.right);
  // NDC y runs up: the bottom panel bounds it from below
  const spanY = freeSpan(insets.bottom, insets.top);
  const fit = Math.max(axisDistance(xs, tx, spanX), axisDistance(ys, ty, spanY));
  const distance = Math.min(lens.maxDistance, Math.max(lens.minDistance, fit));
  // camera-controls moves the camera down for a positive y offset, against the view's up
  return {
    target: [cx, cy, cz],
    distance,
    offset: [axisShift(xs, board?.xs ?? null, tx, spanX, distance), -axisShift(ys, board?.ys ?? null, ty, spanY, distance)],
  };
}

/**
 * A shot's polar angle for a window shape: `wide` on a wide screen, up to 0.22 rad nearer top-down on a tall one,
 * where the board's width is what limits it and there is height to spare for showing it less foreshortened.
 */
export function shotPolar(wide: number, aspect: number): number {
  const t = Math.min(1, Math.max(0, (aspect - 0.6) / 0.6));
  return wide - 0.22 * (1 - t);
}

/**
 * How far out the camera may zoom: far enough to see the whole board from the front or across a corner (its
 * widest) in this window and around these panels, with some room to spare, and never less than `floor`. A portrait
 * phone needs far more than a desktop.
 */
export function zoomOutLimit(fov: number, aspect: number, insets: Insets, polar: number, floor: number): number {
  const lens: Lens = { fov, aspect, minDistance: 0, maxDistance: Infinity };
  const fit = Math.max(frameArea(BOARD_AREA, 0, polar, lens, insets).distance, frameArea(BOARD_AREA, Math.PI / 4, polar, lens, insets).distance);
  return Math.max(floor, fit * 1.15);
}
