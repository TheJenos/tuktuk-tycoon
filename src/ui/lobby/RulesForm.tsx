import { useId, useState } from 'react';
import { DEFAULT_ROOM_RULES, ROOM_ENGINE_KEYS, type RoomOptions, type RoomRules } from '../../net/network';
import { boardMoney, BOARDS, currencyOf, DEFAULT_RULES, getBoard, type BoardDef, type RulesConfig } from '../../rules';
import { ONLINE_TIMERS, OFFLINE_TIMERS, type TimerRules } from '../../shared/timing';
import { capital, powerName, startName, taxName } from '../game/format';
import { Choices, Toggle, type Choice } from './Choices';
import {
  afkText,
  BOT_PACE_LABELS,
  hiddenOptions,
  jailName,
  optionRows,
  parkingName,
  rulesLine,
  supplyFor,
  supplyOf,
  worthName,
  type RulesDraft,
  type SupplyId,
} from './rulesText';
import { skillsFor } from './seats';
import './lobby.css';

export { rulesLine, type RulesDraft };

/*
 * The rules a table can change, as one form for the local game, the room wizard, Discord and the waiting room: the
 * board, a preset row, the everyday options, then everything else in a collapsible Advanced section. Every other rule is the
 * rulebook's (see docs/rules.md); Hero League's own rules pin some options, and the form leaves out those and the ones
 * its rules have no use for (hiddenOptions, docs/heroes.md).
 */

export const DEFAULT_DRAFT: RulesDraft = (({ debug: _debug, ...rest }: RoomRules) => rest)(DEFAULT_ROOM_RULES);

// ------------------------------------------------------------------------------------------------ presets

export type PresetId = 'classic' | 'fast' | 'house' | 'custom';

/** The options a preset sets (the game's rules but not the board; timers and who may join are the table's own business) */
export const PRESET_KEYS = [...ROOM_ENGINE_KEYS.filter((k): k is Exclude<(typeof ROOM_ENGINE_KEYS)[number], 'board'> => k !== 'board'), 'timeLimit'] as const;
type PresetKey = (typeof PRESET_KEYS)[number];
type PresetValues = Pick<RulesDraft, PresetKey>;

const CLASSIC: PresetValues = Object.fromEntries(PRESET_KEYS.map((k) => [k, DEFAULT_DRAFT[k]])) as PresetValues;

/** A board's presets: Fast only where the board can play it (not on Hero League, which pins the Speed Die off) */
export type Presets = { classic: PresetValues; house: PresetValues; fast?: PresetValues };

/**
 * The presets on a board. Each board has its own standard rules (BoardDef.rules: All Island's are the rulebook's,
 * "Classic"); Fast and House rules are that standard with their changes on top. Hero League's House rules change only
 * what it lets a table change.
 */
export function presetsFor(board: string): Presets {
  const b = getBoard(board);
  const standard = { ...CLASSIC, ...b.rules } as PresetValues;
  if (b.heroes) return { classic: standard, house: { ...standard, doubleGoLanding: true, threeDoublesJail: false } };
  return {
    classic: standard,
    fast: { ...standard, speedDie: true, dealProperties: 2, endMode: 'firstBankrupt', startCash: 2000, turnLimit: 200 },
    house: { ...standard, jackpot: true, doubleGoLanding: true, threeDoublesJail: false },
  };
}

/** All Island's presets (every one of them) */
export const PRESETS = presetsFor(DEFAULT_DRAFT.board) as Required<Presets>;

/** A board's standard rules by name: "Classic" (the rulebook's, All Island) or the board's own ("Colombo") */
export const standardName = (board: string): string => (board === DEFAULT_DRAFT.board ? 'Classic' : getBoard(board).display.name);

