import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
  BoxGeometry,
  Color,
  ConeGeometry,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { GameState, SeatId } from '../../rules';
import { ANIM } from '../../shared/timing';
import { useSelector } from '../../state/store';
import { uiStore } from '../../state/ui';
import { director, useView, type BoardEvent } from '../../view';
import { DIM } from '../dimmable';
import { useSeatLooks } from '../seats';
import { fitText, makeCanvas, toTexture } from '../textures/canvas';
import { BOARD_TOP, buildingPos, chipPos, FRAME, tileCenter, tileRotation, TILE_D, TILE_W } from './layout';
import { pieceChanges, piecesOf, type Pieces as PieceList } from './pieceList';

/*
 * Houses, hotels, owner bars and mortgage stamps, each kind one InstancedMesh rebuilt from the displayed state
 * (only when it changes or something animates). The 'board' scene API plays the change an event just made: a house
 * drops in or shrinks away, an owner bar pops up, a stamp lands.
 */

const merged = (parts: BufferGeometry[]): BufferGeometry => {
  const g = mergeGeometries(parts);
  if (!g) throw new Error('piece geometry merge failed');
  return g;
};

export const houseGeo = merged([
  new BoxGeometry(0.15, 0.1, 0.15).translate(0, 0.05, 0),
  new ConeGeometry(0.118, 0.08, 4).rotateY(Math.PI / 4).translate(0, 0.14, 0),
]);
export const hotelGeo = merged([
  new BoxGeometry(0.4, 0.13, 0.2).translate(0, 0.065, 0),
  new ConeGeometry(0.29, 0.08, 4).rotateY(Math.PI / 4).scale(1, 1, 0.55).translate(0, 0.17, 0),
]);
/** The owner bar: a thick strip in the owner's colour along the frame outside the tile, as wide as the tile */
const chipGeo = new BoxGeometry(TILE_W * 0.86, 0.045, FRAME * 0.72).translate(0, 0.0225, 0);
const stampGeo = new PlaneGeometry(TILE_W * 0.92, TILE_D * 0.94).rotateX(-Math.PI / 2);

export const houseMat = new MeshStandardMaterial({ color: '#2f9e44', roughness: 0.45 });
export const hotelMat = new MeshStandardMaterial({ color: '#e03131', roughness: 0.45 });
const chipMat = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.35, metalness: 0.1 });

let stampMat: MeshBasicMaterial | null = null;
function stampMaterial(): MeshBasicMaterial {
  if (stampMat) return stampMat;
  const c = makeCanvas(256, 410);
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.fillStyle = 'rgba(15, 18, 24, 0.5)';
    ctx.fillRect(0, 0, 256, 410);
    ctx.strokeStyle = '#e03131';
    ctx.lineWidth = 10;
    ctx.strokeRect(12, 12, 232, 386);
    ctx.save();
    ctx.translate(128, 205);
    ctx.rotate(-Math.atan2(410, 256));
    fitText(ctx, 'MORTGAGED', 0, 0, 62, 360, { weight: 900, color: '#ff6b6b' });
    ctx.restore();
  }
  stampMat = new MeshBasicMaterial({ map: toTexture(c, 4), transparent: true, depthWrite: false });
  return stampMat;
}

interface Anim {
  enter: boolean;
  start: number;
  dur: number;
  /** A chip leaving keeps its owner's colour */
  color?: string;
}

const easeOutBack = (t: number) => {
  const c = 1.70158;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
};
const bounce = (t: number) => {
  if (t < 0.6) return (t / 0.6) ** 2;
  const u = (t - 0.8) / 0.2;
  return 1 - 0.12 * (1 - u * u);
};

/** Scale and drop for a piece from its animation (none: fully there) */
function animState(a: Anim | undefined, now: number, drop: boolean): { scale: number; lift: number; done: boolean } {
  if (!a) return { scale: 1, lift: 0, done: true };
  const t = Math.min(1, (now - a.start) / a.dur);
  if (!a.enter) return { scale: 1 - t, lift: 0, done: t >= 1 };
  if (drop) return { scale: Math.min(1, 0.35 + t * 1.3), lift: (1 - bounce(t)) * 0.9, done: t >= 1 };
  return { scale: Math.max(0, easeOutBack(t)), lift: 0, done: t >= 1 };
}

