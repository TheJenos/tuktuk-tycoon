import { createContext, useContext, useMemo } from 'react';
import type { Doc, GameSession, SessionView } from '../../net/types';
import type { GameState, SeatId } from '../../rules';
import { shallowArrayEqual, useSelector, type Equality } from '../../state/store';
import { makeNames, type Names } from './format';

/*
 * The session the game screen shows, for every component under GameView, and small hooks over it. The LOGICAL
 * state (what is legal now) comes from here; the displayed state comes from the director (useView in src/view).
 */

const SessionContext = createContext<GameSession | null>(null);

export const GameSessionProvider = SessionContext.Provider;

export function useGameSession(): GameSession {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useGameSession outside GameView');
  return session;
}

export function useSessionSel<S>(sel: (v: SessionView) => S, isEqual?: Equality<S>): S {
  return useSelector(useGameSession().view, sel, isEqual);
}

const docOf = (v: SessionView) => v.doc;
const gameOf = (v: SessionView) => v.doc?.game ?? null;
const seatsOf = (v: SessionView) => v.mySeats;

export const useDoc = (): Doc | null => useSessionSel(docOf);
/** The logical game state */
export const useGame = (): GameState | null => useSessionSel(gameOf);
export const useMySeats = (): SeatId[] => useSessionSel(seatsOf, shallowArrayEqual);

/** Seat names from the room and space names from the board, rebuilt only when the seats or the board change */
export function useNames(): Names {
  const doc = useDoc();
  const seats = doc?.seats;
  const game = doc?.game ?? null;
  const board = game?.cfg.board;
  const players = game?.players;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => makeNames(game, doc), [seats, board, players]);
}

/** The server clock, as a stable function for useCountdown */
export function useServerNow(): () => number {
  const session = useGameSession();
  return useMemo(() => () => session.serverNow(), [session]);
}
