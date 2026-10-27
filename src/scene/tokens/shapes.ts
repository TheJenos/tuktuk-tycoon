import { BufferGeometry, TorusGeometry } from 'three';
import { COLOMBO_TOKENS } from '../../boards/colombo/tokens';
import { HILL_TOKENS } from '../../boards/hill/tokens';
import { LANKA_TOKENS } from '../../boards/lanka/tokens';
import { SOUTH_TOKENS } from '../../boards/south/tokens';
import type { TokenId } from '../../shared/tokens';
import { TOKEN_SCALE, merge, plinth, type TokenBuilder } from './kit';

export { PLINTH_TOP, TOKEN_SCALE } from './kit';

/*
 * The tokens' 3D shapes: each board's eight are in its folder (src/boards/<board>/tokens.ts, built with the kit in
 * kit.ts). They are drawn in their seat's colour (Tokens.tsx). The seat-colour ring around the plinth is a separate
 * mesh (ringGeometry).
 */

const BUILDERS: Record<string, TokenBuilder> = { ...LANKA_TOKENS, ...COLOMBO_TOKENS, ...HILL_TOKENS, ...SOUTH_TOKENS };

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
    g = merge([plinth(), ...(BUILDERS[id] ?? (LANKA_TOKENS.tuktuk as TokenBuilder))()]);
    g.scale(TOKEN_SCALE, TOKEN_SCALE, TOKEN_SCALE);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    cache.set(id, g);
  }
  return g;
}
