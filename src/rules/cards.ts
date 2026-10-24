import { cardById } from './board';
import { type Ctx, emit, isActive, levelOf, ownedBy, player, seatsAfter } from './ctx';
import { pay, transfer } from './money';
import { nearest, sendToJail } from './movement';
import type { CardFx, Deck, Owed, SeatId, Step } from './types';

/** Draw the top card of a deck and follow it. Non-keepers go straight to the bottom. */
export function drawCard(c: Ctx, seat: SeatId, deck: Deck): void {
  const id = c.s.decks[deck].shift();
  const card = id === undefined ? undefined : cardById(c.b, id);
  if (!id || !card) return;
  const kept = card.fx.k === 'goojf';
  emit(c, { t: 'card', seat, deck, cardId: id, text: card.text, kept });
  if (kept) player(c.s, seat).goojf.push(id);
  else {
    c.s.decks[deck].push(id);
    emit(c, { t: 'cardReturn', deck, cardId: id });
  }
  applyFx(c, seat, card.fx);
}

/** Houses (levels 1-4) and hotels (level 5) a seat has standing */
export function buildingCounts(c: Ctx, seat: SeatId): { houses: number; hotels: number } {
  let houses = 0;
  let hotels = 0;
  for (const space of ownedBy(c.s, seat)) {
    const level = levelOf(c.s, space);
    if (level === 5) hotels++;
    else houses += level;
  }
  return { houses, hotels };
}

function applyFx(c: Ctx, seat: SeatId, fx: CardFx): void {
  const s = c.s;
  const front = (...steps: Step[]): void => {
    s.pending.unshift(...steps);
  };
  switch (fx.k) {
    case 'advance':
      front({ k: 'move', seat, to: fx.to, via: 'card' }, { k: 'land', seat });
      return;
    case 'nearest': {
      const to = nearest(c, player(s, seat).pos, fx.kind);
      const land: Step =
        fx.kind === 'rail' ? { k: 'land', seat, rentMul: c.b.railCardMul } : { k: 'land', seat, utilFresh: true };
      front({ k: 'move', seat, to, via: 'card' }, land);
      return;
    }
    case 'back':
      front({ k: 'back', seat, n: fx.n }, { k: 'land', seat });
      return;
    case 'jail':
      sendToJail(c, seat, 'card');
      return;
    case 'goojf':
      return;
    case 'cash':
      if (fx.amount > 0) transfer(c, 'bank', seat, fx.amount, 'card');
      else pay(c, seat, { bank: -fx.amount }, 'card');
      return;
    case 'each': {
      const others = seatsAfter(s, seat).filter((id) => isActive(s, id));
      if (fx.amount > 0) {
        // Each payer settles in seat order; one who cannot pay enters debt while the rest wait their turn.
        front(...others.map((from): Step => ({ k: 'pay', from, owed: { [seat]: fx.amount }, why: 'card' })));
      } else {
        const owed: Owed = {};
        for (const id of others) owed[id] = -fx.amount;
        pay(c, seat, owed, 'card');
      }
      return;
    }
    case 'repairs': {
      const { houses, hotels } = buildingCounts(c, seat);
      pay(c, seat, { bank: houses * fx.house + hotels * fx.hotel }, 'card');
      return;
    }
  }
}
