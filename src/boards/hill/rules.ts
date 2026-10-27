import type { BoardDef, CardDef, SpaceDef } from '../../rules/types';

/*
 * "Hill Country": Kandy to Nuwara Eliya and Ella along the main line. 36 spaces (eight between corners) for 2 to 6
 * players: the rulebook's eight colour groups, orange and yellow cut to pairs (each pair its tier's cheapest and
 * dearest street), four stations, two boards. Card texts print the shown amounts (x100 the engine's units).
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

const CHANCE_NAME = 'Mountain Mist';
const CHEST_NAME = 'Tea Tin';

const SPACES: SpaceDef[] = [
  { k: 'go', name: 'Start' },
  street('Gampola Bazaar', 'brown', 60, [2, 10, 30, 90, 160, 250], 50),
  { k: 'chest', name: CHEST_NAME },
  street('Nawalapitiya Road', 'brown', 60, [4, 20, 60, 180, 320, 450], 50),
  { k: 'tax', name: 'Estate Office Ledger', tax: 'income' },
  rail('Kandy Station'),
  street('Hatton Bus Stand', 'lightBlue', 100, [6, 30, 90, 270, 400, 550], 50),
  street('Talawakelle Bridge', 'lightBlue', 100, [6, 30, 90, 270, 400, 550], 50),
  street('Maskeliya Reservoir', 'lightBlue', 120, [8, 40, 100, 300, 450, 600], 50),
  { k: 'jail', name: 'Railway Waiting Room' },
  street('Peradeniya Campus', 'pink', 140, [10, 50, 150, 450, 625, 750], 100),
  utility('Waterfall Power Board'),
  street('Katugastota Bridge', 'pink', 140, [10, 50, 150, 450, 625, 750], 100),
  street('Kandy Market Hall', 'pink', 160, [12, 60, 180, 500, 700, 900], 100),
  rail('Nanu Oya Station'),
  street('Welimada Carrot Fields', 'orange', 180, [14, 70, 200, 550, 750, 950], 100),
  { k: 'chance', name: CHANCE_NAME },
  street('Haputale Tea Ridge', 'orange', 200, [16, 80, 220, 600, 800, 1000], 100),
  { k: 'parking', name: 'Tea Break Shelter' },
  street('Ella Rock Trail', 'red', 220, [18, 90, 250, 700, 875, 1050], 150),
  { k: 'chest', name: CHEST_NAME },
  street("Little Adam's Peak", 'red', 220, [18, 90, 250, 700, 875, 1050], 150),
  street('Nine Arches Bridge', 'red', 240, [20, 100, 300, 750, 925, 1100], 150),
  rail('Haputale Station'),
  street('Kandy Lake Walk', 'yellow', 260, [22, 110, 330, 800, 975, 1150], 150),
  utility('Ice-Cold Shower Board'),
  street('Hantana Tea Hills', 'yellow', 280, [24, 120, 360, 850, 1025, 1200], 150),
  { k: 'goToJail', name: 'Train Delayed!' },
  street('Gregory Lake Boathouse', 'green', 300, [26, 130, 390, 900, 1100, 1275], 200),
  street('Horton Plains Lodge', 'green', 300, [26, 130, 390, 900, 1100, 1275], 200),
  { k: 'chance', name: CHANCE_NAME },
  street("Tea Planter's Bungalow", 'green', 320, [28, 150, 450, 1000, 1200, 1400], 200),
  rail('Ella Station'),
  street('Racecourse Grandstand', 'darkBlue', 350, [35, 175, 500, 1100, 1300, 1500], 200),
  { k: 'tax', name: 'Woolly Jumper Bill', tax: 'luxury' },
  street('Little England Mansion', 'darkBlue', 400, [50, 200, 600, 1400, 1700, 2000], 200),
];

const PASS_START = 'If you pass Start, collect Rs. 20,000.';
const TO_WAIT = 'Go directly to the Railway Waiting Room. Do not pass Start, do not collect Rs. 20,000.';

/** "Mountain Mist" (the rulebook's Chance deck) */
const CHANCE: CardDef[] = [
  { id: 'ch-go', text: 'The mist lifts and you can see the road home. Advance to Start. Collect Rs. 20,000.', fx: { k: 'advance', to: 0 } },
  { id: 'ch-galle', text: `Everyone wants a photo of the blue train. Advance to Nine Arches Bridge. ${PASS_START}`, fx: { k: 'advance', to: 22 } },
  { id: 'ch-negombo', text: `The exam results are out. Advance to Peradeniya Campus. ${PASS_START}`, fx: { k: 'advance', to: 10 } },
  {
    id: 'ch-utility',
    text:
      'The water heater gives up on the coldest morning of the year. Advance to the nearest Board. If unowned, you ' +
      'may buy it. If owned, throw the dice and pay the owner ten times the amount thrown.',
    fx: { k: 'nearest', kind: 'utility' },
  },
  {
    id: 'ch-rail1',
    text: 'The bus is full of carrot sacks. Advance to the nearest Station and pay the owner twice the fare they are otherwise owed. If unowned, you may buy it.',
    fx: { k: 'nearest', kind: 'rail' },
  },
  {
    id: 'ch-rail2',
    text: 'A train whistle sounds somewhere in the mist. Advance to the nearest Station and pay the owner twice the fare they are otherwise owed. If unowned, you may buy it.',
    fx: { k: 'nearest', kind: 'rail' },
  },
  { id: 'ch-dividend', text: 'Good prices at the tea auction. Collect Rs. 5,000.', fx: { k: 'cash', amount: 50 } },
  { id: 'ch-goojf', text: 'The station master owes you a favour. Leave the Railway Waiting Room free. Keep this card until needed, or sell it.', fx: { k: 'goojf' } },
  { id: 'ch-back3', text: 'Thick mist: you missed the turning. Go back 3 spaces.', fx: { k: 'back', n: 3 } },
  { id: 'ch-jail', text: `A small landslide blocks the line. ${TO_WAIT}`, fx: { k: 'jail' } },
  {
    id: 'ch-repairs',
    text: 'Damp creeps into every wall: pay Rs. 2,500 for each house and Rs. 10,000 for each hotel.',
    fx: { k: 'repairs', house: 25, hotel: 100 },
  },
  { id: 'ch-poortax', text: 'Fined for feeding the monkeys at the viewpoint. Pay Rs. 1,500.', fx: { k: 'cash', amount: -15 } },
  { id: 'ch-fort', text: `Catch the early train to the hills. Advance to Kandy Station. ${PASS_START}`, fx: { k: 'advance', to: 5 } },
  { id: 'ch-penthouse', text: 'Invited to tea by a log fire. Advance to Little England Mansion.', fx: { k: 'advance', to: 35 } },
  { id: 'ch-chairman', text: 'You are elected to run the flower show. Pay each player Rs. 5,000.', fx: { k: 'each', amount: -50 } },
  { id: 'ch-loan', text: 'A bumper crop of strawberries. Collect Rs. 15,000.', fx: { k: 'cash', amount: 150 } },
];

