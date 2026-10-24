import { bid, checkPassAuction, closeAuctionAction, passAuction } from './auction';
import { autoRaise, bankrupt, resign } from './bankruptcy';
import { checkPassClaim, closeClaim, passClaim, place, requestBuild } from './claim';
import { deepEqual, err, isActive, isSeat } from './ctx';
import { awaiting, defaultAction } from './autoplay';
import { bus, chooseSpace, roll } from './dice';
import { endTurn } from './flow';
import { type Handler, type HandlerTable, isInt, seatAction } from './handler';
import { payFine, useCard } from './jail';
import { buy, decline, incomeTax } from './landing';
import { build, mortgage, sell, unmortgage } from './manage';
import { transfer } from './money';
import { settleMortgages } from './mortgage';
import { endGame } from './over';
import { accept, cancel, propose, reject } from './trade';
import type { Action, RigRoll, SeatId } from './types';

const pass: Handler<'pass'> = seatAction(
  (s, _b, seat) => (s.phase.k === 'buildClaim' ? checkPassClaim(s, seat) : checkPassAuction(s, seat)),
  (c, seat) => (c.s.phase.k === 'buildClaim' ? passClaim(c, seat) : passAuction(c, seat)),
);

const SPEED_FACES = new Set<unknown>([1, 2, 3, 'bus', 'uncle']);
/** Keeps a debug session from growing the state without bound */
const MAX_RIG = 100;
const isDie = (n: unknown): boolean => isInt(n) && n >= 1 && n <= 6;
const isRig = (r: unknown): r is RigRoll =>
  Array.isArray(r) &&
  (r.length === 2 || r.length === 3) &&
  isDie(r[0]) &&
  isDie(r[1]) &&
  (r.length === 2 || SPEED_FACES.has(r[2]));

const debugRig: Handler<'debugRig'> = {
  who: 'any',
  check: (s, _b, _by, a) => {
    if (!s.cfg.debug) return err('debugOff', 'Debug actions are off');
    if (!Array.isArray(a.dice) || !a.dice.every(isRig)) return err('badRig', 'Malformed dice');
    if (s.rig.length + a.dice.length > MAX_RIG) return err('badRig', `At most ${MAX_RIG} rigged throws queued`);
    return null;
  },
  run: (c, _by, a) => {
    c.s.rig.push(...a.dice.map((r): RigRoll => [...r]));
  },
};

const debugSetCash: Handler<'debugSetCash'> = {
  who: 'any',
  check: (s, _b, _by, a) => {
    if (!s.cfg.debug) return err('debugOff', 'Debug actions are off');
    if (!isSeat(s, a.seat) || !isActive(s, a.seat)) return err('badSeat', 'No such player');
    if (!isInt(a.cash) || a.cash < 0) return err('badCash', 'Cash must be a whole number, 0 or more');
    return null;
  },
  run: (c, _by, a) => {
    const p = c.s.players[a.seat];
    if (!p) return;
    const diff = a.cash - p.cash;
    if (diff > 0) transfer(c, 'bank', a.seat, diff, 'debug');
    else transfer(c, a.seat, 'bank', -diff, 'debug');
  },
};

/**
 * A timeout, sent by the system: plays the awaited seat's defaultAction. Only that exact action is accepted, so a
 * driver can never make another player's real decisions for them.
 */
const forced: Handler<'forced'> = {
  who: 'system',
  check: (s, b, _by, a) => {
    if (typeof a.seat !== 'string' || !isSeat(s, a.seat)) return err('badSeat', 'No such player');
    const seat: SeatId = a.seat;
    if (!awaiting(s).includes(seat)) return err('notAwaited', 'The game is not waiting for that player');
    if (!deepEqual(a.a, defaultAction(s, seat))) return err('notDefault', 'A timeout plays only the default move');
    const inner = HANDLERS[a.a.k] as Handler<Action['k']>;
    return inner.check(s, b, seat, a.a as never);
  },
  run: (c, _by, a) => {
    c.ev.push({ t: 'timeout', seat: a.seat, a: structuredClone(a.a) });
    const inner = HANDLERS[a.a.k] as Handler<Action['k']>;
    inner.run(c, a.seat, a.a as never);
  },
};

export const HANDLERS: HandlerTable = {
  roll,
  bus,
  chooseSpace,
  buy,
  decline,
  incomeTax,
  payFine,
  useCard,
  endTurn,
  bid,
  pass,
  requestBuild,
  place,
  build,
  sell,
  mortgage,
  unmortgage,
  settleMortgages,
  propose,
  accept,
  reject,
  cancel,
  autoRaise,
  bankrupt,
  resign,
  closeAuction: closeAuctionAction,
  closeClaim,
  endGame,
  forced,
  debugRig,
  debugSetCash,
};
