import { RULES_VERSION, normalizeConfig } from './config';
import type { GameState } from './types';

/*
 * The state travels and is stored as one JSON string (an RTDB string field, a localStorage save), which sidesteps
 * everything RTDB does to arrays, empty objects and nulls. decode() also fills in containers an older or hand-edited
 * save may lack.
 */

export { RULES_VERSION };

export const encode = (s: GameState): string => JSON.stringify(s);

/** Parses a state written by encode(). Throws on garbage or a state from a different RULES_VERSION. */
export function decode(text: string): GameState {
  const raw = JSON.parse(text) as Partial<GameState> | null;
  const shaped = typeof raw === 'object' && raw !== null && typeof raw.seq === 'number';
  if (!shaped || !raw.players || !raw.phase || !raw.turn) {
    throw new Error('not a game state');
  }
  if (raw.v !== RULES_VERSION) throw new Error(`state version ${String(raw.v)} is not ${RULES_VERSION}`);
  const s = raw as GameState;
  s.cfg = normalizeConfig(s.cfg);
  s.since ??= s.seq;
  s.order ??= [];
  s.pending ??= [];
  s.props ??= {};
  s.trades ??= {};
  s.rig ??= [];
  s.decks ??= { chance: [], chest: [] };
  s.decks.chance ??= [];
  s.decks.chest ??= [];
  for (const p of Object.values(s.players)) if (p) p.goojf ??= [];
  return s;
}
