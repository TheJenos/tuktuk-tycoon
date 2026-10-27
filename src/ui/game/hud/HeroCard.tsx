import type { CSSProperties } from 'react';
import { activeSeats, heroesOf, heroOf, powerReady, usablePowers, type GameState, type SeatId } from '../../../rules';
import { useView } from '../../../view';
import { safeColor } from '../../colors';
import { useGame, useNames } from '../context';
import { listText, powerName, startName, type Names } from '../format';
import { TokenIcon } from '../tokenIcons';
import { SeatSwitcher, useShownSeat } from './SeatSwitcher';
import '../heroes.css';

/*
 * Hero League: my hero's card in the context column, above my locations: the hero, the superpower's name and text,
 * whether it is ready (and when it comes back once used), and for Steel Ace which heroes' superpowers Suit Up can
 * copy now. Hero cards are public in the board game, so nothing here is hidden. Hot-seat: the same local seat as My
 * locations shows, with the same switcher (a seat picked in either shows in both).
 */

export function HeroCard() {
  const shown = useView((v) => v.game);
  const logical = useGame();
  const s = shown ?? logical;
  const names = useNames();
  const shownSeat = useShownSeat(s);
  if (!s || !names.board.heroes || !shownSeat) return null;
  const { seat } = shownSeat;
  const hero = heroOf(s, seat);
  if (!hero) return null;
  const ready = powerReady(s, seat);
  // What the logical state lets the seat use right now (a window open for it, Titan Smash before the roll)
  const now = logical ? usablePowers(logical, seat) : [];
  return (
    <section className="hero-card panel" aria-label="My hero" style={{ '--hero': safeColor(hero.colour) } as CSSProperties}>
      <header className="hero-card-head">
        <span className="hero-icon">
          <TokenIcon token={hero.id} size={24} />
        </span>
        <strong>{hero.name}</strong>
        <SeatSwitcher shown={shownSeat} names={names} className="hero-seats" />
        {ready ? <span className="badge good">{hero.powerName} ready</span> : <span className="badge">Superpower used</span>}
      </header>
      <p>
        <strong>{hero.powerName}</strong>: {hero.powerText}
      </p>
      {!ready && <p className="muted">Ready again when you collect a {startName(names.board)} salary (not in the turn you used it) or draw a Recharge card.</p>}
      {ready && hero.power === 'copy' && <p className="muted">{copyLine(s, names, seat)}</p>}
      {now.length > 0 && (
        <p>
          <span className="badge accent">Now</span> {listText(now.map((u) => (u.copied ? `${powerName(names.board, u.power)} (${names.hero(u.hero)}'s)` : powerName(names.board, u.power))))}
        </p>
      )}
    </section>
  );
}

/** Steel Ace's Suit Up: the other heroes in play whose superpower is ready, so it can be copied */
function copyLine(s: GameState, names: Names, seat: SeatId): string {
  const others = activeSeats(s).filter((x) => x !== seat && powerReady(s, x));
  const copyable = heroesOf(names.board).filter((h) => h.power !== 'copy' && others.some((x) => s.players[x]?.hero === h.id));
  return copyable.length
    ? `Can copy now: ${listText(copyable.map((h) => `${h.powerName} (${h.name})`))}`
    : "No other hero's superpower is ready to copy";
}
