import { formatMoney, type BoardDef, type RulesConfig, type SpaceDef } from '../../rules';
import { drawLines, fitText, roundRect } from '../textures/canvas';
import { CARD_H, CARD_W, DECKS } from './centre';
import { drawIcon } from './icons';
import { BAND, CORNER, HALF, INNER, JAIL_CELL, SIDE, TILE_D, TILE_W, localCenter, sideOf, toWorld } from './layout';

/*
 * Paints the whole board top into one canvas, in board units: the context is scaled so 1 unit = one tile's width
 * and the origin is the board's centre, matching the world's XZ plane (canvas y = world z). Each tile is drawn in its
 * side's frame (rotated about its centre) so text reads from the outer edge. Every name, price and colour comes from
 * the data file; amounts printed on tax and GO spaces come from the room's rules.
 */

export type PaintRules = Pick<RulesConfig, 'goSalary' | 'incomeFlat' | 'incomePct' | 'luxuryTax' | 'jailFine'>;

const PAPER = '#d9ead3';
const INK = '#141414';
const LINE = 0.018;

/** Shown rupees (engine units x 100): "Rs. 6,000"; fitText shrinks a long amount to its tile */
const money = (n: number) => formatMoney(n);

function frameFor(ctx: CanvasRenderingContext2D, i: number): void {
  const [lx, lz] = localCenter(i);
  const side = sideOf(i);
  const [x, z] = toWorld(side, lx, lz);
  ctx.translate(x, z);
  // Canvas rotation by +90 degrees per side is the world's rotation of the bottom row onto that side.
  ctx.rotate((side * Math.PI) / 2);
}

/** A street, railroad, utility, tax, Chance or Community Chest space, in its local frame (inner edge at -0.8) */
function drawSpace(ctx: CanvasRenderingContext2D, b: BoardDef, sp: SpaceDef, i: number, rules: PaintRules): void {
  const w = TILE_W;
  const top = -TILE_D / 2;
  const bottom = TILE_D / 2;
  const textW = w * 0.86;
  ctx.strokeStyle = INK;
  ctx.lineWidth = LINE;
  ctx.strokeRect(-w / 2, top, w, TILE_D);
  const price = (p: number) => fitText(ctx, money(p), 0, bottom - 0.14, 0.13, textW, { weight: 700 });
  switch (sp.k) {
    case 'street': {
      ctx.fillStyle = b.display.groupColours[sp.group] ?? '#888';
      ctx.fillRect(-w / 2, top, w, BAND);
      ctx.beginPath();
      ctx.moveTo(-w / 2, top + BAND);
      ctx.lineTo(w / 2, top + BAND);
      ctx.stroke();
      drawLines(ctx, sp.name.toUpperCase(), 0, top + BAND + 0.3, 0.13, textW, 3, { weight: 700 });
      price(sp.price);
      break;
    }
    case 'rail':
      drawLines(ctx, sp.name.toUpperCase(), 0, top + 0.2, 0.12, textW, 2);
      drawIcon(ctx, 'rail', 0, 0.12, 0.72, INK, PAPER);
      price(sp.price);
      break;
    case 'utility': {
      const first = b.spaces.findIndex((s) => s.k === 'utility') === i;
      drawLines(ctx, sp.name.toUpperCase(), 0, top + 0.2, 0.12, textW, 2);
      drawIcon(ctx, first ? 'bulb' : 'tap', 0, 0.12, 0.62, first ? '#c99a06' : '#2b6cb0', PAPER);
      price(sp.price);
      break;
    }
    case 'tax': {
      const income = sp.tax === 'income';
      drawLines(ctx, sp.name.toUpperCase(), 0, top + 0.2, 0.13, textW, 2);
      drawIcon(ctx, income ? 'coins' : 'ring', 0, 0.08, 0.5, income ? '#8a6d1d' : '#5a6b7d');
      const amount = income ? `PAY ${rules.incomePct}% OR ${money(rules.incomeFlat)}` : `PAY ${money(rules.luxuryTax)}`;
      drawLines(ctx, amount, 0, bottom - 0.2, 0.1, textW, 2);
      break;
    }
    case 'chance': {
      drawLines(ctx, sp.name.toUpperCase(), 0, top + 0.18, 0.14, textW, 2);
      const colours = ['#d6336c', '#1c5ba8', '#e8590c'];
      const n = b.spaces.slice(0, i).filter((s) => s.k === 'chance').length;
      fitText(ctx, '?', 0, 0.2, 0.95, textW, { weight: 900, color: colours[n % colours.length] });
      break;
    }
    case 'chest':
      drawLines(ctx, sp.name.toUpperCase(), 0, top + 0.22, 0.12, textW, 2);
      drawIcon(ctx, 'chest', 0, 0.22, 0.62, '#6b3e1d', PAPER);
      break;
    default:
      drawLines(ctx, sp.name.toUpperCase(), 0, 0, 0.14, textW, 3);
  }
}

