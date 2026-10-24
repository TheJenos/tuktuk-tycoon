import { useLayoutEffect, useRef } from 'react';
import { CylinderGeometry, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import { BOARD_TOP, JAIL_CELL, toWorld } from './layout';

/*
 * Bars around the jail cell, on the two sides that face the Just Visiting strip: one static InstancedMesh.
 */

const BARS_PER_SIDE = 7;
const HEIGHT = 0.34;
const barGeo = new CylinderGeometry(0.012, 0.012, HEIGHT, 6).translate(0, HEIGHT / 2, 0);
const railGeo = new CylinderGeometry(0.016, 0.016, 1, 6).rotateZ(Math.PI / 2);
const iron = new MeshStandardMaterial({ color: '#3a3f47', metalness: 0.7, roughness: 0.45 });

/** Jail is the corner of side 1 */
const SIDE = 1;

export function JailBars() {
  const bars = useRef<InstancedMesh>(null);
  const rails = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = new Matrix4();
    const q = new Quaternion();
    const one = new Vector3(1, 1, 1);
    const { min, max } = JAIL_CELL;
    let n = 0;
    for (let k = 0; k < BARS_PER_SIDE; k++) {
      const t = min + ((k + 0.5) / BARS_PER_SIDE) * (max - min);
      for (const [lx, lz] of [[max, t], [t, max]] as const) {
        const [x, z] = toWorld(SIDE, lx, lz);
        bars.current?.setMatrixAt(n++, m.compose(new Vector3(x, BOARD_TOP, z), q, one));
      }
    }
    if (bars.current) bars.current.instanceMatrix.needsUpdate = true;
    // A top rail on each barred side
    const mid = (min + max) / 2;
    const len = max - min;
    const railAt = (i: number, lx: number, lz: number, alongX: boolean) => {
      const [x, z] = toWorld(SIDE, lx, lz);
      // Along local x on side 1 runs along world z
      const yaw = alongX ? Math.PI / 2 : 0;
      rails.current?.setMatrixAt(i, m.compose(new Vector3(x, BOARD_TOP + HEIGHT, z), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw), new Vector3(len, 1, 1)));
    };
    railAt(0, max, mid, false);
    railAt(1, mid, max, true);
    if (rails.current) rails.current.instanceMatrix.needsUpdate = true;
  }, []);
  return (
    <group>
      <instancedMesh ref={bars} args={[barGeo, iron, BARS_PER_SIDE * 2]} frustumCulled={false} castShadow />
      <instancedMesh ref={rails} args={[railGeo, iron, 2]} frustumCulled={false} castShadow />
    </group>
  );
}
