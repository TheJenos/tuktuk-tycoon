import { describe, expect, it } from 'vitest';
import { apply, BOARD_IDS, BOARDS, COLOMBO, createGame, getBoard, HILL, LANKA, normalizeConfig, SEAT_IDS, SOUTH, type GameState } from '..';
import { randFrom, randomCommand } from '../randomPlayer';
import type { BoardDef, CardDef, CardFx } from '../types';

/*
 * Every board is the All Island board (data/lanka.ts) with other names: same spaces in the same places, same
 * numbers, same card effects. Only names, card texts and the display block may differ.
 */

const THEMES = [COLOMBO, HILL, SOUTH];
const ALL = [LANKA, ...THEMES];

/** A space without its name: what the rules see */
const shape = (b: BoardDef) => b.spaces.map(({ name: _name, ...rest }) => rest);

/** A deck's effects as a sorted list of JSON strings (ids may be renamed) */
const effects = (deck: CardDef[]): string[] => deck.map((c) => JSON.stringify(c.fx)).sort();

const rupees = (units: number): string => `Rs. ${(Math.abs(units) * 100).toLocaleString('en-US')}`;

/** The amounts a card's text must print (x100 the engine's units) */
function amountsOf(fx: CardFx): string[] {
  if (fx.k === 'cash' || fx.k === 'each') return [rupees(fx.amount)];
  if (fx.k === 'repairs') return [rupees(fx.house), rupees(fx.hotel)];
  return [];
}

/** Sinhala script block */
const SINHALA = /[඀-෿]/;

