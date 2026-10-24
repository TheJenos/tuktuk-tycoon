import type { GameState, Level, SeatId } from '../../rules';
import type { BoardEvent } from '../../view';

/*
 * What stands on the board, pure: houses and hotels per street, an owner chip per owned property, a stamp per
 * mortgaged one. Keys name one piece (`h:space:slot` house, `H:space` hotel, `c:space` chip, `m:space` stamp), so an
 * animation can follow a piece in and out.
 */

export interface Pieces {
  houses: { space: number; slot: number; key: string }[];
  hotels: { space: number; key: string }[];
  chips: { space: number; seat: SeatId; mortgaged: boolean; key: string }[];
  stamps: { space: number; key: string }[];
}

export const houseKey = (space: number, slot: number) => `h:${space}:${slot}`;
export const hotelKey = (space: number) => `H:${space}`;
export const chipKey = (space: number) => `c:${space}`;
export const stampKey = (space: number) => `m:${space}`;

export function piecesOf(game: GameState | null): Pieces {
  const out: Pieces = { houses: [], hotels: [], chips: [], stamps: [] };
  if (!game) return out;
  for (const [key, p] of Object.entries(game.props)) {
    if (!p) continue;
    const space = Number(key.slice(1));
    out.chips.push({ space, seat: p.owner, mortgaged: !!p.mortgaged, key: chipKey(space) });
    if (p.mortgaged) out.stamps.push({ space, key: stampKey(space) });
    if (p.level === 5) out.hotels.push({ space, key: hotelKey(space) });
    else for (let slot = 0; slot < p.level; slot++) out.houses.push({ space, slot, key: houseKey(space, slot) });
  }
  return out;
}

/** The pieces an event brings in and takes away */
export function pieceChanges(ev: BoardEvent): { enter: string[]; leave: string[] } {
  switch (ev.t) {
    case 'owner':
      return ev.to ? { enter: [chipKey(ev.space)], leave: [] } : { enter: [], leave: [chipKey(ev.space)] };
    case 'mortgage':
      return ev.on ? { enter: [stampKey(ev.space)], leave: [] } : { enter: [], leave: [stampKey(ev.space)] };
    case 'level': {
      const keys = (lv: Level) =>
        lv === 5 ? [hotelKey(ev.space)] : Array.from({ length: lv }, (_, slot) => houseKey(ev.space, slot));
      const before = new Set(keys(ev.from));
      const after = new Set(keys(ev.to));
      return { enter: [...after].filter((k) => !before.has(k)), leave: [...before].filter((k) => !after.has(k)) };
    }
  }
}
