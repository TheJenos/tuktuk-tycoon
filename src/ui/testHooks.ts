import type { DispatchResult, GameSession } from '../net/types';
import { awaiting, type Action, type GameState, type RigRoll, type SeatId, type SpeedFace } from '../rules';
import { uiStore } from '../state/ui';
import { director } from '../view';

/*
 * window.game for the dev console and the Playwright tests (dev and `--mode e2e` builds only): the shape declared
 * in e2e/support/player.ts. Tests read the DOM for assertions and use these to wait for the right moment, to send
 * an action as a button would, or to rig the dice in a debug room.
 */

export interface GameHooks {
  readonly joined: boolean;
  readonly roomCode: string;
  readonly me: string;
  seq(): number;
  /** The logical state (null before the game starts) */
  state(): GameState | null;
  /** The state the board shows right now */
  view(): GameState | null;
  /** Nothing queued or playing, and the board has caught up with state() */
  idle(): boolean;
  /** Finish the animations at once */
  flush(): void;
  mySeats(): SeatId[];
  /** An engine action from one of our seats: `seat`, else the first of ours the game waits on, else our first */
  dispatch(action: Action, seat?: SeatId): Promise<DispatchResult & { error?: string }>;
  test: {
    /** The next throw: two white dice, then the speed face when it's in play (1-3, 'bus', 'uncle'); or a list of throws */
    rig(dice: (number | string)[] | (number | string)[][]): Promise<void>;
    setCash(seat: SeatId, cash: number): Promise<void>;
    /** A click on a board space, as the 3D board would send it */
    pickTile(index: number): void;
    hoverTile(index: number | null): void;
    openDeed(index: number): void;
  };
}

declare global {
  interface Window {
    game?: GameHooks;
  }
}

export const hooksEnabled = (): boolean => import.meta.env.DEV || import.meta.env.VITE_E2E === 'true';

const FACES: Record<string, SpeedFace> = { '1': 1, '2': 2, '3': 3, bus: 'bus', uncle: 'uncle', mr: 'uncle' };

/** One rigged throw from what a test wrote: [3, 4] or [3, 4, 'bus'] */
export function toRigRoll(dice: readonly (number | string)[]): RigRoll {
  const [a, b, face] = dice;
  const w: [number, number] = [Number(a), Number(b)];
  if (face === undefined) return w;
  const s = FACES[String(face).toLowerCase()];
  if (s === undefined) throw new Error(`Unknown speed die face: ${String(face)}`);
  return [w[0], w[1], s];
}

export function toRigRolls(dice: (number | string)[] | (number | string)[][]): RigRoll[] {
  return Array.isArray(dice[0]) ? (dice as (number | string)[][]).map(toRigRoll) : [toRigRoll(dice as (number | string)[])];
}

function makeHooks(session: GameSession): GameHooks {
  const view = () => session.view.get();
  const game = () => view().doc?.game ?? null;
  const pick = (seat?: SeatId): SeatId | undefined => {
    if (seat) return seat;
    const mine = view().mySeats;
    const s = game();
    return (s ? awaiting(s).find((x) => mine.includes(x)) : undefined) ?? mine[0];
  };
  const dispatch = async (action: Action, seat?: SeatId) => {
    const from = pick(seat);
    if (!from) return { ok: false as const, code: 'spectator', message: 'No seat to act from', error: 'No seat to act from' };
    const r = await session.dispatch(from, action);
    return r.ok ? r : { ...r, error: r.message };
  };
  const must = async (action: Action) => {
    const r = await dispatch(action);
    if (!r.ok) throw new Error(`${action.k} refused: ${r.message}`);
  };
  return {
    get joined() {
      const v = view();
      return v.connected || !session.online;
    },
    get roomCode() {
      return session.code ?? '';
    },
    get me() {
      return session.me;
    },
    seq: () => view().doc?.seq ?? -1,
    state: game,
    view: () => director.view.get().game,
    idle: () => director.idle.get() && director.view.get().seq >= (view().doc?.seq ?? -1),
    flush: () => director.fastForward(),
    mySeats: () => [...view().mySeats],
    dispatch,
    test: {
      rig: (dice) => must({ k: 'debugRig', dice: toRigRolls(dice) }),
      setCash: (seat, cash) => must({ k: 'debugSetCash', seat, cash }),
      pickTile: (i) => {
        const p = uiStore.get().picker;
        if (p?.onPick && p.legal.includes(i)) p.onPick(i);
        else uiStore.update({ selected: i });
      },
      hoverTile: (i) => uiStore.update({ hover: i }),
      openDeed: (i) => uiStore.update({ selected: i }),
    },
  };
}

const installed = new Map<GameSession, { hooks: GameHooks; refs: number }>();

/**
 * Puts window.game in place for `session` (a no-op outside dev and e2e builds). Calls nest: the waiting room and
 * the game screen can both install for the same session, and window.game stays until the last one uninstalls.
 */
export function installGameHooks(session: GameSession): () => void {
  if (!hooksEnabled() || typeof window === 'undefined') return () => {};
  let entry = installed.get(session);
  if (!entry) {
    entry = { hooks: makeHooks(session), refs: 0 };
    installed.set(session, entry);
  }
  entry.refs++;
  window.game = entry.hooks;
  const mine = entry;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    if (--mine.refs > 0) return;
    installed.delete(session);
    if (window.game === mine.hooks) window.game = undefined;
  };
}
