# Plan: room customisation options (+ pending UI fixes)

## Context

Room creation today offers: Speed Die, triples roll again, starting cash, Wedding Gift Envelope (luxury tax), turn
limit, one turn timer, plus room name, public/private, max seats and bots. The user picked **every** suggested group
of extra options and wants them presented as **presets plus a collapsible Advanced section**, used by both Create room
and Local game. Separately, a previous fix (button text overflow + Start corner centring) was planned but not
executed because plan mode switched on; it is folded in as Part B.

Money: the engine works in rulebook units, the UI shows ×100 (`src/rules/currency.ts`). New money options are stored
in units and shown with `money()`.

## Part A — new room options

### A1. Engine (`src/rules`)
All new fields go in `RulesConfig` (`types.ts`), `DEFAULT_RULES` + `RANGES`/`bool()` in `config.ts`; new state fields
get `??=` defaults in `decode()` (`codec.ts`); bump `RULES_VERSION`. Defaults keep today's behaviour exactly.

| Option | Config | Engine change |
|---|---|---|
| Start salary | `goSalary` (exists) | UI only |
| Double salary on exact Start landing | `doubleGoLanding: boolean` | `moveForward` (`movement.ts`): `to === 0` → `paySalary(c, seat, 2)` |
| Tuk-Tuk Stand jackpot | `jackpot: boolean`, state `pot: number` | in `transfer()` (`money.ts`) when `to === 'bank'` and why ∈ {tax, fine, card} add to `pot`; `land()` (`landing.ts`) new `parking` case pays pot via `transfer('bank', seat, pot, 'jackpot')`, resets; new `CashWhy 'jackpot'`; `pot` in `createGame` and invariants (integer ≥ 0) |
| Inland Revenue mode | `incomeTaxMode: 'choice' \| 'flat' \| 'percent'` + `incomeFlat`/`incomePct` (exist) | `land()`: non-choice modes pay directly, no phase; handler refuses a disallowed pick; `autoplay` default + bots `incomeTaxChoice` respect it |
| Jail fine, mortgage interest | `jailFine`, `mortgagePct` (exist) | UI only |
| Building supply | `houses`/`hotels` (exist) | UI presets: Standard 32/12, Scarce 20/8, Unlimited 200/100 (≥ 88/22 means a shortage can never trigger — no engine change) |
| Auctions on/off | `auctions: boolean` | `decline` (`landing.ts`): off → property stays with bank, `setPhase busy`; `toBank` (`bankruptcy.ts`): skip `queueAuctions`; shortage contest (`claim.ts resolveClaim`) when off: grant in request order up to supply. Bots `buyChoice` buy more readily when off |
| Auction countdown | `TimerRules.auction` (exists) | UI only (A2) |
| First-lap rule | `buyAfterFirstLap: boolean`; `PlayerState.laps: number` | `paySalary` increments `laps`; `landOnProperty`: laps = 0 → no buy phase (stays with bank; Tuk-Tuk Uncle same path); `buy` handler refuses; auction eligibility excludes laps = 0 seats |
| Rent while jailed | `jailRent: boolean` (default true) | `landOnProperty` + `rentFor` + `nextRentOwed`: skip when owner jailed and off |
| Three doubles → jail | `threeDoublesJail: boolean` (default true) | `dice.ts` check gated; doubles counter capped so invariant `doubles ≤ 3` holds |
| Quick-start deal | `dealProperties: number` (0–3) | `createGame` after opening roll: `shuffle` property indexes, round-robin in `order`, `owner` events via new `OwnerVia 'deal'`; clamp so N × seats ≤ 28 |
| Game end | `endMode: 'lastStanding' \| 'firstBankrupt'` + existing `turnLimit`; time limit lives in the room (A2) | `retire`/`checkOver` (`over.ts`, `bankruptcy.ts`): firstBankrupt → `finish(c, 'firstBankrupt')` after the creditor gets assets; new `OverPhase.why` values `'firstBankrupt'`, `'timeUp'`; system action `timeUp` (like `endGame`) |
| Trading | `trading: 'on' \| 'off' \| 'afterLap'` + `tradeAfterLap: number` | `propose`/`accept` checks + `tradeProblems` message ("Trading opens after lap N" / "Trading is off"), using `laps` of both parties |

