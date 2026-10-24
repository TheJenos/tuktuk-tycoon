import { spaceAt } from './board';
import { drawCard } from './cards';
import { startAuction } from './auction';
import { type Ctx, collectsRent, emit, err, mayBuy, player, prop, propBidders, setPhase } from './ctx';
import { emitDice, speedActive, throwDice } from './dice';
import { type Handler, seatAction, turnCheck } from './handler';
import { pay, transfer, worth } from './money';
import { sendToJail } from './movement';
import { rentFor, rollTotal } from './rent';
import type { SeatId } from './types';

export interface LandOpts {
  /** Nearest Railroad card */
  rentMul?: number;
  /** Nearest Utility card: rent is a fresh throw x10 */
  utilFresh?: true;
}

/** Resolve the space a seat stands on */
export function land(c: Ctx, seat: SeatId, opts: LandOpts = {}): void {
  const p = player(c.s, seat);
  const space = p.pos;
  const sp = spaceAt(c.b, space);
  emit(c, { t: 'land', seat, space });
  switch (sp.k) {
    case 'street':
    case 'rail':
    case 'utility':
      landOnProperty(c, seat, space, opts);
      return;
    case 'tax':
      if (sp.tax === 'luxury') pay(c, seat, { bank: c.s.cfg.luxuryTax }, 'tax', space);
      else if (c.s.cfg.incomeTaxMode === 'choice') setPhase(c, { k: 'incomeTax' });
      // A fixed Income Tax: no choice to make, paid at once
      else pay(c, seat, { bank: incomeTaxAmount(c, seat, c.s.cfg.incomeTaxMode) }, 'tax', space);
      return;
    case 'parking':
      if (c.s.cfg.jackpot && c.s.pot > 0) {
        const pot = c.s.pot;
        c.s.pot = 0;
        transfer(c, 'bank', seat, pot, 'jackpot', space);
      }
      return;
    case 'chance':
    case 'chest':
      drawCard(c, seat, sp.k);
      return;
    case 'goToJail':
      sendToJail(c, seat, 'space');
      return;
    default:
      return;
  }
}

function landOnProperty(c: Ctx, seat: SeatId, space: number, opts: LandOpts): void {
  const ps = prop(c.s, space);
  if (!ps) {
    // First-lap rule: a player who has not collected a salary yet cannot buy; the property stays with the bank
    if (mayBuy(c.s, seat)) setPhase(c, { k: 'buy', space });
    return;
  }
  if (ps.owner === seat || ps.mortgaged || !collectsRent(c.s, ps.owner)) return;
  let rent: number;
  if (opts.utilFresh && spaceAt(c.b, space).k === 'utility') {
    // The card's own throw: white dice, plus the Speed Die when the player has it (Bus / Tuk-Tuk Uncle = 0).
    const r = throwDice(c, speedActive(c, seat));
    emitDice(c, seat, 'utility', r);
    rent = rentFor(c.s, c.b, space, { dice: rollTotal(r), utilityMul: c.b.utilityCardMul });
  } else {
    rent = rentFor(c.s, c.b, space, opts.rentMul ? { railMul: opts.rentMul } : {});
  }
  pay(c, seat, { [ps.owner]: rent }, 'rent', space);
}

export const buy: Handler<'buy'> = seatAction(
  (s, b, seat) => {
    const e = turnCheck(s, seat, 'buy');
    if (e || s.phase.k !== 'buy') return e;
    const sp = spaceAt(b, s.phase.space);
    const price = 'price' in sp ? sp.price : 0;
    if (!mayBuy(s, seat)) return err('firstLap', 'You can buy property once you have passed Start');
    if (player(s, seat).cash < price) return err('cash', 'Not enough cash: mortgage or sell first, or decline');
    return null;
  },
  (c, seat) => {
    if (c.s.phase.k !== 'buy') return;
    const space = c.s.phase.space;
    const sp = spaceAt(c.b, space);
    transfer(c, seat, 'bank', 'price' in sp ? sp.price : 0, 'buy', space);
    c.s.props[`p${space}`] = { owner: seat, level: 0 };
    emit(c, { t: 'owner', space, to: seat, via: 'buy' });
    setPhase(c, { k: 'busy' });
  },
);

export const decline: Handler<'decline'> = seatAction(
  (s, _b, seat) => turnCheck(s, seat, 'buy'),
  (c) => {
    if (c.s.phase.k !== 'buy') return;
    // Auctions off: the bank keeps it
    if (!c.s.cfg.auctions) {
      setPhase(c, { k: 'busy' });
      return;
    }
    // Everyone still in may bid, the decliner and jailed players included (not those still on their first lap).
    startAuction(c, { k: 'prop', space: c.s.phase.space }, propBidders(c.s), { k: 'busy' });
  },
);

/** Income Tax as the cheaper/flat or percent choice (made before worth is added up) */
export const incomeTaxAmount = (c: Ctx, seat: SeatId, pick: 'flat' | 'percent'): number =>
  pick === 'flat' ? c.s.cfg.incomeFlat : Math.floor((worth(c.s, c.b, seat) * c.s.cfg.incomePct) / 100);

export const incomeTax: Handler<'incomeTax'> = seatAction(
  (s, _b, seat, a) => {
    const e = turnCheck(s, seat, 'incomeTax');
    if (e) return e;
    if (a.pick !== 'flat' && a.pick !== 'percent') return err('badChoice', 'Pick flat or percent');
    const mode = s.cfg.incomeTaxMode;
    if (mode !== 'choice' && a.pick !== mode) return err('badChoice', `Income Tax is always the ${mode} amount here`);
    return null;
  },
  (c, seat, a) => {
    const amount = incomeTaxAmount(c, seat, a.pick);
    setPhase(c, { k: 'busy' });
    pay(c, seat, { bank: amount }, 'tax', player(c.s, seat).pos);
  },
);
