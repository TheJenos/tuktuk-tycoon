import { DEFAULT_ROOM_RULES, type RoomRules } from '../../net/network';
import { boardMoney, DEFAULT_RULES, getBoard, HEROES_FIXED, type BoardDef } from '../../rules';
import { money, startName, taxName, termsOf } from '../game/format';
import { skillLabel } from './seats';

/*
 * The table's rules in words: the rows of the lobby's rules summary and of the game menu's Rules tab, and the one-line
 * summary. Pure (no React), so the forms' tests can check it.
 */

/** Everything a table can set: the room rules without the e2e-only debug flag */
export type RulesDraft = Omit<RoomRules, 'debug'>;

/** The default board (names for labels that have no table yet) */
export const BOARD: BoardDef = getBoard(DEFAULT_RULES.board);

const spaceName = (b: BoardDef, k: string, fallback: string): string => b.spaces.find((s) => s.k === k)?.name ?? fallback;
/** "Tuk-Tuk Stand" */
export const parkingName = (b: BoardDef = BOARD): string => spaceName(b, 'parking', 'Free Parking');
/** "Police Station Bench" */
export const jailName = (b: BoardDef = BOARD): string => b.spaces[b.jailIndex]?.name ?? 'Jail';

export const secs = (n: number): string => (n > 0 ? (n >= 60 && n % 60 === 0 ? `${n / 60} min` : `${n} s`) : 'Off');
export const minutes = (n: number): string => (n % 60 === 0 ? `${n / 60} h` : n > 60 ? `${Math.floor(n / 60)} h ${n % 60} min` : `${n} min`);

export const BOT_PACE_LABELS: Record<number, string> = { 0.5: 'Quick', 1: 'Normal', 2: 'Relaxed' };

/** What a game's ranking counts: "net worth", or the board's word for it (Hero League's "score") */
export const worthName = (b: BoardDef = BOARD): string => termsOf(b).worth;

/**
 * Options with no effect on a heroes board besides the pinned ones (HEROES_FIXED): there is no Speed Die, tax space,
 * mortgage, debt, auction or trade there
 */
const HEROES_IDLE = ['triplesRollAgain', 'luxuryTax', 'incomeTaxMode', 'incomeFlat', 'incomePct', 'mortgagePct', 'tradeAfterLap', 'auctionTimer', 'debtTimer'] as const;
const HEROES_HIDDEN: ReadonlySet<string> = new Set<string>([...Object.keys(HEROES_FIXED), ...HEROES_IDLE]);
const NONE_HIDDEN: ReadonlySet<string> = new Set<string>();

/**
 * The RulesDraft options a board pins or that do nothing on it, which the forms, the summaries and the game's rules
 * view leave out: on Hero League every key of HEROES_FIXED and the options its rules have no use for; none on the
 * classic boards
 */
export function hiddenOptions(board: string): ReadonlySet<string> {
  return getBoard(board).heroes ? HEROES_HIDDEN : NONE_HIDDEN;
}

export type SupplyId = 'standard' | 'scarce' | 'unlimited';

/**
 * Building supply presets for a board: its standard supply (the rulebook's 32 houses / 12 hotels on All Island), a
 * scarce one (about 60% of it) and one that can never run short (four houses and a hotel on every street is far less)
 */
export function supplyFor(board: string): Record<SupplyId, { houses: number; hotels: number; label: string }> {
  const r = getBoard(board).rules;
  const houses = r.houses ?? DEFAULT_RULES.houses;
  const hotels = r.hotels ?? DEFAULT_RULES.hotels;
  return {
    standard: { houses, hotels, label: 'Standard' },
    scarce: { houses: Math.round(houses * 0.625), hotels: Math.round(hotels * (2 / 3)), label: 'Scarce' },
    unlimited: { houses: 200, hotels: 100, label: 'Unlimited' },
  };
}

export function supplyOf(d: Pick<RulesDraft, 'houses' | 'hotels' | 'board'>): SupplyId | 'custom' {
  const supply = supplyFor(d.board);
  const id = (Object.keys(supply) as SupplyId[]).find((k) => supply[k].houses === d.houses && supply[k].hotels === d.hotels);
  return id ?? 'custom';
}

