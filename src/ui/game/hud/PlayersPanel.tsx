import { memo, useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react';
import { netWorth, type BoardDef, type GameState, type SeatId } from '../../../rules';
import type { SeatInfo, SessionView } from '../../../net/types';
import { uiStore } from '../../../state/ui';
import { useView } from '../../../view';
import { safeColor } from '../../colors';
import { settings, useSettings } from '../../settings';
import { useDoc, useGame, useMySeats, useNames, useSessionSel } from '../context';
import { levelText, money, type Names } from '../format';
import { stripScroll } from '../layout';
import { TokenIcon } from '../tokenIcons';
import { Money } from './Money';
import { DEFAULT_TOKEN } from '../../../shared/tokens';

/*
 * Every player, in turn order: token, name and badges, cash (counting along with the board), and their property
 * as swatches by colour group (mortgaged ones hatched, houses as pips), and online whether each human player is
 * connected. Reads the DISPLAYED state, so a purchase shows up when the board shows it.
 * On narrow screens the list is a strip (compact chips on phones, sized to fit them all where they can). When it
 * still overflows, its edges fade where more players are hidden, and it scrolls itself to keep the player whose
 * turn it is in view, and mine along with them when both fit.
 */

type Presence = NonNullable<SessionView['presence']>[SeatId];
const presenceOf = (v: SessionView) => v.presence;

const RAIL_COLOUR = '#3a3f4b';
const UTILITY_COLOUR = '#b7c3cc';

interface Cluster {
  id: string;
  label: string;
  colour: string;
  spaces: number[];
}

/** Colour groups, then railroads, then utilities */
export function clusters(b: BoardDef): Cluster[] {
  const out: Cluster[] = b.groups.map((g) => ({ id: g.id, label: g.name, colour: b.display.groupColours[g.id] ?? '#888888', spaces: g.spaces }));
  const rails = b.spaces.flatMap((sp, i) => (sp.k === 'rail' ? [i] : []));
  const utils = b.spaces.flatMap((sp, i) => (sp.k === 'utility' ? [i] : []));
  if (rails.length) out.push({ id: 'rail', label: 'Stations', colour: RAIL_COLOUR, spaces: rails });
  if (utils.length) out.push({ id: 'utility', label: 'Boards', colour: UTILITY_COLOUR, spaces: utils });
  return out;
}

export function PlayersPanel() {
  const shown = useView((v) => v.game);
  const logical = useGame();
  const s = shown ?? logical;
  const doc = useDoc();
  const mine = useMySeats();
  const names = useNames();
  const presence = useSessionSel(presenceOf);
  const { showNetWorth } = useSettings();
  const order = !s ? [] : s.order.length ? s.order : (Object.keys(s.players) as SeatId[]);
  const over = s?.phase.k === 'over';
  const current = s && !over ? s.turn.seat : null;
  const me = mine.length === 1 ? (mine[0] ?? null) : null;
  // Keyed on the list being there (it waits for the doc) as well as on the order
  const list = useStripScroll(current, me, `${doc ? 'on' : 'off'}:${order.join()}`);
  if (!s || !doc) return null;
  return (
    <section className="players-panel panel" aria-label="Players">
      <h2 className="panel-head">Players</h2>
      <ol className="player-list" ref={list}>
        {order.map((seat) => (
          <PlayerCard
            key={seat}
            seat={seat}
            s={s}
            info={doc.seats[seat]}
            names={names}
            mine={mine.includes(seat)}
            // Hot-seat: every local seat is "you", so the badge would say nothing
            you={mine.length === 1 && mine.includes(seat)}
            turn={!over && s.turn.seat === seat}
            presence={presence?.[seat]}
            // Income Tax is chosen before adding up worth: no worth on screen meanwhile
            showNetWorth={showNetWorth && s.phase.k !== 'incomeTax'}
          />
        ))}
      </ol>
    </section>
  );
}

/** The strip's scroll position for a seat's card: its start and end along the list's axis, in content px */
function cardSpan(list: HTMLElement, seat: SeatId | null, across: boolean): { start: number; end: number } | null {
  const card = seat ? list.querySelector<HTMLElement>(`[data-seat="${seat}"]`) : null;
  if (!card) return null;
  const box = list.getBoundingClientRect();
  const r = card.getBoundingClientRect();
  return across
    ? { start: r.left - box.left + list.scrollLeft, end: r.right - box.left + list.scrollLeft }
    : { start: r.top - box.top + list.scrollTop, end: r.bottom - box.top + list.scrollTop };
}

/**
 * An overflowing list of players (the phone and tablet strip, or a long desktop column): `data-more` says which
 * ends hide players ("start", "end"), for the fades, and the list scrolls itself to keep `current` in view, and
 * `me` with them when both fit, whenever the turn passes, the order changes or the list is resized.
 */
function useStripScroll(current: SeatId | null, me: SeatId | null, orderKey: string) {
  const ref = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const across = el.scrollWidth > el.clientWidth + 1;
      const pos = across ? el.scrollLeft : el.scrollTop;
      const max = across ? el.scrollWidth - el.clientWidth : el.scrollHeight - el.clientHeight;
      const more = [pos > 1 && 'start', pos < max - 1 && 'end'].filter(Boolean).join(' ');
      if (more) el.dataset.more = more;
      else delete el.dataset.more;
      el.dataset.axis = across ? 'x' : 'y';
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    ro?.observe(el);
    for (const card of el.children) ro?.observe(card);
    return () => {
      el.removeEventListener('scroll', update);
      ro?.disconnect();
    };
  }, [orderKey]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !current) return;
    let smooth = true;
    const keep = () => {
      const across = el.scrollWidth > el.clientWidth + 1;
      if (!across && el.scrollHeight <= el.clientHeight + 1) return;
      const must = cardSpan(el, current, across);
      if (!must) return;
      const want = me && me !== current ? cardSpan(el, me, across) : null;
      const pos = stripScroll(across ? el.scrollLeft : el.scrollTop, across ? el.clientWidth : el.clientHeight, must, want);
      const behavior: ScrollBehavior = smooth && !settings.get().reduceMotion ? 'smooth' : 'auto';
      el.scrollTo(across ? { left: pos, behavior } : { top: pos, behavior });
      smooth = false;
    };
    keep();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(keep);
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [current, me, orderKey]);

  return ref;
}

