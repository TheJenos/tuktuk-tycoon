import { deckOf } from './board';
import { emit, err, player, rs } from './ctx';
import { type Handler, seatAction, turnCheck } from './handler';
import { transfer } from './money';

/*
 * Getting out of jail before rolling: pay the fine on either of the first two turns, or use a Get Out of Jail Free
 * card. Either way the player then rolls normally (Speed Die included, doubles roll again). The third turn's forced
 * fine and the doubles release are part of the roll (dice.ts).
 */

/** Jail tries after which the fine can no longer be paid by choice */
const FINE_TRIES = 2;

export const payFine: Handler<'payFine'> = seatAction(
  (s, _b, seat) => {
    const e = turnCheck(s, seat, 'preRoll');
    if (e) return e;
    const p = player(s, seat);
    if (!p.jail) return err('notJailed', 'You are not in jail');
    if (p.jail.tries >= FINE_TRIES) return err('mustRoll', 'On your third turn you must roll');
    if (p.cash < s.cfg.jailFine) return err('cash', `The fine is ${rs(s.cfg.jailFine)}`);
    return null;
  },
  (c, seat) => {
    transfer(c, seat, 'bank', c.s.cfg.jailFine, 'fine');
    delete player(c.s, seat).jail;
    emit(c, { t: 'jailExit', seat, how: 'fine' });
  },
);

export const useCard: Handler<'useCard'> = seatAction(
  (s, _b, seat, a) => {
    const e = turnCheck(s, seat, 'preRoll');
    if (e) return e;
    const p = player(s, seat);
    if (!p.jail) return err('notJailed', 'You are not in jail');
    if (p.goojf.length === 0) return err('noCard', 'You have no Get Out of Jail Free card');
    if (a.card !== undefined && !p.goojf.includes(a.card)) return err('noCard', 'You do not hold that card');
    return null;
  },
  (c, seat, a) => {
    const p = player(c.s, seat);
    const id = a.card ?? (p.goojf[0] as string);
    p.goojf = p.goojf.filter((x) => x !== id);
    const deck = deckOf(c.b, id);
    c.s.decks[deck].push(id);
    emit(c, { t: 'cardReturn', deck, cardId: id, seat });
    delete p.jail;
    emit(c, { t: 'jailExit', seat, how: 'card' });
  },
);
