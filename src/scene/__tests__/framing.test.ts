import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { boardArea, frameArea, laneAzimuth, nearestAzimuth, pathArea, shotPolar, tileArea, zoomOutLimit, type Area, type Framing, type Insets } from '../camera/framing';
import { tileAt, tileCenter } from '../board/layout';

/** Where the area's corners land on screen (NDC, -1..1) with the camera placed as camera-controls would */
function corners(area: Area, azimuth: number, polar: number, aspect: number, insets: Insets, maxDistance = 60, seen: Area = area) {
  const lens = { fov: 40, aspect, minDistance: 3, maxDistance };
  const f = frameArea(area, azimuth, polar, lens, insets);
  return project(seen, f, azimuth, polar, aspect);
}

/** Where a box's corners land with the camera placed for framing `f` */
function project(area: Area, f: Framing, azimuth: number, polar: number, aspect: number) {
  const cam = new PerspectiveCamera(40, aspect, 0.1, 200);
  const t = new Vector3(...f.target);
  const dir = new Vector3(Math.sin(polar) * Math.sin(azimuth), Math.cos(polar), Math.sin(polar) * Math.cos(azimuth));
  cam.position.copy(t).addScaledVector(dir, f.distance);
  cam.lookAt(t);
  cam.updateMatrixWorld();
  const right = new Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
  const up = new Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
  cam.position.addScaledVector(right, f.offset[0]).addScaledVector(up, -f.offset[1]);
  cam.updateMatrixWorld();
  const pts: Vector3[] = [];
  for (const x of [area.minX, area.maxX]) for (const z of [area.minZ, area.maxZ]) for (const y of [0, 0.6]) pts.push(new Vector3(x, y, z).project(cam));
  return pts;
}

const none: Insets = { left: 0, right: 0, top: 0, bottom: 0 };

