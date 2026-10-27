/*
 * The rules engine's public API. See README.md in this folder for what each export does, the phase machine, the
 * event list and how a network layer drives timers.
 */

export type * from './types';

export { apply } from './apply';
export { createGame, SEAT_IDS, MIN_SEATS, MAX_SEATS, NAME_MAX, type SeatSetup } from './create';
export { legalActions } from './legal';
export { awaiting, defaultAction, timer, timeoutCommand } from './autoplay';
export { checkInvariants } from './invariants';
export { encode, decode, RULES_VERSION, UPGRADABLE_VERSIONS } from './codec';
export { DEFAULT_RULES, normalizeConfig } from './config';
export { getBoard, boardName, BOARDS, BOARD_IDS, deckOf, pathForward, pathBack, isProperty, isStreet, type BoardInfo } from './board';
export { COLOMBO } from '../boards/colombo/rules';
export { HILL } from '../boards/hill/rules';
export { SOUTH } from '../boards/south/rules';
export { LANKA } from '../boards/lanka/rules';
export { busOptions, isDoubles, isTriples } from './dice';
export { faceValue, rollTotal } from './rent';
export { deepEqual } from './ctx';
export { formatMoney, toUnits, toRupees, MONEY_SCALE, MONEY_SYMBOL, type MoneyOpts } from './currency';
export {
  boardOf,
  rentFor,
  worth,
  netWorth,
  maxRaise,
  groupOf,
  ownsGroup,
  ownerOf,
  propertyState,
  isActive,
  activeSeats,
  unmortgageCost,
  xferCost,
  tradeProblems,
  tradingClosed,
  mayBuy,
  canMortgage,
  canUnmortgage,
  canSellProperty,
  sellPropertyValue,
  minBid,
  placeSites,
  buildCapacity,
  ranking,
  cardOf,
  buildOptions,
  incomeTaxAmounts,
  opponents,
  type BuildOption,
} from './selectors';
export type { RentOpts } from './rent';
