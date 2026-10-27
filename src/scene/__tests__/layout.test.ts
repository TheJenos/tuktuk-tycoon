import { afterEach, describe, expect, it } from 'vitest';
import { createGame } from '../../rules';
import { pieceChanges, piecesOf } from '../board/pieceList';
import { deckSpot, throwHalf } from '../board/centre';
import {
  buildingPos,
  CENTRE,
  chipPos,
  HALF,
  INNER,
  JAIL,
  PER_SIDE,
  setBoardSize,
  SIDE,
  TILE_W,
  TILES,
  slotPos,
  tileAt,
  tileBounds,
  tileCenter,
  tileRotation,
  toLocal,
  toWorld,
  travelYaw,
} from '../board/layout';

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

describe('board layout', () => {
  it('is 12.2 wide with GO bottom-right and play running clockwise', () => {
    expect(SIDE).toBeCloseTo(12.2);
    const [gx, gz] = tileCenter(0);
    expect(gx).toBeGreaterThan(0);
    expect(gz).toBeGreaterThan(0);
    const [jx, jz] = tileCenter(10);
    expect(jx).toBeLessThan(0);
    expect(jz).toBeGreaterThan(0);
    const [px, pz] = tileCenter(20);
    expect(px).toBeLessThan(0);
    expect(pz).toBeLessThan(0);
    const [tx, tz] = tileCenter(30);
    expect(tx).toBeGreaterThan(0);
    expect(tz).toBeLessThan(0);
    // Tile 1 is next to GO along the bottom row, tile 39 next to GO up the right side.
    expect(tileCenter(1)[0]).toBeCloseTo(4);
    expect(tileCenter(1)[1]).toBeCloseTo(HALF - 0.8);
    expect(tileCenter(39)[0]).toBeCloseTo(HALF - 0.8);
    expect(tileCenter(39)[1]).toBeCloseTo(4);
  });

  it('round-trips every tile centre and every point inside a tile', () => {
    for (let i = 0; i < 40; i++) {
      const [x, z] = tileCenter(i);
      expect(tileAt(x, z)).toBe(i);
      const b = tileBounds(i);
      for (const fx of [0.02, 0.3, 0.5, 0.7, 0.98]) {
        for (const fz of [0.02, 0.5, 0.98]) {
          expect(tileAt(b.minX + (b.maxX - b.minX) * fx, b.minZ + (b.maxZ - b.minZ) * fz), `tile ${i} at ${fx},${fz}`).toBe(i);
        }
      }
    }
  });

  it('tiles cover the ring without overlapping, and nothing else', () => {
    let area = 0;
    for (let i = 0; i < 40; i++) {
      const b = tileBounds(i);
      area += (b.maxX - b.minX) * (b.maxZ - b.minZ);
    }
    expect(area).toBeCloseTo(SIDE * SIDE - (2 * INNER) ** 2);
    expect(tileAt(0, 0)).toBeNull();
    expect(tileAt(INNER - 0.01, 0)).toBeNull();
    expect(tileAt(HALF + 0.01, 0)).toBeNull();
    expect(tileAt(0, -HALF - 0.5)).toBeNull();
  });

  it('local and world frames invert each other', () => {
    for (let side = 0; side < 4; side++) {
      const [x, z] = toWorld(side, 1.25, -3.5);
      const [lx, lz] = toLocal(side, x, z);
      expect(near(lx, 1.25) && near(lz, -3.5)).toBe(true);
      // tileRotation matches toWorld: rotating the local +X axis by the side's angle gives toWorld(1, 0)
      const th = tileRotation(side * 10 + 3);
      const [wx, wz] = toWorld(side, 1, 0);
      expect(Math.cos(th)).toBeCloseTo(wx);
      expect(-Math.sin(th)).toBeCloseTo(wz);
    }
  });

  it('puts up to 8 tokens inside their tile, apart from each other', () => {
    for (let i = 0; i < 40; i++) {
      for (let n = 1; n <= 8; n++) {
        for (const inCell of i === 10 ? [false, true] : [false]) {
          const pts = Array.from({ length: n }, (_, k) => slotPos(i, n, k, inCell));
          for (const [x, z] of pts) expect(tileAt(x, z), `tile ${i} n ${n}`).toBe(i);
          for (let a = 0; a < n; a++) {
            for (let b = a + 1; b < n; b++) {
              const pa = pts[a] as [number, number];
              const pb = pts[b] as [number, number];
              expect(Math.hypot(pa[0] - pb[0], pa[1] - pb[1]), `tile ${i} n ${n}`).toBeGreaterThan(0.28);
            }
          }
        }
      }
    }
  });

  it('keeps jailed tokens in the cell and visitors out of it', () => {
    for (let n = 1; n <= 8; n++) {
      for (let k = 0; k < n; k++) {
        const [cx, cz] = toLocal(1, ...slotPos(10, n, k, true));
        expect(cx).toBeLessThan(INNER + 1.05);
        expect(cz).toBeLessThan(INNER + 1.05);
        const [vx, vz] = toLocal(1, ...slotPos(10, n, k, false));
        expect(Math.max(vx, vz)).toBeGreaterThan(INNER + 1.05);
      }
    }
  });

  it('places houses on the band, chips on the frame and headings along the side', () => {
    for (const i of [1, 3, 11, 24, 39]) {
      for (let slot = 0; slot < 5; slot++) expect(tileAt(...buildingPos(i, slot))).toBe(i);
      const [x, z] = chipPos(i);
      expect(Math.max(Math.abs(x), Math.abs(z))).toBeGreaterThan(HALF);
    }
    // Facing +X rotated by the heading points from tile i towards tile i+1.
    for (const i of [2, 15, 22, 35]) {
      const th = travelYaw(i);
      const dir = [Math.cos(th), -Math.sin(th)];
      const a = tileCenter(i);
      const b = tileCenter(i + 1);
      expect(dir[0] as number).toBeCloseTo(b[0] - a[0]);
      expect(dir[1] as number).toBeCloseTo(b[1] - a[1]);
    }
  });
});

