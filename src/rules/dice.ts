import { type Ctx, emit, err, player, setPhase } from './ctx';
import { type Handler, isInt, seatAction } from './handler';
import { faceValue } from './rent';
import { d6 } from './rng';
import { sendToJail } from './movement';
import type { Roll, SeatId, Step } from './types';

/** The Speed Die is rolled for this seat: rules on, unlocked, and not a roll to get out of jail */
export const speedActive = (c: Ctx, seat: SeatId): boolean => c.s.cfg.speedDie && player(c.s, seat).speed;

/** A throw: the next rigged one (debug) or fresh dice from the state's RNG */
export function throwDice(c: Ctx, withSpeed: boolean): Roll {
  const faces = c.b.speedDie.faces;
  const rig = c.s.rig.shift();
  const w: [number, number] = rig ? [rig[0], rig[1]] : [d6(c.s), d6(c.s)];
  if (!withSpeed) return { w };
  const s = rig?.[2] ?? faces[d6(c.s) - 1] ?? 1;
  return { w, s };
}

export const isDoubles = (r: Roll): boolean => r.w[0] === r.w[1];
/** All three dice show the same number (a Bus or Tuk-Tuk Uncle face never makes a triple) */
export const isTriples = (r: Roll): boolean => isDoubles(r) && r.s === r.w[0];

export function emitDice(c: Ctx, seat: SeatId, purpose: 'move' | 'jail' | 'utility', r: Roll): void {
  const base = {
    t: 'dice' as const,
    seat,
    purpose,
    w: r.w,
    doubles: purpose !== 'utility' && isDoubles(r),
    triples: purpose === 'move' && isTriples(r),
    total: r.w[0] + r.w[1] + faceValue(r.s),
  };
  emit(c, r.s === undefined ? base : { ...base, s: r.s });
}

const moveSteps = (seat: SeatId, to: number, via: 'dice' | 'bus' | 'triple'): Step[] => [
  { k: 'move', seat, to, via },
  { k: 'land', seat },
];

/** Bus options: either white die or their sum, without duplicates ((3,3) offers 3 and 6) */
export const busOptions = (r: Roll): number[] => [...new Set([r.w[0], r.w[1], r.w[0] + r.w[1]])];

export const roll: Handler<'roll'> = seatAction(
  (s, _b, seat) => {
    if (s.phase.k !== 'preRoll') return err('phase', 'You can only roll before moving');
    if (s.turn.seat !== seat) return err('notYourTurn', 'It is not your turn');
    return null;
  },
  (c, seat) => {
    const s = c.s;
    const p = player(s, seat);
    const n = c.b.spaces.length;
    const jailed = !!p.jail;
    const r = throwDice(c, !jailed && speedActive(c, seat));
    s.turn.roll = r;
    if (jailed) s.turn.jailRoll = true;
    else delete s.turn.jailRoll;
    emitDice(c, seat, jailed ? 'jail' : 'move', r);
    const white = r.w[0] + r.w[1];
    const to = (p.pos + white) % n;

    if (p.jail) {
      s.turn.again = false;
      if (isDoubles(r)) {
        s.pending = [{ k: 'free', seat, how: 'doubles' }, ...moveSteps(seat, to, 'dice'), { k: 'afterRoll' }];
      } else if (p.jail.tries >= 2) {
        s.pending = [
          { k: 'pay', from: seat, owed: { bank: s.cfg.jailFine }, why: 'fine' },
          { k: 'free', seat, how: 'forced' },
          ...moveSteps(seat, to, 'dice'),
          { k: 'afterRoll' },
        ];
      } else {
        p.jail.tries++;
        emit(c, { t: 'jailStay', seat, tries: p.jail.tries });
        setPhase(c, { k: 'postRoll' });
        return;
      }
      setPhase(c, { k: 'busy' });
      return;
    }

    const doubles = isDoubles(r);
    // Capped at 3 (with threeDoublesJail off a fourth doubles just rolls again)
    if (doubles) s.turn.doubles = Math.min(3, s.turn.doubles + 1);
    // The three-doubles check comes first: a triple that is the third doubles still goes to jail.
    if (doubles && s.turn.doubles >= 3 && s.cfg.threeDoublesJail) {
      sendToJail(c, seat, 'doubles');
      return;
    }
    const triples = isTriples(r);
    s.turn.again = doubles && (!triples || s.cfg.triplesRollAgain);
    if (triples) {
      s.pending = [];
      setPhase(c, { k: 'chooseSpace' });
      emit(c, { t: 'chooseSpace', seat });
      return;
    }
    if (r.s === 'bus') {
      const opts = busOptions(r);
      s.pending = [];
      setPhase(c, { k: 'bus', opts });
      emit(c, { t: 'bus', seat, opts });
      return;
    }
    const steps = moveSteps(seat, (p.pos + white + faceValue(r.s)) % n, 'dice');
    s.pending = [...steps, ...(r.s === 'uncle' ? [{ k: 'uncle', seat } as Step] : []), { k: 'afterRoll' }];
    setPhase(c, { k: 'busy' });
  },
);

export const bus: Handler<'bus'> = seatAction(
  (s, _b, seat, a) => {
    if (s.phase.k !== 'bus') return err('phase', 'There is no Bus choice to make');
    if (s.turn.seat !== seat) return err('notYourTurn', 'It is not your turn');
    if (!isInt(a.n) || !s.phase.opts.includes(a.n)) return err('badMove', 'Pick one of the offered moves');
    return null;
  },
  (c, seat, a) => {
    const p = player(c.s, seat);
    c.s.pending = [...moveSteps(seat, (p.pos + a.n) % c.b.spaces.length, 'bus'), { k: 'afterRoll' }];
    setPhase(c, { k: 'busy' });
  },
);

export const chooseSpace: Handler<'chooseSpace'> = seatAction(
  (s, b, seat, a) => {
    if (s.phase.k !== 'chooseSpace') return err('phase', 'There is no space to choose');
    if (s.turn.seat !== seat) return err('notYourTurn', 'It is not your turn');
    if (!isInt(a.space) || a.space < 0 || a.space >= b.spaces.length) return err('badSpace', 'No such space');
    if (a.space === player(s, seat).pos) return err('badSpace', 'Pick a space other than the one you are on');
    return null;
  },
  (c, seat, a) => {
    // Choosing Go To Jail is a trip to jail, not a walk round the board, so it never collects salary.
    if (a.space === c.b.goToJailIndex) {
      sendToJail(c, seat, 'space');
      return;
    }
    c.s.pending = [...moveSteps(seat, a.space, 'triple'), { k: 'afterRoll' }];
    setPhase(c, { k: 'busy' });
  },
);
