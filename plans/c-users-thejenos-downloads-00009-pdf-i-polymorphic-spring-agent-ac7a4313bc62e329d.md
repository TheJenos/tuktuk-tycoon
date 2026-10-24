# Plan: button text overflow + Start corner centring

Plan mode was on, so this is static analysis only. Nothing has been edited or run yet; the Playwright sweep still has to be run.

## Findings so far

### Board corners (src/scene/board/drawBoard.ts, `drawCorner`, lines 91-160)
Local corner frame: square from -0.8 to 0.8 (CORNER = 1.6). The outer edges are +x/+y and the inner corner is (-0.8,-0.8). `diagonal()` rotates by -45 degrees, so text reads from the outer corner.

- **Start (go)** is the only corner that is not on the diagonal, and its stack is off-centre and runs off the tile:
  - The salary line sits at y=-0.5 (size 0.11, width 1.376).
  - The name sits at y=-0.05 (size 0.62).
  - The arrow is at y=0.48 with size 1.1. The arrow path covers y 20..80 of its 100 box, so it spans y 0.15..0.81 and crosses the 0.8 bottom edge.
  - The content runs from about -0.56 to 0.81, so its centre is about 0.13 below the tile centre. There is no margin at the bottom and the top is empty.
- **Tuk-Tuk Stand (parking) and "License please?" (goToJail)** are diagonal and the stack is centred at -0.46 / 0.02 / +0.46. However, the width limit is `CORNER*0.9 = 1.44`. Inside the 45-degree diamond, a 0.22-tall line at t=0.46 only has `2*(0.8*sqrt2 - 0.46 - 0.11) ~= 1.12` of width. So a longer word would run off the tile. With today's words they fit by luck.
- **Police Station Bench (jail):**
  - "VISITING" is centred at x=-0.1, but the free part of its leg runs from -0.8 to 0.25, whose centre is -0.275. "JUST" has the same problem on the other leg. Both words are off-centre and can run into the corner square.
  - The cell plate is 0.84x0.2 and holds one line at 0.15. "POLICE STATION BENCH" shrinks to about 0.07, which is tiny.
- Note: the corner names in the data (src/rules/data/lanka.ts) are "Start", "Police Station Bench", "Tuk-Tuk Stand" and "License please?". They are not "Free Tuk-Tuk Stand" or "Caught Without a Helmet" as the report says.

### Buttons: root cause
- `src/style.css:94` sets `button { white-space: nowrap; }` globally. Any button that is narrower than its text spills out of its box.
- Money is now formatted like "Rs. 150,000". Likely offenders, from reading the code:
  1. **Tile inspector** (`TileInspector.tsx:67-72`): "Build hotel (Rs. 20,000)", "Sell house (+Rs. ...)", "Lift mortgage (Rs. 8,300)", "Mortgage (+Rs. ...)". The dialog is 400px wide and `.inspector-action` is `flex: 1 1 140px; min-width: 0`, so each column is about 176px. The nowrap labels are about 190-210px, so they overflow (certain at 390px wide too).
  2. **Auction bid buttons** (`AuctionModal.tsx:121-133`): "+Rs. 1,000 (Rs. 151,000)" with `.bid-row .action-row button { flex: 1 1 0 }` and nowrap. On a phone they overflow the bid row.
  3. **Manage: mortgage toggle chip** (`ManageProperties.tsx:183-194`): "Lift −Rs. 8,300 (undo)" / "Mortgage +Rs. 10,000 (undo)". It is a `.chip` (nowrap, 13px) inside `.space-row`, at phone width.
  4. **Manage foot "Apply (+Rs. 10,000)"** next to the summary and Reset in `.dialog-foot`, at phone width.
  5. **Buy prompt** "Buy for Rs. 40,000 [B]", **Jail** "Pay Rs. 5,000", **Income tax** "Pay Rs. 20,000". These are in `.action-row` (which wraps), so they only overflow if one button is wider than the prompt (390px or 140% panel size).
  6. Possible lobby items: `.wizard-steps button` (18px uppercase, nowrap), `.wizard-foot .create-button { min-width: 240px }`, `.code-join button`, and `.menu-tab` at 1024x600 and 390. These need the sweep to confirm.

