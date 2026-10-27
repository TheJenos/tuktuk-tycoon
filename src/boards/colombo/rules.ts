import type { BoardDef, CardDef, SpaceDef } from '../../rules/types';

/*
 * "Colombo": the city board, the smallest: 32 spaces (seven between corners) for 2 to 4 players. Eight colour groups of
 * two streets, priced from the rulebook's tiers (each pair takes its tier's cheapest and dearest street), four stations,
 * two boards. Card texts print the shown amounts (x100 the engine's units).
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

const CHANCE_NAME = 'Rush Hour';
const CHEST_NAME = 'Office Seettu';

const SPACES: SpaceDef[] = [
  { k: 'go', name: 'Start' },
  street('Pettah Market Lane', 'brown', 60, [2, 10, 30, 90, 160, 250], 50),
  { k: 'chest', name: CHEST_NAME },
  street('Fifth Cross Street', 'brown', 60, [4, 20, 60, 180, 320, 450], 50),
  rail('Fort Station'),
  street('Kotahena Bus Halt', 'lightBlue', 100, [6, 30, 90, 270, 400, 550], 50),
  { k: 'tax', name: 'City Council Rates', tax: 'income' },
  street('Dematagoda Rail Yard', 'lightBlue', 120, [8, 40, 100, 300, 450, 600], 50),
  { k: 'jail', name: 'Traffic Police Booth' },
  street('Borella Junction', 'pink', 140, [10, 50, 150, 450, 625, 750], 100),
  utility('Load Shedding Board'),
  street('Kirulapone Canal Bank', 'pink', 160, [12, 60, 180, 500, 700, 900], 100),
  rail('Maradana Station'),
  street('Dehiwala Zoo Road', 'orange', 180, [14, 70, 200, 550, 750, 950], 100),
  { k: 'chance', name: CHANCE_NAME },
  street('Rajagiriya Flyover', 'orange', 200, [16, 80, 220, 600, 800, 1000], 100),
  { k: 'parking', name: 'Rare Parking Spot' },
  street('Duplication Road', 'red', 220, [18, 90, 250, 700, 875, 1050], 150),
  { k: 'chest', name: CHEST_NAME },
  street('Marine Drive', 'red', 240, [20, 100, 300, 750, 925, 1100], 150),
  rail('Kompannavidiya Station'),
  street('Kollupitiya Junction', 'yellow', 260, [22, 110, 330, 800, 975, 1150], 150),
  utility('Low Pressure Water Board'),
  street('Beira Lake Promenade', 'yellow', 280, [24, 120, 360, 850, 1025, 1200], 150),
  { k: 'goToJail', name: 'Wrong Way, Machan!' },
  street('Havelock Town', 'green', 300, [26, 130, 390, 900, 1100, 1275], 200),
  { k: 'chance', name: CHANCE_NAME },
  street('Rosmead Place', 'green', 320, [28, 150, 450, 1000, 1200, 1400], 200),
  rail('Bambalapitiya Station'),
  street('Cinnamon Gardens Villa', 'darkBlue', 350, [35, 175, 500, 1100, 1300, 1500], 200),
  { k: 'tax', name: 'Rooftop Brunch Bill', tax: 'luxury' },
  street('Galle Face Sky Suite', 'darkBlue', 400, [50, 200, 600, 1400, 1700, 2000], 200),
];

const PASS_START = 'If you pass Start, collect Rs. 20,000.';
const TO_BOOTH = 'Go directly to the Traffic Police Booth. Do not pass Start, do not collect Rs. 20,000.';

/** "Rush Hour" (the rulebook's Chance deck) */
const CHANCE: CardDef[] = [
  { id: 'ch-go', text: 'The traffic clears like magic. Advance to Start. Collect Rs. 20,000.', fx: { k: 'advance', to: 0 } },
  { id: 'ch-galle', text: `Take the scenic route by the sea. Advance to Marine Drive. ${PASS_START}`, fx: { k: 'advance', to: 19 } },
  { id: 'ch-negombo', text: `Your three-wheeler driver knows a shortcut. Advance to Borella Junction. ${PASS_START}`, fx: { k: 'advance', to: 9 } },
  {
    id: 'ch-utility',
    text:
      'The lights go out in the middle of a meeting: go and complain. Advance to the nearest Board. If unowned, you ' +
      'may buy it. If owned, throw the dice and pay the owner ten times the amount thrown.',
    fx: { k: 'nearest', kind: 'utility' },
  },
  {
    id: 'ch-rail1',
    text: 'The roads are jammed solid. Advance to the nearest Station and pay the owner twice the fare they are otherwise owed. If unowned, you may buy it.',
    fx: { k: 'nearest', kind: 'rail' },
  },
  {
    id: 'ch-rail2',
    text: 'Beat the traffic by train (standing room only). Advance to the nearest Station and pay the owner twice the fare they are otherwise owed. If unowned, you may buy it.',
    fx: { k: 'nearest', kind: 'rail' },
  },
  { id: 'ch-dividend', text: 'The three-wheeler meter was switched on, for once. Collect Rs. 5,000 in savings.', fx: { k: 'cash', amount: 50 } },
  { id: 'ch-goojf', text: 'Your old schoolmate is now a traffic sergeant. Leave the Traffic Police Booth free. Keep this card until needed, or sell it.', fx: { k: 'goojf' } },
  { id: 'ch-back3', text: 'You missed your exit at the roundabout. Go back 3 spaces.', fx: { k: 'back', n: 3 } },
  { id: 'ch-jail', text: `You tried a U-turn on Galle Road. ${TO_BOOTH}`, fx: { k: 'jail' } },
  {
    id: 'ch-repairs',
    text: 'A burst water main floods every basement: pay Rs. 2,500 for each house and Rs. 10,000 for each hotel.',
    fx: { k: 'repairs', house: 25, hotel: 100 },
  },
  { id: 'ch-poortax', text: 'Caught parking in the bus lane. Pay Rs. 1,500.', fx: { k: 'cash', amount: -15 } },
  { id: 'ch-fort', text: `Catch the 7.15 office train. Advance to Fort Station. ${PASS_START}`, fx: { k: 'advance', to: 4 } },
  { id: 'ch-penthouse', text: 'The boss invites you for a sunset dinner. Advance to Galle Face Sky Suite.', fx: { k: 'advance', to: 31 } },
  { id: 'ch-chairman', text: 'You are made organiser of the office trip. Pay each player Rs. 5,000.', fx: { k: 'each', amount: -50 } },
  { id: 'ch-loan', text: 'Your overtime claim finally gets signed. Collect Rs. 15,000.', fx: { k: 'cash', amount: 150 } },
];

