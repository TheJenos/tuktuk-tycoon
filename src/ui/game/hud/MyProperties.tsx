import { useState } from 'react';
import { rentFor, type GameState } from '../../../rules';
import { useSelector } from '../../../state/store';
import { uiStore } from '../../../state/ui';
import { useView } from '../../../view';
import { safeColor } from '../../colors';
import { useGame, useNames } from '../context';
import { jailCard, JAIL_CARD_NAME } from '../deeds/jailCard';
import { previewHandlers, useClearPreviewOnUnmount } from '../deeds/PropertyChip';
import { levelText, myPropsTitle, type Names } from '../format';
import { clusters } from './PlayersPanel';
import { SeatSwitcher, useShownSeat } from './SeatSwitcher';

/*
 * "My properties" in the context column: my seat's property by colour set (in board order, with how many of the
 * set I own), then stations and boards. Each row shows its buildings, a Mortgaged badge and the rent it charges
 * now; pointing at it previews it on the board, a click opens it in the tile inspector (where it can be built on).
 * Reads the DISPLAYED state, so it changes as the board does. Hot-seat: the local seat whose turn it is (or the
 * first), with a switcher shared with the hero card (SeatSwitcher). Hidden for spectators; on phones it opens from
 * the action bar (uiStore.panel 'props').
 * Hero League says "My locations", and each row its power-up.
 */

export function MyProperties({ onClose }: { onClose(): void }) {
  const shown = useView((v) => v.game);
  const logical = useGame();
  const s = shown ?? logical;
  const names = useNames();
  const [open, setOpen] = useState(true);
  // A seat picked in a switcher (here or the hero card's) holds until the turn passes; then the list follows the turn
  const shownSeat = useShownSeat(s);
  const phoneOpen = useSelector(uiStore, (u) => u.panel === 'props');
  if (!s || !shownSeat) return null;
  const { seat, live } = shownSeat;
  const groups = clusters(names.board)
    .map((c) => ({ ...c, owned: c.spaces.filter((i) => s.props[`p${i}`]?.owner === seat) }))
    .filter((c) => c.owned.length > 0);
  const cards = (s.players[seat]?.goojf ?? []).map((id) => jailCard(names.board, id));
  const count = groups.reduce((n, c) => n + c.owned.length, 0) + cards.length;
  const expanded = open || phoneOpen;
  const title = myPropsTitle(names.board);
  const { property, bought } = names.terms;
  const who = live.length > 1 ? names.seat(seat) : null;
  const empty = names.board.heroes
    ? `${who ? `${who} hasn't` : "You haven't"} ${bought} any ${property} yet.`
    : `${who ? `${who} doesn't` : "You don't"} own any property yet.`;

  return (
    <section className={expanded ? 'my-props panel' : 'my-props panel collapsed'} aria-label={title}>
      <header className="panel-head">
        <button type="button" className="log-toggle my-props-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={expanded}>
          {title}{count > 0 && <span className="my-props-count">{count}</span>}
        </button>
        <SeatSwitcher shown={shownSeat} names={names} className="choices my-props-seats" />
        <button type="button" className="icon-button dialog-close my-props-close" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose}>
          ×
        </button>
      </header>
      {expanded &&
        (count === 0 ? (
          <p className="muted small my-props-empty">{empty}</p>
        ) : (
          <div className="my-props-list">
            {groups.map((c) => (
              <section key={c.id} className="my-props-group" aria-label={c.label}>
                <h3>
                  <span className="band" style={{ background: safeColor(c.colour) }} aria-hidden="true" />
                  <span className="my-props-set">{c.label}</span>
                  <span className="muted" aria-label={`${c.owned.length} of ${c.spaces.length} owned`}>
                    {c.owned.length}/{c.spaces.length}
                  </span>
                </h3>
                <ul>
                  {c.owned.map((i) => (
                    <PropRow key={i} space={i} s={s} names={names} colour={c.colour} />
                  ))}
                </ul>
              </section>
            ))}
            {cards.length > 0 && (
              <section className="my-props-group" aria-label="Cards">
                <h3>
                  <span className="band" aria-hidden="true" />
                  <span className="my-props-set">Cards</span>
                </h3>
                <ul>
                  {cards.map((card) => (
                    <li key={card.id}>
                      <span className="my-prop card" title={`Kept until needed; it can be traded (${card.deck})`}>
                        <span className="band jail-card" style={{ background: card.colour }} aria-hidden="true" />
                        <span className="my-prop-name">{JAIL_CARD_NAME}</span>
                        <span className="muted small">{card.deck}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        ))}
    </section>
  );
}

function PropRow({ space, s, names, colour }: { space: number; s: GameState; names: Names; colour: string }) {
  useClearPreviewOnUnmount(space);
  const previewing = useSelector(uiStore, (u) => u.preview === space);
  const ps = s.props[`p${space}`];
  const sp = names.board.spaces[space];
  if (!ps || !sp) return null;
  const name = names.space(space);
  const rent = rentText(s, names, space);
  const label = [name, ps.level > 0 && levelText(ps.level), ps.mortgaged && 'mortgaged', !ps.mortgaged && `${names.terms.rent} ${rent}`].filter(Boolean).join(', ');
  return (
    <li>
      <button
        type="button"
        className={['my-prop', previewing && 'on', ps.mortgaged && 'mortgaged'].filter(Boolean).join(' ')}
        aria-label={label}
        title={names.board.heroes ? `${name}: open its card` : `${name}: open to build, sell or mortgage`}
        {...previewHandlers(space)}
        onClick={() => uiStore.update({ selected: space, preview: null })}
      >
        <span className="band" style={sp.k === 'street' ? { background: safeColor(colour) } : undefined} aria-hidden="true" />
        <span className="my-prop-name">{name}</span>
        <span className="my-prop-bld" aria-hidden="true">
          {ps.level === 5 ? <span className="bld hotel">H</span> : Array.from({ length: ps.level }, (_, k) => <span key={k} className="bld house" />)}
        </span>
        {ps.mortgaged ? (
          <span className="badge danger">Mortgaged</span>
        ) : (
          <span className="my-prop-rent money" aria-hidden="true">{rent}</span>
        )}
      </button>
    </li>
  );
}

/** The rent it charges now; boards: the dice multiplier for the number owned */
function rentText(s: GameState, names: Names, space: number): string {
  const sp = names.board.spaces[space];
  const owner = s.props[`p${space}`]?.owner;
  if (sp?.k !== 'utility') return names.money(rentFor(s, space));
  const n = names.board.spaces.filter((x, i) => x.k === 'utility' && s.props[`p${i}`]?.owner === owner).length;
  return `×${names.board.utilityMul[n - 1] ?? 0} dice`;
}
