import { LOOP_SECONDS, SOUNDS, type MusicName, type SoundName } from './sounds';

/*
 * Web Audio playback: one AudioContext, made (or resumed) on the first user gesture since browsers block audio
 * until then. Buffers are fetched and decoded on first use. Effects and music each have a gain node, so their
 * settings apply at once; music also passes through a duck node that dips it under a stinger. Each board has its
 * own sounds in a folder (setFolder); a file it doesn't have is the original one (the root of the sounds).
 *
 * Nothing here touches the DOM or the settings: src/audio/index.ts wires those in, and the tests drive it with a
 * fake context.
 */

export interface PlayOpts {
  /** Multiplies the sound's own volume */
  gain?: number;
  /** Seconds from now */
  delay?: number;
  /** Pitch spread override, in semitones */
  pitch?: number;
}

export interface Voice {
  stop(): void;
}

export interface EngineOptions {
  /** Makes the context (null: none available) */
  createContext: () => AudioContext | null;
  /** URL of a sound: name and extension in, URL out */
  url: (name: string, ext: 'ogg' | 'mp3') => string;
  fetch: (url: string) => Promise<{ ok: boolean; arrayBuffer(): Promise<ArrayBuffer> }>;
  /** Which file type to try first */
  prefer: 'ogg' | 'mp3';
  random?: () => number;
}

/** Perceived loudness from a 0..1 slider */
export const curve = (v: number): number => Math.max(0, Math.min(1, v)) ** 2;

/** Base gain of the music under the effects (the loop is mixed loud) */
const MUSIC_LEVEL = 0.45;
/** A sound that can't be decoded in time is dropped rather than played late */
const LATE_S = 0.25;
const FADE_IN_S = 1.5;
const FADE_OUT_S = 0.6;

export class AudioEngine {
  ctx: AudioContext | null = null;
  private sfx: GainNode | null = null;
  private music: GainNode | null = null;
  private duckNode: GainNode | null = null;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private ready = new Map<string, AudioBuffer>();
  private voices = new Map<SoundName, { src: AudioBufferSourceNode; end: number }[]>();
  private fx = { on: true, vol: 1 };
  private mus = { on: true, vol: 1 };
  private random: () => number;

  // Music state
  private loop: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private intro: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  /** Whether music should play now (in the lobby or a game), whatever the setting */
  private wantMusic = false;
  private loopStarting = false;
  private introPending = false;
  /** The board's sound folder ('' = the originals) and its loop's length */
  private folder = '';
  private loopSeconds = LOOP_SECONDS;

  constructor(private opts: EngineOptions) {
    this.random = opts.random ?? Math.random;
  }

