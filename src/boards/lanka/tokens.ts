import { BoxGeometry, ConeGeometry, CylinderGeometry, SphereGeometry, TorusGeometry } from 'three';
import { B, extrude, lathe, part, type TokenBuilder } from '../../scene/tokens/kit';

/** All Island's tokens */
export const LANKA_TOKENS: Record<string, TokenBuilder> = {
  // A three-wheeler: open-sided body, a canopy hood wrapping down the back, two rear wheels and one front wheel
  tuktuk: () => [
    part(
      extrude([[-0.19, 0.05], [0.12, 0.05], [0.21, 0.12], [0.2, 0.15], [0.12, 0.17], [-0.19, 0.17]], 0.17),
      [0, B, 0],
    ),
    part(
      extrude(
        [[-0.2, 0.15], [-0.2, 0.29], [-0.14, 0.35], [0.08, 0.35], [0.14, 0.3], [0.14, 0.16], [0.1, 0.16], [0.1, 0.29],
          [0.06, 0.31], [-0.12, 0.31], [-0.16, 0.27], [-0.16, 0.15]],
        0.18,
      ),
      [0, B, 0],
    ),
    ...[0.075, -0.075].map((z) => part(new CylinderGeometry(0.05, 0.05, 0.04, 12), [-0.11, B + 0.05, z], [Math.PI / 2, 0, 0])),
    part(new CylinderGeometry(0.042, 0.042, 0.04, 12), [0.15, B + 0.042, 0], [Math.PI / 2, 0, 0]),
  ],
  // Side-on elephant: barrel body, four legs, head, ears, a trunk curling down and a little tail
  elephant: () => [
    part(new SphereGeometry(0.12, 14, 10), [-0.04, B + 0.2, 0], [0, 0, 0], [1.25, 0.92, 0.85]),
    ...[[0.05, 0.055], [0.05, -0.055], [-0.12, 0.055], [-0.12, -0.055]].map(([x, z]) =>
      part(new CylinderGeometry(0.036, 0.04, 0.13, 10), [x as number, B + 0.065, z as number]),
    ),
    part(new SphereGeometry(0.08, 12, 10), [0.1, B + 0.26, 0]),
    ...[0.075, -0.075].map((z) => part(new SphereGeometry(0.075, 10, 8), [0.065, B + 0.27, z], [0, 0, 0], [0.35, 1, 1])),
    part(new CylinderGeometry(0.018, 0.03, 0.17, 8), [0.165, B + 0.17, 0], [0, 0, 0.25]),
    part(new TorusGeometry(0.025, 0.014, 6, 10, Math.PI), [0.17, B + 0.075, 0], [0, 0, Math.PI]),
    part(new CylinderGeometry(0.008, 0.008, 0.1, 6), [-0.19, B + 0.19, 0], [0, 0, 0.35]),
  ],
  // King coconut (thambili): a tall oval nut with the top cut off and a straw in it
  coconut: () => [
    part(new SphereGeometry(0.135, 16, 12), [0, B + 0.17, 0], [0, 0, 0], [1, 1.2, 1]),
    part(new CylinderGeometry(0.06, 0.09, 0.05, 14), [0, B + 0.33, 0]),
    part(new CylinderGeometry(0.012, 0.012, 0.2, 8), [0.04, B + 0.42, 0], [0, 0, -0.3]),
    part(new ConeGeometry(0.03, 0.05, 8), [0, B + 0.025, 0], [Math.PI, 0, 0]),
  ],
  // A cricket bat standing on its toe, with a ball at its foot
  cricket: () => [
    part(new BoxGeometry(0.09, 0.26, 0.035), [-0.02, B + 0.15, 0]),
    part(new BoxGeometry(0.09, 0.05, 0.05), [-0.02, B + 0.06, 0]),
    part(new CylinderGeometry(0.018, 0.022, 0.15, 10), [-0.02, B + 0.355, 0]),
    part(new SphereGeometry(0.025, 8, 6), [-0.02, B + 0.44, 0]),
    part(new SphereGeometry(0.048, 12, 10), [0.11, B + 0.048, 0.02]),
  ],
  // A cup of Ceylon tea on its saucer
  tea: () => [
    part(new CylinderGeometry(0.155, 0.13, 0.025, 20), [0, B + 0.0125, 0]),
    part(lathe([[0.001, 0], [0.07, 0], [0.095, 0.04], [0.115, 0.17], [0.105, 0.17], [0.085, 0.05], [0.001, 0.05]], 18), [0, B + 0.025, 0]),
    part(new CylinderGeometry(0.103, 0.103, 0.01, 18), [0, B + 0.17, 0]),
    part(new TorusGeometry(0.045, 0.014, 6, 12, Math.PI * 1.3), [0.12, B + 0.115, 0], [0, 0, -Math.PI * 0.65]),
    // Steam
    part(new TorusGeometry(0.03, 0.009, 6, 10, Math.PI), [0, B + 0.24, 0], [0, 0, 0]),
    part(new TorusGeometry(0.03, 0.009, 6, 10, Math.PI), [0.06, B + 0.24, 0], [0, 0, Math.PI]),
  ],
  // A Kandyan drum lying across a low stand, with rims and a lacing band
  drum: () => [
    part(lathe([[0.001, -0.15], [0.085, -0.15], [0.11, -0.08], [0.12, 0], [0.11, 0.08], [0.085, 0.15], [0.001, 0.15]], 18), [0, B + 0.15, 0], [0, 0, Math.PI / 2]),
    ...[-0.15, 0.15].map((x) => part(new TorusGeometry(0.087, 0.014, 6, 18), [x, B + 0.15, 0], [0, Math.PI / 2, 0])),
    part(new TorusGeometry(0.121, 0.01, 6, 20), [0, B + 0.15, 0], [0, Math.PI / 2, 0]),
    part(new BoxGeometry(0.16, 0.04, 0.12), [0, B + 0.02, 0]),
  ],
  // An oruwa: a narrow canoe with a sail and an outrigger float on booms
  oruwa: () => [
    part(extrude([[-0.21, 0.09], [0.21, 0.09], [0.15, 0.03], [-0.15, 0.03]], 0.07), [0, B - 0.01, -0.03]),
    part(new CylinderGeometry(0.02, 0.02, 0.26, 8), [0, B + 0.03, 0.12], [0, 0, Math.PI / 2]),
    ...[-0.08, 0.08].map((x) => part(new CylinderGeometry(0.008, 0.008, 0.17, 6), [x, B + 0.08, 0.045], [Math.PI / 2, 0, 0])),
    part(new CylinderGeometry(0.009, 0.009, 0.34, 6), [0, B + 0.25, -0.03]),
    part(extrude([[0.015, 0.1], [0.015, 0.42], [0.16, 0.12]], 0.012), [0, B, -0.03]),
  ],
  // A New Year kite: a diamond on a pole, with a ribbon tail of bows
  kite: () => [
    part(new CylinderGeometry(0.012, 0.016, 0.26, 8), [0, B + 0.13, 0]),
    part(extrude([[0, 0], [0.12, 0.14], [0, 0.3], [-0.12, 0.14]], 0.02), [0, B + 0.17, 0]),
    part(new BoxGeometry(0.008, 0.29, 0.03), [0, B + 0.315, 0]),
    part(new BoxGeometry(0.23, 0.008, 0.03), [0, B + 0.31, 0]),
    ...[0, 1, 2].map((i) => part(new ConeGeometry(0.025, 0.04, 4), [-0.05 - i * 0.04, B + 0.16 - i * 0.035, 0], [0, 0, Math.PI / 2])),
  ],
};
