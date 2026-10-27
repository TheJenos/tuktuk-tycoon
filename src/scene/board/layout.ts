/*
 * Board geometry, pure math (unit tested). The board lies on the XZ plane centred at the origin, the camera's
 * default view looking from +Z. Play runs clockwise seen from above: GO bottom-right (+x, +z), Jail bottom-left,
 * Free Parking top-left, Go To Jail top-right.
 *
 * Boards have different numbers of spaces (always a multiple of 4: a corner and PER_SIDE - 1 tiles a side), and a
 * bigger board is a bigger slab: its side grows with the square root of the space count (All Island's 40 spaces:
 * 12.2 across, tiles 1 wide), and the tiles share what the corners leave. The scene shows one board at a time, so
 * the size is module state, set by setBoardSize() before the scene renders (GameScene, BackdropScene); the exports
 * below are live bindings that follow it.
 *
 * Every tile is laid out in the frame of the bottom row ("local" coordinates) and rotated by its side: side s holds
 * tiles s·PER_SIDE .. s·PER_SIDE + PER_SIDE - 1, its corner first. In the local frame the outer edge is z = HALF and
 * the inner edge z = INNER; tile k (1 .. PER_SIDE - 1) runs from the corner at +x towards -x.
 */

export const TILE_D = 1.6;
export const CORNER = 1.6;
/** Wooden frame around the printed board */
export const FRAME = 0.35;
/** The colour band along a street's inner edge, where its houses stand */
export const BAND = 0.36;
/** Height of the printed board top above the table */
export const BOARD_TOP = 0.2;

/** Spaces on the board in play */
export let TILES = 40;
/** Spaces a side, its corner included */
export let PER_SIDE = 10;
/** Width of a (non-corner) tile along its side */
export let TILE_W = 1;
/** Board side: two corners and PER_SIDE - 1 tiles */
export let SIDE = 2 * CORNER + 9 * TILE_W;
export let HALF = SIDE / 2;
/** Distance from the centre to the inner edge of the ring of tiles */
export let INNER = HALF - TILE_D;
/** The jail corner (side 1's corner: the layout draws the cell there) */
export let JAIL = 10;
/** The jail cell inside the jail corner (local frame of the jail's side); the rest of the corner is Just Visiting */
export let JAIL_CELL = { min: INNER, max: INNER + 1.05 } as const;
/** The board's middle against All Island's (the decks, the dice's square and the banner scale with it) */
export let CENTRE = 1;

/** Lays the geometry out for a board of `n` spaces (a multiple of 4, at least 16) */
export function setBoardSize(n: number): void {
  if (n === TILES) return;
  if (!Number.isInteger(n) || n % 4 !== 0 || n < 16) throw new Error(`a board needs a multiple of 4 spaces, not ${n}`);
  TILES = n;
  PER_SIDE = n / 4;
  SIDE = 12.2 * Math.sqrt(n / 40);
  TILE_W = (SIDE - 2 * CORNER) / (PER_SIDE - 1);
  HALF = SIDE / 2;
  INNER = HALF - TILE_D;
  JAIL = PER_SIDE;
  JAIL_CELL = { min: INNER, max: INNER + 1.05 };
  CENTRE = INNER / 4.5;
}

export type XZ = [x: number, z: number];

export const sideOf = (i: number): number => Math.floor((((i % TILES) + TILES) % TILES) / PER_SIDE);
export const isCorner = (i: number): boolean => i % PER_SIDE === 0;

/** Local (bottom-row) coordinates of side `side` to world coordinates */
export function toWorld(side: number, x: number, z: number): XZ {
  switch (side & 3) {
    case 0: return [x, z];
    case 1: return [-z, x];
    case 2: return [-x, -z];
    default: return [z, -x];
  }
}

/** World coordinates to the local frame of side `side` */
export function toLocal(side: number, x: number, z: number): XZ {
  switch (side & 3) {
    case 0: return [x, z];
    case 1: return [z, -x];
    case 2: return [-x, -z];
    default: return [-z, x];
  }
}

/** Rotation about +Y (three.js convention) that turns the local frame into side `side` */
export const sideRotation = (side: number): number => (-(side & 3) * Math.PI) / 2;
export const tileRotation = (i: number): number => sideRotation(sideOf(i));

/** Centre of tile `i` in its local frame */
export function localCenter(i: number): XZ {
  const k = i % PER_SIDE;
  return k === 0 ? [HALF - CORNER / 2, HALF - CORNER / 2] : [HALF - CORNER - (k - 0.5) * TILE_W, HALF - TILE_D / 2];
}