  /** Makes or resumes the context; call from a user gesture. Returns whether audio runs. */
  unlock(): boolean {
    if (!this.ctx) {
      const ctx = this.opts.createContext();
      if (!ctx) return false;
      this.ctx = ctx;
      this.sfx = ctx.createGain();
      this.music = ctx.createGain();
      this.duckNode = ctx.createGain();
      this.sfx.connect(ctx.destination);
      this.duckNode.connect(this.music);
      this.music.connect(ctx.destination);
      this.applyGains(true);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
    this.syncMusic();
    return true;
  }

  get running(): boolean {
    return this.ctx?.state === 'running';
  }

  /** Pauses everything (a hidden tab) or picks up again */
  suspend(hidden: boolean): void {
    if (!this.ctx) return;
    if (hidden && this.ctx.state === 'running') void this.ctx.suspend().catch(() => {});
    else if (!hidden && this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
  }

  setEffects(on: boolean, vol: number): void {
    this.fx = { on, vol };
    this.applyGains(false);
  }

  setMusic(on: boolean, vol: number): void {
    this.mus = { on, vol };
    this.applyGains(false);
    this.syncMusic();
  }

  private applyGains(now: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfx || !this.music) return;
    const t = ctx.currentTime;
    const set = (g: GainNode, v: number) => {
      g.gain.cancelScheduledValues(t);
      if (now) g.gain.setValueAtTime(v, t);
      else g.gain.setTargetAtTime(v, t, 0.05);
    };
    set(this.sfx, this.fx.on ? curve(this.fx.vol) : 0);
    set(this.music, this.mus.on ? curve(this.mus.vol) * MUSIC_LEVEL : 0);
  }

  /**
   * Plays the sounds in `folder` from now on ('' = the originals); `loopSeconds` is where its music loop is cut. The
   * music crossfades to the new board's loop.
   */
  setFolder(folder: string, loopSeconds = LOOP_SECONDS): void {
    if (folder === this.folder) return;
    this.folder = folder;
    this.loopSeconds = loopSeconds;
    if (!this.ctx) return;
    this.stopLoop(FADE_OUT_S);
    this.syncMusic();
  }

  /** A sound's path in the current folder */
  private path(name: string): string {
    return this.folder ? `${this.folder}/${name}` : name;
  }

  /** Fetches and decodes a sound of the current folder (once), else the original; each format tried in turn */
  load(name: string): Promise<AudioBuffer | null> {
    const key = this.path(name);
    let p = this.buffers.get(key);
    if (!p) {
      p = this.fetchBoth(key).then((b) => b ?? (key === name ? null : this.load0(name)));
      p.then((b) => b && this.ready.set(key, b));
      this.buffers.set(key, p);
    }
    return p;
  }

  /** The original sound (the root's), cached under its bare name */
  private load0(name: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(name);
    if (!p) {
      p = this.fetchBoth(name);
      p.then((b) => b && this.ready.set(name, b));
      this.buffers.set(name, p);
    }
    return p;
  }

  private fetchBoth(path: string): Promise<AudioBuffer | null> {
    const other = this.opts.prefer === 'ogg' ? 'mp3' : 'ogg';
    return this.decode(path, this.opts.prefer).then((b) => b ?? this.decode(path, other));
  }

  private async decode(name: string, ext: 'ogg' | 'mp3'): Promise<AudioBuffer | null> {
    const ctx = this.ctx;
    if (!ctx) return null;
    try {
      const res = await this.opts.fetch(this.opts.url(name, ext));
      if (!res.ok) return null;
      return await ctx.decodeAudioData(await res.arrayBuffer());
    } catch {
      return null;
    }
  }

  /** Decodes every listed sound in the background */
  preload(names: readonly string[]): void {
    if (!this.ctx) return;
    for (const n of names) void this.load(n);
  }

  /** Plays an effect; null when effects are off, audio isn't running, or it isn't decoded in time */
  play(name: SoundName, o: PlayOpts = {}): Voice | null {
    const ctx = this.ctx;
    if (!ctx || !this.sfx || !this.fx.on || this.fx.vol <= 0 || ctx.state !== 'running') return null;
    const def = SOUNDS[name];
    const gain = def.vol * (o.gain ?? 1);
    if (gain <= 0) return null;
    const when = ctx.currentTime + Math.max(0, o.delay ?? 0);
    let stopped = false;
    let src: AudioBufferSourceNode | null = null;
    const start = (buf: AudioBuffer) => {
      if (stopped || !this.sfx) return;
      const at = Math.max(when, ctx.currentTime);
      if (at - when > LATE_S) return;
      src = this.voice(name, buf, gain, at, o.pitch ?? def.pitch);
      if (def.duck) this.duck(buf.duration);
    };
    const buf = this.ready.get(this.path(name));
    if (buf) start(buf);
    else void this.load(name).then((b) => b && start(b));
    return {
      stop: () => {
        stopped = true;
        try {
          src?.stop();
        } catch { /* already stopped */ }
      },
    };
  }

  private voice(name: SoundName, buf: AudioBuffer, gain: number, at: number, pitch: number): AudioBufferSourceNode {
    const ctx = this.ctx as AudioContext;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    if (pitch > 0) src.playbackRate.value = 2 ** (((this.random() * 2 - 1) * pitch) / 12);
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g);
    g.connect(this.sfx as GainNode);
    const end = at + buf.duration / src.playbackRate.value;
    // At most `max` copies: the oldest still sounding makes way
    const list = (this.voices.get(name) ?? []).filter((v) => v.end > ctx.currentTime);
    while (list.length >= SOUNDS[name].max) {
      const old = list.shift();
      try {
        old?.src.stop();
      } catch { /* not started yet or done */ }
    }
    list.push({ src, end });
    this.voices.set(name, list);
    src.onended = () => {
      src.disconnect();
      g.disconnect();
    };
    src.start(at);
    return src;
  }

