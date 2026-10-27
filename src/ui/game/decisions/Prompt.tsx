import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useBusy } from '../actions';
import { useDoc } from '../context';
import { TimerRing } from '../hud/TimerRing';
import { activeDeadline } from '../selectors';

/**
 * Scrolls the decision panel (only it, never the page) so `el` shows: with big panels or a short window the main
 * button can start below the panel's fold, and keyboard focus must not sit on a button nobody can see.
 */
function reveal(el: HTMLElement): void {
  const box = el.closest<HTMLElement>('.hud-decision, .board-center');
  if (!box) return;
  const r = el.getBoundingClientRect();
  const b = box.getBoundingClientRect();
  if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom + 8;
  else if (r.top < b.top) box.scrollTop -= b.top - r.top + 8;
}

/**
 * A decision over the middle of the board (the bottom sheet on phones): not modal, so Manage and Trade stay
 * reachable while deciding. It takes focus when it appears unless the player is busy with something else on the page.
 */
export function Prompt({ title, children, className, timed = true }: { title: ReactNode; children: ReactNode; className?: string; timed?: boolean }) {
  const id = useId();
  const doc = useDoc();
  const deadline = timed ? activeDeadline(doc) : null;
  const root = useRef<HTMLElement>(null);
  const busy = useBusy();
  const focused = useRef(false);
  // Once, as soon as its buttons are enabled (the move that brought it up may still be settling)
  useEffect(() => {
    if (focused.current || busy) return;
    focused.current = true;
    // The main choice first (a selector list would take whichever button comes first in the page)
    const el = root.current;
    const main = el?.querySelector<HTMLElement>('button.primary:not([disabled])') ?? el?.querySelector<HTMLElement>('button:not([disabled])');
    if (!main) return;
    reveal(main);
    const active = document.activeElement;
    if (active && active !== document.body && !el?.contains(active)) return;
    main.focus({ preventScroll: true });
  }, [busy]);
  return (
    <section ref={root} className={['prompt', 'panel', className].filter(Boolean).join(' ')} aria-labelledby={id} data-testid="prompt">
      <header className="prompt-head">
        <h2 id={id}>{title}</h2>
        {deadline && <TimerRing deadline={deadline} size={30} label={deadline.kind === 'reaction' ? 'Time to react' : 'Time to decide'} />}
      </header>
      {children}
    </section>
  );
}
