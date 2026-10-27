import { describe, expect, it } from 'vitest';
import { apply, awaiting, smashPairs, type GameState, type SeatId } from '../../rules';
import { decide } from '..';
import { SKILLS, heroGame } from './helpers';

/*
 * No peeking on Hero League: the order of the decks and the state's RNG (what the next card and the next throw will be)
 * are hidden from the players, so the bots must not read them. Every decision point of a few bot games (each window
 * and turn phase, before any Dead Aim reveal) is decided again with every deck in another order and another RNG, and
 * every skill must answer the same.
 */

/** The same position with the hidden parts changed: each deck rotated and reversed, another RNG state */
function scrambled(s: GameState): GameState {
  const t = structuredClone(s);
  for (const deck of ['chance', 'chest'] as const) {
    const d = t.decks[deck];
    t.decks[deck] = [...d.slice(3), ...d.slice(0, 3)].reverse();
  }
  t.rng = (Math.imul(t.rng, 1664525) + 1013904223) >>> 0 || 1;
  return t;
}

/** Positions where a bot is asked to decide (none after a Dead Aim reveal: the aiming seat has seen those cards) */
function decisionPoints(): GameState[] {
  const out: GameState[] = [];
  const heroes = ['jadeTitan', 'starCaptain', 'steelAce', 'stormLord', 'velvetViper', 'sharpshot'];
  for (let g = 0; g < 4; g++) {
    // Rotate the heroes so each one sits in a different seat game by game
    let s = heroGame([...heroes.slice(g), ...heroes.slice(0, g)].slice(0, 6 - g), { debug: false }, 70 + g);
    for (let n = 0; n < 2000 && s.phase.k !== 'over'; n++) {
      const seat = awaiting(s)[0] as SeatId;
      if (!(s.phase.k === 'aim' && s.phase.cards)) out.push(s);
      const a = decide(s, seat, SKILLS[n % SKILLS.length] as (typeof SKILLS)[number], () => 0.5);
      if (!a) throw new Error(`no action for ${seat} in ${s.phase.k}`);
      const r = apply(s, { by: seat, a }, { check: false });
      if (!r.ok) throw new Error(r.error.message);
      s = r.state;
    }
  }
  return out;
}

describe('Hero League: no peeking', () => {
  it('decides the same whatever order the decks are in and whatever the RNG holds', { timeout: 60_000 }, () => {
    const points = decisionPoints();
    const seen = new Set<string>();
    for (const s of points) {
      const ph = s.phase;
      seen.add(ph.k === 'react' ? `react:${ph.kind}:${ph.about.k}` : ph.k === 'preRoll' && smashPairs(s, s.turn.seat).length ? 'smash' : ph.k);
      const t = scrambled(s);
      for (const seat of awaiting(s)) {
        for (const skill of SKILLS) {
          expect(decide(t, seat, skill, () => 0.5), `${skill} ${seat} in ${ph.k} at seq ${s.seq}`).toEqual(decide(s, seat, skill, () => 0.5));
        }
      }
    }
    // Every kind of decision came up
    for (const k of ['react:thunder:move', 'react:thunder:hero', 'react:shield:hit', 'aim', 'boost', 'smash', 'postRoll']) {
      expect(seen, k).toContain(k);
    }
  });
});
