import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { useStore } from 'zustand';
import { useGameStore } from './gameStore';
import { createFocusedStoreView } from './focusedStore';

type GameStoreState = ReturnType<typeof useGameStore.getState>;
const FocusedStoreContext = createContext<ReturnType<typeof createFocusedStoreView<GameStoreState>> | null>(null);

export function FocusedGameStoreProvider({ children }: { children: ReactNode }) {
  const focused = useIsFocused();
  const store = useMemo(() => createFocusedStoreView(useGameStore, focused), [focused]);
  return <FocusedStoreContext.Provider value={store}>{children}</FocusedStoreContext.Provider>;
}

export function useFocusedGameStore<T>(selector: (state: GameStoreState) => T): T {
  const store = useContext(FocusedStoreContext);
  if (!store) throw new Error('Tab content requires FocusedGameStoreProvider.');
  return useStore(store, selector);
}
