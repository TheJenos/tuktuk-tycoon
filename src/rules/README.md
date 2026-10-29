# Rules engine (`src/rules`)

The pure property-trading rules: Classic rules plus the optional Speed Die (2007 rulebook, see `docs/rules.md`), on
Tuk-Tuk Tycoon's boards (each board's data is `src/boards/<board>/rules.ts`, registered in `board.ts`: All Island,
the default, and Colombo, Hill Country and Down South, each its own size), and Hero League, a board whose `heroes`
block switches on the superhero edition's rules (see [Hero League](#hero-league) and `docs/heroes.md`). No React,
three, R3F or Firebase imports; nothing but its own files. Every client runs the same reducer on the same JSON state,
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
- **Randomness lives in the state** (`state.rng`, a mulberry32 uint32). Only throws consume it: `createGame` (deck
  shuffles, opening roll, the quick-start deal), `roll`, the Nearest Utility card's fresh throw, and on Hero League the
  Hero die (a card's throws, a back-up throw) and Thunder Call re-rolls, each with its `dice` or `heroDie` event. So
  nobody can change future dice by slipping in a free action first; a Hero League answer that lets the next throw
  happen (a pass, a closed window) throws in a fixed order. The seed and deck order are readable by anyone holding the
  state (a known, accepted limit).
- **JSON-safe state**: no `null`, `undefined`, `NaN` or class instances anywhere; whole money units; optional fields are
  absent rather than undefined. `encode()` is `JSON.stringify`.
- **Money is in rulebook units** (start 1500, prices 60..400): state, actions, events, configs and bots all use
  them. Players see and type the board's currency (`board.display.currency`, `currencyOf(board)`): rupees at x100 on
  the classic boards (`formatMoney(1500)` is `"Rs. 150,000"`, `toUnits(6049)` is 60), "Power" at x1 after the number
  on Hero League (`boardMoney(HEROES, 1500)` is `"1,500 Power"`). The engine's own error messages print the board's
  currency.
- **One data file per board**: `src/boards/<board>/rules.ts` holds every name, price, rent, card and label. Logic
  never hard-codes them.

## Config

`RulesConfig` (`types.ts`), filled and clamped by `normalizeConfig` (numbers clamped to their range, unknown enum values
and wrong types replaced by the default). The defaults are the classic rules.

| Field | Type (range) | Default | Meaning |
|---|---|---|---|
| `board` | `'lanka'` \| `'colombo'` \| `'hill'` \| `'south'` \| `'heroes'` | `'lanka'` | the board (All Island, Colombo, Hill Country, Down South, Hero League); the rules are the same on the four classic boards; Hero League plays its own and pins `HEROES_FIXED` (below) |
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

On a heroes board `normalizeConfig` forces `HEROES_FIXED` whatever was asked (and `decode` re-applies it): `speedDie`
off, `houses` / `hotels` 0, `auctions`, `auctionAll` and `fixedAuctionCountdown` off, `jailRent` off, `buyAfterFirstLap` off, `dealProperties`
0, `endMode` `'lastStanding'`, `jackpot` off, `trading` `'off'`. The others stay adjustable (`startCash`, `goSalary`,
`jailFine`, `doubleGoLanding`, `threeDoublesJail`, `turnLimit`); the tax and mortgage fields have nothing to act on.

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
| `pass {at?}` | any | `auction` (eligible, not passed, not the high bidder) or `buildClaim` (seat is in `open`); Hero League: `react` (seat in `open`), `aim` before the reveal and `boost` (the phase's seat), with `at` = the window's `state.since` |
| `requestBuild {n}` | any | `buildClaim`, seat in `open`; `1 <= n <= buildCapacity()` |
| `place {space}` | the placing seat | `place`; a site from `placeSites()` |
| `build {group, levels}` | owner | `preRoll`/`postRoll`/`buy`; target levels per `GroupDef.spaces`, raises only |
| `sell {group, levels}` | owner | those plus `auction`, `debt`, `incomeTax`, `mortgageXfer`; lowers only |
| `mortgage {space}` | owner | same phases as `sell`; no buildings in the group |
| `sellProperty {space}` | owner | same phases as `mortgage`; no buildings in the group; not while it waits in `mortgageXfer`. The bank pays `saleValue`: 80% of the price, less the mortgage value when mortgaged (the mortgage is cleared), and the property is the bank's again |
| `unmortgage {space}` | owner | `preRoll`/`postRoll`/`buy`; cash >= `unmortgageCost` |
| `settleMortgages {lift}` | the receiving seat | `mortgageXfer`; `lift` subset of `phase.spaces` |
| `propose {to, give, get}` | any | any phase; one open offer per proposer, 8 in total; the `trading` rule allows it. Offers never expire |
| `accept {id}` | the offer's `to` | `preRoll`/`postRoll`/`buy`/`debt`; re-validated now (trading rule included) |
| `reject {id}` / `cancel {id}` | `to` / `from` | any time |
| `autoRaise` | debtor | `debt`: raise cash deterministically and pay, or go bankrupt |
| `bankrupt` | debtor | `debt` and `maxRaise < owed` |
| `resign` | any active seat | any time |
| `reroll {at}` | a seat in `open` | Hero League: `react` of kind `thunder`; Thunder Call usable (own or Steel Ace's copy) |
| `shield {at}` | the window's seat | Hero League: `react` of kind `shield`; Star Shield usable |
| `sting {n, at}` | the boost seat | Hero League: `boost`; `1 <= n <= stingMax`; Viper Strike usable |
| `smash {a, b}` | turn seat | Hero League: `preRoll` before the turn's first roll; Titan Smash usable; a pair from `smashPairs()` |
| `aim {at}` | the aim seat | Hero League: `aim` before the reveal; Dead Aim usable |
| `pickCard {card, at}` | the aim seat | Hero League: `aim` after the reveal; `card` one of `phase.cards` |
| `closeAuction` | system | `auction` (its deadline passed) |
| `closeClaim` | system | `buildClaim` with seats still open (its deadline passed) |
| `closeReact` | system | `react` (its deadline passed): every seat still open passes |
| `endGame` | system | any time: ends the game ranked by net worth (owner's "Finish now") |
| `timeUp` | system | any time: the room's time limit ran out; ends the game ranked by net worth (`why: 'timeUp'`) |
| `forced {seat, a}` | system | a timeout: `seat` is awaited and `a` deep-equals `defaultAction(state, seat)` |
| `debugRig {dice, hero?}` | anyone | `cfg.debug` only: queue throws `[a,b]` or `[a,b,face]` used by the next rolls; `hero`: Hero-die faces 1-6 for the next Hero-die throws (heroes boards; both queues count to 100) |
| `debugSetCash {seat, cash}` | anyone | `cfg.debug` only |

On a heroes board `build`, `sell`, `mortgage`, `unmortgage` and `sellProperty` are refused (`code: 'heroes'`) in every
phase, and a window answer whose `at` is not the current `state.since` is refused `stale` (so a late click never
answers the next window).

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
| `debt {debtor, owed, why, space?, resume}` | `debtor`: raise cash, `autoRaise`, `bankrupt` or `resign` | settles by itself the moment cash covers `owed` (`space`: what the payment is for, kept for the settling `cash` events); never on Hero League |
| `react {kind, seat, open, about, then, resume}` | Hero League: the active seats in `open` (`reroll` / `shield` or `pass`) | nobody active is open (passes, a `closeReact`): `then` runs; a `shield` drops it; a `reroll` re-enters it with `open` recomputed |
| `aim {seat, deck, cards?, resume}` | Hero League: `seat` (Dead Aim: `aim` or `pass`, then `pickCard`) | answered |
| `boost {seat, total, then, resume}` | Hero League: `seat` (Viper Strike: `sting` or `pass`) | answered |

`state.pending` holds the rest of the turn (move, land, Tuk-Tuk Uncle, pay, free, afterRoll, nextTurn; on Hero League
also throwDone, throwHero, heroFace, hit, backupPick, swap, beforeRoll). It is internal; do not read it for game
logic. The Hero League windows always sit on `busy` (`resume: {k:'busy'}`) and hold back one step (`then`).

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

On Hero League the throw first opens a Thunder window when anyone can re-roll it; doubles, the third-doubles capture,
Viper Strike (`boost`) and the move then follow from the final throw. Landing on an unowned location saves it at once
(or a back-up hero does); on Villain Strike Dead Aim may come first (`aim`). Jailing the turn seat drops only its own
continuation: other heroes' queued hits still run, and the turn ends when the queue runs dry.

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
| `move` | `seat, from, to, path, via` | `path` = every space entered, ending at `to`; `via`: `dice`, `bus`, `triple`, `card`, `uncle`, `back` (walk backwards), `jail` (jump, path `[jailIndex]`), `swap` (a Titan Smash jump, path `[to]`); `power` is reserved |
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
| `owner` | `space, from?, to?, via` | ownership changed; no `to` = back to the bank; `via:'deal'`: the quick-start deal (`createGame`, after `order`, before `turn`); `via:'sold'`: sold to the bank (`sellProperty`); `via:'bankrupt'`: a bankrupt's (or a resigner's) property back to the bank; Hero League: `'backup'` a back-up hero's save, `'free'` a free save, `'villain'` lost to a card (no `to`) |
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
| `over` | `winner, ranking, why:'lastStanding'\|'turnLimit'\|'endGame'\|'firstBankrupt'\|'timeUp'\|'allSaved'` | `allSaved`: Hero League, every location saved (`OverPhase.scores` holds the scores) |
| `heroDie` | `seat, face, hero, purpose:'backup'\|'card', card?` | Hero League: a Hero-die throw (face 1-6 = `heroes.list[face - 1]`); a re-roll is a new one |
| `power` | `seat, power, copied?, target?` | a superpower used (`copied`: Steel Ace's Suit Up; `target`: whose throw a Thunder Call re-rolls) |
| `powerReady` | `seat` | the superpower is ready again (a Rally Point salary in a later turn, or a Recharge card) |
| `aimPeek` | `seat, deck, cards` | Dead Aim revealed the top cards (show them to that seat's players only) |
| `noSave` | `seat, space` | nobody could save the location `seat` landed on |
| `short` | `seat, why, space?, owed, paid` | a payment fell short: `paid` of `owed` (by creditor), the rest forgiven |
| `reactTimeout` | `seats` | `closeReact` with these seats still open |

## Timers and timeouts

The engine is clock-free. A network layer keeps one deadline at a time:

```ts
const t = timer(state);          // { key, kind } | null (null only when over)
// kind: 'turn' (preRoll/postRoll), 'decision' (bus, chooseSpace, buy, incomeTax, place, buildClaim,
//       mortgageXfer, aim, boost), 'auction', 'debt', 'reaction' (react); 'trade' is reserved (offers never block play).
if (t && t.key !== doc.deadline?.key) doc.deadline = { key: t.key, at: env.at + animBudget(events) + phaseSecs(t.kind) };
// ... once serverNow() >= doc.deadline.at:
const cmd = timeoutCommand(state); // already carries basis: state.seq
if (cmd) apply(state, cmd);
```

- `key` changes exactly when the deadline should restart: whenever a phase is entered (including a re-entered one,
  such as `preRoll` after doubles, each new auction lot, and each auction bid, a leaver's wiped high bid included). It
  does **not** change when someone else mortgages, trades, passes or leaves the game meanwhile, unless their leaving
  surfaces another phase. With `cfg.fixedAuctionCountdown` it does not change on a bid either (the countdown is fixed
  from when the lot is put up; a leaver's high bid is wiped and the countdown runs on).
  Compute the deadline inside the same transaction as the command.
- `timeoutCommand(state)`:
  - `auction` -> `{ by:'system', a:{ k:'closeAuction' }, basis }` (high bidder wins; no bids: bank keeps it);
  - `buildClaim` -> `{ by:'system', a:{ k:'closeClaim' }, basis }` (every open seat passes);
  - `react` -> `{ by:'system', a:{ k:'closeReact' }, basis }` (every open seat passes: `reactTimeout`);
  - otherwise -> `{ by:'system', a:{ k:'forced', seat, a: defaultAction(state, seat) }, basis }` for the awaited seat.
- `forced` is accepted only when `seat` is awaited **and** `a` deep-equals `defaultAction(state, seat)`, so a client
  sending chores can never make another player's real decisions. It emits a `timeout` event (count these for AFK).
- Because the timeout carries `basis`, a late or duplicate one (two drivers racing) is refused as `stale`.
- `defaultAction(state, seat)` (also a safe bot fallback): `roll`; the largest Bus move; for a triple the next
  bank-owned property ahead, else GO; `decline` (the property is auctioned); the cheaper Income Tax; `pass`; the first
  legal `place` site; `settleMortgages {lift: []}`; `autoRaise`; `endTurn`; Hero League: `pass {at}` in `react`,
  `boost` and `aim` (after the reveal `pickCard` of the first card). Null for a seat that is not awaited.
- `awaiting(state)`: seats whose input blocks progress (the turn seat, every seat that may still bid, the open
  contest seats, the placing / settling seat, the debtor, the open reactors, the aiming / boosting seat). Never empty
  unless the game is over.

## Public API (`index.ts`)

Core:
- `createGame(cfg, seats, seed)` -> `{ state, events }`: new game; `cfg` is normalized; 2-8 unique `SeatId`s, at most
  the board's `maxPlayers` (throws otherwise); names trimmed to 24 chars. Seats tied on the opening roll re-roll; play
  follows lobby order from the winner. On a heroes board each seat gets a hero: first every valid, free
  `SeatSetup.hero` in seat order, then the rest in list order (no RNG, never an error).
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
  `HILL`, `SOUTH`, `HEROES`; `BOARD_IDS`; `BOARDS` (`{id, name, blurb}` for the board picker); `boardName(id)`;
  `HEROES_FIXED` (Hero League's pinned config).
- `isProperty(space)`, `isStreet(space)` (type guards on a `SpaceDef`), `deckOf(board, cardId)`,
  `pathForward(board, from, to)`, `pathBack(board, from, n)`, `cardOf(state, cardId)`.
- `board.display.title`, `.name` ("Colombo"), `.subtitle` (under the title on the board), `.blurb` (the picker's line),
  `board.display.decks[deck]` (the decks' printed names), `board.display.groupColours[group]`, `.currency`
  (`{symbol, scale, after?}`), Hero League's `.terms` and `.art` (UI wording and icon names),
  `board.speedDie.faces` / `.labels[String(face)]`, `board.heroes` (Hero League's heroes and numbers).
- Money: `formatMoney(units, opts?, currency?)` (`opts.signed`: "+" on gains; `opts.bare`: the amount without the
  symbol), `boardMoney(board | id, units, opts?)` (in that board's currency), `currencyOf(board)`,
  `toUnits(shown, currency?)`, `toShown(units, currency?)` (the currency defaults to All Island's, `DEFAULT_CURRENCY`);
  `toRupees`, `MONEY_SCALE`. `owedTotal(owed)`: what an `Owed` adds up to.

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
- Hero League: `heroesOf(board)` (heroes in Hero-die face order), `heroOf(state, seat)`, `powerReady(state, seat)`,
  `canUsePower(state, seat, power)` (its own or Suit Up's copy of a ready hero's, phases aside),
  `shieldableByDrawer(fx)` (a Villain Strike effect Star Shield can say no to for its drawer),
  `usablePowers(state, seat)` -> `{power, copied, hero}[]` usable now by one of the seat's actions,
  `smashPairs(state, seat)` -> the `{a, b}` pairs `smash` accepts now (15 at most), `score(state, seat)` (cash + 100 per
  location). `ranking` orders by score there; `maxRaise` is the cash; `buildOptions` is empty.

Dev only (not exported from `index.ts`): `randomPlayer.ts` (`randFrom`, `randomCommand`) drives the fuzz test and
`npm run sim`.

## Rule decisions made in the engine

`docs/rules.md` lists the rulebook decisions; these are the engine-level ones on top:

- **Auction**: every bid restarts the countdown (the net layer gives at least `AUCTION_BID_SECS` after a bid); with
  `cfg.fixedAuctionCountdown` it is fixed from when the lot is put up (`timer()` keeps its key through bids). It ends
  early once everyone but the high bidder has passed. The high bidder can neither pass nor raise its own bid, and is
  not counted in `awaiting`. The lowest bid is `minBid(phase)`: `phase.open` (70% of a property's price,
  `AUCTION_OPEN_SHARE`; 1 for a building unit) with no bid yet, then the high bid plus `minRaise(phase)`, which grows
  with `phase.bids` (`AUCTION_RAISES`: 1, then 10 from the 3rd bid, 100 from the 6th). Seats whose
  `maxRaise` cannot reach `minBid` are passed automatically (`pass {auto:true}`); a seat with cash below the next
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
  group; the bank pays 80% of the price (`rates.ts`), less the mortgage value for a mortgaged property, and clears its
  mortgage. The property is unowned again (level 0, unmortgaged): anyone may buy it on landing there, and Tuk-Tuk
  Uncle counts it as the bank's. Mortgages pay 60%, so selling raises more: `maxRaise` counts every property's sale
  value.
- **Bankruptcy**: owing a player (alone or with others), everything is sold to the bank: buildings at half price,
  every property at its sale value (80% of the price, less the loan when mortgaged) and back to the bank unowned and unmortgaged (no
  auction), Get Out of Jail Free cards back to their decks. The creditors are paid from that cash in seat order from
  the debtor's left (players), then the bank, each at most its share (the payments carry the debt's `why`); what is
  left goes to the bank (`why:'bankrupt'`). No property or card passes to a creditor, so there is no `mortgageXfer`
  after a bankruptcy. The `bankrupt` event names the creditor when there is one, else `'bank'`. Owing only the bank,
  everything goes to the bank, which auctions the property (keeps it with `auctions` off). Out players' shares of open
  debts go to the bank. A resignation in debt pays the creditors in full when `maxRaise` covers it (the rest goes to
  the bank), otherwise it is a bankruptcy to the creditor.
- **autoRaise** plan: sell one building level at a time from the highest-standing street (ties: higher board index),
  whole groups when a hotel cannot be broken up; then mortgage the cheapest property first (ties: lower index); then
  sell mortgaged property back to the bank, cheapest first; goes bankrupt straight away when `maxRaise` cannot cover
  the debt.
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

## Hero League

A board with a `heroes` block (`HEROES`, id `'heroes'`) plays the superhero edition's rules; `docs/heroes.md` has the
rules as implemented and the full API. In short:

- **Power, no bankruptcy.** A payment that cannot be made in full pays what there is, in creditor order, and emits
  `short`; there is never a `debt` phase. The jailed seat pays the fine at the start of its next turn (what it has) and
  rolls as usual.
- **Compulsory saving.** Landing on an unowned location saves it at once when the lander has the cost; otherwise a
  back-up hero (another seat with the cost) does: one eligible saves at once, several are picked by one Hero-die throw.
  Nobody: `noSave`. Every save checks the end: all locations owned -> `over why:'allSaved'`, ranked by score.
- **The Hero die.** A card's throws all come first, then each distinct hero rolled takes the hit in throw order, each
  resolving fully before the next.
- **Superpowers** (`PlayerState.powerUsed`): Thunder Call and Star Shield answer `react` windows, Viper Strike the
  `boost` phase, Dead Aim the `aim` phase, Titan Smash is `smash` in `preRoll`; Steel Ace copies any of them while its
  hero is ready. Ready again on a Rally Point salary in a later turn, or a Recharge card.
- **Windows** sit on `busy` and hold back one step; every answer names the window (`at`). Leaving: `purge` filters a
  window's `open`, drops it (and its `then`) when its own seat leaves, and drops an `aim` / `boost` whose seat leaves.
  drain keeps a `react` window open only to the seats that can still answer it (`liveOpen`: a Steel Ace whose copied
  hero left, a back-up throw only one hero could now win, a Titan Smash whose other hero left) and lets a `boost` or
  unrevealed `aim` whose copied superpower left go on as a pass, so a resting window always offers its superpower.

## Tests and sim

`npx vitest run src/rules`: suites per rule area (`data`, `rng`, `config`, `move`, `cards`, `rent`, `tax`,
`auction`, `jail`, `build`, `mortgage`, `trade`, `bankrupt`, `speed`, `autoplay`, `codec`, `options` for the optional
rules, `boards` for every board's data; Hero League: `heroes` (setup, saving, power-ups, the Holding Cell, the end,
what is refused), `heroesPowers` (the six superpowers), `heroesCards`, `heroesContract` (stale answers, leaving inside
windows, invariants, RNG, rigs, codec, money, timing), `heroesEdge` (adversarial chains: leaving inside every kind of
window, nested windows and re-rolls, hits that move heroes, the end mid-chain) and `heroesEnd` (games end
`allSaved`: at least 95% within 60 rounds over 2-6 seats, the plan's bar; two players on 600 Power, the slowest table
at about 94.5%, held to a 93% floor)) plus the fuzz test (`fuzz.test.ts` classic, `fuzzSpeed.test.ts` Speed Die,
`heroesFuzz.test.ts` Hero League with 2-6 seats asking for random heroes, 1,500, 600 or 300 to start and resignations
inside windows: 30 seeds x 3000 random commands each, checking invariants, the cash ledger and the jackpot pot, RNG use
(a `dice` or `heroDie` event whenever it moves), state size < 48 KB, codec round trips, `awaiting`, timers, that
`defaultAction` is legal, and on Hero League that a stale answer is always refused, nobody owes or goes bankrupt, the
decks stay whole, nobody moves silently or while jailed, superpowers are spent and readied in step, scores add up, the
game ends once every location is saved, and no window rests without its superpower, after a resignation too; the
games end `allSaved` (or by a resignation) and random play reaches every kind of window).

Two fuzz games in three vary the optional rules by seed (`variedRules` in `randomPlayer.ts`).

`npm run sim -- [games=100] [--board=lanka] [--players=4] [--cash=N] [--speed] [--seed=1] [--turns=400] [--options]`
plays random-legal-action games headless (`playRandomGame` in `randomPlayer.ts`, which `heroesEnd` plays too) with
invariants on and prints how they ended and their median / p95 rounds
(`--board`: the players are clamped to its cap; on Hero League also the share ending `allSaved` within 60 rounds,
judged against 95% on the exact counts and shown rounded down with PASS / FAIL; `--options`: vary the optional rules
game by game).
