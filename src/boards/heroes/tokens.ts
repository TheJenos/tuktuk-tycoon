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
  TubeGeometry,
  Vector3,
} from 'three';
import { B, extrude, lathe, part, type TokenBuilder, type V3 } from '../../scene/tokens/kit';

type V4 = [number, number, number, number];

/** A rod of radius r from a to b (a cylinder turned to lie along a -> b) */
function stick(a: V3, b: V3, r: number, segments = 6): BufferGeometry {
  const from = new Vector3(...a);
  const d = new Vector3(...b).sub(from);
  const len = d.length();
  const e = new Euler().setFromQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), d.normalize()));
  const mid = from.addScaledVector(d, len / 2);
  return part(new CylinderGeometry(r, r, len, segments), [mid.x, mid.y, mid.z], [e.x, e.y, e.z]);
}

/** A five-point star outline (point up) in the XY plane */
function starOutline(cx: number, cy: number, outer: number, inner: number): [number, number][] {
  return Array.from({ length: 10 }, (_, k): [number, number] => {
    const a = Math.PI / 2 + (k * Math.PI) / 5;
    const r = k % 2 ? inner : outer;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
}

/** Parts modelled facing +X turned to face -Z: out of the board, towards the players (the side the camera sees) */
const outward = (parts: BufferGeometry[]) => parts.map((g) => g.rotateY(Math.PI / 2));

/** Steel Ace's jet climbs towards +X at this angle from the vertical (35 degrees above level) */
const CLIMB = 0.96;
/** A part of the jet modelled along +Y (nose up, its top side towards -X, centred on its middle), turned to climb */
const climbing = (g: BufferGeometry, at: V3) => part(g.rotateZ(-CLIMB), at);

/**
 * Hero League's tokens (ids = the heroes' ids, src/boards/heroes/theme.ts). Like every token they travel facing +X; a
 * token's -Z side faces out of the board, so the fist and the flat crest, bolt and target show their faces that way.
 */
export const HEROES_TOKENS: Record<string, TokenBuilder> = {
  // Jade Titan: a clenched fist raised on its forearm out of a ragged cuff, knuckles up, the thumb across the front
  jadeTitan: () => outward([
    part(lathe([[0.001, 0], [0.085, 0], [0.08, 0.025], [0.06, 0.04], [0.001, 0.04]], 12), [0, B, 0]),
    part(new CylinderGeometry(0.055, 0.068, 0.19, 12), [0, B + 0.125, 0]),
    part(new TorusGeometry(0.06, 0.016, 6, 14), [0, B + 0.19, 0], [Math.PI / 2, 0, 0]),
    // The back of the hand and the curled fingers in a row across the front, a knuckle on top of each
    part(new SphereGeometry(1, 12, 8), [-0.01, B + 0.29, 0], [0, 0, 0], [0.075, 0.095, 0.095]),
    ...[-0.054, -0.018, 0.018, 0.054].flatMap((z) => [
      part(new CylinderGeometry(0.024, 0.022, 0.085, 8), [0.05, B + 0.3, z], [0, 0, 0.12]),
      part(new SphereGeometry(0.027, 8, 6), [0.035, B + 0.35, z]),
    ]),
    // The thumb folded across the lower fingers
    stick([0.02, B + 0.24, -0.085], [0.085, B + 0.255, 0.02], 0.022, 8),
    part(new SphereGeometry(0.023, 8, 6), [0.085, B + 0.255, 0.02]),
  ]),
  // Star Captain: a kite-shaped crest (pointed at its foot) standing in a block, a raised rim and a five-point star on
  // both faces
  starCaptain: () => {
    const kite: [number, number][] = [
      [0, 0.015], [0.1, 0.15], [0.135, 0.28], [0.135, 0.39], [0.07, 0.425], [0, 0.405], [-0.07, 0.425], [-0.135, 0.39], [-0.135, 0.28], [-0.1, 0.15],
    ];
    const inner = kite.map(([x, y]): [number, number] => [x * 0.8, 0.06 + y * 0.8]);
    return [
      part(lathe([[0.001, 0], [0.08, 0], [0.075, 0.03], [0.001, 0.03]], 10), [0, B, 0]),
      part(new BoxGeometry(0.13, 0.05, 0.06), [0, B + 0.03, 0]),
      part(extrude(kite, 0.03), [0, B, 0]),
      ...[1, -1].flatMap((side) => [
        part(extrude(inner, 0.012), [0, B, side * 0.018]),
        part(extrude(starOutline(0, 0.27, 0.075, 0.03), 0.012), [0, B, side * 0.027]),
      ]),
    ];
  },
  // Steel Ace: a winged jet climbing off a display stand: a long nose, swept wings, a tail fin, the canopy and exhaust
  steelAce: () => {
    const wings: [number, number][] = [[-0.165, -0.12], [-0.165, -0.085], [0, 0.07], [0.165, -0.085], [0.165, -0.12], [0, -0.07]];
    const tailplane: [number, number][] = [[-0.07, -0.175], [-0.07, -0.15], [0, -0.1], [0.07, -0.15], [0.07, -0.175]];
    const fin: [number, number][] = [[-0.025, -0.175], [-0.095, -0.185], [-0.095, -0.155], [-0.025, -0.08]];
    const at: V3 = [0.01, B + 0.25, 0];
    return [
      part(lathe([[0.001, 0], [0.07, 0], [0.065, 0.02], [0.001, 0.02]], 10), [0, B, 0]),
      stick([0, B + 0.01, 0], [0.035, B + 0.22, 0], 0.012),
      // Fuselage: a lathe from the exhaust up to the nose
      climbing(lathe([[0.001, 0], [0.028, 0.005], [0.036, 0.05], [0.036, 0.22], [0.024, 0.3], [0.001, 0.35]], 12).translate(0, -0.18, 0), at),
      // Flat parts drawn in the jet's frame (span along X, then turned about Y so they lie across it)
      climbing(extrude(wings, 0.012).rotateY(Math.PI / 2), at),
      climbing(extrude(tailplane, 0.01).rotateY(Math.PI / 2), at),
      climbing(extrude(fin, 0.012), at),
      climbing(new SphereGeometry(1, 10, 6).scale(0.02, 0.05, 0.022).translate(-0.03, 0.07, 0), at),
      climbing(new ConeGeometry(0.03, 0.04, 10).rotateX(Math.PI).translate(0, -0.195, 0), at),
    ];
  },
  // Storm Lord: a zig-zag lightning bolt striking down into a storm cloud on the ground
  stormLord: () => {
    const bolt: [number, number][] = [[-0.05, 0.465], [0.095, 0.465], [0.02, 0.3], [0.115, 0.3], [-0.07, 0.03], [-0.012, 0.215], [-0.1, 0.215]];
    return [
      ...([[0, 0.05, 0, 0.075], [0.065, 0.035, 0.035, 0.05], [-0.06, 0.04, -0.03, 0.055], [0.01, 0.035, -0.07, 0.05], [-0.02, 0.03, 0.075, 0.05]] as V4[]).map(
        ([x, y, z, r]) => part(new SphereGeometry(r, 10, 6), [x, B + y, z], [0, 0, 0], [1, 0.7, 1]),
      ),
      part(extrude(bolt, 0.05), [0, B, 0]),
      // A raised streak down its upper half, on both faces
      ...[0.028, -0.028].map((z) => part(extrude([[-0.03, 0.44], [0.06, 0.44], [-0.01, 0.31], [-0.06, 0.31]], 0.012), [0, B, z])),
    ];
  },
  // Velvet Viper: a snake coiled twice on the ground, its neck rising in a curve to a head facing forward, tongue out
  velvetViper: () => {
    const neck = new CatmullRomCurve3(
      ([[-0.07, 0.11, 0.03], [-0.06, 0.18, 0.01], [-0.02, 0.26, -0.01], [0.04, 0.31, 0]] as V3[]).map(([x, y, z]) => new Vector3(x, B + y, z)),
    );
    return [
      part(new TorusGeometry(0.1, 0.035, 6, 22), [0, B + 0.035, 0], [Math.PI / 2, 0, 0]),
      part(new TorusGeometry(0.068, 0.03, 6, 18), [-0.005, B + 0.095, 0.005], [Math.PI / 2, 0, 0]),
      part(new TubeGeometry(neck, 14, 0.026, 7)),
      part(new SphereGeometry(1, 10, 6), [0.075, B + 0.315, 0], [0, 0, -0.15], [0.052, 0.026, 0.038]),
      ...[0.022, -0.022].map((z) => part(new SphereGeometry(0.008, 5, 4), [0.088, B + 0.336, z])),
      // The forked tongue and the tail's tip tucked against the lower coil
      ...[0.014, -0.014].map((z) => part(new ConeGeometry(0.004, 0.04, 4), [0.142, B + 0.31, z], [0, 0, -Math.PI / 2])),
      part(new ConeGeometry(0.02, 0.07, 6), [0.075, B + 0.025, 0.1], [0, 0, -Math.PI / 2]),
    ];
  },
  // Sharpshot: an archery target of raised rings standing on its foot, propped from behind, an arrow in the bullseye
  // with its fletched end out towards the players (the tip pokes through the back)
  sharpshot: () => {
    const c = B + 0.175;
    const head = new Vector3(0, c, -0.015);
    const tail = new Vector3(0.16, c + 0.08, -0.13);
    const along = new Quaternion().setFromUnitVectors(new Vector3(1, 0, 0), tail.clone().sub(head).normalize());
    const vane: [number, number][] = [[-0.065, 0.006], [-0.05, 0.03], [0, 0.03], [0, -0.03], [-0.05, -0.03], [-0.065, -0.006]];
    return [
      part(new CylinderGeometry(0.05, 0.06, 0.02, 10), [0, B + 0.01, 0]),
      part(new CylinderGeometry(0.155, 0.155, 0.03, 24), [0, c, 0], [Math.PI / 2, 0, 0]),
      ...[1, -1].flatMap((side) => [
        ...[0.115, 0.07].map((r) => part(new TorusGeometry(r, 0.012, 4, 24), [0, c, side * 0.017])),
        part(new CylinderGeometry(0.032, 0.032, 0.02, 12), [0, c, side * 0.022], [Math.PI / 2, 0, 0]),
      ]),
      stick([0, c + 0.08, 0.012], [0, B + 0.004, 0.13], 0.012),
      stick([head.x, head.y, head.z], [tail.x, tail.y, tail.z], 0.007),
      part(new ConeGeometry(0.012, 0.035, 6), [0, c, 0.045], [Math.PI / 2, 0, 0]),
      ...[0, Math.PI / 2].map((roll) => part(extrude(vane, 0.005).rotateX(roll).applyQuaternion(along).translate(tail.x, tail.y, tail.z))),
    ];
  },
};
