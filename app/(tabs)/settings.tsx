import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CurrentTeamCard } from '@/components/settings/current-team-card';
import { DevToolsCard } from '@/components/settings/dev-tools-card';
import { TeamSelectionSheet } from '@/components/settings/team-selection-sheet';
import { useGameStore } from '@/src/store/gameStore';
import { sortTeamsByDivisionAndName } from '@/src/core/leagueUtils';

export default function SettingsScreen() {
  const userTeamId = useGameStore(state => state.userTeamId);
  const teams = useGameStore(state => state.teams);
  const advanceWeek = useGameStore(state => state.advanceWeek);
  const skipToEndOfSeason = useGameStore(state => state.skipToEndOfSeason);
  const changeTeam = useGameStore(state => state.changeTeam);
  const initializeGame = useGameStore(state => state.initializeGame);
  const [showChangeTeam, setShowChangeTeam] = useState(false);

  const userTeam = userTeamId ? teams[userTeamId] : null;
  const sortedTeams = useMemo(() => sortTeamsByDivisionAndName(Object.values(teams)), [teams]);

  const advanceWeeks = useCallback((count: number) => {
    for (let i = 0; i < count; i++) {
      advanceWeek();
    }
  }, [advanceWeek]);

  const handleResetSeason = () => {
    if (!userTeamId) return;
    initializeGame(userTeamId);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Text style={styles.title}>Settings</Text>
          <Text style={styles.subtitle}>Game settings and developer tools</Text>
        </View>

        <CurrentTeamCard team={userTeam} onChangeTeam={() => setShowChangeTeam(true)} />

        <DevToolsCard
          onAdvanceWeek={advanceWeek}
          onAdvanceFiveWeeks={() => advanceWeeks(5)}
          onSkipSeason={skipToEndOfSeason}
          onResetSeason={handleResetSeason}
        />
      </ScrollView>

      <TeamSelectionSheet
        visible={showChangeTeam}
        teams={sortedTeams}
        currentTeamId={userTeamId}
        onClose={() => setShowChangeTeam(false)}
        onSelect={(teamId) => {
          changeTeam(teamId);
          setShowChangeTeam(false);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  scroll: { padding: 16, paddingBottom: 40 },
  header: { marginBottom: 16 },
  title: { fontSize: 26, fontWeight: '900', color: '#f8fafc' },
  subtitle: { color: '#64748b', fontSize: 13, marginTop: 2, fontWeight: '600' },
});
