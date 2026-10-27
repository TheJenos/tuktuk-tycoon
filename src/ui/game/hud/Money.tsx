import { useEffect, useRef, useState } from 'react';
import { useSettings } from '../../settings';
import { useNames } from '../context';

const TWEEN_MS = 600;
const FLASH_MS = 1400;

/**
 * A cash amount that counts to its new value (in step with the floating "+Rs. 20,000" over the board) and flashes the
 * change beside it. Reduced motion jumps straight there. The number read out is always the final value.
 */
/** `value` is in engine units; it is shown in the board's currency (rupees x100, or Hero League's Power) */
export function Money({ value, className }: { value: number; className?: string }) {
  const { money, signedMoney } = useNames();
  const { reduceMotion, animSpeed } = useSettings();
  const instant = reduceMotion || animSpeed === 'instant';
  const [shown, setShown] = useState(value);
  const [delta, setDelta] = useState<{ n: number; key: number } | null>(null);
  const from = useRef(value);
  const keyRef = useRef(0);

  useEffect(() => {
    const start = from.current;
    from.current = value;
    if (start === value) return;
    setDelta({ n: value - start, key: ++keyRef.current });
    const clear = setTimeout(() => setDelta(null), FLASH_MS);
    if (instant || typeof requestAnimationFrame !== 'function') {
      setShown(value);
      return () => clearTimeout(clear);
    }
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const f = Math.min(1, (t - t0) / TWEEN_MS);
      const eased = 1 - (1 - f) ** 3;
      setShown(Math.round(start + (value - start) * eased));
      if (f < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(clear);
      setShown(value);
    };
  }, [value, instant]);

  return (
    <span className={['money', className].filter(Boolean).join(' ')}>
      <span aria-hidden="true">{money(shown)}</span>
      <span className="sr-only">{money(value)}</span>
      {delta && (
        <span key={delta.key} className={`money-delta ${delta.n > 0 ? 'up' : 'down'}`} aria-hidden="true">
          {signedMoney(delta.n)}
        </span>
      )}
    </span>
  );
}
