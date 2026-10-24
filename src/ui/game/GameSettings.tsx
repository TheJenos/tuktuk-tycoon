import { useStore } from '../../state/store';
import { ANIM_SPEEDS, QUALITIES, UI_SCALE_MAX, UI_SCALE_MIN, settings, useSettings, type Settings } from '../settings';
import { useMySeats } from './context';
import { hotSeatCards, setHotSeatCards } from './hotSeat';

type Flag = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];

const FLAGS: { key: Flag; label: string }[] = [
  { key: 'dicePhysics', label: 'Dice thrown with physics (off: a simple tumble)' },
  { key: 'autoCamera', label: 'The camera follows the action (moving it yourself pauses this until Recenter)' },
  { key: 'showNetWorth', label: "Show each player's net worth" },
  { key: 'reduceMotion', label: 'Reduce motion: no camera sweeps, bounces or pulsing' },
  { key: 'sound', label: 'Sound' },
];

/** The game menu's Settings view: the same settings as the lobby's, saved as you go (plus hot-seat's own) */
export function GameSettings() {
  const current = useSettings();
  const hotSeat = useMySeats().length > 1;
  const passCards = useStore(hotSeatCards);
  return (
    <div className="game-settings">
      <div className="setting">
        <span>Quality</span>
        <div className="choices" role="radiogroup" aria-label="Graphics quality">
          {QUALITIES.map((q) => (
            <button
              key={q.value}
              type="button"
              role="radio"
              aria-checked={current.quality === q.value}
              className={current.quality === q.value ? 'choice selected' : 'choice'}
              title={q.hint}
              onClick={() => settings.update({ quality: q.value })}
            >
              {q.label}
            </button>
          ))}
        </div>
      </div>
      <div className="setting">
        <span>Animations</span>
        <div className="choices" role="radiogroup" aria-label="Animation speed">
          {ANIM_SPEEDS.map((a) => (
            <button
              key={a.value}
              type="button"
              role="radio"
              aria-checked={current.animSpeed === a.value}
              className={current.animSpeed === a.value ? 'choice selected' : 'choice'}
              title={a.hint}
              onClick={() => settings.update({ animSpeed: a.value })}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
      {FLAGS.map((f) => (
        <label key={f.key} className="setting check">
          <input type="checkbox" checked={current[f.key]} onChange={(e) => settings.update({ [f.key]: e.target.checked } as Partial<Settings>)} />
          <span>{f.label}</span>
        </label>
      ))}
      {hotSeat && (
        <label className="setting check">
          <input type="checkbox" checked={passCards} onChange={(e) => setHotSeatCards(e.target.checked)} />
          <span>Hot-seat: a "Pass to" card before each player's turn, so nobody sees the next player's choices</span>
        </label>
      )}
      <label className={current.sound ? 'setting' : 'setting disabled'}>
        <span>Volume</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={current.volume}
          disabled={!current.sound}
          onChange={(e) => settings.update({ volume: Number(e.target.value) })}
        />
        <span className="number-readout">{Math.round(current.volume * 100)}%</span>
      </label>
      <label className="setting">
        <span>Panel size</span>
        <input
          type="range"
          min={UI_SCALE_MIN}
          max={UI_SCALE_MAX}
          step={0.05}
          value={current.uiScale}
          onChange={(e) => settings.update({ uiScale: Number(e.target.value) })}
        />
        <span className="number-readout">{Math.round(current.uiScale * 100)}%</span>
      </label>
    </div>
  );
}
