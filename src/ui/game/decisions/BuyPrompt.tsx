import type { SeatId } from '../../../rules';
import { useView } from '../../../view';
import { useBusy, useSend } from '../actions';
import { useGame, useNames } from '../context';
import { TitleDeed } from '../deeds/TitleDeed';
import { money } from '../format';
import { Prompt } from './Prompt';

/** Landed on a bank property: buy it at the printed price, or decline and it goes to auction */
export function BuyPrompt({ seat, space, onRaise }: { seat: SeatId; space: number; onRaise(): void }) {
  const s = useGame();
  const names = useNames();
  const send = useSend();
  const busy = useBusy();
  // Tuk-Tuk Uncle brought the token here: the rulebook says the player still moves there and it is auctioned
  const uncle = useView((v) => {
    for (let i = v.log.length - 1; i >= 0; i--) {
      const ev = v.log[i]!.ev;
      if (ev.t === 'move' && ev.seat === seat) return ev.via === 'uncle';
      if (ev.t === 'turn') break;
    }
    return false;
  });
  const sp = names.board.spaces[space];
  if (!s || !sp || !('price' in sp)) return null;
  const cash = s.players[seat]?.cash ?? 0;
  const short = sp.price - cash;
  return (
    <Prompt title={`Buy ${sp.name}?`} className="buy-prompt">
      <TitleDeed board={names.board} space={space} s={s} compact />
      <p className="muted small">
        You have {money(cash)}. {uncle ? 'Tuk-Tuk Uncle brought you here. ' : ''}If you don't buy it, it goes to auction and anyone may bid, you
        too.
      </p>
      {short > 0 && (
        <p className="shortfall">
          You need {money(short)} more.{' '}
          <button type="button" className="link" onClick={onRaise}>
            Raise {money(short)}
          </button>
        </p>
      )}
      <div className="action-row">
        <button type="button" className="primary" disabled={busy || short > 0} onClick={() => void send(seat, { k: 'buy' })}>
          Buy for {money(sp.price)} <kbd>B</kbd>
        </button>
        <button type="button" disabled={busy} onClick={() => void send(seat, { k: 'decline' })}>
          Auction <kbd>A</kbd>
        </button>
      </div>
    </Prompt>
  );
}