Bots (`src/bots`): `turn.ts` (salary ×2 hint in `targetScore`, jackpot value on parking, `buyChoice` with auctions off /
first lap, `incomeTaxChoice`), `trade.ts`/`search.ts`/`decide.ts` skip proposals when trading isn't open, `model.ts`
reads supply as today. Rollouts follow the engine automatically.

Tests: extend `config.test.ts`; one focused suite per option (`options.test.ts`) running real `apply()`; vary the new
options in the engine fuzz `newGame` (`__tests__/fuzzRun.ts`) and bot fuzz (`src/bots/__tests__/fuzzRun.ts`) by seed so
invariants + ledger (extend `ledgerOk` to account for `pot`) cover them.

### A2. Room plumbing (`src/net`, `database.rules.json`)
Every new room field must be added in **four places** or it is silently dropped / refused:
`RoomRules` + `DEFAULT_ROOM_RULES` (`setRules` keeps only keys present there) + `toRoomRules`/`roomConfig`
(`src/net/network.ts`) + a validate block under `rooms/$room/setup/rules` in `database.rules.json` (`$other: false`),
with cases in `scripts/test-rules.mjs` (extend the `roomRules` fixture; don't name anything `rentMode`, an existing
"unknown rule" case uses it). Republish the live rules in the Firebase console afterwards (as before).

Room-level (not engine) options, stored in the Doc so the pure, in-transaction code can read them:
- **Separate timers**: `decisionTimer`, `debtTimer`, `auctionTimer` already exist in `RoomRules`/`TimerRules`; expose
  them in the form (today `draftTimers`/`roomPatch` derive them from the turn timer — keep that as the default unless
  the Advanced section sets them).
- **AFK**: `afkStrikes: number` (0 = never; default 2) in `RoomRules` → new `Doc.afkStrikes` (default in `decodeDoc`);
  `applyEnvelope` (`doc.ts`) uses it instead of the `AFK_STRIKES` constant.
- **Bot speed**: `botPace: 0.5 | 1 | 2` in `RoomRules` → `Doc.botPace`; `Session.plan()` multiplies by
  `doc.botPace ?? this.pace` (online today is fixed at 1). Local games pass it through `createLocalSession` and it is
  saved in the doc, fixing resume/rematch losing `pace`.
- **Default bot skill**: `botSkill` in `RoomRules`; used by `addBot()` default, `CreateWizard` "Add a bot",
  `WaitingRoom` `newBot`, `SeatsEditor`/`seats.ts addSeat`, and AFK seats (the driver falls back to it instead of
  `'normal'`).
- **Spectators / late join**: `spectators: boolean` (default true) and `lateJoin: boolean` (default false).
  Spectators off → `join()` refuses a seat-less join with "This room doesn't allow spectators" (client-side; DB can't
  enforce presence, noted). Late join on → a spectator gets a "Take a seat" control (GameView spectator banner) for
  bot-played or abandoned (`ctrl: ''`) seats via a new `RoomConnection.takeSeat(seat)` using `game.editSeats`
  (bumps `sv`, clears strikes). Mirror both flags to the lobby record (`LobbyRecord`/`RoomSummary`/`watchRooms` + DB
  `lobby/$room` validate) so the Rooms list shows Watch/Join correctly.
- **Time limit**: `timeLimit: number` minutes (0 = off) in `RoomRules` → `Doc.endsAt` set at start; the driver
  dispatches the engine's new system `timeUp` action (with basis) once `serverNow() ≥ endsAt`, same mechanism as
  `finishNow`. Offline: the local driver does the same with `Date.now()`.

### A3. UI (`src/ui/lobby`, `src/ui/game`)
- `RulesForm.tsx`: extend `RulesDraft`/`DEFAULT_DRAFT`/`draftRules`/`roomDraft`/`roomPatch`. Top: a **Preset**
  `Choices` row — Classic (rulebook), Fast (Speed Die, quick-start deal 2, first-bankrupt ends, Rs. 200,000 start, 200
  turns), House rules (jackpot, double Start, no three-doubles jail), Custom (auto-selected when anything is edited).
  Keep today's basic controls visible; everything else goes in a native `<details className="advanced-rules">` (reuse
  `.launch-rules` styling) grouped as **Money** (salary, double on Start, jackpot, Inland Revenue mode + amounts, jail
  fine, mortgage interest, building supply), **Rules** (auctions + countdown, first-lap rule, rent while jailed, three
  doubles, quick-start deal, game end + time limit), **Pace & players** (separate timers, bot speed, default bot skill,
  AFK after N timeouts, spectators, late join, trading off/after lap N). Reuse `Choices`/`Toggle` (accessible names =
  labels). Money choices show `money()`.
