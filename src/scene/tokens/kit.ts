import { BufferGeometry, Euler, ExtrudeGeometry, LatheGeometry, Matrix4, Quaternion, Shape, Vector2, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/*
 * The token modelling kit, shared by every board's tokens (shapes.ts and tokens/sets/*.ts): tokens are built from
 * three.js primitives (no model files), each a few hundred triangles merged into one geometry standing on y = 0 and
 * facing +X, on the common round plinth (its top at B). Modelled about 0.5 tall inside a 0.2 radius, then scaled by
 * TOKEN_SCALE. A builder returns its parts; tokenGeometry() adds the plinth, merges and scales.
 */

export type V3 = [number, number, number];

/** A token's parts, plinth not included */
export type TokenBuilder = () => BufferGeometry[];

/** A primitive placed (position, Euler rotation, scale), non-indexed and without UVs so all parts merge */
export function part(g: BufferGeometry, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]): BufferGeometry {
  const m = new Matrix4().compose(new Vector3(...pos), new Quaternion().setFromEuler(new Euler(...rot)), new Vector3(...scale));
  g.applyMatrix4(m);
  const flat = g.index ? g.toNonIndexed() : g;
  if (flat.getAttribute('uv')) flat.deleteAttribute('uv');
  return flat;
}

export function merge(parts: BufferGeometry[]): BufferGeometry {
  const g = mergeGeometries(parts);
  if (!g) throw new Error('token geometry merge failed');
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** A profile ([radius, height] points) spun around Y */
export const lathe = (pts: [number, number][], segments = 16) =>
  new LatheGeometry(pts.map(([x, y]) => new Vector2(x, y)), segments);

/** An outline in the XY plane extruded along Z and centred on it */
export function extrude(pts: [number, number][], depth: number): BufferGeometry {
  const shape = new Shape(pts.map(([x, y]) => new Vector2(x, y)));
  const g = new ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 4 });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** Tokens are modelled about 0.36 across and drawn this much bigger, so they read from the overview */
export const TOKEN_SCALE = 1.35;

/** Top of the plinth every token stands on (model units, before TOKEN_SCALE) */
export const PLINTH_TOP = 0.055;

/** Where a token's own parts start: the plinth's top */
export const B = PLINTH_TOP;

export const plinth = () =>
  part(lathe([[0, 0], [0.17, 0], [0.18, 0.015], [0.17, 0.04], [0.12, PLINTH_TOP], [0, PLINTH_TOP]], 18));
