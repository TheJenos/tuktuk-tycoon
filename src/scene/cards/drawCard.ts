import type { BoardDef, Deck } from '../../rules';
import { drawIcon } from '../board/icons';
import { drawLines, fitText, makeCanvas, roundRect } from '../textures/canvas';

/*
 * Card faces and backs on canvases (1.6 : 1, like the cards). Deck names come from the board data's
 * `display.decks`; the text is the drawn card's own.
 */

export const CARD_PX = { w: 640, h: 400 } as const;

export const DECK_STYLE: Record<Deck, { back: string; ink: string }> = {
  chance: { back: '#f08c00', ink: '#3b1f00' },
  chest: { back: '#4dabf7', ink: '#0b2a4a' },
};

export const deckName = (b: BoardDef, deck: Deck): string => b.display.decks[deck];

function card(draw: (ctx: CanvasRenderingContext2D) => void, canvas?: HTMLCanvasElement): HTMLCanvasElement {
  const c = canvas ?? makeCanvas(CARD_PX.w, CARD_PX.h);
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, c.width, c.height);
  // Card units: 1.6 x 1
  ctx.scale(c.width / 1.6, c.height / 1);
  draw(ctx);
  return c;
}

export function drawCardBack(b: BoardDef, deck: Deck, canvas?: HTMLCanvasElement): HTMLCanvasElement {
  const st = DECK_STYLE[deck];
  return card((ctx) => {
    ctx.fillStyle = st.back;
    roundRect(ctx, 0, 0, 1.6, 1, 0.06);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 0.025;
    roundRect(ctx, 0.05, 0.05, 1.5, 0.9, 0.05);
    ctx.stroke();
    if (deck === 'chance') fitText(ctx, '?', 0.8, 0.44, 0.6, 1, { weight: 900, color: '#fff' });
    else drawIcon(ctx, 'chest', 0.8, 0.42, 0.48, '#fff', st.back);
    fitText(ctx, deckName(b, deck).toUpperCase(), 0.8, 0.84, 0.13, 1.4, { weight: 800, color: '#fff' });
  }, canvas);
}

export function drawCardFace(b: BoardDef, deck: Deck, text: string, canvas?: HTMLCanvasElement): HTMLCanvasElement {
  const st = DECK_STYLE[deck];
  return card((ctx) => {
    ctx.fillStyle = '#fbf7ee';
    roundRect(ctx, 0, 0, 1.6, 1, 0.06);
    ctx.fill();
    ctx.fillStyle = st.back;
    ctx.fillRect(0, 0.08, 1.6, 0.18);
    fitText(ctx, deckName(b, deck).toUpperCase(), 0.8, 0.17, 0.12, 1.4, { weight: 800, color: '#fff' });
    drawLines(ctx, text, 0.8, 0.62, 0.11, 1.38, 5, { weight: 600, color: st.ink });
  }, canvas);
}
