import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { PageHeader } from '@/components/ui/page-header';
import { useGameStore } from '@/src/store/gameStore';
import { COMPETITION_IDS } from '@/src/core/domainRegistry';
import {
  getCurrentCompetitionStatuses,
  getDisplaySeasonResults,
  getLeagueResultLabel,
  getTrophyCabinetEntries,
} from '@/src/features/world/worldSelectors';

export default function TrophiesScreen() {
  const season = useGameStore(state => state.season);
  const userTeamId = useGameStore(state => state.userTeamId);
  const teams = useGameStore(state => state.teams);
  const cups = useGameStore(state => state.cups);
  const fixtures = useGameStore(state => state.fixtures);
  const trophyCabinet = useGameStore(state => state.trophyCabinet);
  const seasonResults = useGameStore(state => state.seasonResults);

  if (!userTeamId || !teams[userTeamId]) return <View style={styles.container} />;

  const userTeam = teams[userTeamId];
  const trackedCompetitions = [COMPETITION_IDS.CARABAO_CUP, COMPETITION_IDS.FA_CUP, COMPETITION_IDS.UEFA_CHAMPIONS_LEAGUE];
  const currentSeasonCompetitionStatuses = getCurrentCompetitionStatuses({
    competitions: trackedCompetitions,
    fixtures,
    cups,
    userTeamId,
  });
  const currentSeason = {
    season,
    leagueResult: getLeagueResultLabel(teams, userTeamId, userTeam.leagueId),
    competitionEntries: trackedCompetitions.map(competitionId => ({
      competitionId,
      result: currentSeasonCompetitionStatuses[competitionId] || 'Did not participate',
    })),
  };
  const cabinetEntries = getTrophyCabinetEntries(trophyCabinet);
  const displaySeasonResults = getDisplaySeasonResults(seasonResults);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <PageHeader title="Trophies" backLabel="< Hub" onBack={() => router.replace('/')} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.cabinetCard}>
          <Text style={styles.sectionTitle}>Trophy Cabinet</Text>
          {cabinetEntries.map(entry => (
            <Text key={entry.competitionId} style={styles.cabinetLine}>
              {entry.label}: {entry.count}
            </Text>
          ))}
        </View>

        <View style={styles.resultsCard}>
          <Text style={styles.sectionTitle}>Season {currentSeason.season} (Current)</Text>
          <Text style={styles.resultRow}>League: {currentSeason.leagueResult}</Text>
          {cabinetEntries.map(entry => (
            <Text key={`current-${entry.competitionId}`} style={styles.resultRow}>
              {entry.label}: {currentSeason.competitionEntries.find(item => item.competitionId === entry.competitionId)?.result || 'Did not participate'}
            </Text>
          ))}
        </View>

        {displaySeasonResults.map(result => (
          <View key={`${result.season}-${result.teamId}`} style={styles.resultsCard}>
            <Text style={styles.sectionTitle}>Season {result.season}</Text>
            <Text style={styles.teamName}>{result.teamName}</Text>
            <Text style={styles.resultRow}>League: {result.leagueResult}</Text>
            {result.competitionEntries.map(entry => (
              <Text key={`${result.season}-${entry.competitionId}`} style={styles.resultRow}>
                {entry.label}: {entry.result}
              </Text>
            ))}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  scroll: { padding: 16, gap: 12, paddingBottom: 28 },
  cabinetCard: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 12,
    padding: 14,
  },
  resultsCard: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 12,
    padding: 14,
  },
  sectionTitle: { color: '#f8fafc', fontSize: 16, fontWeight: '900', marginBottom: 8 },
  teamName: { color: '#38bdf8', fontSize: 13, fontWeight: '800', marginBottom: 6 },
  cabinetLine: { color: '#cbd5e1', fontSize: 13, fontWeight: '700', marginBottom: 4 },
  resultRow: { color: '#cbd5e1', fontSize: 13, fontWeight: '700', marginBottom: 4 },
});
