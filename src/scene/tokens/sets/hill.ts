import {
  BoxGeometry,
  type BufferGeometry,
  CatmullRomCurve3,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { B, extrude, lathe, part, type TokenBuilder, type V3 } from '../kit';

/** The rotation that turns +Y (or `from`) onto the direction `dir` */
function aim(dir: Vector3, from = new Vector3(0, 1, 0)): V3 {
  const e = new Euler().setFromQuaternion(new Quaternion().setFromUnitVectors(from, dir.clone().normalize()));
  return [e.x, e.y, e.z];
}

/** A thin rod from a to b (y measured from the plinth top) */
function rod(a: V3, b: V3, r: number, segments = 6): BufferGeometry {
  const va = new Vector3(a[0], a[1] + B, a[2]);
  const d = new Vector3(b[0], b[1] + B, b[2]).sub(va);
  const mid = va.clone().addScaledVector(d, 0.5);
  return part(new CylinderGeometry(r * 0.8, r, d.length(), segments), [mid.x, mid.y, mid.z], aim(d));
}

/** The radius of a lathe profile at height y */
function radiusAt(pts: [number, number][], y: number): number {
  for (let i = 1; i < pts.length; i++) {
    const [r0, y0] = pts[i - 1] as [number, number];
    const [r1, y1] = pts[i] as [number, number];
    if (y >= y0 && y <= y1) return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0 || 1);
  }
  return 0;
}

/** Nine Arch Bridge's side: a deck wall with a row of round arches opening to the ground */
function archWall(): [number, number][] {
  const top = 0.27;
  const spring = 0.15;
  const r = 0.036;
  const pts: [number, number][] = [[-0.2, top], [0.2, top], [0.2, 0]];
  for (const xc of [0.15, 0.05, -0.05, -0.15]) {
    pts.push([xc + r, 0]);
    for (let k = 0; k <= 6; k++) {
      const a = (k / 6) * Math.PI;
      pts.push([xc + r * Math.cos(a), spring + r * Math.sin(a)]);
    }
    pts.push([xc - r, 0]);
  }
  pts.push([-0.2, 0]);
  return pts;
}

const BERRY: [number, number][] = [[0.001, 0], [0.03, 0.012], [0.075, 0.06], [0.11, 0.13], [0.122, 0.19], [0.11, 0.235], [0.07, 0.262], [0.001, 0.27]];
const BASKET: [number, number][] = [[0.001, 0], [0.075, 0], [0.09, 0.04], [0.125, 0.25], [0.135, 0.27], [0.12, 0.27], [0.11, 0.24], [0.001, 0.24]];

