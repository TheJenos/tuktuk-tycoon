import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { CanvasTexture, Sprite, SpriteMaterial, SRGBColorSpace } from 'three';
import type { SeatId } from '../../rules';
import { settings } from '../../ui/settings';
import { director } from '../../view';
import { fitText, makeCanvas } from '../textures/canvas';
import { tokenPositions } from '../tokens/Tokens';

/*
 * "+Rs. 200" / "−Rs. 350" rising above a token when its cash changes (the 'fx' scene API, fed by the director's cash
 * handler). A pool of 8 sprites, each with its own small canvas; the oldest is reused when all are busy.
 */

const POOL = 8;
const LIFE_MS = 1400;
const RISE = 0.9;

interface Label {
  sprite: Sprite;
  canvas: HTMLCanvasElement;
  tex: CanvasTexture;
  start: number;
  seat: SeatId | null;
  baseY: number;
}

function paint(l: Label, delta: number): void {
  const ctx = l.canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, l.canvas.width, l.canvas.height);
  ctx.scale(l.canvas.width, l.canvas.width);
  const text = `${delta >= 0 ? '+' : '−'}Rs. ${Math.abs(delta).toLocaleString('en-US')}`;
  const color = delta >= 0 ? '#5ce08a' : '#ff7070';
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
        return { sprite, canvas, tex, start: -Infinity, seat: null, baseY: 0 };
      }),
    [],
  );

  useEffect(
    () =>
      director.register('fx', {
        money(seat, delta) {
          const at = tokenPositions.get(seat);
          if (!at || delta === 0) return;
          const l = labels.reduce((a, b) => (b.start < a.start ? b : a));
          // Two labels for one token at once (rent paid, then salary) stack instead of overlapping
          const stacked = labels.filter((x) => x.seat === seat && performance.now() - x.start < LIFE_MS * 0.5).length;
          l.start = performance.now();
          l.seat = seat;
          l.baseY = at.y + 0.75 + stacked * 0.32;
          l.sprite.position.set(at.x, l.baseY, at.z);
          l.sprite.visible = true;
          paint(l, delta);
          invalidate();
        },
      }),
    [labels, invalidate],
  );

  useFrame(() => {
    const now = performance.now();
    const rise = settings.get().reduceMotion ? 0 : RISE;
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
      if (at) l.sprite.position.set(at.x, l.baseY + rise * t, at.z);
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
