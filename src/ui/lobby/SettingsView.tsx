import { useState, type FormEvent } from 'react';
import { ConfirmButton } from '../ConfirmButton';
import { NAME_PATTERN } from '../playerName';
import { ANIM_SPEEDS, BOARD_VIEWS, QUALITIES, REACTIONS, settings, UI_SCALE_MAX, UI_SCALE_MIN, useSettings, type Settings } from '../settings';
import { Choices, Toggle } from './Choices';

/*
 * The lobby's Settings view: your name (outside Discord), then the same settings the game menu has, bound to the
 * settings store and saved as you go. (The game menu's own panel needs a running game, for its hot-seat options.)
 */

type Flag = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];

const FLAGS: { key: Flag; label: string; hint?: string }[] = [
  { key: 'dicePhysics', label: 'Dice thrown with physics', hint: 'Off: a simple tumble (always on low quality)' },
  { key: 'autoCamera', label: 'The camera follows the action', hint: 'Moving it yourself pauses this until Recenter' },
  { key: 'showNetWorth', label: "Show each player's net worth" },
  { key: 'reduceMotion', label: 'Reduce motion', hint: 'No camera sweeps, bounces or pulsing' },
];

export function SettingsView({ name, onRename }: { name: string; onRename?: (name: string) => void }) {
  const s = useSettings();
  return (
    <div className="lobby-settings">
      {onRename && <RenameRow name={name} onRename={onRename} />}
      <div className="lobby-form">
        <Choices
          label="Board view"
          value={s.boardView}
          options={BOARD_VIEWS}
          hint="3D: a tilted table that turns to follow the action. 2D: straight down from above."
          onChange={(boardView) => settings.update({ boardView })}
        />
        <Choices label="Graphics quality" value={s.quality} options={QUALITIES} onChange={(quality) => settings.update({ quality })} />
        <Choices label="Animation speed" value={s.animSpeed} options={ANIM_SPEEDS} onChange={(animSpeed) => settings.update({ animSpeed })} />
        <Choices
          label="Hero League reactions"
          value={s.reactions}
          options={REACTIONS}
          hint="When a superpower could answer a throw or a card: ask every time, only about your own throws, or never"
          onChange={(reactions) => settings.update({ reactions })}
        />
        {FLAGS.map((f) => (
          <Toggle key={f.key} label={f.label} hint={f.hint} checked={s[f.key]} onChange={(on) => settings.update({ [f.key]: on } as Partial<Settings>)} />
        ))}
        <Toggle label="Sound effects" hint="Dice, coins, cards and buttons" checked={s.sound} onChange={(sound) => settings.update({ sound })} />
        <VolumeRow label="Effects volume" value={s.volume} disabled={!s.sound} onChange={(volume) => settings.update({ volume })} />
        <Toggle label="Music" hint="N in a game turns all sound off and on" checked={s.music} onChange={(music) => settings.update({ music })} />
        <VolumeRow label="Music volume" value={s.musicVolume} disabled={!s.music} onChange={(musicVolume) => settings.update({ musicVolume })} />
        <label className="lobby-setting range">
          <span className="lobby-setting-label">Panel size</span>
          <span className="lobby-range">
            <input type="range" min={UI_SCALE_MIN} max={UI_SCALE_MAX} step={0.05} value={s.uiScale} onChange={(e) => settings.update({ uiScale: Number(e.target.value) })} />
            <span className="muted">{Math.round(s.uiScale * 100)}%</span>
          </span>
        </label>
      </div>
      <footer className="lobby-settings-foot">
        <ConfirmButton className="danger" question="Put every setting back to its default?" yes="Reset" no="Keep" onConfirm={() => settings.reset()}>
          Reset to defaults
        </ConfirmButton>
        <span className="muted">Saved as you go, in this browser.</span>
        <a href="/credits.html" target="_blank" rel="noreferrer" className="muted">Credits</a>
      </footer>
    </div>
  );
}

function VolumeRow({ label, value, disabled, onChange }: { label: string; value: number; disabled: boolean; onChange(v: number): void }) {
  return (
    <label className={disabled ? 'lobby-setting range disabled' : 'lobby-setting range'}>
      <span className="lobby-setting-label">{label}</span>
      <span className="lobby-range">
        <input type="range" min={0} max={1} step={0.05} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} />
        <span className="muted">{Math.round(value * 100)}%</span>
      </span>
    </label>
  );
}

function RenameRow({ name, onRename }: { name: string; onRename(name: string): void }) {
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next = draft.trim().replace(/\s+/g, ' ');
    if (!NAME_PATTERN.test(next)) {
      setError('Names are 2–16 characters: letters, numbers, spaces, - or _.');
      return;
    }
    setError('');
    setSaved(true);
    onRename(next);
  };
  return (
    <form className="rename-row" onSubmit={submit}>
      <label className="field" htmlFor="rename-input">
        <span>Your name</span>
      </label>
      <div className="row">
        <input id="rename-input" value={draft} maxLength={16} autoComplete="off" onChange={(e) => (setDraft(e.target.value), setSaved(false))} />
        <button type="submit" disabled={draft.trim() === name}>Rename</button>
      </div>
      {error ? <p className="error" role="alert">{error}</p> : saved ? <p className="muted" role="status">Saved. Rooms you join from now on show this name.</p> : null}
    </form>
  );
}
