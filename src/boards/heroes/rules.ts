import { HEROES_FIXED } from '../../rules/heroesFixed';
import type { BoardDef, CardDef, HeroDef, HitFx, SpaceDef } from '../../rules/types';

/*
 * "Hero League": the superhero edition's rules (in parody: every name here is our own) on a 28-space city board
 * (six spaces between corners) for 2 to 6 players. Power instead of money, compulsory saving, a back-up hero, no
 * bankruptcy, a Hero die and six superpowers; the game ends once every location is saved (docs/heroes.md). Its
 * `heroes` block switches those rules on in the engine. Sixteen locations in eight colour pairs, each pair held by
 * two villains; a location's power-up is its one rent entry (about 60% of its cost, doubled for the pair). Money is
 * "Power", shown at scale 1 after the number ("1,500 Power"); card texts print the amounts.
 */

const location = (name: string, group: string, price: number, powerUp: number, villain: string): SpaceDef => ({
  k: 'street',
  name,
  group,
  price,
  rent: [powerUp],
  house: 0,
  mortgage: 0,
  villain,
});

const CHANCE_NAME = 'Villain Strike';
const CHEST_NAME = 'Hero HQ';

const SPACES: SpaceDef[] = [
  { k: 'go', name: 'Rally Point' },
  location('Midtown Back Alleys', 'brown', 70, 40, 'Star Swarm'),
  location('Harbour Docks', 'brown', 70, 40, 'The Brute'),
  { k: 'chest', name: CHEST_NAME },
  location('The Iron Raft', 'teal', 120, 70, 'The Fang Legion'),
  { k: 'chance', name: CHANCE_NAME },
  location('Island Lock-Up', 'teal', 120, 70, 'The Illusionist'),
  { k: 'jail', name: 'Holding Cell' },
  { k: 'chance', name: CHANCE_NAME },
  location('Daily Trumpet Tower', 'pink', 160, 100, 'The Cranium'),
  location('Mystic Sanctum', 'pink', 180, 110, 'The Bone Baron'),
  { k: 'chance', name: CHANCE_NAME },
  location('Lost Jungle', 'orange', 200, 120, 'Star Swarm'),
  location('Floating City', 'orange', 220, 130, 'Cyber Tyrant'),
  { k: 'parking', name: 'Rooftop Lookout' },
  location('Tri-Fort HQ', 'red', 240, 140, 'The Brute'),
  location('Sky Carrier', 'red', 260, 150, 'The Fang Legion'),
  location('Sunken Kingdom', 'yellow', 280, 170, 'The Hourglass'),
  { k: 'chance', name: CHANCE_NAME },
  location('Realm Eternal', 'yellow', 300, 180, 'The Illusionist'),
  { k: 'chance', name: CHANCE_NAME },
  { k: 'goToJail', name: 'Villain Ambush' },
  location('Hidden Kingdom', 'green', 320, 190, 'The Cranium'),
  { k: 'chest', name: CHEST_NAME },
  location('Starmetal Mines', 'green', 320, 190, 'The Hourglass'),
  { k: 'chance', name: CHANCE_NAME },
  location('Hero Mansion', 'purple', 400, 240, 'Cyber Tyrant'),
  location('League Tower', 'purple', 400, 240, 'The Bone Baron'),
];

/** A Villain Strike card that throws the Hero die `rolls` times, each hero rolled taking `hit` */
const hd = (rolls: number, hit: HitFx): CardDef['fx'] => ({ k: 'heroDie', rolls, hit });

