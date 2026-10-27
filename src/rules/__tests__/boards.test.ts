import { describe, expect, it } from 'vitest';
import {
  apply,
  BOARD_IDS,
  BOARDS,
  checkInvariants,
  COLOMBO,
  createGame,
  getBoard,
  HEROES,
  HEROES_FIXED,
  HILL,
  LANKA,
  normalizeConfig,
  SEAT_IDS,
  SOUTH,
  type GameState,
} from '..';
import { HEROES_THEME } from '../../boards/heroes/theme';
import { COLOMBO_THEME } from '../../boards/colombo/theme';
import { HILL_THEME } from '../../boards/hill/theme';
import { LANKA_THEME } from '../../boards/lanka/theme';
import { SOUTH_THEME } from '../../boards/south/theme';
import { randFrom, randomCommand } from '../randomPlayer';
import { mortgageOf } from '../rates';
import type { BoardDef, CardDef, CardFx } from '../types';

/*
 * Every board stands on its own: its own size (a multiple of 4: GO, the jail, parking and Go To Jail on the corners),
 * its own colour groups and prices (rising around the board), its own player cap and standard rules. On the four
 * classic boards the prices come from the rulebook's tiers and the cards keep the rulebook's effects, pointed at the
 * board's own spaces (the All Island board is the rulebook's own 40 spaces). Hero League is the superhero edition's
 * board: 28 spaces, sixteen locations held by villains, its own two decks and six heroes.
 */

