import type { Creditor, GameEvent, SeatId } from '../../../rules';
import { actionText, bundleText, deckName, levelText, listText, lotText, money, partyName, plural, type Names } from '../format';

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
  const amt = money(ev.amount);
  const from = partyName(names, ev.from);
  const to = partyName(names, ev.to);
  const sp = ev.space !== undefined ? names.space(ev.space) : '';
  switch (ev.why) {
    case 'salary': return `${to} collects ${amt} salary`;
    case 'rent': return `${from} pays ${to} ${amt} rent${sp ? ` for ${sp}` : ''}`;
    case 'buy': return `${from} buys ${sp || 'a property'} for ${amt}`;
    case 'auction': return `${from} pays ${amt} at auction${sp ? ` for ${sp}` : ''}`;
    case 'tax': return `${from} pays ${amt}${sp ? ` ${sp}` : ' tax'}`;
    case 'fine': return `${from} pays the ${amt} jail fine`;
    case 'build': return `${from} pays ${amt} for building${sp ? ` on ${sp}` : ''}`;
    case 'sell': return `${to} sells buildings${sp ? ` on ${sp}` : ''} for ${amt}`;
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
    case 'dice':
    default: return `${who} moves ${plural(ev.path.length, 'space')} to ${to}`;
  }
}

function levelEventText(names: Names, ev: Ev<'level'>): string {
  const sp = names.space(ev.space);
  if (ev.to > ev.from) return ev.to === 5 ? `Hotel built on ${sp}` : `House built on ${sp} (now ${levelText(ev.to)})`;
  if (ev.from === 5 && ev.to === 4) return `Hotel sold on ${sp} (back to 4 houses)`;
  if (ev.to === 0) return `Buildings sold on ${sp}`;
  return `Building sold on ${sp} (now ${levelText(ev.to)})`;
}

/** Why a game ended early, ahead of "X wins on net worth" */
const OVER_WHY: Partial<Record<Ev<'over'>['why'], string>> = {
  turnLimit: 'Turn limit reached',
  endGame: 'Game finished',
  firstBankrupt: 'First bankruptcy',
  timeUp: "Time's up",
};

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
    case 'salary': return `${n(ev.seat)} passes ${names.space(0)} and collects ${money(ev.amount)}`;
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
      if (!ev.to) return `${names.space(ev.space)} goes back to the bank`;
      switch (ev.via) {
        case 'buy': return `${n(ev.to)} now owns ${names.space(ev.space)}`;
        case 'auction': return `${n(ev.to)} takes ${names.space(ev.space)} at auction`;
        case 'trade': return `${names.space(ev.space)} goes to ${n(ev.to)} in a trade`;
        case 'deal': return `${n(ev.to)} is dealt ${names.space(ev.space)}`;
        default: return `${names.space(ev.space)} goes to ${n(ev.to)}`;
      }
    case 'level': return levelEventText(names, ev);
    case 'mortgage':
      return ev.on ? `${names.space(ev.space)} is mortgaged` : `${names.space(ev.space)} is no longer mortgaged`;
    case 'auctionStart': return `Auction: ${lotText(names, ev.lot)}`;
    case 'bid': return `${n(ev.seat)} bids ${money(ev.amount)}`;
    case 'pass': return ev.auto ? `${n(ev.seat)} drops out (can't beat the bid)` : `${n(ev.seat)} passes`;
    case 'auctionEnd':
      if (ev.winner && ev.amount !== undefined) return `${n(ev.winner)} wins ${lotText(names, ev.lot)} for ${money(ev.amount)}`;
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
      return ev.why === 'turnEnd' ? 'Open trade offers expire with the turn' : ev.why === 'out' ? 'A trade offer is void (a player is out)' : 'A trade offer is withdrawn';
    case 'debt': return `${n(ev.debtor)} owes ${owedText(names, ev.owed)} ${money(ev.total)} and must raise cash`;
    case 'debtPaid': return `${n(ev.debtor)} pays off the debt`;
    case 'bankrupt':
      if (ev.resigned) return `${n(ev.seat)} resigns`;
      return `${n(ev.seat)} goes bankrupt to ${partyName(names, ev.to)}`;
    case 'timeout': return `Time's up: ${n(ev.seat)} ${actionText(names, ev.a)}`;
    case 'over':
      return ev.why === 'lastStanding' ? `${n(ev.winner)} wins the game!` : `${OVER_WHY[ev.why] ?? 'Game finished'}: ${n(ev.winner)} wins on net worth`;
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
    case 'cash': return ev.why === 'salary' || ev.why === 'trade' || ev.why === 'bankrupt';
    case 'owner': return !!ev.to;
    case 'dice': return ev.purpose === 'order';
    default: return false;
  }
}

/** Money changes, for the log's Money filter */
export const moneyEvent = (ev: GameEvent): boolean =>
  ev.t === 'cash' || ev.t === 'debt' || ev.t === 'debtPaid' || ev.t === 'bankrupt';

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
    default:
      if ('seat' in ev) add(ev.seat);
  }
  return out;
}
