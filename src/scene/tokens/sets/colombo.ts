import { BoxGeometry, ConeGeometry, CylinderGeometry, SphereGeometry, TorusGeometry } from 'three';
import { B, extrude, lathe, part, type TokenBuilder } from '../kit';

/** Radius of the traffic cone's body at height y (above its base slab) */
const coneR = (y: number) => 0.1 - (0.075 * (y - 0.012)) / 0.378;

/** colombo's tokens (ids in src/shared/tokens.ts) */
export const COLOMBO_TOKENS: Record<string, TokenBuilder> = {
  // Colombo's red city bus: a long box body, an inset window band split by pillars, a roof, bumper and four wheels
  cityBus: () => [
    part(extrude([[-0.19, 0.035], [0.19, 0.035], [0.205, 0.05], [0.205, 0.17], [-0.19, 0.17]], 0.16), [0, B, 0]),
    part(new BoxGeometry(0.37, 0.09, 0.14), [0, B + 0.215, 0]),
    ...[-0.18, -0.1, -0.02, 0.06, 0.13].map((x) => part(new BoxGeometry(0.016, 0.09, 0.162), [x, B + 0.215, 0])),
    ...[0.075, -0.075].map((z) => part(new BoxGeometry(0.022, 0.09, 0.014), [0.192, B + 0.215, z])),
    part(new BoxGeometry(0.4, 0.03, 0.17), [0.005, B + 0.275, 0]),
    part(new BoxGeometry(0.018, 0.028, 0.165), [0.212, B + 0.06, 0]),
    ...[[0.12, 0.072], [0.12, -0.072], [-0.12, 0.072], [-0.12, -0.072]].map(([x, z]) =>
      part(new CylinderGeometry(0.046, 0.046, 0.035, 12), [x as number, B + 0.046, z as number], [Math.PI / 2, 0, 0]),
    ),
  ],
  // The Lotus Tower: a flared base, a slim tapering shaft, a bulging bud pod ringed by six petals and a mast on top
  lotusTower: () => [
    part(lathe([[0.001, 0], [0.1, 0], [0.09, 0.02], [0.05, 0.045], [0.034, 0.12], [0.026, 0.26], [0.001, 0.26]], 10), [0, B, 0]),
    part(lathe([[0.001, 0], [0.025, 0], [0.07, 0.035], [0.08, 0.07], [0.06, 0.11], [0.018, 0.135], [0.001, 0.135]], 12), [0, B + 0.24, 0]),
    ...[0, 1, 2, 3, 4, 5].map((i) => {
      const a = (i / 6) * Math.PI * 2;
      return part(new SphereGeometry(0.06, 8, 6), [0.058 * Math.cos(a), B + 0.31, -0.058 * Math.sin(a)], [0, a, -0.3], [0.35, 1.25, 0.75]);
    }),
    part(new CylinderGeometry(0.005, 0.014, 0.1, 6), [0, B + 0.42, 0]),
  ],
  // The old lighthouse clock tower: a square shaft on a plinth, a clock face on every side, a cornice, lantern and dome
  clockTower: () => [
    part(new BoxGeometry(0.2, 0.05, 0.2), [0, B + 0.025, 0]),
    part(new BoxGeometry(0.13, 0.25, 0.13), [0, B + 0.175, 0]),
    part(new BoxGeometry(0.15, 0.015, 0.15), [0, B + 0.13, 0]),
    part(new BoxGeometry(0.165, 0.022, 0.165), [0, B + 0.311, 0]),
    ...[0, 1, 2, 3].flatMap((i) => {
      const a = (i / 4) * Math.PI * 2;
      const [x, z] = [0.072 * Math.cos(a), -0.072 * Math.sin(a)];
      return [
        part(new CylinderGeometry(0.042, 0.042, 0.01, 14), [x, B + 0.245, z], [0, a, Math.PI / 2]),
        part(new TorusGeometry(0.042, 0.008, 4, 14), [x * 1.04, B + 0.245, z * 1.04], [0, a + Math.PI / 2, 0]),
      ];
    }),
    part(new CylinderGeometry(0.05, 0.05, 0.065, 10), [0, B + 0.355, 0]),
    part(new CylinderGeometry(0.068, 0.068, 0.012, 12), [0, B + 0.39, 0]),
    part(new SphereGeometry(0.055, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), [0, B + 0.396, 0]),
    part(new ConeGeometry(0.012, 0.05, 6), [0, B + 0.47, 0]),
  ],
  // A Colombo crow standing side-on: tilted body, folded wings, round head, a heavy beak along +X, a long tail, legs
  crow: () => [
    part(new SphereGeometry(0.1, 12, 8), [-0.01, B + 0.19, 0], [0, 0, 0.35], [1.35, 0.85, 0.75]),
    ...[0.058, -0.058].map((z) => part(new SphereGeometry(0.09, 10, 6), [-0.035, B + 0.2, z], [0, 0, 0.3], [1.3, 0.6, 0.25])),
    part(new SphereGeometry(0.058, 12, 8), [0.1, B + 0.29, 0]),
    part(new ConeGeometry(0.026, 0.09, 8), [0.185, B + 0.282, 0], [0, 0, -Math.PI / 2 - 0.12], [1, 1, 0.75]),
    part(extrude([[-0.08, 0.15], [-0.215, 0.085], [-0.225, 0.12], [-0.1, 0.2]], 0.06), [0, B, 0]),
    ...[0.03, -0.03].flatMap((z) => [
      part(new CylinderGeometry(0.009, 0.009, 0.115, 6), [0.005, B + 0.058, z]),
      part(new BoxGeometry(0.06, 0.01, 0.016), [0.02, B + 0.005, z]),
    ]),
  ],
  // An appa (hopper): a deep bowl-shaped pancake with a crisp lacy rim and an egg set in its soft middle
  hopper: () => [
    part(
      lathe(
        [[0.001, 0], [0.05, 0], [0.1, 0.03], [0.145, 0.09], [0.17, 0.16], [0.178, 0.2], [0.166, 0.2], [0.155, 0.16],
          [0.132, 0.1], [0.09, 0.055], [0.001, 0.045]],
        16,
      ),
      [0, B, 0],
    ),
    part(new TorusGeometry(0.172, 0.013, 5, 18), [0, B + 0.2, 0], [Math.PI / 2, 0, 0]),
    part(new SphereGeometry(0.08, 12, 6), [0, B + 0.047, 0], [0, 0, 0], [1, 0.22, 1]),
    part(new SphereGeometry(0.036, 10, 8), [0, B + 0.062, 0], [0, 0, 0], [1, 0.75, 1]),
  ],
  // An isso (prawn) curled side-on into a C: segmented body tapering to a fanned tail, a spiked head and long feelers
  isso: () => [
    ...[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => {
      const t = i / 8;
      const a = ((60 + t * 235) * Math.PI) / 180;
      return part(new SphereGeometry(0.058 - 0.028 * t, 8, 6), [0.11 * Math.cos(a), B + 0.18 + 0.11 * Math.sin(a), 0], [0, 0, a], [1, 1, 0.75]);
    }),
    part(new SphereGeometry(0.058, 10, 7), [0.085, B + 0.28, 0], [0, 0, -0.15], [1.5, 0.85, 0.75]),
    part(new ConeGeometry(0.012, 0.075, 6), [0.18, B + 0.265, 0], [0, 0, -Math.PI / 2 - 0.15]),
    part(extrude([[0, 0], [0.1, -0.06], [0.125, -0.02], [0.105, 0], [0.125, 0.02], [0.1, 0.06]], 0.014), [0.04, B + 0.05, 0], [Math.PI / 2, 0, 0]),
    ...[[0.13, 0.025], [0.115, -0.025]].map(([r, z]) =>
      part(new TorusGeometry(r as number, 0.006, 4, 10, Math.PI * 0.8), [0.06, B + 0.27, z as number]),
    ),
    ...[0.045, 0.075].flatMap((x) =>
      [0.02, -0.02].map((z) => part(new CylinderGeometry(0.006, 0.006, 0.06, 4), [x, B + 0.2, z], [0, 0, 0.35]))),
  ],
  // An office briefcase standing on its edge: the case, a lid seam, two clasps on each face, corner caps and a handle
  briefcase: () => [
    part(new BoxGeometry(0.34, 0.25, 0.1), [0, B + 0.125, 0]),
    part(new BoxGeometry(0.35, 0.014, 0.11), [0, B + 0.18, 0]),
    ...[0.09, -0.09].flatMap((x) => [0.056, -0.056].map((z) => part(new BoxGeometry(0.04, 0.045, 0.014), [x, B + 0.18, z]))),
    ...[0.155, -0.155].flatMap((x) => [0.018, 0.232].map((y) => part(new BoxGeometry(0.036, 0.036, 0.108), [x, B + y, 0]))),
    ...[0.05, -0.05].map((x) => part(new BoxGeometry(0.028, 0.02, 0.034), [x, B + 0.258, 0])),
    part(new TorusGeometry(0.05, 0.013, 6, 10, Math.PI), [0, B + 0.262, 0]),
  ],
  // A traffic cone on its square base, with two raised reflective stripe bands
  trafficCone: () => [
    part(new BoxGeometry(0.25, 0.03, 0.25), [0, B + 0.015, 0]),
    part(lathe([[0.001, 0], [0.1, 0], [0.1, 0.012], [0.025, 0.39], [0.016, 0.4], [0.001, 0.4]], 16), [0, B + 0.03, 0]),
    ...[[0.12, 0.18], [0.25, 0.3]].map(([y0, y1]) =>
      part(
        new CylinderGeometry(coneR(y1 as number) + 0.008, coneR(y0 as number) + 0.008, (y1 as number) - (y0 as number), 16),
        [0, B + 0.03 + ((y0 as number) + (y1 as number)) / 2, 0],
      ),
    ),
  ],
};
