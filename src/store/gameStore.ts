import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  createBoardActions,
  createMatchActions,
  createSeasonActions,
  createSquadActions,
  createTransferActions,
} from './actions';
import { createStoreDefaults, gamePersistStorage, normalizeHydratedState, sanitizeStateForPersistence } from './setup';
import { GameStore } from './types';

export const useGameStore = create<GameStore>()(
  persist(
    (set, get) => ({
      ...createStoreDefaults(),

      ...createMatchActions(set, get),
      ...createSeasonActions(set, get),
      ...createSquadActions(set, get),
      ...createTransferActions(set, get),
      ...createBoardActions(set, get),
    }),
    {
      name: 'football-manager-storage',
      storage: gamePersistStorage,
      partialize: state => sanitizeStateForPersistence(state),
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...normalizeHydratedState(persistedState, currentState as GameStore),
      }),
    }
  )
);
