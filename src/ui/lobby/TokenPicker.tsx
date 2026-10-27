import { useId } from 'react';
import { getBoard } from '../../rules';
import { SEAT_COLORS, boardTokens, tokenOn, type TokenId } from '../../shared/tokens';
import { safeColor } from '../colors';
import { TokenIcon, tokenLabel } from '../game/tokenIcons';

/**
 * The board's tokens as a radio group; ones another seat holds can't be picked. A token from another board's set
 * counts as the same slot of this board's (tokenOn), as the game shows it. On Hero League each token is a hero: the
 * picked one's superpower is described under the group.
 */
export function TokenPicker({ board, value, taken, onPick, label, color, disabled }: {
  /** Whose set to offer */
  board: string;
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
  const describe = useId();
  const current = tokenOn(board, value);
  const held = taken.map((t) => tokenOn(board, t));
  const heroes = getBoard(board).heroes?.list ?? [];
  const hero = heroes.find((h) => h.id === current);
  const group = (
    <div className="token-picker" role="radiogroup" aria-label={label} aria-describedby={hero ? describe : undefined}>
      {boardTokens(board).map((id) => {
        const name = tokenLabel(id);
        const power = heroes.find((h) => h.id === id)?.powerName;
        const mine = id === current;
        const gone = !mine && held.includes(id);
        const tip = power ? `${name} · ${power}` : name;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={mine}
            aria-label={gone ? `${name} (taken)` : name}
            title={gone ? `${tip}: someone has it` : tip}
            className={mine ? 'token-opt selected' : 'token-opt'}
            style={mine ? { color: safeColor(color) } : undefined}
            disabled={disabled || gone}
            onClick={() => onPick(id)}
          >
            <TokenIcon token={id} size={24} />
          </button>
        );
      })}
    </div>
  );
  if (!heroes.length) return group;
  return (
    <div className="hero-picker">
      {group}
      {hero && (
        <p className="hero-power" id={describe}>
          <strong>{hero.name}</strong> · {hero.powerName}: {hero.powerText}
        </p>
      )}
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

/** A seat's token in its colour (as `board` shows it), named for screen readers when `named` */
export function SeatToken({ token, color, size = 28, named, board }: { token: string; color?: string; size?: number; named?: boolean; board?: string }) {
  const t = board ? tokenOn(board, token) : token;
  return (
    <span className="seat-token" style={{ color: safeColor(color) }}>
      <TokenIcon token={t} size={size} {...(named ? { label: tokenLabel(t) } : {})} />
    </span>
  );
}
