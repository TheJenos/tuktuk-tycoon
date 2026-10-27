# Plan: Each board owns its tokens, sounds, bot names, size, player cap and rules

## Context

Today the four boards (All Island `lanka`, Colombo, Hill Country, Down South) are the **same 40-space board with
different names** (`src/rules/__tests__/boards.test.ts` even enforces that). Tokens, token icons, music, sound
effects, bot names, the 2–8 player cap and the rule presets are all global. The user wants each board to be its
own package: **its own 8 tokens (3D + icon), its own music and effects, its own bot names, its own size (smaller /
larger board) and matching max players, and its own default rules (still editable)**.

Decisions already made with the user: **real board sizes** (different numbers of spaces) and **new CC0 audio found
online** (each download listed for approval first).

## The four boards

| Board | Spaces | Players | Physical size | Rules (its "Standard", still editable) |
|---|---|---|---|---|
| Colombo (city) | **32** (7 between corners) | **2–4** | smaller (≈11 units across) | quick city game: start Rs. 120,000, Start Rs. 15,000, 24 houses / 8 hotels, Speed Die on |
| Hill Country | **36** (8 between corners) | **2–6** | a little smaller (≈11.6) | classic, cooler economy: jail fine Rs. 7,500, 28 houses / 10 hotels |
| All Island (default) | **40** (unchanged) | **2–8** | unchanged (12.2) | today's Classic rules, unchanged |
| Down South | **48** (11 between corners) | **2–8** | larger (≈13.4) | long beach game: start Rs. 200,000, jackpot on, 40 houses / 16 hotels |

Space mix (corners always at 0, n/4, n/2, 3n/4; GO stays at 0; jail at n/4; Go-to-jail at 3n/4):
- 32: 6 colour groups (2,3,3,3,3,2 = 16 streets), 4 stations, 2 boards (utilities), 2 taxes, 2 + 2 card spaces.
- 36: 7 groups (2,3,3,3,3,3,2 = 19 streets), 4 stations, 2 boards, 2 taxes, 3 + 2 card spaces.
- 48: 10 groups (2,3,3,3,3,3,3,3,3,2 = 28 streets), 4 stations, 2 boards, 2 taxes, 4 + 4 card spaces.
Prices/rents come from the classic tier table (subset for 6/7 groups, two interpolated tiers for 10). Each board
keeps its own themed names and card texts; card targets (`advance {to}`) re-pointed to the new indices.

