import { boardMoney, currencyOf, owedTotal, type CardFx, type Creditor, type GameEvent, type HitFx, type SeatId } from '../../../rules';
import { actionText, bundleText, deckName, levelText, listText, lotText, partyName, plural, powerLabel, powerName, villainOf, type Names } from '../format';

/*
 * Every engine event as one short English line, for the event log and the screen-reader announcements. Pure:
 * names come from `Names` (seat names from the room, space names from the board data).
 */

type Ev<T extends GameEvent['t']> = Extract<GameEvent, { t: T }>;

/** "4 + 3, speed: Bus" (the readout and the log share it) */
export function diceText(names: Names, ev: Ev<'dice'>): string {
  const base = `${ev.w[0]} + ${ev.w[1]}`;
  if (ev.s === undefined) return base;
  const label = names.board.speedDie.labels[String(ev.s)] ?? String(ev.s);
  return `${base}, speed: ${label}`;
}

function owedText(names: Names, owed: Partial<Record<Creditor, number>>): string {
  const who = (Object.keys(owed) as Creditor[]).filter((c) => (owed[c] ?? 0) > 0).map((c) => partyName(names, c));
  return listText(who);
}

function cashText(names: Names, ev: Ev<'cash'>): string {
  const amt = names.money(ev.amount);
  const from = partyName(names, ev.from);
  const to = partyName(names, ev.to);
  const sp = ev.space !== undefined ? names.space(ev.space) : '';
  const t = names.terms;
  switch (ev.why) {
    case 'salary': return `${to} collects ${amt} salary`;
    case 'rent':
      // Hero League: "Ann pays Bob 140 Power (Sky Carrier power-up)"
      if (names.board.heroes) return `${from} pays ${to} ${amt} (${sp ? `${sp} ` : ''}${t.rent})`;
      return `${from} pays ${to} ${amt} rent${sp ? ` for ${sp}` : ''}`;
    case 'buy': return `${from} ${t.buy}s ${sp || `a ${t.property}`} for ${amt}`;
    case 'auction': return `${from} pays ${amt} at auction${sp ? ` for ${sp}` : ''}`;
    case 'tax': return `${from} pays ${amt}${sp ? ` ${sp}` : ' tax'}`;
    case 'fine': return `${from} pays the ${amt} jail fine`;
    case 'build': return `${from} pays ${amt} for building${sp ? ` on ${sp}` : ''}`;
    case 'sell': return `${to} sells buildings${sp ? ` on ${sp}` : ''} for ${amt}`;
    case 'sale': return `${to} gets ${amt} from ${t.bank} for ${sp || `a ${t.property}`}`;
    case 'mortgage': return `${to} mortgages ${sp || 'a property'} for ${amt}`;
    case 'unmortgage': return `${from} lifts the mortgage on ${sp || 'a property'} for ${amt}`;
    case 'interest': return `${from} pays ${amt} mortgage interest${sp ? ` on ${sp}` : ''}`;
    case 'trade': return `${from} pays ${to} ${amt} in a trade`;
    case 'bankrupt': return `${from}'s ${amt} goes to ${to}`;
    case 'refund': return `${to} gets ${amt} back`;
    case 'jackpot': return `${to} wins the ${amt} jackpot${sp ? ` on ${sp}` : ''}!`;
    case 'debug': return `${ev.to === 'bank' ? from : to}'s cash is set (test)`;
    case 'card':
    default:
      if (ev.from === 'bank') return `${to} collects ${amt}`;
      if (ev.to === 'bank') return `${from} pays ${amt}`;
      return `${from} pays ${to} ${amt}`;
  }
}

/** The jail corner's printed name ("Police Station Bench") */
const jailName = (names: Names): string => names.space(names.board.jailIndex);

