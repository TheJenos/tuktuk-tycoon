import { Quaternion } from 'three';
import type RAPIER_NS from '#rapier';
import { BOARD_TOP, CENTRE } from '../board/layout';
import { CARD_H, CARD_W, deckSpot, throwHalf } from '../board/centre';
import { seeded } from '../util/random';
import { randomQuat } from './kinematic';
import { landedFace, upness } from './remap';

/*
 * The physics throw: Rapier simulates the dice headless, the frames are recorded, and the player watches the
 * recording with the remap correction applied (see remap.ts), so the engine's values land on top. Only the look of
 * the tumble comes from physics; it need not match across clients.
 *
 * `#rapier` (package.json "imports") is the browser build with a real .wasm (vite-plugin-wasm) in the app and the
 * -compat build (base64 wasm, needs init()) in Node, as in the reference repo. It is loaded on first use, in its
 * own chunk, so a game on low quality never downloads it.
 */

export type Rapier = typeof RAPIER_NS;

let rapier: Rapier | null = null;
let loading: Promise<Rapier> | null = null;

/** Download and start the engine (once); resolves with it, rejects (and allows a retry) on failure */
export function loadRapier(): Promise<Rapier> {
  loading ??= import('#rapier')
    .then(async (mod) => {
      const R = (mod as unknown as { default?: Rapier }).default ?? (mod as unknown as Rapier);
      const compat = R as Rapier & { init?: () => Promise<void> };
      if (typeof compat.init === 'function') await compat.init();
      rapier = R;
      return R;
    })
    .catch((err: unknown) => {
      loading = null;
      throw err;
    });
  return loading;
}

/** The engine if loadRapier() has finished, else null (the caller falls back to the kinematic throw) */
export const rapierReady = (): Rapier | null => rapier;

/** Half the edge of a die */
export const DIE_HALF = 0.25;
const ROUND = 0.05;
export const SIM_HZ = 60;
const MAX_STEPS = 360;
const GRAVITY = 55;
/** A die counts as flat when its top face's normal is this close to straight up */
const FLAT = 0.97;

export interface Recording {
  /** Frames recorded (at SIM_HZ) */
  frames: number;
  /** Per die: frames x [px, py, pz, qx, qy, qz, qw] */
  tracks: Float32Array[];
  /** Per die: the face that ended on top of the body */
  landed: number[];
}

function buildWorld(R: Rapier): RAPIER_NS.World {
  const world = new R.World({ x: 0, y: -GRAVITY, z: 0 });
  const fixed = (hx: number, hy: number, hz: number, x: number, y: number, z: number, yaw = 0) => {
    const desc = R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setFriction(0.6).setRestitution(0.3);
    if (yaw) desc.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });
    world.createCollider(desc);
  };
  fixed(8, 0.5, 8, 0, BOARD_TOP - 0.5, 0);
  const wallH = 3;
  const THROW_HALF = throwHalf();
  fixed(0.25, wallH, THROW_HALF + 0.5, THROW_HALF + 0.25, BOARD_TOP + wallH, 0);
  fixed(0.25, wallH, THROW_HALF + 0.5, -THROW_HALF - 0.25, BOARD_TOP + wallH, 0);
  fixed(THROW_HALF + 0.5, wallH, 0.25, 0, BOARD_TOP + wallH, THROW_HALF + 0.25);
  fixed(THROW_HALF + 0.5, wallH, 0.25, 0, BOARD_TOP + wallH, -THROW_HALF - 0.25);
  // The two card decks, so a die never ends up inside one
  for (const d of [deckSpot('chance'), deckSpot('chest')]) fixed(CARD_W / 2, 0.12, CARD_H / 2, d.x, BOARD_TOP + 0.12, d.z, d.yaw);
  // A lid, so a hard bounce can't leave the box
  fixed(THROW_HALF + 0.5, 0.25, THROW_HALF + 0.5, 0, BOARD_TOP + 2 * wallH, 0);
  return world;
}

/** One attempt: the recording, or null when a die didn't settle flat on the board */
function attempt(R: Rapier, count: number, seed: number): Recording | null {
  const rand = seeded(seed);
  const world = buildWorld(R);
  try {
    // The throw comes in from a random side, aimed past the middle, so it varies from roll to roll.
    const heading = rand() * Math.PI * 2;
    const c = Math.cos(heading);
    const s = Math.sin(heading);
    const turn = (x: number, z: number): [number, number] => [x * c - z * s, x * s + z * c];
    const q = new Quaternion();
    const bodies: RAPIER_NS.RigidBody[] = [];
    for (let i = 0; i < count; i++) {
      const [x, z] = turn((i - (count - 1) / 2) * 0.72 + (rand() - 0.5) * 0.3, 3.1 * CENTRE);
      const [vx, vz] = turn((rand() - 0.5) * 2.5, -(6.5 + rand() * 3.5));
      randomQuat(rand, q);
      const body = world.createRigidBody(
        R.RigidBodyDesc.dynamic()
          .setTranslation(x, BOARD_TOP + 1.3 + rand() * 0.5, z)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
          .setLinvel(vx, 1 + rand() * 2, vz)
          .setAngvel({ x: (rand() - 0.5) * 30, y: (rand() - 0.5) * 20, z: (rand() - 0.5) * 30 })
          .setLinearDamping(0.25)
          .setAngularDamping(0.6)
          .setCcdEnabled(true),
      );
      world.createCollider(
        R.ColliderDesc.roundCuboid(DIE_HALF - ROUND, DIE_HALF - ROUND, DIE_HALF - ROUND, ROUND)
          .setDensity(1)
          .setFriction(0.5)
          .setRestitution(0.35),
        body,
      );
      bodies.push(body);
    }
    const tracks = bodies.map(() => new Float32Array(MAX_STEPS * 7));
    let frames = 0;
    let still = 0;
    while (frames < MAX_STEPS) {
      world.step();
      let moving = false;
      bodies.forEach((b, i) => {
        const t = b.translation();
        const r = b.rotation();
        (tracks[i] as Float32Array).set([t.x, t.y, t.z, r.x, r.y, r.z, r.w], frames * 7);
        const v = b.linvel();
        const w = b.angvel();
        if (Math.hypot(v.x, v.y, v.z) > 0.08 || Math.hypot(w.x, w.y, w.z) > 0.15) moving = true;
      });
      frames++;
      still = moving ? 0 : still + 1;
      if (still >= 8) break;
    }
    if (still < 8) return null;
    const landed: number[] = [];
    for (const b of bodies) {
      const r = b.rotation();
      q.set(r.x, r.y, r.z, r.w);
      const face = landedFace(q);
      // Cocked against a wall or another die, or resting on top of one: try another throw.
      if (upness(q, face) < FLAT || b.translation().y > BOARD_TOP + DIE_HALF + 0.08) return null;
      landed.push(face);
    }
    return { frames, tracks: tracks.map((t) => t.slice(0, frames * 7)), landed };
  } finally {
    world.free();
  }
}

/** A recorded throw of `count` dice (3 retries with new salts), or null: use the kinematic throw instead */
export function simulateThrow(R: Rapier, count: number, seed: number): Recording | null {
  for (let i = 0; i < 4; i++) {
    const rec = attempt(R, count, (seed + Math.imul(i, 0x9e3779b9)) >>> 0);
    if (rec) return rec;
  }
  return null;
}
