import { describe, expect, it, vi } from 'vitest';
import { AudioEngine, curve } from '../engine';

/* A stand-in for Web Audio, just enough to see what the engine starts, stops and how loud */

class FakeParam {
  value = 1;
  setValueAtTime(v: number) { this.value = v; }
  setTargetAtTime(v: number) { this.value = v; }
  linearRampToValueAtTime(v: number) { this.value = v; }
  cancelScheduledValues() {}
}

class FakeNode {
  connect() {}
  disconnect() {}
}

class FakeGain extends FakeNode {
  gain = new FakeParam();
}

class FakeSource extends FakeNode {
  buffer: { duration: number } | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  playbackRate = new FakeParam();
  onended: (() => void) | null = null;
  started: number | null = null;
  stopped = false;
  constructor(private log: FakeSource[]) {
    super();
  }
  start(at = 0) {
    this.started = at;
    this.log.push(this);
  }
  stop() {
    this.stopped = true;
  }
}

function fakeContext() {
  const sources: FakeSource[] = [];
  const ctx = {
    state: 'running' as AudioContextState,
    currentTime: 0,
    destination: new FakeNode(),
    createGain: () => new FakeGain(),
    createBufferSource: () => new FakeSource(sources),
    decodeAudioData: vi.fn(async (b: ArrayBuffer) => ({ duration: b.byteLength / 10 })),
    resume: vi.fn(async () => { ctx.state = 'running'; }),
    suspend: vi.fn(async () => { ctx.state = 'suspended'; }),
  };
  return { ctx, sources };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

function setup(opts: { prefer?: 'ogg' | 'mp3'; missing?: string[] } = {}) {
  const { ctx, sources } = fakeContext();
  const urls: string[] = [];
  const engine = new AudioEngine({
    createContext: () => ctx as unknown as AudioContext,
    url: (name, ext) => `/sounds/${name}.${ext}`,
    fetch: async (u) => {
      urls.push(u);
      const ok = !opts.missing?.some((m) => u.endsWith(m));
      return { ok, arrayBuffer: async () => new ArrayBuffer(u.includes('music') ? 170 : 5) };
    },
    prefer: opts.prefer ?? 'ogg',
    random: () => 0.5,
  });
  return { engine, ctx, sources, urls };
}

describe('AudioEngine', () => {
  it('makes no context and plays nothing before unlock', async () => {
    const { engine, sources } = setup();
    expect(engine.play('click')).toBeNull();
    await tick();
    expect(engine.ctx).toBeNull();
    expect(sources).toHaveLength(0);
  });

  it('decodes a sound once and plays it', async () => {
    const { engine, sources, urls } = setup();
    engine.unlock();
    engine.play('click');
    await tick();
    engine.play('click');
    await tick();
    expect(urls.filter((u) => u.includes('click'))).toEqual(['/sounds/click.ogg']);
    expect(sources).toHaveLength(2);
  });

  it('falls back to the MP3 when the OGG does not load', async () => {
    const { engine, sources, urls } = setup({ missing: ['click.ogg'] });
    engine.unlock();
    engine.play('click');
    await tick();
    await tick();
    expect(urls).toEqual(['/sounds/click.ogg', '/sounds/click.mp3']);
    expect(sources).toHaveLength(1);
  });

  it('caps copies of one sound: the oldest stops', async () => {
    const { engine, sources } = setup();
    engine.unlock();
    await engine.load('token-hop');
    for (let i = 0; i < 6; i++) engine.play('token-hop');
    expect(sources).toHaveLength(6);
    expect(sources.filter((s) => s.stopped)).toHaveLength(2); // max 4
  });

  it('varies the pitch of repeated sounds', async () => {
    const { ctx, sources } = fakeContext();
    let r = 0;
    const engine = new AudioEngine({
      createContext: () => ctx as unknown as AudioContext,
      url: (n, e) => `${n}.${e}`,
      fetch: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(5) }),
      prefer: 'ogg',
      random: () => (r = (r + 0.37) % 1),
    });
    engine.unlock();
    await engine.load('dice-land');
    engine.play('dice-land');
    engine.play('dice-land');
    const [a, b] = sources.map((s) => s.playbackRate.value);
    expect(a).not.toBe(b);
    expect(Math.abs(Math.log2(a!) * 12)).toBeLessThanOrEqual(1);
  });

  it('plays nothing with effects off, and nothing while suspended', async () => {
    const { engine, ctx, sources } = setup();
    engine.unlock();
    await engine.load('click');
    engine.setEffects(false, 1);
    expect(engine.play('click')).toBeNull();
    engine.setEffects(true, 1);
    ctx.state = 'suspended';
    expect(engine.play('click')).toBeNull();
    expect(sources).toHaveLength(0);
  });

  it('stops a scheduled sound', async () => {
    const { engine, sources } = setup();
    engine.unlock();
    await engine.load('token-hop');
    const v = engine.play('token-hop', { delay: 0.5 });
    expect(sources[0]!.started).toBe(0.5);
    v?.stop();
    expect(sources[0]!.stopped).toBe(true);
  });

  it('loops the music when wanted and the setting is on, the intro first as a game starts', async () => {
    const { engine, sources } = setup();
    engine.unlock();
    engine.wantsMusic(true);
    await tick();
    await tick();
    expect(engine.musicState()).toBe('loop');
    const loop = sources.find((s) => s.loop)!;
    expect(loop.loopEnd).toBeLessThanOrEqual(17.44);

    engine.playIntro();
    expect(loop.stopped).toBe(true);
    await tick();
    expect(engine.musicState()).toBe('intro');
    const intro = sources.at(-1)!;
    intro.onended?.();
    await tick();
    await tick();
    expect(engine.musicState()).toBe('loop');

    engine.setMusic(false, 0.5);
    expect(engine.musicState()).toBe('off');
    engine.setMusic(true, 0.5);
    await tick();
    await tick();
    expect(engine.musicState()).toBe('loop');
  });

  it('pauses with a hidden tab and picks up again', () => {
    const { engine, ctx } = setup();
    engine.unlock();
    engine.suspend(true);
    expect(ctx.suspend).toHaveBeenCalled();
    ctx.state = 'suspended';
    engine.suspend(false);
    expect(ctx.resume).toHaveBeenCalled();
  });

  it('turns slider positions into loudness', () => {
    expect(curve(0)).toBe(0);
    expect(curve(1)).toBe(1);
    expect(curve(0.5)).toBeCloseTo(0.25);
    expect(curve(3)).toBe(1);
  });
});
