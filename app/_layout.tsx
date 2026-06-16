import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { installAgentGameHandler } from '@/src/dev/agentGameHandler';
import { useGameStore } from '@/src/store/gameStore';
import { TEMP_TEAM_ID } from '@/src/constants';
import { Colors } from '@/constants/colors';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [hasHydrated, setHasHydrated] = useState(false);

  useEffect(() => {
    setHasHydrated(useGameStore.persist.hasHydrated());
    const unsub = useGameStore.persist.onFinishHydration(() => {
      setHasHydrated(true);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!__DEV__) return undefined;
    return installAgentGameHandler();
  }, []);

  useEffect(() => {
    if (!hasHydrated) return;

    const state = useGameStore.getState();
    const hasManagedTeam = Boolean(state.userTeamId && state.teams[state.userTeamId]);
    const hasLeagueData = Object.keys(state.teams).length > 0 && Object.keys(state.fixtures).length > 0;

    if (!hasManagedTeam && !hasLeagueData) {
      state.initializeGame(TEMP_TEAM_ID);
    }
  }, [hasHydrated]);

  if (!hasHydrated) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={Colors.accent} />
      </View>
    );
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="league" options={{ headerShown: false }} />
        <Stack.Screen name="board" options={{ headerShown: false }} />
        <Stack.Screen name="calendar" options={{ headerShown: false }} />
        <Stack.Screen name="inbox" options={{ headerShown: false }} />
        <Stack.Screen name="stats" options={{ headerShown: false }} />
        <Stack.Screen name="match" options={{ presentation: 'fullScreenModal', title: 'Match Day' }} />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
