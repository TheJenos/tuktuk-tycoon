import {
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  LatheGeometry,
  Matrix4,
  Euler,
  Quaternion,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { TokenId } from '../../shared/tokens';

/*
 * The eight pewter tokens, built from primitives (no model files): each a few hundred triangles merged into one
 * geometry standing on y = 0, facing +X (the racecar's nose, the boat's bow), on the common round plinth. Modelled
 * about 0.5 tall inside a 0.2 radius, then scaled by TOKEN_SCALE. The seat-colour ring around the plinth is a
 * separate mesh (ringGeometry).
 */

type V3 = [number, number, number];

function part(g: BufferGeometry, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]): BufferGeometry {
  const m = new Matrix4().compose(new Vector3(...pos), new Quaternion().setFromEuler(new Euler(...rot)), new Vector3(...scale));
  g.applyMatrix4(m);
  const flat = g.index ? g.toNonIndexed() : g;
  if (flat.getAttribute('uv')) flat.deleteAttribute('uv');
  return flat;
}

function merge(parts: BufferGeometry[]): BufferGeometry {
  const g = mergeGeometries(parts);
  if (!g) throw new Error('token geometry merge failed');
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

const lathe = (pts: [number, number][], segments = 16) =>
  new LatheGeometry(pts.map(([x, y]) => new Vector2(x, y)), segments);

/** An outline in the XY plane extruded along Z and centred on it */
function extrude(pts: [number, number][], depth: number): BufferGeometry {
  const shape = new Shape(pts.map(([x, y]) => new Vector2(x, y)));
  const g = new ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 4 });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** Tokens are modelled about 0.36 across and drawn this much bigger, so they read from the overview */
export const TOKEN_SCALE = 1.35;

/** Top of the plinth every token stands on (model units, before TOKEN_SCALE) */
export const PLINTH_TOP = 0.055;

const plinth = () =>
  part(lathe([[0, 0], [0.17, 0], [0.18, 0.015], [0.17, 0.04], [0.12, PLINTH_TOP], [0, PLINTH_TOP]], 18));

const B = PLINTH_TOP;

