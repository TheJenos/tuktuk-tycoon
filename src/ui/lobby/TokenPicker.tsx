import { SEAT_COLORS, TOKENS, type TokenId } from '../../shared/tokens';
import { safeColor } from '../colors';
import { TokenIcon, tokenLabel } from '../game/tokenIcons';

/** The eight tokens as a radio group; ones another seat holds can't be picked */
export function TokenPicker({ value, taken, onPick, label, color, disabled }: {
  value: TokenId;
  /** Tokens other seats hold */
  taken: readonly string[];
  onPick(token: TokenId): void;
  /** The group's name, e.g. "Your token" */
  label: string;
  /** Drawn in the seat's colour */
  color?: string;
  disabled?: boolean;
}) {
  return (
    <div className="token-picker" role="radiogroup" aria-label={label}>
      {TOKENS.map((t) => {
        const mine = t.id === value;
        const gone = !mine && taken.includes(t.id);
        return (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={mine}
            aria-label={gone ? `${t.label} (taken)` : t.label}
            title={gone ? `${t.label}: someone has it` : t.label}
            className={mine ? 'token-opt selected' : 'token-opt'}
            style={mine ? { color: safeColor(color) } : undefined}
            disabled={disabled || gone}
            onClick={() => onPick(t.id)}
          >
            <TokenIcon token={t.id} size={24} />
          </button>
        );
      })}
    </div>
  );
}

/** The seat colours as a radio group; ones another seat holds can't be picked */
export function ColorPicker({ value, taken, onPick, label, disabled }: {
  value: string;
  taken: readonly string[];
  onPick(color: string): void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div className="color-picker" role="radiogroup" aria-label={label}>
      {SEAT_COLORS.map((c, i) => {
        const mine = c === value;
        const gone = !mine && taken.includes(c);
        const name = `Colour ${i + 1}`;
        return (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={mine}
            aria-label={gone ? `${name} (taken)` : name}
            className={mine ? 'color-opt selected' : 'color-opt'}
            style={{ background: c }}
            disabled={disabled || gone}
            onClick={() => onPick(c)}
          />
        );
      })}
    </div>
  );
}

/** A seat's token in its colour, named for screen readers when `named` */
export function SeatToken({ token, color, size = 28, named }: { token: string; color?: string; size?: number; named?: boolean }) {
  return (
    <span className="seat-token" style={{ color: safeColor(color) }}>
      <TokenIcon token={token} size={size} {...(named ? { label: tokenLabel(token) } : {})} />
    </span>
  );
}