/** "Tea Tin" (the rulebook's Community Chest deck) */
const CHEST: CardDef[] = [
  { id: 'cc-go', text: 'The sun comes out for the first time in a week. Advance to Start. Collect Rs. 20,000.', fx: { k: 'advance', to: 0 } },
  { id: 'cc-bankerror', text: 'Bank error in your favour (the clerk was too cold to count). Collect Rs. 20,000.', fx: { k: 'cash', amount: 200 } },
  { id: 'cc-doctor', text: 'A leech got into your sock on the trail. Pay the dispensary Rs. 5,000.', fx: { k: 'cash', amount: -50 } },
  { id: 'cc-stock', text: 'You sell a basket of fresh leeks at the market. Collect Rs. 4,500.', fx: { k: 'cash', amount: 45 } },
  { id: 'cc-goojf', text: 'Your uncle drives the night mail. Leave the Railway Waiting Room free. Keep this card until needed, or sell it.', fx: { k: 'goojf' } },
  { id: 'cc-jail', text: `You fell asleep on the platform and the train left without you. ${TO_WAIT}`, fx: { k: 'jail' } },
  { id: 'cc-wedding', text: "It's your house-warming in the hills. Collect Rs. 5,000 from every player as gifts.", fx: { k: 'each', amount: 50 } },
  { id: 'cc-avurudu', text: 'Your New Year bonus arrives with a box of kokis. Collect Rs. 10,000.', fx: { k: 'cash', amount: 100 } },
  { id: 'cc-taxrefund', text: 'The estate office finds an overpayment. Collect Rs. 2,000.', fx: { k: 'cash', amount: 20 } },
  { id: 'cc-deposit', text: 'Your best tea plucking month ever. Collect Rs. 10,000.', fx: { k: 'cash', amount: 100 } },
  { id: 'cc-hospital', text: "You climbed Little Adam's Peak in rubber slippers. Pay the hospital Rs. 10,000.", fx: { k: 'cash', amount: -100 } },
  { id: 'cc-school', text: 'New school jumpers for the whole family. Pay Rs. 15,000.', fx: { k: 'cash', amount: -150 } },
  { id: 'cc-services', text: 'You helped push a stuck van up the hill. Collect Rs. 2,500.', fx: { k: 'cash', amount: 25 } },
  {
    id: 'cc-repairs',
    text: 'Monsoon rain washes the garden down the hill: pay Rs. 4,000 per house and Rs. 11,500 per hotel.',
    fx: { k: 'repairs', house: 40, hotel: 115 },
  },
  { id: 'cc-contest', text: 'Second prize for the biggest cabbage at the flower show. Collect Rs. 1,000.', fx: { k: 'cash', amount: 10 } },
  { id: 'cc-dubai', text: 'Hikers love your homestay. Collect Rs. 10,000.', fx: { k: 'cash', amount: 100 } },
];

