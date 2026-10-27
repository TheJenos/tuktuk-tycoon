import type { BoardDef, CardDef, SpaceDef } from '../../rules/types';

/*
 * THE swappable data file: a light-hearted Sri Lankan board. Prices, rents and card effects follow the 2007
 * rulebook's board exactly (see docs/rules.md); only names and texts are themed. Money is Sri Lankan rupees
 * (Rs.), shown at display.currency.scale (x100) times the rulebook units the engine counts; card texts print the
 * shown amounts. Other themes (colombo.ts, hill.ts, south.ts) are files of this shape registered in board.ts. Rules logic never
 * hard-codes a name, price or card.
 */

const street = (
  name: string,
  group: string,
  price: number,
  rent: number[],
  house: number,
): SpaceDef => ({ k: 'street', name, group, price, rent, house, mortgage: price / 2 });

const rail = (name: string): SpaceDef => ({ k: 'rail', name, price: 200, mortgage: 100 });
const utility = (name: string): SpaceDef => ({ k: 'utility', name, price: 150, mortgage: 75 });

const SPACES: SpaceDef[] = [
  { k: 'go', name: 'Start' },
  street('Pettah Pavement', 'brown', 60, [2, 10, 30, 90, 160, 250], 50),
  { k: 'chest', name: 'Seettu Pot' },
  street('Maradana Lane', 'brown', 60, [4, 20, 60, 180, 320, 450], 50),
  { k: 'tax', name: 'Inland Revenue', tax: 'income' },
  rail('Colombo Fort Station'),
  street('Kottu Street', 'lightBlue', 100, [6, 30, 90, 270, 400, 550], 50),
  { k: 'chance', name: "Astrologer's Advice" },
  street('Hoppers Corner', 'lightBlue', 100, [6, 30, 90, 270, 400, 550], 50),
  street('Kiribath Junction', 'lightBlue', 120, [8, 40, 100, 300, 450, 600], 50),
  { k: 'jail', name: 'Police Station Bench' },
  street('Negombo Fish Market', 'pink', 140, [10, 50, 150, 450, 625, 750], 100),
  utility('Power Cut Board'),
  street('Pinnawala Elephant Walk', 'pink', 140, [10, 50, 150, 450, 625, 750], 100),
  street('Arugam Bay Surf Shack', 'pink', 160, [12, 60, 180, 500, 700, 900], 100),
  rail('Kandy Station'),
  street('Peradeniya Gardens', 'orange', 180, [14, 70, 200, 550, 750, 950], 100),
  { k: 'chest', name: 'Seettu Pot' },
  street('Nuwara Eliya Tea Estate', 'orange', 180, [14, 70, 200, 550, 750, 950], 100),
  street('Horton Plains Viewpoint', 'orange', 200, [16, 80, 220, 600, 800, 1000], 100),
  { k: 'parking', name: 'Tuk-Tuk Stand' },
  street('Mirissa Whale Watch', 'red', 220, [18, 90, 250, 700, 875, 1050], 150),
  { k: 'chance', name: "Astrologer's Advice" },
  street('Unawatuna Beach Hut', 'red', 220, [18, 90, 250, 700, 875, 1050], 150),
  street('Galle Fort Ramparts', 'red', 240, [20, 100, 300, 750, 925, 1100], 150),
  rail('Ella Station'),
  street('Sigiriya Selfie Spot', 'yellow', 260, [22, 110, 330, 800, 975, 1150], 150),
  street('Dambulla Veg Market', 'yellow', 260, [22, 110, 330, 800, 975, 1150], 150),
  utility('Water Board'),
  street('Kandy Lake Promenade', 'yellow', 280, [24, 120, 360, 850, 1025, 1200], 150),
  { k: 'goToJail', name: 'License please?' },
  street('Bambalapitiya Flats', 'green', 300, [26, 130, 390, 900, 1100, 1275], 200),
  street('Havelock Town', 'green', 300, [26, 130, 390, 900, 1100, 1275], 200),
  { k: 'chest', name: 'Seettu Pot' },
  street('Rajagiriya Highrise', 'green', 320, [28, 150, 450, 1000, 1200, 1400], 200),
  rail('Galle Station'),
  { k: 'chance', name: "Astrologer's Advice" },
  street('Cinnamon Gardens', 'darkBlue', 350, [35, 175, 500, 1100, 1300, 1500], 200),
  { k: 'tax', name: 'Wedding Gift Envelope', tax: 'luxury' },
  street('Galle Face Penthouse', 'darkBlue', 400, [50, 200, 600, 1400, 1700, 2000], 200),
];

