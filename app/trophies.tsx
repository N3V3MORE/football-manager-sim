import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { PageHeader } from '@/components/ui/page-header';
import { useGameStore } from '@/src/store/gameStore';
import { CupCompetition } from '@/src/models/types';
import { sortTeamsByTable } from '@/src/core/leagueUtils';

const getOrdinalSuffix = (value: number) => {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
  const mod10 = value % 10;
  if (mod10 === 1) return `${value}st`;
  if (mod10 === 2) return `${value}nd`;
  if (mod10 === 3) return `${value}rd`;
  return `${value}th`;
};

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
  const divisionTable = sortTeamsByTable(Object.values(teams).filter(team => team.division === userTeam.division));
  const position = divisionTable.findIndex(team => team.id === userTeamId) + 1;

  const getCupStatus = (competition: CupCompetition) => {
    const nextFixture = Object.values(fixtures)
      .filter(
        fixture =>
          !fixture.isPlayed &&
          fixture.competition === competition &&
          (fixture.homeTeamId === userTeamId || fixture.awayTeamId === userTeamId)
      )
      .sort((a, b) => {
        if (a.week !== b.week) return a.week - b.week;
        return (a.roundNumber || 0) - (b.roundNumber || 0);
      })[0];
    if (nextFixture) return `In ${nextFixture.roundName || `Round ${nextFixture.roundNumber || 1}`}`;

    const cupState = cups[competition];
    if (!cupState) return 'Not active';
    if (cupState.completed) {
      return cupState.entrants[0] === userTeamId ? 'Winners' : 'Eliminated';
    }
    const stillInCup = cupState.entrants.includes(userTeamId) || cupState.currentRoundByeTeamId === userTeamId;
    return stillInCup ? `In ${cupState.roundName}` : 'Eliminated';
  };

  const currentSeason = {
    season,
    competitions: {
      league: position > 0 ? `${getOrdinalSuffix(position)} (${userTeam.division})` : `- (${userTeam.division})`,
      carabaoCup: getCupStatus('Carabao Cup'),
      faCup: getCupStatus('FA Cup'),
      ucl: 'Not active yet',
    },
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <PageHeader title="Trophies" backLabel="< Hub" onBack={() => router.replace('/')} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.cabinetCard}>
          <Text style={styles.sectionTitle}>Trophy Cabinet</Text>
          <Text style={styles.cabinetLine}>Carabao Cup: {trophyCabinet['Carabao Cup'] || 0}</Text>
          <Text style={styles.cabinetLine}>FA Cup: {trophyCabinet['FA Cup'] || 0}</Text>
          <Text style={styles.cabinetLine}>UEFA Champions League: {trophyCabinet['UEFA Champions League'] || 0}</Text>
        </View>

        <View style={styles.resultsCard}>
          <Text style={styles.sectionTitle}>Season {currentSeason.season} (Current)</Text>
          <Text style={styles.resultRow}>League: {currentSeason.competitions.league}</Text>
          <Text style={styles.resultRow}>Carabao Cup: {currentSeason.competitions.carabaoCup}</Text>
          <Text style={styles.resultRow}>FA Cup: {currentSeason.competitions.faCup}</Text>
          <Text style={styles.resultRow}>UCL: {currentSeason.competitions.ucl}</Text>
        </View>

        {seasonResults.map(result => (
          <View key={`${result.season}-${result.teamId}`} style={styles.resultsCard}>
            <Text style={styles.sectionTitle}>Season {result.season}</Text>
            <Text style={styles.teamName}>{result.teamName}</Text>
            <Text style={styles.resultRow}>League: {result.competitions.league}</Text>
            <Text style={styles.resultRow}>Carabao Cup: {result.competitions.carabaoCup}</Text>
            <Text style={styles.resultRow}>FA Cup: {result.competitions.faCup}</Text>
            <Text style={styles.resultRow}>UCL: {result.competitions.ucl}</Text>
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