/** The Hill Country's tokens */
export const HILL_TOKENS: Record<string, TokenBuilder> = {
  // Steam locomotive: boiler with a flared chimney and dome, a tall cab at the back, six driving wheels and a cowcatcher
  steamTrain: () => [
    part(new BoxGeometry(0.36, 0.03, 0.13), [0, B + 0.075, 0]),
    part(new CylinderGeometry(0.068, 0.068, 0.24, 14), [0.05, B + 0.155, 0], [0, 0, Math.PI / 2]),
    part(new CylinderGeometry(0.072, 0.072, 0.03, 14), [0.17, B + 0.155, 0], [0, 0, Math.PI / 2]),
    part(lathe([[0.001, 0], [0.024, 0], [0.024, 0.07], [0.042, 0.11], [0.042, 0.125], [0.001, 0.125]], 12), [0.13, B + 0.19, 0]),
    part(new SphereGeometry(0.036, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), [0.04, B + 0.215, 0]),
    part(new BoxGeometry(0.11, 0.2, 0.15), [-0.13, B + 0.19, 0]),
    part(new BoxGeometry(0.14, 0.018, 0.17), [-0.13, B + 0.299, 0]),
    ...[-0.1, 0, 0.1].flatMap((x) =>
      [0.07, -0.07].map((z) => part(new CylinderGeometry(0.048, 0.048, 0.024, 12), [x, B + 0.048, z], [Math.PI / 2, 0, 0])),
    ),
    part(extrude([[0.17, 0.005], [0.225, 0.005], [0.17, 0.08]], 0.12), [0, B, 0]),
  ],
  // Adam's Peak: a steep, craggy cone with a lower shoulder peak and a little shrine on the summit
  adamsPeak: () => [
    part(lathe([[0.001, 0], [0.165, 0], [0.15, 0.03], [0.11, 0.11], [0.072, 0.2], [0.045, 0.28], [0.03, 0.33], [0.001, 0.335]], 9), [0, B, 0]),
    part(new ConeGeometry(0.085, 0.19, 8), [-0.075, B + 0.095, 0.06], [0, 0.3, 0]),
    part(new ConeGeometry(0.07, 0.14, 7), [0.07, B + 0.07, -0.08]),
    part(new BoxGeometry(0.06, 0.04, 0.06), [0, B + 0.35, 0]),
    part(new ConeGeometry(0.052, 0.05, 4), [0, B + 0.395, 0], [0, Math.PI / 4, 0]),
  ],
  // Nine Arch Bridge: a deck wall on a row of round arches, with parapets along the deck
  archBridge: () => [
    part(extrude(archWall(), 0.09), [0, B, 0]),
    part(new BoxGeometry(0.42, 0.02, 0.11), [0, B + 0.28, 0]),
    ...[0.05, -0.05].map((z) => part(new BoxGeometry(0.42, 0.035, 0.012), [0, B + 0.307, z])),
  ],
  // Tea plucker's basket: a tall tapered wicker basket with weave bands, heaped with leaves
  teaBasket: () => [
    part(lathe(BASKET, 14), [0, B, 0]),
    ...[0.08, 0.15, 0.21].map((y) => part(new TorusGeometry(radiusAt(BASKET, y) + 0.002, 0.008, 4, 14), [0, B + y, 0], [Math.PI / 2, 0, 0])),
    part(new TorusGeometry(0.128, 0.012, 5, 14), [0, B + 0.27, 0], [Math.PI / 2, 0, 0]),
    part(new SphereGeometry(0.12, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2), [0, B + 0.255, 0], [0, 0, 0], [1, 0.5, 1]),
    ...[0, 1, 2, 3].map((i) => {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      return part(new SphereGeometry(0.05, 6, 4), [Math.cos(a) * 0.05, B + 0.33, Math.sin(a) * 0.05], [Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6], [0.4, 1, 0.12]);
    }),
    part(new TorusGeometry(0.09, 0.011, 4, 10, Math.PI), [0, B + 0.26, -0.1], [-0.6, 0, 0]),
  ],
  // Nuwara Eliya strawberry: a plump berry tip-down, studded with seeds, under a star of drooping sepals and a stem
  strawberry: () => [
    part(lathe(BERRY, 16), [0, B, 0]),
    ...[0.07, 0.12, 0.17, 0.215].flatMap((y, row) =>
      [0, 1, 2, 3, 4, 5].map((k) => {
        const a = ((k + (row % 2) * 0.5) / 6) * Math.PI * 2;
        const r = radiusAt(BERRY, y);
        return part(new SphereGeometry(0.011, 4, 3), [Math.cos(a) * r, B + y, Math.sin(a) * r]);
      }),
    ),
    ...[0, 1, 2, 3, 4, 5].map((k) => {
      const a = (k / 6) * Math.PI * 2;
      return part(new SphereGeometry(0.05, 6, 4), [Math.cos(a) * 0.065, B + 0.265, Math.sin(a) * 0.065], [0, -a, -0.35], [1, 0.12, 0.38]);
    }),
    part(new CylinderGeometry(0.009, 0.013, 0.07, 6), [0.008, B + 0.3, 0], [0, 0, -0.25]),
  ],
  // Rain umbrella: a ribbed eight-panel canopy with tipped ribs and a finial, on a shaft ending in a crook handle
  umbrella: () => [
    part(lathe([[0.001, 0.43], [0.06, 0.415], [0.12, 0.375], [0.175, 0.31], [0.165, 0.305], [0.115, 0.36], [0.055, 0.395], [0.001, 0.4]], 8), [0, B, 0]),
    part(new CylinderGeometry(0.009, 0.012, 0.05, 6), [0, B + 0.45, 0]),
    ...[0, 1, 2, 3, 4, 5, 6, 7].map((k) => {
      const a = (k / 8) * Math.PI * 2;
      return part(new SphereGeometry(0.012, 5, 4), [Math.cos(a) * 0.175, B + 0.305, Math.sin(a) * 0.175]);
    }),
    part(new CylinderGeometry(0.011, 0.011, 0.36, 8), [0, B + 0.22, 0]),
    part(new TorusGeometry(0.035, 0.013, 6, 10, Math.PI), [0.035, B + 0.048, 0], [0, 0, Math.PI]),
  ],
  // Hill-country leech: a segmented body lying in a curve on its tail sucker, then rearing up with its head bent forward
  leech: () => {
    const path = new CatmullRomCurve3(
      [[-0.13, 0.03, 0.05], [-0.06, 0.03, 0.1], [0.03, 0.03, 0.075], [0.06, 0.05, -0.01], [0.01, 0.14, -0.03], [-0.02, 0.24, -0.01], [0.03, 0.315, 0], [0.11, 0.3, 0]]
        .map(([x, y, z]) => new Vector3(x, y, z)),
    );
    const n = 16;
    const parts: BufferGeometry[] = [];
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const p = path.getPointAt(t);
      const r = 0.036 - 0.016 * t;
      parts.push(part(new SphereGeometry(1, 8, 5), [p.x, B + p.y, p.z], aim(path.getTangentAt(t), new Vector3(1, 0, 0)), [r * 1.6, r, r]));
    }
    parts.push(part(new CylinderGeometry(0.042, 0.048, 0.016, 10), [-0.13, B + 0.008, 0.05]));
    return parts;
  },
  // Sambar deer, side-on: a deep body on four legs, a raised neck and head, ears, a short tail and three-tined antlers
  sambar: () => [
    part(new SphereGeometry(1, 14, 8), [-0.03, B + 0.205, 0], [0, 0, 0], [0.125, 0.068, 0.06]),
    ...[[0.06, 0.035], [0.06, -0.035], [-0.11, 0.035], [-0.11, -0.035]].map(([x, z]) =>
      part(new CylinderGeometry(0.013, 0.017, 0.18, 6), [x as number, B + 0.09, z as number]),
    ),
    part(new CylinderGeometry(0.028, 0.042, 0.14, 8), [0.1, B + 0.27, 0], [0, 0, -0.5]),
    part(new SphereGeometry(1, 10, 6), [0.155, B + 0.33, 0], [0, 0, -0.45], [0.06, 0.032, 0.032]),
    ...[0.03, -0.03].map((z) => part(new ConeGeometry(0.014, 0.045, 5), [0.12, B + 0.36, z * 1.3], [Math.sign(z) * 0.9, 0, 0.6])),
    part(new ConeGeometry(0.018, 0.05, 5), [-0.16, B + 0.235, 0], [0, 0, 2.2]),
    ...[0.022, -0.022].flatMap((z) => {
      const s = Math.sign(z);
      return [
        rod([0.135, 0.355, z], [0.105, 0.45, z + s * 0.03], 0.013),
        rod([0.13, 0.375, z], [0.18, 0.4, z + s * 0.01], 0.011),
        rod([0.105, 0.45, z + s * 0.03], [0.13, 0.49, z + s * 0.035], 0.011),
        rod([0.105, 0.45, z + s * 0.03], [0.07, 0.48, z + s * 0.04], 0.011),
      ];
    }),
  ],
};
