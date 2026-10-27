import type { EventType, GameEvent, GameState } from '../rules';
import { ANIM } from '../shared/timing';
import { NO_SAVE_LABEL, powerLabel, readyLabel, shortLabel } from './labels';
import type { MoveMode, SceneApis } from './types';

/*
 * How each engine event plays. `before` runs while the displayed state still shows the old values (the token walks,
 * the dice tumble, the card flies), `after` once the event's changes are in view.game (a house drops in, a label
 * rises). Each returns a promise to wait for, or nothing. A handler whose scene API isn't registered does nothing,
 * which is the DOM-only mode.
 */

export interface PlayCtx {
  apis: Partial<SceneApis>;
  signal: AbortSignal;
  /** Playback speed: 1 normal, 2 fast, times the backlog factor */
  speed: number;
  /** The same on every client for this event (dice throws) */
  seed: number;
  /** The displayed state as the event starts (its changes not in yet) */
  game: GameState | null;
  /** The batch's events, and this one's index among them */
  events: readonly GameEvent[];
  index: number;
}

type Step<E> = (ev: E, ctx: PlayCtx) => Promise<void> | void;
export interface Handler<E> {
  before?: Step<E>;
  after?: Step<E>;
}
export type Handlers = { [K in EventType]?: Handler<Extract<GameEvent, { t: K }>> };

/** Fire and forget (the camera never holds up the queue) */
const quiet = (p: Promise<void> | undefined): void => void p?.catch(() => {});

/** Holds the queue a while (the director cuts it short on an abort) */
const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Triples walk (GO passing stays visible); only the trip to jail is a jump, and a Titan Smash swap a leap */
export const moveMode = (via: Extract<GameEvent, { t: 'move' }>['via']): MoveMode =>
  via === 'jail' ? 'jump' : via === 'swap' ? 'leap' : via === 'back' ? 'back' : 'walk';

export const HANDLERS: Handlers = {
  turn: {
    after: (_ev, { apis, signal }) => quiet(apis.camera?.focus(null, signal)),
  },
  dice: {
    before: (ev, { apis, signal, speed, seed }) =>
      ev.purpose === 'order' ? undefined : apis.dice?.roll(ev, signal, speed, seed),
  },
  move: {
    before: (ev, { apis, signal, speed }) => {
      quiet(apis.camera?.follow?.([ev.from, ...ev.path], signal));
      return apis.tokens?.move(ev.seat, ev.path, moveMode(ev.via), signal, speed);
    },
  },
  cash: {
    after: (ev, { apis }) => {
      if (!apis.fx || ev.amount === 0) return;
      if (ev.from !== 'bank') apis.fx.money(ev.from, -ev.amount);
      if (ev.to !== 'bank') apis.fx.money(ev.to, ev.amount);
    },
  },
  card: {
    before: (ev, { apis, signal, speed }) => apis.cards?.show(ev, signal, speed),
  },
  owner: {
    after: (ev, { apis, signal, speed }) => apis.board?.animate(ev, signal, speed),
  },
  level: {
    after: (ev, { apis, signal, speed }) => apis.board?.animate(ev, signal, speed),
  },
  mortgage: {
    after: (ev, { apis, signal, speed }) => apis.board?.animate(ev, signal, speed),
  },
  auctionStart: {
    after: (ev, { apis, signal }) => {
      if (ev.lot.k === 'prop') quiet(apis.camera?.focus(ev.lot.space, signal));
    },
  },
  over: {
    after: (_ev, { apis, signal }) => quiet(apis.camera?.focus(null, signal)),
  },
  // Hero League
  heroDie: {
    // Thrown mid-turn into the middle of the board: the whole board in view
    before: (ev, { apis, signal, speed, seed }) => {
      quiet(apis.camera?.focus(null, signal));
      return apis.dice?.hero?.(ev, signal, speed, seed);
    },
  },
  power: {
    // The label first, held a moment, then what the superpower does
    before: (ev, { apis, speed, game, events, index }) => {
      if (!apis.fx?.say) return;
      apis.fx.say(ev.seat, powerLabel(ev, game, events.slice(index + 1)));
      return pause(ANIM.power / speed);
    },
  },
  powerReady: {
    after: (ev, { apis, game }) => apis.fx?.say?.(ev.seat, readyLabel(ev, game)),
  },
  noSave: {
    after: (ev, { apis }) => apis.fx?.say?.(ev.seat, NO_SAVE_LABEL),
  },
  short: {
    after: (ev, { apis, game }) => apis.fx?.say?.(ev.seat, shortLabel(ev, game)),
  },
};

export function handlerFor<E extends GameEvent>(ev: E): Handler<E> | undefined {
  return (HANDLERS as Record<string, Handler<E> | undefined>)[ev.t];
}
