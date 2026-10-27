import { cardById, propertyAt } from './board';
import { type Ctx, emit, isActive, levelOf, ownedBy, player, propKey, seatsAfter } from './ctx';
import { recharge } from './heroes';
import { pay, transfer } from './money';
import { nearest, nextBankOwned, sendToJail } from './movement';
import { aimedAtDrawer, hit } from './react';
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
  follow(c, seat, deck, id, card.fx);
}

/**
 * Dead Aim's pick among the revealed top cards: they all leave the top, the ones not chosen go to the bottom first,
 * then the chosen one, which is played as if drawn
 */
export function playPicked(c: Ctx, seat: SeatId, deck: Deck, cards: string[], chosen: string): void {
  const card = cardById(c.b, chosen);
  if (!card) return;
  c.s.decks[deck] = c.s.decks[deck].filter((id) => !cards.includes(id));
  for (const id of cards) {
    if (id === chosen) continue;
    c.s.decks[deck].push(id);
    emit(c, { t: 'cardReturn', deck, cardId: id });
  }
  emit(c, { t: 'card', seat, deck, cardId: chosen, text: card.text, kept: false });
  c.s.decks[deck].push(chosen);
  emit(c, { t: 'cardReturn', deck, cardId: chosen });
  follow(c, seat, deck, chosen, card.fx);
}

/** Follows a card: on a heroes board a Villain Strike effect aimed at its drawer may meet a Star Shield first */
function follow(c: Ctx, seat: SeatId, deck: Deck, id: string, fx: CardFx): void {
  if (c.b.heroes && deck === 'chance' && aimedAtDrawer(fx)) hit(c, { k: 'hit', seat, fx, card: id });
  else applyFx(c, seat, fx, id);
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

/** The cheapest location a seat owns (ties: the lowest board index) goes back to its villain */
function loseCheapest(c: Ctx, seat: SeatId): void {
  let best: number | undefined;
  for (const space of ownedBy(c.s, seat)) {
    const price = propertyAt(c.b, space)?.price ?? 0;
    if (best === undefined || price < (propertyAt(c.b, best)?.price ?? 0)) best = space;
  }
  if (best === undefined) return;
  delete c.s.props[propKey(best)];
  emit(c, { t: 'owner', space: best, from: seat, via: 'villain' });
}

/** A card's effect on `seat` (`card`: its id, for the Hero-die throws it starts) */
export function applyFx(c: Ctx, seat: SeatId, fx: CardFx, card = ''): void {
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
    // Heroes boards
    case 'heroDie':
      // Every throw first (each with its Thunder window), then the heroes hit, in throw order (react.ts)
      front({ k: 'throwHero', seat, card, left: fx.rolls, hits: [] });
      return;
    case 'lose':
      loseCheapest(c, seat);
      return;
    case 'nearestFree': {
      const to = nextBankOwned(c, player(s, seat).pos);
      if (to === undefined) return;
      front({ k: 'move', seat, to, via: 'card' }, fx.free ? { k: 'land', seat, free: true } : { k: 'land', seat });
      return;
    }
    case 'recharge':
      recharge(c, seat, false);
      return;
  }
}