### Accessible names e2e depends on (keep them identical; plain `tsc -p e2e` will not catch a change)
- `/^Buy for Rs\. 6,000/`
- `'Mortgage for Rs. 10,000'` (exact)
- `'Apply (+Rs. 10,000)'` (exact)
- `'Pay Rs. 5,000'`
- `/^Mortgage for/`
- `/^Build on .../` (stepper aria-label, untouched)
- `'Pass'`, `/^Manage/`, `/^Trade/`, `/^Roll/`, `/^Auction/`

**Rule:** when I split a label into a main span and an amount span, keep a literal space text node between them, or keep the same visible text order, so the computed name does not change. Re-check these with a quick `getByRole(...)` in the throwaway sweep script.

## Steps

1. **Sweep script (before)**
   - Write `C:/Users/TheJenos/tmp-sweep/sweep.mjs`, outside the repo. Use `@playwright/test`'s `chromium` from the repo's node_modules, passing the path as an argument.
   - Start `npx vite --port 5199 --strictPort` in the background.
   - For each viewport:
     - 1440x900, 1280x720 and 1024x600.
     - 390x844 with `hasTouch` and `isMobile`.
     - 1280x720 with Settings → panel size 140%. Find how the panel size is stored in `src/ui/settings.ts` and set it via localStorage or the UI.
   - For each page:
     - Lobby `/`: Play now, Local game Rules/Seats/Start, Rooms, Create room steps, Settings.
     - `/src/dev/game.html?gl=0&anim=fast&scenario=X` for X in start, buy, tax, bus, triple, auction, jail, debt, xfer, claim, over, trades (`&pace=500`), build. Use `seats=hhbb` for the pass card.
     - Then open Manage, Trade, the game menu (all tabs), settings, and the tile inspector on an owned street. Use `build`/`debt` so that Build hotel, Sell and Lift mortgage show.
   - The check runs in `page.evaluate`. For every visible `button, [role=button], [role=tab], .chip`:
     - It flags `scrollWidth > clientWidth + 1` or `scrollHeight > clientHeight + 1`.
     - It flags any descendant rect outside the button rect by more than 1px.
     - It flags any button rect outside its nearest scroll/dialog container.
     - It flags `text-overflow: ellipsis` with `scrollWidth > clientWidth`.
     - It logs the viewport, page/state, a short selector and the text, and screenshots the worst ones to `tmp-sweep/shots/`.
   - View the shots.
2. **CSS fixes** (src/style.css, game HUD section; src/ui/lobby/lobby.css for lobby offenders)
   - Keep the global nowrap, so that short buttons still stay on one line. Add block-action opt-ins:
     ```css
     .prompt .action-row button, .inspector-action button, .bid-row .action-row button, .dialog-foot button { white-space: normal; overflow-wrap: anywhere; min-width: 0; line-height: 1.2; text-align: center; }
     ```
   - Add `.amt { font-variant-numeric: tabular-nums; white-space: nowrap; }` so that an amount wraps as a whole unit.
   - Mortgage toggle: `.mortgage-toggle { white-space: normal; text-align: center; max-width: 100%; }`. On phones, `.space-row .mortgage-toggle { flex: 1 1 100%; }`.
   - Narrow screens (existing max-width media block near style.css:1360-1400): set `.prompt .action-row button, .inspector-action button { font-size: clamp(13px, 3.6vw, 15px) }`. Keep `min-height: 44px` on touch, which already exists at style.css:1400.
   - Lobby offenders (only if the sweep confirms them): `min-width: 0` / `flex-wrap` on their rows, and `white-space: normal` on `.wizard-foot .create-button`.
