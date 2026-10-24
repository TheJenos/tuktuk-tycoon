import { useCallback } from 'react';
import type { DispatchResult, GameSession } from '../../net/types';
import type { Action, SeatId } from '../../rules';
import { createStore, useSelector } from '../../state/store';
import { friendlyError } from '../errors';
import { useGameSession } from './context';

/*
 * Sending actions from the game screen: every button goes through `send`, which counts what is in flight (so
 * buttons stay disabled until the commit settles, B1 in the feasibility notes) and turns a refusal into a toast
 * with the engine's own message.
 */

export interface Toast {
  id: number;
  text: string;
  tone: 'error' | 'info';
}

export const toasts = createStore<Toast[]>([]);
let nextToast = 1;

/** Shows a short message (at most 3 at once; the same text twice in a row is dropped) */
export function toast(text: string, tone: Toast['tone'] = 'error', ms = 4500): void {
  const list = toasts.get();
  if (list.at(-1)?.text === text) return;
  const t: Toast = { id: nextToast++, text, tone };
  toasts.set([...list.slice(-2), t]);
  setTimeout(() => dismissToast(t.id), ms);
}

export const dismissToast = (id: number): void => toasts.set(toasts.get().filter((t) => t.id !== id));

/** Dispatches waiting for their commit */
export const inflight = createStore(0);

export async function send(session: GameSession, seat: SeatId, a: Action): Promise<DispatchResult> {
  inflight.set(inflight.get() + 1);
  try {
    const r = await session.dispatch(seat, a);
    if (!r.ok) toast(r.message || 'That move was refused');
    return r;
  } catch (err) {
    const message = friendlyError(err);
    toast(message);
    return { ok: false, code: 'error', message };
  } finally {
    inflight.set(inflight.get() - 1);
  }
}

/** A dispatch is in flight: action buttons wait */
export const useBusy = (): boolean => useSelector(inflight, (n) => n > 0);

/** `send` bound to the game screen's session */
export function useSend(): (seat: SeatId, a: Action) => Promise<DispatchResult> {
  const session = useGameSession();
  return useCallback((seat, a) => send(session, seat, a), [session]);
}
