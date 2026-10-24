import type { GameSession, SessionView } from '../net/types';
import { createStore, useSelector, useStore, type Equality } from './store';

/** The running game session (offline or online), or null in the lobby */
export const sessionStore = createStore<{ session: GameSession | null }>({ session: null });

export const useSession = (): GameSession | null => useStore(sessionStore).session;

const EMPTY: SessionView = { doc: null, mySeats: [], connected: false, driver: false, tamper: null };
const emptyView = createStore<SessionView>(EMPTY);

/** Select from the current session's view; returns the selector over an empty view when there is no session */
export function useSessionView<S>(sel: (v: SessionView) => S, isEqual?: Equality<S>): S {
  const session = useSession();
  return useSelector(session?.view ?? emptyView, sel, isEqual);
}
