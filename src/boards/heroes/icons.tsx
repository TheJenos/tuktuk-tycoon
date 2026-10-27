import type { ReactNode } from 'react';

/*
 * Hero League's token silhouettes (24x24 viewBox; ids = the heroes' ids, src/boards/heroes/theme.ts). Each is a glyph of
 * plain path data, so the same shape is drawn as SVG here and on a canvas (the Hero die's faces, Path2D): `d` filled
 * (even-odd: inner shapes are holes), `line` stroked with round ends, `cut` filled in the background colour.
 */

export interface HeroGlyph {
  d: string;
  line?: string;
  /** Stroke width of `line` */
  w?: number;
  cut?: string;
}

const circle = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`;
const ellipse = (cx: number, cy: number, rx: number, ry: number) =>
  `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0z`;

/** A five-point star, point up */
function star(cx: number, cy: number, outer: number, inner: number): string {
  const pts = Array.from({ length: 10 }, (_, k) => {
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    const r = k % 2 ? inner : outer;
    return `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
  });
  return `M${pts.join('L')}z`;
}

export const HERO_GLYPHS: Record<string, HeroGlyph> = {
  // Jade Titan: a clenched fist raised on its wrist, four knuckles on top, the thumb across the front
  jadeTitan: {
    d: 'M5 8.6C5 6.7 6.2 5.3 7.8 5.3 8.6 4.3 9.7 4 10.7 4.5 11.5 3.7 12.7 3.6 13.7 4.2 14.7 3.7 16 3.9 16.8 4.8 18.4 4.9 19.4 6.2 19.4 7.9V12.6C19.4 15.3 17.7 17 15.6 17.4V22.4H8.4V17.2C6.3 16.6 5 14.7 5 12.6Z',
    cut: 'M8.3 6.2h.9v4.3h-.9zM11.6 5.7h.9v4.8h-.9zM14.9 5.7h.9v4.8h-.9zM6 11.6h9.8v.9H6zM8.4 19.1h7.2v1H8.4z',
  },
  // Star Captain: a five-point star cut through a kite-shaped crest (pointed at the foot, not round)
  starCaptain: {
    d: `M12 1.6 20.6 4.6C20.6 12.2 17.6 18.5 12 22.5 6.4 18.5 3.4 12.2 3.4 4.6Z${star(12, 10.6, 5.2, 2.1)}`,
    cut: 'M12 3.6 18.7 6C18.4 11.8 16.1 16.9 12 20.2 7.9 16.9 5.6 11.8 5.3 6Z M12 4.6 6.3 6.6C6.6 11.6 8.6 16 12 19 15.4 16 17.4 11.6 17.7 6.6Z',
  },
  // Steel Ace: a winged jet seen from above, nose up: swept wings, tailplanes, the canopy
  steelAce: {
    d: 'M12 1.4C13.3 3 13.7 5.5 13.7 8L21.6 14.4V16.7L13.7 13.7V18.2L16.5 20.4V22.2L12 21.1 7.5 22.2V20.4L10.3 18.2V13.7L2.4 16.7V14.4L10.3 8C10.3 5.5 10.7 3 12 1.4Z',
    cut: 'M11.2 5.8C11.2 4.7 11.5 3.9 12 3.3 12.5 3.9 12.8 4.7 12.8 5.8V7.6H11.2Z',
  },
  // Storm Lord: a zig-zag lightning bolt striking down, a bright streak down its middle
  stormLord: {
    d: 'M8 1.4H16.6L12.9 8.6H19.2L7.1 22.7 10.3 12.9H4.9Z',
    cut: 'M13.4 3 9.2 3 7.2 11.2H8.9Z',
  },
  // Velvet Viper: a snake coiled on itself, its neck rising to a head that faces right, tongue out
  velvetViper: {
    d: `${ellipse(12, 19.3, 9, 2.8)}${ellipse(12, 14.3, 6.4, 2)}${ellipse(14.6, 5.2, 3.3, 1.9)}M17.9 4.95H20L21.7 3.9 20.7 5.2 21.7 6.5 20 5.45H17.9Z`,
    line: 'M9.3 13C6.8 10.6 8.4 7.6 12 6',
    w: 2.6,
    cut: circle(15.7, 4.7, 0.65),
  },
  // Sharpshot: a bullseye of rings with an arrow in its centre, fletched end up to the right
  sharpshot: {
    d: `${circle(10.2, 13.8, 9)}${circle(10.2, 13.8, 7)}${circle(10.2, 13.8, 5)}${circle(10.2, 13.8, 3)}${circle(10.2, 13.8, 1.4)}M18.4 2.7 22.5 1.5 21.3 5.6 20.4 4.3 19.7 3.6Z`,
    line: 'M10.6 13.4 20.4 3.6',
    w: 1.5,
  },
};

const BG = 'var(--panel-bg, #151a24)';

function icon(g: HeroGlyph): ReactNode {
  return (
    <>
      <path d={g.d} fillRule="evenodd" />
      {g.line && <path d={g.line} fill="none" stroke="currentColor" strokeWidth={g.w ?? 1.5} strokeLinecap="round" />}
      {g.cut && <path d={g.cut} fill={BG} fillRule="evenodd" />}
    </>
  );
}

/** Hero League's token silhouettes (24x24 viewBox) */
export const HEROES_ICONS: Record<string, ReactNode> = Object.fromEntries(
  Object.entries(HERO_GLYPHS).map(([id, g]) => [id, icon(g)]),
);
