import { RULES_VERSION, UPGRADABLE_VERSIONS, normalizeConfig } from './config';
import type { GameState } from './types';

/*
 * The state travels and is stored as one JSON string (an RTDB string field, a localStorage save), which sidesteps
 * everything RTDB does to arrays, empty objects and nulls. decode() also fills in containers an older or hand-edited
 * save may lack.
 */

export { RULES_VERSION, UPGRADABLE_VERSIONS };

export const encode = (s: GameState): string => JSON.stringify(s);

/**
 * Parses a state written by encode(). Throws on garbage or a state from a different RULES_VERSION; a state from one
 * of the UPGRADABLE_VERSIONS (same shape) is accepted and carries on under the current rules.
 */
export function decode(text: string): GameState {
  const raw = JSON.parse(text) as Partial<GameState> | null;
  const shaped = typeof raw === 'object' && raw !== null && typeof raw.seq === 'number';
  if (!shaped || !raw.players || !raw.phase || !raw.turn) {
    throw new Error('not a game state');
  }
  const upgrade = typeof raw.v === 'number' && UPGRADABLE_VERSIONS.includes(raw.v);
  if (raw.v !== RULES_VERSION && !upgrade) throw new Error(`state version ${String(raw.v)} is not ${RULES_VERSION}`);
  const s = raw as GameState;
  s.v = RULES_VERSION;
  s.cfg = normalizeConfig(s.cfg);
  s.since ??= s.seq;
  s.order ??= [];
  s.pending ??= [];
  s.props ??= {};
  s.trades ??= {};
  s.rig ??= [];
  s.pot ??= 0;
  s.decks ??= { chance: [], chest: [] };
  s.decks.chance ??= [];
  s.decks.chest ??= [];
  for (const p of Object.values(s.players)) {
    if (!p) continue;
    p.goojf ??= [];
    p.laps ??= 0;
  }
  return s;
}
