import { useId, useState } from 'react';
import { DEFAULT_ROOM_RULES, ROOM_ENGINE_KEYS, type RoomOptions, type RoomRules } from '../../net/network';
import { BOARDS, DEFAULT_RULES, getBoard, type RulesConfig } from '../../rules';
import { ONLINE_TIMERS, OFFLINE_TIMERS, type TimerRules } from '../../shared/timing';
import { money, startName, taxName } from '../game/format';
import { Choices, Toggle, type Choice } from './Choices';
import {
  afkText,
  BOT_PACE_LABELS,
  jailName,
  optionRows,
  parkingName,
  rulesLine,
  SUPPLY,
  supplyOf,
  type RulesDraft,
  type SupplyId,
} from './rulesText';
import { SKILLS } from './seats';
import './lobby.css';

export { rulesLine, type RulesDraft };

/*
 * The rules a table can change, as one form for the local game, the room wizard, Discord and the waiting room: the
 * board, a preset row, the everyday options, then everything else in a collapsible Advanced section. Every other rule is the
 * rulebook's (see docs/rules.md).
 */

export const DEFAULT_DRAFT: RulesDraft = (({ debug: _debug, ...rest }: RoomRules) => rest)(DEFAULT_ROOM_RULES);

// ------------------------------------------------------------------------------------------------ presets

export type PresetId = 'classic' | 'fast' | 'house' | 'custom';

/** The options a preset sets (the game's rules but not the board; timers and who may join are the table's own business) */
export const PRESET_KEYS = [...ROOM_ENGINE_KEYS.filter((k): k is Exclude<(typeof ROOM_ENGINE_KEYS)[number], 'board'> => k !== 'board'), 'timeLimit'] as const;
type PresetKey = (typeof PRESET_KEYS)[number];
type PresetValues = Pick<RulesDraft, PresetKey>;

const CLASSIC: PresetValues = Object.fromEntries(PRESET_KEYS.map((k) => [k, DEFAULT_DRAFT[k]])) as PresetValues;

export const PRESETS: Record<Exclude<PresetId, 'custom'>, PresetValues> = {
  classic: CLASSIC,
  fast: { ...CLASSIC, speedDie: true, dealProperties: 2, endMode: 'firstBankrupt', startCash: 2000, turnLimit: 200 },
  house: { ...CLASSIC, jackpot: true, doubleGoLanding: true, threeDoublesJail: false },
};

const presetChoices = (board: string): Choice<PresetId>[] => {
  const b = getBoard(board);
  return [
    { value: 'classic', label: 'Classic', hint: 'The rulebook' },
    { value: 'fast', label: 'Fast', hint: `Speed Die, 2 properties dealt each, ${money(2000)} to start, the first bankruptcy ends it, 200 turns at most` },
    { value: 'house', label: 'House rules', hint: `A ${parkingName(b)} jackpot, double salary for landing on ${startName(b)}, no jail for three doubles` },
    { value: 'custom', label: 'Custom', hint: 'Your own mix: see Advanced' },
  ];
};

/** Which preset the draft is (Custom once anything a preset sets differs from all of them) */
export function presetOf(d: RulesDraft): PresetId {
  const ids = Object.keys(PRESETS) as Exclude<PresetId, 'custom'>[];
  return ids.find((id) => PRESET_KEYS.every((k) => PRESETS[id][k] === d[k])) ?? 'custom';
}

// ------------------------------------------------------------------------------------------------ draft <-> rules

/** Engine rules from the draft */
export function draftRules(d: RulesDraft): Partial<RulesConfig> {
  const out: Partial<RulesConfig> = {};
  for (const k of ROOM_ENGINE_KEYS) (out as Record<string, unknown>)[k] = d[k];
  return out;
}

/** Online timers from the turn timer: the other human decisions follow it (all off with it) */
export function draftTimers(turnTimer: number): TimerRules {
  if (turnTimer <= 0) return { turn: 0, decision: 0, auction: ONLINE_TIMERS.auction, debt: 0 };
  return { turn: turnTimer, decision: Math.min(ONLINE_TIMERS.decision, turnTimer), auction: ONLINE_TIMERS.auction, debt: ONLINE_TIMERS.debt };
}

