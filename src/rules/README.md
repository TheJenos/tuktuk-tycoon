# Rules engine (`src/rules`)

The pure property-trading rules: Classic rules plus the optional Speed Die (2007 rulebook, see `docs/rules.md`), on
Tuk-Tuk Tycoon's board (`data/lanka.ts`). No React, three, R3F or Firebase imports; nothing but its own files. Every client runs the same reducer on the same JSON state,
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
  roll), `roll` and the Nearest Utility card's fresh throw consume it, so nobody can change future dice by slipping in
  a free action first. The seed and deck order are readable by anyone holding the state (a known, accepted limit).
- **JSON-safe state**: no `null`, `undefined`, `NaN` or class instances anywhere; whole rupees; optional fields are
  absent rather than undefined. `encode()` is `JSON.stringify`.
- **One data file**: `data/lanka.ts` holds every name, price, rent, card and label. Logic never hard-codes them.

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
| `buy` / `decline` | turn seat | `buy`; `buy` needs cash >= price; `decline` starts an auction |
| `incomeTax {pick:'flat'\|'percent'}` | turn seat | `incomeTax` (choose before seeing worth) |
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
| `unmortgage {space}` | owner | `preRoll`/`postRoll`/`buy`; cash >= `unmortgageCost` |
| `settleMortgages {lift}` | the receiving seat | `mortgageXfer`; `lift` subset of `phase.spaces` |
| `propose {to, give, get}` | any | any phase; one open offer per proposer, 8 in total |
| `accept {id}` | the offer's `to` | `preRoll`/`postRoll`/`buy`/`debt`; re-validated now |
| `reject {id}` / `cancel {id}` | `to` / `from` | any time |
| `autoRaise` | debtor | `debt`: raise cash deterministically and pay, or go bankrupt |
| `bankrupt` | debtor | `debt` and `maxRaise < owed` |
| `resign` | any active seat | any time |
| `closeAuction` | system | `auction` (its deadline passed) |
| `closeClaim` | system | `buildClaim` with seats still open (its deadline passed) |
| `endGame` | system | any time: ends the game ranked by net worth (owner's "Finish now") |
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
| `buy {space}` | turn seat: buy or decline | `busy` / `auction` |
| `incomeTax` | turn seat: flat or percent | `busy` |
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
2. Third doubles -> jail (no move). A triple (speed number = both white dice) -> `chooseSpace`, and with
   `cfg.triplesRollAgain` it still rolls again; Bus -> `bus`; Tuk-Tuk Uncle -> move, resolve, then advance.
3. Moving forward onto or past GO pays the salary (dice, card, triple or Tuk-Tuk Uncle; never on the way to jail).
4. Landing: unowned property -> `buy`; owned by another and unmortgaged -> rent (automatic); Income Tax ->
   `incomeTax`; Luxury Tax, cards, Go To Jail resolve at once. A payment that cannot be made opens `debt`.
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
| `salary` | `seat, amount` | marker: passed/landed on GO; the money is the next `cash` event (`why:'salary'`) |
| `land` | `seat, space` | arrived and the space resolves |
| `cash` | `from, to, amount, why, after, space?` | **every** cash change; `from`/`to` a seat or `'bank'`; `after[seat]` = cash after; `space`: the square paid for (rent, tax, an auctioned lot), also when the payment settles a `debt` later |
| `card` | `seat, deck, cardId, text, kept` | a card drawn (`kept`: Get Out of Jail Free held) |
| `cardReturn` | `deck, cardId, seat?` | a card went to the bottom of its deck (drawn and done, used, or returned at bankruptcy) |
| `cardGive` | `cardId, from, to` | a held card changed hands (trade, bankruptcy) |
| `jail` | `seat, reason:'space'\|'card'\|'doubles'` | sent to jail (after a `move` via `jail`) |
| `jailStay` | `seat, tries` | failed jail roll |
| `jailExit` | `seat, how:'doubles'\|'fine'\|'card'\|'forced'` | out of jail |
| `uncle` | `seat, to?, target?:'bank'\|'rent'` | Tuk-Tuk Uncle advance (no `to`: stays put) |
| `owner` | `space, from?, to?, via` | ownership changed; no `to` = back to the bank |
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
| `tradeCancelled` | `id, why:'cancelled'\|'turnEnd'\|'out'` | |
| `debt` / `debtPaid` | `debtor, owed, total, why` / `debtor` | |
| `bankrupt` | `seat, to, resigned` | the seat is out (`to`: creditor seat or `'bank'`) |
| `timeout` | `seat, a` | a `forced` command played `a` for `seat` |
| `over` | `winner, ranking, why:'lastStanding'\|'turnLimit'\|'endGame'` | |

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
  such as `preRoll` after doubles) and on **every auction bid**. It does **not** change when someone else mortgages,
  trades, passes or leaves the game meanwhile (unless the leaver held the high bid, which is wiped, or their leaving
  surfaces another phase). Compute the deadline inside the same transaction as the command.
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
- `encode(state)` -> `string`, `decode(text)` -> `GameState` (throws on garbage or another `RULES_VERSION`; fills
  missing containers), `RULES_VERSION`.
