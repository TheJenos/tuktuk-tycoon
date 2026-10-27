import { ownerOf, type GameEvent } from '../rules';
import { boardTheme } from '../shared/boardThemes';
import { sessionStore } from '../state/session';
import { toasts } from '../ui/game/actions';
import { askReaction } from '../ui/game/selectors';
import { settings } from '../ui/settings';
import { director, type PlayInfo } from '../view';
import { AudioEngine, type Voice } from './engine';
import { cuesFor, pickInstant, reactionCue, type Cue } from './events';
import { SOUND_NAMES } from './sounds';

/*
 * Sound for the game: wires the engine (src/audio/engine.ts) to the settings, the first user gesture, the tab's
 * visibility, the director's events (src/audio/events.ts), the screen (music in the lobby and in games, an intro
 * jingle as a game starts) and the UI (a click for buttons in the lobby and the HUD, an error blip with a refusal
 * toast). Each board has its own music and effects: those of the game on screen, else of the board the lobby shows
 * (setMenuBoard), else All Island's.
 *
 * Silent, with no AudioContext at all, in the Playwright build (VITE_E2E), when localStorage has
 * `tuktuk-silent` = 1, or while both the effects and the music are off.
 */

let engine: AudioEngine | null = null;

export function silenced(): boolean {
  if (import.meta.env?.VITE_E2E === 'true') return true;
  try {
    return localStorage.getItem('tuktuk-silent') === '1';
  } catch {
    return false;
  }
}

function prefer(): 'ogg' | 'mp3' {
  try {
    return new Audio().canPlayType('audio/ogg; codecs="vorbis"') ? 'ogg' : 'mp3';
  } catch {
    return 'mp3';
  }
}

/** Every board's sound files (src/boards/<board>/sounds), as the URLs the build gives them */
const FILES: Record<string, string> = import.meta.glob<string>('../boards/*/sounds/*.{ogg,mp3}', { query: '?url&no-inline', import: 'default', eager: true });

/** A sound's URL: `name` is All Island's, `board/name` that board's; '' when there is no such file */
function soundUrl(path: string, ext: 'ogg' | 'mp3'): string {
  const [board, name] = path.includes('/') ? (path.split('/') as [string, string]) : ['lanka', path];
  return FILES[`../boards/${board}/sounds/${name}.${ext}`] ?? '';
}

const missing = { ok: false, arrayBuffer: async () => new ArrayBuffer(0) };

/** The engine, made on first use (null in a silenced or audio-less browser) */
export function audio(): AudioEngine | null {
  if (engine || silenced() || typeof window === 'undefined' || !(window.AudioContext || (window as { webkitAudioContext?: unknown }).webkitAudioContext)) return engine;
  engine = new AudioEngine({
    createContext: () => {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      try {
        return new Ctor({ latencyHint: 'interactive' });
      } catch {
        return null;
      }
    },
    url: soundUrl,
    fetch: (u) => (u ? fetch(u) : Promise.resolve(missing)),
    prefer: prefer(),
  });
  return engine;
}

/** Plays an effect (nothing before the first gesture, or with effects off) */
export function playSound(name: Cue['name'], o?: { gain?: number; delay?: number }): Voice | null {
  return engine?.play(name, o) ?? null;
}

let muteMemory: { sound: boolean; music: boolean } | null = null;

/** The mute shortcut: everything off, or back to how it was. Returns whether sound is now on. */
export function toggleMute(): boolean {
  const s = settings.get();
  if (s.sound || s.music) {
    muteMemory = { sound: s.sound, music: s.music };
    settings.update({ sound: false, music: false });
    return false;
  }
  settings.update(muteMemory ?? { sound: true, music: true });
  muteMemory = null;
  return true;
}

function inGame(): boolean {
  return !!director.view.get().game;
}

let menuBoard: string | null = null;

/** The board the lobby is showing (a wizard's pick, a waiting room's board), or null when none */
export function setMenuBoard(board: string | null): void {
  menuBoard = board;
  syncBoard();
}

/** Sounds from the board on screen: the game's, else the lobby's, else All Island's */
function syncBoard(): void {
  const e = engine;
  if (!e?.ctx) return;
  const theme = boardTheme(director.view.get().game?.cfg.board ?? menuBoard ?? 'lanka');
  e.setFolder(theme.sounds, theme.loopSeconds);
  e.preload(SOUND_NAMES);
}

