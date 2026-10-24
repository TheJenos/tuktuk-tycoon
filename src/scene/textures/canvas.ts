import { CanvasTexture, LinearMipmapLinearFilter, SRGBColorSpace } from 'three';

/*
 * Canvas drawing helpers for every procedural texture (board, cards, dice faces, labels). Text uses the system's
 * condensed sans faces (nothing is downloaded) and shrinks to fit, so any font the machine has still fits its box.
 */

export const FONT =
  "'Bahnschrift SemiCondensed', Bahnschrift, 'DIN Condensed', 'Arial Narrow', 'Roboto Condensed', 'Helvetica Neue', Arial, system-ui, sans-serif";

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function toTexture(canvas: HTMLCanvasElement, anisotropy = 4): CanvasTexture {
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = anisotropy;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  return t;
}

/** Fonts are set this many times larger and the context scaled down: tiny sizes in board units stay crisp */
const K = 100;

export interface TextOpts {
  weight?: number;
  color?: string;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  /** Never shrink below this size */
  minSize?: number;
}

const font = (weight: number, size: number) => `${weight} ${size * K}px ${FONT}`;

/** Draws one line at (x, y), shrunk to fit `maxWidth`; returns the size used */
export function fitText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, maxWidth: number, o: TextOpts = {}): number {
  const weight = o.weight ?? 700;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1 / K, 1 / K);
  ctx.font = font(weight, size);
  const w = ctx.measureText(text).width / K;
  const used = w > maxWidth ? Math.max(o.minSize ?? 0, (size * maxWidth) / w) : size;
  if (used !== size) ctx.font = font(weight, used);
  ctx.fillStyle = o.color ?? '#111';
  ctx.textAlign = o.align ?? 'center';
  ctx.textBaseline = o.baseline ?? 'middle';
  ctx.fillText(text, 0, 0);
  ctx.restore();
  return used;
}

/** Splits text into at most `maxLines` lines of `maxWidth`, shrinking the size until it fits */
export function wrapText(ctx: CanvasRenderingContext2D, text: string, size: number, maxWidth: number, maxLines: number, weight = 700): { lines: string[]; size: number } {
  const words = text.split(/\s+/).filter(Boolean);
  ctx.save();
  let s = size;
  let lines: string[] = [];
  for (let attempt = 0; attempt < 12; attempt++) {
    ctx.font = font(weight, s);
    const width = (t: string) => ctx.measureText(t).width / K;
    lines = [];
    let line = '';
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (line && width(next) > maxWidth) {
        lines.push(line);
        line = w;
      } else line = next;
    }
    if (line) lines.push(line);
    const widest = Math.max(0, ...lines.map(width));
    if (lines.length <= maxLines && widest <= maxWidth) break;
    s *= lines.length > maxLines ? 0.88 : Math.max(0.6, maxWidth / widest);
  }
  ctx.restore();
  return { lines, size: s };
}

/** Wrapped, centred lines around (x, y) */
export function drawLines(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, maxWidth: number, maxLines: number, o: TextOpts & { lineHeight?: number } = {}): void {
  const { lines, size: s } = wrapText(ctx, text, size, maxWidth, maxLines, o.weight ?? 700);
  const lh = s * (o.lineHeight ?? 1.08);
  const top = y - ((lines.length - 1) * lh) / 2;
  lines.forEach((line, i) => fitText(ctx, line, x, top + i * lh, s, maxWidth, o));
}

/** A rounded rectangle path */
export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