/** A corner in its local frame: outer edges at +x and +y, the inner corner at (-0.8, -0.8) */
function drawCorner(ctx: CanvasRenderingContext2D, sp: SpaceDef, rules: PaintRules): void {
  const h = CORNER / 2;
  ctx.strokeStyle = INK;
  ctx.lineWidth = LINE;
  ctx.strokeRect(-h, -h, CORNER, CORNER);
  const diagonal = (fn: () => void) => {
    ctx.save();
    ctx.rotate(-Math.PI / 4);
    fn();
    ctx.restore();
  };
  switch (sp.k) {
    case 'go':
      fitText(ctx, `COLLECT ${money(rules.goSalary)} SALARY AS YOU PASS`, 0, -0.5, 0.11, CORNER * 0.86, { weight: 700 });
      fitText(ctx, sp.name.toUpperCase(), 0, -0.05, 0.62, CORNER * 0.8, { weight: 900, color: '#c92a2a' });
      drawIcon(ctx, 'arrow', 0, 0.48, 1.1, '#c92a2a');
      break;
    case 'jail': {
      // The cell sits in the inner corner; Just Visiting is the L-shaped strip along the two outer edges.
      const cell = JAIL_CELL.max - JAIL_CELL.min;
      const x0 = -h;
      ctx.fillStyle = '#f08c00';
      ctx.fillRect(x0, x0, cell, cell);
      ctx.strokeRect(x0, x0, cell, cell);
      ctx.strokeStyle = '#3b2600';
      ctx.lineWidth = 0.03;
      for (let k = 1; k < 6; k++) {
        ctx.beginPath();
        ctx.moveTo(x0 + (cell * k) / 6, x0 + 0.08);
        ctx.lineTo(x0 + (cell * k) / 6, x0 + cell - 0.08);
        ctx.stroke();
      }
      ctx.save();
      ctx.translate(x0 + cell / 2, x0 + cell / 2);
      ctx.rotate(-Math.PI / 4);
      ctx.fillStyle = PAPER;
      ctx.fillRect(-0.42, -0.1, 0.84, 0.2);
      fitText(ctx, sp.name.toUpperCase(), 0, 0, 0.15, 0.78, { weight: 800 });
      ctx.restore();
      const strip = h - (x0 + cell);
      const mid = x0 + cell + strip / 2;
      fitText(ctx, 'VISITING', (x0 + h) / 2 - 0.1, mid, 0.17, CORNER - strip - 0.1, { weight: 800 });
      ctx.save();
      ctx.translate(mid, (x0 + h) / 2 - 0.1);
      ctx.rotate(-Math.PI / 2);
      fitText(ctx, 'JUST', 0, 0, 0.17, CORNER - strip - 0.1, { weight: 800 });
      ctx.restore();
      break;
    }
    case 'parking':
      diagonal(() => {
        const [first = '', ...rest] = sp.name.toUpperCase().split(' ');
        fitText(ctx, first, 0, -0.46, 0.22, CORNER * 0.9, { weight: 800 });
        drawIcon(ctx, 'car', 0, 0.02, 0.78, '#c92a2a');
        fitText(ctx, rest.join(' '), 0, 0.46, 0.22, CORNER * 0.9, { weight: 800 });
      });
      break;
    case 'goToJail':
      diagonal(() => {
        const words = sp.name.toUpperCase().split(' ');
        const last = words.pop() ?? '';
        fitText(ctx, words.join(' '), 0, -0.46, 0.22, CORNER * 0.9, { weight: 800 });
        drawIcon(ctx, 'lock', 0, 0.02, 0.6, '#1c5ba8');
        fitText(ctx, last, 0, 0.46, 0.22, CORNER * 0.9, { weight: 800 });
      });
      break;
    default:
      drawLines(ctx, sp.name.toUpperCase(), 0, 0, 0.2, CORNER * 0.85, 3);
  }
}

