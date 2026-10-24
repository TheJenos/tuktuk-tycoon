import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
  BoxGeometry,
  CanvasTexture,
  Group,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three';
import { getBoard, type Deck, type GameEvent } from '../../rules';
import { ANIM } from '../../shared/timing';
import { uiStore } from '../../state/ui';
import { settings } from '../../ui/settings';
import { director, useView } from '../../view';
import { BOARD_TOP } from '../board/layout';
import { CARD_H, CARD_W, DECKS } from '../board/centre';
import { toTexture } from '../textures/canvas';
import { tokenPositions } from '../tokens/Tokens';
import { drawCardBack, drawCardFace } from './drawCard';
import { setCardSkip } from './flight';
import { cardHold } from './hold';

/*
 * The two decks in the middle of the board, and the drawn card's flight: it lifts off its deck, flies to just in
 * front of the camera turning face up, holds there (over the board, clear of the HUD and the DOM caption: hold.ts),
 * then goes back under its deck (or, a Get Out of Jail Free card, to the player who keeps it). The 'cards' scene API
 * plays it; the caption's OK sends it home early (flight.ts).
 */

const STACK_H = 0.12;
const stackGeo = new BoxGeometry(CARD_W, STACK_H, CARD_H).translate(0, STACK_H / 2, 0);
const cardGeo = new PlaneGeometry(CARD_W, CARD_H);
const edgeMat = new MeshStandardMaterial({ color: '#f1ede4', roughness: 0.8 });
/** Card flight phases, as fractions of the whole */
const OUT = 0.2;
const BACK = 0.84;

interface Flight {
  deck: Deck;
  start: number;
  dur: number;
  kept: boolean;
  seat: Extract<GameEvent, { t: 'card' }>['seat'];
  done: () => void;
}

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const UP = new Vector3(0, 1, 0);
const X = new Vector3(1, 0, 0);

/** Lying face down on its deck */
function deckPose(deck: Deck, pos: Vector3, q: Quaternion): void {
  const d = DECKS[deck];
  pos.set(d.x, BOARD_TOP + STACK_H + 0.01, d.z);
  q.setFromAxisAngle(UP, d.yaw).multiply(new Quaternion().setFromAxisAngle(X, Math.PI / 2));
}

