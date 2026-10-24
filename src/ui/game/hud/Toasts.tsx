import { useEffect, useRef, useState } from 'react';
import type { LogEntry } from '../../../view';
import { director } from '../../../view';
import { useStore } from '../../../state/store';
import { dismissToast, toasts } from '../actions';
import { useNames } from '../context';
import { formatEvent, quietEvent } from './formatEvent';

/** Refusals and notes, under the turn bar. Errors are alerts; notes are polite. */
export function Toasts() {
  const list = useStore(toasts);
  return (
    <div className="game-toasts">
      {list.map((t) => (
        <div key={t.id} className={`game-toast ${t.tone}`} role={t.tone === 'error' ? 'alert' : 'status'}>
          <span>{t.text}</span>
          <button type="button" className="icon-button" aria-label="Dismiss" title="Dismiss" onClick={() => dismissToast(t.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

/**
 * Says each event as the board plays it, for screen readers (the canvas is aria-hidden). Dice are left to the
 * dice readout's own live region. It speaks only what is new since the last time, never the whole log again.
 */
export function Announcer() {
  const names = useNames();
  const [text, setText] = useState('');
  const last = useRef<LogEntry | null>(null);
  const namesRef = useRef(names);
  namesRef.current = names;

  useEffect(() => {
    const read = () => {
      const log = director.view.get().log;
      const at = last.current ? log.lastIndexOf(last.current) : -1;
      // The view was snapped or reset (the last entry we spoke is gone): start again from now.
      const fresh = last.current && at < 0 ? [] : log.slice(at + 1);
      last.current = log.at(-1) ?? null;
      const lines = fresh.filter((e) => e.ev.t !== 'dice' && !quietEvent(e.ev)).map((e) => formatEvent(e.ev, namesRef.current));
      if (lines.length) setText(lines.slice(-4).join('. '));
    };
    last.current = director.view.get().log.at(-1) ?? null;
    return director.view.subscribe(read);
  }, []);

  return (
    <div className="sr-only" aria-live="polite" aria-atomic="true" data-testid="announcer">
      {text}
    </div>
  );
}
