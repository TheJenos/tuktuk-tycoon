import { describe, expect, it } from 'vitest';
import { LANKA, getBoard, isProperty } from '..';
import { mortgageOf } from '../rates';
import type { StreetDef } from '../types';

const b = LANKA;
const count = (k: string): number => b.spaces.filter((sp) => sp.k === k).length;

describe('Tuk-Tuk Tycoon board data', () => {
  it('has the 40 standard spaces', () => {
    expect(b.spaces).toHaveLength(40);
    expect(count('street')).toBe(22);
    expect(count('rail')).toBe(4);
    expect(count('utility')).toBe(2);
    expect(count('tax')).toBe(2);
    expect(count('chance')).toBe(3);
    expect(count('chest')).toBe(3);
    expect(['go', 'jail', 'parking', 'goToJail'].map(count)).toEqual([1, 1, 1, 1]);
    expect([0, 10, 20, 30].map((i) => b.spaces[i]?.k)).toEqual(['go', 'jail', 'parking', 'goToJail']);
    expect([5, 15, 25, 35].every((i) => b.spaces[i]?.k === 'rail')).toBe(true);
    expect([12, 28].every((i) => b.spaces[i]?.k === 'utility')).toBe(true);
    expect([7, 22, 36].every((i) => b.spaces[i]?.k === 'chance')).toBe(true);
    expect([2, 17, 33].every((i) => b.spaces[i]?.k === 'chest')).toBe(true);
    expect(b.spaces[4]).toMatchObject({ k: 'tax', tax: 'income' });
    expect(b.spaces[38]).toMatchObject({ k: 'tax', tax: 'luxury' });
    expect(b.spaces[b.jailIndex]?.k).toBe('jail');
    expect(b.spaces[b.goToJailIndex]?.k).toBe('goToJail');
  });

  it('groups every street once, sizes 2,3,3,3,3,3,3,2', () => {
    expect(b.groups.map((g) => g.spaces.length)).toEqual([2, 3, 3, 3, 3, 3, 3, 2]);
    const grouped = b.groups.flatMap((g) => g.spaces).sort((x, y) => x - y);
    const streets = b.spaces.flatMap((sp, i) => (sp.k === 'street' ? [i] : []));
    expect(grouped).toEqual(streets);
    for (const g of b.groups) {
      for (const i of g.spaces) expect((b.spaces[i] as StreetDef).group).toBe(g.id);
      expect(b.display.groupColours[g.id]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('prices, mortgages and rents match the Title Deeds', () => {
    let total = 0;
    for (const sp of b.spaces) {
      if (!isProperty(sp)) continue;
      total += sp.price;
      expect(sp.mortgage).toBe(mortgageOf(sp.price));
      if (sp.k === 'street') {
        expect(sp.rent).toHaveLength(6);
        for (let i = 1; i < 6; i++) expect(sp.rent[i]).toBeGreaterThan(sp.rent[i - 1] as number);
      }
    }
    expect(total).toBe(5690);
    expect(b.spaces[39]).toMatchObject({ name: 'Galle Face Penthouse', price: 400, rent: [50, 200, 600, 1400, 1700, 2000], house: 200 });
    expect(b.spaces[1]).toMatchObject({ name: 'Pettah Pavement', price: 60, rent: [2, 10, 30, 90, 160, 250], house: 50 });
    expect(b.spaces[12]).toMatchObject({ k: 'utility', price: 150, mortgage: 90 });
    expect(b.spaces[5]).toMatchObject({ k: 'rail', price: 200, mortgage: 120 });
    expect(b.spaces[1]).toMatchObject({ mortgage: 36 });
    expect(b.spaces[39]).toMatchObject({ mortgage: 240 });
    expect(b.railRent).toEqual([25, 50, 100, 200]);
    expect(b.utilityMul).toEqual([4, 10]);
  });

  it('has two 16-card decks with one Get Out of Jail Free each and stable, unique ids', () => {
    for (const [deck, prefix] of [
      [b.chance, 'ch-'],
      [b.chest, 'cc-'],
    ] as const) {
      expect(deck).toHaveLength(16);
      expect(deck.filter((c) => c.fx.k === 'goojf')).toHaveLength(1);
      expect(deck.every((c) => c.id.startsWith(prefix) && c.text.length > 0)).toBe(true);
      for (const c of deck) if (c.fx.k === 'advance') expect(b.spaces[c.fx.to]).toBeDefined();
    }
    const ids = [...b.chance, ...b.chest].map((c) => c.id);
    expect(new Set(ids).size).toBe(32);
  });

  it('uses the pre-2008 rulebook card amounts', () => {
    const fx = (id: string): unknown => [...b.chance, ...b.chest].find((c) => c.id === id)?.fx;
    expect(fx('ch-poortax')).toEqual({ k: 'cash', amount: -15 });
    expect(fx('ch-dividend')).toEqual({ k: 'cash', amount: 50 });
    expect(fx('ch-chairman')).toEqual({ k: 'each', amount: -50 });
    expect(fx('ch-loan')).toEqual({ k: 'cash', amount: 150 });
    expect(fx('ch-repairs')).toEqual({ k: 'repairs', house: 25, hotel: 100 });
    expect(b.chance.filter((c) => c.fx.k === 'nearest' && c.fx.kind === 'rail')).toHaveLength(2);
    expect(fx('cc-stock')).toEqual({ k: 'cash', amount: 45 });
    expect(fx('cc-school')).toEqual({ k: 'cash', amount: -150 });
    expect(fx('cc-doctor')).toEqual({ k: 'cash', amount: -50 });
    expect(fx('cc-hospital')).toEqual({ k: 'cash', amount: -100 });
    expect(fx('cc-services')).toEqual({ k: 'cash', amount: 25 });
    expect(fx('cc-wedding')).toEqual({ k: 'each', amount: 50 });
    expect(fx('cc-repairs')).toEqual({ k: 'repairs', house: 40, hotel: 115 });
    expect(b.chance.find((c) => c.id === 'ch-utility')?.text).toMatch(/ten times/);
    expect(b.chance.find((c) => c.id === 'ch-rail1')?.text).toMatch(/twice the fare/);
  });

  it('describes the Speed Die and the display block', () => {
    expect(b.speedDie.faces).toEqual([1, 2, 3, 'bus', 'uncle', 'uncle']);
    for (const f of b.speedDie.faces) expect(b.speedDie.labels[String(f)]).toBeTruthy();
    expect(b.display.title).toBe('TUK-TUK TYCOON');
    expect(b.display.decks).toEqual({ chance: "Astrologer's Advice", chest: 'Seettu Pot' });
  });

  it('is found by id, falling back to the default board', () => {
    expect(getBoard('lanka')).toBe(b);
    expect(getBoard('nope')).toBe(b);
  });
});