function moveText(names: Names, ev: Ev<'move'>): string {
  const who = names.seat(ev.seat);
  const to = names.space(ev.to);
  switch (ev.via) {
    case 'jail': return `${who} goes to the ${jailName(names)}`;
    case 'back': return `${who} goes back ${plural(ev.path.length, 'space')} to ${to}`;
    case 'card': return `${who} advances to ${to}`;
    case 'uncle': return `Tuk-Tuk Uncle moves ${who} on to ${to}`;
    case 'triple': return `${who} moves to ${to}`;
    case 'bus': return `${who} takes the bus to ${to}`;
    // Titan Smash: a jump with no salary and no landing (in place when the two heroes share a space)
    case 'swap': return ev.from === ev.to ? `${who} stays on ${to} (${powerName(names.board, 'smash')})` : `${who} swaps places to ${to} (${powerName(names.board, 'smash')})`;
    case 'power': return `${who} moves to ${to}`;
    case 'dice':
    default: return `${who} moves ${plural(ev.path.length, 'space')} to ${to}`;
  }
}

/** Who holds a location nobody owns: its villain on Hero League, else the bank */
const holderOf = (names: Names, space: number): string => villainOf(names.board, space) ?? names.terms.bank;

/** A Hero-die face's hero and who plays it ("Storm Lord (Bob)"), or that nobody does */
export function heroText(names: Names, hero: string): string {
  const seat = names.heroSeat(hero);
  return seat ? `${names.hero(hero)} (${names.seat(seat)})` : `${names.hero(hero)}, nobody's hero`;
}

/** A superpower used: the power by its name, never a bare "power" */
function powerText(names: Names, ev: Ev<'power'>): string {
  const who = names.seat(ev.seat);
  const name = powerLabel(names.board, ev.power, ev.copied);
  switch (ev.power) {
    case 'thunder': {
      const whose = ev.target === undefined || ev.target === ev.seat ? 'their own' : `${names.seat(ev.target)}'s`;
      return `${who} re-rolls ${whose} throw: ${name}`;
    }
    case 'shield': return `${who} says no: ${name}`;
    case 'sting': return `${who} moves further: ${name}`;
    case 'smash': return `${who} swaps two heroes: ${name}`;
    case 'aim': return `${who} takes aim: ${name}`;
    default: return `${who} uses ${name}`;
  }
}

/**
 * "60 of 140 Power" (a currency after the number is said once) or "Rs. 6,000 of Rs. 14,000"
 */
function partOf(names: Names, part: number, whole: number): string {
  const after = currencyOf(names.board).after;
  return `${after ? boardMoney(names.board, part, { bare: true }) : names.money(part)} of ${names.money(whole)}`;
}

/** A payment that fell short: "Ann could pay Bob only 60 of 140 Power (Sky Carrier power-up): the rest is forgiven" */
function shortText(names: Names, ev: Ev<'short'>): string {
  const to = owedText(names, ev.owed);
  const what = ev.why === 'rent' && ev.space !== undefined
    ? ` (${names.space(ev.space)} ${names.terms.rent})`
    : ev.why === 'fine' ? ' (the fine)' : ev.why === 'card' ? ' (a card)' : '';
  return `${names.seat(ev.seat)} could pay ${to ? `${to} ` : ''}only ${partOf(names, owedTotal(ev.paid), owedTotal(ev.owed))}${what}: the rest is forgiven`;
}

/** What a Villain Strike effect does to the hero it is aimed at ("Bob loses 100 Power") */
export function hitText(names: Names, fx: CardFx | HitFx, seat: SeatId): string {
  const who = names.seat(seat);
  switch (fx.k) {
    case 'cash': return fx.amount < 0 ? `${who} loses ${names.money(-fx.amount)}` : `${who} collects ${names.money(fx.amount)}`;
    case 'each': return fx.amount < 0 ? `${who} pays each hero ${names.money(-fx.amount)}` : `${who} collects ${names.money(fx.amount)} from each hero`;
    case 'lose': return `${who} loses their cheapest ${names.terms.property}`;
    case 'jail': return `${who} is captured: to the ${jailName(names)}`;
    case 'back': return `${who} goes back ${plural(fx.n, 'space')}`;
    case 'advance': return `${who} is sent to ${names.space(fx.to)}`;
    default: return `The card hits ${who}`;
  }
}

