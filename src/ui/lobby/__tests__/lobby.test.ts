import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { makeDoc } from '../../../net/__tests__/helpers';
import { OFFLINE_TIMERS, ONLINE_TIMERS } from '../../../shared/timing';
import { activityFor } from '../activity';
import { DEFAULT_ROOM_RULES, roomConfig, type RoomRules } from '../../../net/network';
import {
  DEFAULT_DRAFT,
  draftOptions,
  RulesForm,
  RulesSummary,
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
import { HEROES_FIXED, type RulesConfig } from '../../../rules';
import { boardTokens } from '../../../shared/tokens';
import { newRoomPlan, withRules } from '../CreateWizard';
import { hiddenOptions, optionRows, supplyOf } from '../rulesText';
import { seatsProblem } from '../SeatsEditor';
import { TokenPicker } from '../TokenPicker';
import { addSeat, MAX_SEATS, SKILLS, seatsOnBoard, skillsFor, startingSeats, toLocalSeats, uniqueTokens } from '../seats';

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
    expect(draftTimers(0)).toEqual({ turn: 0, decision: 0, auction: ONLINE_TIMERS.auction, debt: 0, reaction: ONLINE_TIMERS.reaction });
    expect(draftTimers(30)).toEqual({ turn: 30, decision: 30, auction: ONLINE_TIMERS.auction, debt: ONLINE_TIMERS.debt, reaction: ONLINE_TIMERS.reaction });
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
    const fast = apply(colombo, presetsFor('colombo').fast!);
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
    expect(roomTimers(d, false)).toEqual({ turn: 0, decision: 0, auction: 12, debt: 0, reaction: OFFLINE_TIMERS.reaction });
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

describe('Hero League in the lobby', () => {
  const apply = (d: RulesDraft, patch: Partial<RulesDraft>): RulesDraft => ({ ...d, ...expandPatch(patch) });
  const heroes = apply(DEFAULT_DRAFT, onBoard(DEFAULT_DRAFT, 'heroes'));

  it('hides every option the board pins, and those it has no use for; none on the classic boards', () => {
    const hidden = hiddenOptions('heroes');
    for (const k of Object.keys(HEROES_FIXED)) expect(hidden.has(k), k).toBe(true);
    for (const k of ['triplesRollAgain', 'luxuryTax', 'incomeTaxMode', 'incomeFlat', 'incomePct', 'mortgagePct', 'tradeAfterLap', 'auctionTimer', 'debtTimer']) {
      expect(hidden.has(k), k).toBe(true);
    }
    // What a Hero League table may still change
    for (const k of ['startCash', 'goSalary', 'jailFine', 'doubleGoLanding', 'threeDoublesJail', 'turnLimit', 'timeLimit', 'turnTimer', 'decisionTimer', 'afkStrikes', 'botPace', 'botSkill', 'spectators', 'lateJoin']) {
      expect(hidden.has(k), k).toBe(false);
    }
    for (const b of ['lanka', 'colombo', 'hill', 'south']) expect(hiddenOptions(b).size).toBe(0);
  });

  it('two presets, its own rules and House rules, that only touch what it allows', () => {
    expect(heroes).toMatchObject({ board: 'heroes', ...HEROES_FIXED, startCash: 1500, goSalary: 200, jailFine: 50 });
    expect(presetOf(heroes)).toBe('classic');
    expect(rulesTitle(heroes)).toBe('Hero League rules');
    const presets = presetsFor('heroes');
    expect(presets.fast).toBeUndefined();
    expect(Object.keys(presets).sort()).toEqual(['classic', 'house']);
    const house = apply(heroes, presets.house);
    expect(presetOf(house)).toBe('house');
    expect(rulesTitle(house)).toBe('House rules');
    for (const k of Object.keys(presets.house) as (keyof typeof presets.house)[]) {
      if (presets.house[k] !== presets.classic[k]) expect(hiddenOptions('heroes').has(k), k).toBe(false);
    }
    expect(presetOf(apply(heroes, { startCash: 2000 }))).toBe('custom');
    // A pinned option the draft still carries (from an older room) never makes it Custom
    expect(presetOf({ ...heroes, luxuryTax: 100, houses: 32 })).toBe('classic');
  });

  it('a preset moves to and from the board as far as it can', () => {
    // Fast has no Hero League version: its own rules
    const fast = apply(DEFAULT_DRAFT, PRESETS.fast);
    expect(presetOf(apply(fast, onBoard(fast, 'heroes')))).toBe('classic');
    const house = apply(DEFAULT_DRAFT, PRESETS.house);
    expect(presetOf(apply(house, onBoard(house, 'heroes')))).toBe('house');
    expect(apply(heroes, onBoard(heroes, 'lanka'))).toMatchObject({ ...PRESETS.classic, board: 'lanka' });
  });

  it('the summaries read in Power and say nothing about hidden options', () => {
    expect(rulesLine(heroes)).toBe('Hero League · 1,500 Power');
    expect(rulesLine(apply(heroes, { turnLimit: 100, startCash: 2000 }))).toBe('Hero League · 2,000 Power · 100 turns');
    const rows = optionRows(apply(heroes, { goSalary: 300, jailFine: 100, timeLimit: 60 }), { online: true });
    expect(rows).toEqual([
      ['Rally Point salary', '300 Power'],
      ['Holding Cell fine', '100 Power'],
      ['Time limit', '1 h, then ranked by score'],
    ]);
    const all = optionRows(heroes, { all: true, online: true }).map(([k]) => k);
    for (const k of ['Auctions', 'Mortgage interest', 'Bank stock', 'Trading', 'Game ends', 'Debt timer', 'Auction countdown', 'Quick-start deal']) {
      expect(all).not.toContain(k);
    }
    // The classic boards read as before
    expect(rulesLine(DEFAULT_DRAFT)).toBe('All Island · Classic · Rs. 150,000');
  });

  it('a table moving to the board gets six different heroes, and removing seats past the cap hands them out again', () => {
    let seats = startingSeats('Rita', { bots: 0 });
    for (let i = 0; i < 7; i++) seats = addSeat(seats, i % 2 ? 'bot' : 'human');
    expect(seats.map((s) => s.token)).toEqual(boardTokens('lanka'));
    const moved = seatsOnBoard(seats, 'heroes');
    expect(moved.slice(0, 6).map((s) => s.token)).toEqual(boardTokens('heroes'));
    expect(seatsProblem(moved, 'heroes')).toMatch(/Hero League seats at most 6: remove 2/);
    // Two of the first six go: the last two take the heroes they leave
    const left = uniqueTokens(moved.filter((_, i) => i !== 1 && i !== 3), 'heroes');
    expect(left.map((s) => s.token).sort()).toEqual([...boardTokens('heroes')].sort());
    expect(seatsProblem(left, 'heroes')).toBeNull();
    // Default-named bots take the board's bot names
    expect(moved.filter((s) => s.kind === 'bot').map((s) => s.name)).toEqual(['Ruwan', 'Sachini', 'Dilan']);
  });

  it('bots and players added on the board get random heroes nobody has, up to six', () => {
    const firsts = new Set<string>();
    for (let n = 0; n < 20; n++) {
      let seats = startingSeats('Rita', { bots: 0 }, 'heroes');
      for (let i = 0; i < 8; i++) seats = addSeat(seats, 'bot', 'normal', 'heroes');
      expect(seats).toHaveLength(6);
      expect(new Set(seats.map((s) => s.token)).size).toBe(6);
      expect(seats[0]!.token).toBe('jadeTitan');
      firsts.add(seats[1]!.token);
    }
    expect(firsts.size).toBeGreaterThan(1);
  });

  it('the room wizard keeps a token of the board and at most six seats', () => {
    const plan = { ...newRoomPlan(), maxSeats: 8, bots: Array.from({ length: 7 }, () => 'normal' as const), token: boardTokens('lanka')[7]! };
    const next = withRules(plan, onBoard(plan.rules, 'heroes'));
    expect(next.maxSeats).toBe(6);
    expect(next.bots).toHaveLength(5);
    expect(boardTokens('heroes')).toContain(next.token);
    expect(draftRules(next.rules)).toMatchObject({ board: 'heroes', ...HEROES_FIXED } as Partial<RulesConfig>);
  });

  it('the form and the summary leave out what the board pins; the picker names each hero’s superpower', () => {
    const form = renderToStaticMarkup(createElement(RulesForm, { value: heroes, onChange: () => {}, online: true }));
    const classicForm = renderToStaticMarkup(createElement(RulesForm, { value: DEFAULT_DRAFT, onChange: () => {}, online: true }));
    for (const gone of ['Speed Die', 'Triples roll again', 'Auctions', 'Mortgage interest', 'Building supply', 'Quick-start deal', 'Game ends', 'Debt timer', 'Trading', 'Fast']) {
      expect(classicForm, gone).toContain(`>${gone}<`);
      expect(form, gone).not.toContain(`>${gone}<`);
    }
    for (const kept of ['Starting Power', 'Rally Point salary', 'Holding Cell fine', 'Holding Cell for three doubles', 'Turn limit', 'Time limit', 'House rules']) {
      expect(form, kept).toContain(kept);
    }
    expect(form).toContain('1,500 Power');
    expect(form).not.toContain('Rs.');
    const summary = renderToStaticMarkup(createElement(RulesSummary, { value: heroes, online: true }));
    expect(summary).toContain('Starting Power');
    expect(summary).not.toContain('Speed Die');
    const picker = renderToStaticMarkup(createElement(TokenPicker, { board: 'heroes', value: 'stormLord', taken: ['sharpshot'], onPick: () => {}, label: 'Your hero' }));
    expect(picker).toContain('Thunder Call');
    expect(picker).toContain('Storm Lord');
    expect(picker).toContain('Sharpshot (taken)');
    // The classic boards' picker is the radio group alone, as before
    const classic = renderToStaticMarkup(createElement(TokenPicker, { board: 'lanka', value: 'tuktuk', taken: [], onPick: () => {}, label: 'Your token' }));
    expect(classic.startsWith('<div class="token-picker"')).toBe(true);
  });

  it('the bot levels say what each does with superpowers; Hard and Expert play no better than Normal there', () => {
    const hints = skillsFor('heroes').map((k) => k.hint);
    expect(skillsFor('heroes').map((k) => [k.value, k.label])).toEqual(SKILLS.map((k) => [k.value, k.label]));
    expect(hints[0]).toMatch(/superpower/);
    expect(hints[1]).toMatch(/superpower/);
    expect(hints[2]).toMatch(/as well as Normal/);
    expect(hints[3]).toMatch(/as well as Normal/);
    for (const h of hints) expect(h).not.toMatch(/\b(buys?|trades?|cash|builds?|houses?|bank|sets|simulated|power)\b/i);
    const form = renderToStaticMarkup(createElement(RulesForm, { value: heroes, onChange: () => {}, online: true }));
    for (const h of hints) expect(form).toContain(`title="${h}"`);
    // The classic boards' hints, as before
    for (const b of ['lanka', 'colombo', 'hill', 'south']) expect(skillsFor(b)).toBe(SKILLS);
    const classicForm = renderToStaticMarkup(createElement(RulesForm, { value: DEFAULT_DRAFT, onChange: () => {}, online: true }));
    expect(classicForm).toContain('title="Buys on a whim, never trades"');
    for (const h of hints) expect(classicForm).not.toContain(`title="${h}"`);
  });

  it('Discord says which board the game is on', () => {
    const doc = makeDoc('hhbb', { rules: { board: 'heroes' } });
    expect(activityFor(doc, 4, 6).details).toMatch(/^Hero League game, turn \d+$/);
  });
});
