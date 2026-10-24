import { useEffect } from 'react';
import { setDiscordActivity } from '../../discord/discord';
import type { Room } from '../../state/app';
import { activityFor } from './activity';

/** Keeps the Discord profile line (activity.ts) in step with the room, sending it only when its text changes */
export function useDiscordActivity(room: Room): void {
  useEffect(() => {
    if (!room.discord) return;
    let last = '';
    let unsubGame: (() => void) | null = null;
    const update = () => {
      const v = room.view.get();
      const doc = v.game?.current() ?? null;
      const taken = doc ? Object.keys(doc.seats).length : Object.keys(v.setup?.seats ?? {}).length;
      const p = activityFor(doc, taken, v.lobby?.maxSeats ?? 8);
      const key = JSON.stringify(p);
      if (key === last) return;
      last = key;
      setDiscordActivity(p);
    };
    const watchGame = () => {
      const game = room.view.get().game;
      if (game && !unsubGame) unsubGame = game.view.subscribe(update);
      update();
    };
    const unsubRoom = room.view.subscribe(watchGame);
    watchGame();
    return () => {
      unsubRoom();
      unsubGame?.();
    };
  }, [room]);
}
