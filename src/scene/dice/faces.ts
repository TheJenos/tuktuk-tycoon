import { MeshStandardMaterial } from 'three';
import { HERO_GLYPHS, type HeroGlyph } from '../../boards/heroes/icons';
import type { HeroDef, SpeedFace } from '../../rules';
import { drawIcon } from '../board/icons';
import { fitText, makeCanvas, roundRect, toTexture } from '../textures/canvas';
import { BOX_GROUP_FACE, HERO_FACES, WHITE_FACES } from './remap';

/*
 * Die face textures drawn on canvases: pips on the white dice; on the red Speed Die pips for 1-3, a bus silhouette
 * and a tuk-tuk glyph for Tuk-Tuk Uncle, with the data file's labels under the pictures; on Hero League's Hero die
 * each hero's silhouette and name.
 */

const SIZE = 256;

/** Where each face's pips sit, as fractions of the face (the HUD's dice readout draws the same) */
export const PIPS: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [[0.27, 0.27], [0.73, 0.73]],
  3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
  4: [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]],
  5: [[0.26, 0.26], [0.74, 0.26], [0.5, 0.5], [0.26, 0.74], [0.74, 0.74]],
  6: [[0.27, 0.24], [0.73, 0.24], [0.27, 0.5], [0.73, 0.5], [0.27, 0.76], [0.73, 0.76]],
};

function face(bg: string, draw: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const c = makeCanvas(SIZE, SIZE);
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, SIZE, SIZE);
  // Faint bevel line, so the edges read against the board
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 6;
  roundRect(ctx, 6, 6, SIZE - 12, SIZE - 12, 28);
  ctx.stroke();
  ctx.save();
  ctx.scale(SIZE, SIZE);
  draw(ctx);
  ctx.restore();
  return c;
}

const pips = (n: number, color: string) => (ctx: CanvasRenderingContext2D) => {
  ctx.fillStyle = color;
  for (const [x, y] of PIPS[n] ?? []) {
    ctx.beginPath();
    ctx.arc(x, y, n === 1 ? 0.11 : 0.085, 0, Math.PI * 2);
    ctx.fill();
  }
};

function faceMaterial(canvas: HTMLCanvasElement, color = '#ffffff'): MeshStandardMaterial {
  return new MeshStandardMaterial({ map: toTexture(canvas, 4), color, roughness: 0.32, metalness: 0 });
}

let white: MeshStandardMaterial[] | null = null;
/** The six materials of a white die, in BoxGeometry group order */
export function whiteDieMaterials(): MeshStandardMaterial[] {
  white ??= BOX_GROUP_FACE.map((f) => faceMaterial(face('#f7f4ec', pips(WHITE_FACES[f] ?? 1, '#1d1d1f'))));
  return white;
}

const speedCache = new Map<string, MeshStandardMaterial[]>();
/** The red Speed Die: face index i shows faces[i] (data file order) */
export function speedDieMaterials(faces: readonly SpeedFace[], labels: Record<string, string>): MeshStandardMaterial[] {
  const key = faces.join(',') + JSON.stringify(labels);
  let mats = speedCache.get(key);
  if (!mats) {
    const draw = (f: SpeedFace) =>
      typeof f === 'number'
        ? pips(f, '#ffffff')
        : (ctx: CanvasRenderingContext2D) => {
            drawIcon(ctx, f === 'bus' ? 'bus' : 'tuktuk', 0.5, 0.42, 0.62, '#ffffff', '#c1121f');
            fitText(ctx, (labels[f] ?? f).toUpperCase(), 0.5, 0.82, 0.13, 0.84, { weight: 800, color: '#ffffff' });
          };
    mats = BOX_GROUP_FACE.map((i) => faceMaterial(face('#c1121f', draw(faces[i] ?? 1))));
    speedCache.set(key, mats);
  }
  return mats;
}

/** A Hero-die face for a hero nobody plays */
export const NOBODY = '#6c727c';

/** Dark ink on a light face, white on a dark one */
function inkOn(bg: string): string {
  const n = Number.parseInt(bg.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.62 ? '#1d1d1f' : '#ffffff';
}

/** A hero's silhouette (24 x 24 glyph) centred at (x, y), `size` wide; its cut-outs in the face colour */
function drawGlyph(ctx: CanvasRenderingContext2D, g: HeroGlyph, x: number, y: number, size: number, color: string, bg: string): void {
  ctx.save();
  ctx.translate(x - size / 2, y - size / 2);
  ctx.scale(size / 24, size / 24);
  ctx.fillStyle = color;
  ctx.fill(new Path2D(g.d), 'evenodd');
  if (g.line) {
    ctx.strokeStyle = color;
    ctx.lineWidth = g.w ?? 1.5;
    ctx.lineCap = 'round';
    ctx.stroke(new Path2D(g.line));
  }
  if (g.cut) {
    ctx.fillStyle = bg;
    ctx.fill(new Path2D(g.cut), 'evenodd');
  }
  ctx.restore();
}

const heroCache = new Map<string, MeshStandardMaterial[]>();
/**
 * The Hero die: face value f (1-6, HERO_FACES) shows heroes[f - 1], its silhouette and name on `colours[f - 1]` (the
 * colour of the seat playing that hero, null: nobody does)
 */
export function heroDieMaterials(heroes: readonly HeroDef[], colours: readonly (string | null)[]): MeshStandardMaterial[] {
  const key = heroes.map((h, k) => `${h.id}:${colours[k] ?? ''}`).join(',');
  let mats = heroCache.get(key);
  if (!mats) {
    const draw = (f: number) => {
      const hero = heroes[f - 1];
      const bg = colours[f - 1] ?? NOBODY;
      const ink = inkOn(bg);
      const glyph = hero && HERO_GLYPHS[hero.id];
      return face(bg, (ctx) => {
        if (glyph) drawGlyph(ctx, glyph, 0.5, 0.4, 0.56, ink, bg);
        fitText(ctx, (hero?.name ?? String(f)).toUpperCase(), 0.5, 0.82, 0.12, 0.84, { weight: 800, color: ink });
      });
    };
    mats = BOX_GROUP_FACE.map((i) => faceMaterial(draw(HERO_FACES[i] ?? 1)));
    heroCache.set(key, mats);
  }
  return mats;
}
