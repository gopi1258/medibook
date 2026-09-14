/**
 * A ~30-line observable store.
 *
 * The TRD suggests Zustand for client state; rather than add a dependency the two
 * stores this app needs (session, booking draft) are built on the same primitive:
 * a mutable snapshot plus `useSyncExternalStore`. The snapshot reference only
 * changes on `set`, so `useStoreState` is loop-safe without memoised selectors.
 */
import { useSyncExternalStore } from 'react';

export type Store<T> = {
  get(): T;
  set(patch: Partial<T> | ((current: T) => Partial<T>)): void;
  /** Replace the whole snapshot (used when resetting on sign-out). */
  replace(next: T): void;
  subscribe(listener: () => void): () => void;
};

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();

  const emit = () => {
    for (const listener of listeners) listener();
  };

  return {
    get: () => state,
    set(patch) {
      const next = typeof patch === 'function' ? patch(state) : patch;
      state = { ...state, ...next };
      emit();
    },
    replace(next) {
      state = next;
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Subscribe a component to the whole snapshot. */
export function useStoreState<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
