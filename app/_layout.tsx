import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { useEffect } from 'react';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { useGameStore } from '@/src/store/gameStore';
import { useState } from 'react';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const userTeamId = useGameStore(state => state.userTeamId);
  const [hasHydrated, setHasHydrated] = useState(false);

  useEffect(() => {
    setHasHydrated(useGameStore.persist.hasHydrated());
    const unsub = useGameStore.persist.onFinishHydration(() => {
      setHasHydrated(true);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!hasHydrated) return;

    const state = useGameStore.getState();
    const isStateValid = state.userTeamId && state.teams[state.userTeamId];

    if (!isStateValid) {
      state.initializeGame('temp');
    }
  }, [hasHydrated, userTeamId]);

  if (!hasHydrated || !userTeamId) return null; // Wait for initialization

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="match" options={{ presentation: 'fullScreenModal', title: 'Match Day' }} />
        <Stack.Screen name="stats" options={{ presentation: 'modal', title: 'League Stats' }} />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
