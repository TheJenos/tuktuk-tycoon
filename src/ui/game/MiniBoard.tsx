import type { CSSProperties } from 'react';
import { isStreet, type SeatId } from '../../rules';
import { useSelector } from '../../state/store';
import { uiStore } from '../../state/ui';
import { useView } from '../../view';
import { safeColor } from '../colors';
import { useDoc, useGame, useNames } from './context';
import { levelText, money, shortSpaceName, tokenOf } from './format';
import { diceText } from './hud/formatEvent';
import { cellOf, sideOf } from './layout';
import { TokenIcon } from './tokenIcons';

/**
 * The board in 2D: a grid of the spaces (11x11 for 40, 8x8 for Hero League's 28; GO bottom right, clockwise), with owners, buildings, mortgages
 * and tokens from the DISPLAYED state. It is the whole board when WebGL is missing or lost, and an optional view
 * otherwise, opaque over the 3D one. A cell click picks a space for an open picker (Bus, triples, placing a house)
 * or opens its details. Names are shortened to whole short words, and the cells' text scales with the cells.
 */
export function MiniBoard() {
  const shown = useView((v) => v.game);
  const logical = useGame();
  const dice = useView((v) => v.dice);
  const doc = useDoc();
  const names = useNames();
  const picker = useSelector(uiStore, (u) => u.picker);
  const hover = useSelector(uiStore, (u) => u.hover);
  const s = shown ?? logical;
  if (!s) return null;
  const b = names.board;
  const n = b.spaces.length;
  const side = n / 4 + 1;
  const at = new Map<number, SeatId[]>();
  for (const seat of s.order) {
    const p = s.players[seat];
    if (!p || p.out) continue;
    at.set(p.pos, [...(at.get(p.pos) ?? []), seat]);
  }
  const pick = (i: number) => {
    if (picker?.onPick && picker.legal.includes(i)) picker.onPick(i);
    else uiStore.update({ selected: i });
  };

  return (
    <div className="mini-board" role="group" aria-label="Board" style={{ gridTemplateColumns: `repeat(${side}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${side}, minmax(0, 1fr))` }}>
      {b.spaces.map((sp, i) => {
        const { row, col } = cellOf(i, n);
        const ps = s.props[`p${i}`];
        const owner = ps ? doc?.seats[ps.owner] : undefined;
        const legal = picker?.legal.includes(i) ?? false;
        const tokens = at.get(i) ?? [];
        const classes = [
          'cell',
          `side-${sideOf(i, n)}`,
          isStreet(sp) && 'street',
          i % (n / 4) === 0 && 'corner',
          ps?.mortgaged && 'mortgaged',
          legal && 'legal',
          picker?.ghost === i && 'ghost',
          hover === i && 'hover',
        ].filter(Boolean).join(' ');
        const label = [
          sp.name,
          ps ? `${names.terms.owned} by ${names.seat(ps.owner)}` : null,
          ps && ps.level > 0 ? levelText(ps.level) : null,
          ps?.mortgaged ? 'mortgaged' : null,
          tokens.length ? `here: ${tokens.map((t) => names.seat(t)).join(', ')}` : null,
          legal ? 'can be picked' : null,
        ].filter(Boolean).join(', ');
        return (
          <button
            key={i}
            type="button"
            className={classes}
            style={{ gridRow: row, gridColumn: col, ...(owner ? { '--owner': safeColor(owner.color) } : {}) } as CSSProperties}
            aria-label={label}
            title={label}
            onClick={() => pick(i)}
            onMouseEnter={() => uiStore.update({ hover: i })}
            onMouseLeave={() => uiStore.get().hover === i && uiStore.update({ hover: null })}
          >
            {isStreet(sp) && <span className="cell-band" style={{ background: safeColor(b.display.groupColours[sp.group]) }} aria-hidden="true" />}
            <span className="cell-name" aria-hidden="true">
              <span className="name-long">{shortSpaceName(sp.name)}</span>
              <span className="name-short">{shortSpaceName(sp.name, 6)}</span>
            </span>
            {ps && ps.level > 0 && (
              <span className="cell-level" aria-hidden="true">{ps.level === 5 ? 'H' : '▪'.repeat(ps.level)}</span>
            )}
            {!ps && 'price' in sp && <span className="cell-price" aria-hidden="true">{money(sp.price, b)}</span>}
            {owner && <span className="cell-owner" aria-hidden="true" />}
            {tokens.length > 0 && (
              <span className="cell-tokens" aria-hidden="true">
                {tokens.map((seat) => (
                  <span key={seat} style={{ color: safeColor(doc?.seats[seat]?.color) }}>
                    <TokenIcon token={tokenOf(s, seat, doc?.seats[seat]?.token)} size={14} />
                  </span>
                ))}
              </span>
            )}
          </button>
        );
      })}
      <div className="mini-centre" style={{ gridRow: `2 / ${side}`, gridColumn: `2 / ${side}` }}>
        <strong>{b.display.title}</strong>
        {dice && <span className="muted">{names.seat(dice.seat)}: {diceText(names, dice)}</span>}
        {!b.heroes && <span className="muted small">Bank: {s.bank.houses} houses · {s.bank.hotels} hotels</span>}
      </div>
    </div>
  );
}
