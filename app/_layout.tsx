import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { useEffect } from 'react';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { useGameStore } from '@/src/store/gameStore';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const userTeamId = useGameStore(state => state.userTeamId);

  useEffect(() => {
    const state = useGameStore.getState();
    const isStateValid = state.userTeamId && state.teams[state.userTeamId];

    if (!isStateValid) {
      // First, temporarily initialize to generate the data
      state.initializeGame('temp');
      
      // Now get that generated data
      const allTeams = useGameStore.getState().teams;
      const firstTeamId = Object.keys(allTeams)[0];
      
      // Update the userTeamId directly without regenerating the data
      if (firstTeamId) {
        useGameStore.setState({ userTeamId: firstTeamId });
      }
    }
  }, [userTeamId]);

  if (!userTeamId) return null; // Wait for initialization

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
