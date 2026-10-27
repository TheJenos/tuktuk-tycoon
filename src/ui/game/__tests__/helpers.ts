import { apply, createGame, type Action, type GameEvent, type GameState, type SeatId } from '../../../rules';

/** A debug game with Ann (s0), Bob (s1) and more, s0 to play first, in seat order */
export function game(n = 2, cfg: Record<string, unknown> = {}): GameState {
  const names = ['Ann', 'Bob', 'Cat', 'Dan'];
  const seats = (['s0', 's1', 's2', 's3'] as SeatId[]).slice(0, n).map((id, i) => ({ id, name: names[i] ?? id }));
  const { state } = createGame({ debug: true, ...cfg }, seats, 7);
  state.order = seats.map((s) => s.id);
  state.turn = { seat: 's0', no: 1, doubles: 0, again: false };
  return state;
}

/** Gives spaces to a seat (mutates; keeps the bank's stock consistent) */
export function own(s: GameState, seat: SeatId, spaces: number[], level = 0, mortgaged = false): void {
  for (const space of spaces) {
    s.props[`p${space}`] = { owner: seat, level: level as 0, ...(mortgaged ? { mortgaged: true as const } : {}) };
    if (level === 5) s.bank.hotels--;
    else s.bank.houses -= level;
  }
}

/** Applies an action and returns the new state, failing the test if the engine refuses it */
export function act(s: GameState, seat: SeatId, a: Action): { state: GameState; events: GameEvent[] } {
  const r = apply(s, { by: seat, a }, { check: true });
  if (!r.ok) throw new Error(`${seat} ${JSON.stringify(a)}: ${r.error.message}`);
  return { state: r.state, events: r.events };
}

/**
 * A Hero League debug game: Ann (s0), Bob (s1) and more, each playing the hero at its place in `heroes`, s0 to play
 * first, in seat order. Board: 0 Rally Point, 5 Villain Strike, 7 Holding Cell, 16 Sky Carrier (260, power-up 150).
 */
export function heroesGame(heroes: string[] = ['jadeTitan', 'stormLord'], cfg: Record<string, unknown> = {}): GameState {
  const names = ['Ann', 'Bob', 'Cat', 'Dan', 'Eve', 'Fay'];
  const seats = (['s0', 's1', 's2', 's3', 's4', 's5'] as SeatId[]).slice(0, heroes.length).map((id, i) => ({ id, name: names[i] ?? id, hero: heroes[i] }));
  const { state } = createGame({ debug: true, ...cfg, board: 'heroes' }, seats, 7);
  state.order = seats.map((s) => s.id);
  state.turn = { seat: 's0', no: 1, doubles: 0, again: false };
  return state;
}

/** Queues rigged throws (debug games): white dice, and Hero-die faces */
export function rigged(s: GameState, dice: [number, number][], hero: number[] = []): GameState {
  return act(s, s.turn.seat, { k: 'debugRig', dice, ...(hero.length ? { hero } : {}) }).state;
}