/** The draft's timers: online every one as set; offline nobody is hurried but the auction keeps its countdown */
export function roomTimers(d: RulesDraft, online = true): TimerRules {
  if (!online) return { ...OFFLINE_TIMERS, auction: d.auctionTimer };
  return { turn: d.turnTimer, decision: d.decisionTimer, auction: d.auctionTimer, debt: d.debtTimer };
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

const CASH: Choice<number>[] = [1000, 1500, 2000, 2500, 3000].map((v) => ({ value: v, label: money(v), ...(v === 1500 ? { hint: 'The rulebook amount' } : {}) }));
const LUXURY: Choice<number>[] = [
  { value: 75, label: money(75), hint: 'The 2007 rulebook' },
  { value: 100, label: money(100), hint: 'Older editions' },
];
const LIMITS: Choice<number>[] = [
  { value: 0, label: 'None' },
  { value: 100, label: '100', hint: 'A quick game' },
  { value: 200, label: '200' },
  { value: 400, label: '400' },
];
const TIMERS: Choice<number>[] = [
  { value: 0, label: 'Off', hint: 'Nobody is hurried (the auction still counts down)' },
  { value: 30, label: '30 s' },
  { value: 60, label: '60 s' },
  { value: 120, label: '2 min' },
];
const SALARY: Choice<number>[] = [100, 200, 300, 400].map((v) => ({ value: v, label: money(v), ...(v === 200 ? { hint: 'The rulebook amount' } : {}) }));
const INCOME_MODE: Choice<RulesDraft['incomeTaxMode']>[] = [
  { value: 'choice', label: 'Player picks', hint: 'Flat amount or a percentage of worth, chosen before adding it up' },
  { value: 'flat', label: 'Always flat' },
  { value: 'percent', label: 'Always %' },
];
const INCOME_FLAT: Choice<number>[] = [100, 150, 200, 250].map((v) => ({ value: v, label: money(v) }));
const INCOME_PCT: Choice<number>[] = [5, 10, 15, 20].map((v) => ({ value: v, label: `${v}%` }));
const JAIL_FINE: Choice<number>[] = [25, 50, 100].map((v) => ({ value: v, label: money(v), ...(v === 50 ? { hint: 'The rulebook amount' } : {}) }));
const INTEREST: Choice<number>[] = [0, 10, 20].map((v) => ({ value: v, label: v ? `${v}%` : 'None' }));
const SUPPLY_CHOICES: Choice<SupplyId | 'custom'>[] = (Object.keys(SUPPLY) as SupplyId[]).map((k) => ({
  value: k,
  label: SUPPLY[k].label,
  hint: k === 'unlimited' ? 'Never runs short' : `${SUPPLY[k].houses} houses, ${SUPPLY[k].hotels} hotels`,
}));
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
const BOT_SKILLS: Choice<RulesDraft['botSkill']>[] = SKILLS.map((k) => ({ value: k.value, label: k.label, hint: k.hint }));
const AFK: Choice<number>[] = [0, 1, 2, 3].map((v) => ({ value: v, label: v ? `${v} timeout${v > 1 ? 's' : ''}` : 'Never' }));
const TRADING: Choice<RulesDraft['trading']>[] = [
  { value: 'on', label: 'On' },
  { value: 'afterLap', label: 'After a lap', hint: 'Once both players have passed Start enough times' },
  { value: 'off', label: 'Off' },
];
const TRADE_LAPS: Choice<number>[] = [1, 2, 3, 5].map((v) => ({ value: v, label: `Lap ${v}` }));

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

/** The board picker: one card per board with its name, blurb and colour strip (a radio group named "Board") */
export function BoardChoice({ value, onChange, disabled }: { value: string; onChange(board: string): void; disabled?: boolean }) {
  const id = useId();
  return (
    <div className={disabled ? 'lobby-setting board-setting disabled' : 'lobby-setting board-setting'}>
      <span className="lobby-setting-label" id={`${id}-label`}>Board</span>
      <div className="board-choices" role="radiogroup" aria-labelledby={`${id}-label`}>
        {BOARDS.map((b) => (
          <button
            key={b.id}
            type="button"
            role="radio"
            aria-checked={b.id === value}
            aria-label={b.name}
            aria-describedby={`${id}-${b.id}`}
            className={b.id === value ? 'board-choice selected' : 'board-choice'}
            disabled={disabled}
            onClick={() => onChange(b.id)}
          >
            <BoardStrip board={b.id} />
            <strong>{b.name}</strong>
            <small className="muted" id={`${id}-${b.id}`}>{b.blurb}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ the form

export function RulesForm({ value, onChange, online = false, disabled = false }: {
  value: RulesDraft;
  onChange(patch: Partial<RulesDraft>): void;
  /** Shows the room-only options: the timers on human decisions, AFK, spectators and late join */
  online?: boolean;
  disabled?: boolean;
}) {
  const preset = presetOf(value);
  const [open, setOpen] = useState(preset === 'custom');
  const set = (patch: Partial<RulesDraft>) => onChange(expandPatch(patch));
  const pick = (id: PresetId) => {
    if (id === 'custom') setOpen(true);
    else set(PRESETS[id]);
  };
  const timersOn = value.turnTimer > 0;
  const supply = supplyOf(value);
  const board = getBoard(value.board);
  const income = taxName(board, 'income');
  const presets = presetChoices(value.board);
  return (
    <div className="lobby-form rules-form">
      <BoardChoice value={board.id} disabled={disabled} onChange={(id) => set({ board: id })} />
      <Choices
        label="Preset"
        value={preset}
        options={presets}
        disabled={disabled}
        onChange={pick}
        hint={presets.find((c) => c.value === preset)?.hint}
      />
      <Toggle
        label="Speed Die"
        checked={value.speedDie}
        disabled={disabled}
        onChange={(speedDie) => set({ speedDie })}
        hint={`A red third die for a faster game: Bus and Tuk-Tuk Uncle faces, and ${money(DEFAULT_RULES.speedBonus)} more each at the start. You roll it once you have first passed ${startName(board)}.`}
      />
      <Toggle
        label="Triples roll again"
        checked={value.triplesRollAgain}
        disabled={disabled || !value.speedDie}
        onChange={(triplesRollAgain) => set({ triplesRollAgain })}
        hint="Speed Die triples: move to any space, then roll again."
      />
      <Choices label="Starting cash" value={value.startCash} options={CASH} disabled={disabled} onChange={(startCash) => set({ startCash })} />
      <Choices label={taxName(board, 'luxury')} value={value.luxuryTax} options={LUXURY} disabled={disabled} onChange={(luxuryTax) => set({ luxuryTax })} />
      <Choices
        label="Turn limit"
        value={value.turnLimit}
        options={LIMITS}
        disabled={disabled}
        onChange={(turnLimit) => set({ turnLimit })}
        hint="Turns by everyone together; then the richest by net worth wins."
      />
      {online && (
        <Choices
          label="Turn timer"
          value={value.turnTimer}
          options={TIMERS}
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
          <legend>Money</legend>
          <Choices label={`${startName(board)} salary`} value={value.goSalary} options={SALARY} disabled={disabled} onChange={(goSalary) => set({ goSalary })} />
          <Toggle
            label={`Double salary for landing on ${startName(board)}`}
            checked={value.doubleGoLanding}
            disabled={disabled}
            onChange={(doubleGoLanding) => set({ doubleGoLanding })}
            hint={`Stopping exactly on ${startName(board)} pays ${money(value.goSalary * 2)} instead of ${money(value.goSalary)}.`}
          />
          <Toggle
            label={`${parkingName(board)} jackpot`}
            checked={value.jackpot}
            disabled={disabled}
            onChange={(jackpot) => set({ jackpot })}
            hint={`Taxes, fines and card payments to the bank go into a pot; whoever lands on ${parkingName(board)} wins it.`}
          />
          <Choices label={income} value={value.incomeTaxMode} options={INCOME_MODE} disabled={disabled} onChange={(incomeTaxMode) => set({ incomeTaxMode })} />
          {value.incomeTaxMode !== 'percent' && (
            <Choices label={`${income} flat amount`} value={value.incomeFlat} options={INCOME_FLAT} disabled={disabled} onChange={(incomeFlat) => set({ incomeFlat })} />
          )}
          {value.incomeTaxMode !== 'flat' && (
            <Choices label={`${income} percentage`} value={value.incomePct} options={INCOME_PCT} disabled={disabled} onChange={(incomePct) => set({ incomePct })} />
          )}
          <Choices label="Jail fine" value={value.jailFine} options={JAIL_FINE} disabled={disabled} onChange={(jailFine) => set({ jailFine })} />
          <Choices
            label="Mortgage interest"
            value={value.mortgagePct}
            options={INTEREST}
            disabled={disabled}
            onChange={(mortgagePct) => set({ mortgagePct })}
            hint="Paid when a mortgage is lifted, or when mortgaged property changes hands."
          />
          <Choices
            label="Building supply"
            value={supply}
            options={SUPPLY_CHOICES}
            disabled={disabled}
            onChange={(id) => id !== 'custom' && set({ houses: SUPPLY[id].houses, hotels: SUPPLY[id].hotels })}
            hint={supply === 'custom' ? `${value.houses} houses, ${value.hotels} hotels` : 'Houses and hotels in the bank; a shortage starts a contest for them.'}
          />
        </fieldset>

        <fieldset className="rules-group" disabled={disabled}>
          <legend>Rules</legend>
          <Toggle
            label="Auctions"
            checked={value.auctions}
            disabled={disabled}
            onChange={(auctions) => set({ auctions })}
            hint="Property nobody buys goes to open bidding. Off: it stays with the bank."
          />
          <Choices
            label="Auction countdown"
            value={value.auctionTimer}
            options={AUCTION_TIMERS}
            disabled={disabled || !value.auctions}
            onChange={(auctionTimer) => set({ auctionTimer })}
            hint="Restarts at each bid."
          />
          <Toggle
            label="Buy only after the first lap"
            checked={value.buyAfterFirstLap}
            disabled={disabled}
            onChange={(buyAfterFirstLap) => set({ buyAfterFirstLap })}
            hint={`Nobody buys or bids until they have passed ${startName(board)} once.`}
          />
          <Toggle
            label="Rent while in jail"
            checked={value.jailRent}
            disabled={disabled}
            onChange={(jailRent) => set({ jailRent })}
            hint={`Owners on the ${jailName(board)} still collect rent.`}
          />
          <Toggle
            label="Jail for three doubles"
            checked={value.threeDoublesJail}
            disabled={disabled}
            onChange={(threeDoublesJail) => set({ threeDoublesJail })}
            hint={`Off: a third doubles is just another roll, not a trip to the ${jailName(board)}.`}
          />
          <Choices
            label="Quick-start deal"
            value={value.dealProperties}
            options={DEAL}
            disabled={disabled}
            onChange={(dealProperties) => set({ dealProperties })}
            hint="Properties handed out free at random before the first roll."
          />
          <Choices label="Game ends" value={value.endMode} options={END} disabled={disabled} onChange={(endMode) => set({ endMode })} />
          <Choices
            label="Time limit"
            value={value.timeLimit}
            options={TIME_LIMITS}
            disabled={disabled}
            onChange={(timeLimit) => set({ timeLimit })}
            hint="When the clock runs out, the richest by net worth wins."
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
                hint={timersOn ? 'Buying, taxes, jail and other quick choices.' : 'Off with the turn timer.'}
              />
              <Choices
                label="Debt timer"
                value={value.debtTimer}
                options={DEBT_TIMERS}
                disabled={disabled || !timersOn}
                onChange={(debtTimer) => set({ debtTimer })}
                hint={timersOn ? 'Time to raise cash when you owe more than you have.' : 'Off with the turn timer.'}
              />
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
            options={BOT_SKILLS}
            disabled={disabled}
            onChange={(botSkill) => set({ botSkill })}
            hint={online ? 'The level of a bot you add, and of a bot playing for someone who is away.' : 'The level of a bot you add.'}
          />
          <Choices label="Trading" value={value.trading} options={TRADING} disabled={disabled} onChange={(trading) => set({ trading })} />
          {value.trading === 'afterLap' && (
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
 * The rules' name: "Classic rules", "Classic + Speed Die", "Fast rules", "House rules"; "· custom" when changed beyond
 * that. `short`: without "rules" (the waiting room's tab).
 */
export function rulesTitle(d: RulesDraft, short = false): string {
  const preset = presetOf(d);
  if (preset === 'fast') return short ? 'Fast' : 'Fast rules';
  const house = preset === 'house' || presetOf({ ...d, speedDie: false, triplesRollAgain: true }) === 'house';
  const base = house ? 'House rules' : 'Classic';
  const custom = presetOf({ ...d, speedDie: false, triplesRollAgain: true }) === 'custom';
  const name = d.speedDie ? `${base} + Speed Die` : house || short ? base : 'Classic rules';
  return custom ? `${name} · custom` : name;
}

/** The rules as a short list (what a player who can't change them sees): the basics, then whatever isn't the default */
export function RulesSummary({ value, online = false }: { value: RulesDraft; online?: boolean }) {
  const preset = presetOf(value);
  const board = getBoard(value.board);
  const rows: [string, string][] = [
    ['Board', board.display.name],
    ['Rules', value.speedDie ? 'Classic with the Speed Die' : 'Classic'],
    ...(preset === 'fast' || preset === 'house' ? [['Preset', presetChoices(value.board).find((c) => c.value === preset)?.label ?? ''] as [string, string]] : []),
    ['Starting cash', `${money(value.startCash)}${value.speedDie ? ` + ${money(DEFAULT_RULES.speedBonus)} (Speed Die)` : ''}`],
    [taxName(board, 'luxury'), money(value.luxuryTax)],
    ...(value.speedDie ? [['Triples', value.triplesRollAgain ? 'Move anywhere, then roll again' : 'Move anywhere'] as [string, string]] : []),
    ['Turn limit', value.turnLimit > 0 ? `${value.turnLimit} turns, then ranked by net worth` : 'None'],
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
