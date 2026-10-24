import type { RoomRules } from '../../net/network';
import { DEFAULT_RULES, getBoard, type RulesConfig } from '../../rules';
import { ONLINE_TIMERS, type TimerRules } from '../../shared/timing';
import { money, startName, taxName } from '../game/format';
import { Choices, Toggle, type Choice } from './Choices';

/*
 * The house rules a table can change, as one form for the local game, the room wizard and the waiting room. Every
 * other rule is the rulebook's (see docs/rules.md).
 */

export interface RulesDraft {
  speedDie: boolean;
  startCash: number;
  luxuryTax: number;
  triplesRollAgain: boolean;
  /** Turns played by everyone together before the game ends ranked by net worth; 0 = none */
  turnLimit: number;
  /** Online only: seconds per turn (0 = no timers on human decisions) */
  turnTimer: number;
}

export const DEFAULT_DRAFT: RulesDraft = {
  speedDie: DEFAULT_RULES.speedDie,
  startCash: DEFAULT_RULES.startCash,
  luxuryTax: DEFAULT_RULES.luxuryTax,
  triplesRollAgain: DEFAULT_RULES.triplesRollAgain,
  turnLimit: 0,
  turnTimer: ONLINE_TIMERS.turn,
};

/** The board every table plays on (names for the labels below) */
const BOARD = getBoard(DEFAULT_RULES.board);

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

/** Engine rules from the draft */
export const draftRules = (d: RulesDraft): Partial<RulesConfig> => ({
  speedDie: d.speedDie,
  startCash: d.startCash,
  luxuryTax: d.luxuryTax,
  triplesRollAgain: d.triplesRollAgain,
  turnLimit: d.turnLimit,
});

/** Online timers from the turn timer: the other human decisions follow it (all off with it) */
export function draftTimers(turnTimer: number): TimerRules {
  if (turnTimer <= 0) return { turn: 0, decision: 0, auction: ONLINE_TIMERS.auction, debt: 0 };
  return { turn: turnTimer, decision: Math.min(ONLINE_TIMERS.decision, turnTimer), auction: ONLINE_TIMERS.auction, debt: ONLINE_TIMERS.debt };
}

/** A room's stored rules as a draft */
export const roomDraft = (r: RoomRules): RulesDraft => ({
  speedDie: r.speedDie,
  startCash: r.startCash,
  luxuryTax: r.luxuryTax,
  triplesRollAgain: r.triplesRollAgain,
  turnLimit: r.turnLimit,
  turnTimer: r.turnTimer,
});

/** The room-rules patch for a draft change (a new turn timer brings the other timers along) */
export function roomPatch(patch: Partial<RulesDraft>): Partial<RoomRules> {
  const { turnTimer, ...rest } = patch;
  if (turnTimer === undefined) return rest;
  const t = draftTimers(turnTimer);
  return { ...rest, turnTimer: t.turn, decisionTimer: t.decision, debtTimer: t.debt };
}

export function RulesForm({ value, onChange, online = false, disabled = false }: {
  value: RulesDraft;
  onChange(patch: Partial<RulesDraft>): void;
  /** Shows the turn timer */
  online?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="lobby-form rules-form">
      <Toggle
        label="Speed Die"
        checked={value.speedDie}
        disabled={disabled}
        onChange={(speedDie) => onChange({ speedDie })}
        hint={`A red third die for a faster game: Bus and Tuk-Tuk Uncle faces, and ${money(DEFAULT_RULES.speedBonus)} more each at the start. You roll it once you have first passed ${startName(BOARD)}.`}
      />
      <Toggle
        label="Triples roll again"
        checked={value.triplesRollAgain}
        disabled={disabled || !value.speedDie}
        onChange={(triplesRollAgain) => onChange({ triplesRollAgain })}
        hint="Speed Die triples: move to any space, then roll again."
      />
      <Choices label="Starting cash" value={value.startCash} options={CASH} disabled={disabled} onChange={(startCash) => onChange({ startCash })} />
      <Choices label={taxName(BOARD, 'luxury')} value={value.luxuryTax} options={LUXURY} disabled={disabled} onChange={(luxuryTax) => onChange({ luxuryTax })} />
      <Choices
        label="Turn limit"
        value={value.turnLimit}
        options={LIMITS}
        disabled={disabled}
        onChange={(turnLimit) => onChange({ turnLimit })}
        hint="Turns by everyone together; then the richest by net worth wins."
      />
      {online && (
        <Choices
          label="Turn timer"
          value={value.turnTimer}
          options={TIMERS}
          disabled={disabled}
          onChange={(turnTimer) => onChange({ turnTimer })}
          hint="A player who runs out of time twice in a row is played by a bot until they're back."
        />
      )}
    </div>
  );
}

/** The rules as a short list (what a player who can't change them sees) */
export function RulesSummary({ value, online = false }: { value: RulesDraft; online?: boolean }) {
  const rows: [string, string][] = [
    ['Rules', value.speedDie ? 'Classic with the Speed Die' : 'Classic'],
    ['Starting cash', `${money(value.startCash)}${value.speedDie ? ` + ${money(DEFAULT_RULES.speedBonus)} (Speed Die)` : ''}`],
    [taxName(BOARD, 'luxury'), money(value.luxuryTax)],
    ...(value.speedDie ? [['Triples', value.triplesRollAgain ? 'Move anywhere, then roll again' : 'Move anywhere'] as [string, string]] : []),
    ['Turn limit', value.turnLimit > 0 ? `${value.turnLimit} turns, then ranked by net worth` : 'None'],
    ...(online ? [['Turn timer', value.turnTimer > 0 ? `${value.turnTimer} s` : 'Off'] as [string, string]] : []),
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

/** One line: "Classic · Rs. 1,500" / "Speed Die · Rs. 2,000 · 200 turns" */
export function rulesLine(d: RulesDraft): string {
  return [d.speedDie ? 'Speed Die' : 'Classic', money(d.startCash), d.turnLimit > 0 ? `${d.turnLimit} turns` : null].filter(Boolean).join(' · ');
}
