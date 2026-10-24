import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { StepBar } from '../StepBar';
import { useEscape } from '../useDialogFocus';

/*
 * One decision at a time (Rules, then Seats, then the last step that starts it), as the reference's create flow:
 * any step already reached can be gone back to with the step bar, Back or Esc, and what was chosen stays chosen.
 * The last step is a form, so Enter in its fields starts it too. Shared by the local game, the room wizard and the
 * Discord lobby.
 */

export interface WizardStep {
  id: string;
  label: string;
}

export function Wizard({
  steps, render, launchLabel, busyLabel = 'Starting…', busy = false, disabled = false, blocked, onLaunch, error, note, onExit,
}: {
  steps: readonly WizardStep[];
  /** The body of step `i` (the last one is drawn inside the launch form) */
  render(i: number, go: (i: number) => void): ReactNode;
  launchLabel: string;
  busyLabel?: string;
  busy?: boolean;
  disabled?: boolean;
  /** Why the current step can't go on yet (shown, and Next / launch stay off) */
  blocked?: (i: number) => string | null;
  onLaunch(): void;
  /** Why it didn't work; else `note` says what happens */
  error?: string;
  note?: ReactNode;
  /** Esc on the first step */
  onExit?: () => void;
}) {
  const [step, setStep] = useState(0);
  const [reached, setReached] = useState(0);
  const body = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const formId = `${useId()}-launch`;
  const last = steps.length - 1;
  const go = (n: number) => {
    const i = Math.max(0, Math.min(last, n));
    setStep(i);
    setReached((r) => Math.max(r, i));
  };

  // Each new step starts at its top, with focus on it. Not on the first one: opening the tab keeps focus in the tabs.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    body.current?.scrollTo?.({ top: 0 });
    body.current?.focus({ preventScroll: true });
  }, [step]);

  useEscape(onExit || step > 0 ? () => (step > 0 ? setStep(step - 1) : onExit?.()) : undefined, root);

  const why = blocked?.(step) ?? null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!why && !disabled && !busy) onLaunch();
  };

  return (
    <div className="wizard" ref={root}>
      <StepBar steps={steps} step={step} reached={reached} onStep={setStep} />
      <div ref={body} className="wizard-body" tabIndex={-1} aria-label={`Step ${step + 1} of ${steps.length}: ${steps[step]?.label ?? ''}`}>
        {step < last ? render(step, go) : (
          <form id={formId} className="launch" onSubmit={submit}>
            {render(step, go)}
          </form>
        )}
      </div>
      <footer className="wizard-foot">
        {step > 0 ? <button type="button" onClick={() => setStep(step - 1)}>◂ Back</button> : <span />}
        <div className="wizard-foot-main">
          {why ? <p className="muted note" role="status">{why}</p> : error ? <p className="error" role="alert">{error}</p> : step === last && note ? <p className="muted note">{note}</p> : null}
          {/* Separate keys: turning the clicked Next into the submit button would submit on that same click */}
          {step < last ? (
            <button key="next" type="button" className="primary next" disabled={!!why} onClick={() => go(step + 1)}>
              Next: {steps[step + 1]?.label} ▸
            </button>
          ) : (
            <button key="launch" type="submit" form={formId} className="primary create-button" disabled={disabled || busy || !!why}>
              {busy ? <><span className="spinner" aria-hidden="true" />{busyLabel}</> : launchLabel}
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
