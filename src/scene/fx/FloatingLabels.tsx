import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { CanvasTexture, Sprite, SpriteMaterial, SRGBColorSpace } from 'three';
import { boardMoney, type SeatId } from '../../rules';
import { settings } from '../../ui/settings';
import { director } from '../../view';
import { fitText, makeCanvas } from '../textures/canvas';
import { tokenPositions } from '../tokens/Tokens';

/*
 * "+Rs. 20,000" / "−Rs. 35,000" (the board's money: on All Island engine units x 100, on Hero League "+40 Power")
 * rising above a token when its cash changes, and a few words in gold for Hero League's superpowers ("Re-roll!",
 * "Thunder Call ready"): the 'fx' scene API, fed by the director's handlers. A pool of 8 sprites, each with its own
 * small canvas; the oldest is reused when all are busy.
 */

const POOL = 8;
const LIFE_MS = 1400;
const RISE = 0.9;
const GAIN = '#5ce08a';
const LOSS = '#ff7070';
const WORDS = '#ffd43b';

interface Label {
  sprite: Sprite;
  canvas: HTMLCanvasElement;
  tex: CanvasTexture;
  start: number;
  seat: SeatId | null;
  baseY: number;
  /** How far above the token it starts (more for a second label stacked on the first) */
  up: number;
}

function paint(l: Label, text: string, color: string): void {
  const ctx = l.canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, l.canvas.width, l.canvas.height);
  ctx.scale(l.canvas.width, l.canvas.width);
  ctx.lineJoin = 'round';
  ctx.save();
  // A dark outline keeps the amount readable on any tile
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 8;
  fitText(ctx, text, 0.5, 0.19, 0.26, 0.96, { weight: 900, color });
  ctx.restore();
  l.tex.needsUpdate = true;
}

export function FloatingLabels() {
  const invalidate = useThree((s) => s.invalidate);
  const labels = useMemo<Label[]>(
    () =>
      Array.from({ length: POOL }, () => {
        const canvas = makeCanvas(256, 96);
        const tex = new CanvasTexture(canvas);
        tex.colorSpace = SRGBColorSpace;
        const sprite = new Sprite(new SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
        sprite.scale.set(1.1, 0.41, 1);
        sprite.visible = false;
        sprite.renderOrder = 10;
        return { sprite, canvas, tex, start: -Infinity, seat: null, baseY: 0, up: 0 };
      }),
    [],
  );

  useEffect(() => {
    const show = (seat: SeatId, text: string, color: string) => {
      const at = tokenPositions.get(seat);
      if (!at) return;
      const l = labels.reduce((a, b) => (b.start < a.start ? b : a));
      // Two labels for one token at once (rent paid, then salary) stack instead of overlapping
      const stacked = labels.filter((x) => x.seat === seat && performance.now() - x.start < LIFE_MS * 0.5).length;
      l.start = performance.now();
      l.seat = seat;
      l.up = 0.75 + stacked * 0.32;
      l.baseY = at.y + l.up;
      l.sprite.position.set(at.x, l.baseY, at.z);
      l.sprite.visible = true;
      paint(l, text, color);
      invalidate();
    };
    return director.register('fx', {
      money(seat, delta) {
        if (delta === 0) return;
        const board = director.view.get().game?.cfg.board ?? 'lanka';
        show(seat, boardMoney(board, delta, { signed: true }), delta > 0 ? GAIN : LOSS);
      },
      say: (seat, text) => show(seat, text, WORDS),
    });
  }, [labels, invalidate]);

  useFrame(() => {
    const now = performance.now();
    const { reduceMotion, boardView } = settings.get();
    const rise = reduceMotion ? 0 : RISE;
    // Seen from straight above, height doesn't show: the 2D view puts the label above the token on screen (towards
    // the board's far edge) and drifts it further that way
    const top = boardView === '2d';
    let busy = false;
    for (const l of labels) {
      if (!l.sprite.visible) continue;
      const t = (now - l.start) / LIFE_MS;
      if (t >= 1) {
        l.sprite.visible = false;
        l.seat = null;
        continue;
      }
      busy = true;
      const at = l.seat ? tokenPositions.get(l.seat) : undefined;
      if (at && top) l.sprite.position.set(at.x, l.baseY, at.z - (l.up - 0.2) - rise * t);
      else if (at) l.sprite.position.set(at.x, l.baseY + rise * t, at.z);
      (l.sprite.material as SpriteMaterial).opacity = t < 0.65 ? 1 : 1 - (t - 0.65) / 0.35;
    }
    if (busy) invalidate();
  });

  return (
    <group>
      {labels.map((l, i) => (
        <primitive key={i} object={l.sprite} />
      ))}
    </group>
  );
}
