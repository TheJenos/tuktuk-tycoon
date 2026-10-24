import { describe, expect, it } from 'vitest';
import { LANKA } from '../../../rules';
import { deedFor, spaceBlurb } from '../deeds/deed';
import { game, own } from './helpers';

const active = (rows: { label: string; active?: boolean }[]) => rows.filter((r) => r.active).map((r) => r.label);

describe('deedFor', () => {
  it('prints a street deed with the double-rent row, costs and the lift price', () => {
    const d = deedFor(LANKA, 39, null)!;
    expect(d.kind).toBe('street');
    expect(d.colour).toBe(LANKA.display.groupColours.darkBlue);
    expect(d.rent.map((r) => r.value)).toEqual(['Rs. 50', 'Rs. 100', 'Rs. 200', 'Rs. 600', 'Rs. 1,400', 'Rs. 1,700', 'Rs. 2,000']);
    expect(d.costs.map((r) => r.value)).toEqual(['Rs. 200 each', 'Rs. 200 plus 4 houses', 'Rs. 200', 'Rs. 220']);
    expect(active(d.rent)).toEqual([]);
  });

  it('marks the rent that applies now', () => {
    const s = game();
    own(s, 's0', [39]);
    expect(active(deedFor(LANKA, 39, s)!.rent)).toEqual(['Rent']);
    own(s, 's0', [37]);
    expect(active(deedFor(LANKA, 39, s)!.rent)).toEqual(['With the colour set']);
    s.props.p39!.level = 3;
    expect(active(deedFor(LANKA, 39, s)!.rent)).toEqual(['With 3 houses']);
    s.props.p39 = { owner: 's0', level: 0, mortgaged: true };
    const d = deedFor(LANKA, 39, s)!;
    expect(d.mortgaged).toBe(true);
    expect(active(d.rent)).toEqual([]);
  });

  it('counts stations and boards owned', () => {
    const s = game(2, { speedDie: true });
    own(s, 's1', [5, 15, 25]);
    const rail = deedFor(LANKA, 15, s)!;
    expect(rail.rent.map((r) => r.value)).toEqual(['Rs. 25', 'Rs. 50', 'Rs. 100', 'Rs. 200']);
    expect(active(rail.rent)).toEqual(['If 3 stations are owned']);
    own(s, 's1', [12]);
    const util = deedFor(LANKA, 12, s)!;
    expect(active(util.rent)).toEqual(['If one board is owned']);
    expect(util.note).toMatch(/all three/);
    expect(util.costs.map((r) => r.value)).toEqual(['Rs. 75', 'Rs. 83']);
    expect(deedFor(LANKA, 12, game())!.note).toBeUndefined();
  });

  it('describes the other spaces and has no deed for them', () => {
    expect(deedFor(LANKA, 0, null)).toBeNull();
    for (const sp of LANKA.spaces) if (sp.k !== 'street' && sp.k !== 'rail' && sp.k !== 'utility') {
      expect(spaceBlurb(LANKA, sp, game()).length).toBeGreaterThan(10);
    }
    expect(spaceBlurb(LANKA, LANKA.spaces[38], null)).toBe('Wedding Gift Envelope: pay Rs. 75.');
    expect(spaceBlurb(LANKA, LANKA.spaces[30], null)).toBe('Go directly to the Police Station Bench. Do not pass Start, do not collect your salary.');
    expect(spaceBlurb(LANKA, LANKA.spaces[7], null)).toBe("Draw the top Astrologer's Advice card and do what it says.");
  });
});
