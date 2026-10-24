import { useCursor } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { useState } from 'react';
import { uiStore } from '../../state/ui';
import { BOARD_TOP, SIDE, tileAt } from './layout';

/*
 * One invisible plane over the board for pointing at tiles (no hit mesh per tile): hovering sets uiStore.hover; a
 * click picks a legal tile for an open picker, otherwise opens that tile's deed (uiStore.selected). A drag that
 * turned the camera is not a click.
 */

const DRAG_PX = 6;

export function BoardPicker() {
  const [pointing, setPointing] = useState(false);
  useCursor(pointing);
  const hover = (e: ThreeEvent<PointerEvent>) => {
    const tile = tileAt(e.point.x, e.point.z);
    setPointing(tile !== null);
    uiStore.update({ hover: tile });
  };
  const click = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > DRAG_PX) return;
    const tile = tileAt(e.point.x, e.point.z);
    if (tile === null) return;
    const picker = uiStore.get().picker;
    if (picker) {
      if (picker.legal.includes(tile)) picker.onPick?.(tile);
      return;
    }
    uiStore.update({ selected: tile });
  };
  return (
    <mesh
      rotation-x={-Math.PI / 2}
      position-y={BOARD_TOP + 0.01}
      visible={false}
      onPointerMove={hover}
      onPointerOut={() => {
        setPointing(false);
        uiStore.update({ hover: null });
      }}
      onClick={click}
    >
      <planeGeometry args={[SIDE, SIDE]} />
    </mesh>
  );
}
