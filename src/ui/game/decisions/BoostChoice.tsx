import { useEffect } from 'react';
import { usablePowers, type SeatId } from '../../../rules';
import { uiStore } from '../../../state/ui';
import { inflight, useBusy, useSend } from '../actions';
import { useGame, useNames } from '../context';
import { plural, powerLabel } from '../format';
import { busTargets } from '../selectors';
import { Prompt } from './Prompt';
import '../heroes.css';

/**
 * Viper Strike: after the move throw stands, go 1 to 6 spaces further than the dice in the same walk (one landing),
 * or just the dice. Each choice says where it lands; hovering or focusing one previews it on the board, and a click
 * on a highlighted space picks the move that lands there.
 */
export function BoostChoice({ seat, total }: { seat: SeatId; total: number }) {
  const s = useGame();
  const names = useNames();
  const send = useSend();
  const busy = useBusy();
  const most = names.board.heroes?.stingMax ?? 6;
  const extra = Array.from({ length: most }, (_, i) => i + 1);
  const targets = s ? busTargets(s, seat, [total, ...extra.map((n) => total + n)]) : [];
  const at = s?.since ?? -1;
  const key = targets.join(',');

  useEffect(() => {
    const legal = key ? key.split(',').map(Number) : [];
    const onPick = (space: number) => {
      const n = legal.indexOf(space);
      if (n < 0 || inflight.get() > 0) return;
      void send(seat, n === 0 ? { k: 'pass', at } : { k: 'sting', n, at });
    };
    uiStore.update({ picker: { kind: 'boost', legal, ghost: null, onPick } });
    return () => {
      if (uiStore.get().picker?.kind === 'boost') uiStore.update({ picker: null });
    };
  }, [key, seat, send, at]);

  const ghost = (space: number | null) => {
    const p = uiStore.get().picker;
    if (p?.kind === 'boost') uiStore.update({ picker: { ...p, ghost: space } });
  };

  if (!s) return null;
  const sting = usablePowers(s, seat).find((u) => u.power === 'sting');
  const choice = (n: number) => {
    const to = targets[n] ?? 0;
    return (
      <button
        key={n}
        type="button"
        className="choice"
        disabled={busy || (n > 0 && !sting)}
        onMouseEnter={() => ghost(to)}
        onFocus={() => ghost(to)}
        onBlur={() => ghost(null)}
        onClick={() => void send(seat, n === 0 ? { k: 'pass', at } : { k: 'sting', n, at })}
      >
        <strong>{n === 0 ? 'No extra' : `+${n}`}</strong>
        <small>{names.space(to)}</small>
        <span className="sr-only">, {plural(total + n, 'space')} in all</span>
      </button>
    );
  };
  return (
    <Prompt title={powerLabel(names.board, 'sting', sting?.copied)} className="bus-choice boost-choice">
      <p className="muted small">The dice say {total}. Move up to {plural(most, 'extra space')} in the same move?</p>
      <div className="action-row choices" onMouseLeave={() => ghost(null)}>
        {choice(0)}
        {extra.map(choice)}
      </div>
    </Prompt>
  );
}
