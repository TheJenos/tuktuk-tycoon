/*
 * Generic board icons as SVG path data in a 100 x 100 box, drawn with Path2D. Simple silhouettes only: no
 * copyrighted board art.
 */

export type IconName = 'rail' | 'bulb' | 'tap' | 'ring' | 'coins' | 'chest' | 'car' | 'lock' | 'arrow' | 'bus' | 'tuktuk';

const circle = (cx: number, cy: number, r: number) =>
  `M${cx - r} ${cy} a${r} ${r} 0 1 0 ${2 * r} 0 a${r} ${r} 0 1 0 ${-2 * r} 0 Z`;

const PATHS: Record<IconName, string> = {
  // A steam locomotive facing left on a rail
  rail: [
    'M22 36 H62 V64 H22 Z',
    'M58 20 H86 V64 H58 Z',
    'M54 16 H90 V22 H54 Z',
    'M28 18 H38 V36 H28 Z',
    'M24 14 H42 V20 H24 Z',
    'M22 52 L8 68 H22 Z',
    'M64 26 H80 V38 H64 Z',
    circle(33, 70, 9),
    circle(55, 70, 9),
    circle(77, 71, 7),
    'M4 82 H96 V87 H4 Z',
  ].join(' '),
  bulb: [
    'M50 8 C28 8 18 26 26 42 C30 50 36 54 36 66 H64 C64 54 70 50 74 42 C82 26 72 8 50 8 Z',
    'M36 70 H64 V77 H36 Z',
    'M38 80 H62 V86 H38 Z',
    'M43 89 H57 V93 H43 Z',
  ].join(' '),
  tap: [
    'M14 30 H58 V22 H50 V16 H76 V22 H68 V30 H86 V44 H68 V52 H58 V44 H30 V62 H14 Z',
    'M22 70 C16 80 18 88 22 88 C26 88 28 80 22 70 Z',
  ].join(' '),
  ring: ['M50 6 L64 20 L50 34 L36 20 Z', 'M50 34 A28 28 0 1 0 50.01 34 Z M50 42 A20 20 0 1 1 49.99 42 Z'].join(' '),
  coins: ['M22 74 H78 V86 H22 Z', 'M26 60 H74 V72 H26 Z', 'M22 46 H78 V58 H22 Z', 'M28 32 H72 V44 H28 Z'].join(' '),
  chest: [
    'M14 46 H86 V86 H14 Z',
    'M14 42 C14 24 30 18 50 18 C70 18 86 24 86 42 Z',
    'M45 40 H55 V60 H45 Z',
  ].join(' '),
  car: ['M8 64 L14 48 L32 40 L44 28 H66 L80 42 L92 46 V64 Z', circle(28, 66, 10), circle(74, 66, 10)].join(' '),
  lock: ['M24 46 H76 V90 H24 Z', 'M34 46 V32 A16 16 0 0 1 66 32 V46 H58 V32 A8 8 0 0 0 42 32 V46 Z'].join(' '),
  arrow: 'M96 38 H38 V20 L4 50 L38 80 V62 H96 Z',
  bus: [
    'M8 24 C8 18 12 16 18 16 H86 C92 16 94 20 94 26 V70 H8 Z',
    circle(26, 72, 10),
    circle(76, 72, 10),
  ].join(' '),
  // A tuk-tuk side-on (the Speed Die's Tuk-Tuk Uncle face): canopy hood, body, big rear and small front wheel
  tuktuk: [
    'M10 64 C8 36 18 20 36 20 H66 C74 20 78 24 80 30 L82 48 H74 L72 34 C71 31 69 29 66 29 H37 C25 29 18 40 20 64 Z',
    'M10 48 H80 L91 66 C92 70 90 73 86 74 L80 76 H18 C13 76 10 72 10 67 Z',
    circle(28, 76, 11),
    circle(80, 78, 8),
  ].join(' '),
};

/** Cut-outs drawn in the background colour on top of an icon (train and bus windows, the lock's keyhole) */
const HOLES: Partial<Record<IconName, string>> = {
  rail: 'M64 26 H80 V38 H64 Z',
  bus: 'M16 24 H30 V42 H16 Z M36 24 H52 V42 H36 Z M58 24 H74 V42 H58 Z M80 24 H88 V42 H80 Z',
  lock: `${circle(50, 62, 6)} M47 64 H53 V78 H47 Z`,
  tuktuk: 'M22 52 H48 V64 H24 Z M52 52 H74 L80 64 H52 Z',
};

const cache = new Map<string, Path2D>();
const path = (d: string): Path2D => {
  let p = cache.get(d);
  if (!p) {
    p = new Path2D(d);
    cache.set(d, p);
  }
  return p;
};

/** Draws icon `name` centred at (x, y), `size` wide, in `color`; holes in `hole` (a band or the face colour) */
export function drawIcon(ctx: CanvasRenderingContext2D, name: IconName, x: number, y: number, size: number, color: string, hole?: string): void {
  ctx.save();
  ctx.translate(x - size / 2, y - size / 2);
  ctx.scale(size / 100, size / 100);
  ctx.fillStyle = color;
  ctx.fill(path(PATHS[name]), 'evenodd');
  const h = HOLES[name];
  if (h && hole) {
    ctx.fillStyle = hole;
    ctx.fill(path(h), 'evenodd');
  }
  ctx.restore();
}
