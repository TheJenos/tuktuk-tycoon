import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { currencyOf, DEFAULT_CURRENCY, type BoardDef, type GameEvent } from '../../../rules';
import { useView } from '../../../view';
import { useMySeats, useNames } from '../context';
import { eventSeats, formatEvent, moneyEvent, quietEvent } from './formatEvent';
import { splitMoney } from './logText';

/*
 * What has happened, as the board played it (the director's log, newest last): filters for everything, only my
 * seats, or only money. role=log, so screen readers can review it; live announcing is the Announcer's job.
 * The chevron collapses it to its header (remembered in this browser); the Log button or L opens it again.
 */

const COLLAPSED_KEY = 'tuktuk-log-collapsed';

function savedCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function saveCollapsed(on: boolean): void {
  try {
    if (on) localStorage.setItem(COLLAPSED_KEY, '1');
    else localStorage.removeItem(COLLAPSED_KEY);
  } catch {
    /* storage unavailable: it just isn't remembered */
  }
}

type Filter = 'all' | 'mine' | 'money';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'mine', label: 'Mine' },
  { id: 'money', label: 'Money' },
];

const ICONS: Partial<Record<GameEvent['t'], string>> = {
  turn: '▸', dice: '⚄', move: '→', cash: '₨', card: '?', jail: '▦', jailExit: '▢', jailStay: '▦',
  auctionStart: '⚖', bid: '⚖', auctionEnd: '⚖', tradeDone: '⇄', tradeProposed: '⇄', level: '⌂',
  bankrupt: '✕', over: '★', debt: '!', speedOn: '◆', uncle: '◆', bus: '◆', chooseSpace: '◆', salary: '₨',
  heroDie: '⚄', power: '✦', powerReady: '✦', aimPeek: '?', short: '!', noSave: '·', reactTimeout: '⏱',
};

/** The rupee sign marks money on the boards that count in rupees; any other currency gets the generic sign */
const iconOf = (ev: GameEvent, b: BoardDef): string => {
  const icon = ICONS[ev.t] ?? '·';
  return icon === '₨' && currencyOf(b).symbol !== DEFAULT_CURRENCY.symbol ? '¤' : icon;
};

export function EventLog({ expanded, onToggle }: { expanded: boolean; onToggle(): void }) {
  const log = useView((v) => v.log);
  const mine = useMySeats();
  const names = useNames();
  const [filter, setFilter] = useState<Filter>('all');
  const [collapsed, setCollapsedState] = useState(savedCollapsed);
  const setCollapsed = (on: boolean) => {
    setCollapsedState(on);
    saveCollapsed(on);
  };
  // Asking for the expanded log (L, or the phone's log button) shows it, collapsed or not
  const open = expanded || !collapsed;
  const list = useRef<HTMLOListElement>(null);
  const stick = useRef(true);

  const rows = useMemo(() => {
    const keep = (ev: GameEvent) =>
      filter === 'money' ? moneyEvent(ev) : !quietEvent(ev) && (filter === 'all' || eventSeats(ev).some((s) => mine.includes(s)));
    return log.map((e, i) => ({ e, i })).filter(({ e }) => keep(e.ev));
  }, [log, filter, mine]);

  // Follow new lines while the player is at the bottom; leave them be once they've scrolled up to read.
  useLayoutEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [rows, expanded, open]);
  useEffect(() => {
    stick.current = true;
  }, [filter]);

  return (
    <section className={['event-log panel', expanded && 'expanded', !open && 'collapsed'].filter(Boolean).join(' ')} aria-label="Game log">
      <header className="panel-head">
        <button type="button" className="log-toggle" onClick={() => (open ? onToggle() : setCollapsed(false))} aria-expanded={expanded} title="Log (L)">
          Log <kbd>L</kbd>
        </button>
        {open && (
          <span className="choices log-filters" role="radiogroup" aria-label="Show">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={filter === f.id}
                className={filter === f.id ? 'chip selected' : 'chip'}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </span>
        )}
        <button
          type="button"
          className="log-collapse"
          aria-expanded={open}
          aria-label={open ? 'Hide the log' : 'Show the log'}
          title={open ? 'Hide the log' : 'Show the log'}
          onClick={() => {
            if (open && expanded) onToggle();
            setCollapsed(open);
          }}
        />
      </header>
      {open && (
        <ol
          ref={list}
          className="log-lines"
          role="log"
          aria-live="off"
          aria-label="Events"
          tabIndex={0}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          }}
        >
          {rows.length === 0 && <li className="muted">Nothing yet</li>}
          {rows.map(({ e, i }) => (
            <li key={`${e.seq}:${i}`} className={`log-line t-${e.ev.t}`}>
              <span className="log-icon" aria-hidden="true">{iconOf(e.ev, names.board)}</span>
              <span>
                {splitMoney(formatEvent(e.ev, names), currencyOf(names.board)).map((p, j) =>
                  p.money ? <span key={j} className={`log-money ${p.money}`}>{p.text}</span> : p.text,
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