- Used by `CreateWizard`, `LocalWizard` (online-only rows hidden), `DiscordLobby`, and the owner's Rules tab in
  `WaitingRoom` (`conn.setRules(roomPatch(p))`); `RulesSummary`/`rulesLine` mention non-default options.
- `GameMenu.tsx` `RulesView`: list the new options read-only; fix the raw `Bot · normal` label to use `skillLabel`.
- `GameOver.tsx`: reasons for `firstBankrupt` and `timeUp`; TurnBar/HUD: a small clock when a time limit runs, and the
  jackpot amount on the Tuk-Tuk Stand (HUD chip + 3D label via the board texture or a floating label).
- Trade UI: `tradeProblems` message already flows into TradeBuilder; hide the Trade button when trading is off.
- Keep existing e2e labels unchanged ("Speed Die", "Starting cash", "Turn timer", "Seats", "Who can find it"…).

## Part B — pending UI fixes (button overflow, Start corner)

From the earlier read-only investigation:
- **Buttons**: `src/style.css` sets `button { white-space: nowrap }` globally, so block action buttons with long money
  labels spill. Let block action buttons wrap (`white-space: normal; min-width: 0`), add an `.amt` class
  (tabular-nums, nowrap) and put the amount on a smaller second line in TileInspector (Build/Sell/Mortgage), Auction
  quick-raises, Manage mortgage toggle + Apply; clamp font size on narrow screens; keep 44px touch targets. **Keep
  accessible names identical** (e2e looks up "Mortgage for Rs. 10,000", "Apply (+Rs. 10,000)", "Pay Rs. 5,000",
  "Buy for Rs. 6,000"): keep a literal space between label parts.
- **Start corner** (`drawCorner` in `src/scene/board/drawBoard.ts`): the only corner not drawn on the diagonal; its
  stack sits ~0.13 low and the arrow runs past the tile edge. Redraw on the diagonal like the other corners (salary
  text on two lines, START, a smaller arrow along the direction of play), add a helper for usable width at a point in
  the rotated square and use it for Tuk-Tuk Stand / License please?; centre JUST and VISITING on their own strips and
  give the Police Station Bench label two lines.
- Verify with a throwaway overflow sweep (scrollWidth/clientWidth on every visible button/tab/chip across lobby + all
  `src/dev/game.html` scenarios at 1440×900, 1280×720, 1024×600, 390×844 and panel size 140%) and corner close-ups.

## Execution order
1. Part B (small, independent).
2. A1 engine options + tests + fuzz variation (bump `RULES_VERSION`).
3. A2 room plumbing + DB rules (+ `test-rules.mjs`), then A3 UI.
Parts can go to separate agents with disjoint files (engine+bots / net+DB / lobby+game UI).

## Verification
- `npx tsc --noEmit`, `npx tsc -p e2e`, `npx vitest run` (new per-option engine tests, fuzz with options varied,
  room/doc tests for afkStrikes/botPace/takeSeat/timeLimit, lobby form tests for presets → rules), `npm run build`,
  `npm run sim:bots -- --games 100` (bots handle every option).
- `npm run test:rules` with Java on PATH (`/c/Program Files/Eclipse Adoptium/jdk-21.0.12.101-hotspot/bin`).
- This **is** a breaking change to the room/engine protocol, so run the full `npm run test:e2e` once at the end
  (3 workers), then republish `database.rules.json` to the live Firebase project.
- Manual: Local game with each preset; an online room in two tabs (emulator) with Advanced options set, checking the
  waiting-room Rules tab, jackpot payout, first-lap rule, trading lock, time-limit ending and late-join seat taking.
- Part B: overflow sweep reports zero offenders at all viewports; corner close-up screenshots look centred.
