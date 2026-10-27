import { isProperty, type GameState, type SeatId } from '../../../rules';
import { useSelector } from '../../../state/store';
import { uiStore } from '../../../state/ui';
import { useView } from '../../../view';
import { safeColor } from '../../colors';
import { ConfirmButton } from '../../ConfirmButton';
import { useBusy, useSend } from '../actions';
import { useDoc, useGame, useMySeats, useNames } from '../context';
import { Dialog } from '../Dialog';
import { levelText, listText, money } from '../format';
import { spaceActions, type StepAction } from '../manage/spaceActions';
import { TokenIcon } from '../tokenIcons';
import { spaceBlurb } from './deed';
import { TitleDeed } from './TitleDeed';
import { DEFAULT_TOKEN } from '../../../shared/tokens';

const close = () => uiStore.update({ selected: null });

/** The space picked on the board (or a swatch): its deed or what it does, who owns it, who stands on it */
export function TileInspector({ covered }: { covered: boolean }) {
  const space = useSelector(uiStore, (u) => u.selected);
  const shown = useView((v) => v.game);
  const logical = useGame();
  const doc = useDoc();
  const names = useNames();
  const s = shown ?? logical;
  if (space === null || !s) return null;
  const sp = names.board.spaces[space];
  if (!sp) return null;
  const here = (Object.keys(s.players) as SeatId[]).filter((seat) => s.players[seat]?.pos === space && !s.players[seat]?.out);
  return (
    <Dialog id="tile-inspector" className="inspector" title={sp.name} onClose={close} covered={covered}>
      {isProperty(sp) ? <TitleDeed board={names.board} space={space} s={s} /> : <p className="blurb">{spaceBlurb(names.board, sp, s)}</p>}
      {isProperty(sp) && <OwnerLine space={space} s={s} />}
      {isProperty(sp) && <SpaceActionRow space={space} />}
      {here.length > 0 && (
        <p className="here-line">
          <span className="here-tokens" aria-hidden="true">
            {here.map((seat) => (
              <span key={seat} style={{ color: safeColor(doc?.seats[seat]?.color) }}>
                <TokenIcon token={doc?.seats[seat]?.token ?? DEFAULT_TOKEN} color={doc?.seats[seat]?.color} size={18} />
              </span>
            ))}
          </span>
          Here: {listText(here.map((seat) => names.seat(seat)))}
          {space === names.board.jailIndex && here.some((seat) => s.players[seat]?.jail) && <span className="muted"> (some in jail)</span>}
        </p>
      )}
    </Dialog>
  );
}

/**
 * My property's one-click actions, from the LOGICAL state: build (or sell) one level on exactly this street,
 * mortgage or lift it, or sell it back to the bank (asked once more first: it can't be undone). A disabled action
 * says why under it. The dialog stays open, so Build can be pressed again.
 */
function SpaceActionRow({ space }: { space: number }) {
  const s = useGame();
  const mine = useMySeats();
  const send = useSend();
  const busy = useBusy();
  const names = useNames();
  const owner = s?.props[`p${space}`]?.owner;
  if (!s || !owner || !mine.includes(owner)) return null;
  const x = spaceActions(s, owner, space);
  if (!x) return null;
  // The amount goes on a smaller second line; the space between keeps the name "Build house (Rs. 5,000)"
  const items: { key: string; label: string; amount: string; step: StepAction; primary?: boolean }[] = [];
  if (x.build) items.push({ key: 'build', label: `Build ${x.build.kind}`, amount: `(${money(x.build.amount)})`, step: x.build, primary: true });
  if (x.sell) items.push({ key: 'sell', label: `Sell ${x.sell.kind}`, amount: `(+${money(x.sell.amount)})`, step: x.sell });
  items.push(
    x.mortgage.kind === 'mortgage'
      ? { key: 'mortgage', label: 'Mortgage', amount: `(+${money(x.mortgage.amount)})`, step: x.mortgage }
      : { key: 'mortgage', label: 'Lift mortgage', amount: `(${money(x.mortgage.amount)})`, step: x.mortgage },
  );
  return (
    <div className="inspector-actions" role="group" aria-label={mine.length > 1 ? `Manage for ${names.seat(owner)}` : 'Manage'}>
      {items.map(({ key, label, amount, step, primary }) => (
        <div key={key} className="inspector-action">
          <button
            type="button"
            className={primary ? 'primary' : undefined}
            disabled={!step.action || busy}
            aria-describedby={step.reason ? `why-${key}-${space}` : undefined}
            onClick={() => step.action && void send(x.seat, step.action)}
          >
            {label}{' '}<span className="amt">{amount}</span>
          </button>
          {step.reason && <small id={`why-${key}-${space}`} className="muted">{step.reason}</small>}
        </div>
      ))}
      <div className="inspector-action">
        <ConfirmButton
          disabled={!x.sale.action || busy}
          aria-describedby={x.sale.reason ? `why-sale-${space}` : undefined}
          question={x.sale.mortgaged ? `Sell it to the bank for ${money(x.sale.amount)} (its loan comes out of the price)?` : `Sell it to the bank for ${money(x.sale.amount)}?`}
          yes="Sell"
          no="Keep"
          onConfirm={() => x.sale.action && void send(x.seat, x.sale.action)}
        >
          Sell to bank{' '}<span className="amt">(+{money(x.sale.amount)})</span>
        </ConfirmButton>
        {x.sale.reason && <small id={`why-sale-${space}`} className="muted">{x.sale.reason}</small>}
      </div>
    </div>
  );
}

/** Who owns a property, its buildings and whether it is mortgaged (or that the bank still sells it) */
export function OwnerLine({ space, s }: { space: number; s: GameState }) {
  const doc = useDoc();
  const names = useNames();
  const sp = names.board.spaces[space];
  const ps = s.props[`p${space}`];
  return (
    <p className="owner-line">
      {ps ? (
        <>
          Owned by <strong style={{ color: safeColor(doc?.seats[ps.owner]?.color) }}>{names.seat(ps.owner)}</strong>
          {sp?.k === 'street' && ps.level > 0 && <> · {levelText(ps.level)}</>}
          {ps.mortgaged && <> · <span className="badge danger">Mortgaged</span></>}
        </>
      ) : (
        <span className="muted">For sale from the bank</span>
      )}
    </p>
  );
}
