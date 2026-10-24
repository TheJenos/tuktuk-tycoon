import type { ReactNode } from 'react';
import { TOKENS, type TokenId } from '../../shared/tokens';
import { safeColor } from '../colors';

/*
 * Flat silhouettes of the eight tokens (the same shapes as the 3D pieces), for the players panel, owner marks and the
 * MiniBoard, so the token shape and not only the seat colour says whose it is. Drawn in the seat's colour when one
 * is given, else in currentColor.
 */

const SHAPES: Record<TokenId, ReactNode> = {
  // Canopy hood, open-sided body, big rear wheel and small front wheel
  tuktuk: (
    <>
      <path d="M2.5 15.5C2 9 4.5 5 9 5h7.5c2 0 3 1 3.3 2.6l.6 4.4h-2l-.5-3.6c-.1-.8-.6-1.2-1.4-1.2H9.2c-3 0-4.6 2.6-4.3 8.3z" />
      <path d="M2.5 12h17.3l2.7 4.6c.4.8 0 1.6-.8 1.9l-1.6.5H4.5c-1.3 0-2-.9-2-2.2z" />
      <circle cx="7" cy="18.5" r="2.6" />
      <circle cx="19" cy="19" r="2" />
    </>
  ),
  // Side-on elephant with its trunk curled down
  elephant: (
    <>
      <path d="M3 10.5C3 7 6 5 10 5c2.6 0 4.6.8 5.8 2.2.6-.5 1.4-.7 2.2-.7 2.3 0 3.5 1.8 3.5 4.2v3.1c0 1.6.4 2.6 1 3.4l-1.4 1.1c-1.1-1.1-1.7-2.6-1.7-4.4v-1.4h-1.1v6.5h-2.6v-3.5H9.8v3.5H7.2v-3.7C4.5 15 3 13.1 3 10.5z" />
      <path d="M13.5 7.5c-1.4.6-2 2-1.5 3.6l2.6 1.2" fill="none" stroke="var(--panel-bg, #151a24)" strokeWidth="1.1" strokeLinecap="round" />
    </>
  ),
  // King coconut with its top cut and a straw
  coconut: (
    <>
      <path d="M12 7.5c4 0 6.5 3.5 6.5 7.5S15.8 22 12 22s-6.5-3-6.5-7 2.5-7.5 6.5-7.5z" />
      <path d="M8.5 8.2 9.6 6h4.8l1.1 2.2z" />
      <path d="m13.3 7 3.4-5.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </>
  ),
  // Cricket bat leaning, with a ball
  cricket: (
    <>
      <path d="M13.8 2.2l2.1 1.2-2.5 4.4 1.1.7-5.9 10.3c-.6 1-1.8 1.3-2.8.8l-.6-.4c-1-.6-1.3-1.8-.8-2.8l5.9-10.3 1.1.6z" />
      <circle cx="17.5" cy="18.5" r="3" />
    </>
  ),
  // Cup of tea on a saucer, with steam
  tea: (
    <>
      <path d="M4.5 10.5h12.5c0 4.5-2.5 7.5-6.2 7.5s-6.3-3-6.3-7.5z" />
      <path d="M16.5 11.5h1.3a2.5 2.5 0 0 1 0 5h-1.6" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M2.5 19h16.5c-.6 1.6-2 2.5-3.6 2.5H6c-1.6 0-3-.9-3.5-2.5z" />
      <path d="M8.5 3.5c-1 1.2 1 2.2 0 3.6M12.5 3c-1 1.2 1 2.2 0 3.6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </>
  ),
  // Kandyan drum on its side: barrel, rims and lacing
  drum: (
    <>
      <path d="M4 7.5c3-1.3 13-1.3 16 0 1.3 1.4 1.8 2.9 1.8 4.5s-.5 3.1-1.8 4.5c-3 1.3-13 1.3-16 0C2.7 15.1 2.2 13.6 2.2 12s.5-3.1 1.8-4.5z" />
      <path d="M5 7.4v9.2M19 7.4v9.2M5 9.5l14 5M5 14.5l14-5" fill="none" stroke="var(--panel-bg, #151a24)" strokeWidth="1.1" />
      <path d="M6 19h12v2H6z" />
    </>
  ),
  // Oruwa outrigger canoe under sail
  oruwa: (
    <>
      <path d="M11.5 2v11H5.5z" />
      <path d="M13 4.5 18.5 13H13z" />
      <path d="M1.5 14.5h20l-2.8 3.5H4.3z" />
      <path d="M8 18v2.5M16 18v2.5M4 21h16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </>
  ),
  // New Year kite: a diamond with cross-sticks and a ribbon tail of bows
  kite: (
    <>
      <path d="M12 1.5l6 7.5-6 9-6-9z" />
      <path d="M12 1.5v16.5M6.3 9h11.4" fill="none" stroke="var(--panel-bg, #151a24)" strokeWidth="1" />
      <path d="M12 18c-1 1.8-3 2.4-4.5 3.8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M9.5 19.2l-1.6-1 .5 2zM7 21.6l-1.7-.7.8 1.8z" />
    </>
  ),
};

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
  const shape = SHAPES[token as TokenId] ?? <circle cx="12" cy="12" r="8" />;
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
