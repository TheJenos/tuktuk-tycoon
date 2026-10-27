# Boards (`src/boards`)

Everything that makes one board, in one folder per board: `lanka` (All Island, the default), `colombo`, `hill` and
`south`. Each file is read by one layer of the game, so the rules engine never pulls in three.js or React:

| File | What it holds | Read by |
| --- | --- | --- |
| `rules.ts` | The `BoardDef`: its spaces (a multiple of 4, corners at the quarters), colour groups, prices and rents, both card decks, the Speed Die faces, its player cap (`maxPlayers`), its standard rules (`rules`) and the names it shows (`display`) | the rules engine (`src/rules/board.ts`) |
| `theme.ts` | Its eight tokens (ids and labels, in seat-slot order), its bots' names and how long its music loop runs | `src/shared/tokens.ts`, `src/shared/boardThemes.ts` |
| `tokens.ts` | The tokens' 3D shapes, built with the kit in `src/scene/tokens/kit.ts` | `src/scene/tokens/shapes.ts` |
| `icons.tsx` | The tokens' flat icons (24×24 SVG) | `src/ui/game/tokenIcons.tsx` |
| `sounds/` | Its music and effects, each as `.ogg` and `.mp3` (the names in `src/audio/sounds.ts`); a missing one plays All Island's | `src/audio/index.ts` |

Token ids are unique across boards and stored in rooms: `database.rules.json` lists every one (a test checks).

## Adding a board

1. Copy a board's folder and give it a new id (`rules.ts` `id`, and the exported names).
2. Register it: `src/rules/board.ts` (the board picker follows), `src/shared/tokens.ts`, `src/shared/boardThemes.ts`,
   `src/scene/tokens/shapes.ts` and `src/ui/game/tokenIcons.tsx`.
3. Allow its id and its token ids in `database.rules.json` (`lobby/$room/board`, `rooms/$room/setup/rules/board` and
   the seat `token` rule).
4. Credit its sounds in `public/credits.html`.

`src/rules/__tests__/boards.test.ts` checks every board's shape (corners, groups, prices, decks, cap, rules), and
`src/scene/__tests__/tokens.test.ts` every token's size.
