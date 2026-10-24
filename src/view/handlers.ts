import type { EventType, GameEvent } from '../rules';
import type { SceneApis } from './types';

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
}

type Step<E> = (ev: E, ctx: PlayCtx) => Promise<void> | void;
export interface Handler<E> {
  before?: Step<E>;
  after?: Step<E>;
}
export type Handlers = { [K in EventType]?: Handler<Extract<GameEvent, { t: K }>> };

/** Fire and forget (the camera never holds up the queue) */
const quiet = (p: Promise<void> | undefined): void => void p?.catch(() => {});

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
      // Triples walk (GO passing stays visible); only the trip to jail is a jump.
      const mode = ev.via === 'jail' ? 'jump' : ev.via === 'back' ? 'back' : 'walk';
      return apis.tokens?.move(ev.seat, ev.path, mode, signal, speed);
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
};

export function handlerFor<E extends GameEvent>(ev: E): Handler<E> | undefined {
  return (HANDLERS as Record<string, Handler<E> | undefined>)[ev.t];
}
