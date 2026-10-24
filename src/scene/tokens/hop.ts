import { ANIM, hopMs } from '../../shared/timing';
import { slotPos, type XZ } from '../board/layout';

/*
 * Token motion, pure: a move is a list of ground points (where the token starts, one per tile entered, the last
 * being its slot on the final tile) and a mode. 'walk' and 'back' hop tile by tile with a small arc; 'jump' (to
 * jail) is a single high arc. With reduced motion there is no arc: walks slide, a jump fades out and back in.
 */

export type MoveMode = 'walk' | 'back' | 'jump';

export const HOP_HEIGHT = 0.32;
export const JUMP_HEIGHT = 2.2;

export interface Pose {
  x: number;
  y: number;
  z: number;
  /** Heading about +Y for a model facing +X */
  yaw: number;
  /** Uniform scale (fades a reduced-motion jump) */
  scale: number;
  /** Vertical squash on landing */
  squash: number;
}

/** Ground points for a move from `from` along `path`, ending at `end` (the token's slot on the last tile) */
export function movePoints(from: XZ, path: readonly number[], end: XZ, mode: MoveMode): XZ[] {
  if (mode === 'jump' || path.length === 0) return [from, end];
  return [from, ...path.slice(0, -1).map((i) => slotPos(i, 1, 0)), end];
}

/** Duration in ms at normal speed (the same numbers animBudget() uses) */
export const moveMs = (hops: number, mode: MoveMode): number =>
  mode === 'jump' ? ANIM.jump : hopMs(hops) * Math.max(1, hops);

const headingOf = (a: XZ, b: XZ): number | null => {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  return dx * dx + dz * dz < 1e-8 ? null : Math.atan2(-dz, dx);
};

/** Pose at overall progress t in [0, 1]; `yaw` is the heading to keep when the step has none */
export function poseAt(points: readonly XZ[], mode: MoveMode, t: number, reduced: boolean, yaw: number, out: Pose): Pose {
  const u = Math.min(1, Math.max(0, t));
  const first = points[0] as XZ;
  const last = points[points.length - 1] as XZ;
  out.scale = 1;
  out.squash = 1;
  if (mode === 'jump') {
    if (reduced) {
      const [x, z] = u < 0.5 ? first : last;
      out.x = x;
      out.z = z;
      out.y = 0;
      out.scale = Math.abs(1 - 2 * u);
    } else {
      out.x = first[0] + (last[0] - first[0]) * u;
      out.z = first[1] + (last[1] - first[1]) * u;
      out.y = JUMP_HEIGHT * 4 * u * (1 - u);
    }
    out.yaw = yaw;
    return out;
  }
  const hops = points.length - 1;
  const p = u * hops;
  const i = Math.min(hops - 1, Math.floor(p));
  const f = Math.min(1, p - i);
  const a = points[i] as XZ;
  const b = points[i + 1] as XZ;
  out.x = a[0] + (b[0] - a[0]) * f;
  out.z = a[1] + (b[1] - a[1]) * f;
  out.y = reduced ? 0 : HOP_HEIGHT * 4 * f * (1 - f);
  if (!reduced && f > 0.85) out.squash = 1 - 0.14 * Math.sin((Math.PI * (f - 0.85)) / 0.15);
  const h = headingOf(a, b);
  // Walking backwards (Go Back 3 Spaces) the token keeps facing the way play goes.
  out.yaw = h === null ? yaw : mode === 'back' ? h + Math.PI : h;
  return out;
}