describe('the boards', () => {
  it('are registered, listed for the picker and accepted by normalizeConfig', () => {
    expect(BOARD_IDS).toEqual(['lanka', 'colombo', 'hill', 'south']);
    expect(BOARDS.map((b) => b.name)).toEqual(['All Island', 'Colombo', 'Hill Country', 'Down South']);
    for (const b of ALL) {
      expect(getBoard(b.id)).toBe(b);
      expect(normalizeConfig({ board: b.id }).board).toBe(b.id);
      expect(BOARDS.find((x) => x.id === b.id)?.blurb).toBe(b.display.blurb);
    }
    expect(getBoard('mars')).toBe(LANKA);
    expect(normalizeConfig({ board: 'mars' }).board).toBe('lanka');
    expect(normalizeConfig({ board: 'toString' }).board).toBe('lanka');
    expect(LANKA.display.name).toBe('All Island');
  });

  for (const b of THEMES) {
    describe(b.display.name, () => {
      it('has the All Island spaces, groups and numbers', () => {
        expect(b.spaces).toHaveLength(40);
        expect(shape(b)).toEqual(shape(LANKA));
        expect(b.groups.map(({ name: _n, ...g }) => g)).toEqual(LANKA.groups.map(({ name: _n, ...g }) => g));
        expect(b.railRent).toEqual(LANKA.railRent);
        expect(b.utilityMul).toEqual(LANKA.utilityMul);
        expect(b.utilityCardMul).toBe(LANKA.utilityCardMul);
        expect(b.railCardMul).toBe(LANKA.railCardMul);
        expect(b.jailIndex).toBe(LANKA.jailIndex);
        expect(b.goToJailIndex).toBe(LANKA.goToJailIndex);
        expect(b.speedDie.faces).toEqual(LANKA.speedDie.faces);
        expect(Object.keys(b.speedDie.labels).sort()).toEqual(Object.keys(LANKA.speedDie.labels).sort());
        expect(b.display.currency).toEqual(LANKA.display.currency);
        expect(Object.keys(b.display.groupColours).sort()).toEqual(Object.keys(LANKA.display.groupColours).sort());
        const colours = Object.values(b.display.groupColours);
        expect(new Set(colours).size).toBe(8);
        for (const c of colours) expect(c).toMatch(/^#[0-9a-f]{6}$/);
      });

      it('has two 16-card decks with the All Island effects, unique ids and the right prefixes', () => {
        for (const [deck, base, prefix] of [
          [b.chance, LANKA.chance, 'ch-'],
          [b.chest, LANKA.chest, 'cc-'],
        ] as const) {
          expect(deck).toHaveLength(16);
          expect(effects(deck)).toEqual(effects(base));
          expect(deck.every((c) => c.id.startsWith(prefix) && c.text.length > 0)).toBe(true);
        }
        const ids = [...b.chance, ...b.chest].map((c) => c.id);
        expect(new Set(ids).size).toBe(32);
      });

      it('card texts name the destination and print the shown amounts', () => {
        for (const c of [...b.chance, ...b.chest]) {
          const fx = c.fx;
          if (fx.k === 'advance') {
            expect(b.spaces[fx.to], c.id).toBeDefined();
            expect(c.text, c.id).toContain(`Advance to ${b.spaces[fx.to]?.name}`);
          }
          if (fx.k === 'jail' || fx.k === 'goojf') expect(c.text, c.id).toContain(b.spaces[b.jailIndex]?.name);
          if (fx.k === 'nearest') expect(c.text, c.id).toMatch(fx.kind === 'rail' ? /nearest Station.*twice the fare/ : /nearest Board.*ten times/);
          if (fx.k === 'back') expect(c.text, c.id).toContain(`Go back ${fx.n} spaces`);
          const want = amountsOf(fx);
          for (const a of want) expect(c.text, c.id).toContain(`${a}`);
          // Every amount printed is one of the card's own, or the Start salary on a card that moves you
          const salary = fx.k === 'advance' || fx.k === 'jail' ? [rupees(200)] : [];
          for (const m of c.text.match(/Rs\. [\d,]+/g) ?? []) expect([...want, ...salary], `${c.id}: ${m}`).toContain(m);
        }
      });

      it('has unique names that fit their tiles, in English letters only', () => {
        const names = b.spaces.filter((sp) => sp.k !== 'chance' && sp.k !== 'chest').map((sp) => sp.name);
        expect(new Set(names).size).toBe(names.length);
        for (const sp of b.spaces) expect(sp.name.length, sp.name).toBeLessThanOrEqual(28);
        // The deck spaces carry the decks' names
        expect(b.spaces.filter((sp) => sp.k === 'chance').every((sp) => sp.name === b.display.decks.chance)).toBe(true);
        expect(b.spaces.filter((sp) => sp.k === 'chest').every((sp) => sp.name === b.display.decks.chest)).toBe(true);
        const text = JSON.stringify(b);
        expect(SINHALA.test(text)).toBe(false);
        expect(b.display.name.length).toBeGreaterThan(0);
        expect(b.display.subtitle.length).toBeGreaterThan(0);
        expect(b.display.blurb.length).toBeLessThanOrEqual(120);
      });

      it('plays exactly like the All Island board (same seed, same commands, same game)', () => {
        const seats = ['Ann', 'Bob', 'Cat'].map((name, i) => ({ id: SEAT_IDS[i]!, name }));
        let x: GameState = createGame({ board: 'lanka' }, seats, 5).state;
        let y: GameState = createGame({ board: b.id }, seats, 5).state;
        const r = randFrom(11);
        for (let step = 0; step < 400 && x.phase.k !== 'over'; step++) {
          const cmd = randomCommand(x, r);
          if (!cmd) break;
          const rx = apply(x, cmd, { check: true });
          const ry = apply(y, cmd, { check: true });
          expect(ry.ok).toBe(rx.ok);
          if (!rx.ok || !ry.ok) continue;
          x = rx.state;
          y = ry.state;
          expect({ ...y, cfg: { ...y.cfg, board: 'lanka' } }).toEqual(x);
        }
      });
    });
  }

  it('the All Island board has no Sinhala script either', () => {
    expect(SINHALA.test(JSON.stringify(LANKA))).toBe(false);
  });
});
