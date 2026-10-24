import { isProperty, type SeatId } from '../../../rules';
import { useSelector } from '../../../state/store';
import { uiStore } from '../../../state/ui';
import { useView } from '../../../view';
import { safeColor } from '../../colors';
import { useDoc, useGame, useNames } from '../context';
import { Dialog } from '../Dialog';
import { levelText, listText } from '../format';
import { TokenIcon } from '../tokenIcons';
import { spaceBlurb } from './deed';
import { TitleDeed } from './TitleDeed';

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
  const ps = s.props[`p${space}`];
  const here = (Object.keys(s.players) as SeatId[]).filter((seat) => s.players[seat]?.pos === space && !s.players[seat]?.out);
  return (
    <Dialog id="tile-inspector" className="inspector" title={sp.name} onClose={close} covered={covered}>
      {isProperty(sp) ? <TitleDeed board={names.board} space={space} s={s} /> : <p className="blurb">{spaceBlurb(names.board, sp, s)}</p>}
      {isProperty(sp) && (
        <p className="owner-line">
          {ps ? (
            <>
              Owned by <strong style={{ color: safeColor(doc?.seats[ps.owner]?.color) }}>{names.seat(ps.owner)}</strong>
              {sp.k === 'street' && ps.level > 0 && <> · {levelText(ps.level)}</>}
              {ps.mortgaged && <> · <span className="badge danger">Mortgaged</span></>}
            </>
          ) : (
            <span className="muted">For sale from the bank</span>
          )}
        </p>
      )}
      {here.length > 0 && (
        <p className="here-line">
          <span className="here-tokens" aria-hidden="true">
            {here.map((seat) => (
              <span key={seat} style={{ color: safeColor(doc?.seats[seat]?.color) }}>
                <TokenIcon token={doc?.seats[seat]?.token ?? 'hat'} size={18} />
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