describe('camera framing', () => {
  it('fits the whole board on screen from any side', () => {
    for (const aspect of [16 / 9, 4 / 3, 0.6]) {
      for (const azimuth of [0, 0.7, Math.PI / 2, Math.PI]) {
        const pts = corners(boardArea(), azimuth, 0.65, aspect, none);
        for (const p of pts) {
          expect(Math.abs(p.x)).toBeLessThanOrEqual(1.0001);
          expect(Math.abs(p.y)).toBeLessThanOrEqual(1.0001);
        }
        // ...and fills it: the perspective fit is exact, so a corner touches an edge
        expect(Math.max(...pts.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y))))).toBeGreaterThan(0.99);
      }
    }
  });

  it('keeps the board in the area the panels leave free', () => {
    const insets = { left: 0.25, right: 0.2, top: 0.1, bottom: 0.15 };
    const pts = corners(boardArea(), 0.3, 0.6, 16 / 9, insets);
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(-1 + 2 * insets.left - 1e-3);
      expect(p.x).toBeLessThanOrEqual(1 - 2 * insets.right + 1e-3);
      expect(p.y).toBeLessThanOrEqual(1 - 2 * insets.top + 1e-3);
      expect(p.y).toBeGreaterThanOrEqual(-1 + 2 * insets.bottom - 1e-3);
    }
  });

  it('fits a portrait phone across its width, past the old 34 limit, within the zoom-out limit', () => {
    // 390x844 with the players strip and turn bar on top and the bottom sheet (prompt + action bar) below
    const aspect = 390 / 844;
    const insets = { left: 0, right: 0, top: 0.2, bottom: 0.3 };
    const limit = zoomOutLimit(40, aspect, insets, 0.62, 34);
    expect(limit).toBeGreaterThan(34);
    const f = frameArea(boardArea(), 0, 0.62, { fov: 40, aspect, minDistance: 5, maxDistance: limit }, insets);
    expect(f.distance).toBeGreaterThan(34);
    expect(f.distance).toBeLessThan(limit);
    for (const azimuth of [0, Math.PI / 4]) {
      const pts = corners(boardArea(), azimuth, 0.62, aspect, insets, limit);
      for (const p of pts) {
        expect(Math.abs(p.x)).toBeLessThanOrEqual(1.0001);
        expect(p.y).toBeLessThanOrEqual(1 - 2 * insets.top + 1e-3);
        expect(p.y).toBeGreaterThanOrEqual(-1 + 2 * insets.bottom - 1e-3);
      }
      // The width is what binds in portrait: the board spans the screen side to side
      expect(Math.max(...pts.map((p) => Math.abs(p.x)))).toBeGreaterThan(0.95);
    }
    // A tall window looks more nearly straight down, a wide one keeps its tilt
    expect(shotPolar(0.62, aspect)).toBeCloseTo(0.4);
    expect(shotPolar(0.62, 16 / 9)).toBeCloseTo(0.62);
    expect(shotPolar(0.62, 1)).toBeGreaterThan(shotPolar(0.62, 0.8));
    // A desktop window keeps the old limit
    expect(zoomOutLimit(40, 16 / 9, { left: 0.2, right: 0.25, top: 0.08, bottom: 0.1 }, 0.62, 34)).toBe(34);
  });

  it('gives panels covering most of the screen a third of it back, in proportion', () => {
    const insets = { left: 0, right: 0, top: 0.3, bottom: 0.6 };
    const pts = corners(boardArea(), 0, 0.62, 16 / 9, insets);
    // top and bottom scaled to 2/9 and 4/9: the board sits in NDC y -1/9..5/9
    const ys = pts.map((p) => p.y);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(-1 + 8 / 9 - 1e-3);
    expect(Math.max(...ys)).toBeLessThanOrEqual(1 - 4 / 9 + 1e-3);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(2 / 3 - 0.01);
  });

  it('on a portrait phone, a move along the far row frames the whole board instead of pushing it under the sheet', () => {
    // 390x844: players strip and turn bar on top, the action bar below; a walk along the top row (21 to 29)
    const aspect = 390 / 844;
    const insets = { left: 0, right: 0, top: 137 / 844, bottom: 117 / 844 };
    const polar = shotPolar(0.78, aspect);
    const limit = zoomOutLimit(40, aspect, insets, shotPolar(0.62, aspect), 34);
    const path = pathArea([21, 22, 23, 24, 25, 26, 27, 28, 29]);
    const board = corners(path, 0, polar, aspect, insets, limit, boardArea());
    const walk = corners(path, 0, polar, aspect, insets, limit);
    const free = { lo: -1 + 2 * insets.bottom, hi: 1 - 2 * insets.top };
    // The walk is in frame...
    for (const p of walk) {
      expect(p.y).toBeLessThanOrEqual(free.hi + 1e-3);
      expect(p.y).toBeGreaterThanOrEqual(free.lo - 1e-3);
    }
    // ...and so is the whole board, centred in the free band: no empty band above it, nothing under the sheet
    const ys = board.map((p) => p.y);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(free.lo - 1e-3);
    expect(Math.max(...ys)).toBeLessThanOrEqual(free.hi + 1e-3);
    expect(Math.abs(free.hi - Math.max(...ys) - (Math.min(...ys) - free.lo))).toBeLessThan(0.06);
    // Without the board to slide to, the walk itself was centred and the board's near edge went under the sheet
    const plain = frameArea(path, 0, polar, { fov: 40, aspect, minDistance: 5, maxDistance: limit }, insets, null);
    expect(Math.min(...project(boardArea(), plain, 0, polar, aspect).map((p) => p.y))).toBeLessThan(free.lo - 0.1);
  });

  it('zoomed in on a tile, keeps it in frame, and centred where the board fills the view around it', () => {
    const aspect = 16 / 9;
    const insets = { left: 0.22, right: 0.27, top: 0.1, bottom: 0.22 };
    const lens = { fov: 40, aspect, minDistance: 3, maxDistance: 60 };
    const free = { left: -1 + 2 * insets.left, right: 1 - 2 * insets.right, bottom: -1 + 2 * insets.bottom, top: 1 - 2 * insets.top };
    for (const i of [10, 5, 25, 39]) {
      for (const p of corners(tileArea(i), 0, 0.84, aspect, insets)) {
        expect(p.x).toBeGreaterThanOrEqual(free.left - 1e-3);
        expect(p.x).toBeLessThanOrEqual(free.right + 1e-3);
        expect(p.y).toBeGreaterThanOrEqual(free.bottom - 1e-3);
        expect(p.y).toBeLessThanOrEqual(free.top + 1e-3);
      }
    }
    // Colombo Fort Station, mid-way along the near side: the board runs past both sides of the view, nothing to slide
    const slid = frameArea(tileArea(5), 0, 0.84, lens, insets);
    const plain = frameArea(tileArea(5), 0, 0.84, lens, insets, null);
    expect(slid.offset[0]).toBeCloseTo(plain.offset[0], 6);
    expect(slid.distance).toBe(plain.distance);
  });

  it('frames paths and tiles with a minimum size', () => {
    const a = pathArea([5]);
    expect(a.maxX - a.minX).toBeGreaterThanOrEqual(5.5);
    const [x, z] = tileCenter(5);
    expect((a.minX + a.maxX) / 2).toBeCloseTo(x);
    expect((a.minZ + a.maxZ) / 2).toBeCloseTo(z);
    const long = pathArea([38, 39, 0, 1, 2, 3]);
    expect(tileAt(long.maxX - 1.01, long.maxZ - 1.01)).toBe(0);
    const t = tileArea(24);
    expect(tileAt((t.minX + t.maxX) / 2, (t.minZ + t.maxZ) / 2)).toBe(24);
  });

  it("faces the lane a move ends on, from outside it", () => {
    // The camera at that azimuth sits on the lane's side of the board
    for (const end of [3, 15, 27, 34]) {
      const az = laneAzimuth([end - 2, end - 1, end]);
      const [x, z] = tileCenter(end);
      expect(Math.sin(az) * x + Math.cos(az) * z).toBeGreaterThan(5);
    }
    expect(laneAzimuth([7, 8, 9, 10, 11, 12])).toBeCloseTo(laneAzimuth([12]));
    // A corner reached by stepping belongs to the side walked along, across Start too
    expect(laneAzimuth([8, 9, 10])).toBeCloseTo(laneAzimuth([5]));
    expect(laneAzimuth([38, 39, 0])).toBeCloseTo(laneAzimuth([35]));
    expect(laneAzimuth([12, 11, 10])).toBeCloseTo(laneAzimuth([15]));
    // Jumped onto (Go to Jail): the corner's own side
    expect(laneAzimuth([30, 10])).toBeCloseTo(laneAzimuth([10]));
  });

  it('turns the short way round, however far the camera had turned', () => {
    expect(nearestAzimuth(0.1, -Math.PI / 2)).toBeCloseTo(-Math.PI / 2);
    expect(nearestAzimuth(4 * Math.PI + 0.2, 0)).toBeCloseTo(4 * Math.PI);
    expect(nearestAzimuth(3, -Math.PI / 2 * 3)).toBeCloseTo(Math.PI / 2);
  });
});
