import { useEffect, useState } from 'react';

const perfNow = () => performance.now();

/**
 * Seconds left until `until` (ms on the `now` clock: performance.now() by default, or the server's clock
 * for a deadline stored in the room), in tenths, 0 once it's passed. Ticks ten times a second while it's
 * running, re-rendering only the component that asked, so a timer on screen doesn't mean the whole HUD
 * re-rendering ten times a second. Pass a stable `now` (a module-level function), not an inline one.
 */
export function useCountdown(until: number, now: () => number = perfNow): number {
  const left = () => Math.max(0, Math.ceil((until - now()) / 100) / 10);
  const [value, setValue] = useState(left);
  useEffect(() => {
    setValue(left());
    if (until <= now()) return;
    const timer = setInterval(() => {
      const l = left();
      setValue(l);
      if (l <= 0) clearInterval(timer);
    }, 100);
    return () => clearInterval(timer);
    // `left` is derived from `until` and `now` alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [until, now]);
  return value;
}
