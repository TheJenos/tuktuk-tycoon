# Rules engine (`src/rules`)

The pure property-trading rules: Classic rules plus the optional Speed Die (2007 rulebook, see `docs/rules.md`), on
Tuk-Tuk Tycoon's boards (`data/lanka.ts`, the default, and its themed twins `data/colombo.ts`, `data/hill.ts`,
`data/south.ts`: same numbers and card effects, other names). No React, three, R3F or Firebase imports; nothing but its own files. Every client runs the same reducer on the same JSON state,
so a replay of the same commands gives the same state and the same events everywhere.

Read this file and `types.ts`; everything else is implementation. Import from `src/rules` (`index.ts`) only.

```ts
import { createGame, apply, legalActions, awaiting, timer, timeoutCommand, encode, decode } from '../rules';

let { state, events } = createGame({ speedDie: true }, [{ id: 's0', name: 'Ann' }, { id: 's1', name: 'Bob' }], seed);
const r = apply(state, { by: 's0', a: { k: 'roll' } });
if (r.ok) { state = r.state; play(r.events); } else showError(r.error.message);
```

## Principles

- **Seats, not players.** Players are keyed by `SeatId` (`'s0'`..`'s7'`). The net layer maps a seat to whoever
  controls it (human, bot, AFK takeover); the engine never sees network ids.
- **`apply()` never throws and never mutates its input.** It `structuredClone`s the state, runs the action, then
  *drains* the pending steps until the game waits for someone again. Every accepted command bumps `seq` by exactly 1.
  In dev and test builds (`import.meta.env.DEV`) it also runs `checkInvariants` and refuses (`code: 'invariant'`) a
  command that would break one; pass `{ check: true | false }` to override.