/** "Villain Strike" (the deck in the Chance slot): every card works against a hero */
const CHANCE: CardDef[] = [
  { id: 'ch-illusionist', text: 'The Illusionist casts a spell. Roll the Hero die: the hero rolled loses 100 Power.', fx: hd(1, { k: 'cash', amount: -100 }) },
  { id: 'ch-swarm', text: 'Star Swarm attacks the city! Roll the Hero die twice: each hero rolled loses 50 Power.', fx: hd(2, { k: 'cash', amount: -50 }) },
  { id: 'ch-satellites', text: 'Cyber Tyrant hacks the satellites. Roll the Hero die 3 times: each hero rolled loses 30 Power.', fx: hd(3, { k: 'cash', amount: -30 }) },
  { id: 'ch-cranium', text: 'The Cranium reads minds. Roll the Hero die: the hero rolled loses 150 Power.', fx: hd(1, { k: 'cash', amount: -150 }) },
  { id: 'ch-agents', text: "The Bone Baron's agents strike. Roll the Hero die: the hero rolled loses their cheapest location.", fx: hd(1, { k: 'lose' }) },
  { id: 'ch-vaults', text: 'The Fang Legion raids the vaults. Roll the Hero die: the hero rolled loses 75 Power.', fx: hd(1, { k: 'cash', amount: -75 }) },
  { id: 'ch-brute', text: 'The Brute smashes through. Roll the Hero die: the hero rolled is captured. Go to the Holding Cell.', fx: hd(1, { k: 'jail' }) },
  { id: 'ch-rewind', text: 'The Hourglass rewinds time. Roll the Hero die twice: each hero rolled goes back 3 spaces.', fx: hd(2, { k: 'back', n: 3 }) },
  { id: 'ch-breakout', text: 'Mass breakout! Roll the Hero die twice: each hero rolled loses 50 Power.', fx: hd(2, { k: 'cash', amount: -50 }) },
  { id: 'ch-mindtrap', text: 'You walk into a mind-trap. Pay 50 Power.', fx: { k: 'cash', amount: -50 } },
  { id: 'ch-drain', text: 'Cyber Tyrant drains your suit. Pay 100 Power.', fx: { k: 'cash', amount: -100 } },
  {
    id: 'ch-ambush',
    text: 'Ambushed by the Fang Legion. Go to the Holding Cell. Do not pass Rally Point, do not collect 200 Power.',
    fx: { k: 'jail' },
  },
  { id: 'ch-turnaround', text: 'The Illusionist turns you around. Go back 3 spaces.', fx: { k: 'back', n: 3 } },
  { id: 'ch-overrun', text: 'Star Swarm overruns your cheapest location. You lose it.', fx: { k: 'lose' } },
  { id: 'ch-tribute', text: 'The Bone Baron demands tribute. Pay 75 Power.', fx: { k: 'cash', amount: -75 } },
  { id: 'ch-ransom', text: 'The villains hold the city to ransom. Pay each hero 25 Power.', fx: { k: 'each', amount: -25 } },
  { id: 'ch-chased', text: 'Chased across town! Advance to Rally Point. Collect 200 Power.', fx: { k: 'advance', to: 0 } },
  {
    id: 'ch-lured',
    text: 'Lured into a trap. Advance to The Iron Raft. If you pass Rally Point, collect 200 Power.',
    fx: { k: 'advance', to: 4 },
  },
  {
    id: 'ch-alarm',
    text: 'A false alarm sends you across the city. Advance to League Tower. If you pass Rally Point, collect 200 Power.',
    fx: { k: 'advance', to: 27 },
  },
  { id: 'ch-freeze', text: 'The Hourglass freezes you in time. Roll the Hero die: the hero rolled goes back 3 spaces.', fx: hd(1, { k: 'back', n: 3 }) },
];

/** "Hero HQ" (the deck in the Community Chest slot): every card helps */
const CHEST: CardDef[] = [
  { id: 'cc-bonus', text: 'Mission bonus. Collect 100 Power.', fx: { k: 'cash', amount: 100 } },
  { id: 'cc-training', text: 'Training complete. Collect 50 Power.', fx: { k: 'cash', amount: 50 } },
  { id: 'cc-thanks', text: 'The city thanks you. Collect 150 Power.', fx: { k: 'cash', amount: 150 } },
  { id: 'cc-mayor', text: 'A grateful mayor. Collect 200 Power.', fx: { k: 'cash', amount: 200 } },
  { id: 'cc-stash', text: "Found a villain's stash. Collect 25 Power.", fx: { k: 'cash', amount: 25 } },
  { id: 'cc-gear', text: 'Every hero chips in for your gear. Collect 20 Power from each hero.', fx: { k: 'each', amount: 20 } },
  { id: 'cc-rally', text: 'Advance to Rally Point. Collect 200 Power.', fx: { k: 'advance', to: 0 } },
  {
    id: 'cc-hunt',
    text: 'Hunt down a villain. Advance to the nearest villain-held location; you must save it if you have the power.',
    fx: { k: 'nearestFree', free: false },
  },
  {
    id: 'cc-track',
    text: 'Track the villains. Advance to the nearest villain-held location; you must save it if you have the power.',
    fx: { k: 'nearestFree', free: false },
  },
  { id: 'cc-strike1', text: 'Strike team ready. Advance to the nearest villain-held location and save it for free.', fx: { k: 'nearestFree', free: true } },
  { id: 'cc-strike2', text: 'Strike team ready. Advance to the nearest villain-held location and save it for free.', fx: { k: 'nearestFree', free: true } },
  { id: 'cc-recharge1', text: 'Recharge. Your superpower is ready again.', fx: { k: 'recharge' } },
  { id: 'cc-recharge2', text: 'Recharge. Your superpower is ready again.', fx: { k: 'recharge' } },
  { id: 'cc-bounty', text: 'Bounty paid. Collect 75 Power.', fx: { k: 'cash', amount: 75 } },
  { id: 'cc-teamup', text: 'Team-up bonus. Collect 10 Power from each hero.', fx: { k: 'each', amount: 10 } },
  { id: 'cc-week', text: 'Hero of the week. Collect 100 Power.', fx: { k: 'cash', amount: 100 } },
];

