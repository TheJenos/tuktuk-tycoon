import type { Presence } from '../../discord/discord';
import type { Doc } from '../../net/types';
import type { SeatId } from '../../rules';

/*
 * What a Discord player's profile says while they're at the voice channel's table: "Bob's turn · 4/6 seats".
 * It changes once a turn, not once a move. (Types only from discord.ts: this stays free of the SDK.)
 */

export function activityFor(doc: Doc | null, seatsTaken: number, maxSeats: number): Presence {
  const seats = `${seatsTaken}/${maxSeats} seats`;
  if (!doc) return { details: 'In the waiting room', state: seats, partySize: seatsTaken, partyMax: maxSeats };
  const g = doc.game;
  const name = (seat: SeatId) => doc.seats[seat]?.name ?? seat;
  const kind = g.cfg.speedDie ? 'Speed Die game' : 'Classic game';
  if (g.phase.k === 'over') return { details: `${kind}: game over`, state: `${name(g.phase.winner)} wins` };
  return { details: `${kind}, turn ${g.turn.no}`, state: `${name(g.turn.seat)}'s turn · ${seats}`, partySize: seatsTaken, partyMax: maxSeats };
}
