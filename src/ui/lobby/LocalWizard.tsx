import { useState } from 'react';
import { DEFAULT_DRAFT, RulesForm, RulesSummary, rulesLine, rulesTitle, type RulesDraft } from './RulesForm';
import { SeatsEditor, seatsProblem } from './SeatsEditor';
import { SeatToken } from './TokenPicker';
import { Wizard } from './Wizard';
import { skillLabel, startingSeats, type SeatDraft } from './seats';

const STEPS = [
  { id: 'rules', label: 'Rules' },
  { id: 'seats', label: 'Seats' },
  { id: 'start', label: 'Start' },
] as const;

/** A game on this device: the rules, who sits at the table (players taking turns here, and bots), then start */
export function LocalWizard({ you, busy, error, onStart }: {
  you: string;
  busy: boolean;
  error: string;
  onStart(rules: RulesDraft, seats: SeatDraft[]): void;
}) {
  const [rules, setRules] = useState<RulesDraft>(DEFAULT_DRAFT);
  const [seats, setSeats] = useState<SeatDraft[]>(() => startingSeats(you, { humans: 1, bots: 2 }));
  // Renamed in Settings meanwhile: the first seat follows
  const table = seats.map((s) => (s.kind === 'you' && s.name !== you ? { ...s, name: you } : s));

  return (
    <Wizard
      steps={STEPS}
      launchLabel="Start game"
      busy={busy}
      error={error}
      note="Saved as you play: Continue picks it up after a reload."
      blocked={(i) => (i >= 1 ? seatsProblem(table) : null)}
      onLaunch={() => onStart(rules, table)}
      render={(i, go) => {
        if (i === 0) return <RulesForm value={rules} onChange={(p) => setRules({ ...rules, ...p })} />;
        if (i === 1) return <SeatsEditor seats={table} onChange={setSeats} botSkill={rules.botSkill} />;
        return (
          <>
            <div className="launch-summary">
              <button type="button" className="launch-pick" onClick={() => go(0)} aria-label="Rules. Change">
                <span className="text">
                  <strong>{rulesTitle(rules)}</strong>
                  <small className="muted">{rulesLine(rules)}</small>
                </span>
                <span className="change" aria-hidden="true">Change</span>
              </button>
              <button type="button" className="launch-pick" onClick={() => go(1)} aria-label={`${table.length} players. Change`}>
                <span className="text">
                  <strong>{table.length} players</strong>
                  <small className="muted">
                    {table.filter((s) => s.kind !== 'bot').length} at this screen · {table.filter((s) => s.kind === 'bot').length} bots
                  </small>
                </span>
                <span className="change" aria-hidden="true">Change</span>
              </button>
            </div>
            <ul className="table-preview" aria-label="At the table">
              {table.map((s) => (
                <li key={s.key}>
                  <SeatToken token={s.token} color={s.color} size={22} named />
                  <span>{s.name}</span>
                  {s.kind === 'bot' ? <span className="badge bot" title="Bot">{skillLabel(s.skill)}</span> : s.kind === 'you' ? <span className="badge accent">You</span> : null}
                </li>
              ))}
            </ul>
            <RulesSummary value={rules} />
          </>
        );
      }}
    />
  );
}
