import { useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Color, InstancedMesh, Matrix4, MeshBasicMaterial, PlaneGeometry, Quaternion, Vector3 } from 'three';
import { useSessionView } from '../../state/session';
import { useSelector } from '../../state/store';
import { uiStore } from '../../state/ui';
import { useView } from '../../view';
import { BOARD_TOP, INNER, TILES, tileCenter, tileRotation, tileSize } from './layout';

/*
 * A player's holdings at a glance: while a player card is hovered (uiStore.spotlight), every tile that player does
 * not own and the board's centre go dark, and the tiles they do own are washed in their colour. Two instanced
 * quad sets laid just above the printed board, under the houses and tokens, so pieces stay readable.
 */

const quad = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const darkMat = new MeshBasicMaterial({ color: '#05070b', transparent: true, opacity: 0.68, depthWrite: false });
const washMat = new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.32, depthWrite: false });
const Y = BOARD_TOP + 0.004;
const tmp = { m: new Matrix4(), q: new Quaternion(), p: new Vector3(), s: new Vector3(), up: new Vector3(0, 1, 0), c: new Color() };

export function Spotlight() {
  const seat = useSelector(uiStore, (u) => u.spotlight);
  const color = useSessionView((v) => (seat ? v.doc?.seats[seat]?.color : undefined));
  const game = useView((v) => v.game);
  const invalidate = useThree((s) => s.invalidate);
  const dark = useRef<InstancedMesh>(null);
  const wash = useRef<InstancedMesh>(null);

  const owned = useMemo(() => {
    const out = new Set<number>();
    if (!seat || !game) return out;
    for (let i = 0; i < TILES; i++) if (game.props[`p${i}`]?.owner === seat) out.add(i);
    return out;
  }, [seat, game]);

  useLayoutEffect(() => {
    const d = dark.current;
    const w = wash.current;
    if (!d || !w || !seat) return;
    let nd = 0;
    let nw = 0;
    for (let i = 0; i < TILES; i++) {
      const [x, z] = tileCenter(i);
      const [sw, sd] = tileSize(i);
      tmp.q.setFromAxisAngle(tmp.up, tileRotation(i));
      tmp.m.compose(tmp.p.set(x, Y, z), tmp.q, tmp.s.set(sw * 0.985, 1, sd * 0.985));
      if (owned.has(i)) w.setMatrixAt(nw++, tmp.m);
      else d.setMatrixAt(nd++, tmp.m);
    }
    // The board's centre, inside the ring of tiles
    d.setMatrixAt(nd++, tmp.m.compose(tmp.p.set(0, Y, 0), tmp.q.identity(), tmp.s.set(INNER * 2, 1, INNER * 2)));
    d.count = nd;
    w.count = nw;
    d.instanceMatrix.needsUpdate = true;
    w.instanceMatrix.needsUpdate = true;
    washMat.color.set(color ?? '#ffffff');
    invalidate();
  }, [seat, owned, color, invalidate]);

  useEffect(() => {
    invalidate();
  }, [seat, invalidate]);

  if (!seat) return null;
  return (
    <>
      <instancedMesh ref={dark} args={[quad, darkMat, TILES + 1]} frustumCulled={false} renderOrder={1} />
      <instancedMesh ref={wash} args={[quad, washMat, TILES]} frustumCulled={false} renderOrder={1} />
    </>
  );
}
