import { drawCard, playPicked } from './cards';
import { type Ctx, emit, err, isActive, player, setPhase } from './ctx';
import { isDoubles } from './dice';
import { type Handler, isInt, seatAction, turnCheck } from './handler';
import { powerSource, swappable, usePower } from './heroes';
import { sendToJail } from './movement';
import { windowProblem } from './react';
import type { GameState, RuleError, SeatId, Step } from './types';

/*
 * Hero League's superpowers that are actions of their own: Viper Strike (the `boost` phase after the move throw),
 * Titan Smash (`smash` before the turn's first roll) and Dead Aim (the `aim` phase on a Villain Strike space). Thunder
 * Call and Star Shield answer reaction windows (react.ts); Suit Up is any of these copied (heroes.ts powerSource).
 */

/**
 * The move throw stands (its Thunder window is over): doubles and the third-doubles jail are judged on it, then
 * Viper Strike may extend the move (`boost`), then the move, the landing and afterRoll. Doubles count the dice only.
 */
export function throwDone(c: Ctx, seat: SeatId): void {
  const s = c.s;
  const r = s.turn.roll;
  if (!r || !isActive(s, seat) || player(s, seat).jail) return;
  const doubles = isDoubles(r);
  if (doubles) s.turn.doubles = Math.min(3, s.turn.doubles + 1);
  if (doubles && s.turn.doubles >= 3 && s.cfg.threeDoublesJail) {
    sendToJail(c, seat, 'doubles');
    return;
  }
  s.turn.again = doubles;
  const total = r.w[0] + r.w[1];
  const move: Step = { k: 'move', seat, to: (player(s, seat).pos + total) % c.b.spaces.length, via: 'dice' };
  s.pending.unshift({ k: 'land', seat }, { k: 'afterRoll' });
  if (powerSource(c.b, s, seat, 'sting')) setPhase(c, { k: 'boost', seat, total, then: move, resume: { k: 'busy' } });
  else s.pending.unshift(move);
}

/** Viper Strike: n (1..stingMax) spaces further than the dice, in one walk with one landing */
export const sting: Handler<'sting'> = seatAction(
  (s, b, seat, a) => {
    if (s.phase.k !== 'boost') return err('phase', 'Viper Strike is used on your dice move');
    const e = windowProblem(s, seat, a.at);
    if (e) return e;
    const max = b.heroes?.stingMax ?? 0;
    if (!isInt(a.n) || a.n < 1 || a.n > max) return err('badMove', `Move 1 to ${max} extra spaces`);
    return powerSource(b, s, seat, 'sting') ? null : err('power', 'Viper Strike is not ready');
  },
  (c, seat, a) => {
    const ph = c.s.phase;
    if (ph.k !== 'boost') return;
    usePower(c, seat, 'sting');
    setPhase(c, ph.resume);
    const then = ph.then.k === 'move' ? { ...ph.then, to: (ph.then.to + a.n) % c.b.spaces.length } : ph.then;
    c.s.pending.unshift(then);
  },
);

/** No Viper Strike: the dice move as thrown (the power stays ready) */
export function passBoost(c: Ctx): void {
  const ph = c.s.phase;
  if (ph.k !== 'boost') return;
  setPhase(c, ph.resume);
  c.s.pending.unshift(ph.then);
}

/** Titan Smash, before the turn's first roll: two heroes (the smasher may be one) trade places, then back to preRoll */
export const smash: Handler<'smash'> = seatAction(
  (s, b, seat, a) => {
    if (!b.heroes) return err('noPowers', 'There are no superpowers on this board');
    const e = turnCheck(s, seat, 'preRoll');
    if (e) return e;
    if (s.turn.roll) return err('started', 'Titan Smash is only at the start of your turn');
    if (!powerSource(b, s, seat, 'smash')) return err('power', 'Titan Smash is not ready');
    if (!swappable(s, a.a, a.b)) {
      return err('badTargets', 'Pick two different heroes in play and not in the Holding Cell');
    }
    return null;
  },
  (c, seat, a) => {
    usePower(c, seat, 'smash');
    setPhase(c, { k: 'busy' });
    c.s.pending = [{ k: 'swap', by: seat, a: a.a, b: a.b, asked: 0 }, { k: 'beforeRoll' }];
  },
);

/** Dead Aim: reveal the top cards (they stay in the deck); a fresh decision timer for the pick */
export const aim: Handler<'aim'> = seatAction(
  (s, b, seat, a) => {
    if (s.phase.k !== 'aim') return err('phase', 'Dead Aim is used on a Villain Strike space');
    const e = windowProblem(s, seat, a.at);
    if (e) return e;
    if (s.phase.cards) return err('aimed', 'Pick one of the revealed cards');
    return powerSource(b, s, seat, 'aim') ? null : err('power', 'Dead Aim is not ready');
  },
  (c, seat) => {
    const ph = c.s.phase;
    if (ph.k !== 'aim') return;
    usePower(c, seat, 'aim');
    const cards = c.s.decks[ph.deck].slice(0, c.b.heroes?.aimCards ?? 2);
    emit(c, { t: 'aimPeek', seat, deck: ph.deck, cards: [...cards] });
    setPhase(c, { ...ph, cards });
  },
);

/** Dead Aim's pick: play one of the revealed cards (the other goes to the bottom first, then the one played) */
export const pickCard: Handler<'pickCard'> = seatAction(
  (s, _b, seat, a) => {
    if (s.phase.k !== 'aim') return err('phase', 'There is no card to pick');
    const e = windowProblem(s, seat, a.at);
    if (e) return e;
    const cards = s.phase.cards;
    if (!cards) return err('notAimed', 'Take aim first, or draw normally');
    return typeof a.card === 'string' && cards.includes(a.card) ? null : err('badCard', 'Pick one of the revealed cards');
  },
  (c, seat, a) => {
    const ph = c.s.phase;
    if (ph.k !== 'aim' || !ph.cards) return;
    setPhase(c, ph.resume);
    playPicked(c, seat, ph.deck, ph.cards, a.card);
  },
);

/** Before the reveal only: no Dead Aim, draw the top card as usual (the power stays ready) */
export function checkPassAim(s: GameState, seat: SeatId, at: unknown): RuleError | null {
  const e = windowProblem(s, seat, at);
  if (e) return e;
  return s.phase.k === 'aim' && s.phase.cards ? err('aimed', 'Pick one of the revealed cards') : null;
}

export function passAim(c: Ctx, seat: SeatId): void {
  const ph = c.s.phase;
  if (ph.k !== 'aim') return;
  setPhase(c, ph.resume);
  drawCard(c, seat, ph.deck);
}
