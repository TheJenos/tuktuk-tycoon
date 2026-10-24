import { useView } from '../../../view';
import { useNames } from '../context';
import { diceText } from './formatEvent';

const PIPS = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

/** The last throw the board showed, in words for screen readers ("4 + 3, speed: Bus") and as faces */
export function DiceReadout() {
  const dice = useView((v) => v.dice);
  const names = useNames();
  return (
    <div className="dice-readout panel" data-testid="dice-readout">
      {dice && (
        <span className="dice-faces" aria-hidden="true">
          <span className="die">{PIPS[dice.w[0]] ?? dice.w[0]}</span>
          <span className="die">{PIPS[dice.w[1]] ?? dice.w[1]}</span>
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
