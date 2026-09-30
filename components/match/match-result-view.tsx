import { Text, View, TouchableOpacity, ScrollView } from 'react-native';
import { Screen } from '@/components/ui';
import { getTeamTheme } from '@/src/constants/teamColors';
import type { Fixture, Player, Team, MatchPlayerSummaryRow } from '@/src/models/types';
import { matchStyles as styles } from './match-styles';

type MatchResultProps = { fixture: Fixture; teams: Record<string, Team>; players: Record<string, Player>; onExit: () => void; onContinue: () => void };

export function MatchResultView({ fixture, teams, players, onExit, onContinue }: MatchResultProps) {
  const homeTeam = teams[fixture.homeTeamId];
  const awayTeam = teams[fixture.awayTeamId];
  const hScore = fixture.homeScore ?? 0;
  const aScore = fixture.awayScore ?? 0;
  const homeTheme = getTeamTheme(homeTeam.name);
  const awayThemeRaw = getTeamTheme(awayTeam.name);
  let awayPrimary = awayThemeRaw.primary;
  if (homeTheme.primary === awayThemeRaw.primary) {
    awayPrimary = awayThemeRaw.secondary;
  }
  const matchSummary = fixture.matchSummary;
  const manOfTheMatch = matchSummary?.playerRows.find(row => row.playerId === matchSummary.manOfTheMatchPlayerId);
  const homeSummaryRows = matchSummary?.playerRows.filter(row => row.teamId === fixture.homeTeamId) || [];
  const awaySummaryRows = matchSummary?.playerRows.filter(row => row.teamId === fixture.awayTeamId) || [];
  const renderRatingRows = (rows: MatchPlayerSummaryRow[]) => (
    rows
      .sort((left, right) => right.minutes - left.minutes || right.rating - left.rating)
      .map(row => (
        <View key={row.playerId} style={styles.ratingRow}>
          <Text style={styles.ratingName} numberOfLines={1}>{row.name}</Text>
          <Text style={styles.ratingMeta}>{`${row.minutes}'`}</Text>
          <Text style={styles.ratingMeta}>{row.rating.toFixed(1)}</Text>
        </View>
      ))
  );
  return (
    <Screen scroll={false}>
      <View style={styles.topNav}>
        <TouchableOpacity onPress={onExit} style={styles.exitBtn} accessibilityRole="button" accessibilityLabel="Exit match">
          <Text style={styles.exitText}>[ EXIT ]</Text>
        </TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.headerTitle}>Match Result</Text>
        <Text style={styles.stadiumText}>{homeTheme.stadium}</Text>
        <View style={styles.scoreboard}>
          <View style={styles.teamBox}>
            <Text style={[styles.teamName, { color: homeTheme.primary }]}>{homeTeam.name}</Text>
            <Text style={styles.score}>{fixture.resolution === 'void' ? '—' : hScore}</Text>
          </View>
          <View style={styles.vsBox}>
            <Text style={styles.vsText}>VS</Text>
          </View>
          <View style={styles.teamBox}>
            <Text style={[styles.teamName, { color: awayPrimary }]}>{awayTeam.name}</Text>
            <Text style={styles.score}>{fixture.resolution === 'void' ? '—' : aScore}</Text>
          </View>
        </View>
        {fixture.resolution === 'void' && <Text style={styles.penaltiesNote}>Fixture void — no result awarded</Text>}
        {fixture.resolution === 'extra_time' && (
          <Text style={styles.penaltiesNote}>
            Won after extra time
          </Text>
        )}
        {fixture.resolution === 'penalties' && (
          <Text style={styles.penaltiesNote}>
            Won on penalties{fixture.penaltyShootout ? ` (${fixture.penaltyShootout.homeScore}-${fixture.penaltyShootout.awayScore})` : ''}
          </Text>
        )}
        {fixture.penaltyShootout && (
          <View style={styles.summaryPanel}>
            <Text style={styles.summaryTitle}>Penalty Shootout</Text>
            {fixture.penaltyShootout.kicks.map((kick, index) => (
              <Text key={`${kick.teamId}-${kick.takerPlayerId}-${index}`} style={styles.ratingMeta}>
                {teams[kick.teamId]?.name}: {players[kick.takerPlayerId]?.name || 'Taker'} - {kick.outcome.toUpperCase()} ({kick.homeScore}-{kick.awayScore})
              </Text>
            ))}
          </View>
        )}
        {matchSummary && (
          <View style={styles.summaryPanel}>
            <Text style={styles.summaryTitle}>Match Stats</Text>
            <View style={styles.statRow}>
              <Text style={styles.statValue}>{matchSummary.homeTeamStats.shots}</Text>
              <Text style={styles.statLabel}>Shots</Text>
              <Text style={styles.statValue}>{matchSummary.awayTeamStats.shots}</Text>
            </View>
            <View style={styles.statRow}>
              <Text style={styles.statValue}>{matchSummary.homeTeamStats.shotsOnTarget}</Text>
              <Text style={styles.statLabel}>Shots on Target</Text>
              <Text style={styles.statValue}>{matchSummary.awayTeamStats.shotsOnTarget}</Text>
            </View>
            {manOfTheMatch && (
              <View style={styles.motmBox}>
                <Text style={styles.summaryTitle}>Man of the Match</Text>
                <Text style={styles.motmName}>{manOfTheMatch.name}</Text>
                <Text style={styles.motmMeta}>{manOfTheMatch.rating.toFixed(1)} rating</Text>
              </View>
            )}
            <Text style={styles.summaryTitle}>Player Ratings</Text>
            <View style={styles.ratingsGrid}>
              <View style={styles.ratingsCol}>
                <Text style={[styles.lineupHeader, { color: homeTheme.primary }]}>{homeTeam.name}</Text>
                {renderRatingRows(homeSummaryRows)}
              </View>
              <View style={styles.ratingsCol}>
                <Text style={[styles.lineupHeader, { color: awayPrimary, textAlign: 'right' }]}>{awayTeam.name}</Text>
                {renderRatingRows(awaySummaryRows)}
              </View>
            </View>
          </View>
        )}
        <View style={styles.buttonContainer}>
          <TouchableOpacity style={styles.btnContinue} onPress={onContinue} accessibilityRole="button" accessibilityLabel="Continue to next week">
            <Text style={styles.btnText}>Continue to Next Week</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </Screen>
  );
}