export function Cards() {
  const boardId = useView((v) => v.game?.cfg.board ?? 'lanka');
  const board = getBoard(boardId);
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const invalidate = useThree((s) => s.invalidate);
  const backs = useMemo(
    () => ({
      chance: toTexture(drawCardBack(board, 'chance'), 4),
      chest: toTexture(drawCardBack(board, 'chest'), 4),
    }),
    [board],
  );
  const stackMats = useMemo(
    () =>
      (['chance', 'chest'] as const).map((deck) => {
        const top = new MeshStandardMaterial({ map: backs[deck], roughness: 0.6 });
        // BoxGeometry groups: +X, -X, +Y (top), -Y, +Z, -Z
        return [edgeMat, edgeMat, top, edgeMat, edgeMat, edgeMat];
      }),
    [backs],
  );
  const face = useMemo(() => {
    const canvas = drawCardFace(board, 'chance', '');
    return { canvas, tex: toTexture(canvas, 4) as CanvasTexture };
  }, [board]);
  // alphaTest: the canvas's rounded corners are transparent
  const faceMat = useMemo(() => new MeshBasicMaterial({ map: face.tex, toneMapped: false, alphaTest: 0.5 }), [face]);
  const backMat = useMemo(() => new MeshBasicMaterial({ map: backs.chance, toneMapped: false, alphaTest: 0.5 }), [backs]);
  const group = useRef<Group>(null);
  const flight = useRef<Flight | null>(null);

  useEffect(
    () =>
      director.register('cards', {
        show(ev, signal, speed) {
          return new Promise<void>((resolve) => {
            if (signal.aborted) return resolve();
            flight.current?.done();
            drawCardFace(board, ev.deck, ev.text, face.canvas);
            face.tex.needsUpdate = true;
            backMat.map = backs[ev.deck];
            backMat.needsUpdate = true;
            const finish = () => {
              if (flight.current !== f) return;
              flight.current = null;
              offSkip();
              if (group.current) group.current.visible = false;
              invalidate();
              resolve();
            };
            const f: Flight = { deck: ev.deck, start: performance.now(), dur: ANIM.card / Math.max(0.1, speed), kept: ev.kept, seat: ev.seat, done: finish };
            flight.current = f;
            // The caption's OK: straight to the flight home (with reduced motion, which has none, gone at once)
            const offSkip = setCardSkip(() => {
              if (settings.get().reduceMotion) return finish();
              f.start = Math.min(f.start, performance.now() - BACK * f.dur);
              invalidate();
            });
            signal.addEventListener('abort', finish, { once: true });
            invalidate();
          });
        },
      }),
    [board, backMat, backs, face, invalidate],
  );
  // A card still up when the scene goes (a context rebuilt, the game left) lets the director move on
  useEffect(() => () => flight.current?.done(), []);

  const tmp = useMemo(
    () => ({ a: new Vector3(), b: new Vector3(), qa: new Quaternion(), qb: new Quaternion(), fwd: new Vector3(), side: new Vector3() }),
    [],
  );
  useFrame(({ size }) => {
    const f = flight.current;
    const g = group.current;
    if (!f || !g) return;
    const t = (performance.now() - f.start) / f.dur;
    if (t >= 1) return f.done();
    // In front of the camera, sized to sit comfortably in the free part of the view and moved onto its middle
    const tanH = Math.tan(((camera.fov / 2) * Math.PI) / 180);
    const aspect = size.width / Math.max(1, size.height);
    const hold = cardHold(size.width, size.height, uiStore.get().insets, camera.fov);
    camera.getWorldDirection(tmp.fwd);
    const front = tmp.b.copy(camera.position).addScaledVector(tmp.fwd, hold.dist);
    front.addScaledVector(tmp.side.set(1, 0, 0).applyQuaternion(camera.quaternion), hold.x * hold.dist * tanH * aspect);
    front.addScaledVector(tmp.side.set(0, 1, 0).applyQuaternion(camera.quaternion), hold.y * hold.dist * tanH);
    const frontQ = tmp.qb.copy(camera.quaternion);
    deckPose(f.deck, tmp.a, tmp.qa);
    const reduced = settings.get().reduceMotion;
    g.visible = true;
    let scale = 1;
    if (reduced || (t >= OUT && t <= BACK)) {
      g.position.copy(front);
      g.quaternion.copy(frontQ);
    } else if (t < OUT) {
      const u = ease(t / OUT);
      g.position.lerpVectors(tmp.a, front, u);
      g.position.y += Math.sin(u * Math.PI) * 0.4;
      g.quaternion.slerpQuaternions(tmp.qa, frontQ, u);
    } else {
      const u = ease((t - BACK) / (1 - BACK));
      if (f.kept) {
        const at = tokenPositions.get(f.seat);
        if (at) tmp.a.copy(at).setY(at.y + 0.5);
        scale = 1 - u;
      }
      g.position.lerpVectors(front, tmp.a, u);
      g.quaternion.slerpQuaternions(frontQ, tmp.qa, u);
    }
    g.scale.setScalar(Math.max(0.001, scale));
    invalidate();
  });

  return (
    <group>
      {(['chance', 'chest'] as const).map((deck, i) => {
        const d = DECKS[deck];
        return <mesh key={deck} geometry={stackGeo} material={stackMats[i]} position={[d.x, BOARD_TOP, d.z]} rotation-y={d.yaw} castShadow receiveShadow />;
      })}
      <group ref={group} visible={false}>
        <mesh geometry={cardGeo} material={faceMat} position-z={0.003} />
        <mesh geometry={cardGeo} material={backMat} rotation-y={Math.PI} position-z={-0.003} />
      </group>
    </group>
  );
}