/** "Office Seettu" (the rulebook's Community Chest deck) */
const CHEST: CardDef[] = [
  { id: 'cc-go', text: 'Payday comes early this month. Advance to Start. Collect Rs. 20,000.', fx: { k: 'advance', to: 0 } },
  { id: 'cc-bankerror', text: 'The bank pays your salary twice (the system was "down"). Collect Rs. 20,000.', fx: { k: 'cash', amount: 200 } },
  { id: 'cc-doctor', text: 'Too many fish buns from the office canteen. Pay the doctor Rs. 5,000.', fx: { k: 'cash', amount: -50 } },
  { id: 'cc-stock', text: 'You sell your old scooter to a colleague. Collect Rs. 4,500.', fx: { k: 'cash', amount: 45 } },
  { id: 'cc-goojf', text: 'Your aunty knows the officer in charge. Leave the Traffic Police Booth free. Keep this card until needed, or sell it.', fx: { k: 'goojf' } },
  { id: 'cc-jail', text: `You argued with a traffic policeman about the light. ${TO_BOOTH}`, fx: { k: 'jail' } },
  { id: 'cc-wedding', text: "It's your house-warming party. Collect Rs. 5,000 from every player as gifts.", fx: { k: 'each', amount: 50 } },
  { id: 'cc-avurudu', text: 'The office New Year bonus arrives. Collect Rs. 10,000.', fx: { k: 'cash', amount: 100 } },
  { id: 'cc-taxrefund', text: 'The City Council refunds an overcharge. Miracles happen. Collect Rs. 2,000.', fx: { k: 'cash', amount: 20 } },
  { id: 'cc-deposit', text: 'Your savings certificate matures. Collect Rs. 10,000.', fx: { k: 'cash', amount: 100 } },
  { id: 'cc-hospital', text: 'You walked into a glass door during a power cut. Pay the hospital Rs. 10,000.', fx: { k: 'cash', amount: -100 } },
  { id: 'cc-school', text: 'Tuition class fees for the whole term. Pay Rs. 15,000.', fx: { k: 'cash', amount: -150 } },
  { id: 'cc-services', text: 'You fixed the office printer. Collect Rs. 2,500.', fx: { k: 'cash', amount: 25 } },
  {
    id: 'cc-repairs',
    text: 'The road outside is dug up again for new pipes: pay Rs. 4,000 per house and Rs. 11,500 per hotel.',
    fx: { k: 'repairs', house: 40, hotel: 115 },
  },
  { id: 'cc-contest', text: 'Second place in the office carrom tournament. Collect Rs. 1,000.', fx: { k: 'cash', amount: 10 } },
  { id: 'cc-dubai', text: 'Your old landlord returns the rent advance. Collect Rs. 10,000.', fx: { k: 'cash', amount: 100 } },
];

export const COLOMBO: BoardDef = {
  id: 'colombo',
  spaces: SPACES,
  groups: [
    { id: 'brown', name: 'Brown', spaces: [1, 3] },
    { id: 'lightBlue', name: 'Light Blue', spaces: [5, 7] },
    { id: 'pink', name: 'Pink', spaces: [9, 11] },
    { id: 'orange', name: 'Orange', spaces: [13, 15] },
    { id: 'red', name: 'Red', spaces: [17, 19] },
    { id: 'yellow', name: 'Yellow', spaces: [21, 23] },
    { id: 'green', name: 'Green', spaces: [25, 27] },
    { id: 'darkBlue', name: 'Dark Blue', spaces: [29, 31] },
  ],
  railRent: [25, 50, 100, 200],
  utilityMul: [4, 10],
  utilityCardMul: 10,
  railCardMul: 2,
  jailIndex: 8,
  goToJailIndex: 24,
  chance: CHANCE,
  chest: CHEST,
  maxPlayers: 4,
  // A quick city game: less cash to start, the Speed Die on, a scarce building supply
  rules: { startCash: 1000, speedDie: true, houses: 20, hotels: 8 },
  speedDie: {
    faces: [1, 2, 3, 'bus', 'uncle', 'uncle'],
    labels: { '1': '1', '2': '2', '3': '3', bus: 'Bus', uncle: 'Tuk-Tuk Uncle' },
  },
  display: {
    title: 'TUK-TUK TYCOON',
    name: 'Colombo',
    subtitle: 'Colombo',
    blurb: 'The city: from Pettah market lanes to a Galle Face sky suite, with traffic, power cuts and office canteens.',
    rulesBlurb: 'Rs. 100,000 to start, the Speed Die, a scarce building supply: a quick city game',
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
