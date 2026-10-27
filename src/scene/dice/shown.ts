import { Quaternion, type Object3D } from 'three';
import { HERO_FACES, landedFace, WHITE_FACES } from './remap';

/*
 * What the dice show, read back from the scene: for test hooks and the dev harness, without importing the scene.
 */

let source: { meshes: readonly (Object3D | null)[]; speed: readonly (number | string)[]; heroes: readonly string[] } | null = null;

/**
 * Dice.tsx registers its meshes (white, white, speed, hero), the Speed Die's faces and the heroes in Hero-die face
 * order; returns the unregister function
 */
export function showDiceFrom(meshes: readonly (Object3D | null)[], speed: readonly (number | string)[], heroes: readonly string[] = []): () => void {
  const me = { meshes, speed, heroes };
  source = me;
  return () => {
    if (source === me) source = null;
  };
}

/**
 * The values on top of the visible dice right now (white, white[, speed face], or the Hero die's hero id alone), from
 * the meshes' world rotation. Empty before the first throw or when no scene is mounted.
 */
export function shownDice(): (number | string)[] {
  const src = source;
  if (!src) return [];
  const q = new Quaternion();
  const out: (number | string)[] = [];
  src.meshes.forEach((m, k) => {
    if (!m?.parent?.visible) return;
    const f = landedFace(m.getWorldQuaternion(q));
    const v = k < 2 ? WHITE_FACES[f] : k === 2 ? src.speed[f] : src.heroes[(HERO_FACES[f] ?? 0) - 1];
    if (v !== undefined) out.push(v);
  });
  return out;
}