const parse = (key: string) => {
  const [kind, space, slot] = key.split(':');
  return { kind, space: Number(space), slot: Number(slot ?? 0) };
};

export function Pieces() {
  const looks = useSeatLooks();
  const caps = useView((v) => `${Math.max(32, v.game?.cfg.houses ?? 32) + 8}:${Math.max(12, v.game?.cfg.hotels ?? 12) + 4}`);
  const [houseCap, hotelCap] = caps.split(':').map(Number) as [number, number];
  const invalidate = useThree((s) => s.invalidate);
  const houses = useRef<InstancedMesh>(null);
  const hotels = useRef<InstancedMesh>(null);
  const chips = useRef<InstancedMesh>(null);
  const stamps = useRef<InstancedMesh>(null);
  const anims = useRef(new Map<string, Anim>());
  const state = useRef<{ game: GameState | null; list: PieceList; dirty: boolean }>({ game: null, list: piecesOf(null), dirty: true });
  const looksRef = useRef(looks);
  looksRef.current = looks;
  // While a player is spotlighted, the pieces on everyone else's property go dark with their tiles
  const spotlight = useSelector(uiStore, (u) => u.spotlight);
  const spotRef = useRef(spotlight);
  spotRef.current = spotlight;
  state.current.dirty = true;

  useEffect(
    () =>
      director.register('board', {
        animate(ev: BoardEvent, signal: AbortSignal, speed: number) {
          const base = ev.t === 'level' ? ANIM.level : ev.t === 'owner' ? ANIM.owner : ANIM.mortgage;
          const dur = base / Math.max(0.1, speed);
          const start = performance.now();
          const { enter, leave } = pieceChanges(ev);
          const prev = ev.t === 'owner' && ev.from ? looksRef.current[ev.from as SeatId]?.color : undefined;
          for (const k of enter) anims.current.set(k, { enter: true, start, dur });
          for (const k of leave) anims.current.set(k, { enter: false, start, dur, color: prev });
          state.current.dirty = true;
          invalidate();
          return new Promise<void>((resolve) => {
            if (signal.aborted) return resolve();
            const done = () => {
              clearTimeout(timer);
              resolve();
            };
            const timer = setTimeout(done, dur);
            signal.addEventListener(
              'abort',
              () => {
                for (const k of [...enter, ...leave]) anims.current.delete(k);
                state.current.dirty = true;
                done();
              },
              { once: true },
            );
          });
        },
      }),
    [invalidate],
  );

  const tmp = useMemo(() => ({ m: new Matrix4(), q: new Quaternion(), p: new Vector3(), s: new Vector3(), c: new Color(), up: new Vector3(0, 1, 0) }), []);

  useFrame(() => {
    const st = state.current;
    const game = director.view.get().game;
    if (game !== st.game) {
      st.game = game;
      st.list = piecesOf(game);
      st.dirty = true;
    }
    if (!st.dirty && anims.current.size === 0) return;
    st.dirty = false;
    const now = performance.now();
    const looksNow = looksRef.current;
    const spot = spotRef.current;
    const dark = (space: number) => spot !== null && st.game?.props[`p${space}`]?.owner !== spot;
    const shade = (mesh: InstancedMesh, n: number, space: number) => mesh.setColorAt(n, tmp.c.setScalar(dark(space) ? DIM : 1));
    const put = (mesh: InstancedMesh, n: number, x: number, y: number, z: number, yaw: number, scale: number) => {
      tmp.q.setFromAxisAngle(tmp.up, yaw);
      tmp.p.set(x, y, z);
      tmp.s.setScalar(Math.max(0.0001, scale));
      mesh.setMatrixAt(n, tmp.m.compose(tmp.p, tmp.q, tmp.s));
    };
    const present = new Set<string>();
    let anyActive = false;
    const step = (key: string, drop: boolean) => {
      const a = anims.current.get(key);
      const s = animState(a, now, drop);
      if (a && s.done) anims.current.delete(key);
      else if (a) anyActive = true;
      return s;
    };

    const h = houses.current;
    if (h) {
      let n = 0;
      const one = (space: number, slot: number, key: string) => {
        if (n >= houseCap) return;
        const s = step(key, true);
        const [x, z] = buildingPos(space, slot);
        put(h, n, x, BOARD_TOP + s.lift, z, tileRotation(space), s.scale);
        shade(h, n++, space);
      };
      for (const p of st.list.houses) {
        present.add(p.key);
        one(p.space, p.slot, p.key);
      }
      for (const [key, a] of anims.current) {
        const k = parse(key);
        if (k.kind === 'h' && !a.enter && !present.has(key)) one(k.space, k.slot, key);
      }
      h.count = n;
      h.instanceMatrix.needsUpdate = true;
      if (h.instanceColor) h.instanceColor.needsUpdate = true;
    }
    const H = hotels.current;
    if (H) {
      let n = 0;
      const one = (space: number, key: string) => {
        if (n >= hotelCap) return;
        const s = step(key, true);
        const [x, z] = buildingPos(space, 4);
        put(H, n, x, BOARD_TOP + s.lift, z, tileRotation(space), s.scale);
        shade(H, n++, space);
      };
      for (const p of st.list.hotels) {
        present.add(p.key);
        one(p.space, p.key);
      }
      for (const [key, a] of anims.current) {
        const k = parse(key);
        if (k.kind === 'H' && !a.enter && !present.has(key)) one(k.space, key);
      }
      H.count = n;
      H.instanceMatrix.needsUpdate = true;
      if (H.instanceColor) H.instanceColor.needsUpdate = true;
    }
    const c = chips.current;
    if (c) {
      let n = 0;
      const one = (space: number, color: string, dim: boolean, key: string) => {
        if (n >= 40) return;
        const s = step(key, false);
        const [x, z] = chipPos(space);
        put(c, n, x, BOARD_TOP, z, tileRotation(space), s.scale);
        tmp.c.set(color);
        if (dim) tmp.c.lerp(new Color('#555555'), 0.65);
        if (dark(space)) tmp.c.multiplyScalar(DIM);
        c.setColorAt(n++, tmp.c);
      };
      for (const p of st.list.chips) {
        present.add(p.key);
        one(p.space, looksNow[p.seat]?.color ?? '#888888', p.mortgaged, p.key);
      }
      for (const [key, a] of anims.current) {
        const k = parse(key);
        if (k.kind === 'c' && !a.enter && !present.has(key)) one(k.space, a.color ?? '#888888', false, key);
      }
      c.count = n;
      c.instanceMatrix.needsUpdate = true;
      if (c.instanceColor) c.instanceColor.needsUpdate = true;
    }
    const m = stamps.current;
    if (m) {
      let n = 0;
      const one = (space: number, key: string) => {
        if (n >= 40) return;
        const a = anims.current.get(key);
        const s = step(key, false);
        const [x, z] = tileCenter(space);
        // A stamp lands from slightly bigger; a lifted one shrinks away
        const scale = a?.enter ? 1.25 - 0.25 * Math.min(1, (now - a.start) / a.dur) : s.scale;
        put(m, n, x, BOARD_TOP + 0.004, z, tileRotation(space), scale);
        shade(m, n++, space);
      };
      for (const p of st.list.stamps) {
        present.add(p.key);
        one(p.space, p.key);
      }
      for (const [key, a] of anims.current) {
        const k = parse(key);
        if (k.kind === 'm' && !a.enter && !present.has(key)) one(k.space, key);
      }
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    if (anyActive) invalidate();
  });

  return (
    <group>
      <instancedMesh key={`h${houseCap}`} ref={houses} args={[houseGeo, houseMat, houseCap]} frustumCulled={false} castShadow receiveShadow />
      <instancedMesh key={`H${hotelCap}`} ref={hotels} args={[hotelGeo, hotelMat, hotelCap]} frustumCulled={false} castShadow receiveShadow />
      <instancedMesh ref={chips} args={[chipGeo, chipMat, 40]} frustumCulled={false} castShadow />
      <instancedMesh ref={stamps} args={[stampGeo, stampMaterial(), 40]} frustumCulled={false} renderOrder={1} />
    </group>
  );
}