export function tileCenter(i: number): XZ {
  const [x, z] = localCenter(i);
  return toWorld(sideOf(i), x, z);
}

/** Size of a tile in its local frame: [along the side, depth] */
export const tileSize = (i: number): XZ => (isCorner(i) ? [CORNER, CORNER] : [TILE_W, TILE_D]);

/** The tile under a board point, or null in the middle or off the board */
export function tileAt(x: number, z: number): number | null {
  for (let side = 0; side < 4; side++) {
    const [lx, lz] = toLocal(side, x, z);
    // Each side owns its strip from its own corner up to (not including) the next side's corner.
    if (lz < INNER || lz > HALF || lx <= -INNER || lx > HALF) continue;
    if (lx >= INNER) return side * PER_SIDE;
    return side * PER_SIDE + Math.min(PER_SIDE - 1, Math.max(1, Math.floor((HALF - CORNER - lx) / TILE_W) + 1));
  }
  return null;
}

function grid(n: number, k: number, cols: number, dx: number, dz: number): XZ {
  const rows = Math.ceil(n / cols);
  const row = Math.floor(k / cols);
  const inRow = row === rows - 1 ? n - row * cols : cols;
  const col = k % cols;
  return [(col - (inRow - 1) / 2) * dx, (row - (rows - 1) / 2) * dz];
}

/**
 * Where token `k` of `n` stands on tile `i` (world). Up to 8 per tile: a 2-wide grid on a street (clear of the
 * colour band), a 3x3 grid on a corner. On the jail corner `inCell` picks the cell; otherwise the Just Visiting strip.
 */
export function slotPos(i: number, n: number, k: number, inCell = false): XZ {
  const side = sideOf(i);
  const count = Math.max(1, n);
  const slot = Math.min(Math.max(0, k), count - 1);
  let local: XZ;
  if (i === JAIL) {
    if (inCell) {
      const c = (JAIL_CELL.min + JAIL_CELL.max) / 2;
      const [gx, gz] = count === 1 ? [0, 0] : count <= 4 ? grid(count, slot, 2, 0.44, 0.44) : grid(count, slot, 3, 0.33, 0.33);
      local = [c + gx, c + gz];
    } else {
      // The L-shaped Just Visiting strip along the two outer edges: the first visitor in its corner, the others
      // shared between the two legs.
      const edge = (JAIL_CELL.max + HALF) / 2;
      const leg = edge - (INNER + 0.12);
      const legA = Math.ceil((count - 1) / 2);
      const onA = slot <= legA;
      const d = slot === 0 ? 0 : (leg * (onA ? slot : slot - legA)) / (onA ? legA : count - 1 - legA);
      local = onA ? [edge - d, edge] : [edge, edge - d];
    }
  } else if (isCorner(i)) {
    const [cx, cz] = localCenter(i);
    const [gx, gz] = count === 1 ? [0, 0] : count <= 4 ? grid(count, slot, 2, 0.5, 0.5) : grid(count, slot, 3, 0.46, 0.46);
    local = [cx + gx, cz + gz];
  } else {
    const [cx] = localCenter(i);
    // The part of the tile below the colour band
    const cz = (INNER + BAND + HALF) / 2;
    // Narrower tiles (a bigger board) pack their tokens closer along the side
    const [gx, gz] = count === 1 ? [0, 0] : grid(count, slot, 2, 0.44 * Math.min(1, TILE_W), 0.29);
    local = [cx + gx, cz + gz];
  }
  return toWorld(side, local[0], local[1]);
}

/** House `slot` 0-3 on a street's colour band, or 4 for the hotel (world) */
export function buildingPos(i: number, slot: number): XZ {
  const [cx] = localCenter(i);
  const x = slot >= 4 ? cx : cx + (slot - 1.5) * 0.24 * Math.min(1, TILE_W);
  return toWorld(sideOf(i), x, INNER + BAND / 2);
}

/** The owner bar on the frame, outside tile `i` */
export function chipPos(i: number): XZ {
  return toWorld(sideOf(i), localCenter(i)[0], HALF + FRAME / 2);
}

/** Heading (rotation about +Y, a model facing +X) that faces the direction of play along tile `i`'s side */
export const travelYaw = (i: number): number => Math.PI + tileRotation(i);

/** Axis-aligned world bounds of tile `i` */
export function tileBounds(i: number): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const [x, z] = tileCenter(i);
  const [w, d] = tileSize(i);
  const across = sideOf(i) % 2 === 0;
  const hx = (across ? w : d) / 2;
  const hz = (across ? d : w) / 2;
  return { minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz };
}