function levelEventText(names: Names, ev: Ev<'level'>): string {
  const sp = names.space(ev.space);
  if (ev.to > ev.from) return ev.to === 5 ? `Hotel built on ${sp}` : `House built on ${sp} (now ${levelText(ev.to)})`;
  if (ev.from === 5 && ev.to === 4) return `Hotel sold on ${sp} (back to 4 houses)`;
  if (ev.to === 0) return `Buildings sold on ${sp}`;
  return `Building sold on ${sp} (now ${levelText(ev.to)})`;
}

/** Why a game ended early, ahead of "X wins on net worth" (or "on score") */
function overWhy(names: Names, why: Ev<'over'>['why']): string {
  switch (why) {
    case 'turnLimit': return 'Turn limit reached';
    case 'firstBankrupt': return 'First bankruptcy';
    case 'timeUp': return "Time's up";
    case 'allSaved': return `Every ${names.terms.property} ${names.terms.bought}`;
    default: return 'Game finished';
  }
}

/** One line for any engine event */
export function formatEvent(ev: GameEvent, names: Names): string {
  const n = (seat: SeatId) => names.seat(seat);
  switch (ev.t) {
    case 'order': return `Turn order: ${listText(ev.order.map(n))}`;
    case 'turn': return `${n(ev.seat)}'s turn`;
    case 'dice':
      switch (ev.purpose) {
        case 'order': return `${n(ev.seat)} rolls ${diceText(names, ev)} for turn order`;
        case 'jail': return `${n(ev.seat)} rolls ${diceText(names, ev)} to get off the ${jailName(names)}${ev.doubles ? ': doubles!' : ''}`;
        case 'utility': return `${n(ev.seat)} throws ${diceText(names, ev)} (${ev.total}) for the board`;
        default:
          return `${n(ev.seat)} rolls ${diceText(names, ev)}${ev.triples ? ': triples!' : ev.doubles ? ': doubles' : ''}`;
      }
    case 'speedOn': return `${n(ev.seat)} unlocks the Speed Die`;
    case 'bus': return `${n(ev.seat)} takes the bus: move ${listText(ev.opts.map(String)).replace(/ and /, ' or ')}`;
    case 'chooseSpace': return `${n(ev.seat)} rolled triples: move to any space`;
    case 'move': return moveText(names, ev);
    case 'salary': return `${n(ev.seat)} passes ${names.space(0)} and collects ${names.money(ev.amount)}`;
    case 'land': return `${n(ev.seat)} lands on ${names.space(ev.space)}`;
    case 'cash': return cashText(names, ev);
    case 'card': return `${n(ev.seat)} draws ${deckName(names.board, ev.deck)}: ${ev.text}`;
    case 'cardReturn':
      return ev.seat
        ? `${n(ev.seat)}'s Get Out of Jail Free card goes back to ${deckName(names.board, ev.deck)}`
        : `The card goes back under ${deckName(names.board, ev.deck)}`;
    case 'cardGive': return `${n(ev.from)} gives a Get Out of Jail Free card to ${n(ev.to)}`;
    case 'jail':
      return ev.reason === 'doubles'
        ? `${n(ev.seat)} rolls doubles three times and goes to the ${jailName(names)}`
        : ev.reason === 'card' ? `A card sends ${n(ev.seat)} to the ${jailName(names)}` : `${n(ev.seat)} is sent to the ${jailName(names)}`;
    case 'jailStay': return `${n(ev.seat)} stays on the ${jailName(names)} (try ${ev.tries} of 3)`;
    case 'jailExit':
      switch (ev.how) {
        case 'doubles': return `${n(ev.seat)} rolls doubles and leaves the ${jailName(names)}`;
        case 'fine': return `${n(ev.seat)} pays the fine and leaves the ${jailName(names)}`;
        case 'card': return `${n(ev.seat)} uses Get Out of Jail Free`;
        default: return `${n(ev.seat)} pays the fine after three tries and leaves the ${jailName(names)}`;
      }
    case 'uncle':
      if (ev.to === undefined) return `Tuk-Tuk Uncle: nowhere to go, ${n(ev.seat)} stays put`;
      return ev.target === 'rent'
        ? `Tuk-Tuk Uncle: ${n(ev.seat)} heads to ${names.space(ev.to)} (rent due)`
        : `Tuk-Tuk Uncle: ${n(ev.seat)} heads to ${names.space(ev.to)} (for sale)`;
    case 'owner':
      if (!ev.to) {
        if (ev.via === 'sold' && ev.from) return `${n(ev.from)} sells ${names.space(ev.space)} to ${names.terms.bank}`;
        if (ev.via === 'villain' && ev.from) return `${n(ev.from)} loses ${names.space(ev.space)} to ${holderOf(names, ev.space)}`;
        return `${names.space(ev.space)} goes back to ${holderOf(names, ev.space)}`;
      }
      switch (ev.via) {
        case 'buy':
          return names.board.heroes ? `${n(ev.to)} has ${names.terms.bought} ${names.space(ev.space)}` : `${n(ev.to)} now owns ${names.space(ev.space)}`;
        case 'backup': return `${n(ev.to)} steps in as the back-up hero for ${names.space(ev.space)}`;
        case 'free': return `${n(ev.to)} ${names.terms.buy}s ${names.space(ev.space)} for free`;
        case 'auction': return `${n(ev.to)} takes ${names.space(ev.space)} at auction`;
        case 'trade': return `${names.space(ev.space)} goes to ${n(ev.to)} in a trade`;
        case 'deal': return `${n(ev.to)} is dealt ${names.space(ev.space)}`;
        default: return `${names.space(ev.space)} goes to ${n(ev.to)}`;
      }
    case 'level': return levelEventText(names, ev);
    case 'mortgage':
      return ev.on ? `${names.space(ev.space)} is mortgaged` : `${names.space(ev.space)} is no longer mortgaged`;
    case 'auctionStart': return `Auction: ${lotText(names, ev.lot)}`;
    case 'bid': return `${n(ev.seat)} bids ${names.money(ev.amount)}`;
    case 'pass': return ev.auto ? `${n(ev.seat)} drops out (can't beat the bid)` : `${n(ev.seat)} passes`;
    case 'auctionEnd':
      if (ev.winner && ev.amount !== undefined) return `${n(ev.winner)} wins ${lotText(names, ev.lot)} for ${names.money(ev.amount)}`;
      return ev.lot.k === 'prop' ? `No bids: the bank keeps ${lotText(names, ev.lot)}` : `No bids for ${lotText(names, ev.lot)}`;
    case 'claimStart':
      return `Building shortage: ${plural(ev.supply, ev.kind)} left and ${listText(ev.open.map(n))} may claim`;
    case 'claimRequest': return ev.n > 0 ? `${n(ev.seat)} asks for ${ev.n}` : `${n(ev.seat)} passes`;
    case 'claimEnd':
      return ev.outcome === 'granted'
        ? `Every ${ev.kind} request is granted`
        : ev.outcome === 'auction' ? `Too many requests: the ${ev.kind}s go to auction one at a time` : 'The building shortage contest is over';
    case 'placeStart': return `${n(ev.seat)} places ${ev.count === 1 ? `a ${ev.kind}` : plural(ev.count, ev.kind)}`;
    case 'xferStart': return `${n(ev.seat)} settles ${plural(ev.spaces.length, 'mortgaged property', 'mortgaged properties')}`;
    case 'tradeProposed': return `${n(ev.trade.from)} offers ${n(ev.trade.to)} a trade`;
    case 'tradeDone':
      return `${n(ev.trade.from)} and ${n(ev.trade.to)} trade: ${bundleText(names, ev.trade.give)} for ${bundleText(names, ev.trade.get)}`;
    case 'tradeRejected': return 'A trade offer is declined';
    case 'tradeCancelled':
      return ev.why === 'over' ? 'Open trade offers end with the game' : ev.why === 'out' ? 'A trade offer is void (a player is out)' : 'A trade offer is withdrawn';
    case 'debt': return `${n(ev.debtor)} owes ${owedText(names, ev.owed)} ${names.money(ev.total)} and must raise cash`;
    case 'debtPaid': return `${n(ev.debtor)} pays off the debt`;
    case 'bankrupt':
      if (ev.resigned) return `${n(ev.seat)} resigns`;
      return `${n(ev.seat)} goes bankrupt to ${partyName(names, ev.to)}`;
    case 'timeout': return `Time's up: ${n(ev.seat)} ${actionText(names, ev.a)}`;
    case 'over':
      return ev.why === 'lastStanding' ? `${n(ev.winner)} wins the game!` : `${overWhy(names, ev.why)}: ${n(ev.winner)} wins on ${names.terms.worth}`;
    // Hero League
    case 'heroDie':
      return ev.purpose === 'backup'
        ? `${n(ev.seat)} throws the Hero die for a back-up hero: ${heroText(names, ev.hero)}`
        : `${n(ev.seat)} throws the Hero die: ${heroText(names, ev.hero)}`;
    case 'power': return powerText(names, ev);
    case 'powerReady': return `${n(ev.seat)}'s superpower is ready again`;
    // The revealed cards are the aiming player's alone: the log never names them
    case 'aimPeek': return `${n(ev.seat)} looks at the top ${plural(ev.cards.length, 'card')} of ${deckName(names.board, ev.deck)}`;
    case 'noSave': return `Nobody can ${names.terms.buy} ${names.space(ev.space)}: ${holderOf(names, ev.space)} keeps it`;
    case 'short': return shortText(names, ev);
    case 'reactTimeout': return `Time's up: ${listText(ev.seats.map(n))} ${ev.seats.length === 1 ? 'passes' : 'pass'}`;
  }
}