export function incomeTaxText(d: Pick<RulesDraft, 'incomeTaxMode' | 'incomeFlat' | 'incomePct'>): string {
  if (d.incomeTaxMode === 'flat') return `Always ${money(d.incomeFlat)}`;
  if (d.incomeTaxMode === 'percent') return `Always ${d.incomePct}% of worth`;
  return `${money(d.incomeFlat)} or ${d.incomePct}% of worth (the player's choice)`;
}

export function tradingText(d: Pick<RulesDraft, 'trading' | 'tradeAfterLap'>): string {
  if (d.trading === 'off') return 'Off';
  if (d.trading === 'afterLap') return `Once both players have done ${d.tradeAfterLap} lap${d.tradeAfterLap === 1 ? '' : 's'}`;
  return 'On';
}

export const afkText = (n: number): string => (n <= 0 ? 'Never' : `After ${n} timeout${n === 1 ? '' : 's'} in a row`);

type Row = [string, string];

/**
 * Rows for every option beyond the basic ones (cash, Speed Die, luxury tax, turn limit, turn timer). `all`: every
 * option (the game menu); otherwise only those that differ from the defaults (the lobby summary). `online` adds the
 * room-only options (timers, AFK, spectators, late join).
 */
export function optionRows(d: RulesDraft, { all = false, online = false, local = false }: { all?: boolean; online?: boolean; local?: boolean } = {}): Row[] {
  const def = DEFAULT_ROOM_RULES;
  const rows: Row[] = [];
  // Nothing about an option the board pins or has no use for (hiddenOptions)
  const hidden = hiddenOptions(d.board);
  const add = (key: keyof RulesDraft, show: boolean, row: Row) => {
    if ((all || show) && !hidden.has(key)) rows.push(row);
  };
  const b = getBoard(d.board);
  const m = (n: number) => boardMoney(d.board, n);
  const worth = worthName(b);
  add('goSalary', d.goSalary !== def.goSalary, [`${startName(b)} salary`, m(d.goSalary)]);
  add('doubleGoLanding', d.doubleGoLanding, [`Landing on ${startName(b)}`, d.doubleGoLanding ? `Double salary (${m(d.goSalary * 2)})` : 'The usual salary']);
  add('jackpot', d.jackpot, [`${parkingName(b)} jackpot`, d.jackpot ? 'Taxes, fines and card payments build a pot; landing there wins it' : 'Off']);
  add('incomeTaxMode', d.incomeTaxMode !== def.incomeTaxMode || d.incomeFlat !== def.incomeFlat || d.incomePct !== def.incomePct, [taxName(b, 'income'), incomeTaxText(d)]);
  add('jailFine', d.jailFine !== def.jailFine, [b.heroes ? `${jailName(b)} fine` : 'Jail fine', m(d.jailFine)]);
  add('mortgagePct', d.mortgagePct !== def.mortgagePct, ['Mortgage interest', `${d.mortgagePct}%`]);
  const supply = supplyOf(d);
  add('houses', supply !== 'standard', ['Bank stock', supply === 'unlimited' ? 'Unlimited houses and hotels' : `${d.houses} houses, ${d.hotels} hotels`]);
  add('auctions', !d.auctions, ['Auctions', d.auctions ? 'Declined property is auctioned' : 'Off: declined property stays with the bank']);
  add('auctionAll', d.auctionAll, ['Auction every property', d.auctionAll ? 'No buying at the printed price: every property goes to bidding' : 'Off: the lander may buy first']);
  add('buyAfterFirstLap', d.buyAfterFirstLap, ['First lap', d.buyAfterFirstLap ? `No buying until you have passed ${startName(b)} once` : 'Buy from the start']);
  add('jailRent', !d.jailRent, ['Rent while in jail', d.jailRent ? 'Collected' : 'Not collected']);
  add('threeDoublesJail', !d.threeDoublesJail, ['Three doubles', d.threeDoublesJail ? `Go to the ${jailName(b)}` : 'Just roll again']);
  add('dealProperties', d.dealProperties > 0, ['Quick-start deal', d.dealProperties > 0 ? `${d.dealProperties} free propert${d.dealProperties === 1 ? 'y' : 'ies'} each` : 'None']);
  add('endMode', d.endMode !== def.endMode, ['Game ends', d.endMode === 'firstBankrupt' ? `At the first bankruptcy, ranked by ${worth}` : 'When one player is left']);
  add('timeLimit', d.timeLimit > 0, ['Time limit', d.timeLimit > 0 ? `${minutes(d.timeLimit)}, then ranked by ${worth}` : 'None']);
  add('trading', d.trading !== def.trading, ['Trading', tradingText(d)]);
  if (online) {
    add('decisionTimer', d.decisionTimer !== def.decisionTimer && d.turnTimer > 0, ['Decision timer', secs(d.decisionTimer)]);
    add('debtTimer', d.debtTimer !== def.debtTimer && d.turnTimer > 0, ['Debt timer', secs(d.debtTimer)]);
  }
  const fixedCountdown = d.auctions && d.fixedAuctionCountdown;
  if (online || local) {
    add('auctionTimer', d.auctionTimer !== def.auctionTimer || fixedCountdown, ['Auction countdown', auctionCountdownText(d.auctionTimer, fixedCountdown)]);
  } else {
    add('fixedAuctionCountdown', fixedCountdown, ['Auction countdown', "Fixed from the start (bids don't add time)"]);
  }
  add('botPace', d.botPace !== def.botPace, ['Bot speed', BOT_PACE_LABELS[d.botPace] ?? 'Normal']);
  add('botSkill', d.botSkill !== def.botSkill, ['New bots', skillLabel(d.botSkill)]);
  if (online) {
    add('afkStrikes', d.afkStrikes !== def.afkStrikes, ['A bot plays for an absent player', afkText(d.afkStrikes)]);
    add('spectators', !d.spectators, ['Spectators', d.spectators ? 'Welcome' : 'Not allowed']);
    add('lateJoin', d.lateJoin, ['Late join', d.lateJoin ? 'Spectators may take over a bot’s seat' : 'Off']);
  }
  return rows;
}

