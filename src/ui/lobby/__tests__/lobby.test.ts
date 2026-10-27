import { describe, expect, it } from 'vitest';
import { makeDoc } from '../../../net/__tests__/helpers';
import { ONLINE_TIMERS } from '../../../shared/timing';
import { activityFor } from '../activity';
import { DEFAULT_ROOM_RULES, roomConfig, type RoomRules } from '../../../net/network';
import {
  DEFAULT_DRAFT,
  draftOptions,
  draftRules,
  draftTimers,
  expandPatch,
  onBoard,
  presetOf,
  PRESETS,
  presetsFor,
  roomDraft,
  roomPatch,
  roomTimers,
  rulesLine,
  rulesTitle,
  type RulesDraft,
} from '../RulesForm';
import { optionRows, supplyOf } from '../rulesText';
import { seatsProblem } from '../SeatsEditor';
import { addSeat, MAX_SEATS, startingSeats, toLocalSeats } from '../seats';

describe('lobby seats', () => {
  it('starts with you, then players and bots, each with their own token and colour', () => {
    const seats = startingSeats('Rita', { humans: 1, bots: 2 });
    expect(seats.map((s) => [s.kind, s.name])).toEqual([['you', 'Rita'], ['human', 'Player 2'], ['bot', 'Nimal'], ['bot', 'Kamala']]);
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
    expect(seatsProblem(seats.map((s) => (s.kind === 'human' ? { ...s, name: 'nimal' } : s)))).toMatch(/Two players are called/);
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

describe('presets and the advanced options', () => {
  const apply = (d: RulesDraft, patch: Partial<RulesDraft>): RulesDraft => ({ ...d, ...expandPatch(patch) });

  it('a preset sets the game rules, and is recognised again', () => {
    expect(presetOf(DEFAULT_DRAFT)).toBe('classic');
    const fast = apply(DEFAULT_DRAFT, PRESETS.fast);
    expect(fast).toMatchObject({ speedDie: true, dealProperties: 2, endMode: 'firstBankrupt', startCash: 2000, turnLimit: 200 });
    expect(presetOf(fast)).toBe('fast');
    const house = apply(fast, PRESETS.house);
    expect(house).toMatchObject({ speedDie: false, dealProperties: 0, jackpot: true, doubleGoLanding: true, threeDoublesJail: false });
    expect(presetOf(house)).toBe('house');
    expect(presetOf(apply(house, PRESETS.classic))).toBe('classic');
    // Timers and who may come in are not part of a preset
    expect(presetOf(apply(DEFAULT_DRAFT, { turnTimer: 0, spectators: false, botPace: 2, afkStrikes: 0 }))).toBe('classic');
  });

  it('anything else edited is Custom', () => {
    expect(presetOf(apply(DEFAULT_DRAFT, { jailFine: 100 }))).toBe('custom');
    expect(presetOf({ ...DEFAULT_DRAFT, ...PRESETS.fast, trading: 'off' })).toBe('custom');
    expect(presetOf(apply(DEFAULT_DRAFT, { speedDie: true }))).toBe('custom');
    expect(presetOf(apply(DEFAULT_DRAFT, { timeLimit: 60 }))).toBe('custom');
  });

  it('names the rules for the launch summary and the waiting room tab', () => {
    expect(rulesTitle(DEFAULT_DRAFT)).toBe('Classic rules');
    expect(rulesTitle(DEFAULT_DRAFT, true)).toBe('Classic');
    // What the e2e tests look for once the Speed Die is ticked
    expect(rulesTitle(apply(DEFAULT_DRAFT, { speedDie: true }))).toBe('Classic + Speed Die');
    expect(rulesTitle(apply(DEFAULT_DRAFT, PRESETS.fast))).toBe('Fast rules');
    expect(rulesTitle(apply(DEFAULT_DRAFT, PRESETS.house))).toBe('House rules');
    expect(rulesTitle(apply(DEFAULT_DRAFT, { jailFine: 100 }))).toBe('Classic rules · custom');
    expect(rulesLine(apply(DEFAULT_DRAFT, PRESETS.fast))).toBe('All Island · Speed Die · Rs. 200,000 · 200 turns · first bankruptcy ends · 2 dealt');
    expect(rulesLine(apply(DEFAULT_DRAFT, { board: 'colombo' }))).toBe('Colombo · Classic · Rs. 150,000');
  });

  it('each board has its own standard rules, and a preset follows the board', () => {
    const colombo = apply(DEFAULT_DRAFT, onBoard(DEFAULT_DRAFT, 'colombo'));
    expect(colombo).toMatchObject({ board: 'colombo', speedDie: true, startCash: 1000, houses: 20, hotels: 8 });
    expect(presetOf(colombo)).toBe('classic');
    expect(rulesTitle(colombo)).toBe('Colombo rules');
    expect(supplyOf(colombo)).toBe('standard');
    // All Island's numbers on Colombo are not Colombo's rules
    expect(presetOf(apply(DEFAULT_DRAFT, { board: 'colombo' }))).toBe('custom');
    const fast = apply(colombo, presetsFor('colombo').fast);
    expect(fast.board).toBe('colombo');
    expect(presetOf(fast)).toBe('fast');
    // Another board: its own version of the same preset
    expect(presetOf(apply(fast, onBoard(fast, 'south')))).toBe('fast');
    expect(apply(colombo, onBoard(colombo, 'lanka'))).toMatchObject({ board: 'lanka', speedDie: false, startCash: 1500, houses: 32 });
  });

  it('a draft goes to room rules and back unchanged', () => {
    const d: RulesDraft = {
      ...DEFAULT_DRAFT, board: 'hill', jackpot: true, incomeTaxMode: 'percent', incomePct: 15, houses: 200, hotels: 100, auctions: false,
      trading: 'afterLap', tradeAfterLap: 3, decisionTimer: 15, debtTimer: 300, auctionTimer: 12, afkStrikes: 0, botPace: 0.5,
      botSkill: 'expert', spectators: false, lateJoin: true, timeLimit: 90,
    };
    const room: RoomRules = { ...DEFAULT_ROOM_RULES, ...roomPatch(d) };
    expect(roomDraft(room)).toEqual(d);
    const cfg = roomConfig(room);
    expect(cfg.rules).toMatchObject(draftRules(d));
    expect(cfg.timers).toEqual(roomTimers(d));
    expect(cfg.options).toEqual(draftOptions(d));
    expect(supplyOf(d)).toBe('unlimited');
    // Offline, nobody is hurried, but the auction keeps the chosen countdown
    expect(roomTimers(d, false)).toEqual({ turn: 0, decision: 0, auction: 12, debt: 0 });
    // A room stored before these options existed reads as the defaults
    expect(roomDraft({ ...DEFAULT_ROOM_RULES, speedDie: true } as RoomRules)).toEqual({ ...DEFAULT_DRAFT, speedDie: true });
  });

  it('a turn timer brings the other timers along unless they are set with it', () => {
    expect(expandPatch({ turnTimer: 0 })).toEqual({ turnTimer: 0, decisionTimer: 0, debtTimer: 0 });
    expect(expandPatch({ turnTimer: 30, decisionTimer: 15 })).toEqual({ turnTimer: 30, decisionTimer: 15, debtTimer: ONLINE_TIMERS.debt });
  });

  it('the summary lists only what differs from the defaults (and every option in the game menu)', () => {
    expect(optionRows(DEFAULT_DRAFT, { online: true })).toEqual([]);
    const rows = optionRows({ ...DEFAULT_DRAFT, jackpot: true, endMode: 'firstBankrupt', spectators: false }, { online: true });
    expect(rows.map(([k]) => k)).toEqual(['Tuk-Tuk Stand jackpot', 'Game ends', 'Spectators']);
    // Local tables have no spectators to speak of
    expect(optionRows({ ...DEFAULT_DRAFT, spectators: false })).toEqual([]);
    expect(optionRows(DEFAULT_DRAFT, { all: true, online: true }).length).toBeGreaterThan(15);
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
