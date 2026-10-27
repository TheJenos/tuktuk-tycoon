import { auctionDone, closeAuction } from './auction';
import { advancePlace, resolveClaim } from './claim';
import { type Ctx, emit, isActive, player, seatsAfter, setPhase } from './ctx';
import { type Handler, seatAction, turnCheck } from './handler';
import { land } from './landing';
import { pay, settleDebt } from './money';
import { moveBack, moveForward, nextBankOwned, nextRentOwed } from './movement';
import { finish } from './over';
import { powerSource } from './heroes';
import { passAim, passBoost, throwDone } from './powers';
import { backupPick, heroFace, hit, liveOpen, swap, throwHero } from './react';
import type { SeatId, Step } from './types';

/*
 * The turn's work queue. A roll pushes steps (move, land, Tuk-Tuk Uncle, afterRoll) and drain() runs them until a
 * step needs input (buy, Income Tax, an auction, a debt...). Interrupt phases that need no input (a debt that can
 * now be paid, a finished auction, a closed contest window) are resolved here too, so after every command the game
 * rests in a phase where someone must act.
 */

export function drain(c: Ctx): void {
  for (let guard = 0; guard < 10_000; guard++) {
    const ph = c.s.phase;
    switch (ph.k) {
      case 'over':
        c.s.pending = [];
        return;
      case 'debt':
        if (!settleDebt(c)) return;
        break;
      case 'auction':
        if (!auctionDone(c.s, ph)) return;
        closeAuction(c);
        break;
      case 'buildClaim':
        if (ph.open.length > 0) return;
        resolveClaim(c);
        break;
      case 'place':
        if (!advancePlace(c)) return;
        break;
      case 'mortgageXfer':
        if (isActive(c.s, ph.seat) && ph.spaces.length > 0) return;
        setPhase(c, ph.resume);
        break;
      case 'react':
        // A reaction window rests while someone can still answer it (a seat leaving may take that away: liveOpen);
        // then what it held back runs first
        ph.open = liveOpen(c.b, c.s, ph);
        if (ph.open.length) return;
        setPhase(c, ph.resume);
        c.s.pending.unshift(ph.then);
        break;
      case 'boost':
        // Viper Strike no longer usable (the hero a Steel Ace copies left): the dice move as thrown
        if (powerSource(c.b, c.s, ph.seat, 'sting')) return;
        passBoost(c);
        break;
      case 'aim':
        // Dead Aim no longer usable before the reveal (the hero a Steel Ace copies left): draw as usual
        if (ph.cards || powerSource(c.b, c.s, ph.seat, 'aim')) return;
        passAim(c, ph.seat);
        break;
      case 'busy': {
        const step = c.s.pending.shift();
        if (step) runStep(c, step);
        else if (isActive(c.s, c.s.turn.seat)) setPhase(c, { k: 'postRoll' });
        else nextTurn(c);
        break;
      }
      default:
        return;
    }
  }
  throw new Error('drain did not settle');
}

function runStep(c: Ctx, st: Step): void {
  switch (st.k) {
    case 'move':
      if (isActive(c.s, st.seat)) moveForward(c, st.seat, st.to, st.via);
      return;
    case 'back':
      if (isActive(c.s, st.seat)) moveBack(c, st.seat, st.n);
      return;
    case 'land':
      if (isActive(c.s, st.seat)) {
        land(c, st.seat, {
          ...(st.rentMul ? { rentMul: st.rentMul } : {}),
          ...(st.utilFresh ? { utilFresh: true as const } : {}),
          ...(st.free ? { free: true as const } : {}),
        });
      }
      return;
    case 'uncle':
      uncle(c, st.seat);
      return;
    case 'pay':
      pay(c, st.from, st.owed, st.why);
      return;
    case 'free':
      if (isActive(c.s, st.seat)) {
        delete player(c.s, st.seat).jail;
        emit(c, { t: 'jailExit', seat: st.seat, how: st.how });
      }
      return;
    case 'afterRoll': {
      const seat = c.s.turn.seat;
      const again = c.s.turn.again && isActive(c.s, seat) && !player(c.s, seat).jail;
      setPhase(c, { k: again ? 'preRoll' : 'postRoll' });
      return;
    }
    case 'nextTurn':
      nextTurn(c);
      return;
    // Hero League (react.ts, powers.ts)
    case 'throwDone':
      throwDone(c, st.seat);
      return;
    case 'throwHero':
      throwHero(c, st);
      return;
    case 'heroFace':
      heroFace(c, st);
      return;
    case 'hit':
      hit(c, st);
      return;
    case 'backupPick':
      backupPick(c, st);
      return;
    case 'swap':
      swap(c, st);
      return;
    case 'beforeRoll':
      setPhase(c, { k: 'preRoll' });
      return;
  }
}

/**
 * Tuk-Tuk Uncle, after the first landing is fully resolved: on to the next property the bank owns (buy it or it is
 * auctioned); if the bank owns none, to the next property where rent is owed to another player; else stay put.
 * When the bank's only property is the one underfoot (declined, no bids) the bank still owns one: stay put.
 */
function uncle(c: Ctx, seat: SeatId): void {
  if (!isActive(c.s, seat) || player(c.s, seat).jail) return;
  const pos = player(c.s, seat).pos;
  const bank = nextBankOwned(c, pos);
  const rent = bank === undefined ? nextRentOwed(c, seat, pos) : undefined;
  const to = bank ?? rent;
  if (to === undefined || to === pos) {
    emit(c, { t: 'uncle', seat });
    return;
  }
  emit(c, { t: 'uncle', seat, to, target: bank === undefined ? 'rent' : 'bank' });
  c.s.pending.unshift({ k: 'move', seat, to, via: 'uncle' }, { k: 'land', seat });
}

/**
 * Passes the turn to the next seat still in (and ends the game at the turn limit). Hero League: a jailed seat pays
 * the fine at once (what it has, if short) and leaves the Holding Cell, then rolls as usual.
 */
export function nextTurn(c: Ctx): void {
  const s = c.s;
  if (s.cfg.turnLimit > 0 && s.turn.no >= s.cfg.turnLimit) {
    finish(c, 'turnLimit');
    return;
  }
  const next = seatsAfter(s, s.turn.seat).find((seat) => isActive(s, seat)) ?? s.turn.seat;
  s.turn = { seat: next, no: s.turn.no + 1, doubles: 0, again: false };
  s.pending = [];
  setPhase(c, { k: 'preRoll' });
  emit(c, { t: 'turn', seat: next, no: s.turn.no });
  if (c.b.heroes && player(s, next).jail) {
    pay(c, next, { bank: s.cfg.jailFine }, 'fine');
    delete player(s, next).jail;
    emit(c, { t: 'jailExit', seat: next, how: 'fine' });
  }
}

export const endTurn: Handler<'endTurn'> = seatAction(
  (s, _b, seat) => turnCheck(s, seat, 'postRoll'),
  (c) => nextTurn(c),
);