function drawCentre(ctx: CanvasRenderingContext2D, b: BoardDef): void {
  // The two deck spots
  for (const deck of ['chance', 'chest'] as const) {
    const d = DECKS[deck];
    const name = b.spaces.find((s) => s.k === deck)?.name ?? deck;
    ctx.save();
    ctx.translate(d.x, d.z);
    // World yaw about +Y is the opposite canvas rotation (canvas y points along world z).
    ctx.rotate(-d.yaw);
    ctx.setLineDash([0.08, 0.06]);
    ctx.strokeStyle = 'rgba(20,20,20,0.55)';
    ctx.lineWidth = 0.025;
    roundRect(ctx, -CARD_W / 2 - 0.08, -CARD_H / 2 - 0.08, CARD_W + 0.16, CARD_H + 0.16, 0.08);
    ctx.stroke();
    ctx.setLineDash([]);
    fitText(ctx, name.toUpperCase(), 0, CARD_H / 2 + 0.24, 0.16, CARD_W, { weight: 800, color: 'rgba(20,20,20,0.7)' });
    ctx.restore();
  }
  // The title on a banner across the middle, running up to the right
  ctx.save();
  ctx.rotate(-Math.PI / 4);
  const len = 7.4;
  ctx.fillStyle = '#c92a2a';
  ctx.strokeStyle = '#f8f9fa';
  ctx.lineWidth = 0.06;
  roundRect(ctx, -len / 2, -0.62, len, 1.24, 0.12);
  ctx.fill();
  ctx.stroke();
  fitText(ctx, b.display.title.toUpperCase(), 0, 0.04, 1.0, len - 0.6, { weight: 900, color: '#ffffff' });
  ctx.restore();
}

/** Paints the board top into `canvas` (square; any size) */
export function drawBoard(canvas: HTMLCanvasElement, b: BoardDef, rules: PaintRules): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const px = canvas.width / SIDE;
  ctx.setTransform(px, 0, 0, px, canvas.width / 2, canvas.height / 2);
  ctx.fillStyle = PAPER;
  ctx.fillRect(-HALF, -HALF, SIDE, SIDE);
  // A faint inner field and the line around the ring of tiles
  ctx.fillStyle = '#cfe4c8';
  ctx.fillRect(-INNER, -INNER, 2 * INNER, 2 * INNER);
  ctx.lineCap = 'butt';
  b.spaces.forEach((sp, i) => {
    ctx.save();
    frameFor(ctx, i);
    if (i % 10 === 0) drawCorner(ctx, sp, rules);
    else drawSpace(ctx, b, sp, i, rules);
    ctx.restore();
  });
  ctx.strokeStyle = INK;
  ctx.lineWidth = LINE * 1.6;
  ctx.strokeRect(-INNER, -INNER, 2 * INNER, 2 * INNER);
  ctx.strokeRect(-HALF + LINE, -HALF + LINE, SIDE - 2 * LINE, SIDE - 2 * LINE);
  drawCentre(ctx, b);
}
