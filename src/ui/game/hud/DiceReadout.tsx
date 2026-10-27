import { PIPS } from '../../../scene/dice/faces';
import { useView } from '../../../view';
import { useNames } from '../context';
import { diceText } from './formatEvent';

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

/** The last throw the board showed, in words for screen readers ("4 + 3, speed: Bus") and as faces */
export function DiceReadout() {
  const dice = useView((v) => v.dice);
  const names = useNames();
  return (
    <div className="dice-readout panel" data-testid="dice-readout">
      {dice && (
        <span className="dice-faces" aria-hidden="true">
          <span className="die"><DieFace value={dice.w[0]} /></span>
          <span className="die"><DieFace value={dice.w[1]} /></span>
          {dice.s !== undefined && <span className="die speed">{typeof dice.s === 'number' ? dice.s : dice.s === 'bus' ? 'BUS' : 'M'}</span>}
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
    </div>
  );
}
