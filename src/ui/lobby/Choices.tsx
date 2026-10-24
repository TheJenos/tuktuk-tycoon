import { useId, type ReactNode } from 'react';

/*
 * The form pieces the lobby's steps are made of: a row of options (a radio group of buttons, as in Settings) and
 * an on/off switch, each on a labelled line.
 */

export interface Choice<V> {
  value: V;
  label: string;
  hint?: string;
}

/** A labelled line of options; the group is named by `label` (what tests and screen readers find it by) */
export function Choices<V extends string | number>({ label, value, options, onChange, disabled, hint }: {
  label: string;
  value: V;
  options: readonly Choice<V>[];
  onChange(v: V): void;
  disabled?: boolean;
  hint?: ReactNode;
}) {
  const id = useId();
  return (
    <div className={disabled ? 'lobby-setting disabled' : 'lobby-setting'}>
      <span className="lobby-setting-label" id={`${id}-label`}>{label}</span>
      <div className="lobby-choices" role="radiogroup" aria-labelledby={`${id}-label`} aria-describedby={hint ? `${id}-hint` : undefined}>
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            className={o.value === value ? 'lobby-choice selected' : 'lobby-choice'}
            title={o.hint}
            disabled={disabled}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
      {hint && <small className="muted lobby-hint" id={`${id}-hint`}>{hint}</small>}
    </div>
  );
}

/** An on/off switch with its label beside it */
export function Toggle({ label, checked, onChange, disabled, hint }: {
  label: string;
  checked: boolean;
  onChange(v: boolean): void;
  disabled?: boolean;
  hint?: ReactNode;
}) {
  const id = useId();
  return (
    <label className={disabled ? 'lobby-setting check disabled' : 'lobby-setting check'}>
      {/* Named by the label alone: the hint describes it */}
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-labelledby={`${id}-label`}
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
      <span className="lobby-check-text">
        <span className="lobby-setting-label" id={`${id}-label`}>{label}</span>
        {hint && <small className="muted" id={`${id}-hint`}>{hint}</small>}
      </span>
    </label>
  );
}
