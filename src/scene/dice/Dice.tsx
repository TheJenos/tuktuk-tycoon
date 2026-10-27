import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Group, Mesh, Quaternion, Vector3 } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { getBoard, heroesOf, type GameEvent, type GameState, type HeroDef, type SeatId } from '../../rules';
import { ANIM } from '../../shared/timing';
import { settings } from '../../ui/settings';
import { director, useView } from '../../view';
import { BOARD_TOP, CENTRE } from '../board/layout';
import type { Tier } from '../quality';
import { useSeatLooks } from '../seats';
import { seeded } from '../util/random';
import { heroDieMaterials, speedDieMaterials, whiteDieMaterials } from './faces';
import { kinematicThrow, type Throw } from './kinematic';
import { correction, faceFor, HERO_FACES, WHITE_FACES } from './remap';
import { showDiceFrom } from './shown';
import { DIE_HALF, loadRapier, rapierReady, simulateThrow, SIM_HZ, type Recording } from './simulate';
import { dimWithSpotlight } from '../dimmable';

/*
 * Two white dice and, when the roll has one, the red Speed Die; on Hero League also the Hero die, thrown on its own
 * (for a card's hits or a back-up save; a re-roll is another throw). Each die is a body group (the recorded or tumbled
 * pose) holding the visual mesh, which the remap turns by a constant correction so the engine's value lands on top.
 * The dice of the last throw stay where they landed until the next one; the others are put away.
 */

type DiceEvent = Extract<GameEvent, { t: 'dice' }>;

const geo = new RoundedBoxGeometry(DIE_HALF * 2, DIE_HALF * 2, DIE_HALF * 2, 3, 0.06);
const REST_Y = BOARD_TOP + DIE_HALF;
/** The dice sit still on the board this long before the move starts */
const HOLD_MS = 160;
/** Body slots: the two white dice, the Speed Die, the Hero die */
const SLOTS = 4;
const HERO_SLOT = 3;

/** One die of a throw: its body slot, and the face to show given the face its body landed on (physics) */
interface Die {
  slot: number;
  target: (landed?: number) => number;
}

interface Roll {
  start: number;
  dur: number;
  /** The slot of each die thrown, in throw order (the recording's and the tosses' order) */
  slots: number[];
  rec: Recording | null;
  throws: Throw[];
  scaleIn: boolean;
  done: () => void;
}

/** The seat still in that plays each hero (face order), '' for none: one string, so it re-renders only on a change */
function playingKey(g: GameState | null, heroes: readonly HeroDef[]): string {
  const seatOf = (id: string) => g?.order.find((seat) => g.players[seat]?.hero === id && !g.players[seat]?.out) ?? '';
  return heroes.map((h) => seatOf(h.id)).join(',');
}