const PASS_START = 'If you pass Start, collect Rs. 20,000.';
const TO_BENCH = 'Go directly to the Police Station Bench. Do not pass Start, do not collect Rs. 20,000.';

/** "Astrologer's Advice" (the rulebook's Chance deck) */
const CHANCE: CardDef[] = [
  { id: 'ch-go', text: 'The astrologer says the auspicious time is NOW. Advance to Start. Collect Rs. 20,000.', fx: { k: 'advance', to: 0 } },
  { id: 'ch-galle', text: `Your horoscope says "travel south". Advance to Galle Fort Ramparts. ${PASS_START}`, fx: { k: 'advance', to: 24 } },
  { id: 'ch-negombo', text: `A lucky day to buy fish. Advance to Negombo Fish Market. ${PASS_START}`, fx: { k: 'advance', to: 11 } },
  {
    id: 'ch-utility',
    text:
      'The bad-luck hour is over: go and settle your bills. Advance to the nearest Board. If unowned, you may buy ' +
      'it. If owned, throw the dice and pay the owner ten times the amount thrown.',
    fx: { k: 'nearest', kind: 'utility' },
  },
  {
    id: 'ch-rail1',
    text: 'The stars say "take the train". Advance to the nearest Station and pay the owner twice the fare they are otherwise owed. If unowned, you may buy it.',
    fx: { k: 'nearest', kind: 'rail' },
  },
  {
    id: 'ch-rail2',
    text: 'Your planets favour a window seat. Advance to the nearest Station and pay the owner twice the fare they are otherwise owed. If unowned, you may buy it.',
    fx: { k: 'nearest', kind: 'rail' },
  },
  { id: 'ch-dividend', text: 'Your lottery ticket finally wins something. Collect Rs. 5,000.', fx: { k: 'cash', amount: 50 } },
  { id: 'ch-goojf', text: 'Your cousin knows the inspector. Leave the Police Station Bench free. Keep this card until needed, or sell it.', fx: { k: 'goojf' } },
  { id: 'ch-back3', text: 'Bad omen: a cat crossed your path. Go back 3 spaces.', fx: { k: 'back', n: 3 } },
  { id: 'ch-jail', text: `The astrologer did warn you. ${TO_BENCH}`, fx: { k: 'jail' } },
  {
    id: 'ch-repairs',
    text: 'The monsoon leaks into everything: pay Rs. 2,500 for each house and Rs. 10,000 for each hotel.',
    fx: { k: 'repairs', house: 25, hotel: 100 },
  },
  { id: 'ch-poortax', text: 'A traffic policeman spots your expired licence. Pay Rs. 1,500.', fx: { k: 'cash', amount: -15 } },
  { id: 'ch-fort', text: `Catch the early train. Advance to Colombo Fort Station. ${PASS_START}`, fx: { k: 'advance', to: 5 } },
  { id: 'ch-penthouse', text: 'Dress up for a Galle Face sunset. Advance to Galle Face Penthouse.', fx: { k: 'advance', to: 39 } },
  { id: 'ch-chairman', text: 'You are elected treasurer of the cricket club. Pay each player Rs. 5,000.', fx: { k: 'each', amount: -50 } },
  { id: 'ch-loan', text: 'Your seettu turn comes up early. Collect Rs. 15,000.', fx: { k: 'cash', amount: 150 } },
];

