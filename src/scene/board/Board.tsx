import { RoundedBox } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useMemo } from 'react';
import type { CanvasTexture } from 'three';
import { DEFAULT_RULES, getBoard, type GameState } from '../../rules';
import { useView } from '../../view';
import type { Tier } from '../quality';
import { makeCanvas, toTexture } from '../textures/canvas';
import { drawBoard, type PaintRules } from './drawBoard';
import { BOARD_TOP, FRAME, SIDE } from './layout';

/*
 * The board: a rounded slab with the painted top. The texture is painted once per board, rules and size and kept
 * for the session (switching games or quality reuses it).
 */

const textures = new Map<string, CanvasTexture>();

/** Everything the board's paint depends on: the board id and the amounts printed on it */
export function paintKey(game: GameState | null): string {
  const c = game?.cfg ?? DEFAULT_RULES;
  return [c.board, c.goSalary, c.incomeFlat, c.incomePct, c.luxuryTax, c.jailFine].join('|');
}

export function boardTexture(key: string, size: number, anisotropy: number): CanvasTexture {
  const id = `${key}@${size}`;
  let t = textures.get(id);
  if (!t) {
    const [board = '', goSalary, incomeFlat, incomePct, luxuryTax, jailFine] = key.split('|');
    const rules: PaintRules = {
      goSalary: Number(goSalary),
      incomeFlat: Number(incomeFlat),
      incomePct: Number(incomePct),
      luxuryTax: Number(luxuryTax),
      jailFine: Number(jailFine),
    };
    const canvas = makeCanvas(size, size);
    drawBoard(canvas, getBoard(board), rules);
    t = toTexture(canvas, anisotropy);
    textures.set(id, t);
  }
  return t;
}

/** The board's paint key from the displayed game (classic defaults in the lobby) */
export const useBoardKey = (): string => useView((v) => paintKey(v.game));

export function Board({ tier, paint }: { tier: Tier; paint?: string }) {
  const live = useBoardKey();
  const key = paint ?? live;
  const gl = useThree((s) => s.gl);
  const map = useMemo(() => boardTexture(key, tier.boardTex, Math.min(8, gl.capabilities.getMaxAnisotropy())), [key, tier.boardTex, gl]);
  const outer = SIDE + 2 * FRAME;
  return (
    <group>
      <RoundedBox args={[outer, BOARD_TOP, outer]} radius={0.06} smoothness={3} position={[0, BOARD_TOP / 2, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#173f31" roughness={0.5} metalness={0.05} />
      </RoundedBox>
      <mesh rotation-x={-Math.PI / 2} position-y={BOARD_TOP + 0.002} receiveShadow>
        <planeGeometry args={[SIDE, SIDE]} />
        <meshStandardMaterial map={map} roughness={0.82} metalness={0} />
      </mesh>
    </group>
  );
}
