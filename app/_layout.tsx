import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { installAgentGameHandler } from '@/src/dev/agentGameHandler';
import { useGameStore } from '@/src/store/gameStore';
import { PERSIST_STORAGE_KEY, clearPersistLoadError, getPersistLoadError, safeStorage } from '@/src/store/persistence';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const userTeamId = useGameStore(state => state.userTeamId);
  const [hasHydrated, setHasHydrated] = useState(false);
  const [loadError, setLoadError] = useState(getPersistLoadError());

  useEffect(() => {
    setHasHydrated(useGameStore.persist.hasHydrated());
    setLoadError(getPersistLoadError());
    const unsub = useGameStore.persist.onFinishHydration(() => {
      setLoadError(getPersistLoadError());
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
    if (loadError) return;

    const state = useGameStore.getState();
    const hasManagedTeam = Boolean(state.userTeamId && state.teams[state.userTeamId]);
    const hasLeagueData = Object.keys(state.teams).length > 0 && Object.keys(state.fixtures).length > 0;

    if (!hasManagedTeam && !hasLeagueData) {
      state.initializeGame('temp');
    }
  }, [hasHydrated, loadError, userTeamId]);

  const handleStartFresh = async () => {
    await safeStorage.removeItem(PERSIST_STORAGE_KEY);
    clearPersistLoadError();
    useGameStore.getState().initializeGame('temp');
    setLoadError(null);
    setHasHydrated(true);
  };

  if (!hasHydrated) return null;

  if (loadError) {
    return (
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorTitle}>Saved game could not be loaded</Text>
          <Text style={styles.errorMessage}>{loadError.message}</Text>
          <Pressable style={styles.errorButton} onPress={handleStartFresh}>
            <Text style={styles.errorButtonText}>Start fresh</Text>
          </Pressable>
        </View>
        <StatusBar style="auto" />
      </ThemeProvider>
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

const styles = StyleSheet.create({
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16,
  },
  errorTitle: {
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  errorMessage: {
    fontSize: 16,
    lineHeight: 22,
    opacity: 0.8,
    textAlign: 'center',
  },
  errorButton: {
    borderRadius: 10,
    backgroundColor: '#2563eb',
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  errorButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});