- **No clock.** Deadlines belong to the net layer (see [Timers](#timers-and-timeouts)).
- **Randomness lives in the state** (`state.rng`, a mulberry32 uint32). Only `createGame` (deck shuffles, opening
  roll, the quick-start deal), `roll` and the Nearest Utility card's fresh throw consume it, so nobody can change future dice by slipping in
  a free action first. The seed and deck order are readable by anyone holding the state (a known, accepted limit).
- **JSON-safe state**: no `null`, `undefined`, `NaN` or class instances anywhere; whole money units; optional fields are
  absent rather than undefined. `encode()` is `JSON.stringify`.
- **Money is in rulebook units** (start 1500, prices 60..400): state, actions, events, configs and bots all use
  them. Players see and type rupees at `board.display.currency.scale` (x100): `formatMoney(1500)` is
  `"Rs. 150,000"` and `toUnits(6049)` is 60. The engine's own error messages format through it too.
- **One data file**: `data/lanka.ts` holds every name, price, rent, card and label. Logic never hard-codes them.

## Config

`RulesConfig` (`types.ts`), filled and clamped by `normalizeConfig` (numbers clamped to their range, unknown enum values
and wrong types replaced by the default). The defaults are the classic rules.

| Field | Type (range) | Default | Meaning |
|---|---|---|---|
| `board` | `'lanka'` \| `'colombo'` \| `'hill'` \| `'south'` | `'lanka'` | the theme (All Island, Colombo, Hill Country, Down South); the rules and numbers are the same on every board |
| `speedDie` | boolean | false | the Speed Die (2007 rules) |
| `startCash` / `speedBonus` | 0-100000 | 1500 / 1000 | starting cash; extra each with the Speed Die |
| `goSalary` | 0-10000 | 200 | Start salary |
| `incomeFlat` / `incomePct` | 0-10000 / 0-100 | 200 / 10 | Income Tax amounts |
| `luxuryTax` / `jailFine` | 0-10000 | 75 / 50 | |
| `houses` / `hotels` | 0-200 / 0-100 | 32 / 12 | bank supply |
| `mortgagePct` | 0-100 | 10 | mortgage interest (rounded up) |
| `triplesRollAgain` | boolean | true | a triple also grants the doubles re-roll |
| `turnLimit` | 0-100000 | 0 | end after this many turns (0 = off) |
| `doubleGoLanding` | boolean | false | landing exactly on Start pays twice the salary |
| `jackpot` | boolean | false | taxes, fines and card payments to the bank feed `state.pot`, won on the parking space |
| `incomeTaxMode` | `'choice' \| 'flat' \| 'percent'` | `'choice'` | non-choice modes charge at once (no `incomeTax` phase) |
| `auctions` | boolean | true | off: declined and bankrupt-to-bank property stays with the bank; shortages are granted in request order |
| `buyAfterFirstLap` | boolean | false | no buying or bidding while `PlayerState.laps` is 0 |
| `jailRent` | boolean | true | off: a jailed owner collects no rent |
| `threeDoublesJail` | boolean | true | off: the third doubles is just another re-roll |
| `dealProperties` | 0-3 | 0 | properties dealt free to each seat at the start (fewer if the board runs out) |
| `endMode` | `'lastStanding' \| 'firstBankrupt'` | `'lastStanding'` | firstBankrupt: the first bankruptcy ends the game |
| `trading` | `'on' \| 'off' \| 'afterLap'` | `'on'` | afterLap: both parties need `tradeAfterLap` laps |
| `tradeAfterLap` | 1-20 | 1 | |
| `debug` | boolean | false | accept `debugRig` / `debugSetCash` (e2e only) |

State fields the options use: `GameState.pot` (the jackpot, 0 unless `jackpot`) and `PlayerState.laps` (Start
salaries collected, counted whatever the rules).

## Commands

```ts
interface Command { by: SeatId | 'system'; a: Action; basis?: number }
```

- `basis`, when present, must equal `state.seq` or the command is refused with `code: 'stale'`. Bots and chores send
  it (a stale bot move is simply re-decided). **Humans send no basis**: their actions are validated on meaning
  (a bid must still beat the high bid, the property must still be unowned, ...).
- **System commands** (`by: 'system'`) **must** carry a basis (`code: 'basis'` otherwise).
- A seat that is out (bankrupt/resigned) can send nothing (`'out'`); nothing is accepted once the game is over
  (`'over'`).
- Errors: `{ ok: false, error: { code, message } }`. `message` is player-facing English; `code` is stable.

### Actions

| Action | Sent by | Legal when |
|---|---|---|
| `roll` | turn seat | `preRoll` (in jail this is the jail roll) |
| `bus {n}` | turn seat | `bus`; `n` one of `phase.opts` |
| `chooseSpace {space}` | turn seat | `chooseSpace` (a triple); any space but the current one |
| `buy` / `decline` | turn seat | `buy`; `buy` needs cash >= price; `decline` starts an auction (`auctions` off: the bank keeps it) |
| `incomeTax {pick:'flat'\|'percent'}` | turn seat | `incomeTax` (choose before seeing worth; only with `incomeTaxMode: 'choice'`) |
| `payFine` | turn seat | `preRoll`, jailed, `jail.tries < 2`, cash >= fine (never opens a debt) |
| `useCard {card?}` | turn seat | `preRoll`, jailed, holds a Get Out of Jail Free card |
| `endTurn` | turn seat | `postRoll` |
| `bid {amount}` | any eligible seat | `auction`; not passed, not already high; `amount > high` (>= 1), `<= cash` |
| `pass` | any | `auction` (eligible, not passed, not the high bidder) or `buildClaim` (seat is in `open`) |
| `requestBuild {n}` | any | `buildClaim`, seat in `open`; `1 <= n <= buildCapacity()` |
| `place {space}` | the placing seat | `place`; a site from `placeSites()` |
| `build {group, levels}` | owner | `preRoll`/`postRoll`/`buy`; target levels per `GroupDef.spaces`, raises only |
| `sell {group, levels}` | owner | those plus `auction`, `debt`, `incomeTax`, `mortgageXfer`; lowers only |
| `mortgage {space}` | owner | same phases as `sell`; no buildings in the group |
| `sellProperty {space}` | owner | same phases as `mortgage`; no buildings in the group; not while it waits in `mortgageXfer`. The bank pays the mortgage value (nothing when mortgaged; the mortgage is cleared) and the property is the bank's again |
| `unmortgage {space}` | owner | `preRoll`/`postRoll`/`buy`; cash >= `unmortgageCost` |
| `settleMortgages {lift}` | the receiving seat | `mortgageXfer`; `lift` subset of `phase.spaces` |
| `propose {to, give, get}` | any | any phase; one open offer per proposer, 8 in total; the `trading` rule allows it. Offers never expire |
| `accept {id}` | the offer's `to` | `preRoll`/`postRoll`/`buy`/`debt`; re-validated now (trading rule included) |
| `reject {id}` / `cancel {id}` | `to` / `from` | any time |
| `autoRaise` | debtor | `debt`: raise cash deterministically and pay, or go bankrupt |
| `bankrupt` | debtor | `debt` and `maxRaise < owed` |
| `resign` | any active seat | any time |
| `closeAuction` | system | `auction` (its deadline passed) |
| `closeClaim` | system | `buildClaim` with seats still open (its deadline passed) |
| `endGame` | system | any time: ends the game ranked by net worth (owner's "Finish now") |
| `timeUp` | system | any time: the room's time limit ran out; ends the game ranked by net worth (`why: 'timeUp'`) |
| `forced {seat, a}` | system | a timeout: `seat` is awaited and `a` deep-equals `defaultAction(state, seat)` |
| `debugRig {dice}` | anyone | `cfg.debug` only: queue throws `[a,b]` or `[a,b,face]` used by the next rolls |
| `debugSetCash {seat, cash}` | anyone | `cfg.debug` only |

Building is expressed as **target levels for the whole group** (`levels[i]` for `GroupDef.spaces[i]`, 0-4 houses,
5 = hotel). `buildOptions(state, seat)` lists the legal single-step raises and sales per group as ready-made actions,
plus `sellAll` and a `reason` when nothing can be built. Selling a whole group of hotels to 0 is always allowed, even
with no houses in the bank.

`Bundle = { cash, props: number[], cards: string[] }` (immediate assets only). Refused: empty offers, cash for
nothing, nothing for cash, cash for cash (loans), property whose colour group has buildings, assets the side does not
hold, and offers whose receiver could not pay the 10% interest on mortgaged property from cash afterwards.
Property for nothing (a gift) is allowed. `tradeProblems(state, offer)` explains what is wrong.

## Phases

`state.phase` is where the game waits. Turn phases belong to `state.turn.seat`:

| Phase | Waiting for | Next |
|---|---|---|
| `preRoll` | turn seat: roll (or pay fine / use card when jailed) | `busy` -> ... / `bus` / `chooseSpace` / `postRoll` (jail) |
| `bus {opts}` | turn seat: pick a move | `busy` |
| `chooseSpace` | turn seat: pick any other space (triple) | `busy` |
| `buy {space}` | turn seat: buy or decline (never entered on a first lap with `buyAfterFirstLap`) | `busy` / `auction` |
| `incomeTax` | turn seat: flat or percent (only with `incomeTaxMode: 'choice'`) | `busy` |
| `postRoll` | turn seat: end turn | next seat's `preRoll` |
| `busy` | never at rest: the pending steps are running (may appear as a `resume` value) | |
| `over {winner, ranking, why}` | nothing | |

Interrupts store `resume` (the phase to go back to) and can nest. They can start during anybody's phase (a non-turn
player builds and starts a shortage contest; a trade hands over mortgaged property; a resignation sends property to
auction):

| Interrupt | Waiting for | Ends |
|---|---|---|
| `auction {lot, high?, passed, eligible, queue, resume}` | every eligible seat that has not passed (not the high bidder) | everyone but the high bidder passed, or `closeAuction`; then the next `queue` property, or `resume` |
| `place {seat, kind, count, bid?, resume}` | `seat`: place a won/granted unit | units placed, or no legal site left (an auctioned unit is refunded) |
| `buildClaim {kind, by, build?, req, open, auctioning?, resume}` | seats in `open`: `requestBuild` or `pass` | `open` empty -> grant or auction units |
| `mortgageXfer {seat, spaces, resume}` | `seat`: `settleMortgages` | settled |
| `debt {debtor, owed, why, space?, resume}` | `debtor`: raise cash, `autoRaise`, `bankrupt` or `resign` | settles by itself the moment cash covers `owed` (`space`: what the payment is for, kept for the settling `cash` events) |

`state.pending` holds the rest of the turn (move, land, Tuk-Tuk Uncle, pay, free, afterRoll, nextTurn). It is
internal; do not read it for game logic.

### Flow of a roll
1. White dice always; the Speed Die too when `cfg.speedDie`, the roller has unlocked it (first GO salary) and it is
   not a roll out of jail. Doubles are judged on the white dice only.
2. Third doubles -> jail (no move; with `threeDoublesJail` off it is just another re-roll and `turn.doubles` stays 3). A triple (speed number = both white dice) -> `chooseSpace`, and with
   `cfg.triplesRollAgain` it still rolls again; Bus -> `bus`; Tuk-Tuk Uncle -> move, resolve, then advance.
3. Moving forward onto or past GO pays the salary (dice, card, triple or Tuk-Tuk Uncle; never on the way to jail) and
   counts a lap (`laps`); landing exactly on GO pays it twice with `doubleGoLanding`.
4. Landing: unowned property -> `buy` (nothing on a first lap with `buyAfterFirstLap`); owned by another and
   unmortgaged -> rent (automatic; none while the owner is jailed with `jailRent` off); Income Tax -> `incomeTax` (or
   charged at once in a fixed `incomeTaxMode`); the parking space pays out the jackpot (`jackpot`); Luxury Tax, cards,
   Go To Jail resolve at once. A payment that cannot be made opens `debt`.
5. Tuk-Tuk Uncle (after the first landing is fully resolved): the next property the bank owns (buy or auction); if
   the bank owns none, the next unmortgaged property of another player (pay rent); else stay put.
6. Doubles -> `preRoll` again; otherwise `postRoll`. Jail ends the turn and drops the rest (Speed Die moves too).

## Events

`apply()` returns `events: GameEvent[]` in the order things happened (`createGame` too). Each carries post-change
values, so a view can set rather than accumulate.

| `t` | Fields | Meaning |
|---|---|---|
| `order` | `order` | turn order after the opening roll (`dice` events with `purpose:'order'` before it) |
| `turn` | `seat, no` | a turn starts |
| `dice` | `seat, purpose:'order'\|'move'\|'jail'\|'utility', w, s?, doubles, triples, total` | a throw; `total` = white + number face |
| `speedOn` | `seat` | Speed Die unlocked (used from the next roll) |
| `bus` | `seat, opts` | Bus rolled: choose a move |
| `chooseSpace` | `seat` | triple rolled: choose a space |
| `move` | `seat, from, to, path, via` | `path` = every space entered, ending at `to`; `via`: `dice`, `bus`, `triple`, `card`, `uncle`, `back` (walk backwards), `jail` (jump, path `[10]`) |
| `salary` | `seat, amount` | marker: passed/landed on GO (doubled for an exact landing with `doubleGoLanding`); the money is the next `cash` event (`why:'salary'`) |
| `land` | `seat, space` | arrived and the space resolves |
| `cash` | `from, to, amount, why, after, space?` | **every** cash change; `from`/`to` a seat or `'bank'`; `after[seat]` = cash after; `space`: the square paid for (rent, tax, an auctioned lot), also when the payment settles a `debt` later; `why:'jackpot'`: the pot won on the parking space (`space` = it); `why:'sale'`: a property sold to the bank (`space` = it); `why:'sell'`: buildings sold |
| `card` | `seat, deck, cardId, text, kept` | a card drawn (`kept`: Get Out of Jail Free held) |
| `cardReturn` | `deck, cardId, seat?` | a card went to the bottom of its deck (drawn and done, used, or returned at bankruptcy) |
| `cardGive` | `cardId, from, to` | a held card changed hands (trade) |
| `jail` | `seat, reason:'space'\|'card'\|'doubles'` | sent to jail (after a `move` via `jail`) |
| `jailStay` | `seat, tries` | failed jail roll |
| `jailExit` | `seat, how:'doubles'\|'fine'\|'card'\|'forced'` | out of jail |
| `uncle` | `seat, to?, target?:'bank'\|'rent'` | Tuk-Tuk Uncle advance (no `to`: stays put) |
| `owner` | `space, from?, to?, via` | ownership changed; no `to` = back to the bank; `via:'deal'`: the quick-start deal (`createGame`, after `order`, before `turn`); `via:'sold'`: sold to the bank (`sellProperty`); `via:'bankrupt'`: a bankrupt's property back to the bank |
| `level` | `space, from, to, bank:{houses, hotels}` | buildings changed; bank supply after |
| `mortgage` | `space, on` | mortgaged / lifted (also `on:false` when the bank clears it) |
| `auctionStart` | `lot, eligible, queue` | an auction opens |
| `bid` | `seat, amount` | a new high bid |
| `pass` | `seat, auto?` | left the auction (`auto`: could not raise more than the high bid) |
| `auctionEnd` | `lot, winner?, amount?` | closed (no winner: bank keeps it / nobody gets the unit) |
| `claimStart` | `kind, by, open, supply` | shortage contest window opens |
| `claimRequest` | `seat, n` | a request (`n:0` = passed or timed out) |
| `claimEnd` | `kind, outcome:'granted'\|'auction'\|'done'` | requests granted, auction begins, or contest over |
| `placeStart` | `seat, kind, count` | a seat must place building units |
| `xferStart` | `seat, spaces` | a seat must settle received mortgages |
| `tradeProposed` / `tradeDone` | `trade` | |
| `tradeRejected` | `id` | |
| `tradeCancelled` | `id, why:'cancelled'\|'out'\|'over'` | withdrawn by the proposer, a party left the game, or the game ended (offers never expire with the turn) |
| `debt` / `debtPaid` | `debtor, owed, total, why` / `debtor` | |
| `bankrupt` | `seat, to, resigned` | the seat is out (`to`: creditor seat or `'bank'`) |
| `timeout` | `seat, a` | a `forced` command played `a` for `seat` |
| `over` | `winner, ranking, why:'lastStanding'\|'turnLimit'\|'endGame'\|'firstBankrupt'\|'timeUp'` | |

## Timers and timeouts

The engine is clock-free. A network layer keeps one deadline at a time:

```ts
const t = timer(state);          // { key, kind } | null (null only when over)
// kind: 'turn' (preRoll/postRoll), 'decision' (bus, chooseSpace, buy, incomeTax, place, buildClaim,
//       mortgageXfer), 'auction', 'debt'; 'trade' is reserved (offers never block play).
if (t && t.key !== doc.deadline?.key) doc.deadline = { key: t.key, at: env.at + animBudget(events) + phaseSecs(t.kind) };
// ... once serverNow() >= doc.deadline.at:
const cmd = timeoutCommand(state); // already carries basis: state.seq
if (cmd) apply(state, cmd);
```

- `key` changes exactly when the deadline should restart: whenever a phase is entered (including a re-entered one,
  such as `preRoll` after doubles, and each new auction lot). It does **not** change on an auction bid (the auction's
  countdown is fixed from when the lot is put up), nor when someone else mortgages, trades, passes or leaves the game
  meanwhile (a leaver's high bid is wiped and the countdown runs on), unless their leaving surfaces another phase.
  Compute the deadline inside the same transaction as the command.
- `timeoutCommand(state)`:
  - `auction` -> `{ by:'system', a:{ k:'closeAuction' }, basis }` (high bidder wins; no bids: bank keeps it);
  - `buildClaim` -> `{ by:'system', a:{ k:'closeClaim' }, basis }` (every open seat passes);
  - otherwise -> `{ by:'system', a:{ k:'forced', seat, a: defaultAction(state, seat) }, basis }` for the awaited seat.
- `forced` is accepted only when `seat` is awaited **and** `a` deep-equals `defaultAction(state, seat)`, so a client
  sending chores can never make another player's real decisions. It emits a `timeout` event (count these for AFK).
- Because the timeout carries `basis`, a late or duplicate one (two drivers racing) is refused as `stale`.
- `defaultAction(state, seat)` (also a safe bot fallback): `roll`; the largest Bus move; for a triple the next
  bank-owned property ahead, else GO; `decline` (the property is auctioned); the cheaper Income Tax; `pass`; the first
  legal `place` site; `settleMortgages {lift: []}`; `autoRaise`; `endTurn`. Null for a seat that is not awaited.
- `awaiting(state)`: seats whose input blocks progress (the turn seat, every seat that may still bid, the open
  contest seats, the placing / settling seat, the debtor). Never empty unless the game is over.

## Public API (`index.ts`)

Core:
- `createGame(cfg, seats, seed)` -> `{ state, events }`: new game; `cfg` is normalized; 2-8 unique `SeatId`s
  (throws otherwise); names trimmed to 24 chars. Seats tied on the opening roll re-roll; play follows lobby order
  from the winner.
- `apply(state, cmd, opts?)` -> `{ ok:true, state, events } | { ok:false, error }`.
- `legalActions(state, seat)` -> `Action[]`: every concrete action the seat may take now (bids as the minimum bid,
  build/sell as single steps plus "sell the whole group"; trade proposals are open-ended and not listed). It always
  includes `resign` for an active seat, so filter it out of quick-action UIs and bot choices.
- `awaiting(state)`, `defaultAction(state, seat)`, `timer(state)`, `timeoutCommand(state)`: see above.
- `checkInvariants(state)` -> `string[]`: broken invariants (empty = fine).
- `encode(state)` -> `string`, `decode(text)` -> `GameState` (throws on garbage or another `RULES_VERSION`, except the
  `UPGRADABLE_VERSIONS`, same-shaped states it carries on under the current rules; fills missing containers),
  `RULES_VERSION`, `UPGRADABLE_VERSIONS`.
- `DEFAULT_RULES`, `normalizeConfig(raw)`: complete, clamped `RulesConfig` from anything.
- `SEAT_IDS`, `MIN_SEATS`, `MAX_SEATS`, `NAME_MAX`, type `SeatSetup`.

Board data:
- `getBoard(id)` -> `BoardDef` (unknown ids fall back to the All Island board); `boardOf(state)`; `LANKA`, `COLOMBO`,
  `HILL`, `SOUTH`; `BOARD_IDS`; `BOARDS` (`{id, name, blurb}` for the board picker); `boardName(id)`.
- `isProperty(space)`, `isStreet(space)` (type guards on a `SpaceDef`), `deckOf(board, cardId)`,
  `pathForward(board, from, to)`, `pathBack(board, from, n)`, `cardOf(state, cardId)`.
- `board.display.title`, `.name` ("Colombo"), `.subtitle` (under the title on the board), `.blurb` (the picker's line),
  `board.display.decks[deck]` (the decks' printed names), `board.display.groupColours[group]`,
  `board.speedDie.faces` / `.labels[String(face)]`.

Dice helpers: `isDoubles(roll)`, `isTriples(roll)`, `busOptions(roll)`, `faceValue(face)`, `rollTotal(roll)`.

Selectors (all take the state first):
- `rentFor(state, space, opts?)` rent a visitor would pay now (`opts.dice` for utilities, default the current roll;
  `railMul`, `utilityMul` for the cards).
- `worth(state, seat)` rulebook worth (cash + printed prices, mortgaged too + building cost); `netWorth(state, seat)`
  for rankings (a mortgaged property counts price minus its lift cost); `maxRaise(state, seat)` cash + every building
  sold + every property mortgaged; `incomeTaxAmounts(state, seat)` -> `{ flat, percent }`.
- `groupOf(state, space)`, `ownsGroup(state, seat, group)`, `ownerOf(state, space)`, `propertyState(state, space)`.
- `isActive(state, seat)`, `activeSeats(state)` (turn order), `opponents(state, seat)`, `ranking(state)`.
- `buildOptions(state, seat)` -> `BuildOption[]` per owned colour group: levels, legal single-step `build` / `sell`
  actions, `sellAll`, and `reason` when nothing can be built.
- `canMortgage(state, seat, space)`, `canUnmortgage(state, seat, space)`, `canSellProperty(state, seat, space)` ->
  `RuleError | null` (phase included); `sellPropertyValue(state, space)`: what the bank pays for it now (the mortgage
  value, 0 when mortgaged).
- `unmortgageCost(state, space)` (mortgage + 10% rounded up), `xferCost(state, spaces, lift)`.
- `tradeProblems(state, offer)` -> `RuleError[]` (the trading rule first: codes `tradingOff` "Trading is off in this
  game", `tradingLater` "Trading opens after lap N"); `tradingClosed(state, a, b)` -> that rule alone (`RuleError | null`).
- `mayBuy(state, seat)`: false only on a first lap with `buyAfterFirstLap`.
- `minBid(state)`, `placeSites(state, seat, kind)`, `buildCapacity(state, seat, kind)`.
- `deepEqual(a, b)` for plain JSON values.

Dev only (not exported from `index.ts`): `randomPlayer.ts` (`randFrom`, `randomCommand`) drives the fuzz test and
`npm run sim`.

## Rule decisions made in the engine

`docs/rules.md` lists the rulebook decisions; these are the engine-level ones on top:

- **Auction**: a fixed countdown from when the lot is put up (`timer()` keeps its key through bids); it still ends
  early once everyone but the high bidder has passed. The high bidder can neither pass nor raise its own bid, and is
  not counted in `awaiting`. Seats whose
  `maxRaise` cannot beat the high bid are passed automatically (`pass {auto:true}`); a seat with cash below the next
  bid but enough to raise is not. Mortgaging, selling buildings and selling property to the bank are allowed during an auction; building and
  lifting are not.
  A winner whose cash fell below the bid meanwhile (only via a nested settlement) owes it as a debt.
- **Shortage contest trigger**: a build of kind K starts a contest when another seat could build K now and
  `bank supply - this build's need < sum of the others' capacity`. Capacity = units they could put up now, limited by
  cash, cheapest groups first (houses: up to 4 per street; hotels: streets whose whole group has 4 houses). The window
  freezes building, selling and mortgaging. Granted units are placed one `place` action at a time at the normal price;
  auctioned units (from a bid of 1) are paid by the bid and placed free; a unit nobody bids on ends the contest; an auctioned
  unit that cannot be placed is refunded. Once the remaining requests fit the supply they are granted.
- **Triples**: choosing Go To Jail sends the player straight to jail (no walk, no salary). The timeout picks the
  next bank-owned property ahead, else GO.
- **Jail**: a Get Out of Jail Free card may be used before rolling on any of the three turns; the fine forced after
  the third failed roll cannot be replaced by a card. A voluntary `payFine` needs the cash (no debt).
- **Tuk-Tuk Uncle** "rent" branch: the next property owned by another active player and not mortgaged; on a utility
  the rent uses the white dice (Tuk-Tuk Uncle counts 0). It runs only when the bank owns no property at all: if the
  bank's only property is the one the player stands on (declined, no bids), the player stays put (`uncle` with no `to`).
- **Trades**: accept in `preRoll`, `postRoll`, `buy` or `debt`; at most one open offer per proposer and 8 in total;
  offers never expire (they go when accepted, rejected, cancelled, when a party is out, or at the game's end) and are
  re-validated at accept time; the receiver of mortgaged property must be able to pay the 10% from cash after the
  trade; a gift of property is allowed.
- **Selling property to the bank** (`sellProperty`): in the phases mortgaging is open, with no buildings in the colour
  group; the bank pays the mortgage value, or nothing for a mortgaged property (the loan already taken is kept) and
  clears its mortgage. The property is unowned again (level 0, unmortgaged): anyone may buy it on landing there, and
  Tuk-Tuk Uncle counts it as the bank's. It brings exactly what mortgaging would, so `maxRaise` is unchanged.
- **Bankruptcy**: owing a player (alone or with others), everything is sold to the bank: buildings at half price,
  every property at its mortgage value (nothing when mortgaged) and back to the bank unowned and unmortgaged (no
  auction), Get Out of Jail Free cards back to their decks. The creditors are paid from that cash in seat order from
  the debtor's left (players), then the bank, each at most its share (the payments carry the debt's `why`); what is
  left goes to the bank (`why:'bankrupt'`). No property or card passes to a creditor, so there is no `mortgageXfer`
  after a bankruptcy. The `bankrupt` event names the creditor when there is one, else `'bank'`. Owing only the bank,
  everything goes to the bank, which auctions the property (keeps it with `auctions` off). Out players' shares of open
  debts go to the bank. A resignation in debt pays the creditors in full when `maxRaise` covers it (the rest goes to
  the bank), otherwise it is a bankruptcy to the creditor.
- **autoRaise** plan: sell one building level at a time from the highest-standing street (ties: higher board index),
  whole groups when a hotel cannot be broken up; then mortgage the cheapest mortgage value first (ties: lower index);
  goes bankrupt straight away when `maxRaise` cannot cover the debt.
- **Turn limit** counts every player's turn (`turn.no`); the game ends when turn `turnLimit` ends. Rankings (turn
  limit, `endGame`) order active seats by `netWorth` (ties: turn order), then the others, last out first.
- **Money rounding**: income tax percent rounds down; mortgage interest rounds up; building refunds are half each
  step's cost rounded down; a hotel's cost defaults to the house cost (`StreetDef.hotel` overrides).
- **Income Tax** default (timeout) is the cheaper option (the mode's amount in a fixed `incomeTaxMode`).
- **Jackpot**: fed by every `cash` event to the bank with `why` tax, fine or card, whenever it is paid (a debt that
  settles later, a bankrupt's partial payment to the bank); rent, purchases, interest and bankruptcy leftovers do not
  feed it. Landing on the parking space pays the whole pot (`why:'jackpot'`) and empties it.
- **Auctions off**: `decline` leaves the property with the bank (Tuk-Tuk Uncle still counts it as bank-owned);
  property of a bankruptcy to the bank is simply returned; a shortage contest whose requests exceed the supply grants
  them in request order (the starter's first, then each `requestBuild` as it came) until the supply runs out.
- **First lap** (`buyAfterFirstLap`): `laps` counts every Start salary. With 0 laps a landing on a bank property
  (Tuk-Tuk Uncle's included) does nothing, `buy` is refused, and the seat is left out of property auctions.
- **Rent while jailed** off: `rentFor` is 0 while the owner is jailed, and Tuk-Tuk Uncle's rent branch skips it.
- **Quick-start deal**: the property spaces are shuffled with the game's RNG after the opening roll and dealt
  round-robin in turn order, `min(dealProperties, floor(properties / seats))` each, free and unmortgaged.
- **First bankruptcy** (`endMode: 'firstBankrupt'`): the game ends right after the creditor has the cash (no bank
  auctions), ranked by net worth; a plain resignation (no unpayable debt) does
  not end it, and when only one player is left the reason is still `lastStanding`.
- **Trading** `afterLap`: both parties need `laps >= tradeAfterLap` to propose or accept; reject and cancel always work.

## Tests and sim

`npx vitest run src/rules`: suites per rule area (`data`, `rng`, `config`, `move`, `cards`, `rent`, `tax`,
`auction`, `jail`, `build`, `mortgage`, `trade`, `bankrupt`, `speed`, `autoplay`, `codec`, `options` for the optional
rules) plus the fuzz test
(`fuzz.test.ts` classic, `fuzzSpeed.test.ts` Speed Die: 30 seeds x 3000 random commands each, checking invariants,
the cash ledger and the jackpot pot, RNG use, state size < 48 KB, codec round trips, `awaiting`, and that `defaultAction` is legal).

Two fuzz games in three vary the optional rules by seed (`variedRules` in `randomPlayer.ts`).

`npm run sim -- [games=100] [--players=4] [--speed] [--seed=1] [--turns=400] [--options]` plays random-legal-action
games headless with invariants on and prints how they ended (`--options`: vary the optional rules game by game).