/**
 * Lines the log leaves out by default, because another event already says the same thing (the salary marker says
 * the salary, the cash event says what was bought or mortgaged, tradeDone says what changed hands, the jail event
 * says why a token went to jail).
 */
export function quietEvent(ev: GameEvent): boolean {
  switch (ev.t) {
    case 'move': return ev.via === 'jail';
    case 'land':
    case 'mortgage':
    case 'cardReturn':
    case 'cardGive':
      return true;
    // A sale to the bank: the owner line says it (the Money filter still lists the cash)
    case 'cash': return ev.why === 'salary' || ev.why === 'trade' || ev.why === 'bankrupt' || ev.why === 'sale';
    // A save by a back-up hero or for free has no cash line to say it
    case 'owner': return !!ev.to && ev.via !== 'backup' && ev.via !== 'free';
    case 'dice': return ev.purpose === 'order';
    default: return false;
  }
}

/** Money changes, for the log's Money filter */
export const moneyEvent = (ev: GameEvent): boolean =>
  ev.t === 'cash' || ev.t === 'debt' || ev.t === 'debtPaid' || ev.t === 'bankrupt' || ev.t === 'short';

/** The seats an event is about (for the log's Mine filter) */
export function eventSeats(ev: GameEvent): SeatId[] {
  const out: SeatId[] = [];
  const add = (c: Creditor | SeatId | undefined) => { if (c && c !== 'bank' && !out.includes(c)) out.push(c); };
  switch (ev.t) {
    case 'order': ev.order.forEach(add); break;
    case 'cash': add(ev.from); add(ev.to); break;
    case 'cardGive': add(ev.from); add(ev.to); break;
    case 'owner': add(ev.from); add(ev.to); break;
    case 'auctionEnd': add(ev.winner); break;
    case 'claimStart': add(ev.by); ev.open.forEach(add); break;
    case 'tradeProposed':
    case 'tradeDone': add(ev.trade.from); add(ev.trade.to); break;
    case 'debt': add(ev.debtor); (Object.keys(ev.owed) as Creditor[]).forEach(add); break;
    case 'debtPaid': add(ev.debtor); break;
    case 'bankrupt': add(ev.seat); add(ev.to); break;
    case 'over': ev.ranking.forEach(add); break;
    case 'power': add(ev.seat); add(ev.target); break;
    case 'short': add(ev.seat); (Object.keys(ev.owed) as Creditor[]).forEach(add); break;
    case 'reactTimeout': ev.seats.forEach(add); break;
    default:
      if ('seat' in ev) add(ev.seat);
  }
  return out;
}