const THEMES = [COLOMBO, HILL, SOUTH];
const ALL = [LANKA, ...THEMES];
/** Every registered board, the classic ones and Hero League */
const EVERY: BoardDef[] = [...ALL, HEROES];

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
    expect(BOARD_IDS).toEqual(['lanka', 'colombo', 'hill', 'south', 'heroes']);
    expect(BOARDS.map((b) => b.name)).toEqual(['All Island', 'Colombo', 'Hill Country', 'Down South', 'Hero League']);
    for (const b of EVERY) {
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

  it('Hero League is the smallest, for 2 to 6 heroes', () => {
    expect([HEROES.id, HEROES.spaces.length, HEROES.maxPlayers]).toEqual(['heroes', 28, 6]);
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
            expect(sp.mortgage).toBe(mortgageOf(sp.price));
            expect(sp.rent).toHaveLength(6);
            for (let k = 1; k < 6; k++) expect(sp.rent[k]!).toBeGreaterThan(sp.rent[k - 1]!);
            expect(sp.house).toBeGreaterThan(0);
          }
        }
        expect(at('rail').length).toBe(b.railRent.length);
        expect(at('utility').length).toBe(b.utilityMul.length);
        for (const i of [...at('rail'), ...at('utility')]) {
          const sp = b.spaces[i];
          if (sp?.k !== 'rail' && sp?.k !== 'utility') throw new Error(`${i} is not a station or utility`);
          expect(sp.mortgage).toBe(mortgageOf(sp.price));
        }
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

  for (const b of EVERY) {
    describe(`${b.display.name}: what every board shares`, () => {
      const n = b.spaces.length;
      const at = (k: string) => b.spaces.flatMap((sp, i) => (sp.k === k ? [i] : []));

      it('has GO, the jail, parking and Go To Jail on its four corners', () => {
        expect(n % 4).toBe(0);
        expect(n).toBeGreaterThanOrEqual(28);
        expect(at('go')).toEqual([0]);
        expect(at('jail')).toEqual([n / 4]);
        expect(at('parking')).toEqual([n / 2]);
        expect(at('goToJail')).toEqual([(3 * n) / 4]);
        expect(b.jailIndex).toBe(n / 4);
        expect(b.goToJailIndex).toBe((3 * n) / 4);
      });

      it('has colour groups of its own streets, priced up the board, each in its own colour', () => {
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
            expect(sp.rent.length).toBeGreaterThanOrEqual(1);
          }
        }
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

      it('has decks with unique, prefixed ids and texts', () => {
        for (const [deck, prefix] of [
          [b.chance, 'ch-'],
          [b.chest, 'cc-'],
        ] as const) {
          expect(deck.length).toBeGreaterThan(0);
          expect(deck.every((c) => c.id.startsWith(prefix) && c.text.length > 0)).toBe(true);
        }
        const ids = [...b.chance, ...b.chest].map((c) => c.id);
        expect(new Set(ids).size).toBe(ids.length);
      });

      it('has unique names that fit their tiles, in English letters only', () => {
        const names = b.spaces.filter((sp) => sp.k !== 'chance' && sp.k !== 'chest').map((sp) => sp.name);
        expect(new Set(names).size).toBe(names.length);
        for (const sp of b.spaces) expect(sp.name.length, sp.name).toBeLessThanOrEqual(28);
        expect(b.spaces.filter((sp) => sp.k === 'chance').every((sp) => sp.name === b.display.decks.chance)).toBe(true);
        expect(b.spaces.filter((sp) => sp.k === 'chest').every((sp) => sp.name === b.display.decks.chest)).toBe(true);
        expect(SINHALA.test(JSON.stringify(b))).toBe(false);
        expect(b.display.blurb.length).toBeLessThanOrEqual(120);
      });

      it('plays a whole random game: every command applies and keeps every invariant', () => {
        const seats = ['Ann', 'Bob', 'Cat'].map((name, i) => ({ id: SEAT_IDS[i]!, name }));
        for (const seed of [5, 6]) {
          let x: GameState = createGame({ ...b.rules, board: b.id }, seats, seed).state;
          const r = randFrom(seed * 7);
          for (let step = 0; step < 1500 && x.phase.k !== 'over'; step++) {
            const cmd = randomCommand(x, r);
            if (!cmd) break;
            const rx = apply(x, cmd, { check: true });
            // Only a random trade offer may be refused
            if (!rx.ok && cmd.a.k !== 'propose') throw new Error(`${JSON.stringify(cmd)}: ${rx.error.message}`);
            if (rx.ok) x = rx.state;
          }
          expect(checkInvariants(x)).toEqual([]);
          expect(x.players.s0!.pos).toBeLessThan(n);
        }
      });
    });
  }

  it('the All Island board has no Sinhala script either', () => {
    expect(SINHALA.test(JSON.stringify(LANKA))).toBe(false);
  });

  it('token ids are unique across boards', () => {
    const ids = [LANKA_THEME, COLOMBO_THEME, HILL_THEME, SOUTH_THEME, HEROES_THEME].flatMap((t) => t.tokens.map((x) => x.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

/** The amounts a Hero League card's text must print ("<n> Power") */
function powerAmounts(fx: CardFx): string[] {
  const shown = (n: number): string => `${Math.abs(n).toLocaleString('en-US')} Power`;
  if (fx.k === 'cash' || fx.k === 'each') return [shown(fx.amount)];
  if (fx.k === 'heroDie' && fx.hit.k === 'cash') return [shown(fx.hit.amount)];
  return [];
}

/** Names of the superhero IP the board parodies, and of other IP: none may ship (case-sensitive where a word is common) */
const TRADEMARKS = [
  /marvel/i,
  /avengers?/i,
  /S\.?H\.?I\.?E\.?L\.?D/,
  /monopoly/i,
  /hasbro/i,
  /\bhulk\b/i,
  /\bthor\b/i,
  /iron ?man/i,
  /captain america/i,
  /black widow/i,
  /hawkeye/i,
  /\bloki\b/i,
  /thanos/i,
  /red skull/i,
  /crimson skull/i,
  /ultron/i,
  /doctor doom/i,
  /magneto/i,
  /galactus/i,
  /\bhydra\b/i,
  /asgard/i,
  /wakanda/i,
  /\bstark\b/i,
  /daily bugle/i,
  /helicarrier/i,
  /vibranium/i,
  /latveria/i,
  /sanctum sanctorum/i,
  /savage land/i,
  /atlantis/i,
  /baxter/i,
  /omnitron/i,
  /trickster/i,
  /\bskrulls?\b/i,
  /\bkree\b/i,
  /triskelion/i,
  /chitauri/i,
  /abomination/i,
  /quinjet/i,
];

describe('Hero League', () => {
  const b = HEROES;
  const at = (k: string) => b.spaces.flatMap((sp, i) => (sp.k === k ? [i] : []));

  it('has 28 spaces: 16 locations in 8 colour pairs, 6 Villain Strike and 2 Hero HQ, nothing else', () => {
    expect(b.spaces).toHaveLength(28);
    expect(at('street')).toHaveLength(16);
    expect(at('chance')).toEqual([5, 8, 11, 18, 20, 25]);
    expect(at('chest')).toEqual([3, 23]);
    expect([...at('rail'), ...at('utility'), ...at('tax')]).toEqual([]);
    expect(b.railRent).toEqual([]);
    expect(b.utilityMul).toEqual([]);
    expect(b.groups.map((g) => [g.id, g.spaces])).toEqual([
      ['brown', [1, 2]],
      ['teal', [4, 6]],
      ['pink', [9, 10]],
      ['orange', [12, 13]],
      ['red', [15, 16]],
      ['yellow', [17, 19]],
      ['green', [22, 24]],
      ['purple', [26, 27]],
    ]);
    expect(b.display.groupColours).toEqual({
      brown: '#8b4c2c',
      teal: '#1aa3a3',
      pink: '#d6408f',
      orange: '#f4921f',
      red: '#e2232a',
      yellow: '#f9e11e',
      green: '#1fa952',
      purple: '#6b3fa0',
    });
  });

  it('lays out the spaces of the plan, with the readable values of the photo kept', () => {
    const table = b.spaces.map((sp) => (sp.k === 'street' ? [sp.name, sp.group, sp.price, sp.rent[0], sp.villain] : [sp.name, sp.k]));
    expect(table).toEqual([
      ['Rally Point', 'go'],
      ['Midtown Back Alleys', 'brown', 70, 40, 'Star Swarm'],
      ['Harbour Docks', 'brown', 70, 40, 'The Brute'],
      ['Hero HQ', 'chest'],
      ['The Iron Raft', 'teal', 120, 70, 'The Fang Legion'],
      ['Villain Strike', 'chance'],
      ['Island Lock-Up', 'teal', 120, 70, 'The Illusionist'],
      ['Holding Cell', 'jail'],
      ['Villain Strike', 'chance'],
      ['Daily Trumpet Tower', 'pink', 160, 100, 'The Cranium'],
      ['Mystic Sanctum', 'pink', 180, 110, 'The Bone Baron'],
      ['Villain Strike', 'chance'],
      ['Lost Jungle', 'orange', 200, 120, 'Star Swarm'],
      ['Floating City', 'orange', 220, 130, 'Cyber Tyrant'],
      ['Rooftop Lookout', 'parking'],
      ['Tri-Fort HQ', 'red', 240, 140, 'The Brute'],
      ['Sky Carrier', 'red', 260, 150, 'The Fang Legion'],
      ['Sunken Kingdom', 'yellow', 280, 170, 'The Hourglass'],
      ['Villain Strike', 'chance'],
      ['Realm Eternal', 'yellow', 300, 180, 'The Illusionist'],
      ['Villain Strike', 'chance'],
      ['Villain Ambush', 'goToJail'],
      ['Hidden Kingdom', 'green', 320, 190, 'The Cranium'],
      ['Hero HQ', 'chest'],
      ['Starmetal Mines', 'green', 320, 190, 'The Hourglass'],
      ['Villain Strike', 'chance'],
      ['Hero Mansion', 'purple', 400, 240, 'Cyber Tyrant'],
      ['League Tower', 'purple', 400, 240, 'The Bone Baron'],
    ]);
  });

  it('gives each location one power-up of about 60% of its cost, no buildings and no mortgage; 8 villains hold two each', () => {
    const villains = new Map<string, number>();
    let last = 0;
    for (const sp of b.spaces) {
      if (sp.k !== 'street') continue;
      expect(sp.rent).toHaveLength(1);
      const share = (sp.rent[0] ?? 0) / sp.price;
      expect(share, sp.name).toBeGreaterThanOrEqual(0.5);
      expect(share, sp.name).toBeLessThanOrEqual(0.65);
      expect(sp.rent[0]).toBeGreaterThanOrEqual(last);
      last = sp.rent[0] ?? 0;
      expect(sp.house).toBe(0);
      expect(sp.mortgage).toBe(0);
      villains.set(sp.villain ?? '', (villains.get(sp.villain ?? '') ?? 0) + 1);
    }
    expect(villains.size).toBe(8);
    expect([...villains.values()].every((x) => x === 2)).toBe(true);
  });

  it('plays the Hero League rules: heroes, pinned rules, its display', () => {
    expect(b.heroes).toEqual({
      list: expect.any(Array),
      locationPoints: 100,
      stingMax: 6,
      aimCards: 2,
    });
    expect(b.heroes?.list.map((h) => [h.id, h.name, h.colour, h.power, h.powerName])).toEqual([
      ['jadeTitan', 'Jade Titan', '#2e9e44', 'smash', 'Titan Smash'],
      ['starCaptain', 'Star Captain', '#2457c5', 'shield', 'Star Shield'],
      ['steelAce', 'Steel Ace', '#d4a017', 'copy', 'Suit Up'],
      ['stormLord', 'Storm Lord', '#c8102e', 'thunder', 'Thunder Call'],
      ['velvetViper', 'Velvet Viper', '#3d3d4a', 'sting', 'Viper Strike'],
      ['sharpshot', 'Sharpshot', '#7b3fc4', 'aim', 'Dead Aim'],
    ]);
    expect(b.heroes?.list.map((h) => h.powerText)).toEqual([
      "At the start of your turn, swap the places of any 2 heroes. They don't pass Rally Point or do anything else.",
      'Say no to any Villain Strike card or Titan Smash played against you.',
      "Use any other hero's superpower, as long as it's ready.",
      "Don't like a throw, yours or another hero's? Demand a re-roll! Works on the dice and the Hero die.",
      'Move up to 6 extra spaces on your dice move.',
      'When you land on Villain Strike, take 2 cards and play the one you choose.',
    ]);
    for (const h of b.heroes?.list ?? []) expect(h.id).toMatch(/^[a-zA-Z]+$/);
    // The heroes are the board's tokens
    expect(HEROES_THEME.tokens).toEqual(b.heroes?.list.map((h) => ({ id: h.id, label: h.name })));
    expect(HEROES_THEME.botNames).toEqual(['Ruwan', 'Sachini', 'Dilan', 'Nethmi', 'Kavindu', 'Ishani']);
    expect(HEROES_THEME.loopSeconds).toBe(LANKA_THEME.loopSeconds);
    expect(b.rules).toEqual(HEROES_FIXED);
    expect(b.display).toEqual({
      title: 'TUK-TUK TYCOON',
      name: 'Hero League',
      subtitle: 'Hero League',
      blurb: 'Save the city from eight villains: superpowers, a Hero die, and nobody goes bankrupt.',
      rulesBlurb: 'Power instead of money, compulsory saving and superpowers; ends when every location is saved',
      decks: { chance: 'Villain Strike', chest: 'Hero HQ' },
      currency: { symbol: 'Power', scale: 1, after: true },
      terms: { property: 'location', buy: 'save', bought: 'saved', rent: 'power-up', bank: 'the Power Broker', worth: 'score' },
      art: { chance: 'mask', chest: 'shield', parking: 'lookout', goToJail: 'ambush', goLine: 'AS YOU PASS' },
      groupColours: b.display.groupColours,
    });
  });

  it('has a 20-card Villain Strike deck and a 16-card Hero HQ deck with the effects of the plan', () => {
    const hd = (rolls: number, hit: object) => ({ k: 'heroDie', rolls, hit });
    expect(b.chance.map((c) => c.fx)).toEqual([
      hd(1, { k: 'cash', amount: -100 }),
      hd(2, { k: 'cash', amount: -50 }),
      hd(3, { k: 'cash', amount: -30 }),
      hd(1, { k: 'cash', amount: -150 }),
      hd(1, { k: 'lose' }),
      hd(1, { k: 'cash', amount: -75 }),
      hd(1, { k: 'jail' }),
      hd(2, { k: 'back', n: 3 }),
      hd(2, { k: 'cash', amount: -50 }),
      { k: 'cash', amount: -50 },
      { k: 'cash', amount: -100 },
      { k: 'jail' },
      { k: 'back', n: 3 },
      { k: 'lose' },
      { k: 'cash', amount: -75 },
      { k: 'each', amount: -25 },
      { k: 'advance', to: 0 },
      { k: 'advance', to: 4 },
      { k: 'advance', to: 27 },
      hd(1, { k: 'back', n: 3 }),
    ]);
    expect(b.chest.map((c) => c.fx)).toEqual([
      { k: 'cash', amount: 100 },
      { k: 'cash', amount: 50 },
      { k: 'cash', amount: 150 },
      { k: 'cash', amount: 200 },
      { k: 'cash', amount: 25 },
      { k: 'each', amount: 20 },
      { k: 'advance', to: 0 },
      { k: 'nearestFree', free: false },
      { k: 'nearestFree', free: false },
      { k: 'nearestFree', free: true },
      { k: 'nearestFree', free: true },
      { k: 'recharge' },
      { k: 'recharge' },
      { k: 'cash', amount: 75 },
      { k: 'each', amount: 10 },
      { k: 'cash', amount: 100 },
    ]);
    // Every Hero HQ card helps
    for (const c of b.chest) expect(c.fx.k === 'cash' || c.fx.k === 'each' ? c.fx.amount > 0 : true, c.id).toBe(true);
  });

  it('card texts read in Power, name their destination and say what the Hero die does', () => {
    expect(b.chance[0]?.text).toBe('The Illusionist casts a spell. Roll the Hero die: the hero rolled loses 100 Power.');
    expect(b.chance[11]?.text).toBe(
      'Ambushed by the Fang Legion. Go to the Holding Cell. Do not pass Rally Point, do not collect 200 Power.',
    );
    expect(b.chest[9]?.text).toBe('Strike team ready. Advance to the nearest villain-held location and save it for free.');
    for (const c of [...b.chance, ...b.chest]) {
      const fx = c.fx;
      if (fx.k === 'advance') expect(c.text, c.id).toContain(`Advance to ${b.spaces[fx.to]?.name}`);
      if (fx.k === 'jail') expect(c.text, c.id).toContain('Holding Cell');
      if (fx.k === 'back') expect(c.text, c.id).toContain(`Go back ${fx.n} spaces`);
      if (fx.k === 'heroDie') {
        expect(c.text, c.id).toContain('Roll the Hero die');
        if (fx.rolls === 2) expect(c.text, c.id).toContain('twice');
        if (fx.rolls === 3) expect(c.text, c.id).toContain('3 times');
        if (fx.hit.k === 'back') expect(c.text, c.id).toContain(`goes back ${fx.hit.n} spaces`);
        if (fx.hit.k === 'jail') expect(c.text, c.id).toContain('Holding Cell');
        if (fx.hit.k === 'lose') expect(c.text, c.id).toContain('cheapest location');
      }
      if (fx.k === 'nearestFree') expect(c.text, c.id).toContain(fx.free ? 'save it for free' : 'you must save it');
      const want = powerAmounts(fx);
      for (const a of want) expect(c.text, c.id).toContain(a);
      const salary = fx.k === 'advance' || fx.k === 'jail' ? ['200 Power'] : [];
      for (const m of c.text.match(/[\d,]+ Power/g) ?? []) expect([...want, ...salary], `${c.id}: ${m}`).toContain(m);
      expect(c.text, c.id).not.toMatch(/Rs\./);
    }
  });

  it('ships no name of the IP it parodies (or of any other)', () => {
    const shipped = JSON.stringify(b) + JSON.stringify(HEROES_THEME);
    for (const tm of TRADEMARKS) expect(shipped, String(tm)).not.toMatch(tm);
  });
});
