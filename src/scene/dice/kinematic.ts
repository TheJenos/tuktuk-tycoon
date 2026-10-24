import { Quaternion, Vector3 } from 'three';
import { restingQuat } from './remap';

/*
 * The always-available dice throw: a toss along a parabola with two small bounces and a decaying spin that eases
 * into the resting rotation with the wanted face up over the last third. Deterministic from its random source.
 */

export interface Throw {
  /** Pose at progress t in [0, 1]; t = 1 is the resting pose */
  sample(t: number, pos: Vector3, quat: Quaternion): void;
}

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const easeOut = (x: number) => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3;

/** Height above the resting height: the drop, then two shrinking bounces */
function hop(t: number, h0: number): number {
  if (t < 0.5) {
    const f = t / 0.5;
    return h0 * (1 - f * f);
  }
  if (t < 0.75) {
    const f = (t - 0.5) / 0.25;
    return 0.45 * 4 * f * (1 - f);
  }
  if (t < 0.88) {
    const f = (t - 0.75) / 0.13;
    return 0.1 * 4 * f * (1 - f);
  }
  return 0;
}

/** A uniformly random rotation (Shoemake) from the given random source */
export function randomQuat(rand: () => number, out = new Quaternion()): Quaternion {
  const u1 = rand();
  const u2 = rand() * Math.PI * 2;
  const u3 = rand() * Math.PI * 2;
  const a = Math.sqrt(1 - u1);
  const b = Math.sqrt(u1);
  return out.set(a * Math.sin(u2), a * Math.cos(u2), b * Math.sin(u3), b * Math.cos(u3));
}

export function kinematicThrow(rand: () => number, from: Vector3, to: Vector3, face: number): Throw {
  const start = randomQuat(rand);
  const axis = new Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
  if (axis.lengthSq() === 0) axis.set(1, 0, 0);
  const spin = 14 + rand() * 10;
  const rest = restingQuat(face, rand() * Math.PI * 2);
  const h0 = Math.max(0, from.y - to.y);
  const spun = new Quaternion();
  return {
    sample(t, pos, quat) {
      const u = Math.min(1, Math.max(0, t));
      const f = easeOut(u / 0.92);
      pos.set(from.x + (to.x - from.x) * f, to.y + hop(u, h0), from.z + (to.z - from.z) * f);
      // Angle grows with a decaying rate (spin * (u - u^2 / 2)), then blends into the rest pose.
      spun.setFromAxisAngle(axis, spin * (u - (u * u) / 2)).multiply(start);
      quat.copy(spun).slerp(rest, smooth((u - 0.62) / 0.38));
    },
  };
}