const presetChoices = (board: string): Choice<PresetId>[] => {
  const b = getBoard(board);
  const presets = presetsFor(board);
  return [
    { value: 'classic', label: standardName(board), hint: board === DEFAULT_DRAFT.board ? 'The rulebook' : (b.display.rulesBlurb ?? 'This board’s own rules') },
    ...(presets.fast
      ? [{ value: 'fast', label: 'Fast', hint: `Speed Die, 2 properties dealt each, ${boardMoney(board, 2000)} to start, the first bankruptcy ends it, 200 turns at most` } as Choice<PresetId>]
      : []),
    {
      value: 'house',
      label: 'House rules',
      hint: b.heroes
        ? `Double salary for landing on ${startName(b)}, no ${jailName(b)} for three doubles`
        : `A ${parkingName(b)} jackpot, double salary for landing on ${startName(b)}, no jail for three doubles`,
    },
    { value: 'custom', label: 'Custom', hint: 'Your own mix: see Advanced' },
  ];
};

/**
 * Which of its board's presets the draft is (Custom once anything a preset sets differs from all of them; an option
 * the board pins or has no use for never counts)
 */
export function presetOf(d: RulesDraft): PresetId {
  const presets = presetsFor(d.board);
  const hidden = hiddenOptions(d.board);
  const keys = PRESET_KEYS.filter((k) => !hidden.has(k));
  const ids = (Object.keys(presets) as Exclude<PresetId, 'custom'>[]).filter((id) => presets[id]);
  return ids.find((id) => keys.every((k) => presets[id]?.[k] === d[k])) ?? 'custom';
}

/**
 * The draft moved to another board: that board's version of the same preset (its standard rules from Custom, or from
 * a preset the board has none of)
 */
export function onBoard(d: RulesDraft, board: string): Partial<RulesDraft> {
  const preset = presetOf(d);
  const presets = presetsFor(board);
  return { board, ...((preset !== 'custom' && presets[preset]) || presets.classic) };
}

// ------------------------------------------------------------------------------------------------ draft <-> rules

/** Engine rules from the draft */
export function draftRules(d: RulesDraft): Partial<RulesConfig> {
  const out: Partial<RulesConfig> = {};
  for (const k of ROOM_ENGINE_KEYS) (out as Record<string, unknown>)[k] = d[k];
  return out;
}

/**
 * Online timers from the turn timer: the other human decisions follow it (all off with it). Hero League's reaction
 * windows always count down, the same in every room.
 */
export function draftTimers(turnTimer: number): TimerRules {
  const reaction = ONLINE_TIMERS.reaction;
  if (turnTimer <= 0) return { turn: 0, decision: 0, auction: ONLINE_TIMERS.auction, debt: 0, reaction };
  return { turn: turnTimer, decision: Math.min(ONLINE_TIMERS.decision, turnTimer), auction: ONLINE_TIMERS.auction, debt: ONLINE_TIMERS.debt, reaction };
}

/**
 * The draft's timers: online every one as set; offline nobody is hurried but the auction keeps its countdown (and
 * reaction windows theirs)
 */
export function roomTimers(d: RulesDraft, online = true): TimerRules {
  if (!online) return { ...OFFLINE_TIMERS, auction: d.auctionTimer };
  return { turn: d.turnTimer, decision: d.decisionTimer, auction: d.auctionTimer, debt: d.debtTimer, reaction: ONLINE_TIMERS.reaction };
}

/** The draft's room options (AFK, bots, spectators, late join, time limit) */
export function draftOptions(d: RulesDraft): RoomOptions {
  return { afkStrikes: d.afkStrikes, botPace: d.botPace, botSkill: d.botSkill, spectators: d.spectators, lateJoin: d.lateJoin, timeLimit: d.timeLimit };
}

