import type { ReactNode } from 'react';
import { COLOMBO_ICONS } from '../../boards/colombo/icons';
import { HILL_ICONS } from '../../boards/hill/icons';
import { LANKA_ICONS } from '../../boards/lanka/icons';
import { SOUTH_ICONS } from '../../boards/south/icons';
import { TOKENS } from '../../shared/tokens';
import { safeColor } from '../colors';

/*
 * Flat silhouettes of the tokens (the same shapes as the 3D pieces), for the players panel, owner marks and the
 * MiniBoard, so the token shape and not only the seat colour says whose it is. Drawn in the seat's colour when one
 * is given, else in currentColor. Each board's are in its folder (src/boards/<board>/icons.tsx).
 */

const SHAPES: Record<string, ReactNode> = { ...LANKA_ICONS, ...COLOMBO_ICONS, ...HILL_ICONS, ...SOUTH_ICONS };

export const tokenLabel = (token: string): string => TOKENS.find((t) => t.id === token)?.label ?? 'Token';

/**
 * A token's silhouette, in `color` (the seat's colour) when given. With `label` it is an image with that name (or the
 * token's own name for `label: true`); without one it is decoration beside text that already names the player.
 */
export function TokenIcon({ token, size = 20, label, className, color }: {
  token: string;
  size?: number;
  label?: string | true;
  className?: string;
  color?: string;
}) {
  const shape = SHAPES[token] ?? <circle cx="12" cy="12" r="8" />;
  const name = label === true ? tokenLabel(token) : label;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      className={className ? `token-icon ${className}` : 'token-icon'}
      style={color ? { color: safeColor(color) } : undefined}
      {...(name ? { role: 'img', 'aria-label': name } : { 'aria-hidden': true })}
      focusable="false"
    >
      {shape}
    </svg>
  );
}
