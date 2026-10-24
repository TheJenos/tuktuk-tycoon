import type { BoardDef, CardDef, SpaceDef } from '../types';

/*
 * "Down South": the south coast from Bentota to Hambantota along the coastal line. The same prices, rents and card
 * effects as the All Island board (data/lanka.ts), so the rules and balance are identical; only the names, card
 * texts and display differ. Card texts print the shown amounts (x100 the engine's units).
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

const CHANCE_NAME = 'Lucky Wave';
const CHEST_NAME = "Fishermen's Kitty";

const SPACES: SpaceDef[] = [
  { k: 'go', name: 'Start' },
  street('Hambantota Salt Pans', 'brown', 60, [2, 10, 30, 90, 160, 250], 50),
  { k: 'chest', name: CHEST_NAME },
  street('Ambalangoda Mask Shop', 'brown', 60, [4, 20, 60, 180, 320, 450], 50),
  { k: 'tax', name: 'Harbour Master Dues', tax: 'income' },
  rail('Hikkaduwa Station'),
  street('Koggala Stilt Fishers', 'lightBlue', 100, [6, 30, 90, 270, 400, 550], 50),
  { k: 'chance', name: CHANCE_NAME },
  street('Ahangama Surf Point', 'lightBlue', 100, [6, 30, 90, 270, 400, 550], 50),
  street('Midigama Reef Break', 'lightBlue', 120, [8, 40, 100, 300, 450, 600], 50),
  { k: 'jail', name: 'Lifeguard Tower' },
  street('Matara Fish Market', 'pink', 140, [10, 50, 150, 450, 625, 750], 100),
  utility('Monsoon Power Board'),
  street('Dondra Lighthouse', 'pink', 140, [10, 50, 150, 450, 625, 750], 100),
  street('Polhena Reef Pool', 'pink', 160, [12, 60, 180, 500, 700, 900], 100),
  rail('Galle Station'),
  street('Tangalle Lagoon', 'orange', 180, [14, 70, 200, 550, 750, 950], 100),
  { k: 'chest', name: CHEST_NAME },
  street('Hikkaduwa Coral Reef', 'orange', 180, [14, 70, 200, 550, 750, 950], 100),
  street('Weligama Surf School', 'orange', 200, [16, 80, 220, 600, 800, 1000], 100),
  { k: 'parking', name: 'Hammock Time' },
  street('Mirissa Whale Jetty', 'red', 220, [18, 90, 250, 700, 875, 1050], 150),
  { k: 'chance', name: CHANCE_NAME },
  street('Coconut Tree Hill', 'red', 220, [18, 90, 250, 700, 875, 1050], 150),
  street('Unawatuna Beach Cafe', 'red', 240, [20, 100, 300, 750, 925, 1100], 150),
  rail('Weligama Station'),
  street('Jungle Beach Cove', 'yellow', 260, [22, 110, 330, 800, 975, 1150], 150),
  street('Galle Lighthouse', 'yellow', 260, [22, 110, 330, 800, 975, 1150], 150),
  utility('Salty Tap Water Board'),
  street('Galle Fort Ramparts', 'yellow', 280, [24, 120, 360, 850, 1025, 1200], 150),
  { k: 'goToJail', name: 'Beyond the Flags!' },
  street('Kosgoda Turtle Beach', 'green', 300, [26, 130, 390, 900, 1100, 1275], 200),
  street('Induruwa Palm Grove', 'green', 300, [26, 130, 390, 900, 1100, 1275], 200),
  { k: 'chest', name: CHEST_NAME },
  street('Bentota River Villa', 'green', 320, [28, 150, 450, 1000, 1200, 1400], 200),
  rail('Matara Station'),
  { k: 'chance', name: CHANCE_NAME },
  street('Galle Fort Courtyard', 'darkBlue', 350, [35, 175, 500, 1100, 1300, 1500], 200),
  { k: 'tax', name: 'Sunset Seafood Platter', tax: 'luxury' },
  street('Bentota Beach Palace', 'darkBlue', 400, [50, 200, 600, 1400, 1700, 2000], 200),
];

const PASS_START = 'If you pass Start, collect Rs. 20,000.';
const TO_TOWER = 'Go directly to the Lifeguard Tower. Do not pass Start, do not collect Rs. 20,000.';

/** "Lucky Wave" (the rulebook's Chance deck) */
const CHANCE: CardDef[] = [
  { id: 'ch-go', text: 'A perfect wave carries you all the way in. Advance to Start. Collect Rs. 20,000.', fx: { k: 'advance', to: 0 } },
  { id: 'ch-galle', text: `Time for a swim in the bay. Advance to Unawatuna Beach Cafe. ${PASS_START}`, fx: { k: 'advance', to: 24 } },
  { id: 'ch-negombo', text: `The boats are back with a big catch. Advance to Matara Fish Market. ${PASS_START}`, fx: { k: 'advance', to: 11 } },
  {
    id: 'ch-utility',
    text:
      'The fan stops in the midday heat. Advance to the nearest Board. If unowned, you may buy it. If owned, throw ' +
      'the dice and pay the owner ten times the amount thrown.',
    fx: { k: 'nearest', kind: 'utility' },
  },
  {
    id: 'ch-rail1',
    text: 'Take the coastal train for the sea view. Advance to the nearest Station and pay the owner twice the fare they are otherwise owed. If unowned, you may buy it.',
    fx: { k: 'nearest', kind: 'rail' },
  },
  {
    id: 'ch-rail2',
    text: 'Your surfboard will not fit on the bus. Advance to the nearest Station and pay the owner twice the fare they are otherwise owed. If unowned, you may buy it.',
    fx: { k: 'nearest', kind: 'rail' },
  },
  { id: 'ch-dividend', text: 'Your surf lessons are booked out. Collect Rs. 5,000.', fx: { k: 'cash', amount: 50 } },
  { id: 'ch-goojf', text: 'The lifeguard is your cousin. Leave the Lifeguard Tower free. Keep this card until needed, or sell it.', fx: { k: 'goojf' } },
  { id: 'ch-back3', text: 'A rogue wave knocks you off your board. Go back 3 spaces.', fx: { k: 'back', n: 3 } },
  { id: 'ch-jail', text: `You swam out past the red flags. ${TO_TOWER}`, fx: { k: 'jail' } },
  {
    id: 'ch-repairs',
    text: 'Sea salt rusts every roof: pay Rs. 2,500 for each house and Rs. 10,000 for each hotel.',
    fx: { k: 'repairs', house: 25, hotel: 100 },
  },
  { id: 'ch-poortax', text: 'A monkey steals your lunch on the beach and you buy another. Pay Rs. 1,500.', fx: { k: 'cash', amount: -15 } },
  { id: 'ch-fort', text: `Catch the morning train down the coast. Advance to Hikkaduwa Station. ${PASS_START}`, fx: { k: 'advance', to: 5 } },
  { id: 'ch-penthouse', text: 'Treat yourself to a sunset by the river mouth. Advance to Bentota Beach Palace.', fx: { k: 'advance', to: 39 } },
  { id: 'ch-chairman', text: 'You are elected captain of the beach cricket team. Pay each player Rs. 5,000.', fx: { k: 'each', amount: -50 } },
  { id: 'ch-loan', text: 'Whales on every boat trip this week. Collect Rs. 15,000.', fx: { k: 'cash', amount: 150 } },
];

