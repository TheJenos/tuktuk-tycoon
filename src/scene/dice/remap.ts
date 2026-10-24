import { Quaternion, Vector3 } from 'three';

/*
 * Dice faces and the remap that makes any recorded tumble land on the engine's value. A die body tumbles however
 * the simulation (or the kinematic toss) says; its visual mesh is a child rotated by a constant correction C, picked
 * so that the face we need ends up where the body's top face is. Between two axis-aligned normals C is always one
 * of the cube's 24 symmetries, so the (symmetric, rounded) cube still looks exactly like the body that was simulated.
 */

/** Face index -> outward normal in the die's own frame */
export const FACE_NORMALS: readonly Vector3[] = [
  new Vector3(0, 1, 0),
  new Vector3(0, -1, 0),
  new Vector3(1, 0, 0),
  new Vector3(-1, 0, 0),
  new Vector3(0, 0, 1),
  new Vector3(0, 0, -1),
];

/** Pips on each face index of a white die (opposite faces add up to 7) */
export const WHITE_FACES: readonly number[] = [1, 6, 2, 5, 3, 4];

/** BoxGeometry's material groups are +X, -X, +Y, -Y, +Z, -Z: the face index each group shows */
export const BOX_GROUP_FACE: readonly number[] = [2, 3, 0, 1, 4, 5];

const UP = new Vector3(0, 1, 0);
const tmp = new Vector3();

/** How far face `face` points up (1 = flat on the table) under rotation `q` */
export const upness = (q: Quaternion, face: number): number =>
  tmp.copy(FACE_NORMALS[face] as Vector3).applyQuaternion(q).y;

/** The face pointing most nearly up under rotation `q` */
export function landedFace(q: Quaternion): number {
  let best = 0;
  let bestY = -Infinity;
  for (let i = 0; i < FACE_NORMALS.length; i++) {
    const y = upness(q, i);
    if (y > bestY) {
      bestY = y;
      best = i;
    }
  }
  return best;
}

/** The constant child rotation that shows face `target` where the body's face `landed` is: visual = body * C */
export const correction = (landed: number, target: number): Quaternion =>
  new Quaternion().setFromUnitVectors(FACE_NORMALS[target] as Vector3, FACE_NORMALS[landed] as Vector3);

/** The face index to show for `value`; with two faces of that value (Tuk-Tuk Uncle) the one already up wins */
export function faceFor<V>(faces: readonly V[], value: V, landed?: number): number {
  if (landed !== undefined && faces[landed] === value) return landed;
  const i = faces.indexOf(value);
  return i < 0 ? 0 : i;
}

/** A resting rotation with face `face` up, turned by `yaw` about the vertical */
export function restingQuat(face: number, yaw: number): Quaternion {
  const q = new Quaternion().setFromUnitVectors(FACE_NORMALS[face] as Vector3, UP);
  return new Quaternion().setFromAxisAngle(UP, yaw).multiply(q);
}
