# Boards (`src/boards`)

Everything that makes one board, in one folder per board: `lanka` (All Island, the default), `colombo`, `hill`,
`south` and `heroes` (Hero League). Each file is read by one layer of the game, so the rules engine never pulls in
three.js or React:

| File | What it holds | Read by |
| --- | --- | --- |
| `rules.ts` | The `BoardDef`: its spaces (a multiple of 4, corners at the quarters), colour groups, prices and rents, both card decks, the Speed Die faces, its player cap (`maxPlayers`), its standard rules (`rules`), the names it shows (`display`) and, for a board with rules of its own, its `heroes` block | the rules engine (`src/rules/board.ts`) |
| `theme.ts` | Its tokens (ids and labels, in seat-slot order: eight on the classic boards, six on Hero League), its bots' names and how long its music loop runs | `src/shared/tokens.ts`, `src/shared/boardThemes.ts` |
| `tokens.ts` | The tokens' 3D shapes, built with the kit in `src/scene/tokens/kit.ts` | `src/scene/tokens/shapes.ts` |
| `icons.tsx` | The tokens' flat icons (24×24 SVG) | `src/ui/game/tokenIcons.tsx` |
| `sounds/` | Its music and effects, each as `.ogg` and `.mp3` (the names in `src/audio/sounds.ts`); a missing one plays All Island's | `src/audio/index.ts` |

Token ids are unique across boards, letters only, and stored in rooms: `database.rules.json` lists every one (a test
checks). A board has at least as many tokens as players (`maxPlayers`), and as many bot names.

## Token sets of different sizes

Slot k of one board's set stands for slot k of another's, so a seat keeps a token of its own when the table changes
board (`tokenOn` in `src/shared/tokens.ts`). A smaller set has fewer slots: `tokensOn` moves a whole table at once,
keeping every slot the new set has and handing the seats on the missing slots its free tokens, so no two seats share
one (only a table larger than the set could). The lobby uses it whenever the board changes, and the game document
when a game starts, so a room and a game never hold another board's token.

## A board with rules of its own (Hero League)

Hero League's `rules.ts` has a `heroes` block; its presence switches the engine to that board's rules
(`docs/heroes.md`), and every other layer keys its own Hero League code off it (`getBoard(board).heroes`), never off
the id. What the other layers do for such a board:

- **Rules it pins** (`HEROES_FIXED`, also its `BoardDef.rules`): `normalizeConfig` forces them whatever a room asks
  for, and the lobby hides them, with the options the board has no use for (`hiddenOptions` in
  `src/ui/lobby/rulesText.ts`). Its presets are its own rules and House rules that only change what it allows.
- **Its tokens are its heroes**: `theme.ts` lists them with the same ids as `heroes.list`. The game document asks the
  engine for each seat's token as its hero (`SeatSetup.hero`), and once the game starts a seat shows the hero it
  plays. Bots and seats added without a pick get a random free hero.
- **Its currency and words**: `display.currency` ("1,500 Power") and `display.terms` (location, save, power-up,
  score...), read through `formatMoney(units, opts, currencyOf(board))` and the UI's term helpers.
- **No sounds of its own**: `boardThemes.ts` gives it All Island's (`sounds: ''`), and `theme.ts` All Island's
  `loopSeconds`.
- **Reaction windows** (a timer of their own kind, `'reaction'`): the net layer closes them with the system
  `closeReact`, never counts them as AFK timeouts, and lets bots answer once the throw has played.

## Adding a board

1. Copy a board's folder and give it a new id (`rules.ts` `id`, and the exported names).
2. Register it: `src/rules/board.ts` (the board picker follows) and `src/rules/index.ts`, `src/shared/tokens.ts`,
   `src/shared/boardThemes.ts`, `src/scene/tokens/shapes.ts` and `src/ui/game/tokenIcons.tsx`.
3. Allow its id and its token ids in `database.rules.json` (`lobby/$room/board`, `rooms/$room/setup/rules/board` and
   the seat `token` rule), and add cases for them to `scripts/test-rules.mjs`.
4. Credit its sounds in `public/credits.html` (or say it plays All Island's), and the board itself in its "The game"
   section when its rules or texts come from somewhere new.
5. Add it to `BOARD_IDS` in `src/rules/__tests__/boards.test.ts`.

`src/rules/__tests__/boards.test.ts` checks every board's shape (corners, groups, prices, decks, cap, rules),
`src/scene/__tests__/tokens.test.ts` every token's size and `src/shared/__tests__/tokens.test.ts` every set (sizes,
bot names, the slot mapping, the database's lists).
