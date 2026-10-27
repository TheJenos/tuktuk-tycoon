import {
  BoxGeometry,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  LatheGeometry,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
} from 'three';
import { B, extrude, lathe, part, type TokenBuilder, type V3 } from '../../scene/tokens/kit';

/** A rod of radius r from a to b (a cylinder turned to lie along a -> b) */
function stick(a: V3, b: V3, r: number, segments = 6, r2 = r): BufferGeometry {
  const from = new Vector3(...a);
  const d = new Vector3(...b).sub(from);
  const len = d.length();
  const e = new Euler().setFromQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), d.normalize()));
  const mid = from.addScaledVector(d, len / 2);
  return part(new CylinderGeometry(r2, r, len, segments), [mid.x, mid.y, mid.z], [e.x, e.y, e.z]);
}

/** A palm frond segment: a flat leaf-shaped ellipsoid, tilted up (+) or down (-), turned to `yaw` around `at` */
const frond = (len: number, wide: number, out: number, dy: number, tilt: number, yaw: number, at: V3) =>
  part(new SphereGeometry(1, 6, 4).scale(len, 0.012, wide).rotateZ(tilt).translate(out, dy, 0).rotateY(yaw).translate(...at));

/** Down South's tokens (ids in src/shared/tokens.ts) */
export const SOUTH_TOKENS: Record<string, TokenBuilder> = {
  // A stilt fisherman: a figure sat on the crossbar of a tall pole over a splash of sea, rod held out with its line
  stiltFisher: () => [
    part(lathe([[0.001, 0], [0.08, 0], [0.05, 0.02], [0.03, 0.035], [0.001, 0.035]], 12), [-0.02, B, 0]),
    stick([-0.02, B, 0], [-0.02, B + 0.41, 0], 0.012, 8, 0.009),
    stick([-0.02, B + 0.265, -0.065], [-0.02, B + 0.265, 0.065], 0.009, 6),
    // Body leaning forward, head and wrapped turban
    part(new CylinderGeometry(0.025, 0.032, 0.09, 10), [0.008, B + 0.32, 0], [0, 0, -0.15]),
    part(new SphereGeometry(0.028, 10, 8), [0.02, B + 0.386, 0]),
    part(new CylinderGeometry(0.03, 0.033, 0.02, 10), [0.018, B + 0.41, 0]),
    // Thighs forward along the bar, shins hanging down
    ...[0.02, -0.02].flatMap((z) => [
      stick([0.0, B + 0.28, z], [0.06, B + 0.285, z * 1.1], 0.013, 6),
      stick([0.06, B + 0.285, z * 1.1], [0.055, B + 0.2, z], 0.011, 6),
    ]),
    // Arms reaching to the rod, the rod out over the water and the line hanging from its tip
    ...[0.03, -0.03].map((z) => stick([0.012, B + 0.35, z], [0.07, B + 0.325, z * 0.3], 0.009, 6)),
    stick([0.035, B + 0.3, 0], [0.205, B + 0.46, 0], 0.006, 6),
    stick([0.205, B + 0.46, 0], [0.205, B + 0.17, 0], 0.003, 4),
    part(new SphereGeometry(0.012, 6, 4), [0.205, B + 0.165, 0]),
  ],
  // A sea turtle from the side: high domed shell on a rim, big swept-back front flippers, small rear ones, head forward
  seaTurtle: () => [
    part(new SphereGeometry(0.13, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), [-0.015, B + 0.05, 0], [0, 0, 0], [1.2, 1.05, 1]),
    part(new TorusGeometry(0.13, 0.016, 6, 18), [-0.015, B + 0.05, 0], [Math.PI / 2, 0, 0], [1.2, 1, 1]),
    part(new CylinderGeometry(0.128, 0.11, 0.04, 16), [-0.015, B + 0.03, 0], [0, 0, 0], [1.2, 1, 1]),
    // A ring of scutes round the top
    part(new TorusGeometry(0.085, 0.01, 4, 16), [-0.015, B + 0.145, 0], [Math.PI / 2, 0, 0], [1.2, 1, 1]),
    // Neck and head, raised and forward
    stick([0.12, B + 0.06, 0], [0.165, B + 0.085, 0], 0.03, 8, 0.026),
    part(new SphereGeometry(0.046, 10, 8), [0.18, B + 0.1, 0], [0, 0, -0.2], [1.3, 0.9, 0.9]),
    // Front flippers sweeping out and back, rear flippers
    ...[1, -1].flatMap((s) => [
      part(
        extrude([[0.1, 0.06 * s], [0.13, 0.1 * s], [0.09, 0.19 * s], [0.0, 0.235 * s], [0.03, 0.18 * s], [0.04, 0.1 * s]], 0.014),
        [0, B + 0.03, 0],
        [Math.PI / 2, 0, 0],
      ),
      part(
        extrude([[-0.1, 0.06 * s], [-0.11, 0.15 * s], [-0.19, 0.17 * s], [-0.16, 0.08 * s]], 0.012),
        [0, B + 0.025, 0],
        [Math.PI / 2, 0, 0],
      ),
    ]),
    part(new ConeGeometry(0.02, 0.06, 6), [-0.175, B + 0.035, 0], [0, 0, Math.PI / 2]),
  ],
  // A surfboard standing on its tail in a heap of sand: pointed nose, a raised stringer down both faces, a tail fin
  surfboard: () => {
    const n = 12;
    const side: [number, number][] = [];
    for (let i = 0; i <= n; i++) {
      const s = i / n;
      side.push([(1 - s) ** 0.6 * (0.03 + 0.12 * s), 0.03 + s * 0.43]);
    }
    const outline: [number, number][] = [...side, ...side.slice(0, n).reverse().map(([x, y]): [number, number] => [-x, y])];
    return [
      part(lathe([[0.001, 0], [0.11, 0], [0.07, 0.025], [0.03, 0.045], [0.001, 0.05]], 14), [0, B, 0]),
      part(extrude(outline, 0.024), [0, B, 0]),
      part(new BoxGeometry(0.007, 0.4, 0.032), [0, B + 0.24, 0]),
      // Tail fin standing off the back face
      part(extrude([[0, 0.04], [0, 0.16], [0.03, 0.15], [0.085, 0.07], [0.08, 0.04]], 0.01), [0, B, -0.012], [0, Math.PI / 2, 0]),
    ];
  },
  // Galle lighthouse: a white tower tapering up from a stepped base, a balcony with a rail, the lantern room and a domed cap
  lighthouse: () => [
    part(new CylinderGeometry(0.12, 0.13, 0.04, 8), [0, B + 0.02, 0]),
    part(lathe([[0.001, 0], [0.1, 0], [0.095, 0.03], [0.07, 0.27], [0.001, 0.27]], 14), [0, B + 0.04, 0]),
    part(new TorusGeometry(0.086, 0.01, 4, 14), [0, B + 0.14, 0], [Math.PI / 2, 0, 0]),
    // A door and windows set into the tower's face
    part(new BoxGeometry(0.03, 0.05, 0.035), [0.093, B + 0.065, 0]),
    ...[0.17, 0.25].map((y) => part(new BoxGeometry(0.02, 0.03, 0.025), [0.1 - y * 0.11, B + y, 0])),
    // Balcony and rail
    part(new CylinderGeometry(0.095, 0.075, 0.025, 14), [0, B + 0.32, 0]),
    part(new TorusGeometry(0.09, 0.007, 4, 16), [0, B + 0.36, 0], [Math.PI / 2, 0, 0]),
    ...[0, 1, 2, 3, 4, 5].map((i) =>
      part(new CylinderGeometry(0.005, 0.005, 0.03, 4), [0.09 * Math.cos(i * Math.PI / 3), B + 0.345, 0.09 * Math.sin(i * Math.PI / 3)]),
    ),
    // Lantern room, its dome and the finial
    part(new CylinderGeometry(0.048, 0.048, 0.07, 10), [0, B + 0.367, 0]),
    part(new SphereGeometry(0.058, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2), [0, B + 0.4, 0]),
    part(new ConeGeometry(0.012, 0.05, 6), [0, B + 0.475, 0]),
  ],
  // A coconut palm: a ringed trunk curving up and forward, a crown of arching fronds and a cluster of nuts
  palmTree: () => {
    const pts: [number, number][] = [[-0.08, 0], [-0.075, 0.1], [-0.055, 0.195], [-0.02, 0.29], [0.03, 0.37]];
    const crown: V3 = [0.03, B + 0.37, 0];
    return [
      part(new CylinderGeometry(0.05, 0.06, 0.02, 10), [-0.08, B + 0.01, 0]),
      ...pts.slice(1).map(([x, y], i) => {
        const [px, py] = pts[i] as [number, number];
        return stick([px, B + py, 0], [x, B + y + 0.01, 0], 0.04 - i * 0.004, 8, 0.028 - i * 0.003);
      }),
      part(new SphereGeometry(0.032, 8, 6), crown),
      ...[0, 1, 2, 3, 4, 5, 6].flatMap((k) => {
        const yaw = (k / 7) * Math.PI * 2 + 0.3;
        return [frond(0.06, 0.028, 0.055, 0.012, 0.3, yaw, crown), frond(0.065, 0.024, 0.128, -0.005, -0.5, yaw, crown)];
      }),
      ...[[0.03, 0.025], [0.055, -0.015], [0.005, -0.02]].map(([x, z]) =>
        part(new SphereGeometry(0.022, 7, 5), [x as number, B + 0.335, z as number]),
      ),
    ];
  },
  // An Ambalangoda devil mask facing +X: an oval face with bulging eyes, a grinning mouth with fangs and a tongue, ears,
  // and a crown of cobra hoods fanned round the top
  devilMask: () => {
    const c = B + 0.16;
    return [
      part(new BoxGeometry(0.06, 0.03, 0.12), [-0.03, B + 0.015, 0]),
      part(new SphereGeometry(0.13, 12, 8), [-0.02, c, 0], [0, 0, 0], [0.32, 1.1, 0.85]),
      // Brow, bulging eyes with pupils, nose
      part(new BoxGeometry(0.03, 0.022, 0.15), [0.018, c + 0.075, 0]),
      ...[0.048, -0.048].flatMap((z) => [
        part(new SphereGeometry(0.034, 8, 6), [0.025, c + 0.04, z]),
        part(new SphereGeometry(0.014, 6, 4), [0.057, c + 0.04, z]),
      ]),
      part(new ConeGeometry(0.022, 0.05, 6), [0.04, c - 0.005, 0], [0, 0, -Math.PI / 2]),
      // Grin, fangs (two down, two tusks up at the corners) and a lolling tongue
      part(new TorusGeometry(0.05, 0.011, 5, 10, Math.PI), [0.022, c - 0.04, 0], [0, Math.PI / 2, Math.PI]),
      ...[0.022, -0.022].map((z) => part(new ConeGeometry(0.011, 0.04, 6), [0.04, c - 0.07, z], [Math.PI, 0, 0])),
      ...[0.052, -0.052].map((z) => part(new ConeGeometry(0.012, 0.05, 6), [0.032, c - 0.065, z], [0, 0, 0])),
      part(new SphereGeometry(0.04, 8, 6), [0.034, c - 0.105, 0], [0, 0, -0.3], [0.35, 1, 0.65]),
      // Ears
      ...[1, -1].map((s) => part(new SphereGeometry(0.05, 8, 6), [-0.025, c + 0.01, 0.12 * s], [0.4 * s, 0, 0], [0.3, 1, 0.45])),
      // Crown of five cobra hoods
      ...[-0.95, -0.48, 0, 0.48, 0.95].map((t) =>
        part(new SphereGeometry(0.045, 7, 5), [-0.03, c + 0.15 * Math.cos(t), 0.15 * Math.sin(t)], [t, 0, 0], [0.35, 1.25, 0.8]),
      ),
    ];
  },
  // A beach crab: a wide flat shell on bent legs, two big claws raised high, eyes on stalks
  crab: () => [
    part(new SphereGeometry(0.1, 14, 8), [0, B + 0.075, 0], [0, 0, 0], [0.85, 0.5, 1.25]),
    // Eyes on stalks
    ...[0.03, -0.03].flatMap((z) => [
      stick([0.06, B + 0.1, z], [0.075, B + 0.155, z * 1.2], 0.006, 5),
      part(new SphereGeometry(0.015, 6, 5), [0.076, B + 0.16, z * 1.2]),
    ]),
    // Three bent legs a side
    ...[1, -1].flatMap((s) =>
      [[0.03, 0.06], [-0.02, -0.03], [-0.065, -0.13]].flatMap(([x, f]) => [
        stick([x as number, B + 0.07, 0.1 * s], [(x as number) * 1.4, B + 0.12, 0.165 * s], 0.011, 5),
        stick([(x as number) * 1.4, B + 0.12, 0.165 * s], [f as number, B + 0.004, 0.205 * s], 0.009, 5, 0.005),
      ]),
    ),
    // Raised arms and pincers: a swollen palm with a fixed and a moving finger, open
    ...[1, -1].flatMap((s) => [
      stick([0.04, B + 0.09, 0.08 * s], [0.08, B + 0.19, 0.12 * s], 0.017, 6),
      part(new SphereGeometry(0.048, 10, 6), [0.09, B + 0.235, 0.125 * s], [0, 0, -0.25], [0.85, 1.2, 0.7]),
      part(new ConeGeometry(0.022, 0.08, 6), [0.11, B + 0.31, 0.11 * s], [0.3 * s, 0, -0.3]),
      part(new ConeGeometry(0.018, 0.065, 6), [0.075, B + 0.3, 0.15 * s], [-0.4 * s, 0, 0.1]),
    ]),
  ],
  // A conch shell standing on its point: a whorled spire, knobs round the shoulder and a flared lip wrapping the front
  conch: () => [
    part(lathe([[0.001, 0], [0.025, 0], [0.06, 0.07], [0.105, 0.17], [0.115, 0.2], [0.09, 0.235], [0.001, 0.24]], 14), [0, B, 0]),
    // Spire whorls, each smaller and offset a little, and the tip
    part(new TorusGeometry(0.068, 0.024, 6, 14), [0.004, B + 0.24, 0], [Math.PI / 2 + 0.08, 0, 0]),
    part(new TorusGeometry(0.045, 0.019, 6, 12), [-0.004, B + 0.282, 0.003], [Math.PI / 2 - 0.08, 0, 0]),
    part(new TorusGeometry(0.025, 0.014, 6, 10), [0.002, B + 0.315, -0.002], [Math.PI / 2 + 0.08, 0, 0]),
    part(new ConeGeometry(0.02, 0.06, 8), [0, B + 0.355, 0]),
    // Knobs round the shoulder
    ...[0, 1, 2, 3, 4, 5, 6].map((i) => {
      const a = (i / 7) * Math.PI * 2 + 0.6;
      return part(new ConeGeometry(0.018, 0.05, 6), [0.112 * Math.cos(a), B + 0.215, 0.112 * Math.sin(a)], [Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9]);
    }),
    // The flared lip: a thick curved wing round the front, rising past the shoulder
    part(
      new LatheGeometry(
        ([[0.035, 0.015], [0.1, 0.07], [0.16, 0.17], [0.175, 0.24], [0.16, 0.3], [0.145, 0.29], [0.155, 0.24], [0.14, 0.18], [0.085, 0.09], [0.025, 0.035]] as [number, number][])
          .map(([x, y]) => new Vector2(x, y)),
        10,
        Math.PI / 2 - 1.1,
        2.2,
      ),
      [0, B, 0],
    ),
  ],
};
