import { describe, expect, it } from 'vitest';
import { LANKA } from '../../rules';
import { landingTable, twoDice } from '../landingProb';

describe('landing table', () => {
  const t = landingTable(LANKA);
  const p = (name: string): number => t.perRoll[LANKA.spaces.findIndex((sp) => sp.name === name)] ?? NaN;

  it('is a distribution over resting squares (jail trips and stays are not landings)', () => {
    const total = t.perRoll.reduce((a, x) => a + x, 0);
    expect(total).toBeGreaterThan(0.88);
    expect(total).toBeLessThan(0.97);
    expect(t.perRoll.every((x) => x >= 0)).toBe(true);
    expect(t.perRoll[LANKA.goToJailIndex]).toBe(0);
    expect(t.rollsPerTurn).toBeGreaterThan(1.1);
    expect(t.rollsPerTurn).toBeLessThan(1.25);
    t.perTurn.forEach((x, i) => expect(x).toBeCloseTo((t.perRoll[i] ?? 0) * t.rollsPerTurn, 4));
  });

  it('has the well-known shape: card squares low, Galle Fort Ramparts and the oranges high', () => {
    expect(p('Galle Fort Ramparts')).toBeGreaterThan(p('Pettah Pavement') * 1.3);
    expect(p('Horton Plains Viewpoint')).toBeGreaterThan(p('Kottu Street'));
    expect(p("Astrologer's Advice")).toBeLessThan(0.015);
    expect(p('Start')).toBeGreaterThan(1 / 40);
    expect(p('Colombo Fort Station')).toBeGreaterThan(p('Galle Station'));
  });

  it('is computed once per board', () => {
    expect(landingTable(LANKA)).toBe(t);
  });

  it('two dice sum to 1', () => {
    let sum = 0;
    for (let d = 2; d <= 12; d++) sum += twoDice(d);
    expect(sum).toBeCloseTo(1, 12);
    expect(twoDice(7)).toBeCloseTo(6 / 36, 12);
    expect(twoDice(1)).toBe(0);
  });
});