/** "Fishermen's Kitty" (the rulebook's Community Chest deck) */
const CHEST: CardDef[] = [
  { id: 'cc-go', text: 'The tide turns in your favour. Advance to Start. Collect Rs. 20,000.', fx: { k: 'advance', to: 0 } },
  { id: 'cc-bankerror', text: 'Bank error in your favour (the teller was watching the surf). Collect Rs. 20,000.', fx: { k: 'cash', amount: 200 } },
  { id: 'cc-doctor', text: 'You fell asleep on the beach at noon. Pay Rs. 5,000 for sunburn cream.', fx: { k: 'cash', amount: -50 } },
  { id: 'cc-stock', text: 'You sell a fresh tuna at the morning market. Collect Rs. 4,500.', fx: { k: 'cash', amount: 45 } },
  { id: 'cc-goojf', text: 'Your uncle sits on a stilt and knows everyone on the beach. Leave the Lifeguard Tower free. Keep this card until needed, or sell it.', fx: { k: 'goojf' } },
  { id: 'cc-jail', text: `You built a sandcastle on the lifeguard's chair. ${TO_TOWER}`, fx: { k: 'jail' } },
  { id: 'cc-wedding', text: "It's your beach wedding. Collect Rs. 5,000 from every player as gifts.", fx: { k: 'each', amount: 50 } },
  { id: 'cc-avurudu', text: 'Your boat wins the New Year race. Collect Rs. 10,000.', fx: { k: 'cash', amount: 100 } },
  { id: 'cc-taxrefund', text: 'The harbour master returns an overpayment. Miracles happen. Collect Rs. 2,000.', fx: { k: 'cash', amount: 20 } },
  { id: 'cc-deposit', text: 'Your guest house is full all season. Collect Rs. 10,000.', fx: { k: 'cash', amount: 100 } },
  { id: 'cc-hospital', text: 'You stepped on a sea urchin. Pay the hospital Rs. 10,000.', fx: { k: 'cash', amount: -100 } },
  { id: 'cc-school', text: 'Swimming lessons for all the kids. Pay Rs. 15,000.', fx: { k: 'cash', amount: -150 } },
  { id: 'cc-services', text: 'You helped haul in the beach net. Collect Rs. 2,500.', fx: { k: 'cash', amount: 25 } },
  {
    id: 'cc-repairs',
    text: 'The monsoon waves wash over the sea wall: pay Rs. 4,000 per house and Rs. 11,500 per hotel.',
    fx: { k: 'repairs', house: 40, hotel: 115 },
  },
  { id: 'cc-contest', text: 'Second place in the sandcastle contest. Collect Rs. 1,000.', fx: { k: 'cash', amount: 10 } },
  { id: 'cc-dubai', text: 'A visitor buys your painting of the stilt fishermen. Collect Rs. 10,000.', fx: { k: 'cash', amount: 100 } },
];

export const SOUTH: BoardDef = {
  id: 'south',
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
  speedDie: {
    faces: [1, 2, 3, 'bus', 'uncle', 'uncle'],
    labels: { '1': '1', '2': '2', '3': '3', bus: 'Bus', uncle: 'Tuk-Tuk Uncle' },
  },
  display: {
    title: 'TUK-TUK TYCOON',
    name: 'Down South',
    subtitle: 'Down South',
    blurb: 'The south coast by the coastal line: surf breaks, stilt fishers, fish markets, Galle Fort and the monsoon.',
    currency: { symbol: 'Rs.', scale: 100 },
    decks: { chance: CHANCE_NAME, chest: CHEST_NAME },
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