describe('board pieces', () => {
  it('lists houses, hotels, chips and stamps, and what a level change moves', () => {
    const { state } = createGame({}, [{ id: 's0', name: 'A' }, { id: 's1', name: 'B' }], 1);
    state.props = { p1: { owner: 's0', level: 3 }, p3: { owner: 's0', level: 5 }, p5: { owner: 's1', level: 0, mortgaged: true } };
    const p = piecesOf(state);
    expect(p.houses.map((h) => h.key)).toEqual(['h:1:0', 'h:1:1', 'h:1:2']);
    expect(p.hotels.map((h) => h.key)).toEqual(['H:3']);
    expect(p.chips.length).toBe(3);
    expect(p.stamps.map((s) => s.key)).toEqual(['m:5']);
    const bank = { houses: 0, hotels: 0 };
    expect(pieceChanges({ t: 'level', space: 1, from: 3, to: 4, bank })).toEqual({ enter: ['h:1:3'], leave: [] });
    expect(pieceChanges({ t: 'level', space: 1, from: 4, to: 5, bank })).toEqual({ enter: ['H:1'], leave: ['h:1:0', 'h:1:1', 'h:1:2', 'h:1:3'] });
    expect(pieceChanges({ t: 'level', space: 1, from: 5, to: 4, bank }).leave).toEqual(['H:1']);
    expect(pieceChanges({ t: 'owner', space: 5, via: 'bankrupt', from: 's1' })).toEqual({ enter: [], leave: ['c:5'] });
  });
});

describe('board sizes', () => {
  afterEach(() => setBoardSize(40));

  it.each([32, 36, 40, 48])('lays out %i spaces: every tile found where it is drawn, the ring exactly filled', (n) => {
    setBoardSize(n);
    expect(TILES).toBe(n);
    expect(PER_SIDE).toBe(n / 4);
    expect(JAIL).toBe(n / 4);
    // A bigger board is a bigger slab; All Island's stays 12.2 with tiles 1 wide
    expect(SIDE).toBeCloseTo(12.2 * Math.sqrt(n / 40));
    if (n === 40) expect(TILE_W).toBeCloseTo(1);
    let area = 0;
    for (let i = 0; i < n; i++) {
      const [x, z] = tileCenter(i);
      expect(tileAt(x, z), `tile ${i}`).toBe(i);
      const b = tileBounds(i);
      area += (b.maxX - b.minX) * (b.maxZ - b.minZ);
      expect(Math.max(Math.abs(b.minX), Math.abs(b.maxX), Math.abs(b.minZ), Math.abs(b.maxZ))).toBeLessThanOrEqual(HALF + 1e-9);
    }
    expect(area).toBeCloseTo(SIDE * SIDE - (2 * INNER) ** 2);
    // The corners are GO, the jail, the middle corner and Go To Jail's, a side apart
    for (let s = 0; s < 4; s++) expect(tileRotation(s * PER_SIDE + 1)).toBeCloseTo(tileRotation(s * PER_SIDE));
    // Tokens on a street stay on it; houses stay on its band
    for (const i of [1, PER_SIDE - 1, 2 * PER_SIDE + 2]) {
      for (let k = 0; k < 4; k++) expect(tileAt(...slotPos(i, 4, k))).toBe(i);
      for (let h = 0; h < 5; h++) expect(tileAt(...buildingPos(i, h))).toBe(i);
    }
    // The middle (decks and dice) scales with the inner square and stays inside it
    expect(CENTRE).toBeCloseTo(INNER / 4.5);
    expect(throwHalf()).toBeLessThan(INNER);
    expect(Math.abs(deckSpot('chance').x) + 0.95).toBeLessThan(INNER);
  });
});
