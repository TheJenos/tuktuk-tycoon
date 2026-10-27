import { useEffect } from 'react';
import { setMenuBoard } from '../../audio';

/** While mounted, the lobby's music and sounds are `board`'s (the board a wizard or waiting room shows) */
export function useMenuBoard(board: string): void {
  useEffect(() => {
    setMenuBoard(board);
    return () => setMenuBoard(null);
  }, [board]);
}