/** "Seettu Pot" (the rulebook's Community Chest deck) */
const CHEST: CardDef[] = [
  { id: 'cc-go', text: 'The seettu aunty pays out on time, for once. Advance to Start. Collect Rs. 20,000.', fx: { k: 'advance', to: 0 } },
  { id: 'cc-bankerror', text: 'Bank error in your favour (the teller was watching the cricket). Collect Rs. 20,000.', fx: { k: 'cash', amount: 200 } },
  { id: 'cc-doctor', text: 'That ayurvedic massage went too far. Pay Rs. 5,000.', fx: { k: 'cash', amount: -50 } },
  { id: 'cc-stock', text: 'You sell your extra king coconuts. Collect Rs. 4,500.', fx: { k: 'cash', amount: 45 } },
  { id: 'cc-goojf', text: 'Your uncle is a lawyer. Leave the Police Station Bench free. Keep this card until needed, or sell it.', fx: { k: 'goojf' } },
  { id: 'cc-jail', text: `You argued with a bus conductor. ${TO_BENCH}`, fx: { k: 'jail' } },
  { id: 'cc-wedding', text: "It's your daughter's wedding. Collect Rs. 5,000 from every player as gifts.", fx: { k: 'each', amount: 50 } },
  { id: 'cc-avurudu', text: 'Your New Year bonus arrives. Collect Rs. 10,000.', fx: { k: 'cash', amount: 100 } },
  { id: 'cc-taxrefund', text: 'An Inland Revenue refund. Miracles happen. Collect Rs. 2,000.', fx: { k: 'cash', amount: 20 } },
  { id: 'cc-deposit', text: 'Your fixed deposit matures. Collect Rs. 10,000.', fx: { k: 'cash', amount: 100 } },
  { id: 'cc-hospital', text: 'Too many isso vadai at the beach. Pay the hospital Rs. 10,000.', fx: { k: 'cash', amount: -100 } },
  { id: 'cc-school', text: 'School development fee, again. Pay Rs. 15,000.', fx: { k: 'cash', amount: -150 } },
  { id: 'cc-services', text: "You fixed the neighbour's TV antenna. Collect Rs. 2,500.", fx: { k: 'cash', amount: 25 } },
  {
    id: 'cc-repairs',
    text: 'The road outside is dug up again: pay Rs. 4,000 per house and Rs. 11,500 per hotel.',
    fx: { k: 'repairs', house: 40, hotel: 115 },
  },
  { id: 'cc-contest', text: 'Second place in the New Year festival contest. Collect Rs. 1,000.', fx: { k: 'cash', amount: 10 } },
  { id: 'cc-dubai', text: 'Your aunty in Dubai sends a gift. Collect Rs. 10,000.', fx: { k: 'cash', amount: 100 } },
];

export const LANKA: BoardDef = {
  id: 'lanka',
  spaces: SPACES,
  groups: [
    { id: 'brown', name: 'Brown', spaces: [1, 3] },
    { id: 'lightBlue', name: 'Light Blue', spaces: [6, 8, 9] },
    { id: 'pink', name: 'Pink', spaces: [11, 13, 14] },
    { id: 'orange', name: 'Orange', spaces: [16, 18, 19] },
    { id: 'red', name: 'Red', spaces: [21, 23, 24] },
    { id: 'yellow', name: 'Yellow', spaces: [26, 27, 29] },
    { id: 'green', name: 'Green', spaces: [31, 32, 34] },
    { id: 'darkBlue', name: 'Dark Blue', spaces: [37, 39] },
  ],
  railRent: [25, 50, 100, 200],
  utilityMul: [4, 10],
  utilityCardMul: 10,
  railCardMul: 2,
  jailIndex: 10,
  goToJailIndex: 30,
  chance: CHANCE,
  chest: CHEST,
  maxPlayers: 8,
  // Today's Classic rules
  rules: {},
  speedDie: {
    faces: [1, 2, 3, 'bus', 'uncle', 'uncle'],
    labels: { '1': '1', '2': '2', '3': '3', bus: 'Bus', uncle: 'Tuk-Tuk Uncle' },
  },
  display: {
    title: 'TUK-TUK TYCOON',
    name: 'All Island',
    subtitle: 'All Island',
    blurb: 'The whole island in one lap: Pettah to Galle Face by way of tea hills, beaches and Sigiriya.',
    currency: { symbol: 'Rs.', scale: 100 },
    decks: { chance: "Astrologer's Advice", chest: 'Seettu Pot' },
    groupColours: {
      brown: '#8b4c2c',
      lightBlue: '#a9dcf5',
      pink: '#d6408f',
      orange: '#f4921f',
      red: '#e2232a',
      yellow: '#f9e11e',
      green: '#1fa952',
      darkBlue: '#1c5ba8',
    },
  },
};
