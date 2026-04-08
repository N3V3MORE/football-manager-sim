import AsyncStorage from '@react-native-async-storage/async-storage';
import { PersistStorage, StorageValue } from 'zustand/middleware';
import { GameStore } from '../types';

const pendingPersistValues = new Map<string, StorageValue<GameStore> | null>();
let isPersistencePaused = false;

const flushPendingPersistence = async () => {
  const pendingEntries = Array.from(pendingPersistValues.entries());
  pendingPersistValues.clear();

  for (const [key, value] of pendingEntries) {
    try {
      if (value === null) {
        await AsyncStorage.removeItem(key);
      } else {
        await AsyncStorage.setItem(key, JSON.stringify(value));
      }
    } catch {
      // Persistence failures stay non-fatal.
    }
  }
};

export const pauseGamePersistence = () => {
  isPersistencePaused = true;
};

export const resumeGamePersistence = async () => {
  isPersistencePaused = false;
  await flushPendingPersistence();
};

export const gamePersistStorage: PersistStorage<GameStore> = {
  getItem: async (key: string) => {
    try {
      const value = await AsyncStorage.getItem(key);
      return value ? JSON.parse(value) : null;
    } catch {
      return null;
    }
  },
  setItem: async (key: string, value: StorageValue<GameStore>) => {
    if (isPersistencePaused) {
      pendingPersistValues.set(key, value);
      return;
    }

    try {
      await AsyncStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Persistence failures stay non-fatal.
    }
  },
  removeItem: async (key: string) => {
    if (isPersistencePaused) {
      pendingPersistValues.set(key, null);
      return;
    }

    try {
      await AsyncStorage.removeItem(key);
    } catch {
      // Persistence failures stay non-fatal.
    }
  },
};
