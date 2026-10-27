import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { CanvasTexture, Color, InstancedMesh, Matrix4, MeshBasicMaterial, PlaneGeometry, Quaternion, SRGBColorSpace, Vector3 } from 'three';
import { uiStore, type UiState } from '../../state/ui';
import { settings } from '../../ui/settings';
import { director, type LogEntry } from '../../view';
import { makeCanvas, roundRect } from '../textures/canvas';
import { BOARD_TOP, TILES, tileCenter, tileRotation, tileSize } from './layout';
import { saveTarget } from './saveTarget';
import { uncleTarget } from './uncleTarget';

/*
 * Frames laid over tiles: the picker's legal targets in amber (pulsing while a picker is open), its cursor / ghost
 * and a space previewed from a list (a property in a trade) in blue, pulsing, the space Tuk-Tuk Uncle is sending a token to in red (pulsing while it walks there), the inspected tile
 * and the hovered one in slate. Hero League's location a back-up hero is being picked for is marked like Tuk-Tuk
 * Uncle's target. One InstancedMesh of 40 quads with a border texture (solid edge, faint fill)
 * tinted per instance; tiles with nothing to show are scaled away.
 */

const quad = new PlaneGeometry(0.97, 0.97).rotateX(-Math.PI / 2);
const AMBER = new Color('#ffa41b');
const CURSOR = new Color('#1c7ed6');
const SLATE = new Color('#33415c');
const UNCLE_RED = new Color('#f03e3e');
/** Tuk-Tuk Uncle's target stays marked this long after the token lands (a one-tile advance is over in a blink) */
const UNCLE_LINGER_MS = 1500;

function colourOf(u: UiState, uncle: number | null, i: number, out: Color): Color | null {
  if ((u.picker && u.picker.ghost === i) || u.preview === i) return out.copy(CURSOR);
  if (u.picker?.legal.includes(i)) return out.copy(AMBER);
  if (uncle === i) return out.copy(UNCLE_RED);
  if (u.selected === i || u.hover === i) return out.copy(SLATE);
  return null;
}

const pulsing = (u: UiState, uncle: number | null): boolean => !!u.picker || u.preview !== null || uncle !== null;

/** The space marked red: Tuk-Tuk Uncle's target, or a location waiting for its back-up hero */
const markOf = (log: readonly LogEntry[]): number | null => uncleTarget(log) ?? saveTarget(log);

/** The frame drawn over a tile: a bold one for pickers and previews, a thin one for the hovered / inspected tile */
function frameTexture(thin = false): CanvasTexture {
  const c = makeCanvas(128, 128);
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.fillStyle = thin ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.22)';
    roundRect(ctx, 4, 4, 120, 120, 12);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = thin ? 3 : 9;
    roundRect(ctx, 6, 6, 116, 116, 11);
    ctx.stroke();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export function TileHighlights() {
  const ref = useRef<InstancedMesh>(null);
  const thinRef = useRef<InstancedMesh>(null);
  const mat = useRef(new MeshBasicMaterial({ map: frameTexture(), transparent: true, depthWrite: false, toneMapped: false }));
  const thinMat = useRef(new MeshBasicMaterial({ map: frameTexture(true), transparent: true, depthWrite: false, toneMapped: false }));
  const places = useRef<Matrix4[]>([]);
  const uncle = useRef<number | null>(null);
  const invalidate = useThree((s) => s.invalidate);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const up = new Vector3(0, 1, 0);
    places.current = Array.from({ length: TILES }, (_, i) => {
      const [x, z] = tileCenter(i);
      const [w, d] = tileSize(i);
      return new Matrix4().compose(new Vector3(x, BOARD_TOP + 0.006, z), new Quaternion().setFromAxisAngle(up, tileRotation(i)), new Vector3(w, 1, d));
    });
    const hidden = new Matrix4().makeScale(0, 0, 0);
    for (const m of [mesh, thinRef.current]) {
      if (!m) continue;
      for (let i = 0; i < TILES; i++) {
        m.setMatrixAt(i, hidden);
        m.setColorAt(i, SLATE);
      }
      m.instanceMatrix.needsUpdate = true;
    }
  }, []);

  useEffect(() => {
    const c = new Color();
    const hidden = new Matrix4().makeScale(0, 0, 0);
    const paint = () => {
      const mesh = ref.current;
      const thin = thinRef.current;
      if (!mesh || !thin) return;
      const u = uiStore.get();
      for (let i = 0; i < TILES; i++) {
        const col = colourOf(u, uncle.current, i, c);
        // Only hovered / inspected tiles get the thin frame; every other mark keeps the bold one
        const light = !!col && col.equals(SLATE);
        mesh.setMatrixAt(i, col && !light ? (places.current[i] ?? hidden) : hidden);
        thin.setMatrixAt(i, light ? (places.current[i] ?? hidden) : hidden);
        if (col) (light ? thin : mesh).setColorAt(i, col);
      }
      for (const m of [mesh, thin]) {
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
      invalidate();
    };
    paint();
    // The pulse needs frames while a picker is open, a space is previewed or Tuk-Tuk Uncle's target is marked; 30 a
    // second is plenty.
    let timer: ReturnType<typeof setInterval> | null = null;
    const pulse = () => {
      const want = pulsing(uiStore.get(), uncle.current) && !settings.get().reduceMotion;
      if (want && !timer) timer = setInterval(() => invalidate(), 33);
      if (!want && timer) {
        clearInterval(timer);
        timer = null;
        mat.current.opacity = 1;
        invalidate();
      }
    };
    pulse();
    const off = uiStore.subscribe(() => {
      paint();
      pulse();
    });
    let linger: ReturnType<typeof setTimeout> | null = null;
    const setUncle = (next: number | null) => {
      uncle.current = next;
      paint();
      pulse();
    };
    const readUncle = () => {
      const next = markOf(director.view.get().log);
      if (next === null && uncle.current !== null) {
        // The token has landed: let the mark linger (a snap or a new turn while it does changes nothing)
        linger ??= setTimeout(() => {
          linger = null;
          setUncle(markOf(director.view.get().log));
        }, UNCLE_LINGER_MS);
        return;
      }
      if (next === uncle.current) return;
      if (linger) clearTimeout(linger);
      linger = null;
      setUncle(next);
    };
    readUncle();
    const offView = director.view.subscribe(readUncle);
    return () => {
      off();
      offView();
      if (timer) clearInterval(timer);
      if (linger) clearTimeout(linger);
    };
  }, [invalidate]);

  useFrame(({ clock }) => {
    if (pulsing(uiStore.get(), uncle.current) && !settings.get().reduceMotion) mat.current.opacity = 0.75 + 0.25 * Math.sin(clock.elapsedTime * 5);
  });

  return (
    <>
      <instancedMesh ref={ref} args={[quad, mat.current, TILES]} frustumCulled={false} renderOrder={2} />
      <instancedMesh ref={thinRef} args={[quad, thinMat.current, TILES]} frustumCulled={false} renderOrder={2} />
    </>
  );
}
