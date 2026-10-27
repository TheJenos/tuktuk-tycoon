import { CameraControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useCallback, useEffect, useRef } from 'react';
import type { PerspectiveCamera } from 'three';
import { uiStore } from '../../state/ui';
import { settings } from '../../ui/settings';
import { director } from '../../view';
import { BOARD_AREA, frameArea, laneAzimuth, nearestAzimuth, pathArea, shotPolar, tileArea, zoomOutLimit, type Area } from './framing';
import { setOverview } from './recenter';

export { recenter } from './recenter';

/*
 * The game camera: drei's CameraControls (orbit, zoom, pan; touch: one finger turns, pinch zooms, two fingers pan)
 * with automatic framing on top: the whole board, a move's path, or one tile. A move (and an auction's lot) also turns
 * the board so its lane is the near side; the whole-board shots between keep that turn, and Recenter swings back
 * to the front. Hovering spaces in a list or the picker's cursor don't turn it. Any drag or zoom by the player sets
 * uiStore.cameraManual, which pauses the automatic framing until recenter() (the Recenter button / C key).
 * A space previewed from a list (uiStore.preview) holds the camera on its tile: the director's shots wait meanwhile
 * and the latest is taken up when the preview ends (with a hand-moved camera the tile is only highlighted).
 */

/** A preview ending this soon after it began to point elsewhere is the pointer moving down a list: no swing back */
const PREVIEW_SETTLE_MS = 160;

/** Polar angles (from straight down) for each kind of shot on a wide screen; a tall one looks more nearly down */
const POLAR = { overview: 0.62, follow: 0.78, focus: 0.84 } as const;
type Shot = keyof typeof POLAR;
/** maxDistance is a floor: the limit grows until the whole board fits the window (a portrait phone needs about 60) */
const LIMITS = { minPolar: 0.15, maxPolar: 1.1, minDistance: 5, maxDistance: 34 } as const;

const auto = () => settings.get().autoCamera && !uiStore.get().cameraManual;

export function CameraRig() {
  const ref = useRef<CameraControls>(null);
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const get = useThree((s) => s.get);
  const last = useRef<{ area: Area; shot: Shot; face?: number }>({ area: BOARD_AREA, shot: 'overview', face: 0 });
  /** While a preview holds the camera: the shot to go back to (the director's latest) */
  const held = useRef<{ area: Area; shot: Shot; face?: number } | null>(null);

  /** Frames `area`; `face` also swings the camera round to that azimuth (0: the board's front) */
  const frame = useCallback(
    (area: Area, shot: Shot, opts: { smooth?: boolean; force?: boolean; face?: number } = {}): Promise<void> => {
      const c = ref.current;
      last.current = { area, shot, ...(opts.face !== undefined ? { face: opts.face } : {}) };
      if (!c) return Promise.resolve();
      const { size } = get();
      const ins = uiStore.get().insets;
      const w = Math.max(1, size.width);
      const h = Math.max(1, size.height);
      const aspect = w / h;
      const insets = { left: ins.left / w, right: ins.right / w, top: ins.top / h, bottom: ins.bottom / h };
      // Kept up to date with a hand-held camera too, so zooming out always reaches the whole board; set before
      // dollyTo, which clamps to it
      c.maxDistance = zoomOutLimit(camera.fov, aspect, insets, shotPolar(POLAR.overview, aspect), LIMITS.maxDistance);
      if (!opts.force && !auto()) return Promise.resolve();
      const polar = shotPolar(POLAR[shot], aspect);
      // Swinging round takes the short way, however far the player had turned the board
      const a = c.azimuthAngle;
      const azimuth = opts.face !== undefined ? nearestAzimuth(a, opts.face) : a;
      const lens = { fov: camera.fov, aspect, minDistance: LIMITS.minDistance, maxDistance: c.maxDistance };
      const f = frameArea(area, azimuth, polar, lens, insets);
      const smooth = (opts.smooth ?? true) && !settings.get().reduceMotion;
      return Promise.all([
        c.rotateTo(azimuth, polar, smooth),
        c.moveTo(f.target[0], f.target[1], f.target[2], smooth),
        c.dollyTo(f.distance, smooth),
        c.setFocalOffset(f.offset[0], f.offset[1], 0, smooth),
      ]).then(() => undefined);
    },
    [camera, get],
  );

  useEffect(() => {
    const offOverview = setOverview(() => {
      held.current = null;
      return frame(BOARD_AREA, 'overview', { force: true, face: 0 });
    });
    /** The director's shots: taken now, or kept for when a preview lets go of the camera */
    const shot = (area: Area, kind: Shot, face?: number): Promise<void> => {
      const s = { area, shot: kind, ...(face !== undefined ? { face } : {}) };
      if (!held.current) return frame(area, kind, s);
      held.current = s;
      return Promise.resolve();
    };
    // A picker already open (a game resumed at a triple) gets its cursor framed straight away
    const g0 = uiStore.get().picker?.ghost ?? null;
    if (g0 === null) void frame(BOARD_AREA, 'overview', { smooth: false, force: true, face: 0 });
    else void frame(tileArea(g0), 'focus', { smooth: false, force: true });
    const offApi = director.register('camera', {
      focus: (space) => (space === null ? shot(BOARD_AREA, 'overview') : shot(tileArea(space), 'focus', laneAzimuth([space]))),
      follow: (path) => shot(pathArea(path), 'follow', laneAzimuth(path)),
    });
    // Re-frame when the HUD's panels change size, and follow the picker's cursor (Bus choice, triples)
    let insets = uiStore.get().insets;
    let ghost = uiStore.get().picker?.ghost ?? null;
    let preview: number | null = null;
    let settle: ReturnType<typeof setTimeout> | null = null;
    const release = () => {
      settle = null;
      const back = held.current;
      held.current = null;
      if (back) void frame(back.area, back.shot, back);
    };
    const offUi = uiStore.subscribe(() => {
      const u = uiStore.get();
      if (u.insets !== insets) {
        insets = u.insets;
        const l = last.current;
        void frame(l.area, l.shot, l);
      }
      const g = u.picker?.ghost ?? null;
      if (g !== ghost) {
        ghost = g;
        // The picker's cursor outranks a preview
        held.current = null;
        void (g === null ? frame(BOARD_AREA, 'overview') : frame(tileArea(g), 'focus'));
      }
      const p = u.picker ? null : u.preview;
      if (p !== preview) {
        preview = p;
        if (p !== null) {
          if (settle) clearTimeout(settle);
          settle = null;
          held.current ??= { ...last.current };
          void frame(tileArea(p), 'focus');
        } else if (held.current && !settle) {
          settle = setTimeout(release, PREVIEW_SETTLE_MS);
        }
      }
    });
    return () => {
      if (settle) clearTimeout(settle);
      offApi();
      offUi();
      offOverview();
    };
  }, [frame]);

  // A resize keeps the current shot
  const size = useThree((s) => s.size);
  useEffect(() => {
    const l = last.current;
    void frame(l.area, l.shot, { ...l, smooth: false });
  }, [size, frame]);

  return (
    <CameraControls
      ref={ref}
      makeDefault
      minPolarAngle={LIMITS.minPolar}
      maxPolarAngle={LIMITS.maxPolar}
      minDistance={LIMITS.minDistance}
      smoothTime={0.35}
      onControlStart={() => uiStore.update({ cameraManual: true })}
    />
  );
}
