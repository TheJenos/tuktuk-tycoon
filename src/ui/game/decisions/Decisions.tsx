import type { SeatId } from '../../../rules';
import { safeColor } from '../../colors';
import { useDoc, useGame, useNames } from '../context';
import { lotText } from '../format';
import { TimerBar } from '../hud/TimerRing';
import { activeDeadline, myAwaited } from '../selectors';
import { AimPrompt } from './AimPrompt';
import { BoostChoice } from './BoostChoice';
import { BuildClaimPrompt } from './BuildClaimPrompt';
import { BusChoice } from './BusChoice';
import { BuyPrompt } from './BuyPrompt';
import { DebtPanel } from './DebtPanel';
import { IncomeTaxPrompt } from './IncomeTaxPrompt';
import { MortgageXferPrompt } from './MortgageXferPrompt';
import { PlacePrompt } from './PlacePrompt';
import { ReactionBanner } from './ReactionBanner';
import { TilePicker } from './TilePicker';

interface Props {
  /** The decision shown now (gateDecision); null = none of mine is up */
  shown: string | null;
  mine: SeatId[];
  onManage(seat: SeatId): void;
  onTrade(seat: SeatId): void;
}

/** Phases whose decision is not a prompt here: the turn buttons (BoardCenter), the auction and game-over dialogs */
const NOT_PROMPTS = new Set(['preRoll', 'postRoll', 'auction', 'over', 'busy']);

/** A decision prompt of mine is up (what Decisions renders) */
export const promptUp = (phase: string | undefined, shown: string | null): boolean => !!shown && !!phase && !NOT_PROMPTS.has(phase);

/**
 * The prompt for the decision the game waits on from one of my seats: over the middle of the board (BoardCenter),
 * or in the bottom sheet on phones. The turn buttons (roll, end turn, jail) are BoardCenter's own; the auction and
 * the game's end are dialogs of their own. A Hero League reaction window, like a building shortage, has a row for
 * each of my seats it waits on.
 */
export function Decisions({ shown, mine, onManage, onTrade }: Props) {
  const s = useGame();
  if (!s) return null;
  const ph = s.phase;
  if (!promptUp(ph.k, shown)) return null;
  const seats = myAwaited(s, mine);
  const seat = seats[0];
  if (!seat) return null;
  // Keyed by the decision, so a new decision of the same kind starts with fresh local state
  switch (ph.k) {
    case 'buy': return <BuyPrompt key={shown} seat={seat} space={ph.space} onRaise={() => onManage(seat)} />;
    case 'incomeTax': return <IncomeTaxPrompt key={shown} seat={seat} />;
    case 'bus': return <BusChoice key={shown} seat={seat} opts={ph.opts} />;
    case 'chooseSpace': return <TilePicker key={shown} seat={seat} />;
    case 'place': return <PlacePrompt key={shown} seat={ph.seat} kind={ph.kind} count={ph.count} {...(ph.bid !== undefined ? { bid: ph.bid } : {})} />;
    case 'buildClaim': return <BuildClaimPrompt key={shown} seats={seats} />;
    case 'mortgageXfer': return <MortgageXferPrompt key={shown} seat={ph.seat} spaces={ph.spaces} />;
    case 'debt': return <DebtPanel key={shown} seat={ph.debtor} onManage={() => onManage(ph.debtor)} onTrade={() => onTrade(ph.debtor)} />;
    case 'react': return <ReactionBanner key={shown} seats={seats} />;
    case 'aim': return <AimPrompt key={shown} seat={ph.seat} />;
    case 'boost': return <BoostChoice key={shown} seat={ph.seat} total={ph.total} />;
    default: return null;
  }
}

/** An auction I'm not bidding in (passed, out, or watching): who leads and how long is left (in the context panel) */
export function AuctionStatus() {
  const s = useGame();
  const doc = useDoc();
  const names = useNames();
  if (!s || s.phase.k !== 'auction') return null;
  const ph = s.phase;
  const deadline = activeDeadline(doc);
  return (
    <section className="prompt panel auction-status" aria-label="Auction">
      <p>
        <strong>Auction: {lotText(names, ph.lot)}</strong>
      </p>
      <p aria-live="polite" aria-atomic="true">
        {ph.high ? (
          <>
            High bid {names.money(ph.high.amount)} by <strong style={{ color: safeColor(doc?.seats[ph.high.seat]?.color) }}>{names.seat(ph.high.seat)}</strong>
          </>
        ) : (
          'No bids yet'
        )}
      </p>
      {deadline && <TimerBar deadline={deadline} label="Auction closes in" />}
    </section>
  );
}
