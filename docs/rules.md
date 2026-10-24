# Rules reference (summarised from the 2007 property-trading rulebook, with the Speed Die)

This is a paraphrased checklist of the rulebook the game implements. Every rule here must be covered by the engine
(`src/rules`) and by a test. Where the rulebook is silent or ambiguous, the decision is listed under
[Rules decisions](#rules-decisions).

## Speed Die (optional, a room setting)

1. Each player gets an extra Rs. 1,000 at the start.
2. A player doesn't use the Speed Die until they first land on or pass GO and collect Rs. 200. From then on they roll it
   with the two white dice every turn (so players start using it at different times).
3. Faces: `1`, `2`, `3`, `Bus`, `Tuk-Tuk Uncle`, `Tuk-Tuk Uncle`.
   - **1, 2 or 3:** add it to the white dice total.
   - **Bus:** move the value of either white die, or their sum. The player chooses.
   - **Tuk-Tuk Uncle:** move the white dice sum and resolve that space fully (card, buy, rent, …). Then:
     - if the bank still owns any property, advance to the **next** property the bank owns and you may buy it;
       if you don't, you still move there and it goes to auction;
     - if the bank owns none, advance to the next property where you will owe another player rent.
4. Only the white dice count for doubles.
5. **Triples** (all three dice the same number): move to any space on the board.
6. Sent to jail during the move (Go To Jail space, or third doubles): the turn ends and the Speed Die isn't used that
   turn.
7. Rolling to get out of jail uses the white dice only.
8. Utility rent uses the sum of all three dice; Bus and Tuk-Tuk Uncle count as 0.

## Classic rules

- **Object:** become the wealthiest player through buying, renting and selling property. The last player left in the
  game (not bankrupt) wins.
- **Preparation:** Chance and Community Chest decks shuffled face down. Each player starts with Rs. 1,500
  (2×Rs. 500, 2×Rs. 100, 2×Rs. 50, 6×Rs. 20, 5×Rs. 10, 5×Rs. 5, 5×Rs. 1).
- **The Bank:** holds the Title Deeds, 32 houses and 12 hotels. It pays salaries and bonuses, sells and auctions
  properties, sells houses and hotels, and lends money only through mortgages. It collects taxes, fines, loans and
  interest. It never goes broke.
- **Play:** everyone rolls; the highest total starts. Play passes to the left. Move clockwise by the dice total. Several
  tokens may share a space.
- **Doubles:** move, resolve the space, then roll again. Three doubles in a row: go directly to jail.
- **GO:** collect Rs. 200 every time you land on or pass GO, by dice or by card. Passing GO and then drawing "Advance to GO"
  (from Community Chest 2 spaces past GO, or Chance 7 spaces past GO) pays Rs. 200 twice.
- **Buying property:** landing on an unowned property, you may buy it at the printed price. If you don't, the Bank
  auctions it to the highest bidder. Anyone may bid, including the player who declined. Bidding may start at any price.
  The winner pays the bid in cash.
- **Paying rent:** landing on another player's property, pay the rent on its Title Deed. A mortgaged property collects
  no rent. Owning every property in a colour group doubles the rent on that group's unimproved properties, even if
  another property in the group is mortgaged. Houses and hotels raise rent a lot. (Physical rule: the owner must ask
  before the second following player rolls; see decisions.)
- **Chance / Community Chest:** take the top card, follow it, put it face down at the bottom. "Get Out of Jail Free" is
  kept until used, then returned to the bottom of its deck. It may be sold to another player at any time for an agreed
  price.
- **Income Tax:** choose **before** adding up your worth: pay Rs. 200, or pay 10% of your total worth. Worth = cash +
  printed price of every property (mortgaged or not) + cost of all your buildings.
- **Jail:** you go to jail by (1) landing on Go To Jail, (2) drawing a Go to Jail card, or (3) rolling doubles three
  times in a row. You never collect GO salary on that move; your turn ends. Landing on Jail normally is "Just Visiting"
  with no penalty.
  - Getting out: (1) roll doubles on any of your next three turns, then move by that roll (no extra roll for the
    doubles); (2) use a Get Out of Jail Free card; (3) buy that card from another player and use it; (4) pay Rs. 50 before
    rolling on either of your next two turns.
  - If you haven't rolled doubles by the third turn, you must pay Rs. 50, then move by that throw.
  - While in jail you can still buy and sell property and buildings, and collect rent.
- **Free Parking:** nothing happens.
- **Houses:** with every property in a colour group, you may buy houses for any of them at the Title Deed price, at any
  time. Build evenly: no property may be more than one house ahead of the others in its group. At most 4 houses each.
  Unimproved properties of a complete group still collect double rent.
- **Hotels:** with 4 houses on every property of a group, buy a hotel for one of them; its 4 houses go back to the
  Bank. One hotel per property.
- **Building shortage:** if the Bank has no houses, players wait. If buildings are limited and several players want
  more than the Bank has, they are auctioned to the highest bidder.
- **Selling property:** unimproved properties, railroads and utilities may be sold privately for any amount. No
  property may be sold while any property of its colour group has buildings; sell the buildings to the Bank first.
  Buildings sell back to the Bank at half price at any time, evenly, in reverse order of building. Hotels may be sold
  all at once, or one house at a time (a hotel = 5 houses).
- **Mortgages:** only unimproved properties. All buildings in the group must be sold first (half price). The mortgage
  value is on the Title Deed. No rent on a mortgaged property, but the other properties of the group still collect. To
  lift a mortgage pay the mortgage value + 10% interest. Once the whole group is unmortgaged, the owner may buy houses
  again at full price. The owner keeps a mortgaged property; nobody else may lift it. The owner may sell it at an agreed
  price; the new owner may lift it at once (mortgage + 10%), or pay just the 10% now and later pay the mortgage plus
  another 10%.
- **Bankruptcy:** you are bankrupt if you owe more than you can pay.
  - **To a player:** give them everything of value and retire. Your buildings go back to the Bank for half their price,
    and that cash goes to the creditor. Mortgaged property goes to the creditor, who must pay the Bank 10% interest at
    once, and may then lift the mortgage or keep it mortgaged (paying the interest again when lifting later).
  - **To the Bank** (taxes or penalties), after selling buildings and mortgaging: all assets go to the Bank, which
    immediately auctions all the property (not the buildings). You retire at once.
- **Miscellaneous:** money can be lent to a player only by the Bank, and only by mortgaging property. No player-to-player
  loans.

## Rules decisions

The rulebook is silent or ambiguous on these points. Each is a config option where noted.

| Topic | Decision |
|---|---|
| Income Tax amount | Rs. 200 or 10% (the scanned PDF's OCR reads "Rs. 900", a scan error). The 10% rounds down. |
| Luxury Tax | Rs. 75 (this era's board). Config: 75 or 100. |
| Rent | Collected automatically. The "ask before the second following player rolls" window is not used. |
| Auctions | Timed open bidding: anyone still in may raise at any time; the countdown resets on each bid; it closes early when everyone else has passed. Minimum bid Rs. 1. |
| Triples | Move to any of the other 39 spaces, then roll again (the white dice are doubles, so triples also count toward the three-doubles jail rule). Passing GO on the way pays Rs. 200. Config `triplesRollAgain`. |
| Speed Die unlock | Takes effect from the next roll after the first GO salary (including a doubles re-roll). |
| Nearest Utility card | If owned: throw the dice (white dice, plus the speed die when the roller has it active; Bus / Tuk-Tuk Uncle = 0) and pay 10× the total. |
| Mortgaged railroads/utilities | Still count toward the number owned for rent. |
| Unmortgage cost | Mortgage value + `ceil(10%)` (Power Cut Board: Rs. 83). |
| Mortgaged property changing hands | The new owner chooses at once, per property: lift now (mortgage + 10%) or pay 10% now and keep it mortgaged. |
| Shortage auction | When buildings are short and more than one player wants them, every eligible builder may state how many they want; if the total fits, all are granted, otherwise units are auctioned one at a time. |
| Bankruptcy to the Bank | Mortgages are cleared before the Bank auctions the properties. |
| Several creditors (e.g. "pay each player") | The debtor raises what they can; cash is paid in seat order; the remainder is treated as bankruptcy to the Bank. |
| Turn order ties | Players tied for the highest opening roll re-roll. |
| Card decks | Two themed 16-card decks, "Astrologer's Advice" (the rulebook's Chance) and "Seettu Pot" (Community Chest), with the same effects as the standard decks of this era; the rulebook lists none. |
| Turn limit | Off by default. When on (used in bot simulations), the game ends ranked by net worth. |
| The high bidder | Can neither pass nor raise its own bid, and the auction doesn't wait for it. A seat that couldn't beat the high bid even by selling and mortgaging everything is passed automatically. |
| Raising cash during an auction | Selling buildings and mortgaging are allowed while an auction runs; building and lifting mortgages are not. A winner whose cash fell below its bid meanwhile owes the bid as a debt. |
| Shortage contest details | It starts when a build would leave the bank with fewer units of that kind than the other players could put up right now (as far as their cash goes). While it is open nobody may build, sell or mortgage. Granted units are placed one at a time at the normal price; auctioned units start at Rs. 1, cost the winning bid and are placed free; a unit nobody bids on ends the contest; a won unit that can't be placed is refunded. |
| Triples onto Go To Jail | Picking the Go To Jail space sends the player straight to jail: no walk, no salary. |
| Get Out of Jail Free timing | The card may be used before rolling on any of the three jail turns. The fine forced after the third failed roll can't be replaced by a card. Paying the fine by choice needs the cash (it never opens a debt). |
| Tuk-Tuk Uncle when the bank owns nothing | The token goes to the next unmortgaged property of another active player and pays rent; on a utility the rent uses the white dice (Tuk-Tuk Uncle counts 0). This branch runs only when the bank owns no property at all: if the bank's only property is the one the player stands on (declined, no bids), the token stays put. |
| Trades | Accepted only before or after a roll, while deciding on a purchase, or while in debt. One open offer per proposer, 8 in all; every offer is cleared when the turn passes. Property for nothing (a gift) is allowed; cash for nothing, nothing for cash and cash for cash (loans) are refused. Whoever receives mortgaged property must be able to pay the 10% from cash after the trade. |
| Bankruptcy details | Player creditors are paid in seat order from the debtor's left, then the bank. A creditor who can't pay the 10% on mortgaged property it received owes it to the bank as an ordinary debt. Shares owed to players already out go to the bank. |
| Resigning | Allowed at any time. A resignation in debt pays the creditors in full when selling and mortgaging everything covers it (otherwise it is a bankruptcy to the creditor); what is left goes to the bank, which auctions the property. |
| Auto-raise | Sells one building level at a time from the highest-standing street (ties: the later space), a whole group when a hotel can't be broken up; then mortgages the cheapest mortgage value first (ties: the earlier space). It goes bankrupt at once when everything together can't cover the debt. |
| Turn limit counting and rankings | Every player's turn counts; the game ends when turn number `turnLimit` ends. Rankings (turn limit, Finish now) order the players still in by net worth (a mortgaged property counts its price minus the cost of lifting it; ties in turn order), then the others, last out first. |
| Money rounding | The 10% Income Tax rounds down; mortgage interest rounds up; selling a building refunds half its cost, rounded down. A hotel costs the street's house price, on top of the four houses it replaces. |
| Timeouts | An auction that runs out of time closes (the high bid wins; no bids, the bank keeps it), and so does a shortage contest (whoever has not answered passes). Online, any other decision that runs out of time plays the safe default: roll; the largest Bus move; for a triple the next bank-owned property ahead, else GO; decline the purchase (it goes to auction); the cheaper Income Tax; the first legal place for a building; keep received mortgages mortgaged (pay the 10%); auto-raise; end the turn. Offline only auctions have a clock. |
