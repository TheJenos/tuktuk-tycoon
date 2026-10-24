import { afterEach, describe, expect, it, vi } from 'vitest';
import { NAME_PATTERN, isValidName, loadName, saveName } from '../playerName';

describe('NAME_PATTERN', () => {
  it.each(['Al', 'Alice', 'Bob 2', 'mr_money-bags', 'Zoë', 'Ünal Çelik', '李小龙', 'A'.repeat(16)])('accepts %j', (name) => {
    expect(isValidName(name)).toBe(true);
  });

  it.each(['', 'A', 'A'.repeat(17), ' Alice', 'Alice ', 'Al!ce', 'a.b', '<b>', 'tab\there'])('rejects %j', (name) => {
    expect(NAME_PATTERN.test(name)).toBe(false);
  });
});

describe('the saved name', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('round-trips through tuktuk-name', () => {
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v) });
    expect(loadName()).toBe('');
    saveName('Alice');
    expect(data.get('tuktuk-name')).toBe('Alice');
    expect(loadName()).toBe('Alice');
  });

  it('is empty when there is no storage', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(loadName()).toBe('');
    expect(() => saveName('Alice')).not.toThrow();
  });
});
