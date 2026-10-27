# Hero League (board `heroes`)

Hero League is the board of the superhero edition's game guide, in parody: every hero, villain, place and card name is
our own. Its rules differ from the classic rulebook the other boards play (`docs/rules.md`): Power instead of money,
compulsory saving, a back-up hero, partial payments and no bankruptcy, a Hero die, six once-per-lap superpowers, and an
end when every location is saved.

The rules run whenever the board data has a `heroes` block (`src/boards/heroes/rules.ts`, "heroes mode"). Every other
board plays exactly as before: no event, phase, state field, timer or RNG use changes there.

## How to play

**The board.** 28 spaces. Rally Point (GO, pays 200 Power when passed or landed on), the Holding Cell (jail), the
Rooftop Lookout (nothing happens) and Villain Ambush (go to the Holding Cell) on the corners. Sixteen locations in eight
colour pairs, each held by a villain until a hero saves it; six Villain Strike spaces and two Hero HQ spaces.

**Heroes.** 2 to 6 players, each playing one hero (the board's six tokens are the six heroes). Everyone starts with
1,500 Power at Rally Point.

**Saving locations.** Land on a location a villain still holds and you save it at once if you have its cost: you pay
and it is yours. There is no choice and no auction. If you are short, another hero may save it instead (the back-up
hero): the heroes who can pay are eligible. If nobody can, the villain keeps it. If exactly one can, that hero saves
it. If several can, the Hero die picks one of them. You keep your Power either way.

**Power-ups.** Land on another hero's location and you pay its power-up, doubled when that hero holds both locations
of the colour pair. No power-up is due while the owner is in the Holding Cell.

**Short of Power.** You pay what you have and the rest is forgiven. Nobody ever goes bankrupt.

**The Holding Cell.** Villain Ambush, a card or three doubles in a row send you there; your turn ends. At the start of
your next turn you pay the 50 Power fine (what you have, if less) and leave, then roll as usual.

**Villain Strike** cards (20) all work against heroes: lose Power, lose your cheapest location, go back, go to the
Holding Cell, pay each hero, or advance. Nine of them roll the **Hero die**: its six faces are the six heroes, and the
hero rolled takes the hit (a hero nobody plays: nothing happens). A card that rolls more than once rolls every time
first, then each different hero rolled takes the hit in turn. **Hero HQ** cards (16) all help: Power, Rally Point, a
free or compulsory save of the nearest villain-held location, or a Recharge of your superpower.

**Superpowers.** Each hero has one, used once and then ready again when you next collect a Rally Point salary (not in
the turn you used it) or draw a Recharge card:

| Hero | Superpower | What it does |
|---|---|---|
| Jade Titan | Titan Smash | Before your first roll of a turn, swap the places of any 2 heroes (yourself included). They don't pass Rally Point or do anything else. |
| Star Captain | Star Shield | Say no to a Villain Strike card or a Titan Smash played against you. |
| Steel Ace | Suit Up | Use any other hero's superpower while that hero's is ready (only Steel Ace's is spent). |
| Storm Lord | Thunder Call | After any throw (the dice or the Hero die, yours or another hero's), demand a re-roll. |
| Velvet Viper | Viper Strike | On your dice move, move up to 6 extra spaces (one walk, one landing). |
| Sharpshot | Dead Aim | Landing on Villain Strike, take the top 2 cards and play the one you choose. |

**The end.** The game ends the moment every location is saved. Score = Power + 100 for each location you hold; the
highest score wins (ties: the earlier player in turn order). A turn limit, Finish now and the room's time limit rank by
the same score. A location lost to a card or a resignation is villain-held again.

## The rules as implemented

| Topic | Decision |
|---|---|
| Fixed config | `HEROES_FIXED`, forced by `normalizeConfig` on this board (and on `decode`): Speed Die off, houses 0, hotels 0, auctions off, auctionAll off, jailRent off, buyAfterFirstLap off, dealProperties 0, endMode lastStanding, jackpot off, trading off. Adjustable: startCash, goSalary, jailFine, doubleGoLanding, threeDoublesJail, turnLimit (and the net layer's timers). `HEROES.rules` is `{ ...HEROES_FIXED }`. |
| Refused by the engine | build, sell, mortgage, unmortgage and sellProperty are refused with code `heroes` in every phase; `legalActions` offers none of them; `buildOptions` is `[]`; `maxRaise` is the cash. Trades are refused by the pinned `trading: 'off'` (`tradingOff`). |
| Hero assignment | `createGame` gives each seat a hero in two passes: first every valid, still-free `SeatSetup.hero` request in seat order, then the rest in the heroes' list order. No RNG; a bad request is never an error. |
| Compulsory save | The lander with cash >= cost pays (`cash why:'buy'`) and owns it (`owner via:'buy'`) at once. A Strike team card saves it for nothing (`owner via:'free'`). |
| Back-up hero | Eligible = the other active seats with cash >= cost. None: `noSave`. One: it saves at once (no throw, no RNG). Several: one Hero-die throw, uniform over the eligible heroes (a rigged face is used only if eligible; it is used up either way), with its Thunder window, then that seat pays and owns it (`owner via:'backup'`). If it has left or can no longer pay when the throw stands, the pick is made again among those who can (or `noSave`). |
| Power-ups | `rent[0]`, doubled for the pair (the classic unimproved-street rule); none while the owner is jailed (`jailRent` pinned off). |
| Short payment | `pay()` pays each creditor in `creditors()` order (seats from the payer's left, then the bank) as far as the cash goes and emits one `short` event; no `debt` phase, so no bankruptcy. Card payments, power-ups, "pay each hero" and the turn-start fine all go through it. |
| Holding Cell | At the start of the jailed seat's turn: `turn`, the fine (`cash why:'fine'`, and `short` if needed), `jailExit how:'fine'`, then `preRoll` as usual. `payFine`, `useCard` and the jail roll are never reached. A `back` or `jail` hit on a jailed hero does nothing (no window). |
| Jail with queued steps | Jailing the turn seat drops only its own continuation (its move, back, land and throwDone steps, afterRoll, the return to preRoll) and `turn.again`; other heroes' queued work (Hero-die hits and their landings) runs on, and the turn ends (`postRoll`) when the queue runs dry. |
| End | Checked right after every grant (lander, back-up, free save): every location owned -> `over why:'allSaved'`; the rest of the chain, a doubles roll still owed included, is dropped. Every ending ranks by score and carries `OverPhase.scores`. |
| Superpower state | `PlayerState.powerUsed` = the `turn.no` it was used in (absent = ready). A Rally Point salary readies it unless `powerUsed === turn.no`; a Recharge card always does. |
| Steel Ace | `powerSource`: a seat's own hero's power first; else Steel Ace may copy a power whose hero is active and ready. The same actions; `power` events say `copied: true`; only Steel Ace's power is spent. |
| Thunder windows | After every move throw, card Hero-die throw and back-up Hero-die throw, when some active seat can re-roll (the thrower included). `reroll` spends the power, throws again (a new `dice` / `heroDie` event), recomputes `open` from scratch (earlier passes forgotten) and re-enters the phase (a fresh timer); `pass` leaves `open` (the countdown runs on). Doubles, the third-doubles capture, Viper Strike and the move use the final throw. A back-up re-roll is refused (`pointless`) once fewer than 2 heroes could pay. Re-rolls cannot be shielded. A window stays open only to the seats that can still re-roll (see "Leaving" below). |
| Star Shield | A `shield` window for the target alone, when it can shield and the effect would do something (Power to lose, a location to lose, not already jailed, a swap that moves it). Shieldable: every Villain Strike effect on its drawer (pay, pay each, back, jail, lose, advance), every Hero-die hit, a Titan Smash moving that hero (not the smasher). Not: Hero HQ cards, power-ups, re-rolls, back-up saves, Villain Ambush, three doubles. The window closes (the effect happens) once the hero can no longer shield or the effect would no longer do anything (see "Leaving" below). |
| Viper Strike | After the move throw stands and only when it does not jail: phase `boost`. `sting {n}` (1-6) walks dice + n in one `move via:'dice'` with one landing; `pass` walks the dice. A sting past Rally Point pays the salary but cannot ready the power it just used. A Steel Ace whose copied Velvet Viper leaves meanwhile walks the dice (as a `pass`). |
| Titan Smash | `smash {a, b}` in the turn seat's `preRoll` before the turn's first roll (`turn.roll` absent): any two distinct active heroes outside the Holding Cell (the smasher may be one; two on the same space too, Rally Point on turn 1 included). Shield windows for `a` then `b` (each when it is not the smasher, can shield and would move: none when the two share a space; checked as its window opens); a shield cancels the swap (the power is still spent). At resolution both must still qualify. The swap: `move via:'swap'`, `path: [to]`, `a` first (on a shared space both jumps are in place, `from` = `to`); no salary, no landing; then `preRoll` again. |
| Dead Aim | Landing on Villain Strike able to aim: phase `aim`. `pass` draws normally (power kept); `aim` spends it and reveals the top 2 (`aimPeek`; they stay in the deck) and re-enters the phase; then only `pickCard` (default: the first). The pick takes both off the top, puts the other one under the deck, then the chosen one, and plays it as if drawn (Star Shield still applies to its effects). A Steel Ace whose copied Sharpshot leaves before the reveal draws normally (as a `pass`); after the reveal the pick goes on. |
| Hero-die cards | All of a card's throws first (each with its Thunder window), collecting the distinct heroes hit (a face nobody plays and a repeat do nothing); then one `hit` per hero in throw order, each resolved fully (its shield window, the effect, a walk back's whole landing: a save or back-up, a power-up, a card with a nested Dead Aim, Villain Ambush) before the next. |
| `lose` | The cheapest location the target owns (ties: the lowest board index) goes back to its villain (`owner from via:'villain'`, no `to`); none owned: nothing. |
| `nearestFree` | Walks forward to the next villain-held location (salary when passing Rally Point) and lands with `free` (a save for nothing) or normally (compulsory save, else a back-up). |
| Stale answers | Every answer to a window carries its id `at` (= `state.since` when it was entered); anything else is refused `stale`. |

Measured with random legal play (`npm run sim -- 1000 --board=heroes --players=N --cash=C`, seeds 1-1000; rounds =
turns / players):

| Players | Start | Median rounds | p95 | allSaved within 60 rounds |
|---|---|---|---|---|
| 2 | 1,500 | 30 | 54 | 97.10% (940/968) |
| 2 | 600 | 38 | 60 | 94.97% (908/956) |
| 3 | 1,500 | 21 | 37 | 99.79% |
| 3 | 600 | 24 | 40 | 100% |
| 4 | 1,500 | 16 | 30 | 100% |
| 4 | 600 | 18 | 29 | 100% |
| 5 | 1,500 | 13 | 22 | 100% |
| 5 | 600 | 13 | 23 | 100% |
| 6 | 1,500 | 11 | 19 | 100% |
| 6 | 600 | 11 | 19 | 100% |

(The percentages count the games no random resignation ended; Hero League has no bankruptcy.) The plan's bar, at
least 95% within 60 rounds, is set for the mixed 2-6 seat table (`heroesEnd.test.ts`), which meets it. One table on
its own does not: **two players on 600 Power sit just under it**, 94.4% over 17,500 games (seven runs of 2,500 from
seeds 1, 20001, 30001, 100001, 200001, 300001 and 400001: 93.96% to 94.87%). The rules are not tuned per seat count
(the plan has none); `heroesEnd.test.ts` holds that table to a 93% floor, playing each game with `sim.ts`'s own loop
(`playRandomGame`). `sim.ts` judges the bar on the exact counts and rounds the shown rate down, so 908/956 reads
94.97% and FAIL, never "95.0%".

## Engine notes

- **Gating.** Every heroes branch tests `c.b.heroes` (or `b.heroes`); the classic boards take the old paths. A replay of
  random classic games through the previous engine and this one gives the same events, states, errors, timers,
  defaults and legal actions command for command.
- **Windows.** `react`, `aim` and `boost` always open on top of `busy` (`resume: {k:'busy'}`) from inside a step, or from
  a handler that has already set `busy`; handlers set their phase before applying effects. A window holds back one step
  (`then`). drain: `react` keeps `open` to the seats that can still answer it (`liveOpen` in react.ts) and rests while
  any is left, then `setPhase(resume)` and `pending.unshift(then)`; `shield` drops `then`; `boost` and `aim` (before
  the reveal) rest until answered while the seat can still use the superpower, else go on as a `pass`.
- **Leaving.** `purge`: a `react` filters `open`; if the leaver is the window's `seat` (thrower or target) the window and
  its `then` are dropped; an `aim` / `boost` whose seat leaves is dropped; the turn seat leaving turns the phase into
  `busy` and the turn passes on, as before. Steps naming the leaver are filtered from `pending` as before. Anyone else
  leaving may take away what a window was open for, so drain re-checks it: a Thunder window keeps only the seats that
  can still re-roll (a Steel Ace whose Storm Lord left drops out; a back-up throw fewer than 2 heroes could now win
  closes) and closes when none is left, so the throw stands; a shield window closes, so the effect happens, when its
  hero can no longer shield (its copied Star Captain left) or the effect would do nothing (the other hero of a Titan
  Smash left); a `boost` or an unrevealed `aim` whose copied hero left goes on as a `pass`. A window that stays open
  keeps its countdown.
- **The roll.** A heroes `roll` throws, sets `turn.roll`, sets `busy` and opens the Thunder window with
  `then: {k:'throwDone', seat}`; `throwDone` counts doubles, applies the third-doubles capture, opens `boost` or queues
  the move, then `land` and `afterRoll`.
- **RNG.** Hero-die throws (card throws, back-up draws) and Thunder re-rolls consume `state.rng`, each with a `dice` or
  `heroDie` event. A `pass`, `closeReact`, `shield` or `resign` that lets the next throw happen consumes it in a fixed
  order. A rigged throw (`rig`, `rigHero`) consumes none (a rigged back-up face whose hero cannot pay falls back to the
  RNG).
- **Invariants** (`checkInvariants`): a hero exactly on a heroes board, every hero played once, `powerUsed` only with a
  hero, no `debt` phase on a heroes board, `react` / `aim` / `boost` only there and only over `busy`, a resting `react`
  with an active seat in `open` and every seat in `open` able to answer it (`liveOpen`), an `aim` / `boost` seat still
  in and still able to use Dead Aim (before the reveal) / Viper Strike, no jailed seat about to roll, `rigHero` only with
  debug (faces 1-6, never empty).
- **Version.** `RULES_VERSION` 8; version 7 states decode unchanged (they can only be on classic boards).

## API for the other layers

Everything below is exported from `src/rules` (`index.ts`), except the timing helpers (`src/shared/timing.ts`) and the
board theme (`src/boards/heroes/theme.ts`).

### Board data and types

- `HEROES: BoardDef` (id `'heroes'`, registered in `BOARD_IDS` / `BOARDS` as "Hero League", `maxPlayers: 6`).
- `BoardDef.heroes?: HeroesDef`: present only on a heroes board; its presence switches the rules on.
- `interface HeroesDef { list: HeroDef[]; locationPoints: number; stingMax: number; aimCards: number }`: the six heroes
  in Hero-die face order (face `f` = `list[f - 1]`); 100, 6 and 2 on Hero League.
- `interface HeroDef { id: string; name: string; colour: string; power: PowerId; powerName: string; powerText: string }`:
  `id` is the token id (`jadeTitan`, `starCaptain`, `steelAce`, `stormLord`, `velvetViper`, `sharpshot`); `colour` is
  for the hero card only.
- `type PowerId = 'smash' | 'shield' | 'copy' | 'thunder' | 'sting' | 'aim'`.
- `StreetDef.villain?: string`: the villain holding the location (tiles and texts).
- `BoardDef.display.currency: Currency`, `interface Currency { symbol: string; scale: number; after?: boolean }`:
  Hero League's is `{ symbol: 'Power', scale: 1, after: true }`.
- `BoardDef.display.terms?: BoardTerms` (`property`, `buy`, `bought`, `rent`, `bank`, `worth`: optional strings, UI
  wording) and `BoardDef.display.art?: BoardArt` (`chance`, `chest`, `parking`, `goToJail`, `goLine`: optional icon names
  for the scene; unknown names fall back to the classic art).
- `CardFx` adds `{k:'heroDie'; rolls: number; hit: HitFx}`, `{k:'lose'}`, `{k:'nearestFree'; free: boolean}`,
  `{k:'recharge'}`; `type HitFx = {k:'cash'; amount: number} | {k:'lose'} | {k:'jail'} | {k:'back'; n: number}`
  (`cash` amounts are losses, < 0).
- `HEROES_THEME` (`src/boards/heroes/theme.ts`): `tokens` (`{id, label}` per hero, list order), `botNames`
  (`Ruwan, Sachini, Dilan, Nethmi, Kavindu, Ishani`), `loopSeconds` (All Island's).

### State

- `SeatSetup.hero?: string`: the hero a seat asks for (a `HeroDef` id; ignored on classic boards).
- `PlayerState.hero?: string`: always present on a heroes board, never elsewhere; kept when the seat is out.
- `PlayerState.powerUsed?: number`: the `turn.no` the superpower was used in; absent = ready.
- `GameState.rigHero?: number[]`: queued rigged Hero-die faces (debug), absent unless some are queued.
- `OverPhase.why` adds `'allSaved'`; `OverPhase.scores?: Partial<Record<SeatId, number>>` (every seat's score, present
  on heroes boards for every ending; the `over` event is unchanged apart from `why`).
- `MoveVia` adds `'swap'` (Titan Smash) and `'power'` (reserved, never emitted); `OwnerVia` adds `'backup'`,
  `'villain'`, `'free'` (a lander's own save stays `'buy'`; a resignation's locations go back with `'bankrupt'`).
- `RULES_VERSION` is 8; `UPGRADABLE_VERSIONS` includes 7.

### Actions

Every answer to a window carries `at`: the window's `state.since`. `defaultAction` fills it in.

| Action | Sent by | Legal when | Refusals |
|---|---|---|---|
| `{k:'reroll', at}` | a seat in `open` | `react` of kind `thunder`; the seat can use Thunder Call (own or copied) | `phase`, `stale`, `notOpen`, `power`, `pointless` (a back-up throw that fewer than 2 heroes could win now) |
| `{k:'shield', at}` | the window's seat | `react` of kind `shield`; the seat can use Star Shield | `phase`, `stale`, `notOpen`, `power` |
| `{k:'pass', at}` | a seat in `open` / the phase's seat | `react`; `boost`; `aim` before the reveal (`at` required in these three; still optional in `auction` / `buildClaim`) | `stale`, `notOpen`, `aimed` (aim after the reveal) |
| `{k:'sting', n, at}` | the boost seat | `boost`; `1 <= n <= stingMax`; Viper Strike usable | `phase`, `stale`, `notOpen`, `badMove`, `power` |
| `{k:'smash', a, b}` | turn seat | `preRoll` before the turn's first roll; Titan Smash usable; `{a, b}` from `smashPairs` (either order): two distinct active heroes outside the Holding Cell, the same space allowed | `noPowers` (classic board), `phase`, `notYourTurn`, `started`, `power`, `badTargets` |
| `{k:'aim', at}` | the aim seat | `aim` before the reveal; Dead Aim usable | `phase`, `stale`, `notOpen`, `aimed`, `power` |
| `{k:'pickCard', card, at}` | the aim seat | `aim` after the reveal; `card` one of `phase.cards` | `phase`, `stale`, `notOpen`, `notAimed`, `badCard` |
| `{k:'closeReact'}` | system (basis) | `react`: its deadline passed; every seat still open passes | `phase` |
| `{k:'debugRig', dice, hero?}` | anyone, `cfg.debug` | `hero`: faces 1-6 for the next Hero-die throws (heroes boards only); `MAX_RIG` (100) counts both queues | `debugOff`, `badRig` |
| `build`, `sell`, `mortgage`, `unmortgage`, `sellProperty` | | never on a heroes board | `heroes` |

`legalActions(state, seat)` lists, on a heroes board: in `preRoll` the `smash` pairs; in `react` `reroll` / `shield` /
`pass` (each when legal); in `aim` `aim` and `pass`, then the `pickCard`s; in `boost` `pass` and `sting` 1-6.

### Phases

All three are interrupts over `busy` (`resume: {k:'busy'}`):

- `ReactPhase { k:'react'; kind:'thunder'|'shield'; seat: SeatId; open: SeatId[]; about: ReactAbout; then: Step; resume }`:
  `seat` is the thrower (thunder) or the target (shield); `open` the seats that may still answer, each of which can
  answer with the superpower (`reroll` / `shield`) as well as `pass` (a seat leaving may shrink `open` or close the
  window); `then` internal.
- `ReactAbout`:
  - `{k:'move'}`: the turn seat's move throw (`state.turn.roll` holds it);
  - `{k:'hero'; face; purpose:'card'|'backup'; card?; space?}`: a Hero-die throw for `card`, or for the back-up save of
    `space`;
  - `{k:'hit'; fx: CardFx | HitFx; card; by?}`: a Villain Strike effect aimed at `seat`, from its own card (`by` absent)
    or a Hero-die hit from `by`'s card;
  - `{k:'smash'; by}`: `by`'s Titan Smash would move `seat` (no window when the two share a space).
- `AimPhase { k:'aim'; seat; deck; cards?: string[]; resume }`: `cards` appear once `aim` was played (the top cards,
  still in the deck). Show them only to the aiming seat's players; others read "Sharpshot takes aim".
- `BoostPhase { k:'boost'; seat; total: number; then: Step; resume }`: `total` is the dice total.

| Phase | `awaiting` | `timer().kind` | `defaultAction` | `timeoutCommand` |
|---|---|---|---|---|
| `react` | the active seats in `open` | `'reaction'` | `{k:'pass', at}` | `{by:'system', a:{k:'closeReact'}, basis}` |
| `aim` | `seat` | `'decision'` | `{k:'pass', at}`; after the reveal `{k:'pickCard', card: cards[0], at}` | `forced` default |
| `boost` | `seat` | `'decision'` | `{k:'pass', at}` | `forced` default |

The timer key changes on every (re-)entry: a new window, a re-roll, the Dead Aim reveal. A `pass` keeps it.

### Events

| `t` | Fields | Meaning |
|---|---|---|
| `heroDie` | `seat, face, hero, purpose:'backup'\|'card', card?` | a Hero-die throw by `seat` (the drawer, or the lander for a back-up); `face` 1-6, `hero` its `HeroDef` id; a re-roll is a new one |
| `power` | `seat, power, copied?, target?` | a superpower used (`copied`: by Steel Ace; `target`: whose throw Thunder Call re-rolls) |
| `powerReady` | `seat` | ready again (a Rally Point salary, after the `cash` event; or a Recharge card) |
| `aimPeek` | `seat, deck, cards` | Dead Aim revealed the top cards |
| `noSave` | `seat, space` | nobody could save the location `seat` landed on |
| `short` | `seat, why, space?, owed, paid` | a payment fell short: `owed` and `paid` by creditor (`paid` lists every creditor of `owed`, 0 included); the `cash` events before it carry what moved |
| `reactTimeout` | `seats` | `closeReact` with these seats still open |
| `move` | `via:'swap'`, `path:[to]` | a Titan Smash jump (`a` first, then `b`; in place, `from` = `to`, when they share a space) |
| `owner` | `via:'buy'\|'backup'\|'free'\|'villain'\|'bankrupt'` | the lander's save / a back-up / a free save / lost to a card (no `to`) / a resignation |
| `over` | `why:'allSaved'` | every location saved |

Typical orders: a save is `land, cash (buy), owner`; a back-up is `land, [heroDie], cash (buy), owner via:'backup'`; the
turn-start fine is `turn, cash (fine), [short], jailExit`; a Hero-die card is `card, cardReturn, heroDie` (times the
rolls, each maybe followed by `power, heroDie` for a re-roll) and then the hits; a Titan Smash is
`power, move, move` (each `move` in place when the two share a space); a Dead Aim pick is `cardReturn (the other card), card, cardReturn (the chosen one)`, then its
effect.

### Selectors and helpers

- `heroesOf(board: BoardDef): HeroDef[]`: the heroes in face order (`[]` off a heroes board).
- `heroOf(state, seat): HeroDef | undefined`: the hero a seat plays.
- `powerReady(state, seat): boolean`: in, playing a hero, superpower not used.
- `canUsePower(state, seat, power: PowerId): boolean`: the seat could use `power` now, phases aside: its own hero's,
  or Steel Ace copying another active hero who has it ready (the engine's own check; `legalActions` adds the phase).
- `shieldableByDrawer(fx: CardFx): boolean`: a Villain Strike effect aimed at its drawer, which Star Shield can say no
  to (losing Power, moving, capture, losing a location).
- `usablePowers(state, seat): UsablePower[]`, `interface UsablePower { power: PowerId; copied: boolean; hero: string }`:
  the superpowers the seat could use right now through `legalActions` (each once; `hero`: whose power, the copied
  hero's for Steel Ace).
- `smashPairs(state, seat): { a: SeatId; b: SeatId }[]`: the pairs `smash` accepts from this seat now: every two
  distinct active heroes outside the Holding Cell, the smasher and heroes sharing a space included (unordered, turn
  order, 15 at most; `[]` when it cannot smash). On turn 1 everyone is on Rally Point and every pair is offered.
- `score(state, seat): number`: cash + `locationPoints` x locations owned.
- `HEROES_FIXED: Readonly<Partial<Omit<RulesConfig, 'board' | 'debug'>>>`: the pinned config (the lobby hides these options on this board).
- `formatMoney(units, opts?, currency?)` (`opts.bare`: the amount without the symbol), `boardMoney(board | id, units,
  opts?)`, `currencyOf(board): Currency`, `toUnits(shown, currency?)`, `toShown(units, currency?)`, `DEFAULT_CURRENCY`
  (All Island's); `toRupees`, `MONEY_SCALE` unchanged; `MONEY_SYMBOL` is gone (nothing read it).
  `boardMoney(HEROES, 1500)` is `"1,500 Power"`, signed `"+200 Power"`, negative `"−50 Power"`, bare `"1,500"`. Engine
  messages print the board's currency.
- `ranking(state)` ranks by score on a heroes board; `maxRaise` is the cash; `buildOptions` is `[]`.

### Timing (`src/shared/timing.ts`)

- `TimerRules.reaction?: number`: `ONLINE_TIMERS.reaction` 8, `OFFLINE_TIMERS.reaction` 6; rooms without the field use 6.
- `phaseSecs('reaction', t)` = `Math.max(3, t.reaction ?? 6)`: a reaction window always has a countdown, offline too.
- `ANIM.power` = 400; `animBudget` counts `heroDie` as `ANIM.dice`, `move via:'swap'` as `ANIM.jump`, `power` as
  `ANIM.power`.

### Wording (all layers)

The currency always reads "<n> Power"; a hero's ability is named by its power name or "superpower", never a bare
"power" ("Thunder Call ready", "Superpower used"); a power-up reads "Ann pays Bob 140 Power (Sky Carrier power-up)".