  /** Dips the music for a stinger of `seconds` */
  duck(seconds: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.duckNode) return;
    const t = ctx.currentTime;
    const g = this.duckNode.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0.25, t + 0.08);
    g.setValueAtTime(0.25, t + 0.08 + seconds);
    g.linearRampToValueAtTime(1, t + 0.08 + seconds + 0.8);
  }

  // --- Music ---

  /** Whether the screen wants music (the setting still decides if it plays) */
  wantsMusic(on: boolean): void {
    this.wantMusic = on;
    this.syncMusic();
  }

  /** Plays the intro jingle once (the loop steps aside, and comes back after it) */
  playIntro(): void {
    if (!this.musicAudible()) return;
    const ctx = this.ctx as AudioContext;
    this.stopLoop(0.3);
    this.stopIntro(0.1);
    this.introPending = true;
    void this.load('music-intro').then((buf) => {
      this.introPending = false;
      if (!buf || !this.musicAudible() || this.intro) return this.syncMusic();
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const gain = ctx.createGain();
      gain.gain.value = 1;
      src.connect(gain);
      gain.connect(this.duckNode as GainNode);
      const intro = { src, gain };
      this.intro = intro;
      src.onended = () => {
        src.disconnect();
        gain.disconnect();
        if (this.intro !== intro) return;
        this.intro = null;
        this.syncMusic();
      };
      src.start(ctx.currentTime + 0.3);
    });
  }

  private musicAudible(): boolean {
    // A suspended context (a hidden tab, or before the first gesture) just holds the music where it is
    return !!this.ctx && this.ctx.state !== 'closed' && this.wantMusic && this.mus.on && this.mus.vol > 0;
  }

  /** Starts or stops the loop to match the screen and the setting */
  syncMusic(): void {
    if (!this.ctx) return;
    if (!this.musicAudible()) {
      this.stopLoop(FADE_OUT_S);
      this.stopIntro(FADE_OUT_S);
      return;
    }
    if (this.loop || this.intro || this.loopStarting || this.introPending) return;
    this.loopStarting = true;
    const folder = this.folder;
    void this.load('music-loop').then((buf) => {
      this.loopStarting = false;
      // The board changed while it loaded: its own loop instead
      if (folder !== this.folder) return this.syncMusic();
      if (!buf || this.loop || this.intro || !this.musicAudible()) return;
      const ctx = this.ctx as AudioContext;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.loopStart = 0;
      src.loopEnd = Math.min(buf.duration, this.loopSeconds);
      const gain = ctx.createGain();
      const t = ctx.currentTime;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(1, t + FADE_IN_S);
      src.connect(gain);
      gain.connect(this.duckNode as GainNode);
      src.start(t);
      this.loop = { src, gain };
    });
  }

  private stopLoop(fade: number): void {
    if (this.loop) this.fadeOut(this.loop, fade);
    this.loop = null;
  }

  private stopIntro(fade: number): void {
    const i = this.intro;
    this.intro = null;
    if (i) {
      i.src.onended = null;
      this.fadeOut(i, fade);
    }
  }

  private fadeOut(n: { src: AudioBufferSourceNode; gain: GainNode }, fade: number): void {
    const ctx = this.ctx as AudioContext;
    const t = ctx.currentTime;
    n.gain.gain.cancelScheduledValues(t);
    n.gain.gain.setValueAtTime(n.gain.gain.value, t);
    n.gain.gain.linearRampToValueAtTime(0, t + fade);
    try {
      n.src.stop(t + fade + 0.05);
    } catch { /* never started */ }
  }

  /** What is playing, for the tests and the dev hooks */
  musicState(): 'off' | 'intro' | 'loop' {
    return this.intro ? 'intro' : this.loop ? 'loop' : 'off';
  }
}

export type { MusicName };