let started = false;

/** Call once at startup (the app and the dev pages) */
export function initAudio(): void {
  if (started || typeof window === 'undefined' || silenced()) return;
  started = true;

  const apply = () => {
    const s = settings.get();
    engine?.setEffects(s.sound, s.volume);
    engine?.setMusic(s.music, s.musicVolume);
  };

  // The context needs a gesture; nothing is made while both effects and music are off
  const unlock = () => {
    const s = settings.get();
    if (!s.sound && !s.music) return;
    const e = audio();
    if (!e) return;
    const fresh = !e.ctx;
    if (!e.unlock()) return;
    if (fresh) {
      apply();
      syncBoard();
      e.preload(SOUND_NAMES);
      // Music plays everywhere: the lobby, the waiting room and the game
      e.wantsMusic(true);
    }
  };
  for (const type of ['pointerdown', 'keydown', 'touchend'] as const) window.addEventListener(type, unlock, { capture: true, passive: true });

  settings.subscribe(() => {
    apply();
    // Turning sound on from a click in Settings counts as the gesture
    const s = settings.get();
    if ((s.sound || s.music) && !engine?.ctx && navigator.userActivation?.isActive) unlock();
  });

  document.addEventListener('visibilitychange', () => engine?.suspend(document.hidden));

  // The intro jingle as a game appears on screen (a new game, a rematch, or coming back to one)
  let hadGame = inGame();
  // Hero League: the bell as a reaction window on screen opens for one of my seats the Reactions setting asks
  let prevGame = director.view.get().game;
  director.view.subscribe(() => {
    const now = inGame();
    syncBoard();
    if (now && !hadGame) engine?.playIntro();
    hadGame = now;
    const game = director.view.get().game;
    if (game !== prevGame) {
      const asked = game ? (sessionStore.get().session?.view.get().mySeats ?? []).filter((seat) => askReaction(game, seat, settings.get().reactions)) : [];
      const q = reactionCue(prevGame, game, asked);
      prevGame = game;
      if (q && engine?.running) engine.play(q.name, q);
    }
  });

  // Game events
  let instantCues: Cue[] = [];
  let flush = false;
  director.onPlay((ev: GameEvent, info: PlayInfo) => {
    const e = engine;
    if (!e?.running) return;
    const view = sessionStore.get().session?.view.get();
    const game = director.view.get().game;
    const cues = cuesFor(ev, info.phase, info.speed, {
      mine: view?.mySeats ?? [],
      tokens: !!director.api('tokens'),
      dice: !!director.api('dice'),
      ownerOf: (space) => (game ? ownerOf(game, space) : undefined),
    });
    if (!cues.length) return;
    if (info.phase === 'instant') {
      instantCues.push(...cues);
      if (!flush) {
        flush = true;
        queueMicrotask(() => {
          for (const q of pickInstant(instantCues)) e.play(q.name, q);
          instantCues = [];
          flush = false;
        });
      }
      return;
    }
    const voices = cues.map((q) => e.play(q.name, q));
    // A walk cut short (fast-forward, snap) takes its remaining hops with it
    if (cues.some((q) => q.delay)) info.signal.addEventListener('abort', () => voices.forEach((v) => v?.stop()), { once: true });
  });

  // UI: one delegated listener for the lobby and the HUD, not one per button
  document.addEventListener(
    'click',
    (evt) => {
      const el = (evt.target as Element | null)?.closest?.('button, [role="radio"], [role="tab"], input[type="checkbox"]');
      if (!el || !el.closest('#hud, #lobby') || (el as HTMLButtonElement).disabled) return;
      const primary = el.matches('.primary, [type="submit"]');
      playSound(primary ? 'confirm' : 'click');
    },
    { capture: true, passive: true },
  );

  // A refused move shows a toast: an error blip with it
  let lastToast = toasts.get().at(-1)?.id ?? 0;
  toasts.subscribe(() => {
    const t = toasts.get().at(-1);
    if (!t || t.id === lastToast) return;
    lastToast = t.id;
    if (t.tone === 'error') playSound('error');
  });

}

/** For the dev pages and the console: what the audio is doing */
export function audioState(): { context: AudioContextState | 'none'; music: 'off' | 'intro' | 'loop' } {
  return { context: engine?.ctx?.state ?? 'none', music: engine?.musicState() ?? 'off' };
}