export function Dice({ tier }: { tier: Tier }) {
  const boardId = useView((v) => v.game?.cfg.board ?? 'lanka');
  const board = getBoard(boardId);
  const speedMats = useMemo(() => speedDieMaterials(board.speedDie.faces, board.speedDie.labels), [board]);
  // The Hero die's faces in the colours of the seats playing the heroes
  const looks = useSeatLooks();
  const playing = useView((v) => playingKey(v.game, heroesOf(board)));
  const heroMats = useMemo(() => {
    if (!board.heroes) return null;
    const colours = playing.split(',').map((seat) => (seat ? (looks[seat as SeatId]?.color ?? null) : null));
    return heroDieMaterials(heroesOf(board), colours);
  }, [board, playing, looks]);
  useEffect(() => {
    dimWithSpotlight(whiteDieMaterials());
    dimWithSpotlight(speedMats);
    if (heroMats) dimWithSpotlight(heroMats);
  }, [speedMats, heroMats]);
  const bodies = useRef<(Group | null)[]>(Array.from({ length: SLOTS }, () => null));
  const meshes = useRef<(Mesh | null)[]>(Array.from({ length: SLOTS }, () => null));
  const roll = useRef<Roll | null>(null);
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    if (tier.physics && settings.get().dicePhysics) loadRapier().catch(() => {});
  }, [tier.physics]);

  useEffect(() => showDiceFrom(meshes.current, board.speedDie.faces, heroesOf(board).map((h) => h.id)), [board]);

  useEffect(() => {
    /** Throws these dice (the others are put away until their next throw) and lands each on its target */
    const throwDice = (dice: Die[], signal: AbortSignal, speed: number, seed: number) =>
      new Promise<void>((resolve) => {
        if (signal.aborted) return resolve();
        roll.current?.done();
        const count = dice.length;
        const slots = dice.map((d) => d.slot);
        const rand = seeded(seed);
        const reduced = settings.get().reduceMotion;
        const physics = tier.physics && settings.get().dicePhysics && !reduced;
        const R = physics ? rapierReady() : null;
        // Physics turned on mid-game: this throw tumbles, the next one has physics
        if (physics && !R) loadRapier().catch(() => {});
        const rec = R ? simulateThrow(R, count, seed) : null;
        const targets = dice.map((d, j) => d.target(rec?.landed[j]));
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
          for (let j = 0; j < count; j++) {
            const off = (j - (count - 1) / 2) * 0.72;
            const from = turn(off * 0.8, 3.4 * CENTRE, BOARD_TOP + 2.2 + j * 0.15);
            const to = turn(off + (rand() - 0.5) * 0.2, -0.2 + (rand() - 0.5) * 0.5, REST_Y);
            throws.push(kinematicThrow(rand, from, to, targets[j] as number));
          }
          dur = ANIM.dice / speed;
        }
        if (reduced) dur = 150;
        for (let k = 0; k < SLOTS; k++) {
          const body = bodies.current[k];
          const mesh = meshes.current[k];
          if (!body || !mesh) continue;
          const j = slots.indexOf(k);
          body.visible = j >= 0;
          const landed = rec?.landed[j];
          mesh.quaternion.copy(landed === undefined ? new Quaternion() : correction(landed, targets[j] as number));
        }
        const finish = () => {
          if (roll.current !== r) return;
          pose(r, 1);
          roll.current = null;
          invalidate();
          setTimeout(resolve, signal.aborted ? 0 : HOLD_MS / speed);
        };
        const r: Roll = { start: performance.now(), dur, slots, rec, throws, scaleIn: reduced, done: finish };
        roll.current = r;
        signal.addEventListener('abort', finish, { once: true });
        pose(r, 0);
        invalidate();
      });
    return director.register('dice', {
      roll(ev: DiceEvent, signal: AbortSignal, speed: number, seed = 1) {
        const dice: Die[] = [
          { slot: 0, target: () => faceFor(WHITE_FACES, ev.w[0]) },
          { slot: 1, target: () => faceFor(WHITE_FACES, ev.w[1]) },
        ];
        const s = ev.s;
        if (s !== undefined) dice.push({ slot: 2, target: (landed) => faceFor(board.speedDie.faces, s, landed) });
        return throwDice(dice, signal, speed, seed);
      },
      hero(ev, signal, speed, seed = 1) {
        return throwDice([{ slot: HERO_SLOT, target: () => faceFor(HERO_FACES, ev.face) }], signal, speed, seed);
      },
    });
  }, [board, invalidate, tier.physics]);

  const tmpQ = useMemo(() => new Quaternion(), []);
  const tmpQ2 = useMemo(() => new Quaternion(), []);
  /** Puts every die at progress t of the roll (reduced motion: already at rest, growing in) */
  function pose(r: Roll, progress: number) {
    const t = r.scaleIn ? 1 : progress;
    r.slots.forEach((slot, j) => {
      const body = bodies.current[slot];
      if (!body) return;
      if (r.rec) {
        const track = r.rec.tracks[j] as Float32Array;
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
        r.throws[j]?.sample(t, body.position, body.quaternion);
      }
      body.scale.setScalar(r.scaleIn ? Math.min(1, 0.3 + progress) : 1);
    });
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
  const mats = [white, white, speedMats, heroMats];
  return (
    <group>
      {mats.map((m, k) =>
        m ? (
          <group key={k} ref={(g) => void (bodies.current[k] = g)} visible={false}>
            <mesh ref={(x) => void (meshes.current[k] = x)} geometry={geo} material={m} castShadow receiveShadow />
          </group>
        ) : null,
      )}
    </group>
  );
}
