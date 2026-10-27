import { describe, expect, it } from 'vitest';
import { getBoard } from '../../../rules';
import { shortSpaceName } from '../format';

describe('shortSpaceName (the MiniBoard cells)', () => {
  it('keeps every word of every space short enough for a cell, and tells them apart', () => {
    for (const b of [getBoard('lanka'), getBoard('heroes')]) for (const max of [9, 6]) {
      const labels = b.spaces.map((sp) => shortSpaceName(sp.name, max));
      for (const l of labels) for (const w of l.split(' ')) expect(w.length).toBeLessThanOrEqual(max);
      // Different spaces with different names never share a label
      const byLabel = new Map<string, Set<string>>();
      b.spaces.forEach((sp, i) => byLabel.set(labels[i] ?? '', (byLabel.get(labels[i] ?? '') ?? new Set()).add(sp.name)));
      for (const names of byLabel.values()) expect(names.size).toBe(1);
    }
  });

  it('drops the generic word, shortens long ones, and puts the suffix back where a short form needs it', () => {
    expect(shortSpaceName('Maradana Lane')).toBe('Maradana');
    expect(shortSpaceName('Peradeniya Gardens')).toBe('Peraden.');
    expect(shortSpaceName('Bambalapitiya Flats')).toBe('Bamba. Flats');
    expect(shortSpaceName('Colombo Fort Station')).toBe('Colombo Fort');
    expect(shortSpaceName('Kandy Station')).toBe('Kandy');
    expect(shortSpaceName('Power Cut Board')).toBe('Power Cut');
    expect(shortSpaceName('Negombo Fish Market')).toBe('Negombo Fish Market');
    expect(shortSpaceName("Astrologer's Advice")).toBe('Astrolog. Advice');
    // A well-known short form keeps the dropped generic word, so it cannot read like another space
    expect(shortSpaceName('Colombo Station', 6)).toBe('Col. Stn');
    // A long word nobody has a short form for is cut with a period, after a consonant
    expect(shortSpaceName('Wolverhampton Road')).toBe('Wolverh.');
    // The tiny cells' form
    expect(['Nuwara Eliya Tea Estate', 'Mirissa Whale Watch', 'Galle Face Penthouse', 'Colombo Fort Station', 'Rajagiriya Highrise'].map((n) => shortSpaceName(n, 6))).toEqual([
      'Nuwara Eliya Tea Estate',
      'Miris. Whale Watch',
      'Galle Face Penth.',
      'Col. Fort',
      'Rajag. Highr.',
    ]);
    // Nothing but the generic word: kept
    expect(shortSpaceName('Station')).toBe('Station');
    // A cut never ends on a hyphen
    expect(shortSpaceName('Island Lock-Up', 6)).toBe('Island Lock.');
  });
});
