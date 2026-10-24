import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULTS, UI_SCALE_MAX, UI_SCALE_MIN, defaultSettings, normalizeSettings } from '../settings';

/** A localStorage stand-in for Node */
function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => { data.delete(k); },
    setItem: (k, v) => { data.set(k, String(v)); },
  };
}

describe('settings defaults', () => {
  it('start phones on low quality and desktops on high', () => {
    expect(defaultSettings({ coarse: true, reducedMotion: false }).quality).toBe('low');
    expect(defaultSettings({ coarse: false, reducedMotion: false }).quality).toBe('high');
  });

  it('follow the OS reduce-motion preference', () => {
    expect(defaultSettings({ coarse: false, reducedMotion: true }).reduceMotion).toBe(true);
    expect(defaultSettings({ coarse: false, reducedMotion: false }).reduceMotion).toBe(false);
  });

  it('are what nothing saved, or garbage, loads as', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULTS);
    expect(normalizeSettings('nonsense')).toEqual(DEFAULTS);
    expect(normalizeSettings({})).toEqual(DEFAULTS);
  });
});

describe('normalizeSettings', () => {
  it('clamps numbers into range', () => {
    expect(normalizeSettings({ volume: 3, uiScale: 9 })).toMatchObject({ volume: 1, uiScale: UI_SCALE_MAX });
    expect(normalizeSettings({ volume: -1, uiScale: 0.1 })).toMatchObject({ volume: 0, uiScale: UI_SCALE_MIN });
    expect(normalizeSettings({ volume: 0.25, uiScale: 1.2 })).toMatchObject({ volume: 0.25, uiScale: 1.2 });
  });

  it('falls back to the default for values of the wrong kind', () => {
    const s = normalizeSettings({ volume: NaN, uiScale: '1.2', quality: 'ultra', animSpeed: 'slow', sound: 'yes', autoCamera: 0 });
    expect(s.volume).toBe(DEFAULTS.volume);
    expect(s.uiScale).toBe(DEFAULTS.uiScale);
    expect(s.quality).toBe(DEFAULTS.quality);
    expect(s.animSpeed).toBe(DEFAULTS.animSpeed);
    expect(s.sound).toBe(DEFAULTS.sound);
    expect(s.autoCamera).toBe(DEFAULTS.autoCamera);
  });

  it('keeps valid choices and drops fields it does not know', () => {
    const s = normalizeSettings({ quality: 'medium', animSpeed: 'instant', dicePhysics: false, version: 1, killcam: true });
    expect(s).toMatchObject({ quality: 'medium', animSpeed: 'instant', dicePhysics: false });
    expect(s).not.toHaveProperty('version');
    expect(s).not.toHaveProperty('killcam');
  });
});

describe('the settings store', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('loads from and saves to tuktuk-settings', async () => {
    const storage = memoryStorage({ 'tuktuk-settings': JSON.stringify({ animSpeed: 'instant', quality: 'low', dicePhysics: false }) });
    vi.stubGlobal('localStorage', storage);
    vi.resetModules();
    const { settings } = await import('../settings');

    expect(settings.get()).toMatchObject({ animSpeed: 'instant', quality: 'low', dicePhysics: false });

    const listener = vi.fn();
    settings.subscribe(listener);
    settings.update({ volume: 0.5 });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(JSON.parse(storage.getItem('tuktuk-settings')!)).toMatchObject({ volume: 0.5, animSpeed: 'instant', version: 1 });

    settings.reset();
    expect(settings.get().animSpeed).toBe('normal');
  });

  it('keeps working for the session when storage is unavailable', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
    });
    vi.resetModules();
    const { settings, DEFAULTS: defaults } = await import('../settings');
    expect(settings.get()).toEqual(defaults);
    settings.update({ sound: !defaults.sound });
    expect(settings.get().sound).toBe(!defaults.sound);
  });
});