export const HILL: BoardDef = {
  id: 'hill',
  spaces: SPACES,
  groups: [
    { id: 'brown', name: 'Brown', spaces: [1, 3] },
    { id: 'lightBlue', name: 'Light Blue', spaces: [6, 7, 8] },
    { id: 'pink', name: 'Pink', spaces: [10, 12, 13] },
    { id: 'orange', name: 'Orange', spaces: [15, 17] },
    { id: 'red', name: 'Red', spaces: [19, 21, 22] },
    { id: 'yellow', name: 'Yellow', spaces: [24, 26] },
    { id: 'green', name: 'Green', spaces: [28, 29, 31] },
    { id: 'darkBlue', name: 'Dark Blue', spaces: [33, 35] },
  ],
  railRent: [25, 50, 100, 200],
  utilityMul: [4, 10],
  utilityCardMul: 10,
  railCardMul: 2,
  jailIndex: 9,
  goToJailIndex: 27,
  chance: CHANCE,
  chest: CHEST,
  maxPlayers: 6,
  // A cooler economy: a stiffer jail fine and a flat income tax
  rules: { jailFine: 100, incomeTaxMode: 'flat' },
  speedDie: {
    faces: [1, 2, 3, 'bus', 'uncle', 'uncle'],
    labels: { '1': '1', '2': '2', '3': '3', bus: 'Bus', uncle: 'Tuk-Tuk Uncle' },
  },
  display: {
    title: 'TUK-TUK TYCOON',
    name: 'Hill Country',
    subtitle: 'Hill Country',
    blurb: 'Kandy to Nuwara Eliya and Ella along the main line: tea estates, misty mornings, late trains and leeches.',
    rulesBlurb: 'A Rs. 10,000 jail fine and a flat income tax: a cooler hill economy',
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
