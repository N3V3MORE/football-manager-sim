import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { useEffect, useState } from 'react';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { useGameStore } from '@/src/store/gameStore';
import { getHydrationRepairs, hasHydrationRepairs } from '@/src/store/setup';

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
      return;
    }

    const repairs = getHydrationRepairs(state);
    if (hasHydrationRepairs(repairs)) {
      useGameStore.setState(repairs);
    }
  }, [hasHydrated, userTeamId]);

  if (!hasHydrated || !userTeamId) return null; // Wait for initialization

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="league" options={{ headerShown: false }} />
        <Stack.Screen name="board" options={{ headerShown: false }} />
        <Stack.Screen name="calendar" options={{ headerShown: false }} />
        <Stack.Screen name="stats" options={{ headerShown: false }} />
        <Stack.Screen name="trophies" options={{ headerShown: false }} />
        <Stack.Screen name="match" options={{ presentation: 'fullScreenModal', title: 'Match Day' }} />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
