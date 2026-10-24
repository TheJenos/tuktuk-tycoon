import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';

/*
 * Small external stores read by React through `useSyncExternalStore` (no Redux, no Zustand): the game,
 * view and UI state, and the settings. The scene writes to them from outside React; components select
 * the part they draw with `useSelector`.
 */

export interface Store<T> {
  /** `get` and `subscribe` are stable, so they can go straight to useSyncExternalStore. */
  readonly get: () => T;
  readonly subscribe: (listener: () => void) => () => void;
  /** Replace the value. Setting the value it already holds notifies no one. */
  readonly set: (next: T) => void;
  /**
   * Merge `patch` into an object value. Dropped when every key in it already holds that value (by
   * identity), so the scene can call it every frame without re-rendering anything.
   */
  readonly update: (patch: [T] extends [object] ? Partial<T> : never) => void;
}

export function createStore<T>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  return {
    get: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set: (next) => {
      if (Object.is(next, state)) return;
      state = next;
      emit();
    },
    update: (patch: Partial<T>) => {
      const changed = (Object.keys(patch) as (keyof T)[]).some((k) => !Object.is(patch[k], state[k]));
      if (!changed) return;
      state = { ...state, ...patch };
      emit();
    },
  };
}

export type Equality<S> = (a: S, b: S) => boolean;

/** Two arrays with the same items (by identity) in the same order, e.g. a selected list of ids. */
export const shallowArrayEqual = <S extends readonly unknown[]>(a: S, b: S): boolean =>
  a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

/** Two objects with the same keys holding the same values (by identity). */
export function shallowEqual<S extends object>(a: S, b: S): boolean {
  const keys = Object.keys(a) as (keyof S)[];
  return keys.length === Object.keys(b).length && keys.every((k) => Object.prototype.hasOwnProperty.call(b, k) && Object.is(a[k], b[k]));
}

/**
 * A getSnapshot for useSyncExternalStore that selects from `get()`. It returns the same selection while
 * the store value is unchanged (React calls it on every render and after every change, and needs a
 * stable answer), and keeps the previous selection while a new one `isEqual`s it, so a component
 * re-renders only when what it selected changed. `prev` starts the comparison from an earlier selection.
 */
export function memoSelector<T, S>(
  get: () => T, selector: (state: T) => S, isEqual: Equality<S> = Object.is, prev?: { value: S },
): () => S {
  let memo: { state: T; selected: S } | undefined;
  return () => {
    const state = get();
    if (memo && Object.is(memo.state, state)) return memo.selected;
    const next = selector(state);
    const last = memo ? { value: memo.selected } : prev;
    const selected = last && isEqual(last.value, next) ? last.value : next;
    memo = { state, selected };
    return selected;
  };
}

/**
 * The part of `store` that `selector` picks, re-rendering only when it changes (by `isEqual`, identity by
 * default; pass `shallowEqual` or `shallowArrayEqual` for selectors that build a new object or array).
 */
export function useSelector<T, S>(store: Store<T>, selector: (state: T) => S, isEqual: Equality<S> = Object.is): S {
  // What was last rendered: a selector written inline is new on every render, and starting its memo from
  // here keeps an equal selection's identity across renders too.
  const rendered = useRef<{ value: S } | undefined>(undefined);
  const getSelection = useMemo(
    () => memoSelector(store.get, selector, isEqual, rendered.current),
    [store, selector, isEqual],
  );
  const value = useSyncExternalStore(store.subscribe, getSelection, getSelection);
  useEffect(() => {
    rendered.current = { value };
  }, [value]);
  return value;
}

/** The whole value of `store`. */
export const useStore = <T>(store: Store<T>): T => useSyncExternalStore(store.subscribe, store.get, store.get);
