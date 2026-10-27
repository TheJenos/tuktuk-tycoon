import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Group, Mesh, Quaternion, Vector3 } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { getBoard, type GameEvent } from '../../rules';
import { ANIM } from '../../shared/timing';
import { settings } from '../../ui/settings';
import { director, useView } from '../../view';
import { BOARD_TOP, CENTRE } from '../board/layout';
import type { Tier } from '../quality';
import { seeded } from '../util/random';
import { speedDieMaterials, whiteDieMaterials } from './faces';
import { kinematicThrow, type Throw } from './kinematic';
import { correction, faceFor, WHITE_FACES } from './remap';
import { showDiceFrom } from './shown';
import { DIE_HALF, loadRapier, rapierReady, simulateThrow, SIM_HZ, type Recording } from './simulate';
import { dimWithSpotlight } from '../dimmable';

/*
 * Two white dice and, when the roll has one, the red Speed Die. Each die is a body group (the recorded or tumbled
 * pose) holding the visual mesh, which the remap turns by a constant correction so the engine's value lands on top.
 * The dice stay where they landed until the next throw.
 */

type DiceEvent = Extract<GameEvent, { t: 'dice' }>;

const geo = new RoundedBoxGeometry(DIE_HALF * 2, DIE_HALF * 2, DIE_HALF * 2, 3, 0.06);
const REST_Y = BOARD_TOP + DIE_HALF;
/** The dice sit still on the board this long before the move starts */
const HOLD_MS = 160;

interface Roll {
  start: number;
  dur: number;
  count: number;
  rec: Recording | null;
  throws: Throw[];
  scaleIn: boolean;
  done: () => void;
}

export function Dice({ tier }: { tier: Tier }) {
  const boardId = useView((v) => v.game?.cfg.board ?? 'lanka');
  const board = getBoard(boardId);
  const speedMats = useMemo(() => speedDieMaterials(board.speedDie.faces, board.speedDie.labels), [board]);
  useEffect(() => {
    dimWithSpotlight(whiteDieMaterials());
    dimWithSpotlight(speedMats);
  }, [speedMats]);
  const bodies = useRef<(Group | null)[]>([null, null, null]);
  const meshes = useRef<(Mesh | null)[]>([null, null, null]);
  const roll = useRef<Roll | null>(null);
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    if (tier.physics && settings.get().dicePhysics) loadRapier().catch(() => {});
  }, [tier.physics]);

  useEffect(() => showDiceFrom(meshes.current, board.speedDie.faces), [board]);

  useEffect(
    () =>
      director.register('dice', {
        roll(ev: DiceEvent, signal: AbortSignal, speed: number, seed = 1) {
          return new Promise<void>((resolve) => {
            if (signal.aborted) return resolve();
            roll.current?.done();
            const count = ev.s === undefined ? 2 : 3;
            const values = [ev.w[0], ev.w[1]];
            const rand = seeded(seed);
            const reduced = settings.get().reduceMotion;
            const physics = tier.physics && settings.get().dicePhysics && !reduced;
            const R = physics ? rapierReady() : null;
            // Physics turned on mid-game: this throw tumbles, the next one has physics
            if (physics && !R) loadRapier().catch(() => {});
            const rec = R ? simulateThrow(R, count, seed) : null;
            const targets = [0, 1, 2].map((k) => {
              if (k < 2) return faceFor(WHITE_FACES, values[k] as number);
              return ev.s === undefined ? 0 : faceFor(board.speedDie.faces, ev.s, rec?.landed[2]);
            });
            const throws: Throw[] = [];
            let dur: number;
            if (rec) {
              const ms = (rec.frames / SIM_HZ) * 1000;
              // Long settles play a little faster, so a throw never runs past the dice budget by much.
              dur = Math.min(ms, Math.max(ANIM.dice, ms / 1.6)) / speed;
            } else {
              const heading = rand() * Math.PI * 2;
              const c = Math.cos(heading);
              const s = Math.sin(heading);
              const turn = (x: number, z: number, y: number) => new Vector3(x * c - z * s, y, x * s + z * c);
              for (let k = 0; k < count; k++) {
                const off = (k - (count - 1) / 2) * 0.72;
                const from = turn(off * 0.8, 3.4 * CENTRE, BOARD_TOP + 2.2 + k * 0.15);
                const to = turn(off + (rand() - 0.5) * 0.2, -0.2 + (rand() - 0.5) * 0.5, REST_Y);
                throws.push(kinematicThrow(rand, from, to, targets[k] as number));
              }
              dur = ANIM.dice / speed;
            }
            if (reduced) dur = 150;
            for (let k = 0; k < 3; k++) {
              const body = bodies.current[k];
              const mesh = meshes.current[k];
              if (!body || !mesh) continue;
              body.visible = k < count;
              const landed = rec?.landed[k];
              mesh.quaternion.copy(landed === undefined ? new Quaternion() : correction(landed, targets[k] as number));
            }
            const finish = () => {
              if (roll.current !== r) return;
              pose(r, 1);
              roll.current = null;
              invalidate();
              setTimeout(resolve, signal.aborted ? 0 : HOLD_MS / speed);
            };
            const r: Roll = { start: performance.now(), dur, count, rec, throws, scaleIn: reduced, done: finish };
            roll.current = r;
            signal.addEventListener('abort', finish, { once: true });
            pose(r, 0);
            invalidate();
          });
        },
      }),
    [board, invalidate, tier.physics],
  );

  const tmpQ = useMemo(() => new Quaternion(), []);
  const tmpQ2 = useMemo(() => new Quaternion(), []);
  /** Puts every die at progress t of the roll (reduced motion: already at rest, growing in) */
  function pose(r: Roll, progress: number) {
    const t = r.scaleIn ? 1 : progress;
    for (let k = 0; k < r.count; k++) {
      const body = bodies.current[k];
      if (!body) continue;
      if (r.rec) {
        const track = r.rec.tracks[k] as Float32Array;
        const f = Math.min(1, t) * (r.rec.frames - 1);
        const i0 = Math.floor(f);
        const i1 = Math.min(r.rec.frames - 1, i0 + 1);
        const a = f - i0;
        const o0 = i0 * 7;
        const o1 = i1 * 7;
        const at = (j: number) => (track[o0 + j] as number) + ((track[o1 + j] as number) - (track[o0 + j] as number)) * a;
        body.position.set(at(0), at(1), at(2));
        tmpQ.set(track[o0 + 3] as number, track[o0 + 4] as number, track[o0 + 5] as number, track[o0 + 6] as number);
        tmpQ2.set(track[o1 + 3] as number, track[o1 + 4] as number, track[o1 + 5] as number, track[o1 + 6] as number);
        body.quaternion.copy(tmpQ).slerp(tmpQ2, a);
      } else {
        r.throws[k]?.sample(t, body.position, body.quaternion);
      }
      body.scale.setScalar(r.scaleIn ? Math.min(1, 0.3 + progress) : 1);
    }
  }

  useFrame(() => {
    const r = roll.current;
    if (!r) return;
    const t = (performance.now() - r.start) / r.dur;
    pose(r, t);
    if (t >= 1) r.done();
    else invalidate();
  });

  const white = whiteDieMaterials();
  return (
    <group>
      {[0, 1, 2].map((k) => (
        <group key={k} ref={(g) => void (bodies.current[k] = g)} visible={false}>
          <mesh ref={(m) => void (meshes.current[k] = m)} geometry={geo} material={k < 2 ? white : speedMats} castShadow receiveShadow />
        </group>
      ))}
    </group>
  );
}