3. **Markup fixes** (put the amount in a sub-label; keep accessible names)
   - `TileInspector.tsx`: render `{verb}{' '}<span className="amt">{amount}</span>` with CSS `.inspector-action .amt { display: block; font-size: 0.85em; opacity: .85 }`. The label then becomes "Build hotel" with "Rs. 20,000" below it, and the visible text and name stay the same.
   - `AuctionModal.tsx`: already has `<small>({money(n)})</small>`. Make it `display: block` under 480px so that the total sits on its own line.
   - `ManageProperties.tsx` Apply: `Apply{' '}<span className="amt">(+Rs. ...)</span>`. The name stays "Apply (+Rs. 10,000)".
   - Buy/Jail/Tax: just add `className="amt"` spans around the amounts, with no text change.
4. **Start corner** (`drawBoard.ts`)
   - Add a helper:
     ```ts
     const R = CORNER / Math.SQRT2; // half-diagonal
     const diamondW = (t: number, h: number, pad = 0.08) => Math.max(0, 2 * (R - Math.abs(t) - h / 2) - pad);
     ```
     It gives the usable width at offset t across the diagonal, inside the rotated square.
   - Redraw `go` inside `diagonal()`, consistent with the other corners:
     - Salary text as 2 lines via `drawLines` ("COLLECT RS. 20,000 / SALARY AS YOU PASS"), size 0.11, at t≈-0.5, width `diamondW(-0.5, 0.24)` (about 0.92).
     - The name "START" via `fitText`, size 0.42, at t≈-0.1, width `diamondW(-0.1, 0.42)`.
     - The arrow at t≈+0.42. Choose its size so that `0.42 + 0.3s + 0.46s <= R - 0.06`, which gives s ≈ 0.8.
     - The arrow icon points to -x in the rotated frame, which is down-left on the canvas. That is roughly along the bottom row toward space 1, the direction of play.
     - Lay the stack out by measured heights, so it is centred on t=0 (tune the offsets after looking).
   - Parking/goToJail: replace `CORNER*0.9` with `diamondW(±0.46, 0.22)`.
   - Jail:
     - Centre "VISITING" at x = (x0 + x0 + cell)/2 = -0.275, max width cell-0.1, so it stays within its leg.
     - Mirror that for "JUST" at y=-0.275.
     - Make the cell plate 2 lines ("POLICE STATION / BENCH") via `drawLines`. Use a plate about 0.9x0.32, limited so the plate's half-width plus half-height ≤ cell/sqrt2 - 0.05.
   - Fallback, if the diagonal Start looks wrong: keep it upright, but compute the stack height and centre it with the arrow ≤ 0.8 tall inside a 0.08 margin.
   - Verify: a throwaway page at `/tmp-board.html` is not possible inside src, so instead use `page.evaluate` on `/src/dev/scene.html`.
     - `import('/src/scene/board/drawBoard.ts')` via a Vite dynamic import, with `getBoard` and the default rules.
     - Paint a 4096 canvas, then crop each corner via `toDataURL`. Save the PNGs to tmp-sweep and view all 4 corners, before and after.
5. **Re-run the sweep until it is clean**, then run the checks:
   - `npx tsc --noEmit`
   - `npx tsc -p e2e`
   - `npx vitest run`
   - `npm run build`
   - Then delete `C:/Users/TheJenos/tmp-sweep`. No commit and no e2e run.

## Files to change
- src/scene/board/drawBoard.ts
- src/style.css
- src/ui/lobby/lobby.css (if lobby offenders are confirmed)
- src/ui/game/deeds/TileInspector.tsx
- src/ui/game/decisions/AuctionModal.tsx
- src/ui/game/manage/ManageProperties.tsx
- Possibly BuyPrompt.tsx, JailPanel.tsx and IncomeTaxPrompt.tsx (amount spans only)