Tokens (8 per board, unique ids across boards; All Island keeps today's 8):
- Colombo: red city bus, Lotus Tower, clock tower, crow, hopper, isso prawn, briefcase, traffic cone
- Hill Country: steam train, Adam's Peak, Nine Arch bridge, tea basket, strawberry, umbrella, leech, sambar deer
- Down South: stilt fisherman, sea turtle, surfboard, Galle lighthouse, palm tree, devil mask, crab, conch shell

Bot names (8 per board, themed, e.g. Colombo: Dinesh, Tharindu, Ishara, Malsha…; Hill: Sunil, Pushpa, Muthu,
Kumari…; South: Sampath, Nadeeka, Lahiru, Hiruni…). All Island keeps Nimal, Kamala, Kasun… (tests/e2e use them).

## Approach

### 1. Board-owned settings (no size change yet)
- `src/rules/types.ts` `BoardDef`: add `maxPlayers: number` and `rules: Partial<RulesConfig>` (the board's
  standard rules). `createGame` (`src/rules/create.ts`) rejects more seats than `board.maxPlayers`.
- New `src/shared/boardThemes.ts` (presentation, not engine): per board id → `tokens: TokenId[8]`,
  `botNames: string[8]`, `sounds: string` (folder). `src/shared/tokens.ts` becomes the registry of all 32 tokens
  (`TOKENS`, `isTokenId`, `tokenLabel`), plus `boardTokens(board)` and `tokenOn(board, id)`: a token from another
  board shows as **the same slot (index 0–7) of this board's set**, so changing the board in a waiting room needs
  no seat rewrites and tokens stay unique per seat.
- Lobby (`src/ui/lobby/RulesForm.tsx`, `LocalWizard.tsx`, `CreateWizard.tsx`, `SeatsEditor.tsx`, `seats.ts`,
  `TokenPicker.tsx`, `WaitingRoom.tsx`, `DiscordLobby.tsx`):
  - Picking a board applies its standard rules (the "Classic" preset becomes "<Board> rules"; Fast / House rules
    apply on top of the board's standard; Custom stays editable).
  - Seat count capped by the board (seat chooser, "N of M seats", add buttons); a board too small for the seats
    already chosen is shown disabled with the reason.
  - Token pickers show the board's 8 tokens; default bot names come from the board (untouched default names follow
    a board change; renamed bots keep their names).
- Network (`src/net/network.ts`): remove its private `BOT_NAMES`; `create`/`addBot` use the room board's names,
  `freeToken`/`claimSeat`/`setSeatToken` use the board's tokens, `maxSeats` clamped to the board's cap; `setRules`
  refuses a board smaller than the seats taken. `src/net/session.ts`, `local.ts` follow.
- `database.rules.json`: token rule becomes a pattern (`/^[a-z][A-Za-z]{1,15}$/`) instead of the 8-id list.

### 2. Size-aware 3D board (all boards still 40 here, so nothing visible changes yet)
- Replace the fixed constants in `src/scene/board/layout.ts` with `geometry(n)` (memoized): `perSide`, `tileW`,
  `side`, `half`, `inner`, `jail = n/4`, `jailCell`, centre (`decks`, `throwHalf`, banner scale) and every
  position function (`sideOf`, `isCorner`, `localCenter`, `tileCenter`, `tileSize`, `tileAt`, `slotPos`,
  `buildingPos`, `chipPos`, `tileBounds`, `travelYaw`). Size: `side = 12.2·√(n/40)`; tile width
  `(side − 2·CORNER)/(n/4 − 1)`; the centre (decks, dice walls from `src/scene/board/centre.ts`, banner) scales with
  `inner/4.5`.
- `useGeometry()` hook (board from `useView(v => v.game?.cfg.board)` → `getBoard().spaces.length`). Pass the geometry
  to: `drawBoard.ts` (incl. `i % 10` corners, centre banner), `Board.tsx`, `TileHighlights.tsx`, `Spotlight.tsx`,
  `Pieces.tsx` (instance caps = n), `BoardPicker.tsx`, `JailBars.tsx`, `Tokens.tsx` (`JAIL` → `geo.jail`),
  `tokens/hop.ts`, `cards/Cards.tsx` (deck poses), `dice/simulate.ts` + `Dice.tsx` (walls, deck colliders, spawn),
  `camera/framing.ts` (`BOARD_AREA` → `boardArea(geo)`, `laneAzimuth(geo, path)`), `CameraRig.tsx`, `Lights.tsx`
  (shadow box from `half`). Board-dependent one-time builds (`TileHighlights`, `JailBars`) re-run on board change.
- The menu backdrop (`BackdropScene.tsx`) keeps All Island.
- `src/ui/game/MiniBoard.tsx` is already size-aware (just fix its comment).

### 3. New board layouts (Colombo 32, Hill Country 36, Down South 48)
- Rewrite `src/rules/data/colombo.ts`, `hill.ts`, `south.ts` per the table above; `lanka.ts` unchanged.
- Generalise the few engine spots that assume 40 in comments/limits (`board.ts` "1-40", `types.ts` "0-39",
  `rulesText.ts` supply presets scale with the board's street count).
- `RULES_VERSION` 4 → 5 (`src/rules/config.ts`); version-4 saves/rooms carry on only on All Island (same board);
  old Colombo/Hill/South saves are dropped with the existing "can't continue" path (`src/net/local.ts`,
  `src/net/doc.ts`, `src/rules/codec.ts`).
- `boards.test.ts`: replace "every theme equals lanka" with structural checks per board (corners, groups,
  card targets valid, rails ≤ `railRent` length, maxPlayers, rules within ranges) plus a seeded full game per board.

### 4. Tokens (24 new)
- Per-board files: `src/scene/tokens/shapes/{colombo,hill,south}.ts` (three.js primitives / extrusions, same budget
  as today: ≈0.5 tall in a 0.2 radius, 150–1500 triangles, on the shared plinth) and
  `src/ui/game/tokenIcons/{colombo,hill,south}.tsx` (24×24 SVG). Registered in `shapes.ts` / `tokenIcons.tsx`.
- `src/scene/__tests__/tokens.test.ts` already loops `TOKENS`, so it checks all 32 automatically.
- Can be done by three parallel agents (one per board, separate files).

### 5. Audio (CC0, downloaded only after approval)
- Research CC0 packs (e.g. other Kenney packs: Music Jingles' steel-drum / pizzicato / 8-bit styles, RPG Audio,
  Impact Sounds, UI Audio; CC0 music loops on OpenGameArt) and pick, per board, an intro jingle, a music loop,
  stingers (win/lose/jail/bankrupt/jackpot/buy/sold) and effects. **Present the list (name, source URL, licence,
  size) for approval before any download.** Downloads go to a fresh scratch dir; trimmed/re-encoded with the
  installed `ffmpeg` to OGG + MP3 into `public/sounds/<board>/` (All Island keeps `public/sounds/`).
- `src/audio`: URL becomes `sounds/<folder>/<name>`, falling back to the shared root; buffer cache keyed by
  board+name; per-board `LOOP_SECONDS`; `setAudioBoard(id)` switches music (crossfade) and preloads effects. It
  follows the game's board in play, the board picked in the wizards / waiting room, else All Island.
- `public/credits.html`: per-board sound credits.

## Verification
- `npx tsc --noEmit`, `npx tsc -p e2e --noEmit`, `npm test` after every phase (layout/framing tests parametrised for
  n = 32/36/40/48; boards/tokens tests).
- Bot sims per board: `npm run sim:bots -- --games 40 --players 4 --skills easy,normal,hard,expert --options`
  (invariants on) on each board (add a `--board` flag to `scripts/sim-bots.ts`), plus the Expert check
  `--players 2 --skills hard,expert --games 600 --jobs 8 --fast --expect expert=0.57`.
- Browser (dev server + `/src/dev/game.html?board=…`): each board renders at its size, tokens/icons, mini board,
  spotlight, camera lanes, dice stay inside the centre, cards land on decks; Local game wizard caps seats per
  board and applies its rules; waiting-room board switch remaps tokens; music/effects change per board.
- e2e (`npx playwright install` needed locally) after the DB rules change: `npm run test:rules`.

## Order of work
1 → 2 → 3 → 4 (parallel agents) → 5 (after audio approval). Each phase ends green and runnable.
