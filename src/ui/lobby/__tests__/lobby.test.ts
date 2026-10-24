import { describe, expect, it } from 'vitest';
import { makeDoc } from '../../../net/__tests__/helpers';
import { ONLINE_TIMERS } from '../../../shared/timing';
import { activityFor } from '../activity';
import { draftTimers, roomPatch } from '../RulesForm';
import { seatsProblem } from '../SeatsEditor';
import { addSeat, MAX_SEATS, startingSeats, toLocalSeats } from '../seats';

describe('lobby seats', () => {
  it('starts with you, then players and bots, each with their own token and colour', () => {
    const seats = startingSeats('Rita', { humans: 1, bots: 2 });
    expect(seats.map((s) => [s.kind, s.name])).toEqual([['you', 'Rita'], ['human', 'Player 2'], ['bot', 'Ava'], ['bot', 'Max']]);
    expect(new Set(seats.map((s) => s.token)).size).toBe(4);
    expect(new Set(seats.map((s) => s.color)).size).toBe(4);
    expect(toLocalSeats(seats).map((s) => [s.kind, s.skill])).toEqual([['human', undefined], ['human', undefined], ['bot', 'normal'], ['bot', 'normal']]);
  });

  it('stops at eight seats', () => {
    let seats = startingSeats('Rita', { bots: 0 });
    for (let i = 0; i < 12; i++) seats = addSeat(seats, i % 2 ? 'bot' : 'human');
    expect(seats).toHaveLength(MAX_SEATS);
    expect(new Set(seats.map((s) => s.token)).size).toBe(MAX_SEATS);
  });

  it('says what stops a table from starting', () => {
    expect(seatsProblem(startingSeats('Rita', { bots: 0 }))).toMatch(/at least 2/);
    const seats = startingSeats('Rita', { humans: 1, bots: 1 });
    expect(seatsProblem(seats)).toBeNull();
    expect(seatsProblem(seats.map((s) => (s.kind === 'human' ? { ...s, name: 'x' } : s)))).toMatch(/needs a name/);
    expect(seatsProblem(seats.map((s) => (s.kind === 'human' ? { ...s, name: 'ava' } : s)))).toMatch(/Two players are called/);
  });
});

describe('room rules from the forms', () => {
  it('derives every human timer from the turn timer', () => {
    expect(draftTimers(0)).toEqual({ turn: 0, decision: 0, auction: ONLINE_TIMERS.auction, debt: 0 });
    expect(draftTimers(30)).toEqual({ turn: 30, decision: 30, auction: ONLINE_TIMERS.auction, debt: ONLINE_TIMERS.debt });
    expect(roomPatch({ turnTimer: 120 })).toEqual({ turnTimer: 120, decisionTimer: ONLINE_TIMERS.decision, debtTimer: ONLINE_TIMERS.debt });
    expect(roomPatch({ speedDie: true })).toEqual({ speedDie: true });
  });
});

describe('Discord activity', () => {
  it('names whose turn it is and how full the table is', () => {
    expect(activityFor(null, 2, 6)).toMatchObject({ details: 'In the waiting room', state: '2/6 seats' });
    const doc = makeDoc('hhbb');
    const p = activityFor(doc, 4, 6);
    expect(p.state).toBe(`${doc.seats[doc.game.turn.seat]?.name}'s turn · 4/6 seats`);
    expect(p.details).toMatch(/^Classic game, turn \d+$/);
    expect(p).toMatchObject({ partySize: 4, partyMax: 6 });
  });
});
