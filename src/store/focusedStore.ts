import type { StoreApi } from 'zustand/vanilla';

type ReadonlyStore<T> = Pick<StoreApi<T>, 'getState' | 'getInitialState' | 'subscribe'>;

/** A presentation snapshot; pausing it never changes the source store. */
export function createFocusedStoreView<T>(source: ReadonlyStore<T>, focused: boolean): ReadonlyStore<T> {
  const snapshot = source.getState();
  return {
    getState: focused ? source.getState : () => snapshot,
    getInitialState: source.getInitialState,
    subscribe: focused ? source.subscribe : () => () => {},
  };
}
