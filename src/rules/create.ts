import { getBoard } from './board';
import { RULES_VERSION, normalizeConfig } from './config';
import { d6, seedState, shuffle } from './rng';
import type { GameEvent, GameState, PlayerState, RulesConfig, SeatId } from './types';

export const SEAT_IDS: readonly SeatId[] = ['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7'];
export const MIN_SEATS = 2;
export const MAX_SEATS = 8;
/** Longest player name kept in the state */
export const NAME_MAX = 24;

export interface SeatSetup {
  id: SeatId;
  name: string;
}

/**
 * A new game: starting cash (plus the Speed Die bonus), both decks shuffled, and the opening roll. Everyone rolls
 * two dice; players tied for the highest roll again until one is highest, who starts; play then follows lobby seat
 * order. Throws on a bad seat list (a programming error, not a player's).
 */
export function createGame(
  cfg: Partial<RulesConfig> | undefined,
  seats: SeatSetup[],
  seed: number,
): { state: GameState; events: GameEvent[] } {
  const rules = normalizeConfig(cfg);
  if (seats.length < MIN_SEATS || seats.length > MAX_SEATS) throw new Error(`need ${MIN_SEATS}-${MAX_SEATS} seats`);
  const ids = seats.map((x) => x.id);
  if (new Set(ids).size !== ids.length || !ids.every((id) => SEAT_IDS.includes(id))) throw new Error('bad seat ids');

  const b = getBoard(rules.board);
  const h = { rng: seedState(seed) };
  const chance = shuffle(h, b.chance.map((card) => card.id));
  const chest = shuffle(h, b.chest.map((card) => card.id));

  const events: GameEvent[] = [];
  let tied = [...ids];
  for (let guard = 0; guard < 100 && tied.length > 1; guard++) {
    const totals = tied.map((seat) => {
      const w: [number, number] = [d6(h), d6(h)];
      events.push({ t: 'dice', seat, purpose: 'order', w, doubles: w[0] === w[1], triples: false, total: w[0] + w[1] });
      return w[0] + w[1];
    });
    const best = Math.max(...totals);
    tied = tied.filter((_, i) => totals[i] === best);
  }
  const first = tied[0] as SeatId;
  const at = ids.indexOf(first);
  const order = [...ids.slice(at), ...ids.slice(0, at)];

  const cash = rules.startCash + (rules.speedDie ? rules.speedBonus : 0);
  const players: Partial<Record<SeatId, PlayerState>> = {};
  for (const x of seats) {
    const name = String(x.name).trim().slice(0, NAME_MAX);
    players[x.id] = { seat: x.id, name, cash, pos: 0, goojf: [], speed: false };
  }

  const state: GameState = {
    v: RULES_VERSION,
    seq: 0,
    since: 0,
    rng: h.rng,
    cfg: rules,
    players,
    order,
    turn: { seat: first, no: 1, doubles: 0, again: false },
    phase: { k: 'preRoll' },
    pending: [],
    props: {},
    bank: { houses: rules.houses, hotels: rules.hotels },
    decks: { chance, chest },
    trades: {},
    rig: [],
  };
  events.push({ t: 'order', order: [...order] }, { t: 'turn', seat: first, no: 1 });
  return { state, events };
}
