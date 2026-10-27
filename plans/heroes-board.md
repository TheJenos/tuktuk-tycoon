# Plan: the Hero League board (the superhero-edition rules, in parody)

## Context

The user asked for the board of Hasbro's superhero Monopoly edition (B0323 game guide), with **the full rules**,
**original parody names** (no Marvel, Avengers, S.H.I.E.L.D., Monopoly or character/place/villain names of that IP
anywhere we ship), and the spaces **reconstructed** (the guide has no space list; its board photo is only partly
readable). The guide's rules differ from the 2007 rulebook the engine implements: Power instead of money, compulsory
saving, a back-up hero, partial payments and no bankruptcy, a Hero die, six once-per-lap superpowers, and an end when
every location is saved.

The new board is `heroes` ("Hero League"). Its rules run whenever the board data has a `heroes` block ("heroes
mode"); every other board plays exactly as today (no event, phase, state field, timer or RNG change there).

## Rule decisions (the guide, made precise)

| Topic | Decision |
|---|---|
| Players | 2-6. Each seat plays one hero = its token (the board's 6 tokens are the 6 heroes). |
| Start | 1,500 Power each; Rally Point (GO) pays 200. |
| Unowned location | **Compulsory save**: a lander with cash >= cost pays the bank and owns it at once (no buy phase, no decline). |
| Back-up hero | Lander short: eligible = other active seats with cash >= cost. None: `noSave` event, the villain keeps it. Exactly one: no throw, no window; that seat saves at once. Two or more: **one** Hero-die throw uniform over the eligible seats' heroes (same distribution as "roll until someone can"; a rigged face is used only if eligible), a Thunder window on it, then the picked seat pays and owns it (`owner via:'backup'`). If the picked seat is out or no longer eligible when it resolves: pick again among the eligible, or `noSave`. The lander keeps their power. |
| Owned location | Pay the power-up (`rent[0]`, doubled when the owner holds the colour pair) automatically. No power-ups while the owner is jailed. |
| Short payment | Pay what you have (creditors in today's `creditors()` order); the rest is forgiven. **No debt phase, no bankruptcy** on this board. Whenever paid < owed, `pay()` (and the turn-start fine) emits one `short {seat, why, space?, owed, paid}` event; `cash` events are unchanged. |
| Jail | Sent by Villain Ambush (Go To Jail), a card or three doubles. At the **start of the jailed seat's next turn** the fine (50) is charged automatically (short if needed), `jailExit how:'fine'`, then it rolls and moves normally. No doubles tries, no Get Out of Jail Free cards. A `back` or `jail` hit on a jailed hero does nothing (no window). On heroes boards, jailing the turn seat drops only the turn seat's own continuation (its move/land/after-roll/boost steps) and keeps other seats' queued steps; the turn ends when the queue runs dry. |
| End | Right after every grant (lander save, back-up, free save) the engine checks: every location owned -> `over why:'allSaved'` (the rest of the chain, doubles owed included, is dropped). Score = cash + 100 x locations owned (`heroes.locationPoints`); ties by turn order. Turn limit, Finish now and time-up rank by the same score (`OverPhase.scores`). A location lost to a card or a resignation reopens the board. |
| Fixed config | `HEROES_FIXED` pinned by `normalizeConfig` on this board: speedDie off, houses 0, hotels 0, auctions off, auctionAll off, jailRent off, buyAfterFirstLap off, dealProperties 0, endMode lastStanding, jackpot off, trading off. Adjustable: starting cash, salary, jail fine, double-GO landing, three-doubles jail, turn limit, timers. `BoardDef.rules = { ...HEROES_FIXED }`. |
| Engine-refused | Building, selling buildings, mortgaging, lifting and selling to the bank are refused on heroes boards (`err('heroes', ...)` first in their problem checks, `planBuild`/`planSell`); `legalActions` skips `manageCandidates`; `buildOptions` returns []; `maxRaise` = cash. |
| Powers (all) | Ready or used: `PlayerState.powerUsed?: number` (the `turn.no` it was used in; absent = ready). Using one emits `power`. A Rally Point salary makes it ready again (`powerReady`) **unless it was used during the current turn** (`powerUsed === s.turn.no`); a Recharge card always does. |
| Suit Up (Steel Ace) | Use another **active** hero's power while that hero is ready. Only Steel Ace's power is spent. Same actions as the original; the engine marks `copied`. A seat's own power wins over a copy. |
| Thunder Call (Storm Lord) | After **every** throw (a move throw of the two dice by anyone; a Hero-die throw for a card or a back-up) a `react` window of kind `thunder` opens if some active seat can re-roll (Storm Lord ready, or Steel Ace ready while an active Storm Lord is ready), including the thrower, and only when a re-roll could change the result. `reroll` spends the reactor's power and throws again (a new `dice` / `heroDie` event); then `open` is recomputed from scratch (earlier passes forgotten) and the phase re-entered (timer restarts). `pass` removes the seat without re-entering (deadline kept). Doubles, third-doubles jail and the move use the **final** throw. Re-rolls are not shieldable. |
| Star Shield (Star Captain) | Say no to a **Villain Strike card or a Titan Smash** played against you. A `react` window of kind `shield` opens for the target alone when it can shield (Star Captain ready, or Steel Ace ready while an active Star Captain is ready) and the effect would do something. Shieldable: every Villain Strike effect on its drawer (cash < 0, each < 0, back, jail, lose, advance); every Hero-die hit on its target; a Titan Smash moving you by another hero. Not shieldable: Hero HQ cards, power-ups, re-rolls, back-up saves, Villain Ambush, three doubles. A shielded hero counts as hit for that card's later throws. |
| Viper Strike (Velvet Viper) | "Advance up to 6 **extra** spaces": after the turn seat's move throw is final (after the Thunder window) and it is not going to jail, if the seat can sting, phase `boost`: `sting {n}` (1-6) moves dice total + n in one walk with one landing; `pass` moves the dice total. Doubles are still judged on the dice. |
| Titan Smash (Jade Titan) | `smash {a, b}` in `preRoll` before the turn's first roll: two distinct active, non-jailed heroes (the smasher may be one) trade spaces. Shield windows for `a` then `b` (each only if it is not the smasher and can shield, checked when its window opens); if either shields, nothing moves (the power is still spent). At resolution both must still be active and not jailed, else nothing moves. Moves are `move via:'swap'`, `path:[to]`: no salary, no landing. Back to `preRoll`. |
| Dead Aim (Sharpshot) | Landing on a Villain Strike space while able: phase `aim`. `pass` draws normally (power kept); `aim` spends the power and reveals the top 2 (`aimPeek`, phase re-entered for a fresh timer; after it only `pickCard` is legal, default the first). `pickCard {card}` takes both off the top, puts the other one on the bottom, then the chosen one (both `cardReturn`), emits `card` for the chosen one and plays it. The UI shows the two cards to the aiming seat's players only; others read "Sharpshot takes aim". |
| Hero die | 6 faces (1-6) = `heroes.list` order. On a card: **all of the card's throws first** (each with its Thunder window), collecting the distinct heroes hit (faces of heroes no active seat plays do nothing; a repeat does nothing); **then the hits in throw order**, each resolving fully (its shield window, the effect, and for `back` the walk and the whole landing: a save or back-up, a power-up, a card draw with a nested Dead Aim, Villain Ambush) before the next. |
| Stale answers | Every answer to a heroes window carries the window's id `at` (= `state.since` when the phase was entered): `reroll {at}`, `shield {at}`, `pass {at}` (react / aim / boost), `aim {at}`, `pickCard {card, at}`, `sting {n, at}`; a mismatch is refused `stale`. `defaultAction` fills `at`. |

## Board data (`src/boards/heroes/rules.ts`)

28 spaces (corners 0, 7, 14, 21), 16 locations in 8 colour pairs (8 villains, each holding two), 6 Villain Strike
(`chance`) and 2 Hero HQ (`chest`) spaces, no stations, utilities or taxes. Power-up is about 60% of the cost, rising;
the photo's readable values are kept (brown 40, teal 70, green 190, purple 400 / 240, a red 240 / 140).

| # | Space | Kind / group | Cost | Power-up | Villain |
|---|---|---|---|---|---|
| 0 | Rally Point | go | | | |
| 1 | Midtown Back Alleys | brown | 70 | 40 | Star Swarm |
| 2 | Harbour Docks | brown | 70 | 40 | The Brute |
| 3 | Hero HQ | chest | | | |
| 4 | The Iron Raft | teal | 120 | 70 | The Fang Legion |
| 5 | Villain Strike | chance | | | |
| 6 | Island Lock-Up | teal | 120 | 70 | The Illusionist |
| 7 | Holding Cell | jail | | | |
| 8 | Villain Strike | chance | | | |
| 9 | Daily Trumpet Tower | pink | 160 | 100 | The Cranium |
| 10 | Mystic Sanctum | pink | 180 | 110 | The Bone Baron |
| 11 | Villain Strike | chance | | | |
| 12 | Lost Jungle | orange | 200 | 120 | Star Swarm |
| 13 | Floating City | orange | 220 | 130 | Cyber Tyrant |
| 14 | Rooftop Lookout | parking | | | |
| 15 | Tri-Fort HQ | red | 240 | 140 | The Brute |
| 16 | Sky Carrier | red | 260 | 150 | The Fang Legion |
| 17 | Sunken Kingdom | yellow | 280 | 170 | The Hourglass |
| 18 | Villain Strike | chance | | | |
| 19 | Realm Eternal | yellow | 300 | 180 | The Illusionist |
| 20 | Villain Strike | chance | | | |
| 21 | Villain Ambush | goToJail | | | |
| 22 | Hidden Kingdom | green | 320 | 190 | The Cranium |
| 23 | Hero HQ | chest | | | |
| 24 | Starmetal Mines | green | 320 | 190 | The Hourglass |
| 25 | Villain Strike | chance | | | |
| 26 | Hero Mansion | purple | 400 | 240 | Cyber Tyrant |
| 27 | League Tower | purple | 400 | 240 | The Bone Baron |

Streets: `rent: [powerUp]` (one entry), `house: 0`, `mortgage: 0`, new optional `villain` field. `railRent: []`,
`utilityMul: []`, the Speed Die data kept (unused). `maxPlayers: 6`. Group ids/colours: brown `#8b4c2c`, teal
`#1aa3a3`, pink `#d6408f`, orange `#f4921f`, red `#e2232a`, yellow `#f9e11e`, green `#1fa952`, purple `#6b3fa0`.

Display: title `TUK-TUK TYCOON`, name and subtitle `Hero League`, blurb "Save the city from eight villains:
superpowers, a Hero die, and nobody goes bankrupt.", rulesBlurb "Power instead of money, compulsory saving and
superpowers; ends when every location is saved", decks `{ chance: 'Villain Strike', chest: 'Hero HQ' }`, currency
`{ symbol: 'Power', scale: 1, after: true }` ("1,500 Power", "+200 Power", "−50 Power"), terms (UI wording)
`{ property: 'location', buy: 'save', bought: 'saved', rent: 'power-up', bank: 'the Power Broker', worth: 'score' }`,
art `{ chance: 'mask', chest: 'shield', parking: 'lookout', goToJail: 'ambush', goLine: 'AS YOU PASS' }` (icon names
the scene draws; unknown ones fall back to today's art).

Wording rule (all layers): the currency always reads "<n> Power"; a hero's ability is named by its power name or
"superpower", never a bare "power" ("Thunder Call ready", "Superpower used"); rent reads "Ann pays Bob 140 Power
(Sky Carrier power-up)".

### Heroes (`BoardDef.heroes`)

`{ list: HeroDef[6], locationPoints: 100, stingMax: 6, aimCards: 2 }`, `HeroDef = { id, name, colour, power,
powerName, powerText }`. Ids are the board's token ids (letters only, unique across boards). `colour` is for the hero
card only; Hero-die faces show the hero's silhouette and short name in the colour of the seat playing it (grey when
nobody does).

| id | Name | Colour | Power | Power name | Card text |
|---|---|---|---|---|---|
| jadeTitan | Jade Titan | #2e9e44 | smash | Titan Smash | At the start of your turn, swap the places of any 2 heroes. They don't pass Rally Point or do anything else. |
| starCaptain | Star Captain | #2457c5 | shield | Star Shield | Say no to any Villain Strike card or Titan Smash played against you. |
| steelAce | Steel Ace | #d4a017 | copy | Suit Up | Use any other hero's superpower, as long as it's ready. |
| stormLord | Storm Lord | #c8102e | thunder | Thunder Call | Don't like a throw, yours or another hero's? Demand a re-roll! Works on the dice and the Hero die. |
| velvetViper | Velvet Viper | #3d3d4a | sting | Viper Strike | Move up to 6 extra spaces on your dice move. |
| sharpshot | Sharpshot | #7b3fc4 | aim | Dead Aim | When you land on Villain Strike, take 2 cards and play the one you choose. |

`createGame` assigns heroes in two passes: first every valid, free `SeatSetup.hero` request in seat order, then the
rest in list order. No RNG, never throws for a bad hero. `theme.ts`: those 6 tokens (labels = hero names), bot names
`Ruwan, Sachini, Dilan, Nethmi, Kavindu, Ishani`, `loopSeconds` = All Island's (no music of its own; every sound falls
back). The lobby hands bots and auto-filled seats a random free hero token (lobby code may use Math.random).

### Decks (amounts in Power; ids keep the `ch-` / `cc-` prefixes)

Villain Strike (`chance`, 20 cards; `HD(n, hit)` = `{k:'heroDie', rolls:n, hit}`):
1. The Illusionist casts a spell. Roll the Hero die: the hero rolled loses 100 Power. HD(1, cash −100)
2. Star Swarm attacks the city! Roll the Hero die twice: each hero rolled loses 50 Power. HD(2, −50)
3. Cyber Tyrant hacks the satellites. Roll the Hero die 3 times: each hero rolled loses 30 Power. HD(3, −30)
4. The Cranium reads minds. Roll the Hero die: the hero rolled loses 150 Power. HD(1, −150)
5. The Bone Baron's agents strike. Roll the Hero die: the hero rolled loses their cheapest location. HD(1, lose)
6. The Fang Legion raids the vaults. Roll the Hero die: the hero rolled loses 75 Power. HD(1, −75)
7. The Brute smashes through. Roll the Hero die: the hero rolled is captured. Go to the Holding Cell. HD(1, jail)
8. The Hourglass rewinds time. Roll the Hero die twice: each hero rolled goes back 3 spaces. HD(2, back 3)
9. Mass breakout! Roll the Hero die twice: each hero rolled loses 50 Power. HD(2, −50)
10. You walk into a mind-trap. Pay 50 Power. (cash −50)
11. Cyber Tyrant drains your suit. Pay 100 Power. (cash −100)
12. Ambushed by the Fang Legion. Go to the Holding Cell. Do not pass Rally Point, do not collect 200 Power. (jail)
13. The Illusionist turns you around. Go back 3 spaces. (back 3)
14. Star Swarm overruns your cheapest location. You lose it. (lose)
15. The Bone Baron demands tribute. Pay 75 Power. (cash −75)
16. The villains hold the city to ransom. Pay each hero 25 Power. (each −25)
17. Chased across town! Advance to Rally Point. Collect 200 Power. (advance 0)
18. Lured into a trap. Advance to The Iron Raft. If you pass Rally Point, collect 200 Power. (advance 4)
19. A false alarm sends you across the city. Advance to League Tower. If you pass Rally Point, collect 200 Power. (advance 27)
20. The Hourglass freezes you in time. Roll the Hero die: the hero rolled goes back 3 spaces. HD(1, back 3)

`lose` = the target's cheapest location (ties: lowest board index) goes back to its villain (`owner via:'villain'`);
none owned = nothing.

Hero HQ (`chest`, 16 cards, all helpful, none shieldable):
1. Mission bonus. Collect 100 Power. (cash 100)
2. Training complete. Collect 50 Power. (cash 50)
3. The city thanks you. Collect 150 Power. (cash 150)
4. A grateful mayor. Collect 200 Power. (cash 200)
5. Found a villain's stash. Collect 25 Power. (cash 25)
6. Every hero chips in for your gear. Collect 20 Power from each hero. (each 20)
7. Advance to Rally Point. Collect 200 Power. (advance 0)
8. Hunt down a villain. Advance to the nearest villain-held location; you must save it if you have the power. (nearestFree, free false)
9. Track the villains. Advance to the nearest villain-held location; you must save it if you have the power. (nearestFree, free false)
10. Strike team ready. Advance to the nearest villain-held location and save it for free. (nearestFree, free true)
11. Strike team ready. Advance to the nearest villain-held location and save it for free. (nearestFree, free true)
12. Recharge. Your superpower is ready again. (recharge)
13. Recharge. Your superpower is ready again. (recharge)
14. Bounty paid. Collect 75 Power. (cash 75)
15. Team-up bonus. Collect 10 Power from each hero. (each 10)
16. Hero of the week. Collect 100 Power. (cash 100)

`nearestFree` walks forward (salary when passing) to the next villain-held location; with none left it does nothing.

## Engine contract (`src/rules`)

Types (`types.ts`):
- `StreetDef.villain?: string`; `BoardDef.heroes?: HeroesDef`; `HeroDef`; `PowerId = 'smash'|'shield'|'copy'|'thunder'|'sting'|'aim'`;
  `display.currency.after?: boolean`; optional UI-only `display.terms?` and `display.art?` (string fields as above).
- `SeatSetup.hero?: string`. `PlayerState.hero?: string` (present exactly on heroes boards), `powerUsed?: number`.
  `GameState.rigHero?: number[]` (debug Hero-die faces 1-6, absent unless queued; `MAX_RIG` counts both queues).
- CardFx adds `{k:'heroDie', rolls, hit: HitFx}`, `{k:'lose'}`, `{k:'nearestFree', free}`, `{k:'recharge'}`;
  `HitFx = {k:'cash', amount (<0)} | {k:'lose'} | {k:'jail'} | {k:'back', n}`.
- Actions: `sting {n, at}`, `smash {a, b}`, `aim {at}`, `pickCard {card, at}`, `reroll {at}`, `shield {at}`, system
  `closeReact`; `pass` gains optional `at` (required in react / aim / boost); `debugRig` gains `hero?: number[]`.
- Phases (all opened on top of `busy`, `resume: {k:'busy'}`; the deferred work is the phase's `then: Step`):
  - `react { kind: 'thunder' | 'shield'; seat; open: SeatId[]; about; then; resume }`, `about` =
    `{k:'move'}` (the turn seat's dice) | `{k:'hero', face, purpose:'card'|'backup', card?, space?}` |
    `{k:'hit', fx: CardFx | HitFx, card, by?}` | `{k:'smash', by}`.
  - `aim { seat; deck; cards?: string[]; then?; resume }`, `boost { seat; total; then; resume }`.
  - drain: `react` rests while `open` has an active seat, else `setPhase(resume)` and `pending.unshift(then)`; `shield`
    drops `then`; `aim`/`boost` rest until answered. Handlers set their phase before applying effects. A heroes `roll`
    throws, sets `turn.roll`, sets busy and opens the window with `then: {k:'throwDone'}` (doubles, jail, boost and the
    move computed there).
  - `purge`/`dropSeat`: `react` filters `open`; if the leaver is `p.seat` the window and its `then` are dropped
    (`purge(p.resume)`); `aim`/`boost` whose seat leaves are dropped; a turn-seat leave becomes `busy` as today.
- Events: `heroDie {seat, face, hero, purpose:'backup'|'card', card?}`, `power {seat, power, copied?, target?}`,
  `powerReady {seat}`, `aimPeek {seat, deck, cards}`, `noSave {seat, space}`, `short {seat, why, space?, owed, paid}`,
  `reactTimeout {seats}` (closeReact with seats still open); `move.via` + `'power'|'swap'` (a boosted walk is one
  `move via:'dice'` with the longer path; `'power'` is kept for future use); `owner.via` + `'backup'|'villain'|'free'`
  (the lander's own save stays `'buy'`); `over.why` + `'allSaved'`, `OverPhase.scores?`.
- Timers: `TimerInfo.kind` + `'reaction'` (react) ; `aim` and `boost` are `'decision'`. `timeoutCommand`: react ->
  `closeReact` (system); aim / boost -> `forced` default. `awaiting`: react -> open active seats; aim / boost -> its
  seat. `defaultAction`: react / aim / boost -> `pass {at}` (aim after the reveal: `pickCard` first card).
  `src/shared/timing.ts` (engine layer owns it): `TimerRules.reaction` (online 8 s, offline 6 s), `phaseSecs('reaction')
  = Math.max(3, t.reaction ?? 6)`, `animBudget` counts `heroDie` as `ANIM.dice`, `move via:'swap'` as `ANIM.jump`, `power`
  as 400 ms.
- Selectors (exported): `heroesOf(board)`, `heroOf(state, seat)`, `powerReady(state, seat)`, `usablePowers(state,
  seat)` (`{power, copied, hero}[]` usable now by an action of that seat), `smashPairs(state, seat)` (unordered pairs,
  15 at most), `score(state, seat)`, `HEROES_FIXED`; `formatMoney(units, opts?, currency?)` + `currencyOf(board)`,
  `toUnits(shown, currency?)`, `toShown(units, currency?)`; engine messages print the board's currency.
- `RULES_VERSION` 8 (7 upgradable, unchanged shape). Invariants: hero iff heroes board, heroes unique, `powerUsed` only
  with a hero, no `debt` phase on heroes boards, a resting `react` has open active seats, an `aim`/`boost` seat is
  active, `rigHero` only with debug.
- RNG: Hero-die throws and re-rolls consume `state.rng`, each with a `dice` or `heroDie` event; README updated.

Tests: `boards.test.ts` keeps every current assertion for the four classic boards verbatim and adds a Hero League
block (shape, values from the photo, decks, card texts in Power, no trademark strings); suites for every rule above;
a heroes fuzz (2-6 seats, random hero requests, startCash 1500 and 600, resigns inside windows) checking invariants,
ledger, awaiting / defaults / timers, RNG events, and that at least 95% of games end `allSaved` within 60 rounds;
`randomPlayer` exercises every new action (smash weighted low); `scripts/sim.ts --board` (players clamped to the cap)
reporting end reasons and median / p95 rounds.

## Layers (ownership; each layer only edits its own files)

Landing order: 1 first, then 2-5 in parallel against layer 1's API, then integration. `tsc` and the full vitest run
must be green only after integration; each layer keeps its own folders' tests green.

1. **Engine**: `src/rules/**`, `src/boards/heroes/rules.ts` + `theme.ts`, `src/shared/timing.ts`, `scripts/sim.ts`,
   `src/rules/README.md`, `docs/rules.md` (scope note), `docs/heroes.md` (the rules as implemented). Registers
   `HEROES` in `board.ts` and `index.ts`.
2. **Bots**: `src/bots/**`, `scripts/sim-bots.ts`. New `heroes.ts` heuristics (re-roll, shield, aim vs pass + pick,
   boost n, smash pair, keep vs use); `choose()` cases; heroes guards in jail / buy / search; model value score-aware;
   landing table leave-only jail on heroes; arena + sim-bots `--board` rotating heroes, per-hero win stats. No
   peeking: aim-vs-pass uses deck composition only; boost / smash / reroll are analytic or use rollouts with every
   deck shuffled by the rollout seed. Tests incl. a heroes bot fuzz and a no-peek test permuting `s.decks` and `s.rng`.
3. **Game UI**: `src/ui/game/**` except `tokenIcons.tsx`, `src/ui/settings.ts`, `src/ui/testHooks.ts`,
   `src/state/ui.ts`, `e2e/**`. `format.ts` keeps `money(n)` and gains `money(n, board?)`; `names.money`; terms;
   ReactionBanner (react; with an inline "only ask on my throws" toggle backed by a per-device setting `reactions:
   'all' | 'mine' | 'never'` that auto-sends `pass {at}` for local human reactors), AimPrompt (2 cards, aim seat
   only), BoostChoice (0-6), SmashPicker, PowerButton + HeroCard, PlayersPanel hero chip + superpower badge + score,
   deeds / inspector for locations, no Manage / Trade / Jail panel there, event texts (wording rule), GameOver
   scores, rules view (uses `hiddenOptions(board): ReadonlySet<string>` from `src/ui/lobby/rulesText.ts`), hot-seat
   exemption for `react`, testHooks Hero-die rig; a heroes hot-seat e2e spec.
4. **Scene, view, audio, dev**: `src/scene/**`, `src/view/**`, `src/boards/heroes/tokens.ts` + `icons.tsx`,
   `src/ui/game/tokenIcons.tsx`, `src/audio/**` except `index.ts`, `src/dev/**`. Heroes tiles (name, villain, cost,
   power-up) and per-board art, board-aware money, Hero die (DOM readout + a 3D fourth die), `leap` move mode for
   swaps, floating "Re-roll!" / "Shield!" / "Smash!" labels, view state for superpowers, six hero tokens and icons, a
   reaction sound cue (reusing an existing sound); tests.
5. **Lobby, net, shared, docs**: `src/ui/lobby/**`, `src/net/**`, `src/shared/**` except `timing.ts`,
   `src/audio/index.ts`, `database.rules.json`, `scripts/test-rules.mjs`, `public/credits.html`, `README.md`,
   `src/boards/README.md`. Registration, `tokensOn` for sets of different sizes, hero from token in `createDoc` (and
   token = hero after it), board change re-maps stored tokens and clamps `lobby.maxSeats`, `closeReact` in
   `TIMEOUT_ACTIONS`, reaction timer in room/draft timers and `nextDeadline` (uncapped anim budget for it), react
   timeouts never AFK strikes and a react-idle auto-pass after 3 in a row, bot reactors answer at
   `animBudget * pace + 300 ms`, `hiddenOptions(board)` in `rulesText.ts`, board-aware presets (Classic + House) and
   money, TokenPicker shows hero powers, random hero tokens for bots, db enums, credits, docs; tests.

## Verification

`npx tsc --noEmit`, `npx vitest run`, `npm run build`, `npm run test:rules`, `npm run test:e2e`, `npm run sim --
--board=heroes`, `npm run sim:bots -- --board=heroes`, then a real local hot-seat game on the board in the browser
(screens of the board, a reaction, a superpower, game over).
