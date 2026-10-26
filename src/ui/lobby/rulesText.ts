import { DEFAULT_ROOM_RULES, type RoomRules } from '../../net/network';
import { DEFAULT_RULES, getBoard, type BoardDef } from '../../rules';
import { money, startName, taxName } from '../game/format';
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

/** Building supply presets (any supply of 88 houses / 22 hotels or more can never run short) */
export const SUPPLY = {
  standard: { houses: 32, hotels: 12, label: 'Standard' },
  scarce: { houses: 20, hotels: 8, label: 'Scarce' },
  unlimited: { houses: 200, hotels: 100, label: 'Unlimited' },
} as const;
export type SupplyId = keyof typeof SUPPLY;

export function supplyOf(d: Pick<RulesDraft, 'houses' | 'hotels'>): SupplyId | 'custom' {
  const id = (Object.keys(SUPPLY) as SupplyId[]).find((k) => SUPPLY[k].houses === d.houses && SUPPLY[k].hotels === d.hotels);
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
  const add = (show: boolean, row: Row) => {
    if (all || show) rows.push(row);
  };
  const b = getBoard(d.board);
  add(d.goSalary !== def.goSalary, [`${startName(b)} salary`, money(d.goSalary)]);
  add(d.doubleGoLanding, [`Landing on ${startName(b)}`, d.doubleGoLanding ? `Double salary (${money(d.goSalary * 2)})` : 'The usual salary']);
  add(d.jackpot, [`${parkingName(b)} jackpot`, d.jackpot ? 'Taxes, fines and card payments build a pot; landing there wins it' : 'Off']);
  add(d.incomeTaxMode !== def.incomeTaxMode || d.incomeFlat !== def.incomeFlat || d.incomePct !== def.incomePct, [taxName(b, 'income'), incomeTaxText(d)]);
  add(d.jailFine !== def.jailFine, ['Jail fine', money(d.jailFine)]);
  add(d.mortgagePct !== def.mortgagePct, ['Mortgage interest', `${d.mortgagePct}%`]);
  const supply = supplyOf(d);
  add(supply !== 'standard', ['Bank stock', supply === 'unlimited' ? 'Unlimited houses and hotels' : `${d.houses} houses, ${d.hotels} hotels`]);
  add(!d.auctions, ['Auctions', d.auctions ? 'Declined property is auctioned' : 'Off: declined property stays with the bank']);
  add(d.buyAfterFirstLap, ['First lap', d.buyAfterFirstLap ? `No buying until you have passed ${startName(b)} once` : 'Buy from the start']);
  add(!d.jailRent, ['Rent while in jail', d.jailRent ? 'Collected' : 'Not collected']);
  add(!d.threeDoublesJail, ['Three doubles', d.threeDoublesJail ? `Go to the ${jailName(b)}` : 'Just roll again']);
  add(d.dealProperties > 0, ['Quick-start deal', d.dealProperties > 0 ? `${d.dealProperties} free propert${d.dealProperties === 1 ? 'y' : 'ies'} each` : 'None']);
  add(d.endMode !== def.endMode, ['Game ends', d.endMode === 'firstBankrupt' ? 'At the first bankruptcy, ranked by net worth' : 'When one player is left']);
  add(d.timeLimit > 0, ['Time limit', d.timeLimit > 0 ? `${minutes(d.timeLimit)}, then ranked by net worth` : 'None']);
  add(d.trading !== def.trading, ['Trading', tradingText(d)]);
  if (online) {
    add(d.decisionTimer !== def.decisionTimer && d.turnTimer > 0, ['Decision timer', secs(d.decisionTimer)]);
    add(d.debtTimer !== def.debtTimer && d.turnTimer > 0, ['Debt timer', secs(d.debtTimer)]);
  }
  if (online || local) add(d.auctionTimer !== def.auctionTimer, ['Auction countdown', `${secs(d.auctionTimer)} from the start (bids don't add time)`]);
  add(d.botPace !== def.botPace, ['Bot speed', BOT_PACE_LABELS[d.botPace] ?? 'Normal']);
  add(d.botSkill !== def.botSkill, ['New bots', skillLabel(d.botSkill)]);
  if (online) {
    add(d.afkStrikes !== def.afkStrikes, ['A bot plays for an absent player', afkText(d.afkStrikes)]);
    add(!d.spectators, ['Spectators', d.spectators ? 'Welcome' : 'Not allowed']);
    add(d.lateJoin, ['Late join', d.lateJoin ? 'Spectators may take over a bot’s seat' : 'Off']);
  }
  return rows;
}

/** One line: "All Island · Classic · Rs. 150,000" / "Colombo · Speed Die · Rs. 200,000 · 200 turns · first bankruptcy ends" */
export function rulesLine(d: RulesDraft): string {
  return [
    getBoard(d.board).display.name,
    d.speedDie ? 'Speed Die' : 'Classic',
    money(d.startCash),
    d.turnLimit > 0 ? `${d.turnLimit} turns` : null,
    d.timeLimit > 0 ? minutes(d.timeLimit) : null,
    d.endMode === 'firstBankrupt' ? 'first bankruptcy ends' : null,
    d.dealProperties > 0 ? `${d.dealProperties} dealt` : null,
    d.jackpot ? 'jackpot' : null,
    d.trading === 'off' ? 'no trading' : null,
    !d.auctions ? 'no auctions' : null,
  ].filter(Boolean).join(' · ');
}

/** For the speed bonus line */
export const SPEED_BONUS = DEFAULT_RULES.speedBonus;
