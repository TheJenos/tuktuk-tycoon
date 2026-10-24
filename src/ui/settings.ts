import { createStore, useStore, type Store } from '../state/store';

/** Player preferences, saved in this browser. The scene and the DOM both read them from `settings`. */

export type Quality = 'low' | 'medium' | 'high';
export type AnimSpeed = 'normal' | 'fast' | 'instant';

export interface Settings {
  /** Rendering tier: resolution, shadows, board texture size (see the scene's quality table) */
  quality: Quality;
  /** How fast moves play out: tokens, dice, cards. Instant skips straight to the result. */
  animSpeed: AnimSpeed;
  /** Dice thrown with physics; off (or low quality) gives a plain tumble */
  dicePhysics: boolean;
  /** The camera follows the action; moving it by hand pauses this until Recenter */
  autoCamera: boolean;
  /** Each player's net worth in the players panel */
  showNetWorth: boolean;
  /** No camera sweeps, bounces or pulsing panels */
  reduceMotion: boolean;
  sound: boolean;
  /** 0..1 */
  volume: number;
  /** Size multiplier for the game's panels */
  uiScale: number;
}

export const UI_SCALE_MIN = 0.8;
export const UI_SCALE_MAX = 1.4;

export const QUALITIES: { value: Quality; label: string; hint: string }[] = [
  { value: 'low', label: 'Low', hint: 'No shadows, lower resolution, simple dice' },
  { value: 'medium', label: 'Medium', hint: 'Shadows, sharper board' },
  { value: 'high', label: 'High', hint: 'Sharp shadows, full resolution' },
];

export const ANIM_SPEEDS: { value: AnimSpeed; label: string; hint: string }[] = [
  { value: 'normal', label: 'Normal', hint: 'Every hop and roll' },
  { value: 'fast', label: 'Fast', hint: 'The same moves, quicker' },
  { value: 'instant', label: 'Instant', hint: 'Straight to the result' },
];

const COARSE = typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches;
const MOTION_QUERY = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

/** The defaults on a device: phones start low (they can turn it up), and motion follows the OS. */
export function defaultSettings(device: { coarse: boolean; reducedMotion: boolean }): Settings {
  return {
    quality: device.coarse ? 'low' : 'high',
    animSpeed: 'normal',
    dicePhysics: true,
    autoCamera: true,
    showNetWorth: true,
    reduceMotion: device.reducedMotion,
    sound: true,
    volume: 0.8,
    uiScale: 1,
  };
}

export const DEFAULTS: Settings = defaultSettings({ coarse: COARSE, reducedMotion: !!MOTION_QUERY?.matches });

const STORAGE_KEY = 'tuktuk-settings';
/** Saved alongside, so a later change to a default can tell older saves apart (as the reference's crouch key did). */
const VERSION = 1;

const num = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
const oneOf = <V extends string>(v: unknown, options: readonly { value: V }[], fallback: V): V =>
  options.some((o) => o.value === v) ? (v as V) : fallback;

/** Saved settings (anything, from storage) made valid: unknown values fall back to `defaults`, numbers are clamped. */
export function normalizeSettings(saved: unknown, defaults: Settings = DEFAULTS): Settings {
  const s = (saved && typeof saved === 'object' ? saved : {}) as Partial<Record<keyof Settings, unknown>>;
  return {
    quality: oneOf(s.quality, QUALITIES, defaults.quality),
    animSpeed: oneOf(s.animSpeed, ANIM_SPEEDS, defaults.animSpeed),
    dicePhysics: bool(s.dicePhysics, defaults.dicePhysics),
    autoCamera: bool(s.autoCamera, defaults.autoCamera),
    showNetWorth: bool(s.showNetWorth, defaults.showNetWorth),
    reduceMotion: bool(s.reduceMotion, defaults.reduceMotion),
    sound: bool(s.sound, defaults.sound),
    volume: num(s.volume, 0, 1, defaults.volume),
    uiScale: num(s.uiScale, UI_SCALE_MIN, UI_SCALE_MAX, defaults.uiScale),
  };
}

function load(): Settings {
  try {
    return normalizeSettings(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'));
  } catch {
    return DEFAULTS;
  }
}

function save(s: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...s, version: VERSION }));
  } catch { /* storage unavailable: keep the settings for this session */ }
}

const store = createStore<Settings>(load());
store.subscribe(() => save(store.get()));

/** The settings: `settings.update({ animSpeed: 'fast' })` saves and tells every reader. */
export const settings: Store<Settings> & { reset(): void } = {
  ...store,
  reset: () => store.set(DEFAULTS),
};

export const useSettings = (): Settings => useStore(settings);

/** Keep `html.reduce-motion` in step with the setting, for the CSS. */
export function watchReducedMotion(): void {
  const apply = () => document.documentElement.classList.toggle('reduce-motion', settings.get().reduceMotion);
  apply();
  settings.subscribe(apply);
}
