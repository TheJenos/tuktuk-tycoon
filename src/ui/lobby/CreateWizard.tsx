import { useState, type ReactNode } from 'react';
import type { BotSkill } from '../../net/types';
import { boardTokens, tokenOn, type TokenId } from '../../shared/tokens';
import { Choices, type Choice } from './Choices';
import { DEFAULT_DRAFT, RulesForm, RulesSummary, rulesLine, rulesTitle, type RulesDraft } from './RulesForm';
import { TokenPicker } from './TokenPicker';
import { Wizard } from './Wizard';
import { useMenuBoard } from './useMenuBoard';
import { freeBotName, maxSeatsFor, MIN_SEATS, SKILLS, skillLabel } from './seats';

/*
 * Opening an online room: the rules, then the table (how many seats, which bots, your token), then the room itself
 * (its name, and whether it's listed). The same steps start a Discord voice channel's table, without the last one's
 * fields.
 */

export interface RoomPlan {
  rules: RulesDraft;
  maxSeats: number;
  bots: BotSkill[];
  token: TokenId;
  name: string;
  public: boolean;
}

/** The seat counts a board allows */
const seatCounts = (board: string): Choice<number>[] =>
  Array.from({ length: maxSeatsFor(board) - MIN_SEATS + 1 }, (_, i) => ({ value: i + MIN_SEATS, label: String(i + MIN_SEATS) }));
const VISIBILITY: Choice<'public' | 'private'>[] = [
  { value: 'public', label: 'Public', hint: 'Listed in Rooms for anyone to join' },
  { value: 'private', label: 'Private', hint: 'Only people with the code or link' },
];

export function newRoomPlan(): RoomPlan {
  return { rules: DEFAULT_DRAFT, maxSeats: Math.min(6, maxSeatsFor(DEFAULT_DRAFT.board)), bots: [], token: boardTokens(DEFAULT_DRAFT.board)[0] as TokenId, name: '', public: true };
}

/** The plan with new rules: on another board, its seats fit that board and the token is that board's own */
export function withRules(plan: RoomPlan, patch: Partial<RulesDraft>): RoomPlan {
  const rules = { ...plan.rules, ...patch };
  if (rules.board === plan.rules.board) return { ...plan, rules };
  const maxSeats = Math.min(plan.maxSeats, maxSeatsFor(rules.board));
  return { ...plan, rules, maxSeats, bots: plan.bots.slice(0, maxSeats - 1), token: tokenOn(rules.board, plan.token) };
}

