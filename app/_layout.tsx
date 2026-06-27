import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { installAgentGameHandler } from '@/src/dev/agentGameHandler';
import { useGameStore } from '@/src/store/gameStore';
import { PERSIST_STORAGE_KEY, clearPersistLoadError, getPersistLoadError, safeStorage } from '@/src/store/persistence';
import { Button, Screen } from '@/components/ui';
import { ConfirmHost } from '@/components/ui/confirm-host';
import { color, space, type } from '@/src/design/tokens';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
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

  // B4: hydration skeleton. Previously this returned `null`, which flashed a blank
  // screen on cold start. A branded loader confirms the app is alive while the
  // persisted store rehydrates.
  if (!hasHydrated) {
    return (
      <ThemeProvider value={DarkTheme}>
        <Screen scroll={false} edges={['top', 'bottom']}>
          <View style={styles.loadingContainer}>
            <Text style={styles.loadingTitle}>Manager Sim</Text>
            <Text style={styles.loadingHint}>Loading your saved game…</Text>
          </View>
        </Screen>
        <StatusBar style="light" />
      </ThemeProvider>
    );
  }

  if (loadError) {
    return (
      <ThemeProvider value={DarkTheme}>
        <Screen scroll={false} edges={['top', 'bottom']}>
          <View style={styles.errorContainer}>
            <Text style={styles.errorTitle}>Saved game could not be loaded</Text>
            <Text style={styles.errorMessage}>{loadError.message}</Text>
            <Button title="Start fresh" variant="primary" onPress={handleStartFresh} />
          </View>
        </Screen>
        <StatusBar style="light" />
      </ThemeProvider>
    );
  }

  // DECISION (B1/B4): dark-only. The half-wired light plumbing was removed; we
  // always render the dark navigation theme so the system chrome matches the
  // dark surfaces every screen now uses.
  return (
    <ThemeProvider value={DarkTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="league" options={{ headerShown: false }} />
        <Stack.Screen name="board" options={{ headerShown: false }} />
        <Stack.Screen name="calendar" options={{ headerShown: false }} />
        <Stack.Screen name="inbox" options={{ headerShown: false }} />
        <Stack.Screen name="stats" options={{ headerShown: false }} />
        <Stack.Screen name="match" options={{ presentation: 'fullScreenModal', title: 'Match Day' }} />
      </Stack>
      <ConfirmHost />
      <StatusBar style="light" />
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
  },
  loadingTitle: {
    fontSize: type.h1.fontSize,
    fontWeight: '900',
    color: color.text.primary,
  },
  loadingHint: {
    fontSize: type.body.fontSize,
    color: color.text.faint,
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
    gap: space.lg,
  },
  errorTitle: {
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    color: color.text.primary,
  },
  errorMessage: {
    fontSize: 16,
    lineHeight: 22,
    color: color.text.muted,
    textAlign: 'center',
  },
});