/** A room's stored rules as a draft */
export function roomDraft(r: RoomRules): RulesDraft {
  const out = { ...DEFAULT_DRAFT };
  for (const k of Object.keys(DEFAULT_DRAFT) as (keyof RulesDraft)[]) {
    const v = r[k];
    if (v !== undefined && typeof v === typeof DEFAULT_DRAFT[k]) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/**
 * A draft change as it is applied: a new turn timer brings the decision and debt timers along (all off with it),
 * unless the change sets them itself (the Advanced section).
 */
export function expandPatch(patch: Partial<RulesDraft>): Partial<RulesDraft> {
  if (patch.turnTimer === undefined) return patch;
  const t = draftTimers(patch.turnTimer);
  return { decisionTimer: t.decision, debtTimer: t.debt, ...patch };
}

/** The room-rules patch for a draft change */
export const roomPatch = (patch: Partial<RulesDraft>): Partial<RoomRules> => expandPatch(patch);

// ------------------------------------------------------------------------------------------------ choices

/** "The rulebook amount" (Hero League's amounts are its own) */
const standardHint = (b: BoardDef): string => (b.heroes ? 'The standard amount' : 'The rulebook amount');
/** Amounts in the board's currency, the standard one marked */
const amounts = (board: string, values: number[], standard: number): Choice<number>[] =>
  values.map((v) => ({ value: v, label: boardMoney(board, v), ...(v === standard ? { hint: standardHint(getBoard(board)) } : {}) }));
const cashChoices = (board: string): Choice<number>[] => amounts(board, [1000, 1500, 2000, 2500, 3000], 1500);
const luxuryChoices = (board: string): Choice<number>[] => [
  { value: 75, label: boardMoney(board, 75), hint: 'The 2007 rulebook' },
  { value: 100, label: boardMoney(board, 100), hint: 'Older editions' },
];
const LIMITS: Choice<number>[] = [
  { value: 0, label: 'None' },
  { value: 100, label: '100', hint: 'A quick game' },
  { value: 200, label: '200' },
  { value: 400, label: '400' },
];
const timerChoices = (b: BoardDef): Choice<number>[] => [
  { value: 0, label: 'Off', hint: b.heroes ? 'Nobody is hurried (reaction windows still count down)' : 'Nobody is hurried (the auction still counts down)' },
  { value: 30, label: '30 s' },
  { value: 60, label: '60 s' },
  { value: 120, label: '2 min' },
];
const salaryChoices = (board: string): Choice<number>[] => amounts(board, [100, 200, 300, 400], 200);
const INCOME_MODE: Choice<RulesDraft['incomeTaxMode']>[] = [
  { value: 'choice', label: 'Player picks', hint: 'Flat amount or a percentage of worth, chosen before adding it up' },
  { value: 'flat', label: 'Always flat' },
  { value: 'percent', label: 'Always %' },
];
const incomeFlatChoices = (board: string): Choice<number>[] => [100, 150, 200, 250].map((v) => ({ value: v, label: boardMoney(board, v) }));
const INCOME_PCT: Choice<number>[] = [5, 10, 15, 20].map((v) => ({ value: v, label: `${v}%` }));
const jailFineChoices = (board: string): Choice<number>[] => amounts(board, [25, 50, 100], 50);
const INTEREST: Choice<number>[] = [0, 10, 20].map((v) => ({ value: v, label: v ? `${v}%` : 'None' }));
const supplyChoices = (board: string): Choice<SupplyId | 'custom'>[] => {
  const supply = supplyFor(board);
  return (Object.keys(supply) as SupplyId[]).map((k) => ({
    value: k,
    label: supply[k].label,
    hint: k === 'unlimited' ? 'Never runs short' : `${supply[k].houses} houses, ${supply[k].hotels} hotels`,
  }));
};
const AUCTION_TIMERS: Choice<number>[] = [5, 8, 12, 20].map((v) => ({ value: v, label: `${v} s` }));
const DEAL: Choice<number>[] = [0, 1, 2, 3].map((v) => ({ value: v, label: v ? `${v} each` : 'None' }));
const END: Choice<RulesDraft['endMode']>[] = [
  { value: 'lastStanding', label: 'Last one standing' },
  { value: 'firstBankrupt', label: 'First bankruptcy', hint: 'Then the richest by net worth wins' },
];
const TIME_LIMITS: Choice<number>[] = [0, 30, 60, 90, 120].map((v) => ({ value: v, label: v ? (v % 60 ? `${v} min` : `${v / 60} h`) : 'None' }));
const DECISION_TIMERS: Choice<number>[] = [0, 15, 30, 45, 60].map((v) => ({ value: v, label: v ? `${v} s` : 'Off' }));
const DEBT_TIMERS: Choice<number>[] = [0, 60, 120, 300].map((v) => ({ value: v, label: v ? (v % 60 ? `${v} s` : `${v / 60} min`) : 'Off' }));
const PACES: Choice<number>[] = [0.5, 1, 2].map((v) => ({ value: v, label: BOT_PACE_LABELS[v] ?? String(v) }));
const botSkillChoices = (board: string): Choice<RulesDraft['botSkill']>[] => skillsFor(board).map((k) => ({ value: k.value, label: k.label, hint: k.hint }));
const AFK: Choice<number>[] = [0, 1, 2, 3].map((v) => ({ value: v, label: v ? `${v} timeout${v > 1 ? 's' : ''}` : 'Never' }));
const TRADING: Choice<RulesDraft['trading']>[] = [
  { value: 'on', label: 'On' },
  { value: 'afterLap', label: 'After a lap', hint: 'Once both players have passed Start enough times' },
  { value: 'off', label: 'Off' },
];
const TRADE_LAPS: Choice<number>[] = [1, 2, 3, 5].map((v) => ({ value: v, label: `Lap ${v}` }));

/** What the decision timer hurries: Hero League's only such choices are two superpowers' (Dead Aim, Viper Strike) */
function decisionHint(b: BoardDef): string {
  if (!b.heroes) return 'Buying, taxes, jail and other quick choices.';
  return `${capital(powerName(b, 'aim'))} and ${powerName(b, 'sting')} choices. Reaction windows always count down ${ONLINE_TIMERS.reaction} s.`;
}

// ------------------------------------------------------------------------------------------------ the board

/** The board's eight colour groups as a strip, in board order (a small preview of the theme) */
export function BoardStrip({ board }: { board: string }) {
  const b = getBoard(board);
  return (
    <span className="board-strip" aria-hidden="true">
      {b.groups.map((g) => (
        <span key={g.id} style={{ background: b.display.groupColours[g.id] ?? '#888' }} />
      ))}
    </span>
  );
}

/**
 * The board picker: one card per board with its name, blurb, colour strip and size (a radio group named "Board"). A
 * board too small for the `seated` players can't be picked, and a line under the cards says why.
 */
export function BoardChoice({ value, onChange, disabled, seated = 0 }: { value: string; onChange(board: string): void; disabled?: boolean; seated?: number }) {
  const id = useId();
  const small = BOARDS.filter((b) => b.id !== value && seated > getBoard(b.id).maxPlayers);
  return (
    <div className={disabled ? 'lobby-setting board-setting disabled' : 'lobby-setting board-setting'}>
      <span className="lobby-setting-label" id={`${id}-label`}>Board</span>
      <div className="board-choices" role="radiogroup" aria-labelledby={`${id}-label`}>
        {BOARDS.map((b) => {
          const def = getBoard(b.id);
          const small = seated > def.maxPlayers;
          return (
            <button
              key={b.id}
              type="button"
              role="radio"
              aria-checked={b.id === value}
              aria-label={b.name}
              aria-describedby={`${id}-${b.id}`}
              className={b.id === value ? 'board-choice selected' : 'board-choice'}
              disabled={disabled || (small && b.id !== value)}
              title={small ? `Seats ${def.maxPlayers}: ${seated} are at the table` : undefined}
              onClick={() => onChange(b.id)}
            >
              <BoardStrip board={b.id} />
              <strong>{b.name}</strong>
              <small className="board-size">{def.spaces.length} spaces · 2–{def.maxPlayers} players</small>
              <small className="muted" id={`${id}-${b.id}`}>{b.blurb}</small>
            </button>
          );
        })}
      </div>
      {small.length > 0 && !disabled && (
        <small className="muted lobby-hint">
          {small.map((b) => `${b.name} seats ${getBoard(b.id).maxPlayers}`).join(', ')}: {seated} are at the table, so remove a seat first.
        </small>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ the form

export function RulesForm({ value, onChange, online = false, disabled = false, seated = 0 }: {
  value: RulesDraft;
  onChange(patch: Partial<RulesDraft>): void;
  /** Players already at the table: boards that seat fewer can't be picked */
  seated?: number;
  /** Shows the room-only options: the timers on human decisions, AFK, spectators and late join */
  online?: boolean;
  disabled?: boolean;
}) {
  const preset = presetOf(value);
  const [open, setOpen] = useState(preset === 'custom');
  const set = (patch: Partial<RulesDraft>) => onChange(expandPatch(patch));
  const pick = (id: PresetId) => {
    const values = id === 'custom' ? undefined : presetsFor(value.board)[id];
    if (values) set(values);
    else setOpen(true);
  };
  const timersOn = value.turnTimer > 0;
  const supply = supplyOf(value);
  const board = getBoard(value.board);
  const income = taxName(board, 'income');
  const presets = presetChoices(value.board);
  const money = (n: number) => boardMoney(value.board, n);
  // Only what the board lets a table change (Hero League pins some options and has no use for others)
  const hidden = hiddenOptions(value.board);
  const shown = (key: keyof RulesDraft) => !hidden.has(key);
  const ranked = board.heroes ? `the highest ${worthName(board)} wins` : 'the richest by net worth wins';
  const jail = board.heroes ? jailName(board) : 'Jail';
  return (
    <div className="lobby-form rules-form">
      <BoardChoice value={board.id} disabled={disabled} seated={seated} onChange={(id) => set(onBoard(value, id))} />
      <Choices
        label="Preset"
        value={preset}
        options={presets}
        disabled={disabled}
        onChange={pick}
        hint={presets.find((c) => c.value === preset)?.hint}
      />
      {shown('speedDie') && (
        <Toggle
          label="Speed Die"
          checked={value.speedDie}
          disabled={disabled}
          onChange={(speedDie) => set({ speedDie })}
          hint={`A red third die for a faster game: Bus and Tuk-Tuk Uncle faces, and ${money(DEFAULT_RULES.speedBonus)} more each at the start. You roll it once you have first passed ${startName(board)}.`}
        />
      )}
      {shown('triplesRollAgain') && (
        <Toggle
          label="Triples roll again"
          checked={value.triplesRollAgain}
          disabled={disabled || !value.speedDie}
          onChange={(triplesRollAgain) => set({ triplesRollAgain })}
          hint="Speed Die triples: move to any space, then roll again."
        />
      )}
      <Choices
        label={board.heroes ? `Starting ${currencyOf(board).symbol}` : 'Starting cash'}
        value={value.startCash}
        options={cashChoices(value.board)}
        disabled={disabled}
        onChange={(startCash) => set({ startCash })}
      />
      {shown('luxuryTax') && (
        <Choices label={taxName(board, 'luxury')} value={value.luxuryTax} options={luxuryChoices(value.board)} disabled={disabled} onChange={(luxuryTax) => set({ luxuryTax })} />
      )}
      <Choices
        label="Turn limit"
        value={value.turnLimit}
        options={LIMITS}
        disabled={disabled}
        onChange={(turnLimit) => set({ turnLimit })}
        hint={`Turns by everyone together; then ${ranked}.`}
      />
      {online && (
        <Choices
          label="Turn timer"
          value={value.turnTimer}
          options={timerChoices(board)}
          disabled={disabled}
          onChange={(turnTimer) => set({ turnTimer })}
          hint={value.afkStrikes > 0
            ? `A player who runs out of time ${value.afkStrikes === 1 ? 'once' : value.afkStrikes === 2 ? 'twice in a row' : `${value.afkStrikes} times in a row`} is played by a bot until they're back.`
            : 'Running out of time plays the safe move; a bot never takes over.'}
        />
      )}

      <details className="advanced-rules" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary>Advanced</summary>
        <fieldset className="rules-group" disabled={disabled}>
          <legend>{board.heroes ? currencyOf(board).symbol : 'Money'}</legend>
          <Choices label={`${startName(board)} salary`} value={value.goSalary} options={salaryChoices(value.board)} disabled={disabled} onChange={(goSalary) => set({ goSalary })} />
          <Toggle
            label={`Double salary for landing on ${startName(board)}`}
            checked={value.doubleGoLanding}
            disabled={disabled}
            onChange={(doubleGoLanding) => set({ doubleGoLanding })}
            hint={`Stopping exactly on ${startName(board)} pays ${money(value.goSalary * 2)} instead of ${money(value.goSalary)}.`}
          />
          {shown('jackpot') && (
            <Toggle
              label={`${parkingName(board)} jackpot`}
              checked={value.jackpot}
              disabled={disabled}
              onChange={(jackpot) => set({ jackpot })}
              hint={`Taxes, fines and card payments to the bank go into a pot; whoever lands on ${parkingName(board)} wins it.`}
            />
          )}
          {shown('incomeTaxMode') && (
            <Choices label={income} value={value.incomeTaxMode} options={INCOME_MODE} disabled={disabled} onChange={(incomeTaxMode) => set({ incomeTaxMode })} />
          )}
          {shown('incomeFlat') && value.incomeTaxMode !== 'percent' && (
            <Choices label={`${income} flat amount`} value={value.incomeFlat} options={incomeFlatChoices(value.board)} disabled={disabled} onChange={(incomeFlat) => set({ incomeFlat })} />
          )}
          {shown('incomePct') && value.incomeTaxMode !== 'flat' && (
            <Choices label={`${income} percentage`} value={value.incomePct} options={INCOME_PCT} disabled={disabled} onChange={(incomePct) => set({ incomePct })} />
          )}
          <Choices label={`${jail} fine`} value={value.jailFine} options={jailFineChoices(value.board)} disabled={disabled} onChange={(jailFine) => set({ jailFine })} />
          {shown('mortgagePct') && (
            <Choices
              label="Mortgage interest"
              value={value.mortgagePct}
              options={INTEREST}
              disabled={disabled}
              onChange={(mortgagePct) => set({ mortgagePct })}
              hint="Paid when a mortgage is lifted, or when mortgaged property changes hands."
            />
          )}
          {shown('houses') && (
            <Choices
              label="Building supply"
              value={supply}
              options={supplyChoices(value.board)}
              disabled={disabled}
              onChange={(id) => id !== 'custom' && set({ houses: supplyFor(value.board)[id].houses, hotels: supplyFor(value.board)[id].hotels })}
              hint={supply === 'custom' ? `${value.houses} houses, ${value.hotels} hotels` : 'Houses and hotels in the bank; a shortage starts a contest for them.'}
            />
          )}
        </fieldset>

        <fieldset className="rules-group" disabled={disabled}>
          <legend>Rules</legend>
          {shown('auctions') && (
            <Toggle
              label="Auctions"
              checked={value.auctions}
              disabled={disabled || value.auctionAll}
              onChange={(auctions) => set({ auctions })}
              hint={value.auctionAll ? 'On: every property is auctioned.' : 'Property nobody buys goes to open bidding. Off: it stays with the bank.'}
            />
          )}
          {shown('auctionAll') && (
            <Toggle
              label="Auction every property"
              checked={value.auctionAll}
              disabled={disabled}
              onChange={(auctionAll) => set(auctionAll ? { auctionAll, auctions: true } : { auctionAll })}
              hint="Nobody buys at the printed price: landing on an unowned property starts an auction at once, the lander bidding like everyone else."
            />
          )}
          {shown('auctionTimer') && (
            <Choices
              label="Auction countdown"
              value={value.auctionTimer}
              options={AUCTION_TIMERS}
              disabled={disabled || !value.auctions}
              onChange={(auctionTimer) => set({ auctionTimer })}
              hint="Runs from the start of each auction; bids don't add time."
            />
          )}
          {shown('buyAfterFirstLap') && (
            <Toggle
              label="Buy only after the first lap"
              checked={value.buyAfterFirstLap}
              disabled={disabled}
              onChange={(buyAfterFirstLap) => set({ buyAfterFirstLap })}
              hint={`Nobody buys or bids until they have passed ${startName(board)} once.`}
            />
          )}
          {shown('jailRent') && (
            <Toggle
              label="Rent while in jail"
              checked={value.jailRent}
              disabled={disabled}
              onChange={(jailRent) => set({ jailRent })}
              hint={`Owners on the ${jailName(board)} still collect rent.`}
            />
          )}
          <Toggle
            label={`${jail} for three doubles`}
            checked={value.threeDoublesJail}
            disabled={disabled}
            onChange={(threeDoublesJail) => set({ threeDoublesJail })}
            hint={`Off: a third doubles is just another roll, not a trip to the ${jailName(board)}.`}
          />
          {shown('dealProperties') && (
            <Choices
              label="Quick-start deal"
              value={value.dealProperties}
              options={DEAL}
              disabled={disabled}
              onChange={(dealProperties) => set({ dealProperties })}
              hint="Properties handed out free at random before the first roll."
            />
          )}
          {shown('endMode') && <Choices label="Game ends" value={value.endMode} options={END} disabled={disabled} onChange={(endMode) => set({ endMode })} />}
          <Choices
            label="Time limit"
            value={value.timeLimit}
            options={TIME_LIMITS}
            disabled={disabled}
            onChange={(timeLimit) => set({ timeLimit })}
            hint={`When the clock runs out, ${ranked}.`}
          />
        </fieldset>

        <fieldset className="rules-group" disabled={disabled}>
          <legend>Pace and players</legend>
          {online && (
            <>
              <Choices
                label="Decision timer"
                value={value.decisionTimer}
                options={DECISION_TIMERS}
                disabled={disabled || !timersOn}
                onChange={(decisionTimer) => set({ decisionTimer })}
                hint={timersOn ? decisionHint(board) : 'Off with the turn timer.'}
              />
              {shown('debtTimer') && (
                <Choices
                  label="Debt timer"
                  value={value.debtTimer}
                  options={DEBT_TIMERS}
                  disabled={disabled || !timersOn}
                  onChange={(debtTimer) => set({ debtTimer })}
                  hint={timersOn ? 'Time to raise cash when you owe more than you have.' : 'Off with the turn timer.'}
                />
              )}
              <Choices
                label="Bot takes over after"
                value={value.afkStrikes}
                options={AFK}
                disabled={disabled}
                onChange={(afkStrikes) => set({ afkStrikes })}
                hint={`${afkText(value.afkStrikes)}: a bot plays for the absent player until they act again.`}
              />
            </>
          )}
          <Choices label="Bot speed" value={value.botPace} options={PACES} disabled={disabled} onChange={(botPace) => set({ botPace })} />
          <Choices
            label="New bots play at"
            value={value.botSkill}
            options={botSkillChoices(value.board)}
            disabled={disabled}
            onChange={(botSkill) => set({ botSkill })}
            hint={online ? 'The level of a bot you add, and of a bot playing for someone who is away.' : 'The level of a bot you add.'}
          />
          {shown('trading') && <Choices label="Trading" value={value.trading} options={TRADING} disabled={disabled} onChange={(trading) => set({ trading })} />}
          {shown('tradeAfterLap') && value.trading === 'afterLap' && (
            <Choices
              label="Trading opens after"
              value={value.tradeAfterLap}
              options={TRADE_LAPS}
              disabled={disabled}
              onChange={(tradeAfterLap) => set({ tradeAfterLap })}
              hint="Both players must have done this many laps."
            />
          )}
          {online && (
            <>
              <Toggle
                label="Spectators"
                checked={value.spectators}
                disabled={disabled}
                onChange={(spectators) => set({ spectators })}
                hint="People without a seat may watch the game."
              />
              <Toggle
                label="Late join"
                checked={value.lateJoin}
                disabled={disabled}
                onChange={(lateJoin) => set({ lateJoin })}
                hint="Someone watching may take over a bot's seat, or one its player left, while the game runs."
              />
            </>
          )}
        </fieldset>
      </details>
    </div>
  );
}

/**
 * The rules' name: "Classic rules" (All Island's standard; another board's is its name: "Colombo rules"), "Classic +
 * Speed Die", "Fast rules", "House rules"; "· custom" when changed beyond that. `short`: without "rules" (the waiting
 * room's tab).
 */
export function rulesTitle(d: RulesDraft, short = false): string {
  const preset = presetOf(d);
  if (preset === 'fast') return short ? 'Fast' : 'Fast rules';
  const standard = presetsFor(d.board).classic;
  // The Speed Die set the other way from the preset it otherwise is
  const asStandard = presetOf({ ...d, speedDie: standard.speedDie, triplesRollAgain: standard.triplesRollAgain });
  const house = preset === 'house' || asStandard === 'house';
  const base = house ? 'House rules' : standardName(d.board);
  // (never on a board that pins the Speed Die)
  const name = !hiddenOptions(d.board).has('speedDie') && d.speedDie !== (house ? presetsFor(d.board).house.speedDie : standard.speedDie)
    ? `${base} ${d.speedDie ? '+' : 'without'} Speed Die`
    : house || short ? base : `${base} rules`;
  return asStandard === 'custom' ? `${name} · custom` : name;
}

/**
 * The rules as a short list (what a player who can't change them sees): the basics, then whatever isn't the default
 * (nothing about an option the board pins or has no use for)
 */
export function RulesSummary({ value, online = false }: { value: RulesDraft; online?: boolean }) {
  const preset = presetOf(value);
  const board = getBoard(value.board);
  const money = (n: number) => boardMoney(value.board, n);
  const hidden = hiddenOptions(value.board);
  const speedDie = value.speedDie && !hidden.has('speedDie');
  const rows: [string, string][] = [
    ['Board', board.display.name],
    ['Rules', board.heroes ? (board.display.rulesBlurb ?? board.display.name) : speedDie ? 'Classic with the Speed Die' : 'Classic'],
    ...(preset === 'fast' || preset === 'house' ? [['Preset', presetChoices(value.board).find((c) => c.value === preset)?.label ?? ''] as [string, string]] : []),
    [
      board.heroes ? `Starting ${currencyOf(board).symbol}` : 'Starting cash',
      `${money(value.startCash)}${speedDie ? ` + ${money(DEFAULT_RULES.speedBonus)} (Speed Die)` : ''}`,
    ],
    ...(hidden.has('luxuryTax') ? [] : [[taxName(board, 'luxury'), money(value.luxuryTax)] as [string, string]]),
    ...(speedDie ? [['Triples', value.triplesRollAgain ? 'Move anywhere, then roll again' : 'Move anywhere'] as [string, string]] : []),
    ['Turn limit', value.turnLimit > 0 ? `${value.turnLimit} turns, then ranked by ${worthName(board)}` : 'None'],
    ...(online ? [['Turn timer', value.turnTimer > 0 ? `${value.turnTimer} s` : 'Off'] as [string, string]] : []),
    ...optionRows(value, { online, local: !online }),
  ];
  return (
    <dl className="rules-list lobby-rules">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
