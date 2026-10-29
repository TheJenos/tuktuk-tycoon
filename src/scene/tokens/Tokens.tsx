import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
  CanvasTexture,
  CircleGeometry,
  Group,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Vector3,
} from 'three';
import type { GameState, SeatId } from '../../rules';
import { uiStore } from '../../state/ui';
import { useSelector } from '../../state/store';
import { settings } from '../../ui/settings';
import { director, useView } from '../../view';
import { BOARD_TOP, JAIL, slotPos, travelYaw, type XZ } from '../board/layout';
import type { Tier } from '../quality';
import { useSeatLooks, type SeatLook } from '../seats';
import { makeCanvas } from '../textures/canvas';
import { liftScale, movePoints, moveMs, poseAt, type MoveMode, type Pose } from './hop';
import { ringGeometry, tokenGeometry } from './shapes';
import { dimTrimMaterial, tokenMaterial, trimMaterial } from './materials';

/*
 * The players' tokens. Where each one rests comes from the displayed state (director.view); a move runs as a
 * mutable track read in useFrame, never through React state. The 'tokens' scene API starts those tracks.
 */

/** Where each token is drawn right now (floating labels rise from here) */
export const tokenPositions = new Map<SeatId, Vector3>();

const ghostMat = new MeshStandardMaterial({ color: '#ffffff', metalness: 0.2, roughness: 0.5, transparent: true, opacity: 0.42, depthWrite: false });