/** The table step: seats, bots and your token */
export function TableStep({ plan, onChange }: { plan: RoomPlan; onChange(p: Partial<RoomPlan>): void }) {
  const board = plan.rules.board;
  const names = plan.bots.reduce<string[]>((acc) => [...acc, freeBotName(acc.map((n) => ({ name: n })), board)], []);
  const room = plan.maxSeats - 1 - plan.bots.length;
  return (
    <div className="lobby-form">
      <Choices
        label="Seats"
        value={plan.maxSeats}
        options={seatCounts(board)}
        onChange={(maxSeats) => onChange({ maxSeats, bots: plan.bots.slice(0, maxSeats - 1) })}
        hint="Everyone who joins takes a free seat; once they're all taken, people watch."
      />
      <div className="lobby-setting">
        <span className="lobby-setting-label">Bots</span>
        <div className="bot-list">
          {plan.bots.length === 0 && <span className="muted">None yet: you can add some in the waiting room too.</span>}
          {plan.bots.map((skill, i) => (
            <span key={i} className="bot-chip">
              <span className="badge bot">Bot</span>
              <span>{names[i]}</span>
              <label>
                <span className="sr-only">{names[i]}'s level</span>
                <select value={skill} onChange={(e) => onChange({ bots: plan.bots.map((b, j) => (j === i ? (e.target.value as BotSkill) : b)) })}>
                  {SKILLS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                </select>
              </label>
              <button type="button" className="icon-button" aria-label={`Remove ${names[i]}`} title="Remove" onClick={() => onChange({ bots: plan.bots.filter((_, j) => j !== i) })}>
                ✕
              </button>
            </span>
          ))}
          <button type="button" disabled={room <= 0} onClick={() => onChange({ bots: [...plan.bots, plan.rules.botSkill] })}>＋ Add a bot</button>
        </div>
      </div>
      <div className="lobby-setting">
        <span className="lobby-setting-label">Your token</span>
        <TokenPicker board={board} label="Your token" value={plan.token} taken={[]} onPick={(token) => onChange({ token })} />
      </div>
    </div>
  );
}

export function CreateWizard({ you, busy, error, onCreate, onExit }: {
  you: string;
  busy: boolean;
  error: string;
  onCreate(plan: RoomPlan): void;
  onExit?: () => void;
}) {
  const [plan, setPlan] = useState<RoomPlan>(newRoomPlan);
  useMenuBoard(plan.rules.board);
  const change = (p: Partial<RoomPlan>) => setPlan((cur) => ({ ...cur, ...p }));
  const steps = [{ id: 'rules', label: 'Rules' }, { id: 'seats', label: 'Seats' }, { id: 'launch', label: 'Launch' }];
  return (
    <Wizard
      steps={steps}
      launchLabel="Create room"
      busyLabel="Creating…"
      busy={busy}
      error={error}
      note="You'll get a code and a link to share once you're in."
      onExit={onExit}
      onLaunch={() => onCreate(plan)}
      render={(i, go) => {
        if (i === 0) return <RulesForm online value={plan.rules} onChange={(p) => setPlan((cur) => withRules(cur, p))} />;
        if (i === 1) return <TableStep plan={plan} onChange={change} />;
        return (
          <LaunchStep plan={plan} go={go}>
            <label className="field">
              <span>Room name</span>
              <input value={plan.name} onChange={(e) => change({ name: e.target.value })} maxLength={24} placeholder={`${you}'s room`} autoComplete="off" />
            </label>
            <Choices
              label="Who can find it"
              value={plan.public ? 'public' : 'private'}
              options={VISIBILITY}
              onChange={(v) => change({ public: v === 'public' })}
              hint={plan.public ? 'Listed in Rooms for anyone to join.' : 'Not listed: only people with the code or the link can come in.'}
            />
          </LaunchStep>
        );
      }}
    />
  );
}

/** The last step's summary: each choice a button back to its step, then the step's own fields */
export function LaunchStep({ plan, go, children }: { plan: RoomPlan; go(i: number): void; children?: ReactNode }) {
  const bots = plan.bots.length;
  return (
    <>
      <div className="launch-summary">
        <button type="button" className="launch-pick" onClick={() => go(0)} aria-label="Rules. Change">
          <span className="text">
            <strong>{rulesTitle(plan.rules)}</strong>
            <small className="muted">{rulesLine(plan.rules)}{plan.rules.turnTimer ? ` · ${plan.rules.turnTimer} s turns` : ' · no timer'}</small>
          </span>
          <span className="change" aria-hidden="true">Change</span>
        </button>
        <button type="button" className="launch-pick" onClick={() => go(1)} aria-label={`${plan.maxSeats} seats. Change`}>
          <span className="text">
            <strong>{plan.maxSeats} seats</strong>
            <small className="muted">
              {bots ? `${bots} bot${bots > 1 ? 's' : ''} (${plan.bots.map(skillLabel).join(', ')})` : 'No bots'} · {plan.maxSeats - 1 - bots} for friends
            </small>
          </span>
          <span className="change" aria-hidden="true">Change</span>
        </button>
      </div>
      {children}
      <details className="launch-rules">
        <summary>All the rules</summary>
        <RulesSummary value={plan.rules} online />
      </details>
    </>
  );
}
