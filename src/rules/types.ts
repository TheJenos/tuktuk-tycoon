/*
 * Every public type of the rules engine. The engine is pure: it imports nothing from React, three or Firebase, and
 * the state is plain JSON (no null, undefined, NaN or class instances), so it can be stored as a JSON string, cloned
 * with structuredClone and replayed on any client.
 */

// ---------------------------------------------------------------------------------------------------------------
// Seats, dice, config

/** A seat at the table. The engine never sees network player ids: the net layer maps a seat to whoever controls it. */
export type SeatId = 's0' | 's1' | 's2' | 's3' | 's4' | 's5' | 's6' | 's7';
/** Who sent a command: a seat, or the driver's chores (timeouts, auction close, Finish now) */
export type Actor = SeatId | 'system';
/** The red Speed Die. The d6 maps to [1, 2, 3, 'bus', 'uncle', 'uncle'] (data file `speedDie.faces`). */
export type SpeedFace = 1 | 2 | 3 | 'bus' | 'uncle';
/** 0 = unimproved, 1-4 = houses, 5 = hotel */
export type Level = 0 | 1 | 2 | 3 | 4 | 5;
export type Deck = 'chance' | 'chest';
/** One rigged throw for debugRig: two white dice, and optionally the speed face */
export type RigRoll = [number, number] | [number, number, SpeedFace];

/**
 * Room rules. Every field is a plain number, boolean or a small string enum so the lobby can store any value;
 * normalizeConfig() clamps numbers and replaces unknown enum values with the default.
 */
export interface RulesConfig {
  /** Board id for getBoard() */
  board: string;
  speedDie: boolean;
  startCash: number;
  /** Extra cash per player when the Speed Die is on */
  speedBonus: number;
  goSalary: number;
  incomeFlat: number;
  /** Income tax alternative, percent of worth (rounded down) */
  incomePct: number;
  luxuryTax: number;
  jailFine: number;
  houses: number;
  hotels: number;
  /** Interest on lifting or receiving a mortgage, percent of the mortgage value (rounded up) */
  mortgagePct: number;
  /** A triple (Speed Die) also grants the doubles re-roll */
  triplesRollAgain: boolean;
  /** End the game after this many turns in total (each player's go counts 1), ranked by net worth. 0 = off */
  turnLimit: number;
  /** Landing exactly on GO pays double the salary */
  doubleGoLanding: boolean;
  /** Taxes, fines and card payments to the bank go into a pot paid to whoever lands on the parking space */
  jackpot: boolean;
  /** Income Tax: the player's choice (flat or percent), or always one of them (no choice, no phase) */
  incomeTaxMode: IncomeTaxMode;
  /** Declined property and a bankrupt's property to the bank are auctioned (off: the bank keeps them) */
  auctions: boolean;
  /** No buying (or bidding) until the player has collected a GO salary once */
  buyAfterFirstLap: boolean;
  /** Owners collect rent while they are in jail */
  jailRent: boolean;
  /** A third doubles in one turn sends the player to jail */
  threeDoublesJail: boolean;
  /** Properties dealt free to each player at the start (0-3; fewer when the board runs out) */
  dealProperties: number;
  /** lastStanding: play until one player is left; firstBankrupt: the first bankruptcy ends the game */
  endMode: EndMode;
  /** Trading between players: on, off, or only once both have collected `tradeAfterLap` GO salaries */
  trading: TradingMode;
  /** With trading 'afterLap': GO salaries each party must have collected (1-20) */
  tradeAfterLap: number;
  /** Accept debugRig / debugSetCash (e2e only) */
  debug: boolean;
}

export type IncomeTaxMode = 'choice' | 'flat' | 'percent';
export type EndMode = 'lastStanding' | 'firstBankrupt';
export type TradingMode = 'on' | 'off' | 'afterLap';

// ---------------------------------------------------------------------------------------------------------------
// Board data (the swappable data file)

export interface StreetDef {
  k: 'street';
  name: string;
  group: string;
  price: number;
  /** [base, 1 house, 2, 3, 4 houses, hotel] */
  rent: number[];
  house: number;
  /** Hotel cost; defaults to the house cost */
  hotel?: number;
  mortgage: number;
}
export interface RailDef {
  k: 'rail';
  name: string;
  price: number;
  mortgage: number;
}
export interface UtilityDef {
  k: 'utility';
  name: string;
  price: number;
  mortgage: number;
}
export interface TaxDef {
  k: 'tax';
  name: string;
  tax: 'income' | 'luxury';
}
export interface PlainSpaceDef {
  k: 'go' | 'jail' | 'parking' | 'goToJail' | 'chance' | 'chest';
  name: string;
}
export type PropertyDef = StreetDef | RailDef | UtilityDef;
export type SpaceDef = PropertyDef | TaxDef | PlainSpaceDef;

