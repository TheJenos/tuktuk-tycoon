import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { defaultAction, isProperty, isStreet, type SeatId } from '../../../rules';
import { uiStore } from '../../../state/ui';
import { safeColor } from '../../colors';
import { inflight, useBusy, useSend } from '../actions';
import { useGame, useNames } from '../context';
import { Prompt } from './Prompt';

const TYPEAHEAD_MS = 700;

/** For typeahead: "st james" finds "Peradeniya Gardens" */
const plain = (text: string): string => text.toLowerCase().replace(/[^a-z0-9 ]+/g, '');

/**
 * Triples: move to any other space. Three ways to pick: the 3D board (a click on a highlighted space), the
 * MiniBoard, or this list, which takes arrow keys and typeahead by name; the cursor shows as a ghost token on
 * the board, and Enter moves there.
 */
export function TilePicker({ seat }: { seat: SeatId }) {
  const s = useGame();
  const names = useNames();
  const send = useSend();
  const busy = useBusy();
  const n = names.board.spaces.length;
  const pos = s?.players[seat]?.pos ?? 0;
  const legal = useMemo(() => Array.from({ length: n }, (_, i) => i).filter((i) => i !== pos), [n, pos]);
  const [active, setActive] = useState(() => {
    const d = s ? defaultAction(s, seat) : null;
    return d?.k === 'chooseSpace' ? d.space : legal[0] ?? 0;
  });
  const options = useRef(new Map<number, HTMLLIElement>());
  const typed = useRef({ text: '', at: 0 });

  const choose = (space: number) => {
    if (inflight.get() === 0 && legal.includes(space)) void send(seat, { k: 'chooseSpace', space });
  };
  const chooseRef = useRef(choose);
  chooseRef.current = choose;

  useEffect(() => {
    uiStore.update({ picker: { kind: 'space', legal, ghost: active, onPick: (i) => chooseRef.current(i) } });
  }, [legal, active]);
  useEffect(() => () => {
    if (uiStore.get().picker?.kind === 'space') uiStore.update({ picker: null });
  }, []);
  useEffect(() => {
    options.current.get(active)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const move = (to: number) => setActive(legal[Math.max(0, Math.min(legal.length - 1, to))] ?? active);
  const onKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const at = legal.indexOf(active);
    const now = performance.now();
    const t = typed.current;
    // Most names have a space in them: while a name is being typed, Space is part of it, not "move there"
    const typing = t.text !== '' && now - t.at <= TYPEAHEAD_MS;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') move(at + 1);
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') move(at - 1);
    else if (e.key === 'PageDown') move(at + 10);
    else if (e.key === 'PageUp') move(at - 10);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(legal.length - 1);
    else if (e.key === 'Enter' || (e.key === ' ' && !typing)) choose(active);
    else if (e.key.length === 1 && (typing || /\S/.test(e.key)) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      t.text = typing ? t.text + e.key.toLowerCase() : e.key.toLowerCase();
      t.at = now;
      // A single letter cycles through the names that start with it; more letters narrow it down
      const from = t.text.length === 1 ? at + 1 : at;
      const order = [...legal.slice(from), ...legal.slice(0, from)];
      const hit = order.find((i) => plain(names.space(i)).startsWith(plain(t.text)));
      if (hit !== undefined) setActive(hit);
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <Prompt title="Triples! Move to any space" className="tile-picker">
      <p className="muted small">
        Pick a space on the board or in the list (type a name to jump), then move there.{s?.turn.again ? ' You then roll again.' : ''}
      </p>
      <ul
        className="tile-list"
        role="listbox"
        tabIndex={0}
        aria-label="Spaces"
        aria-activedescendant={`tile-opt-${active}`}
        onKeyDown={onKey}
      >
        {legal.map((i) => {
          const sp = names.board.spaces[i];
          const ps = s?.props[`p${i}`];
          const colour = isStreet(sp) ? safeColor(names.board.display.groupColours[sp.group]) : undefined;
          return (
            <li
              key={i}
              id={`tile-opt-${i}`}
              ref={(el) => { if (el) options.current.set(i, el); else options.current.delete(i); }}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'tile-opt active' : 'tile-opt'}
              onClick={() => setActive(i)}
              onDoubleClick={() => choose(i)}
            >
              <span className="tile-band" style={colour ? { background: colour } : undefined} aria-hidden="true" />
              <span className="tile-name">{names.space(i)}</span>
              {isProperty(sp) && <small className="muted">{ps ? names.seat(ps.owner) : 'for sale'}</small>}
            </li>
          );
        })}
      </ul>
      <div className="action-row">
        <button type="button" className="primary" disabled={busy} onClick={() => choose(active)}>
          Move to {names.space(active)}
        </button>
      </div>
    </Prompt>
  );
}
