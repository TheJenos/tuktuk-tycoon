# Plan: 3D Tuk-Tuk Tycoon (Classic + Speed Die) with React Three Fiber, built on the shootup-area-fps stack

## Context

The user supplied the Tuk-Tuk Tycoon rulebook (`Downloads/00009.pdf`, the 2007 edition with the Speed Die). They want a browser 3D game that follows those rules, built with **the same technology as their repo [TheJenos/shootup-area-fps](https://github.com/TheJenos/shootup-area-fps)**, except that the 3D layer uses **React Three Fiber** instead of a hand-rolled three.js engine.

The rest of the stack comes from that repo unchanged:
- Vite 8 + React 19 + TypeScript (strict, tsc 7)
- Firebase Realtime Database rooms: lobby, presence, room owner, transactions, invite links
- Bots
- Vitest, plus Playwright end-to-end tests against the Firebase emulator in software WebGL
- GitHub Actions CI
- Netlify hosting and a Discord Activity

The project starts from an empty folder.

**Decisions made with the user**
- Full Classic rules, plus a toggle for the Speed Die rules.
- 2 to 8 seats in online rooms, with bots, like the reference.
- Themed names, all in **one swappable data file**. Since renamed to Tuk-Tuk Tycoon with a Sri Lankan theme.
- Auctions use **timed open bidding**.
- Triples: **move anywhere, then roll again**. This is configurable.
- Discord is included as a later milestone.
- **All milestones are built back to back, then reported at the end.**

**Rules decisions where the PDF is unclear or silent.** Each one is documented in `README.md` under "Rules decisions":
- Income Tax is $200 or 10%. The OCR text says "$900", which is a scan error.
- Luxury Tax is $75, configurable to $100.
- Rent is collected automatically. The physical rule says rent must be asked for before the second following player rolls; that window is dropped.
- Unmortgaging costs `m + ceil(m/10)`.
- Speed die faces are `[1,2,3,bus,uncle,uncle]`.
- Mortgaged railroads and utilities still count toward the rent count.
- Bankruptcy to the bank clears mortgages before the bank auctions the properties.
- A Nearest Utility "fresh throw" uses the white dice plus the speed die when it is active. Bus and Tuk-Tuk Uncle count as 0.
- Cards have the standard pre-2008 deck effects (with Sri Lankan texts), because the PDF contains no card list.

## Step 0: Project home

The scratch workspace is deleted along with the session, so the project needs a permanent folder first:
1. Call `request_directory` so the user can pick a folder, then `change_directory` into it.
2. Run `git init`, then `propose_branch` (for example `feat/tuk-tuk-tycoon`).
3. Check the prerequisites:
   - Node 20 or newer, run with `node -v`.
   - Java, run with `java -version`. The Firebase emulator needs it.
   - If Java is missing, tell the user. Unit tests and offline play don't need it.

## Architecture

```
src/
  rules/            PURE engine: no React, three, or Firebase imports
    data/lanka.ts   THE swappable data file: 40 spaces, rents, both 16-card decks, speedDie faces/labels, display{title, group colours}
    types.ts config.ts board.ts rng.ts create.ts apply.ts flow.ts dice.ts movement.ts landing.ts rent.ts
    cards.ts money.ts buildings.ts mortgage.ts auction.ts trade.ts bankruptcy.ts jail.ts legal.ts autoplay.ts
    invariants.ts codec.ts index.ts  __tests__/
  shared/timing.ts  animBudget(events), phaseSecs(phase, rules): used by both net and view
  net/              firebase.ts (copied from the reference) · db.ts (Db interface, FirebaseDb, MemoryDb)
                    doc.ts (Doc wrapper around apply) · session.ts (GameSession: dispatch, replay, driver lease, timers)
                    network.ts (RoomConnection: lobby, setup, presence, owner, invites, cleanup) · local.ts (offline session)
  bots/             decide.ts valuation.ts landingProb.ts driver.ts (easy | normal | hard | expert)
  state/            store.ts (copy of the reference HudStore + useSelector) · viewStore.ts · uiStore.ts
  view/             director.ts reduceView.ts project.ts handlers.ts   (event animation queue)
  scene/            R3F: Stage, GameScene, BackdropScene, FrameDriver, board/, tokens/, dice/, cards/, fx/, camera/
  ui/               DOM: App, MenuShell, Lobby, RoomBrowser, CreateWizard, StepBar, WaitingRoom, GameView, GameMenu,
                    GameOver, MiniBoard, hud/, deeds/, decisions/, manage/, trade/, SettingsPanel, testHooks.ts
  discord/          patch.ts (imported first) · discord.ts      main.tsx  start.tsx  style.css
netlify/functions/discord-token.mjs   database.rules.json   firebase.json   scripts/test-rules.mjs   e2e/
```

### 1. Rules engine (`src/rules`)

**API**
- `createGame(cfg, seats, seed)`
- `apply(state, cmd, {rng?}) → {ok, state, events} | {ok:false, error}`. It never throws: it runs `structuredClone`, mutates the clone and drains the `pending` step queue.
- `legalActions(state, seat)`
- `awaiting(state)`
- `defaultAction(state, seat)`
- `checkInvariants(state)`

**State shape**
- Players are keyed by **SeatId (`s0`–`s7`)**. The engine never sees player ids.
- `Command = {by: SeatId | 'system', a: Action, basis?: number}`. `basis === seq` is checked only when it is present (bots and chores). Human actions are validated on what they do, not on sequence number.
- The RNG state (mulberry32, uint32) is stored in the game state. **Only `roll`, the utility fresh throw, deck shuffles and `createGame` consume it**, which is an invariant. As a result, replays are deterministic and a player can't reroll by inserting free actions.

**Phases.** A non-turn interruption stores `resume` so the turn continues afterwards.
- `preRoll`, `bus{opts}`, `chooseSpace` (triples: the 39 other spaces), `buy{space}`, `incomeTax` (choose before net worth is shown), `postRoll`
- `auction{lot, high?, passed[], resume}`: lots are a property, a house or a hotel. Open bidding:
  - `bid{amount}` by any active seat that hasn't passed: more than the current high bid, at least 1, at most that seat's cash.
  - `pass`.
  - `closeAuction` is a system command, sent only after the deadline.
  - The auction closes early when everyone except the high bidder has passed. With no bids, the bank keeps the lot.
  - Players can mortgage or sell during an auction to raise cash.
- `place{seat, kind, resume}` places a building won at auction.
- `buildClaim{kind, req, open, resume}` is the shortage contest window. If the requests add up to no more than the bank's supply, all of them are applied. Otherwise units are auctioned one at a time among the requesters, with a minimum bid of $1.
- `mortgageXfer{seat, spaces, resume}` handles receiving mortgaged property by trade or bankruptcy. `settleMortgages{lift[]}`: lifted spaces pay `m + 10%`, kept spaces pay `10%` now and the full `+10%` again later. This replaces the fragile `parLift` window.
- `debt{debtor, owed{seat|'bank': n}, resume}`. It settles automatically once the debtor's cash covers the total owed. `autoRaise` is one deterministic action: sell buildings evenly, then mortgage the cheapest first, then pay, or else go bankrupt.
- `over{winner | ranking}`

**Rules coverage**
- Dice: doubles roll again, and a third doubles sends you to jail without moving.
- GO: $200 for landing or passing, by dice or card. Passing GO and then drawing Advance to GO pays twice.
- Buying: buy at the printed price, or decline and the property goes to auction (the decliner may bid).
- Rent: per the Title Deed. Double rent on unimproved properties of a complete group, even with a mortgaged sibling. A mortgaged property charges none. Railroads pay 25/50/100/200. Utilities pay ×4 or ×10.
- Cards: the top card is applied and goes to the bottom of its deck. Get Out of Jail Free cards are held, tradable, and return to their own deck. Repairs count levels 1–4 as houses and level 5 as a hotel.
- Jail: three ways in, and no salary on the way in. Pay $50 or use a card before rolling, on try 0 or 1. Doubles free you and you move with no extra roll. On the third failure the $50 is forced, then you move by that roll. Jailed players still collect rent, build and trade.
- Buildings: even building, at most 4 houses, a hotel returns its 4 houses. The 32 houses and 12 hotels are checked step by step, so a housing shortage is a real strategy. Selling down is even and refunds half the cost. Taking a hotel back to houses needs houses in the bank.
- Mortgages: only when the group has no buildings.
- Trades: cash, properties in groups with no buildings, and Get Out of Jail Free cards. They are checked again at accept time. Cash-for-nothing (a loan) and cash-for-cash trades are rejected. Each seat may have 1 open offer, and offers are cleared on `endTurn`.
- Bankruptcy to a player: buildings go back to the bank at half price and that cash goes to the creditor; everything else is transferred; `mortgageXfer` follows for the creditor.
- Bankruptcy to the bank: an `auctionQueue` runs first, then `nextTurn`. Several creditors are paid in seat order.
- `resign`: a resignation during a debt pays the creditors first, and the remainder goes to the bank.
- The last active player wins. An optional `turnLimit` ranks players by net worth (on in the simulations), and the owner can "Finish now" when only bots are left.

**Speed Die**
- +$1000 at the start, unlocked by the first GO salary.
- Number faces add to the move.
- Bus: move a, b, or a+b, with duplicates removed.
- Tuk-Tuk Uncle: resolve the first landing, then advance to the next bank-owned property (buy it or auction it). If the bank owns none, advance to the next unmortgaged property owned by another player. If neither exists, stay.
- Triples go to `chooseSpace` and roll again (`triplesRollAgain: true`). The three-doubles jail check runs first.
- Doubles use the white dice only.
- A jail move ends the speed effects for that turn.
- The jail roll uses the white dice only.
- Utility rent uses the sum of all three dice, with Bus and Tuk-Tuk Uncle counting as 0.

**Data and codec**
- `RulesConfig` fields are typed as `number` or `boolean`, not literals, and `normalizeConfig()` clamps them.
- `codec.ts` is JSON encode and decode plus `RULES_VERSION` plus defaults.

### 2. Multiplayer (`src/net`): every client commits its own actions

**The transacted document** (`rooms/{code}/state = {gid, seq, v, at, data}`):
- `data` is the JSON string of `Doc = {game, seats{ctrl, kind, skill, afk, name, token, colour}, ids[16], recent[≤8], deadline{key, at}}`.
- A JSON string avoids all of RTDB's problems with arrays, nulls and empty values.

**Dispatch**
1. `runTransaction` runs `{applyLocally:false}`. It resets its result on every retry, returns `null` when `cur === null`, and aborts on a version mismatch, a duplicate envelope id, a seat whose `ctrl` isn't this player, or a basis that doesn't match.
2. It applies the action and computes the `deadline` inside the transaction: `at + animBudget + phaseSecs`. Each auction bid resets the deadline to at least `at + 8s`.
3. After the commit, the client writes `log/m000123` once, best effort.

**Events from replay.** On seq N+1, each client runs `apply(prev, doc.recent.at(-1))`. That one step both produces the animation events and checks the hash for tampering. Gaps of 8 seqs or fewer are replayed from `recent`; larger gaps trigger `director.snap()`.

**Roles**
- **Owner (`hostId`)** handles admin only: rules, bot seats, start, kick, assigning a seat, and "let a bot play". It is elected with the reference's `updateOwner`, which waits until both `members` and `hostId` have loaded and prefers seated humans.
- **Driver lease (`rooms/{code}/driver{pid, until}`)** handles chores: bot moves, timeouts, `closeAuction`, and mirroring status to the lobby.
  - The lease is taken by transaction, renewed every 2 s, and lasts 6 s. It never uses `onDisconnect`.
  - The owner is preferred. A hidden tab may take the lease if no visible tab has done so within 10 s.
  - The driver releases the lease itself if its renew ticks run more than 3 s late, which catches background throttling.
  - Work is scheduled from `onValue` callbacks.
  - Fallback timeouts from other clients are staggered (+5 s, plus 1 s per rank). Each one checks `basis` and `key`, so it fires exactly once.

**Lifecycle**
- Creating a room uses `createRoomWithCode` in a transaction (5 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`).
- Joining while waiting claims a seat by transaction (enforcing `maxSeats` and unique tokens). Presence uses `onDisconnect`: arm it first, then write, and register again on reconnect.
- Joining while a game is running rejoins your seat, or opens the game read-only as a spectator.
- Start is idempotent per `gid`.
- Rejoin uses sessionStorage `tuktuk-session` plus localStorage `tuktuk-seats` (kept 7 days).
- Two timeouts in a row mark a seat AFK, and the driver plays it as a Normal bot until "Take back control".
- Cleanup: an empty waiting room is deleted once it has had no members for more than 60 s, after reading it again. An empty game in progress is kept for 24 h after its last move.

**Offline play.** "Play now vs bots" uses `createLocalSession` over `MemoryDb`: the same session and driver code, with no Firebase. It autosaves to `tuktuk-solo-save` and works when `isConfigured` is false.

**`database.rules.json`**
- `state`: `seq` must increase by exactly 1; a new `gid` only with `seq` 0 while the room is waiting; `data` is a string of 64 KB or less; `at <= now + 5000` and `at` never goes backwards.
- `log`: write-once, with keys matching `m\d{6}`.
- Ids match `^[pdb]_[A-Za-z0-9_-]{6,40}$`, names are 16 characters or fewer, setup values are enums and ranges.
- Room keys match `^[A-Z0-9]{5,8}$`, with `$other:false`.
- `debug` can only be set by e2e admin seeding.

**Trust model.** Clients are trusted, as in the reference. Replay verification makes tampering visible, and seeds and deck order are readable in the database (documented). A later phase could add Anonymous Auth plus a Cloud Function. The same reducer would still work.

### 3. Bots (`src/bots`)

`decide(state, seat, skill)` is pure and returns only legal actions. It uses three helpers:
- a landing-probability table from a precomputed Markov steady state;
- `reserve`, the cash to keep: expected rent from opponent squares 2–12 steps ahead;
- `valuation`, which rewards completing or blocking a colour set.

Behaviour by skill:
- **Easy, Normal, Hard** follow these rules:
  - buy using the reserve;
  - set an auction maximum and raise by small steps;
  - build evenly, with Hard holding at 4 houses to keep the bank short;
  - raise cash in a fixed order;
  - jail strategy: leave early, then stay in jail once opponents have built;
  - trades: Normal and above propose swaps that complete a set for both sides.
- **Expert** adds Monte-Carlo rollouts with the engine, capped at about 50 ms per decision.

Pacing and limits:
- Bots wait `max(think(skill), animBudget(events))` before acting.
- They build, unmortgage and trade only at the start or end of their own turn.
- At most 1 trade proposal per turn, and never the same rejected offer twice.

### 4. R3F scene and DOM UI

**Packages.**
- `@react-three/fiber ^9.8` and `@react-three/drei ^10.7`.
- Drei is limited by an ESLint allowlist to `CameraControls`, `RoundedBox`, `Instances`, `useCursor` and `PerformanceMonitor`. Nothing that fetches from a CDN, and no troika text, so it stays safe under Discord's CSP.
- Rapier comes through the reference's `#rapier` imports map, with `vite-plugin-wasm`.
- React, react-dom and their types are pinned to `~19.3.1` with npm `overrides`, because R3F 9 needs React below 19.4.
- Code splitting uses rolldown `codeSplitting.groups`, as the reference does.

**State flow**
1. GameSession emits `{seq, events, state}`.
2. `gameStore` holds the logical state.
3. `director` plays the events in order, one handler at a time with an `AbortSignal`.
4. `viewStore` holds what is displayed and is snapped to `project(state)` after each batch.
5. `uiStore` holds local UI state.

Details:
- Decision prompts appear only once `director.idle` is set, so the Buy prompt appears after the token lands.
- Playback speeds up 1.5× or 3× when batches back up.
- `fastForward` runs when the tab is hidden, and handlers resolve instantly when animation is set to `instant`.
- The view never re-renders React per frame: motion lives in mutable tracks read inside `useFrame`.

**Scene.** There is one persistent `<Stage>` canvas with `frameloop="demand"` and a `FrameDriver` that calls `invalidate()` while anything moves. It shows either the lobby backdrop or the game.
- Board:
  - `layout.ts`: `tileCenter`, `tileAt` and `slotPos`. Play runs clockwise from GO at the bottom right.
  - The board top is one `CanvasTexture`, 4096 px (2048 on low quality). Bands, names and prices come from the data file, with Path2D icons and a bundled OFL font.
  - Tiles are picked with one invisible plane.
- Tokens: 8 procedural low-poly pewter tokens with a base ring in the seat colour, each matched by an SVG icon. They hop along the path, walk backwards, and jump only when going to jail.
- Pieces: instanced houses (32) and hotels (12), owner chips, mortgage stamps, and jail bars.
- **Dice**:
  1. Simulate a Rapier throw headless, seeded by `hash(gid, seq)`, and record the frames.
  2. Find the face that lands on top, and rotate the visual mesh by a fixed correction so the engine's value ends up on top.
  3. Retry if a die is cocked. If Rapier fails or quality is low, fall back to a kinematic tumble.
  4. Speed die faces show 1, 2, 3, a bus and a generic glyph. `DiceReadout` announces the result through `aria-live`.
- Camera: `CameraControls` with overview, follow and focus modes. Padding is measured from the DOM panels. Moving the camera by hand turns automatic framing off until Recenter (`C`).
- Effects:
  - `CardFlight` flips the drawn card toward the camera.
  - `FloatingLabels` shows amounts like "+$200".
  - `TileHighlights` marks legal targets for the Bus choice and triples.
- Quality tiers: low (the default on touch), medium and high, setting dpr, shadows, texture size and dice physics.
- WebGL context loss switches to the DOM `MiniBoard`. Every action is in the DOM, so the game stays playable without 3D.

**DOM.** Same style as the reference: glass panels, `--accent`, `ConfirmButton`, `useDialogFocus`, and capture-phase Esc layering.
- Game screen panels:
  - TurnBar, ActionBar, PlayersPanel, TitleDeed, BuyPrompt.
  - AuctionModal: an open bid ladder (+$1, +$10, +$100, or a custom amount), a countdown and Pass.
  - TradeBuilder and TradeOffer (accept, decline or counter).
  - ManageProperties: staged build, sell and mortgage changes with even-build hints.
  - JailPanel, IncomeTaxPrompt, MortgageXferPrompt, DebtPanel, BankruptcyDialog, CardModal, BusChoice, TilePicker.
  - EventLog (`role=log`), GameMenu (Esc), GameOver.
- Lobby screens:
  - MenuShell: Play now vs bots, Continue solo game, and Rooms, Create and Settings in the side menu. There is no leaderboard.
  - RoomBrowser (search, join by code), invite links (`?room=` / `#CODE`, with an auto-join countdown), CreateWizard (Rules → Seats → Launch) and WaitingRoom.
- Keyboard shortcuts: R roll, E end turn, B buy, A auction, M manage, T trade, L log, C recenter, Esc menu.
- Settings additions: `animSpeed`, `dicePhysics`, `autoCamera`, `showNetWorth`, `quality`, `reduceMotion`.
- Breakpoints follow the reference, with a bottom sheet on phones.
- `window.game` in dev and e2e builds: `{joined, roomCode, me, seq(), state(), view(), idle(), flush(), mySeats(), dispatch(), test:{rig, setCash, pickTile, hoverTile, openDeed}}`. `rig` and `setCash` are debug actions, accepted only when `cfg.debug` is set.

### 5. Discord and Netlify

Copied from the reference:
- `discord/patch.ts` is imported first and rewrites requests through the proxy.
- `netlify/functions/discord-token.mjs` holds the client secret. It lives only in the Netlify environment and never goes in the code.
- Room code = `D` + 7 base32 characters of SHA-256(instance id). A player gets a free seat automatically, or else spectates.
- `netlify.toml` and its cache headers.
- The README Setup section lists the Discord portal steps for the user.

## Build order

The milestones run back to back. Each one must meet its exit criteria before the next starts.

| M | Scope | Exit criteria |
|---|---|---|
| 0 | Scaffold: package.json, configs, CI workflows, emulator config, `.env.example`, `.env.emulator`, `.env.e2e`, Playwright with SwiftShader flags, a `<Stage>` with a plain board | `build`, `typecheck` (R3F JSX types under tsc 7, with `skipLibCheck`), `test`, and 1 e2e smoke test pass |
| 1 | Engine core: data, rng, create, roll, move, land, buy, open auction, rent, tax, cards, jail, debt, `autoRaise`, bankruptcy, resign, `legal`, `defaultAction`, invariants, codec; `npm run sim` | Vitest `data`, `rng`, `move`, `cards`, `rent`, `tax`, `auction`, `jail`, `bankrupt`; fuzz test (30 seeds × 3000 steps): invariants, JSON round trip, size under 48 KB |
| 2 | Offline playable: `MemoryDb`, `doc.ts`, local session, director, board texture, tokens, kinematic dice, core DOM HUD, Normal bot, MiniBoard, autosave | Play now vs bots runs to game over; e2e `solo` (no requests to `:9000`, reload resumes); `reduceView` drift test |
| 3 | Property management: build and sell, shortage `buildClaim`, mortgage and `mortgageXfer`, trades, Get Out of Jail Free sales; Manage, Trade and TitleDeed UI; bot build, raise-cash and trade; `turnLimit` | `build`, `mortgage` and `trade` suites; `sim:bots` (100 games) all finish |
| 4 | Speed Die: engine rules, BusChoice, TilePicker, red speed die | `speed.test` (unlock, Bus, Tuk-Tuk Uncle branches, triples re-roll, utility 3-dice sum) |
| 5 | Online: FirebaseDb, RoomConnection, session dispatch, replay, driver lease, timers; Lobby, Rooms, Invites, Wizard, WaitingRoom; `database.rules.json` and `test-rules.mjs` | `MemoryDb` race tests (duplicate id, basis race, timeout exactly once, lease handover, owner election); rules table; e2e `lobby`, `waiting-room`, `turn`, `auction` (concurrent bids), `trade`, `debt`, `reconnect`, `host-migration`, `timeout`, `spectator` |
| 6 | Discord + Netlify | Discord e2e smoke test, as in the reference |
| 7 | 3D polish: 8 tokens, Rapier dice with remap, camera modes, instanced buildings, chips and stamps, card flight, floating labels, backdrop, quality tiers, context-loss fallback | `remap` test (36 face pairs), `layout` round trip, e2e check that only allowed network hosts are contacted |
| 8 | Bots and extras: Easy, Hard and Expert; AFK takeover and resume; tamper banner; rematch; phone layout | `sim:bots`: Hard beats Easy at least 65% of the time; e2e `tamper`, `rematch`, `touch` |

## Reused patterns from the reference repo

Read with `gh api repos/TheJenos/shootup-area-fps/contents/<path>`:
- `src/net/firebase.ts`: copy as is (`isConfigured`, emulator switch).
- `src/net/network.ts`:
  - `randomId` / `CODE_CHARS`, `createRoomWithCode` (transaction)
  - `registerPresence` (arm `onDisconnect`, then write, again on reconnect; `left` flag)
  - `updateOwner` (wait until both are loaded; only the heir writes)
  - `mutateGame` / `normalizeGame` / `serverNow`, `watchRooms` cleanup.
- `src/game/session.ts`: rejoin. `src/ui/playerName.ts`: `NAME_PATTERN`, `fps-name`, renamed to `tuktuk-name`.
- `src/game/hudStore.ts`: the `useSyncExternalStore` store. `src/game/settings.ts`: the `load()`/clamp pattern.
- `src/ui/MenuShell.tsx`, `StepBar.tsx`, `ConfirmButton.tsx`, `useDialogFocus.ts`, `useCountdown.ts`, `colors.ts`, `style.css` variables.
- `src/discord/*`, `netlify/functions/discord-token.mjs`, `netlify.toml`.
- `vite.config.ts` (`#rapier`, wasm, `codeSplitting`), `playwright.config.ts`, `e2e/support/{db,fixtures,player,ui}.ts`, `scripts/test-rules.mjs`, `.github/workflows/*.yml`.

## Verification

1. **Unit and logic tests**, run with `npm test` (Vitest):
   - every engine suite listed above
   - the fuzz test
   - net race tests over `MemoryDb`
   - bot scenario tests
   - `layout`, `remap` and director tests.
2. **Simulation:** `npm run sim:bots` (100 four-bot games end, with invariants held throughout).
3. **Database rules:** `npm run test:rules` (emulator; needs Java).
4. **End to end:** `npm run test:e2e` (Playwright plus emulator, two-browser `table()` fixture, rigged dice through `game.test.rig`).
5. **Manual check in the in-app browser:**
   1. Add `.claude/launch.json` entries for `vite --mode emulator` (port 5173), with the emulator running in a terminal.
   2. Play a solo game against 3 bots to the end, once with the Speed Die on and once with it off.
   3. Open two tabs and run an online room: create, invite, auction bidding from both tabs, a trade, a mortgage, a bankruptcy, closing the host tab (the driver hands over and the bots keep playing), and a reload that rejoins.
   4. Take screenshots of the board, dice landing, the auction modal and the trade builder.
6. **Build:** `npm run build && npm run typecheck`, and check the chunk sizes.
7. **Report:** at the end, report the test results, then list what the user must set up themselves:
   - a Firebase project and `.env`
   - the Discord app and URL mappings
   - the Netlify secrets.

   The user handles these; no secrets are entered by Claude.