/** The six heroes, in Hero-die face order; their ids are the board's token ids */
const HERO_LIST: HeroDef[] = [
  {
    id: 'jadeTitan',
    name: 'Jade Titan',
    colour: '#2e9e44',
    power: 'smash',
    powerName: 'Titan Smash',
    powerText: "At the start of your turn, swap the places of any 2 heroes. They don't pass Rally Point or do anything else.",
  },
  {
    id: 'starCaptain',
    name: 'Star Captain',
    colour: '#2457c5',
    power: 'shield',
    powerName: 'Star Shield',
    powerText: 'Say no to any Villain Strike card or Titan Smash played against you.',
  },
  {
    id: 'steelAce',
    name: 'Steel Ace',
    colour: '#d4a017',
    power: 'copy',
    powerName: 'Suit Up',
    powerText: "Use any other hero's superpower, as long as it's ready.",
  },
  {
    id: 'stormLord',
    name: 'Storm Lord',
    colour: '#c8102e',
    power: 'thunder',
    powerName: 'Thunder Call',
    powerText: "Don't like a throw, yours or another hero's? Demand a re-roll! Works on the dice and the Hero die.",
  },
  {
    id: 'velvetViper',
    name: 'Velvet Viper',
    colour: '#3d3d4a',
    power: 'sting',
    powerName: 'Viper Strike',
    powerText: 'Move up to 6 extra spaces on your dice move.',
  },
  {
    id: 'sharpshot',
    name: 'Sharpshot',
    colour: '#7b3fc4',
    power: 'aim',
    powerName: 'Dead Aim',
    powerText: 'When you land on Villain Strike, take 2 cards and play the one you choose.',
  },
];

export const HEROES: BoardDef = {
  id: 'heroes',
  spaces: SPACES,
  groups: [
    { id: 'brown', name: 'Brown', spaces: [1, 2] },
    { id: 'teal', name: 'Teal', spaces: [4, 6] },
    { id: 'pink', name: 'Pink', spaces: [9, 10] },
    { id: 'orange', name: 'Orange', spaces: [12, 13] },
    { id: 'red', name: 'Red', spaces: [15, 16] },
    { id: 'yellow', name: 'Yellow', spaces: [17, 19] },
    { id: 'green', name: 'Green', spaces: [22, 24] },
    { id: 'purple', name: 'Purple', spaces: [26, 27] },
  ],
  // No stations or utilities on this board
  railRent: [],
  utilityMul: [],
  utilityCardMul: 10,
  railCardMul: 2,
  jailIndex: 7,
  goToJailIndex: 21,
  chance: CHANCE,
  chest: CHEST,
  maxPlayers: 6,
  // The pinned Hero League rules (normalizeConfig forces them on this board)
  rules: { ...HEROES_FIXED },
  // Kept for the shape; the Speed Die is pinned off here
  speedDie: {
    faces: [1, 2, 3, 'bus', 'uncle', 'uncle'],
    labels: { '1': '1', '2': '2', '3': '3', bus: 'Bus', uncle: 'Tuk-Tuk Uncle' },
  },
  heroes: { list: HERO_LIST, locationPoints: 100, stingMax: 6, aimCards: 2 },
  display: {
    title: 'TUK-TUK TYCOON',
    name: 'Hero League',
    subtitle: 'Hero League',
    blurb: 'Save the city from eight villains: superpowers, a Hero die, and nobody goes bankrupt.',
    rulesBlurb: 'Power instead of money, compulsory saving and superpowers; ends when every location is saved',
    currency: { symbol: 'Power', scale: 1, after: true },
    decks: { chance: CHANCE_NAME, chest: CHEST_NAME },
    groupColours: {
      brown: '#8b4c2c',
      teal: '#1aa3a3',
      pink: '#d6408f',
      orange: '#f4921f',
      red: '#e2232a',
      yellow: '#f9e11e',
      green: '#1fa952',
      purple: '#6b3fa0',
    },
    terms: { property: 'location', buy: 'save', bought: 'saved', rent: 'power-up', bank: 'the Power Broker', worth: 'score' },
    art: { chance: 'mask', chest: 'shield', parking: 'lookout', goToJail: 'ambush', goLine: 'AS YOU PASS' },
  },
};