const BUILDERS: Record<TokenId, () => BufferGeometry[]> = {
  hat: () => [
    part(new CylinderGeometry(0.155, 0.16, 0.022, 18), [0, B + 0.011, 0]),
    part(new CylinderGeometry(0.105, 0.095, 0.27, 16), [0, B + 0.155, 0]),
    part(new CylinderGeometry(0.1, 0.1, 0.045, 16), [0, B + 0.05, 0]),
  ],
  car: () => [
    part(
      extrude(
        [[-0.21, 0.05], [0.18, 0.05], [0.22, 0.075], [0.08, 0.1], [0.03, 0.16], [-0.07, 0.16], [-0.11, 0.11], [-0.18, 0.11], [-0.2, 0.15], [-0.23, 0.15], [-0.22, 0.05]],
        0.13,
      ),
      [0, B, 0],
    ),
    ...[[0.12, 0.08], [0.12, -0.08], [-0.13, 0.08], [-0.13, -0.08]].map(([x, z]) =>
      part(new CylinderGeometry(0.048, 0.048, 0.04, 12), [x as number, B + 0.048, z as number], [Math.PI / 2, 0, 0]),
    ),
  ],
  boat: () => [
    part(extrude([[-0.17, 0.12], [0.21, 0.12], [0.12, 0.05], [-0.13, 0.05]], 0.13), [0, B - 0.03, 0]),
    part(new CylinderGeometry(0.009, 0.009, 0.36, 6), [0, B + 0.27, 0]),
    part(extrude([[0.015, 0.12], [0.015, 0.44], [0.16, 0.12]], 0.012), [0, B, 0]),
    part(extrude([[-0.015, 0.4], [-0.015, 0.12], [-0.13, 0.12]], 0.012), [0, B, 0]),
  ],
  rocket: () => [
    part(lathe([[0.001, 0], [0.04, 0], [0.07, 0.05], [0.075, 0.2], [0.065, 0.29], [0.04, 0.35], [0.012, 0.39], [0.001, 0.4]], 16), [0, B + 0.04, 0]),
    part(new CylinderGeometry(0.035, 0.05, 0.05, 12), [0, B + 0.025, 0]),
    ...[0, 1, 2].map((i) => part(extrude([[0.05, 0], [0.15, -0.0], [0.07, 0.13]], 0.012), [0, B + 0.01, 0], [0, (i * Math.PI * 2) / 3, 0])),
  ],
  crown: () => [
    part(lathe([[0.12, 0], [0.135, 0], [0.13, 0.09], [0.118, 0.09], [0.106, 0.01]], 20), [0, B, 0]),
    part(new SphereGeometry(0.11, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2), [0, B + 0.07, 0], [0, 0, 0], [1, 0.75, 1]),
    ...[0, 1, 2, 3, 4].flatMap((i) => {
      const a = (i * Math.PI * 2) / 5;
      const x = Math.cos(a) * 0.125;
      const z = Math.sin(a) * 0.125;
      return [
        part(new ConeGeometry(0.035, 0.11, 6), [x, B + 0.14, z]),
        part(new SphereGeometry(0.02, 8, 6), [x, B + 0.2, z]),
      ];
    }),
    part(new SphereGeometry(0.03, 10, 8), [0, B + 0.16, 0]),
  ],
  anchor: () => [
    part(new CylinderGeometry(0.019, 0.019, 0.32, 8), [0, B + 0.2, 0]),
    part(new TorusGeometry(0.04, 0.013, 6, 14), [0, B + 0.4, 0]),
    part(new CylinderGeometry(0.014, 0.014, 0.2, 6), [0, B + 0.33, 0], [0, 0, Math.PI / 2]),
    // The arms: the lower half of a ring, ending in flukes
    part(new TorusGeometry(0.12, 0.019, 6, 14, Math.PI), [0, B + 0.17, 0], [0, 0, Math.PI]),
    part(new ConeGeometry(0.035, 0.07, 6), [0.12, B + 0.19, 0], [0, 0, -0.5]),
    part(new ConeGeometry(0.035, 0.07, 6), [-0.12, B + 0.19, 0], [0, 0, 0.5]),
    part(new CylinderGeometry(0.035, 0.05, 0.03, 10), [0, B + 0.03, 0]),
  ],
  teapot: () => [
    part(new SphereGeometry(0.12, 16, 10), [0, B + 0.12, 0], [0, 0, 0], [1, 0.82, 1]),
    part(new CylinderGeometry(0.07, 0.08, 0.03, 14), [0, B + 0.015, 0]),
    part(new CylinderGeometry(0.06, 0.075, 0.03, 14), [0, B + 0.225, 0]),
    part(new SphereGeometry(0.025, 8, 6), [0, B + 0.255, 0]),
    part(new CylinderGeometry(0.014, 0.026, 0.15, 8), [0.15, B + 0.15, 0], [0, 0, -0.85]),
    part(new TorusGeometry(0.055, 0.015, 6, 12, Math.PI * 1.2), [-0.12, B + 0.13, 0], [0, 0, Math.PI * 0.4]),
  ],
  knight: () => [
    part(lathe([[0.001, 0], [0.13, 0], [0.13, 0.03], [0.1, 0.045], [0.08, 0.085], [0.001, 0.085]], 16), [0, B, 0]),
    part(
      extrude(
        [[-0.08, 0.08], [0.06, 0.08], [0.05, 0.17], [0.12, 0.22], [0.13, 0.27], [0.05, 0.36], [0.01, 0.42], [-0.03, 0.39], [-0.08, 0.3], [-0.095, 0.18]],
        0.1,
      ),
      [0, B, 0],
    ),
  ],
};

let ring: BufferGeometry | null = null;
/** The seat-colour ring around a token's plinth */
export function ringGeometry(): BufferGeometry {
  ring ??= new TorusGeometry(0.176, 0.026, 8, 32)
    .rotateX(Math.PI / 2)
    .translate(0, 0.024, 0)
    .scale(TOKEN_SCALE, TOKEN_SCALE, TOKEN_SCALE);
  return ring;
}

const cache = new Map<TokenId, BufferGeometry>();

/** The token's geometry (plinth included), built once and shared */
export function tokenGeometry(id: TokenId): BufferGeometry {
  let g = cache.get(id);
  if (!g) {
    g = merge([plinth(), ...BUILDERS[id]()]);
    g.scale(TOKEN_SCALE, TOKEN_SCALE, TOKEN_SCALE);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    cache.set(id, g);
  }
  return g;
}
