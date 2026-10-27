import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HERO_GLYPHS } from '../../boards/heroes/icons';
import { HEROES_THEME } from '../../boards/heroes/theme';
import { HEROES_TOKENS } from '../../boards/heroes/tokens';
import { HEROES } from '../../rules';
import { ANIM, hopMs } from '../../shared/timing';
import { TOKENS, type TokenId } from '../../shared/tokens';
import { slotPos } from '../board/layout';
import { HOP_HEIGHT, JUMP_HEIGHT, leapHeight, movePoints, moveMs, poseAt, type Pose } from '../tokens/hop';
import { TOKEN_SCALE, tokenGeometry } from '../tokens/shapes';
import { TokenIcon } from '../../ui/game/tokenIcons';

/** Every token of every board, Hero League's six included (whether or not the shared registry lists them yet) */
const ALL = [...new Set([...TOKENS.map((t) => t.id as string), ...HEROES_THEME.tokens.map((t) => t.id)])] as TokenId[];

describe('token shapes', () => {
  it('builds every token: low-poly, standing on the table, inside its slot', () => {
    for (const id of ALL) {
      const g = tokenGeometry(id);
      const tris = g.getAttribute('position').count / 3;
      expect(tris, id).toBeGreaterThan(150);
      expect(tris, id).toBeLessThan(1500);
      const box = g.boundingBox;
      expect(box, id).not.toBeNull();
      if (!box) continue;
      expect(box.min.y, id).toBeGreaterThan(-0.001);
      expect(box.max.y, id).toBeGreaterThan(0.18 * TOKEN_SCALE);
      expect(box.max.y, id).toBeLessThan(0.6 * TOKEN_SCALE);
      for (const v of [box.min.x, box.max.x, box.min.z, box.max.z]) expect(Math.abs(v), id).toBeLessThan(0.25 * TOKEN_SCALE);
      expect(tokenGeometry(id)).toBe(g);
    }
  });

  it("gives each of Hero League's heroes a token of its own, in the heroes' order", () => {
    const ids = HEROES_THEME.tokens.map((t) => t.id);
    expect(ids).toEqual(HEROES.heroes?.list.map((h) => h.id));
    expect(HEROES_THEME.tokens.map((t) => t.label)).toEqual(HEROES.heroes?.list.map((h) => h.name));
    expect(Object.keys(HEROES_TOKENS).sort()).toEqual([...ids].sort());
    // Not the tuk-tuk an unknown id falls back to, and all different
    const sizes = new Set([...ids, 'tuktuk'].map((id) => tokenGeometry(id as TokenId).getAttribute('position').count));
    expect(sizes.size).toBe(ids.length + 1);
    // Each has its flat icon too (the shape the Hero die's faces print), not the dot an unknown token gets
    expect(Object.keys(HERO_GLYPHS).sort()).toEqual([...ids].sort());
    const dot = renderToStaticMarkup(createElement(TokenIcon, { token: 'nobody' }));
    for (const id of ids) {
      const svg = renderToStaticMarkup(createElement(TokenIcon, { token: id }));
      expect(svg, id).not.toBe(dot);
      expect(svg, id).toContain(HERO_GLYPHS[id]!.d);
    }
  });
});

describe('token hops', () => {
  const pose = (): Pose => ({ x: 0, y: 0, z: 0, yaw: 0, scale: 1, squash: 1 });

  it('walks tile by tile, touching down on every tile, and ends on the slot', () => {
    const from = slotPos(38, 1, 0);
    const end = slotPos(2, 2, 1);
    const pts = movePoints(from, [39, 0, 1, 2], end, 'walk');
    expect(pts.length).toBe(5);
    expect(pts[2]).toEqual(slotPos(0, 1, 0));
    const p = pose();
    for (let k = 0; k <= 4; k++) {
      poseAt(pts, 'walk', k / 4, false, 0, p);
      expect(p.y).toBeCloseTo(0);
      expect(p.x).toBeCloseTo((pts[k] as [number, number])[0]);
    }
    poseAt(pts, 'walk', 0.125, false, 0, p);
    expect(p.y).toBeCloseTo(HOP_HEIGHT);
    poseAt(pts, 'walk', 0.125, true, 0, p);
    expect(p.y).toBe(0);
    expect(moveMs(4, 'walk')).toBe(hopMs(4) * 4);
  });

  it('walks backwards facing forwards, and jumps to jail in one arc', () => {
    const p = pose();
    const back = movePoints(slotPos(7, 1, 0), [6, 5, 4], slotPos(4, 1, 0), 'back');
    poseAt(back, 'back', 0.2, false, 0, p);
    // Play runs towards -x on the bottom row: facing -x is a heading of pi.
    expect(Math.cos(p.yaw)).toBeCloseTo(-1);
    const jump = movePoints(slotPos(30, 1, 0), [10], slotPos(10, 1, 0, true), 'jump');
    expect(jump.length).toBe(2);
    poseAt(jump, 'jump', 0.5, false, 1, p);
    expect(p.y).toBeCloseTo(JUMP_HEIGHT);
    poseAt(jump, 'jump', 0.5, true, 1, p);
    expect(p.y).toBe(0);
    expect(p.scale).toBeCloseTo(0);
    expect(moveMs(1, 'jump')).toBe(ANIM.jump);
  });

  it('leaps a Titan Smash swap in one arc to any space, and hops on the spot when it stays put', () => {
    const p = pose();
    const far = movePoints(slotPos(3, 1, 0), [17], slotPos(17, 1, 0), 'leap');
    expect(far).toEqual([slotPos(3, 1, 0), slotPos(17, 1, 0)]);
    poseAt(far, 'leap', 0.5, false, 1, p);
    expect(p.y).toBeCloseTo(JUMP_HEIGHT);
    // A swap with a hero on the same space: a low hop where it stands
    const here = movePoints(slotPos(5, 2, 0), [5], slotPos(5, 2, 1), 'leap');
    poseAt(here, 'leap', 0.5, false, 1, p);
    expect(p.y).toBeCloseTo(leapHeight(Math.hypot(here[1]![0] - here[0]![0], here[1]![1] - here[0]![1])));
    expect(p.y).toBeLessThan(1);
    expect(p.y).toBeGreaterThan(HOP_HEIGHT);
    poseAt(here, 'leap', 0.5, true, 1, p);
    expect(p.y).toBe(0);
    expect(p.scale).toBeCloseTo(0);
    poseAt(here, 'leap', 1, false, 1, p);
    expect([p.x, p.z]).toEqual(slotPos(5, 2, 1));
    expect(moveMs(1, 'leap')).toBe(ANIM.jump);
  });
});
