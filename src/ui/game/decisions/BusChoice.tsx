import { useEffect } from 'react';
import type { SeatId } from '../../../rules';
import { uiStore } from '../../../state/ui';
import { inflight, useBusy, useSend } from '../actions';
import { useGame, useNames } from '../context';
import { plural } from '../format';
import { busTargets } from '../selectors';
import { Prompt } from './Prompt';

/** The Speed Die's Bus: move by either white die or their sum. Hovering or focusing a choice previews it. */
export function BusChoice({ seat, opts }: { seat: SeatId; opts: number[] }) {
  const s = useGame();
  const names = useNames();
  const send = useSend();
  const busy = useBusy();
  const targets = s ? busTargets(s, seat, opts) : [];
  const key = targets.join(',');

  const optsKey = opts.join(',');
  useEffect(() => {
    const legal = key ? key.split(',').map(Number) : [];
    const moves = optsKey.split(',').map(Number);
    // A click on a highlighted space on the board picks the move that lands there
    const onPick = (space: number) => {
      const n = moves[legal.indexOf(space)];
      if (n !== undefined && inflight.get() === 0) void send(seat, { k: 'bus', n });
    };
    uiStore.update({ picker: { kind: 'bus', legal, ghost: null, onPick } });
    return () => {
      if (uiStore.get().picker?.kind === 'bus') uiStore.update({ picker: null });
    };
  }, [key, optsKey, seat, send]);

  const ghost = (space: number | null) => {
    const p = uiStore.get().picker;
    if (p?.kind === 'bus') uiStore.update({ picker: { ...p, ghost: space } });
  };

  return (
    <Prompt title="Bus: choose your move" className="bus-choice">
      <div className="action-row choices" onMouseLeave={() => ghost(null)}>
        {opts.map((n, i) => {
          const to = targets[i] ?? 0;
          return (
            <button
              key={n}
              type="button"
              className={i === opts.length - 1 ? 'primary choice' : 'choice'}
              disabled={busy}
              onMouseEnter={() => ghost(to)}
              onFocus={() => ghost(to)}
              onBlur={() => ghost(null)}
              onClick={() => void send(seat, { k: 'bus', n })}
            >
              <strong>Move {n}</strong>
              <small>{names.space(to)}</small>
              <span className="sr-only">, {plural(n, 'space')}</span>
            </button>
          );
        })}
      </div>
    </Prompt>
  );
}
