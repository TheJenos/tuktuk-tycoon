import { MeshStandardMaterial } from 'three';

/*
 * Token materials: each token is painted in its seat's colour (a glossy enamel, slightly lit from within so dark
 * colours still read on the board), standing on a polished metal trim ring. Cached per colour and shared.
 */

const painted = new Map<string, MeshStandardMaterial>();

/** The enamel a token is painted with, in its seat's colour */
export function tokenMaterial(color: string): MeshStandardMaterial {
  let m = painted.get(color);
  if (!m) {
    m = new MeshStandardMaterial({ color, metalness: 0.15, roughness: 0.38, emissive: color, emissiveIntensity: 0.12 });
    painted.set(color, m);
  }
  return m;
}

/** The trim ring round every token's plinth */
export const trimMaterial = new MeshStandardMaterial({ color: '#d9dde3', metalness: 0.85, roughness: 0.3 });