/**
 * One line: "All Island · Classic · Rs. 150,000" / "Colombo · Speed Die · Rs. 200,000 · 200 turns · first bankruptcy
 * ends" / "Hero League · 1,500 Power · 100 turns" (nothing about an option the board pins or has no use for)
 */
export function rulesLine(d: RulesDraft): string {
  const hidden = hiddenOptions(d.board);
  const shown = (key: keyof RulesDraft, part: string | null): string | null => (hidden.has(key) ? null : part);
  return [
    getBoard(d.board).display.name,
    shown('speedDie', d.speedDie ? 'Speed Die' : 'Classic'),
    boardMoney(d.board, d.startCash),
    d.turnLimit > 0 ? `${d.turnLimit} turns` : null,
    d.timeLimit > 0 ? minutes(d.timeLimit) : null,
    shown('endMode', d.endMode === 'firstBankrupt' ? 'first bankruptcy ends' : null),
    shown('dealProperties', d.dealProperties > 0 ? `${d.dealProperties} dealt` : null),
    shown('jackpot', d.jackpot ? 'jackpot' : null),
    shown('trading', d.trading === 'off' ? 'no trading' : null),
    shown('auctions', !d.auctions ? 'no auctions' : null),
    shown('auctionAll', d.auctionAll ? 'every property auctioned' : null),
    shown('fixedAuctionCountdown', d.auctions && d.fixedAuctionCountdown ? 'fixed auction countdown' : null),
  ].filter(Boolean).join(' · ');
}

/** "8 s, restarting at each bid" / "8 s from the start (bids don't add time)" */
export function auctionCountdownText(seconds: number, fixed: boolean): string {
  return fixed ? `${secs(seconds)} from the start (bids don't add time)` : `${secs(seconds)}, restarting at each bid`;
}

/** For the speed bonus line */
export const SPEED_BONUS = DEFAULT_RULES.speedBonus;
