import { describe, expect, it, vi } from 'vitest';
import { createStore, memoSelector, shallowArrayEqual, shallowEqual } from '../store';

interface Hud {
  cash: number;
  name: string;
  owned: number[];
}

const initial = (): Hud => ({ cash: 1500, name: 'Alice', owned: [1, 3] });

describe('createStore', () => {
  it('drops a patch that changes nothing', () => {
    const store = createStore(initial());
    const before = store.get();
    const listener = vi.fn();
    store.subscribe(listener);

    store.update({ cash: 1500, owned: before.owned });

    expect(listener).not.toHaveBeenCalled();
    expect(store.get()).toBe(before);
  });

  it('merges a patch that changes something into a new value, and tells every listener once', () => {
    const store = createStore(initial());
    const before = store.get();
    const a = vi.fn();
    const b = vi.fn();
    store.subscribe(a);
    store.subscribe(b);

    store.update({ cash: 1300, name: 'Alice' });

    expect(store.get()).toEqual({ cash: 1300, name: 'Alice', owned: [1, 3] });
    expect(store.get()).not.toBe(before);
    expect(before.cash).toBe(1500);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('compares patch values by identity, not by contents', () => {
    const store = createStore(initial());
    const listener = vi.fn();
    store.subscribe(listener);
    store.update({ owned: [1, 3] });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('ignores setting the value it already holds, and holds primitives too', () => {
    const idle = createStore(true);
    const listener = vi.fn();
    idle.subscribe(listener);
    idle.set(true);
    expect(listener).not.toHaveBeenCalled();
    idle.set(false);
    expect(idle.get()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stops telling a listener once it unsubscribes', () => {
    const store = createStore(initial());
    const listener = vi.fn();
    const off = store.subscribe(listener);
    off();
    store.update({ cash: 1 });
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('memoSelector', () => {
  it('returns the same selection while the store value is unchanged', () => {
    const store = createStore(initial());
    const select = vi.fn((s: Hud) => s.owned.map((i) => i * 2));
    const get = memoSelector(store.get, select);
    const first = get();
    expect(get()).toBe(first);
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('keeps the previous selection while a new one is equal', () => {
    const store = createStore(initial());
    const get = memoSelector(store.get, (s) => ({ cash: s.cash }), shallowEqual);
    const first = get();

    store.update({ name: 'Bob' });
    expect(get()).toBe(first);

    store.update({ cash: 1200 });
    const next = get();
    expect(next).not.toBe(first);
    expect(next).toEqual({ cash: 1200 });
  });

  it('uses identity by default, so a selector that builds a new array changes every time', () => {
    const store = createStore(initial());
    const get = memoSelector(store.get, (s) => [...s.owned]);
    const first = get();
    store.update({ name: 'Bob' });
    expect(get()).not.toBe(first);
  });

  it('starts from an earlier selection when given one (an inline selector, new each render)', () => {
    const store = createStore(initial());
    const rendered = { value: [1, 3] };
    const get = memoSelector(store.get, (s) => [...s.owned], shallowArrayEqual, rendered);
    expect(get()).toBe(rendered.value);
  });
});

describe('equality helpers', () => {
  it('shallowEqual compares keys and values by identity', () => {
    const owned = [1];
    expect(shallowEqual({ a: 1, owned }, { a: 1, owned })).toBe(true);
    expect(shallowEqual({ a: 1, owned }, { a: 1, owned: [1] })).toBe(false);
    expect(shallowEqual<Record<string, number>>({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(shallowEqual<Record<string, number | undefined>>({ a: undefined }, { b: undefined })).toBe(false);
  });

  it('shallowArrayEqual compares items in order', () => {
    expect(shallowArrayEqual([1, 2], [1, 2])).toBe(true);
    expect(shallowArrayEqual([1, 2], [2, 1])).toBe(false);
    expect(shallowArrayEqual([1], [1, 1])).toBe(false);
  });
});
