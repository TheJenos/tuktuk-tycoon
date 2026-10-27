import { describe, expect, it } from 'vitest';
import { apply, BOARD_IDS, BOARDS, COLOMBO, createGame, getBoard, HILL, LANKA, normalizeConfig, SEAT_IDS, SOUTH, type GameState } from '..';
import { randFrom, randomCommand } from '../randomPlayer';
import type { CardDef, CardFx } from '../types';

/*
 * Every board stands on its own: its own size (a multiple of 4: GO, the jail, parking and Go To Jail on the corners),
 * its own colour groups and prices (from the rulebook's tiers, rising around the board), its own player cap and
 * standard rules. The cards keep the rulebook's effects, pointed at the board's own spaces. The All Island board is
 * the rulebook's own 40 spaces.
 */

const THEMES = [COLOMBO, HILL, SOUTH];
const ALL = [LANKA, ...THEMES];

/** A deck's effects as a sorted list of JSON strings (ids may be renamed; advance targets are each board's own) */
const effects = (deck: CardDef[]): string[] =>
  deck.map((c) => JSON.stringify(c.fx.k === 'advance' ? { k: 'advance' } : c.fx)).sort();

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

  it('come in four sizes, each seating fewer the smaller it is', () => {
    expect(ALL.map((b) => [b.id, b.spaces.length, b.maxPlayers])).toEqual([
      ['lanka', 40, 8],
      ['colombo', 32, 4],
      ['hill', 36, 6],
      ['south', 48, 8],
    ]);
  });

  for (const b of ALL) {
    describe(b.display.name, () => {
      const n = b.spaces.length;
      const at = (k: string) => b.spaces.flatMap((sp, i) => (sp.k === k ? [i] : []));

      it('has GO, the jail, parking and Go To Jail on its four corners', () => {
        expect(n % 4).toBe(0);
        expect(n).toBeGreaterThanOrEqual(32);
        expect(at('go')).toEqual([0]);
        expect(at('jail')).toEqual([n / 4]);
        expect(at('parking')).toEqual([n / 2]);
        expect(at('goToJail')).toEqual([(3 * n) / 4]);
        expect(b.jailIndex).toBe(n / 4);
        expect(b.goToJailIndex).toBe((3 * n) / 4);
      });

      it('has colour groups of its own streets, priced up the board, with rents that rise with each house', () => {
        const streets = b.spaces.flatMap((sp, i) => (sp.k === 'street' ? [i] : []));
        expect(b.groups.flatMap((g) => g.spaces).sort((x, y) => x - y)).toEqual(streets);
        let last = 0;
        for (const g of b.groups) {
          expect(g.spaces.length).toBeGreaterThanOrEqual(2);
          for (const i of g.spaces) {
            const sp = b.spaces[i];
            if (sp?.k !== 'street') throw new Error(`${i} is not a street`);
            expect(sp.group).toBe(g.id);
            expect(sp.price).toBeGreaterThanOrEqual(last);
            last = sp.price;
            expect(sp.mortgage).toBe(sp.price / 2);
            expect(sp.rent).toHaveLength(6);
            for (let k = 1; k < 6; k++) expect(sp.rent[k]!).toBeGreaterThan(sp.rent[k - 1]!);
            expect(sp.house).toBeGreaterThan(0);
          }
        }
        expect(at('rail').length).toBe(b.railRent.length);
        expect(at('utility').length).toBe(b.utilityMul.length);
        expect(at('tax').length).toBe(2);
        const colours = b.groups.map((g) => b.display.groupColours[g.id]);
        expect(new Set(colours).size).toBe(b.groups.length);
        for (const c of colours) expect(c).toMatch(/^#[0-9a-f]{6}$/);
      });

      it('seats 2 to its cap, and its standard rules are valid ones', () => {
        expect(b.maxPlayers).toBeGreaterThanOrEqual(2);
        expect(b.maxPlayers).toBeLessThanOrEqual(SEAT_IDS.length);
        const cfg = normalizeConfig({ ...b.rules, board: b.id });
        for (const [k, v] of Object.entries(b.rules)) expect(cfg[k as keyof typeof cfg], k).toEqual(v);
        const seats = SEAT_IDS.slice(0, b.maxPlayers + 1).map((id, i) => ({ id, name: `P${i}` }));
        expect(() => createGame({ board: b.id }, seats.slice(0, b.maxPlayers), 1)).not.toThrow();
        if (b.maxPlayers < SEAT_IDS.length) expect(() => createGame({ board: b.id }, seats, 1)).toThrow(/at most/);
      });

      it('has two 16-card decks with the rulebook effects, unique ids and the right prefixes', () => {
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

      it('plays a whole random game with every invariant holding', () => {
        const seats = ['Ann', 'Bob', 'Cat'].map((name, i) => ({ id: SEAT_IDS[i]!, name }));
        for (const seed of [5, 6]) {
          let x: GameState = createGame({ ...b.rules, board: b.id }, seats, seed).state;
          const r = randFrom(seed * 7);
          for (let step = 0; step < 1500 && x.phase.k !== 'over'; step++) {
            const cmd = randomCommand(x, r);
            if (!cmd) break;
            const rx = apply(x, cmd, { check: true });
            if (rx.ok) x = rx.state;
          }
          expect(x.players.s0!.pos).toBeLessThan(n);
        }
      });
    });
  }

  it('the All Island board has no Sinhala script either', () => {
    expect(SINHALA.test(JSON.stringify(LANKA))).toBe(false);
  });
});
