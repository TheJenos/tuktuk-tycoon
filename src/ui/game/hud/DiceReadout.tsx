import type { GameEvent } from '../../../rules';
import { PIPS } from '../../../scene/dice/faces';
import { useView, type ViewState } from '../../../view';
import { safeColor } from '../../colors';
import { useDoc, useNames } from '../context';
import { TokenIcon } from '../tokenIcons';
import { diceText } from './formatEvent';
import '../heroes.css';

/** A die face drawn as pips, laid out like the dice on the table (a font's die glyphs sit off-centre) */
function DieFace({ value }: { value: number }) {
  const spots = PIPS[value];
  if (!spots) return <>{value}</>;
  return (
    <svg className="pips" viewBox="0 0 1 1" width="20" height="20">
      {spots.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={value === 1 ? 0.13 : 0.1} fill="currentColor" />)}
    </svg>
  );
}

/** Hero League: the Hero die's last throw this turn, as the board played it (scanning back no further than the turn) */
function recentHeroDie(log: ViewState['log']): Extract<GameEvent, { t: 'heroDie' }> | null {
  for (let i = log.length - 1; i >= 0; i--) {
    const ev = log[i]!.ev;
    if (ev.t === 'heroDie') return ev;
    if (ev.t === 'turn') return null;
  }
  return null;
}

/**
 * The last throw the board showed, in words for screen readers ("4 + 3, speed: Bus") and as faces; on Hero League
 * also the Hero die's face this turn (the hero's silhouette in the colour of the seat playing it, grey when nobody
 * does; the log line says it aloud)
 */
export function DiceReadout() {
  const dice = useView((v) => v.dice);
  const heroDie = useView((v) => recentHeroDie(v.log));
  const doc = useDoc();
  const names = useNames();
  const holder = heroDie ? names.heroSeat(heroDie.hero) : undefined;
  return (
    <div className="dice-readout panel" data-testid="dice-readout">
      {dice && (
        <span className="dice-faces" aria-hidden="true">
          <span className="die"><DieFace value={dice.w[0]} /></span>
          <span className="die"><DieFace value={dice.w[1]} /></span>
          {dice.s !== undefined && <span className="die speed">{typeof dice.s === 'number' ? dice.s : dice.s === 'bus' ? 'BUS' : 'M'}</span>}
          {heroDie && (
            <span className="die hero" title={`Hero die: ${names.hero(heroDie.hero)}`} style={{ color: holder ? safeColor(doc?.seats[holder]?.color) : '#8b95a8' }}>
              <TokenIcon token={heroDie.hero} size={18} />
            </span>
          )}
        </span>
      )}
      {/* The same element throughout, so every new roll is announced */}
      <span className="dice-text" aria-live="polite" aria-atomic="true">
        {dice ? (
          <>
            <span className="sr-only">{names.seat(dice.seat)} rolled </span>
            {diceText(names, dice)}
            {dice.triples ? ' · triples' : dice.doubles ? ' · doubles' : ''}
          </>
        ) : (
          <span className="muted">No roll yet</span>
        )}
      </span>
      {heroDie && (
        <span className="muted small hero-die-text" aria-hidden="true">
          Hero die: {names.hero(heroDie.hero)}
        </span>
      )}
    </div>
  );
}
