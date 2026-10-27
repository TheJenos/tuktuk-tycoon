import { deckOf, type BoardDef } from '../../../rules';
import { DECK_STYLE } from '../../../scene/cards/drawCard';
import { deckName } from '../format';

/*
 * A held Get Out of Jail Free card, shown beside the properties (the players' swatches, My properties, the trade
 * builder) as a small card in the colour of the deck it came from.
 */

export const JAIL_CARD_NAME = 'Get Out of Jail Free';

export interface JailCard {
  id: string;
  /** The deck it came from, by the board's name ("Astrologer's Advice") */
  deck: string;
  /** That deck's card colour */
  colour: string;
}

export function jailCard(b: BoardDef, id: string): JailCard {
  const d = deckOf(b, id);
  return { id, deck: deckName(b, d), colour: DECK_STYLE[d].back };
}
