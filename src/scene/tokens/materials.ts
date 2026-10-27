import { MeshStandardMaterial } from 'three';
import { DIM } from '../dimmable';

/*
 * Token materials: each token is painted in its seat's colour (a glossy enamel, slightly lit from within so dark
 * colours still read on the board), standing on a polished metal trim ring. Cached per colour and shared.
 */

const painted = new Map<string, MeshStandardMaterial>();

/** The enamel a token is painted with, in its seat's colour; `dim`: darkened, while another player is spotlighted */
export function tokenMaterial(color: string, dim = false): MeshStandardMaterial {
  const key = dim ? `${color}:dim` : color;
  let m = painted.get(key);
  if (!m) {
    m = new MeshStandardMaterial({ color, metalness: 0.15, roughness: 0.38, emissive: color, emissiveIntensity: dim ? 0 : 0.12 });
    if (dim) m.color.multiplyScalar(DIM);
    painted.set(key, m);
  }
  return m;
}

/** The trim ring round every token's plinth */
export const trimMaterial = new MeshStandardMaterial({ color: '#d9dde3', metalness: 0.85, roughness: 0.3 });
/** The trim ring of a token dimmed by the spotlight */
export const dimTrimMaterial = trimMaterial.clone();
dimTrimMaterial.color.multiplyScalar(DIM);
