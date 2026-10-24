import { MeshStandardMaterial } from 'three';
import type { SpeedFace } from '../../rules';
import { drawIcon } from '../board/icons';
import { fitText, makeCanvas, roundRect, toTexture } from '../textures/canvas';
import { BOX_GROUP_FACE, WHITE_FACES } from './remap';

/*
 * Die face textures drawn on canvases: pips on the white dice; on the red Speed Die pips for 1-3, a bus silhouette
 * and a generic top-hat glyph for Tuk-Tuk Uncle, with the data file's labels under the pictures.
 */

const SIZE = 256;

const PIPS: Record<number, [number, number][]> = {
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
            drawIcon(ctx, f === 'bus' ? 'bus' : 'hat', 0.5, 0.42, 0.62, '#ffffff', '#c1121f');
            fitText(ctx, (labels[f] ?? f).toUpperCase(), 0.5, 0.82, 0.13, 0.84, { weight: 800, color: '#ffffff' });
          };
    mats = BOX_GROUP_FACE.map((i) => faceMaterial(face('#c1121f', draw(faces[i] ?? 1))));
    speedCache.set(key, mats);
  }
  return mats;
}