let blob: MeshBasicMaterial | null = null;
/** A soft round shadow for low quality, where there is no shadow map */
function blobMat(): MeshBasicMaterial {
  if (blob) return blob;
  const c = makeCanvas(64, 64);
  const ctx = c.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
    g.addColorStop(0, 'rgba(0,0,0,0.55)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  }
  blob = new MeshBasicMaterial({ map: new CanvasTexture(c), transparent: true, depthWrite: false });
  return blob;
}
const blobGeo = new CircleGeometry(0.3, 20).rotateX(-Math.PI / 2).translate(0, 0.004, 0);

interface Rest {
  x: number;
  z: number;
  yaw: number;
}

interface Track {
  points: XZ[];
  mode: MoveMode;
  start: number;
  dur: number;
  done: () => void;
}

/** Active seats (not out), in turn order: which tokens exist */
const seatsKey = (g: GameState | null): string =>
  g ? g.order.filter((s) => g.players[s] && !g.players[s]?.out).join(',') : '';

const inCell = (g: GameState, seat: SeatId, jumped: ReadonlySet<SeatId>): boolean => {
  const p = g.players[seat];
  return !!p && p.pos === JAIL && (!!p.jail || jumped.has(seat));
};

/** Resting slots: tokens sharing a tile (and the jail cell vs Just Visiting) spread over its slots in turn order */
function restingSlots(g: GameState, jumped: ReadonlySet<SeatId>, extra?: { seat: SeatId; pos: number; cell: boolean }): Map<SeatId, Rest> {
  const groups = new Map<string, { pos: number; cell: boolean; seats: SeatId[] }>();
  for (const seat of g.order) {
    const p = g.players[seat];
    if (!p || p.out) continue;
    const moving = extra?.seat === seat;
    const pos = moving ? extra.pos : p.pos;
    const cell = moving ? extra.cell : inCell(g, seat, jumped);
    const key = `${pos}:${cell}`;
    const grp = groups.get(key) ?? { pos, cell, seats: [] };
    grp.seats.push(seat);
    groups.set(key, grp);
  }
  const out = new Map<SeatId, Rest>();
  for (const { pos, cell, seats } of groups.values()) {
    seats.forEach((seat, k) => {
      const [x, z] = slotPos(pos, seats.length, k, cell);
      out.set(seat, { x, z, yaw: travelYaw(pos) });
    });
  }
  return out;
}

/** Puts a token straight onto its resting slot the first time it is drawn (no flight in from the centre) */
function place(g: Group, r: Rest | undefined): void {
  if (!r || g.userData.placed) return;
  g.userData.placed = true;
  g.position.set(r.x, BOARD_TOP, r.z);
  g.rotation.y = r.yaw;
}

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export function Tokens({ tier }: { tier: Tier }) {
  const looks = useSeatLooks();
  const key = useView((v) => seatsKey(v.game));
  const seats = useMemo(() => (key ? (key.split(',') as SeatId[]) : []), [key]);
  const ghost = useSelector(uiStore, (u) => u.picker?.ghost ?? null);
  const spotlight = useSelector(uiStore, (u) => u.spotlight);
  const turnSeat = useView((v) => v.game?.turn.seat ?? null);
  const invalidate = useThree((s) => s.invalidate);
  const groups = useRef(new Map<SeatId, Group>());
  const rest = useRef(new Map<SeatId, Rest>());
  const tracks = useRef(new Map<SeatId, Track>());
  /** Seats that just jumped into jail: drawn in the cell before the jail event lands in the view */
  const jumped = useRef(new Set<SeatId>());
  // One stable ref callback per seat, so a re-render doesn't detach and re-attach every token
  const refs = useMemo(() => new Map<SeatId, (g: Group | null) => void>(), []);
  const refFor = (seat: SeatId) => {
    let fn = refs.get(seat);
    if (!fn) {
      fn = (g: Group | null) => {
        if (g) {
          groups.current.set(seat, g);
          place(g, rest.current.get(seat));
        } else {
          groups.current.delete(seat);
          tokenPositions.delete(seat);
        }
      };
      refs.set(seat, fn);
    }
    return fn;
  };

  useEffect(() => {
    const update = () => {
      const g = director.view.get().game;
      if (!g) return;
      for (const seat of jumped.current) {
        const p = g.players[seat];
        if (!p || p.jail || p.pos !== JAIL) jumped.current.delete(seat);
      }
      rest.current = restingSlots(g, jumped.current);
      for (const [seat, grp] of groups.current) place(grp, rest.current.get(seat));
      invalidate();
    };
    update();
    return director.view.subscribe(update);
  }, [invalidate]);

  useEffect(
    () =>
      director.register('tokens', {
        move(seat, path, mode, signal, speed) {
          return new Promise<void>((resolve) => {
            const g = groups.current.get(seat);
            const game = director.view.get().game;
            const dest = path[path.length - 1];
            if (!g || !game || dest === undefined || signal.aborted) return resolve();
            tracks.current.get(seat)?.done();
            // Only the jump to jail lands in the cell (a Titan Smash leap onto the jail corner is a visit)
            const cell = mode === 'jump' && dest === JAIL;
            const end = restingSlots(game, jumped.current, { seat, pos: dest, cell }).get(seat);
            const points = movePoints([g.position.x, g.position.z], path, end ? [end.x, end.z] : slotPos(dest, 1, 0, cell), mode);
            const finish = () => {
              if (tracks.current.get(seat) !== track) return;
              tracks.current.delete(seat);
              const last = points[points.length - 1] as XZ;
              g.position.set(last[0], BOARD_TOP, last[1]);
              g.scale.setScalar(1);
              if (cell) jumped.current.add(seat);
              invalidate();
              resolve();
            };
            const track: Track = { points, mode, start: performance.now(), dur: moveMs(path.length, mode) / Math.max(0.1, speed), done: finish };
            tracks.current.set(seat, track);
            signal.addEventListener('abort', finish, { once: true });
            invalidate();
          });
        },
      }),
    [invalidate],
  );

  const pose = useRef<Pose>({ x: 0, y: 0, z: 0, yaw: 0, scale: 1, squash: 1 });
  useFrame((_, dt) => {
    const now = performance.now();
    const { reduceMotion: reduced, animSpeed, boardView } = settings.get();
    const top = boardView === '2d';
    // Tokens glide to a new resting slot (others arrived, a snap); instantly with instant animations
    const k = animSpeed === 'instant' ? 1 : 1 - Math.exp(-Math.min(dt, 0.1) * 12);
    let busy = false;
    for (const [seat, g] of groups.current) {
      const tr = tracks.current.get(seat);
      if (tr) {
        const t = (now - tr.start) / tr.dur;
        const p = poseAt(tr.points, tr.mode, t, reduced, g.rotation.y, pose.current);
        g.position.set(p.x, BOARD_TOP + p.y, p.z);
        g.rotation.y = p.yaw;
        // Seen from straight above a hop has no height: the token grows towards the viewer instead
        const lift = top ? liftScale(p.y) : 1;
        g.scale.set(p.scale * lift, p.scale * p.squash * lift, p.scale * lift);
        if (t >= 1) tr.done();
        busy = true;
      } else {
        const r = rest.current.get(seat);
        if (r) {
          const dx = r.x - g.position.x;
          const dz = r.z - g.position.z;
          const dy = BOARD_TOP - g.position.y;
          const dyaw = wrapAngle(r.yaw - g.rotation.y);
          if (Math.abs(dx) + Math.abs(dz) + Math.abs(dy) + Math.abs(dyaw) > 0.002) {
            g.position.x += dx * k;
            g.position.z += dz * k;
            g.position.y += dy * k;
            g.rotation.y += dyaw * k;
            busy = true;
          } else {
            g.position.set(r.x, BOARD_TOP, r.z);
            g.rotation.y = r.yaw;
          }
        }
      }
      let pos = tokenPositions.get(seat);
      if (!pos) tokenPositions.set(seat, (pos = new Vector3()));
      pos.copy(g.position);
    }
    if (busy) invalidate();
  });

  const ghostLook: SeatLook | undefined = turnSeat ? looks[turnSeat] : undefined;
  const ghostAt = ghost === null ? null : slotPos(ghost, 1, 0);
  return (
    <group>
      {seats.map((seat) => {
        const look = looks[seat];
        // Another player is spotlighted: this token goes dark with the tiles they don't own
        const dim = spotlight !== null && spotlight !== seat;
        return (
          <group key={seat} ref={refFor(seat)}>
            <mesh geometry={tokenGeometry(look.token)} material={tokenMaterial(look.color, dim)} castShadow />
            <mesh geometry={ringGeometry()} material={dim ? dimTrimMaterial : trimMaterial} />
            {tier.shadowMap === 0 && <mesh geometry={blobGeo} material={blobMat()} />}
          </group>
        );
      })}
      {ghostAt && ghostLook && (
        <mesh geometry={tokenGeometry(ghostLook.token)} material={ghostMat} position={[ghostAt[0], BOARD_TOP, ghostAt[1]]} rotation-y={travelYaw(ghost ?? 0)} />
      )}
    </group>
  );
}
