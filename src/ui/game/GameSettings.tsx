import { useStore } from '../../state/store';
import { ANIM_SPEEDS, QUALITIES, REACTIONS, UI_SCALE_MAX, UI_SCALE_MIN, settings, useSettings, type Settings } from '../settings';
import { useMySeats, useNames } from './context';
import { hotSeatCards, setHotSeatCards } from './hotSeat';

type Flag = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];

const FLAGS: { key: Flag; label: string }[] = [
  { key: 'dicePhysics', label: 'Dice thrown with physics (off: a simple tumble)' },
  { key: 'autoCamera', label: 'The camera follows the action (moving it yourself pauses this until Recenter)' },
  { key: 'showNetWorth', label: "Show each player's net worth" },
  { key: 'reduceMotion', label: 'Reduce motion: no camera sweeps, bounces or pulsing' },
];

/**
 * The game menu's Settings view: the same settings as the lobby's, saved as you go (plus hot-seat's own, and on Hero
 * League when its reaction windows ask this device's players)
 */
export function GameSettings() {
  const current = useSettings();
  const mine = useMySeats();
  const hotSeat = mine.length > 1;
  const passCards = useStore(hotSeatCards);
  const names = useNames();
  const heroes = !!names.board.heroes;
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
      {heroes && mine.length > 0 && (
        <div className="setting">
          <span>Reactions</span>
          <div className="choices" role="radiogroup" aria-label="Ask about superpower reactions">
            {REACTIONS.map((r) => (
              <button
                key={r.value}
                type="button"
                role="radio"
                aria-checked={current.reactions === r.value}
                className={current.reactions === r.value ? 'choice selected' : 'choice'}
                title={r.hint}
                onClick={() => settings.update({ reactions: r.value })}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {FLAGS.map((f) => (
        <label key={f.key} className="setting check">
          <input type="checkbox" checked={current[f.key]} onChange={(e) => settings.update({ [f.key]: e.target.checked } as Partial<Settings>)} />
          <span>{f.key === 'showNetWorth' && heroes ? `Show each player's ${names.terms.worth}` : f.label}</span>
        </label>
      ))}
      {hotSeat && (
        <label className="setting check">
          <input type="checkbox" checked={passCards} onChange={(e) => setHotSeatCards(e.target.checked)} />
          <span>Hot-seat: a "Pass to" card before each player's turn, so nobody sees the next player's choices</span>
        </label>
      )}
      <label className="setting check">
        <input type="checkbox" checked={current.sound} onChange={(e) => settings.update({ sound: e.target.checked })} />
        <span>Sound effects</span>
      </label>
      <Volume label="Effects volume" value={current.volume} disabled={!current.sound} onChange={(volume) => settings.update({ volume })} />
      <label className="setting check">
        <input type="checkbox" checked={current.music} onChange={(e) => settings.update({ music: e.target.checked })} />
        <span>Music</span>
      </label>
      <Volume label="Music volume" value={current.musicVolume} disabled={!current.music} onChange={(musicVolume) => settings.update({ musicVolume })} />
      <p className="muted setting-hint">Press N to turn all sound off and back on.</p>
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

function Volume({ label, value, disabled, onChange }: { label: string; value: number; disabled: boolean; onChange(v: number): void }) {
  return (
    <label className={disabled ? 'setting disabled' : 'setting'}>
      <span>{label}</span>
      <input type="range" min={0} max={1} step={0.05} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="number-readout">{Math.round(value * 100)}%</span>
    </label>
  );
}
