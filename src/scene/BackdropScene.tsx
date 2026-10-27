import { useFrame, useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { DEFAULT_TOKEN, SEAT_COLORS, TOKENS } from '../shared/tokens';
import { useSelector } from '../state/store';
import { settings } from '../ui/settings';
import { Board, paintKey } from './board/Board';
import { hotelGeo, hotelMat, houseGeo, houseMat } from './board/Pieces';
import { BOARD_TOP, buildingPos, setBoardSize, slotPos, tileRotation, travelYaw } from './board/layout';
import { Lights, Table } from './Lights';
import type { Tier } from './quality';
import { ringGeometry, tokenGeometry } from './tokens/shapes';
import { tokenMaterial, trimMaterial } from './tokens/materials';

/*
 * The lobby's backdrop: the board with a few tokens and buildings, the camera slowly circling it (one turn in
 * 150 s, drawn at 30 fps). A still frame on low quality, with reduced motion and on touch screens.
 */

const ORBIT_S = 150;
const DEMO_TOKENS: [number, number][] = [[0, 0], [24, 1], [39, 2], [11, 3], [16, 4]];
const DEMO_HOUSES: [number, number][] = [[37, 3], [39, 5], [21, 2], [23, 2], [24, 3]];
const COARSE = typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches;

export function BackdropScene({ tier }: { tier: Tier }) {
  // The menus' board is All Island's
  setBoardSize(40);
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const reduced = useSelector(settings, (s) => s.reduceMotion);
  const still = tier.shadowMap === 0 || reduced || COARSE;

  useEffect(() => {
    invalidate();
    if (still) return;
    const timer = setInterval(() => invalidate(), 1000 / 30);
    return () => clearInterval(timer);
  }, [still, invalidate]);

  useFrame(() => {
    const a = still ? 0.6 : ((performance.now() / 1000) * Math.PI * 2) / ORBIT_S;
    camera.position.set(Math.sin(a) * 15.5, 11.5, Math.cos(a) * 15.5);
    camera.lookAt(0, 0, 0);
  });

  return (
    <>
      <Lights tier={tier} />
      <Table />
      <Board tier={tier} paint={paintKey(null)} />
      {DEMO_TOKENS.map(([tile, seat]) => {
        const [x, z] = slotPos(tile, 1, 0);
        const id = TOKENS[seat]?.id ?? DEFAULT_TOKEN;
        return (
          <group key={tile} position={[x, BOARD_TOP, z]} rotation-y={travelYaw(tile)}>
            <mesh geometry={tokenGeometry(id)} material={tokenMaterial(SEAT_COLORS[seat] ?? '#888888')} castShadow />
            <mesh geometry={ringGeometry()} material={trimMaterial} />
          </group>
        );
      })}
      {DEMO_HOUSES.flatMap(([tile, level]) =>
        level === 5
          ? [<mesh key={`${tile}H`} geometry={hotelGeo} material={hotelMat} position={[buildingPos(tile, 4)[0], BOARD_TOP, buildingPos(tile, 4)[1]]} rotation-y={tileRotation(tile)} castShadow />]
          : Array.from({ length: level }, (_, k) => {
              const [x, z] = buildingPos(tile, k);
              return <mesh key={`${tile}:${k}`} geometry={houseGeo} material={houseMat} position={[x, BOARD_TOP, z]} rotation-y={tileRotation(tile)} castShadow />;
            }),
      )}
    </>
  );
}
