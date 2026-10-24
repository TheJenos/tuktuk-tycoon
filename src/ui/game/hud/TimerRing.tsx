import { useCountdown } from '../../useCountdown';
import { useServerNow } from '../context';
import type { Deadline } from '../selectors';

/**
 * Seconds left on the running deadline, as a ring that empties (the full circle is the time the phase allows;
 * animations before it count as extra) with the whole seconds in the middle.
 */
export function TimerRing({ deadline, size = 34, label = 'Time left' }: { deadline: Deadline; size?: number; label?: string }) {
  const now = useServerNow();
  const left = useCountdown(deadline.at, now);
  const r = 15;
  const c = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(1, left / deadline.total));
  const secs = Math.ceil(left);
  const urgent = secs <= 5;
  return (
    <span
      className={urgent ? 'timer-ring urgent' : 'timer-ring'}
      role="timer"
      aria-label={`${label}: ${secs} ${secs === 1 ? 'second' : 'seconds'}`}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 36 36" width={size} height={size} aria-hidden="true">
        <circle cx="18" cy="18" r={r} className="track" />
        <circle cx="18" cy="18" r={r} className="fill" strokeDasharray={c} strokeDashoffset={c * (1 - f)} />
      </svg>
      <span className="secs" aria-hidden="true">{secs}</span>
    </span>
  );
}

/** The same deadline as a bar (auctions) */
export function TimerBar({ deadline, label = 'Time left' }: { deadline: Deadline; label?: string }) {
  const now = useServerNow();
  const left = useCountdown(deadline.at, now);
  const f = Math.max(0, Math.min(1, left / deadline.total));
  const secs = Math.ceil(left);
  return (
    <div className={secs <= 3 ? 'timer-bar urgent' : 'timer-bar'} role="timer" aria-label={`${label}: ${secs} seconds`}>
      <span className="bar" style={{ width: `${f * 100}%` }} />
      <span className="secs" aria-hidden="true">{secs}s</span>
    </div>
  );
}
