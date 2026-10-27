import { useMemo } from 'react';
import { SEAT_IDS, type GameState, type SeatId } from '../rules';
import type { Doc, SeatInfo } from '../net/types';
import { useSessionView } from '../state/session';
import { SEAT_COLORS, TOKENS, isTokenId, seatToken, type TokenId, DEFAULT_TOKEN } from '../shared/tokens';
import { safeColor } from '../ui/colors';

/** How a seat looks on the board: its token and its colour */
export interface SeatLook {
  token: TokenId;
  color: string;
}

/**
 * The seat's own pick, or the default token and colour of its seat number. On Hero League the token is the hero the
 * seat plays in `game` (seatToken), whatever was picked.
 */
export function seatLook(seat: SeatId, info: SeatInfo | undefined, game?: GameState): SeatLook {
  const i = Math.max(0, SEAT_IDS.indexOf(seat));
  const token = seatToken(game, seat, info?.token);
  const own = isTokenId(token) ? token : undefined;
  return {
    token: own ?? (TOKENS[i % TOKENS.length]?.id ?? DEFAULT_TOKEN),
    color: info ? safeColor(info.color) : (SEAT_COLORS[i % SEAT_COLORS.length] ?? '#888888'),
  };
}

const keyOf = (doc: Doc | null | undefined): string =>
  SEAT_IDS.map((s) => {
    const l = seatLook(s, doc?.seats[s], doc?.game);
    return `${l.token}:${l.color}`;
  }).join(',');

/** Every seat's look; re-renders only when a token or colour changes (not on every commit) */
export function useSeatLooks(): Record<SeatId, SeatLook> {
  const key = useSessionView((v) => keyOf(v.doc));
  return useMemo(() => {
    const out = {} as Record<SeatId, SeatLook>;
    key.split(',').forEach((part, i) => {
      const [token, color] = part.split(':');
      const seat = SEAT_IDS[i] as SeatId;
      out[seat] = { token: isTokenId(token) ? token : DEFAULT_TOKEN, color: color ?? '#888888' };
    });
    return out;
  }, [key]);
}
