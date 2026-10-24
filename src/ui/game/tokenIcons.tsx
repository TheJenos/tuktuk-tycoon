import type { ReactNode } from 'react';
import { TOKENS, type TokenId } from '../../shared/tokens';

/*
 * Flat silhouettes of the eight tokens (the 3D pewter pieces), for the players panel, owner marks and the
 * MiniBoard, so the token shape and not only the seat colour says whose it is. Drawn in currentColor.
 */

const SHAPES: Record<TokenId, ReactNode> = {
  hat: (
    <>
      <path d="M7.5 3.5h9l-.6 11.5H8.1z" />
      <path d="M3 15.5c2.5-1.2 15.5-1.2 18 0v2.2c-2.5 1.6-15.5 1.6-18 0z" />
      <path d="M8 11.5h8v1.6H8z" opacity="0.45" />
    </>
  ),
  car: (
    <>
      <path d="M1.5 15.5 3 12l5-1 3.2-3h4.6l2.2 3 3.5 1 1 3.5v1.5H1.5z" />
      <circle cx="6.5" cy="17.5" r="2.4" />
      <circle cx="17.5" cy="17.5" r="2.4" />
    </>
  ),
  boat: (
    <>
      <path d="M11.5 2v12H4.5z" />
      <path d="M13 5.5l6.5 8.5H13z" />
      <path d="M2.5 15.5h19L18 20.5H6z" />
    </>
  ),
  rocket: (
    <>
      <path d="M12 1.5c3.4 2.4 5 6.4 5 10.5l-1.6 4.5H8.6L7 12c0-4.1 1.6-8.1 5-10.5z" />
      <path d="M7 12.5 3.5 17v3.5l4.5-2.5zM17 12.5l3.5 4.5v3.5L16 18z" />
      <path d="M9.8 17.5h4.4L12 22.5z" opacity="0.6" />
    </>
  ),
  crown: (
    <>
      <path d="M2.5 7.5 7 12l5-7 5 7 4.5-4.5-1.8 10H4.3z" />
      <path d="M4.3 18.5h15.4v2.5H4.3z" />
    </>
  ),
  anchor: (
    <g fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <circle cx="12" cy="4.5" r="2.2" />
      <path d="M12 6.8v14M7.5 10h9M3.5 13.5c.5 4 4 7 8.5 7s8-3 8.5-7" />
    </g>
  ),
  teapot: (
    <>
      <path d="M5.5 10h12c0 5.5-2.4 9.5-6 9.5s-6-4-6-9.5z" />
      <path d="M8.5 9.5c0-2 1.5-3.3 3.3-3.3s3.2 1.3 3.2 3.3z" />
      <circle cx="11.8" cy="5" r="1.3" />
      <path d="M17 12l5-3.5-1.4 5.8-3.6 2.4z" />
      <path d="M5.8 11.5c-3.6 0-3.6 5.5.6 5.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </>
  ),
  knight: (
    <>
      <path d="M7.5 19c0-3.5 2.4-5.3 4-7.2l-1-1.1-3 1.1-2-1.2 2.3-4.2 3.2-2.3.8-2.1c3.6.6 6.2 3.4 6.2 7.5 0 3.3-.8 6.3-.5 9.5z" />
      <path d="M5.5 19.2h13v2.8h-13z" />
    </>
  ),
};

export const tokenLabel = (token: string): string => TOKENS.find((t) => t.id === token)?.label ?? 'Token';

/**
 * A token's silhouette. With `label` it is an image with that name (or the token's own name for `label: true`);
 * without one it is decoration beside text that already names the player.
 */
export function TokenIcon({ token, size = 20, label, className }: { token: string; size?: number; label?: string | true; className?: string }) {
  const shape = SHAPES[token as TokenId] ?? <circle cx="12" cy="12" r="8" />;
  const name = label === true ? tokenLabel(token) : label;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      className={className ? `token-icon ${className}` : 'token-icon'}
      {...(name ? { role: 'img', 'aria-label': name } : { 'aria-hidden': true })}
      focusable="false"
    >
      {shape}
    </svg>
  );
}