export interface GroupDef {
  id: string;
  name: string;
  /** Board indexes, in board order */
  spaces: number[];
}

/** Card effects are plain data, never functions */
export type CardFx =
  /** Advance to a space (collect salary when passing GO) */
  | { k: 'advance'; to: number }
  /** Advance to the nearest railroad (rent x2) or utility (fresh throw x10) */
  | { k: 'nearest'; kind: 'rail' | 'utility' }
  | { k: 'back'; n: number }
  | { k: 'jail' }
  | { k: 'goojf' }
  /** Positive: the bank pays you. Negative: you pay the bank. */
  | { k: 'cash'; amount: number }
  /** Positive: collect from every other player. Negative: pay every other player. */
  | { k: 'each'; amount: number }
  | { k: 'repairs'; house: number; hotel: number };

export interface CardDef {
  /** Stable id; the prefix tells which deck a Get Out of Jail Free card returns to */
  id: string;
  text: string;
  fx: CardFx;
}

export interface BoardDef {
  id: string;
  spaces: SpaceDef[];
  groups: GroupDef[];
  /** Rent by railroads owned: 1, 2, 3, 4 */
  railRent: number[];
  /** Dice multiplier by utilities owned: 1, 2 */
  utilityMul: number[];
  /** Multiplier for the Nearest Utility card's fresh throw */
  utilityCardMul: number;
  /** Rent multiplier for the Nearest Railroad card */
  railCardMul: number;
  jailIndex: number;
  goToJailIndex: number;
  chance: CardDef[];
  chest: CardDef[];
  speedDie: { faces: SpeedFace[]; labels: Record<string, string> };
  /** The most players the board seats: a smaller board seats fewer */
  maxPlayers: number;
  /**
   * The board's standard rules, over DEFAULT_RULES: where the lobby starts for this board (the table can still change
   * any of them). Not applied by the engine itself: a game's config is whatever it was created with.
   */
  rules: Partial<Omit<RulesConfig, 'board' | 'debug'>>;
  /**
   * What the UI prints: the board title, its name, subtitle and blurb, each card deck's name, the colour groups' colours and the currency. Money
   * is shown as `symbol` and the engine's amount times `scale` (the engine counts rulebook units).
   */
  display: {
    title: string;
    /** The board's name in the board picker, the Rooms list and the rules ("All Island") */
    name: string;
    /** Printed under the title in the centre of the board */
    subtitle: string;
    /** One line for the board picker */
    blurb: string;
    /** One line on how its standard rules differ from the rulebook's (the lobby's preset hint); none for the rulebook's */
    rulesBlurb?: string;
    decks: Record<Deck, string>;
    groupColours: Record<string, string>;
    currency: { symbol: string; scale: number };
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Game state

export interface PlayerState {
  seat: SeatId;
  name: string;
  cash: number;
  /** Board index 0-39 */
  pos: number;
  /** Present while in jail; tries = failed jail rolls so far (0-2) */
  jail?: { tries: number };
  /** Held Get Out of Jail Free card ids */
  goojf: string[];
  /** Speed Die unlocked (first GO salary collected) */
  speed: boolean;
  /** GO salaries collected (laps completed; the first-lap and trading rules read it) */
  laps: number;
  out?: 'bankrupt' | 'resigned';
  /** seq of the command that put the player out (for the final ranking) */
  outAt?: number;
}

/** An owned property. Absent from GameState.props = owned by the bank. */
export interface PropState {
  owner: SeatId;
  level: Level;
  mortgaged?: true;
}

export interface Roll {
  w: [number, number];
  /** Present only when the Speed Die was rolled */
  s?: SpeedFace;
}

export interface Turn {
  seat: SeatId;
  /** Turn number, 1-based, counting every player's go */
  no: number;
  /** Doubles rolled so far this turn */
  doubles: number;
  /** The current roll grants another roll (doubles, not from jail, not jailed since) */
  again: boolean;
  roll?: Roll;
  /** The current roll was a roll to get out of jail */
  jailRoll?: true;
}

export type Lot = { k: 'prop'; space: number } | { k: 'house' } | { k: 'hotel' };
export type BuildKind = 'house' | 'hotel';
export type Creditor = SeatId | 'bank';
/** Amounts owed, by creditor */
export type Owed = Partial<Record<Creditor, number>>;

/**
 * Where the game waits. Turn phases belong to the turn seat. Interrupts (auction, place, buildClaim, mortgageXfer,
 * debt) store `resume`, the phase to return to when they finish; they can nest.
 */
export type Phase =
  | { k: 'preRoll' }
  | { k: 'bus'; opts: number[] }
  | { k: 'chooseSpace' }
  | { k: 'buy'; space: number }
  | { k: 'incomeTax' }
  | { k: 'postRoll' }
  /** Internal: the pending steps are running. Never the phase at rest, but it can be a `resume` value. */
  | { k: 'busy' }
  | AuctionPhase
  | PlacePhase
  | BuildClaimPhase
  | MortgageXferPhase
  | DebtPhase
  | OverPhase;

/** Timed open bidding with a fixed countdown (bids never add time). Any eligible seat that has not passed may bid at any time. */
export interface AuctionPhase {
  k: 'auction';
  lot: Lot;
  high?: { seat: SeatId; amount: number };
  passed: SeatId[];
  eligible: SeatId[];
  /** More bank properties to auction after this one (bankruptcy to the bank) */
  queue: number[];
  resume: Phase;
}

/** The winner (or a granted requester) of building units places them, one `place` action per unit */
export interface PlacePhase {
  k: 'place';
  seat: SeatId;
  kind: BuildKind;
  count: number;
  /** Present when the units were won at auction (already paid); absent = pays the normal price per unit */
  bid?: number;
  resume: Phase;
}

/**
 * Building shortage contest. `open` seats may requestBuild{n} or pass. Once nobody is open: if the requests fit the
 * bank's supply all are granted, otherwise units are auctioned one at a time among the requesters (`auctioning`).
 */
export interface BuildClaimPhase {
  k: 'buildClaim';
  kind: BuildKind;
  /** The seat whose build started the contest, and that build */
  by: SeatId;
  build?: { group: string; levels: number[] };
  /** Units wanted, by seat (the starter's entry is what its build needs) */
  req: Partial<Record<SeatId, number>>;
  open: SeatId[];
  auctioning?: true;
  /** A unit drew no bids: the contest is over */
  stop?: true;
  resume: Phase;
}

/** A seat received mortgaged property in a trade and chooses per space: lift now, or pay interest only */
export interface MortgageXferPhase {
  k: 'mortgageXfer';
  seat: SeatId;
  spaces: number[];
  resume: Phase;
}

/** The debtor raises cash (sell, mortgage, trade). Settles by itself once cash covers the total. */
export interface DebtPhase {
  k: 'debt';
  debtor: SeatId;
  owed: Owed;
  why: CashWhy;
  /** The space the payment is for (rent, a tax square, an auctioned lot), carried onto the settling `cash` events */
  space?: number;
  resume: Phase;
}

export interface OverPhase {
  k: 'over';
  winner: SeatId;
  /** Every seat, best first: active seats by net worth, then the others, last out first */
  ranking: SeatId[];
  why: 'lastStanding' | 'turnLimit' | 'endGame' | 'firstBankrupt' | 'timeUp';
}

export type InterruptPhase = AuctionPhase | PlacePhase | BuildClaimPhase | MortgageXferPhase | DebtPhase;

export type MoveVia = 'dice' | 'card' | 'uncle' | 'triple' | 'bus' | 'jail' | 'back';

/** The queue of work left in a turn (moves, landings, payments). Internal, but stored in the state. */
export type Step =
  | { k: 'move'; seat: SeatId; to: number; via: MoveVia }
  | { k: 'back'; seat: SeatId; n: number }
  | { k: 'land'; seat: SeatId; rentMul?: number; utilFresh?: true }
  | { k: 'uncle'; seat: SeatId }
  | { k: 'pay'; from: SeatId; owed: Owed; why: CashWhy }
  | { k: 'free'; seat: SeatId; how: JailExitHow }
  | { k: 'afterRoll' }
  | { k: 'nextTurn' };

/** Immediate assets only: there are no loans or promises */
export interface Bundle {
  cash: number;
  props: number[];
  /** Get Out of Jail Free card ids */
  cards: string[];
}

export interface Trade {
  id: string;
  from: SeatId;
  to: SeatId;
  /** What `from` gives */
  give: Bundle;
  /** What `from` gets (what `to` gives) */
  get: Bundle;
}

export interface GameState {
  /** RULES_VERSION the state was made with */
  v: number;
  /** +1 per accepted command */
  seq: number;
  /** seq at which the current phase was entered (timer keys; an auction's bids do not change it) */
  since: number;
  /** mulberry32 state (uint32). Only createGame, roll and the utility fresh throw consume it. */
  rng: number;
  cfg: RulesConfig;
  players: Partial<Record<SeatId, PlayerState>>;
  /** Turn order (the opening roll's winner first, then lobby seat order) */
  order: SeatId[];
  turn: Turn;
  phase: Phase;
  pending: Step[];
  /** Owned properties, keyed `p<index>`. Absent = bank. */
  props: Partial<Record<string, PropState>>;
  bank: { houses: number; hotels: number };
  /** The parking jackpot (cfg.jackpot): taxes, fines and card payments to the bank since it was last won */
  pot: number;
  /** Card ids, [0] = top */
  decks: { chance: string[]; chest: string[] };
  trades: Record<string, Trade>;
  /** Debug: queued rigged throws (empty unless cfg.debug) */
  rig: RigRoll[];
}

// ---------------------------------------------------------------------------------------------------------------
// Commands

export type Action =
  // Turn
  | { k: 'roll' }
  | { k: 'bus'; n: number }
  | { k: 'chooseSpace'; space: number }
  | { k: 'buy' }
  | { k: 'decline' }
  | { k: 'incomeTax'; pick: 'flat' | 'percent' }
  | { k: 'payFine' }
  | { k: 'useCard'; card?: string }
  | { k: 'endTurn' }
  // Auctions and the building contest
  | { k: 'bid'; amount: number }
  | { k: 'pass' }
  | { k: 'requestBuild'; n: number }
  | { k: 'place'; space: number }
  // Managing property
  /** Target levels for every space of the group (in GroupDef.spaces order); only raises */
  | { k: 'build'; group: string; levels: number[] }
  /** Target levels for every space of the group; only lowers */
  | { k: 'sell'; group: string; levels: number[] }
  | { k: 'mortgage'; space: number }
  | { k: 'unmortgage'; space: number }
  /** Sell an unimproved property back to the bank (80% of the price, less the loan when mortgaged) */
  | { k: 'sellProperty'; space: number }
  | { k: 'settleMortgages'; lift: number[] }
  // Trades
  | { k: 'propose'; to: SeatId; give: Bundle; get: Bundle }
  | { k: 'accept'; id: string }
  | { k: 'reject'; id: string }
  | { k: 'cancel'; id: string }
  // Debt and leaving
  | { k: 'autoRaise' }
  | { k: 'bankrupt' }
  | { k: 'resign' }
  // System (by: 'system', basis required)
  | { k: 'closeAuction' }
  | { k: 'closeClaim' }
  | { k: 'endGame' }
  /** The room's time limit ran out: ends the game ranked by net worth */
  | { k: 'timeUp' }
  /** A timeout: plays `a` for `seat`, which must be awaited and `a` must equal defaultAction(state, seat) */
  | { k: 'forced'; seat: SeatId; a: Action }
  // Debug (cfg.debug only)
  | { k: 'debugRig'; dice: RigRoll[] }
  | { k: 'debugSetCash'; seat: SeatId; cash: number };

export type ActionKind = Action['k'];

export interface Command {
  by: Actor;
  a: Action;
  /** When present it must equal state.seq (bots and chores). Required for system commands. */
  basis?: number;
}

export interface RuleError {
  code: string;
  message: string;
}

export type Result = { ok: true; state: GameState; events: GameEvent[] } | { ok: false; error: RuleError };

export interface ApplyOptions {
  /** Run checkInvariants after the command (default: on in dev and test builds) */
  check?: boolean;
}

// ---------------------------------------------------------------------------------------------------------------
// Events. Each carries post-change values (cash after, level after, owner after) so a view can never drift.

export type CashWhy =
  | 'salary'
  | 'rent'
  | 'buy'
  | 'auction'
  | 'tax'
  | 'card'
  | 'fine'
  | 'build'
  /** Buildings sold back to the bank */
  | 'sell'
  /** A property sold back to the bank (sellProperty, or a bankrupt's property liquidated) */
  | 'sale'
  | 'mortgage'
  | 'unmortgage'
  | 'interest'
  | 'trade'
  | 'bankrupt'
  | 'refund'
  | 'jackpot'
  | 'debug';

export type JailReason = 'space' | 'card' | 'doubles';
export type JailExitHow = 'doubles' | 'fine' | 'card' | 'forced';
/** sold: sold back to the bank (sellProperty) */
export type OwnerVia = 'buy' | 'auction' | 'trade' | 'bankrupt' | 'deal' | 'sold';

export type GameEvent =
  | { t: 'order'; order: SeatId[] }
  | { t: 'turn'; seat: SeatId; no: number }
  | {
      t: 'dice';
      seat: SeatId;
      purpose: 'order' | 'move' | 'jail' | 'utility';
      w: [number, number];
      s?: SpeedFace;
      doubles: boolean;
      triples: boolean;
      /** White dice plus a number face (Bus and Tuk-Tuk Uncle count 0) */
      total: number;
    }
  | { t: 'speedOn'; seat: SeatId }
  /** path: every space entered after `from`, in order, ending at `to` */
  | { t: 'move'; seat: SeatId; from: number; to: number; path: number[]; via: MoveVia }
  /** Marker for passing or landing on GO; the money moves in the cash event that follows */
  | { t: 'salary'; seat: SeatId; amount: number }
  | { t: 'land'; seat: SeatId; space: number }
  /** Every change of a player's cash is one of these. after: cash after the transfer of each seat involved. */
  | {
      t: 'cash';
      from: Creditor;
      to: Creditor;
      amount: number;
      why: CashWhy;
      after: Partial<Record<SeatId, number>>;
      space?: number;
    }
  | { t: 'card'; seat: SeatId; deck: Deck; cardId: string; text: string; kept: boolean }
  /** A card went to the bottom of its deck (drawn and done, or a used/returned Get Out of Jail Free) */
  | { t: 'cardReturn'; deck: Deck; cardId: string; seat?: SeatId }
  /** A held Get Out of Jail Free card changed hands */
  | { t: 'cardGive'; cardId: string; from: SeatId; to: SeatId }
  | { t: 'jail'; seat: SeatId; reason: JailReason }
  | { t: 'jailStay'; seat: SeatId; tries: number }
  | { t: 'jailExit'; seat: SeatId; how: JailExitHow }
  | { t: 'bus'; seat: SeatId; opts: number[] }
  | { t: 'chooseSpace'; seat: SeatId }
  /** Tuk-Tuk Uncle: `to` absent = no target, the player stays put */
  | { t: 'uncle'; seat: SeatId; to?: number; target?: 'bank' | 'rent' }
  /** to absent = back to the bank */
  | { t: 'owner'; space: number; from?: SeatId; to?: SeatId; via: OwnerVia }
  | { t: 'level'; space: number; from: Level; to: Level; bank: { houses: number; hotels: number } }
  | { t: 'mortgage'; space: number; on: boolean }
  | { t: 'auctionStart'; lot: Lot; eligible: SeatId[]; queue: number[] }
  | { t: 'bid'; seat: SeatId; amount: number }
  /** auto: the engine passed for a seat that can no longer raise enough */
  | { t: 'pass'; seat: SeatId; auto?: true }
  | { t: 'auctionEnd'; lot: Lot; winner?: SeatId; amount?: number }
  | { t: 'claimStart'; kind: BuildKind; by: SeatId; open: SeatId[]; supply: number }
  /** n = 0: passed */
  | { t: 'claimRequest'; seat: SeatId; n: number }
  | { t: 'claimEnd'; kind: BuildKind; outcome: 'granted' | 'auction' | 'done' }
  | { t: 'placeStart'; seat: SeatId; kind: BuildKind; count: number }
  | { t: 'xferStart'; seat: SeatId; spaces: number[] }
  | { t: 'tradeProposed'; trade: Trade }
  | { t: 'tradeDone'; trade: Trade }
  | { t: 'tradeRejected'; id: string }
  /** cancelled: by its proposer; out: a party left the game; over: the game ended */
  | { t: 'tradeCancelled'; id: string; why: 'cancelled' | 'out' | 'over' }
  | { t: 'debt'; debtor: SeatId; owed: Owed; total: number; why: CashWhy }
  | { t: 'debtPaid'; debtor: SeatId }
  | { t: 'bankrupt'; seat: SeatId; to: Creditor; resigned: boolean }
  | { t: 'timeout'; seat: SeatId; a: Action }
  | { t: 'over'; winner: SeatId; ranking: SeatId[]; why: OverPhase['why'] };

export type EventType = GameEvent['t'];

/** What timer() returns: the net layer keeps one deadline per key */
export interface TimerInfo {
  /** Changes whenever the deadline should restart */
  key: string;
  /** turn: preRoll/postRoll. decision: bus, chooseSpace, buy, incomeTax, place, buildClaim, mortgageXfer.
   *  trade: reserved (offers never block play and never expire). */
  kind: 'turn' | 'auction' | 'decision' | 'debt' | 'trade';
}