- `DEFAULT_RULES`, `normalizeConfig(raw)`: complete, clamped `RulesConfig` from anything.
- `SEAT_IDS`, `MIN_SEATS`, `MAX_SEATS`, `NAME_MAX`, type `SeatSetup`.

Board data:
- `getBoard(id)` -> `BoardDef` (unknown ids fall back to the classic board); `boardOf(state)`; `LANKA`.
- `isProperty(space)`, `isStreet(space)` (type guards on a `SpaceDef`), `deckOf(board, cardId)`,
  `pathForward(board, from, to)`, `pathBack(board, from, n)`, `cardOf(state, cardId)`.
- `board.display.title`, `board.display.decks[deck]` (the decks' printed names), `board.display.groupColours[group]`,
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
- `canMortgage(state, seat, space)`, `canUnmortgage(state, seat, space)` -> `RuleError | null` (phase included).
- `unmortgageCost(state, space)` (mortgage + 10% rounded up), `xferCost(state, spaces, lift)`.
- `tradeProblems(state, offer)` -> `RuleError[]`.
- `minBid(state)`, `placeSites(state, seat, kind)`, `buildCapacity(state, seat, kind)`.
- `deepEqual(a, b)` for plain JSON values.

Dev only (not exported from `index.ts`): `randomPlayer.ts` (`randFrom`, `randomCommand`) drives the fuzz test and
`npm run sim`.

## Rule decisions made in the engine

`docs/rules.md` lists the rulebook decisions; these are the engine-level ones on top:

- **Auction**: the high bidder can neither pass nor raise its own bid, and is not counted in `awaiting`. Seats whose
  `maxRaise` cannot beat the high bid are passed automatically (`pass {auto:true}`); a seat with cash below the next
  bid but enough to raise is not. Mortgaging and selling are allowed during an auction; building and lifting are not.
  A winner whose cash fell below the bid meanwhile (only via a nested settlement) owes it as a debt.
- **Shortage contest trigger**: a build of kind K starts a contest when another seat could build K now and
  `bank supply - this build's need < sum of the others' capacity`. Capacity = units they could put up now, limited by
  cash, cheapest groups first (houses: up to 4 per street; hotels: streets whose whole group has 4 houses). The window
  freezes building, selling and mortgaging. Granted units are placed one `place` action at a time at the normal price;
  auctioned units (from Rs. 1) are paid by the bid and placed free; a unit nobody bids on ends the contest; an auctioned
  unit that cannot be placed is refunded. Once the remaining requests fit the supply they are granted.
- **Triples**: choosing Go To Jail sends the player straight to jail (no walk, no salary). The timeout picks the
  next bank-owned property ahead, else GO.
- **Jail**: a Get Out of Jail Free card may be used before rolling on any of the three turns; the fine forced after
  the third failed roll cannot be replaced by a card. A voluntary `payFine` needs the cash (no debt).
- **Tuk-Tuk Uncle** "rent" branch: the next property owned by another active player and not mortgaged; on a utility
  the rent uses the white dice (Tuk-Tuk Uncle counts 0). It runs only when the bank owns no property at all: if the
  bank's only property is the one the player stands on (declined, no bids), the player stays put (`uncle` with no `to`).
- **Trades**: accept in `preRoll`, `postRoll`, `buy` or `debt`; at most one open offer per proposer and 8 in total;
  all offers are cleared whenever the turn passes; the receiver of mortgaged property must be able to pay the 10%
  from cash after the trade; a gift of property is allowed.
- **Bankruptcy**: several creditors are paid in seat order from the debtor's left (players), then the bank. A creditor who cannot pay the
  10% on mortgaged property it received owes it to the bank (a normal debt). Out players' shares of open debts go to
  the bank. A resignation in debt pays the creditors in full when `maxRaise` covers it (the rest goes to the bank),
  otherwise it is a bankruptcy to the creditor.
- **autoRaise** plan: sell one building level at a time from the highest-standing street (ties: higher board index),
  whole groups when a hotel cannot be broken up; then mortgage the cheapest mortgage value first (ties: lower index);
  goes bankrupt straight away when `maxRaise` cannot cover the debt.
- **Turn limit** counts every player's turn (`turn.no`); the game ends when turn `turnLimit` ends. Rankings (turn
  limit, `endGame`) order active seats by `netWorth` (ties: turn order), then the others, last out first.
- **Money rounding**: income tax percent rounds down; mortgage interest rounds up; building refunds are half each
  step's cost rounded down; a hotel's cost defaults to the house cost (`StreetDef.hotel` overrides).
- **Income Tax** default (timeout) is the cheaper option.

## Tests and sim

`npx vitest run src/rules`: suites per rule area (`data`, `rng`, `config`, `move`, `cards`, `rent`, `tax`,
`auction`, `jail`, `build`, `mortgage`, `trade`, `bankrupt`, `speed`, `autoplay`, `codec`) plus the fuzz test
(`fuzz.test.ts` classic, `fuzzSpeed.test.ts` Speed Die: 30 seeds x 3000 random commands each, checking invariants,
the cash ledger, RNG use, state size < 48 KB, codec round trips, `awaiting`, and that `defaultAction` is legal).

`npm run sim -- [games=100] [--players=4] [--speed] [--seed=1] [--turns=400]` plays random-legal-action games
headless with invariants on and prints how they ended.