interface CardProps {
  seat: SeatId;
  s: GameState;
  info: SeatInfo | undefined;
  names: Names;
  mine: boolean;
  /** Show the You badge */
  you: boolean;
  turn: boolean;
  /** Online only, for human seats: whether the player's connection is up */
  presence: Presence;
  showNetWorth: boolean;
}

export const PlayerCard = memo(function PlayerCard({ seat, s, info, names, mine, you, turn, presence, showNetWorth }: CardProps) {
  const p = s.players[seat];
  if (!p) return null;
  const colour = safeColor(info?.color);
  const left = info?.kind === 'human' && !info.ctrl;
  const status = info?.kind === 'human' && !left && !p.out ? presence : undefined;
  const classes = ['player-card', turn && 'active', p.out && 'out', mine && 'mine', you && 'you', p.jail && 'jailed'].filter(Boolean).join(' ');
  const owned = clusters(names.board)
    .map((c) => ({ ...c, mine: c.spaces.filter((i) => s.props[`p${i}`]?.owner === seat) }))
    .filter((c) => c.mine.length > 0);
  return (
    <li
      className={classes}
      data-seat={seat}
      aria-current={turn ? 'true' : undefined}
      style={{ '--seat': colour } as CSSProperties}
      onMouseEnter={() => uiStore.update({ spotlight: seat })}
      onMouseLeave={() => uiStore.get().spotlight === seat && uiStore.update({ spotlight: null })}
      onFocus={() => uiStore.update({ spotlight: seat })}
      onBlur={() => uiStore.get().spotlight === seat && uiStore.update({ spotlight: null })}
    >
      <div className="player-row">
        <span className="player-token" style={{ color: colour }}>
          <TokenIcon token={info?.token ?? DEFAULT_TOKEN} color={info?.color} size={26} label={true} />
        </span>
        <span className="player-name">
          <span className="player-title">
            <strong>{names.seat(seat)}</strong>
            {status && (
              <span className={`presence ${status}`} title={status === 'online' ? 'Online' : 'Offline: reconnecting or away'}>
                <span className="sr-only">, {status}</span>
              </span>
            )}
          </span>
          {turn && <span className="sr-only">, playing now</span>}
          <span className="player-badges">
            {you && <span className="badge accent">You</span>}
            {info?.kind === 'bot' && (
              <span className="badge bot" title={`Bot, ${info.skill ?? 'normal'} level`}>
                {/* No-break spaces: the level is a flex item of its own, whose edge spaces would collapse */}
                Bot{info.skill && <span className="badge-skill">{`\u00a0·\u00a0${info.skill}`}</span>}
              </span>
            )}
            {info?.afk && <span className="badge" title="Away: a bot is playing this seat">AFK</span>}
            {left && <span className="badge danger" title="This player left the game">Left</span>}
            {p.jail && <span className="badge danger" title={`In jail, try ${p.jail.tries + 1} of 3`}>Jail</span>}
            {p.goojf.length > 0 && (
              <span className="badge good" title="Get Out of Jail Free cards">
                Free{p.goojf.length > 1 ? ` ×${p.goojf.length}` : ''}
              </span>
            )}
            {p.out && <span className="badge danger">{p.out === 'resigned' ? 'Resigned' : 'Bankrupt'}</span>}
          </span>
        </span>
        <span className="player-cash">
          <Money value={p.cash} />
          {showNetWorth && !p.out && <small className="muted" title="Net worth">{money(netWorth(s, seat))}</small>}
        </span>
      </div>
      {owned.length > 0 && (
        <div className="swatches" aria-label={`${names.seat(seat)}'s property`}>
          {owned.map((c) => (
            <span key={c.id} className="swatch-group" title={c.label}>
              {c.spaces.map((i) => {
                const ps = s.props[`p${i}`];
                const has = ps?.owner === seat;
                if (!has) return <span key={i} className="swatch empty" style={{ borderColor: c.colour }} aria-hidden="true" />;
                const level = ps.level;
                const label = `${names.space(i)}${ps.mortgaged ? ', mortgaged' : ''}${level ? `, ${levelText(level)}` : ''}`;
                return (
                  <button
                    key={i}
                    type="button"
                    className={ps.mortgaged ? 'swatch mortgaged' : 'swatch'}
                    style={{ background: c.colour }}
                    title={label}
                    aria-label={label}
                    onClick={() => uiStore.update({ selected: i })}
                  >
                    {level === 5 ? <span className="pip hotel" aria-hidden="true">H</span> : level > 0 && <span className="pips" aria-hidden="true">{'•'.repeat(level)}</span>}
                  </button>
                );
              })}
            </span>
          ))}
        </div>
      )}
    </li>
  );
});
