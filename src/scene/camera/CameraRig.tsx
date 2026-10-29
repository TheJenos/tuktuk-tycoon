import { CameraControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useCallback, useEffect, useRef } from 'react';
import type { PerspectiveCamera } from 'three';
import { useSelector } from '../../state/store';
import { uiStore } from '../../state/ui';
import { settings, type BoardView } from '../../ui/settings';
import { director } from '../../view';
import { boardArea, frameArea, laneAzimuth, nearestAzimuth, pathArea, shotPolar, tileArea, zoomOutLimit, type Area } from './framing';
import { setOverview } from './recenter';
import { distanceScale, TOP_DOWN, VIEW_CLIP, VIEW_FOV } from './view';

export { recenter } from './recenter';

/*
 * The game camera: drei's CameraControls (orbit, zoom, pan; touch: one finger turns, pinch zooms, two fingers pan)
 * with automatic framing on top: the whole board, a move's path, or one tile. A move (and an auction's lot) also turns
 * the board so its lane is the near side; the whole-board shots between keep that turn, and Recenter swings back
 * to the front. Hovering spaces in a list or the picker's cursor don't turn it. Any drag or zoom by the player sets
 * uiStore.cameraManual, which pauses the automatic framing until recenter() (the Recenter button / C key).
 * A space previewed from a list (uiStore.preview) holds the camera on its tile: the director's shots wait meanwhile
 * and the latest is taken up when the preview ends (with a hand-moved camera the tile is only highlighted).
 *
 * The 2D board view (settings.boardView) is the same rig looking straight down through a long lens: every shot is
 * top-down with the board's front at the bottom of the screen (no swinging round to a lane), dragging pans instead
 * of turning, and pinching or the wheel zooms.
 */

/** A preview ending this soon after it began to point elsewhere is the pointer moving down a list: no swing back */
const PREVIEW_SETTLE_MS = 160;

/** Polar angles (from straight down) for each kind of shot on a wide screen; a tall one looks more nearly down */
const POLAR = { overview: 0.62, follow: 0.78, focus: 0.84 } as const;
type Shot = keyof typeof POLAR;
/** maxDistance is a floor: the limit grows until the whole board fits the window (a portrait phone needs about 60) */
const LIMITS = { minPolar: 0.15, maxPolar: 1.1, minDistance: 5, maxDistance: 34 } as const;

const auto = () => settings.get().autoCamera && !uiStore.get().cameraManual;
const flat = () => settings.get().boardView === '2d';

/** The polar range, distances and what a drag does, for a view */
function applyView(c: CameraControls, camera: PerspectiveCamera, view: BoardView): void {
  const top = view === '2d';
  // camera-controls' action codes, from the class itself (drei doesn't export it: see the drei allowlist)
  type Mouse = CameraControls['mouseButtons']['left'];
  type Touch = CameraControls['touches']['one'];
  const { ACTION } = c.constructor as unknown as { ACTION: { ROTATE: Mouse; TRUCK: Mouse; TOUCH_ROTATE: Touch; TOUCH_TRUCK: Touch } };
  camera.fov = VIEW_FOV[view];
  camera.near = VIEW_CLIP[view].near;
  camera.far = VIEW_CLIP[view].far;
  camera.updateProjectionMatrix();
  c.minPolarAngle = top ? TOP_DOWN : LIMITS.minPolar;
  c.maxPolarAngle = top ? TOP_DOWN : LIMITS.maxPolar;
  // 2D never turns: the board stays the right way up
  c.minAzimuthAngle = top ? 0 : -Infinity;
  c.maxAzimuthAngle = top ? 0 : Infinity;
  c.minDistance = LIMITS.minDistance * distanceScale(view);
  c.mouseButtons.left = top ? ACTION.TRUCK : ACTION.ROTATE;
  c.touches.one = top ? ACTION.TOUCH_TRUCK : ACTION.TOUCH_ROTATE;
}

export function CameraRig() {
  const ref = useRef<CameraControls>(null);
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const get = useThree((s) => s.get);
  const last = useRef<{ area: Area; shot: Shot; face?: number }>({ area: boardArea(), shot: 'overview', face: 0 });
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
      const top = flat();
      const far = LIMITS.maxDistance * distanceScale(top ? '2d' : '3d');
      c.maxDistance = zoomOutLimit(camera.fov, aspect, insets, top ? TOP_DOWN : shotPolar(POLAR.overview, aspect), far);
      if (!opts.force && !auto()) return Promise.resolve();
      const polar = top ? TOP_DOWN : shotPolar(POLAR[shot], aspect);
      // Swinging round takes the short way, however far the player had turned the board; 2D always faces the front
      const a = c.azimuthAngle;
      const azimuth = top ? nearestAzimuth(a, 0) : opts.face !== undefined ? nearestAzimuth(a, opts.face) : a;
      const lens = { fov: camera.fov, aspect, minDistance: c.minDistance, maxDistance: c.maxDistance };
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
      return frame(boardArea(), 'overview', { force: true, face: 0 });
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
    if (g0 === null) void frame(boardArea(), 'overview', { smooth: false, force: true, face: 0 });
    else void frame(tileArea(g0), 'focus', { smooth: false, force: true });
    const offApi = director.register('camera', {
      focus: (space) => (space === null ? shot(boardArea(), 'overview') : shot(tileArea(space), 'focus', laneAzimuth([space]))),
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
        void (g === null ? frame(boardArea(), 'overview') : frame(tileArea(g), 'focus'));
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

  // Switching views: the new lens and limits, then the whole board again (a hand-held camera too)
  const view = useSelector(settings, (s) => s.boardView);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    applyView(c, camera, view);
    uiStore.update({ cameraManual: false });
    void frame(boardArea(), 'overview', { smooth: false, force: true, face: 0 });
  }, [view, camera, frame]);

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
      minPolarAngle={view === '2d' ? TOP_DOWN : LIMITS.minPolar}
      maxPolarAngle={view === '2d' ? TOP_DOWN : LIMITS.maxPolar}
      minDistance={LIMITS.minDistance * distanceScale(view)}
      smoothTime={0.35}
      onControlStart={() => uiStore.update({ cameraManual: true })}
    />
  );
}
